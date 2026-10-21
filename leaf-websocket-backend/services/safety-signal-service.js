// Sinais automáticos de segurança de conta: salto impossível de localização na corrida,
// GPS simulado no aparelho do motorista e reprovação na comparação facial do KYC.
//
// Este serviço só registra e avisa (bot de Segurança, evento safety.signal). Ele nunca
// bloqueia conta, nunca dispara KYC e nunca mexe na corrida: quem decide é o Izaak, pelo
// playbook de safety (docs/operations/LEAF_SAFETY_PLAYBOOK.md).
//
// - Cada sinal fica 30 dias no Redis (safety:signal:<id>), com índice geral e por motorista.
// - Sinais de usuários de teste (sandbox) são gravados para auditoria, mas não avisam os bots.
// - O evento leva só o id do sinal, o tipo, a corrida e um motivo curto; o bot busca o
//   resto em GET /api/ops/safety/signals/:id com o login dele.
// - Nunca lança: quem chama está no meio de uma corrida ou de uma verificação.
const crypto = require('crypto');
const { logStructured } = require('../utils/logger');

const SIGNAL_TTL_SECONDS = 30 * 24 * 60 * 60;
const INDEX_KEY = 'safety:signals';
const signalKey = (signalId) => `safety:signal:${signalId}`;
const driverIndexKey = (driverId) => `safety:driver:${driverId}:signals`;
const dedupeKeyFor = (type, key) => `safety:dedupe:${type}:${key}`;

const SIGNAL_TYPES = Object.freeze({
  location_jump: { severity: 'N2' },
  mock_location: { severity: 'N2' },
  kyc_biometric_rejected: { severity: 'N2' },
});

function trimmed(value, max = 120) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function parseRecord(raw) {
  if (!raw || !raw.signalId) return null;
  let details = {};
  try {
    details = raw.details ? JSON.parse(raw.details) : {};
  } catch (_error) {
    details = {};
  }
  return {
    signalId: raw.signalId,
    type: raw.type,
    severity: raw.severity,
    driverId: raw.driverId,
    bookingId: raw.bookingId || null,
    evidenceId: raw.evidenceId || null,
    sandbox: raw.sandbox === 'true',
    reason: raw.reason || null,
    details,
    createdAt: raw.createdAt,
  };
}

class SafetySignalService {
  // Redis e eventos carregam sob demanda: quem importa este serviço (KYC, por exemplo) não
  // abre conexão só por importar.
  constructor({ redis = null, events = null, now = () => Date.now() } = {}) {
    this.redisPool = redis;
    this.events = events;
    this.now = now;
  }

  async getRedis() {
    if (!this.redisPool) this.redisPool = require('../utils/redis-pool');
    if (this.redisPool?.ensureConnection) await this.redisPool.ensureConnection();
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  getEvents() {
    if (!this.events) this.events = require('./bot-event-service');
    return this.events;
  }

  async record({
    type,
    driverId,
    bookingId = null,
    evidenceId = null,
    reason = null,
    details = {},
    score = null,
    sandbox = false,
    dedupeKey = null,
    dedupeSeconds = 3600,
  } = {}) {
    try {
      const config = SIGNAL_TYPES[type];
      const safeDriverId = trimmed(driverId, 128);
      if (!config || !safeDriverId) return { recorded: false, skipped: 'invalid' };

      const redis = await this.getRedis();
      if (!redis) return { recorded: false, skipped: 'redis_unavailable' };

      if (dedupeKey) {
        const fresh = await redis.set(dedupeKeyFor(type, dedupeKey), '1', 'EX', dedupeSeconds, 'NX');
        if (fresh !== 'OK') return { recorded: false, skipped: 'duplicate' };
      }

      const nowMs = this.now();
      const signalId = `SIG-${nowMs}-${crypto.randomBytes(4).toString('hex')}`;
      const record = {
        signalId,
        type,
        severity: config.severity,
        driverId: safeDriverId,
        bookingId: trimmed(bookingId, 128) || '',
        evidenceId: trimmed(evidenceId, 128) || '',
        sandbox: String(sandbox === true),
        reason: trimmed(reason) || '',
        details: JSON.stringify(details || {}).slice(0, 2000),
        createdAt: new Date(nowMs).toISOString(),
      };

      await redis.hset(signalKey(signalId), record);
      await redis.expire(signalKey(signalId), SIGNAL_TTL_SECONDS);
      await redis.zadd(INDEX_KEY, nowMs, signalId);
      await redis.zremrangebyscore(INDEX_KEY, 0, nowMs - SIGNAL_TTL_SECONDS * 1000);
      await redis.zadd(driverIndexKey(safeDriverId), nowMs, signalId);
      await redis.expire(driverIndexKey(safeDriverId), SIGNAL_TTL_SECONDS);

      logStructured('warn', 'Sinal de segurança registrado', {
        service: 'safety-signal',
        signalId,
        type,
        bookingId: record.bookingId || null,
        sandbox: sandbox === true,
      });

      if (sandbox !== true) {
        await this.getEvents().emit('safety.signal', {
          signalId,
          category: type,
          bookingId: record.bookingId || undefined,
          reason: record.reason || undefined,
          score: Number.isFinite(Number(score)) ? Number(score) : undefined,
          source: 'safety',
        }, { dedupeKey: signalId, severity: config.severity });
      }
      return { recorded: true, signalId };
    } catch (error) {
      logStructured('warn', 'Falha ao registrar sinal de segurança', {
        service: 'safety-signal',
        type,
        error: error.message,
      });
      return { recorded: false, error: error.message };
    }
  }

  async get(signalId) {
    const redis = await this.getRedis();
    if (!redis) return null;
    const record = parseRecord(await redis.hgetall(signalKey(String(signalId || ''))));
    if (!record) return null;
    const driverSignalIds = await redis.zrevrange(driverIndexKey(record.driverId), 0, 19);
    const history = [];
    for (const id of driverSignalIds) {
      if (id === record.signalId) continue;
      const other = parseRecord(await redis.hgetall(signalKey(id)));
      if (other) history.push({ signalId: other.signalId, type: other.type, createdAt: other.createdAt });
    }
    return { ...record, driverSignalsLast30Days: driverSignalIds.length, history };
  }

  async list({ limit = 50 } = {}) {
    const redis = await this.getRedis();
    if (!redis) return [];
    const ids = await redis.zrevrange(INDEX_KEY, 0, Math.min(200, Math.max(1, Number(limit) || 50)) - 1);
    const out = [];
    for (const id of ids) {
      const record = parseRecord(await redis.hgetall(signalKey(id)));
      if (record) out.push(record);
    }
    return out;
  }
}

module.exports = new SafetySignalService();
module.exports.SafetySignalService = SafetySignalService;
module.exports.SIGNAL_TYPES = SIGNAL_TYPES;
