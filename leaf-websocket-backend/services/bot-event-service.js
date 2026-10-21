// Avisa os bots do OpenBot quando algo acontece no app (chamado, mensagem, incidente,
// disputa, estorno), em vez de os bots varrerem o backend por horário.
//
// - Desligado por padrão (BOT_EVENTS_ENABLED=true liga). Desligado, emit() não faz nada.
// - Cada destino tem uma rotina de webhook no OpenBot: BOT_EVENTS_<DESTINO>_URL e
//   BOT_EVENTS_<DESTINO>_SECRET (whsec_..., gerado pelo OpenBot).
// - Entrega assinada no padrão Standard Webhooks (webhook-id, webhook-timestamp,
//   webhook-signature), com fila no Redis e novas tentativas por até 24 h, porque o
//   OpenBot roda no Mac do Izaak e pode estar offline.
// - O payload só leva tipo, ids técnicos (chamado, incidente, disputa, corrida),
//   categoria, severidade, sinal de dinheiro e valores. Nunca nome, telefone, documento,
//   texto da mensagem ou id de usuário: o bot busca o detalhe pela API com o próprio login.
const axios = require('axios');
const crypto = require('crypto');
const redisPool = require('../utils/redis-pool');
const { logStructured } = require('../utils/logger');

const OUTBOX_KEY = 'bot_events:outbox';
const ITEMS_KEY = 'bot_events:items';
const DEAD_KEY = 'bot_events:dead';
const SEEN_PREFIX = 'bot_events:seen:';
const LOCK_KEY = 'bot_events:drain_lock';
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BASE_RETRY_MS = 30 * 1000;
const MAX_RETRY_MS = 30 * 60 * 1000;
const BATCH_SIZE = 20;
const DEAD_LETTER_LIMIT = 200;

// Quem recebe cada evento. O destino é a chave do bot no OpenBot.
const ROUTES = Object.freeze({
  'support.ticket_created': ['suporte'],
  'support.message_created': ['suporte'],
  'support.chat_message': ['suporte'],
  'safety.incident_created': ['cto', 'head-atendimento'],
  'dispute.opened': ['cfo', 'suporte'],
  'refund.processed': ['cfo'],
  'refund.failed': ['cfo', 'suporte'],
  'refund.record_failed': ['cfo', 'cto'],
});

// Únicos campos que saem do backend em data.
const DATA_FIELDS = Object.freeze([
  'ticketId', 'incidentId', 'disputeId', 'bookingId', 'chargeRef',
  'category', 'priority', 'resolutionClass', 'reasonCode', 'userType', 'source',
  'senderType', 'status', 'amountCents', 'reason', 'providerRefunded', 'ledgerRecorded',
]);

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function destinationEnvName(destination) {
  return String(destination).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function destinationConfig(destination) {
  const name = destinationEnvName(destination);
  const url = String(process.env[`BOT_EVENTS_${name}_URL`] || '').trim();
  const secret = String(process.env[`BOT_EVENTS_${name}_SECRET`] || '').trim();
  return url && secret ? { url, secret } : null;
}

function sanitizeData(data = {}) {
  const out = {};
  for (const field of DATA_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[field] = value;
    else if (typeof value === 'boolean') out[field] = value;
    else if (typeof value === 'string') out[field] = value.slice(0, 120);
  }
  return out;
}

function normalizeSeverity(value) {
  const severity = String(value || '').trim().toUpperCase();
  return ['N1', 'N2', 'N3'].includes(severity) ? severity : 'N3';
}

// Standard Webhooks: base64(HMAC-SHA256(segredo, "<id>.<timestamp>.<corpo>")).
function signPayload({ secret, id, timestamp, body }) {
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const signature = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${signature}`;
}

function retryDelayMs(attempts) {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.max(0, attempts - 1)));
}

class BotEventService {
  constructor({ redis = redisPool, http = axios, now = () => Date.now() } = {}) {
    this.redisPool = redis;
    this.http = http;
    this.now = now;
    this.timer = null;
  }

  isEnabled() {
    return boolEnv('BOT_EVENTS_ENABLED', false);
  }

  async getRedis() {
    if (this.redisPool?.ensureConnection) await this.redisPool.ensureConnection();
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  // Nunca lança: quem chama está no meio de um fluxo do app e não pode quebrar.
  async emit(type, data = {}, { dedupeKey = null, severity = 'N3', money = false } = {}) {
    try {
      if (!this.isEnabled()) return { queued: 0, skipped: 'disabled' };
      const destinations = ROUTES[type];
      if (!destinations) return { queued: 0, skipped: 'unknown_type' };

      const redis = await this.getRedis();
      if (!redis) return { queued: 0, skipped: 'redis_unavailable' };

      const id = `evt_${crypto.createHash('sha256').update(`${type}:${dedupeKey || crypto.randomUUID()}`).digest('hex').slice(0, 32)}`;
      const fresh = await redis.set(`${SEEN_PREFIX}${id}`, '1', 'EX', SEEN_TTL_SECONDS, 'NX');
      if (fresh !== 'OK') return { queued: 0, skipped: 'duplicate', id };

      const nowMs = this.now();
      const event = {
        id,
        type,
        occurredAt: new Date(nowMs).toISOString(),
        severity: normalizeSeverity(severity),
        money: money === true,
        data: sanitizeData(data),
      };

      let queued = 0;
      for (const destination of destinations) {
        if (!destinationConfig(destination)) continue;
        const member = `${id}:${destination}`;
        await redis.hset(ITEMS_KEY, member, JSON.stringify({ destination, event, attempts: 0, firstAt: nowMs }));
        await redis.zadd(OUTBOX_KEY, nowMs, member);
        queued += 1;
      }
      if (queued) setImmediate(() => { this.drain().catch(() => null); });
      return { queued, id };
    } catch (error) {
      logStructured('warn', 'Falha ao enfileirar evento para os bots', { service: 'bot-events', type, error: error.message });
      return { queued: 0, skipped: 'error' };
    }
  }

  async deliver(item) {
    const config = destinationConfig(item.destination);
    if (!config) return { ok: false, permanent: true, reason: 'destination_not_configured' };
    const body = JSON.stringify(item.event);
    const timestamp = String(Math.floor(this.now() / 1000));
    try {
      await this.http.post(config.url, body, {
        headers: {
          'content-type': 'application/json',
          'webhook-id': item.event.id,
          'webhook-timestamp': timestamp,
          'webhook-signature': signPayload({ secret: config.secret, id: item.event.id, timestamp, body }),
        },
        timeout: 8000,
        transformRequest: [(value) => value],
      });
      return { ok: true };
    } catch (error) {
      const status = error?.response?.status || null;
      // 4xx que não seja limite ou timeout não melhora com nova tentativa.
      const permanent = status !== null && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
      return { ok: false, permanent, reason: status ? `http_${status}` : (error?.code || 'network_error') };
    }
  }

  async drain() {
    if (!this.isEnabled()) return { delivered: 0, retried: 0, dropped: 0, skipped: 'disabled' };
    const redis = await this.getRedis();
    if (!redis) return { delivered: 0, retried: 0, dropped: 0, skipped: 'redis_unavailable' };
    const lock = await redis.set(LOCK_KEY, String(process.pid), 'EX', 25, 'NX');
    if (lock !== 'OK') return { delivered: 0, retried: 0, dropped: 0, skipped: 'locked' };

    const stats = { delivered: 0, retried: 0, dropped: 0 };
    try {
      const nowMs = this.now();
      const members = await redis.zrangebyscore(OUTBOX_KEY, '-inf', nowMs, 'LIMIT', 0, BATCH_SIZE);
      for (const member of members) {
        const raw = await redis.hget(ITEMS_KEY, member);
        if (!raw) {
          await redis.zrem(OUTBOX_KEY, member);
          continue;
        }
        const item = JSON.parse(raw);
        const result = await this.deliver(item);
        if (result.ok) {
          await redis.zrem(OUTBOX_KEY, member);
          await redis.hdel(ITEMS_KEY, member);
          stats.delivered += 1;
          continue;
        }

        item.attempts += 1;
        item.lastError = result.reason;
        if (result.permanent || nowMs - item.firstAt >= MAX_AGE_MS) {
          await redis.zrem(OUTBOX_KEY, member);
          await redis.hdel(ITEMS_KEY, member);
          await redis.lpush(DEAD_KEY, JSON.stringify({ ...item, droppedAt: new Date(nowMs).toISOString() }));
          await redis.ltrim(DEAD_KEY, 0, DEAD_LETTER_LIMIT - 1);
          stats.dropped += 1;
          logStructured('warn', 'Evento para os bots descartado', {
            service: 'bot-events',
            type: item.event.type,
            destination: item.destination,
            attempts: item.attempts,
            reason: result.reason,
          });
          continue;
        }
        await redis.hset(ITEMS_KEY, member, JSON.stringify(item));
        await redis.zadd(OUTBOX_KEY, nowMs + retryDelayMs(item.attempts), member);
        stats.retried += 1;
      }
    } finally {
      await redis.del(LOCK_KEY).catch(() => null);
    }
    return stats;
  }

  startDispatcher() {
    if (this.timer || !this.isEnabled()) return false;
    const intervalMs = Math.max(10000, Number.parseInt(process.env.BOT_EVENTS_DRAIN_INTERVAL_MS || '30000', 10) || 30000);
    this.timer = setInterval(() => {
      this.drain().catch((error) => {
        logStructured('warn', 'Falha ao entregar eventos para os bots', { service: 'bot-events', error: error.message });
      });
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    logStructured('info', 'Entrega de eventos para os bots iniciada', {
      service: 'bot-events',
      intervalMs,
      destinations: [...new Set(Object.values(ROUTES).flat())].filter((destination) => destinationConfig(destination)),
    });
    return true;
  }
}

module.exports = new BotEventService();
module.exports.BotEventService = BotEventService;
module.exports.ROUTES = ROUTES;
module.exports.signPayload = signPayload;
module.exports.sanitizeData = sanitizeData;
module.exports.retryDelayMs = retryDelayMs;
