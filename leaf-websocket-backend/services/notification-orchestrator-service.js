const crypto = require('crypto');
const FCMService = require('./fcm-service');
const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');

const MATRIX_VERSION = '2026-06-06.leaf-notification-orchestration.v1';
const HISTORY_TTL_SECONDS = 35 * 24 * 60 * 60;
const DEFAULT_DEDUPE_SECONDS = 15 * 60;
const DEFAULT_RATE_LIMIT = {
  max: 4,
  windowSeconds: 60 * 60
};

const EVENT_MATRIX = Object.freeze({
  'account.signup_completed': {
    category: 'transactional',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Conta criada com sucesso',
    body: 'Tudo certo por aqui. Voce ja pode usar a Leaf.',
    priority: 'normal',
    channelId: 'account',
    dedupeWindowSeconds: 24 * 60 * 60,
    rateLimit: { max: 1, windowSeconds: 24 * 60 * 60 },
    quietHours: false
  },
  'driver.document_pending': {
    category: 'transactional',
    audience: ['driver'],
    channels: ['push', 'persisted'],
    title: 'Documento pendente',
    body: 'Precisamos de um ajuste no seu cadastro para continuar.',
    priority: 'high',
    channelId: 'driver_documents',
    dedupeWindowSeconds: 12 * 60 * 60,
    rateLimit: { max: 2, windowSeconds: 24 * 60 * 60 },
    quietHours: false
  },
  'driver.document_rejected': {
    category: 'transactional',
    audience: ['driver'],
    channels: ['push', 'persisted'],
    title: 'Cadastro precisa de revisao',
    body: 'Abra o app para ver o proximo passo do seu cadastro.',
    priority: 'high',
    channelId: 'driver_documents',
    dedupeWindowSeconds: 12 * 60 * 60,
    rateLimit: { max: 2, windowSeconds: 24 * 60 * 60 },
    quietHours: false
  },
  'driver.document_approved': {
    category: 'transactional',
    audience: ['driver'],
    channels: ['push', 'persisted'],
    title: 'Documento aprovado',
    body: 'Seu cadastro avancou. Falta pouco para dirigir com a Leaf.',
    priority: 'normal',
    channelId: 'driver_documents',
    dedupeWindowSeconds: 12 * 60 * 60,
    rateLimit: { max: 2, windowSeconds: 24 * 60 * 60 },
    quietHours: false
  },
  'driver.approved_to_drive': {
    category: 'transactional',
    audience: ['driver'],
    channels: ['push', 'persisted'],
    title: 'Voce foi liberado para dirigir',
    body: 'Quando quiser, abra o app e fique online.',
    priority: 'high',
    channelId: 'driver_account',
    dedupeWindowSeconds: 24 * 60 * 60,
    rateLimit: { max: 1, windowSeconds: 24 * 60 * 60 },
    quietHours: false
  },
  'ride.requested': {
    category: 'ride_lifecycle',
    audience: ['passenger'],
    channels: ['persisted'],
    title: 'Corrida solicitada',
    body: 'Estamos procurando um motorista para voce.',
    priority: 'normal',
    channelId: 'ride_status',
    dedupeWindowSeconds: 10 * 60,
    rateLimit: { max: 3, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'ride.offer_received': {
    category: 'ride_lifecycle',
    audience: ['driver'],
    channels: ['push', 'persisted'],
    title: 'Nova corrida disponivel',
    body: '{{pickupLabel}} para {{destinationLabel}}.',
    priority: 'high',
    channelId: 'driver_offers',
    dedupeWindowSeconds: 90,
    rateLimit: { max: 8, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'ride.accepted': {
    category: 'ride_lifecycle',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Corrida aceita',
    body: '{{driverName}} esta a caminho.',
    priority: 'high',
    channelId: 'ride_status',
    dedupeWindowSeconds: 10 * 60,
    rateLimit: { max: 4, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'ride.driver_arrived': {
    category: 'ride_lifecycle',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: '{{driverFirstName}} chegou',
    body: 'Siga para o ponto de embarque.',
    priority: 'high',
    channelId: 'ride_status',
    dedupeWindowSeconds: 10 * 60,
    rateLimit: { max: 4, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'ride.started': {
    category: 'ride_lifecycle',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Viagem iniciada',
    body: 'A caminho de {{destinationLabel}}.',
    priority: 'normal',
    channelId: 'ride_status',
    dedupeWindowSeconds: 10 * 60,
    rateLimit: { max: 4, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'ride.completed': {
    category: 'ride_lifecycle',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Viagem finalizada',
    body: 'Obrigado por viajar com a Leaf.',
    priority: 'normal',
    channelId: 'ride_status',
    dedupeWindowSeconds: 30 * 60,
    rateLimit: { max: 4, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'payment.pix_created': {
    category: 'payment',
    audience: ['passenger'],
    channels: ['persisted'],
    title: 'Pix criado',
    body: 'Finalize o pagamento para confirmar sua corrida.',
    priority: 'normal',
    channelId: 'payments',
    dedupeWindowSeconds: 10 * 60,
    rateLimit: { max: 3, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'payment.pix_approved': {
    category: 'payment',
    audience: ['passenger'],
    channels: ['push', 'persisted'],
    title: 'Pagamento confirmado',
    body: 'Recebemos seu Pix. Vamos seguir com sua corrida.',
    priority: 'high',
    channelId: 'payments',
    dedupeWindowSeconds: 30 * 60,
    rateLimit: { max: 3, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'payment.pix_failed': {
    category: 'payment',
    audience: ['passenger'],
    channels: ['push', 'persisted'],
    title: 'Pagamento nao concluido',
    body: 'Nao conseguimos confirmar o Pix. Tente novamente no app.',
    priority: 'high',
    channelId: 'payments',
    dedupeWindowSeconds: 10 * 60,
    rateLimit: { max: 3, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'payment.pix_expired': {
    category: 'payment',
    audience: ['passenger'],
    channels: ['push', 'persisted'],
    title: 'Pix expirou',
    body: 'Gere um novo pagamento para continuar.',
    priority: 'normal',
    channelId: 'payments',
    dedupeWindowSeconds: 10 * 60,
    rateLimit: { max: 3, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'receipt.available': {
    category: 'transactional',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Recibo disponivel',
    body: 'O resumo da sua viagem ja esta no app.',
    priority: 'normal',
    channelId: 'receipts',
    dedupeWindowSeconds: 24 * 60 * 60,
    rateLimit: { max: 2, windowSeconds: 24 * 60 * 60 },
    quietHours: true
  },
  'support.chat_message_received': {
    category: 'support',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Nova mensagem da Leaf',
    body: 'Nossa equipe respondeu sua conversa.',
    priority: 'high',
    channelId: 'support',
    dedupeWindowSeconds: 60,
    rateLimit: { max: 8, windowSeconds: 60 * 60 },
    quietHours: false
  },
  'support.ticket_updated': {
    category: 'support',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Chamado atualizado',
    body: 'Tem novidade no seu atendimento.',
    priority: 'normal',
    channelId: 'support',
    dedupeWindowSeconds: 5 * 60,
    rateLimit: { max: 6, windowSeconds: 60 * 60 },
    quietHours: true
  },
  'support.ticket_resolved': {
    category: 'support',
    audience: ['passenger', 'driver'],
    channels: ['push', 'persisted'],
    title: 'Chamado resolvido',
    body: 'Finalizamos seu atendimento. Se precisar, seguimos por aqui.',
    priority: 'normal',
    channelId: 'support',
    dedupeWindowSeconds: 24 * 60 * 60,
    rateLimit: { max: 2, windowSeconds: 24 * 60 * 60 },
    quietHours: true
  },
  'campaign.available': {
    category: 'marketing',
    audience: ['passenger', 'driver'],
    channels: ['persisted'],
    title: '{{campaignTitle}}',
    body: '{{campaignBody}}',
    priority: 'normal',
    channelId: 'campaigns',
    dedupeWindowSeconds: 24 * 60 * 60,
    rateLimit: { max: 2, windowSeconds: 24 * 60 * 60 },
    quietHours: true,
    requiresMarketingOptIn: true
  },
  'smart_push.driver_demand_recommendation': {
    category: 'smart_push',
    audience: ['driver'],
    channels: ['dry_run'],
    title: 'Boa hora para ficar online',
    body: 'A demanda esta subindo perto de voce.',
    priority: 'normal',
    channelId: 'smart_push',
    dedupeWindowSeconds: 6 * 60 * 60,
    rateLimit: { max: 1, windowSeconds: 24 * 60 * 60 },
    quietHours: true,
    requiresMarketingOptIn: true,
    dryRunOnly: true
  }
});

function getDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function toDataValue(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function stableHash(payload) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(payload || {}))
    .digest('hex')
    .slice(0, 20);
}

function interpolate(template, context = {}) {
  return normalizeText(template).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = key.split('.').reduce((current, part) => current?.[part], context);
    return normalizeText(value) || '';
  }).replace(/\s{2,}/g, ' ').trim();
}

function normalizeUserType(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === 'customer' || raw === 'user') return 'passenger';
  if (raw === 'passenger' || raw === 'driver') return raw;
  return raw || 'passenger';
}

function isWithinQuietHours(now = new Date(), quietHours = {}) {
  const start = Number.isFinite(Number(quietHours.startHour)) ? Number(quietHours.startHour) : 22;
  const end = Number.isFinite(Number(quietHours.endHour)) ? Number(quietHours.endHour) : 7;
  const hour = now.getHours();
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

class NotificationOrchestratorService {
  constructor(options = {}) {
    this.redis = options.redis || null;
    this.fcmService = options.fcmService || new FCMService(options.redis || null);
    this.now = options.now || (() => new Date());
    this.matrix = options.matrix || EVENT_MATRIX;
    this.smartPushMode = options.smartPushMode || process.env.SMART_PUSH_MODE || 'disabled';
  }

  setRedis(redis) {
    this.redis = redis;
    if (this.fcmService?.setRedis) {
      this.fcmService.setRedis(redis);
    }
  }

  async getRedisClient() {
    if (!this.redis) {
      try {
        this.setRedis(redisPool.getConnection());
      } catch (_error) {}
    }
    if (!this.redis) return null;
    if (typeof this.redis.status !== 'undefined' && this.redis.status !== 'ready' && this.redis.status !== 'connect') {
      if (typeof this.redis.connect === 'function') {
        try {
          await this.redis.connect();
        } catch (error) {
          const message = String(error?.message || '');
          if (!message.includes('already connecting') && !message.includes('already connected')) {
            throw error;
          }
        }
      }
    }
    return this.redis;
  }

  getMatrix() {
    return {
      version: MATRIX_VERSION,
      generatedAt: this.now().toISOString(),
      events: Object.fromEntries(
        Object.entries(this.matrix).map(([eventType, config]) => [eventType, { ...config }])
      )
    };
  }

  getEventConfig(eventType) {
    return this.matrix[normalizeText(eventType)] || null;
  }

  buildNotification(eventType, context = {}) {
    const config = this.getEventConfig(eventType);
    if (!config) {
      const error = new Error(`Evento de notificacao nao mapeado: ${eventType}`);
      error.code = 'NOTIFICATION_EVENT_NOT_MAPPED';
      throw error;
    }
    return {
      title: interpolate(config.title, context),
      body: interpolate(config.body, context),
      priority: config.priority || 'normal',
      channelId: config.channelId || 'default',
      badge: Number.isFinite(Number(context.badge)) ? Number(context.badge) : 1,
      data: Object.fromEntries(
        Object.entries({
          type: 'leaf_orchestrated_notification',
          notificationType: 'leaf_orchestrated_notification',
          eventType,
          category: config.category,
          bookingId: context.bookingId,
          rideId: context.rideId,
          paymentId: context.paymentId,
          ticketId: context.ticketId,
          campaignId: context.campaignId,
          screen: context.screen,
          routeName: context.routeName,
          createdAt: this.now().toISOString()
        }).map(([key, value]) => [key, toDataValue(value)])
      )
    };
  }

  buildIdempotencyKey(eventType, userId, context = {}, explicitKey = null) {
    const source = explicitKey || context.idempotencyKey || context.bookingId || context.rideId
      || context.paymentId || context.ticketId || context.campaignId || stableHash(context);
    return ['notification', eventType, userId, normalizeText(source)].join(':');
  }

  shouldSuppressForPreferences(config, preferences = {}) {
    if (config.requiresMarketingOptIn && preferences.marketingOptIn !== true) {
      return { suppressed: true, reason: 'marketing_opt_out' };
    }
    if (preferences.pushEnabled === false && config.channels.includes('push')) {
      return { suppressed: true, reason: 'push_opt_out' };
    }
    if (config.quietHours && isWithinQuietHours(this.now(), preferences.quietHours)) {
      return { suppressed: true, reason: 'quiet_hours' };
    }
    return { suppressed: false, reason: null };
  }

  async claimDedupe(redis, config, eventType, userId, idempotencyKey) {
    if (!redis?.set) return { claimed: true, key: null };
    const key = `notification_orchestrator:dedupe:${stableHash({ eventType, userId, idempotencyKey })}`;
    const ttl = Number(config.dedupeWindowSeconds || DEFAULT_DEDUPE_SECONDS);
    const result = await redis.set(key, '1', 'NX', 'EX', ttl);
    return { claimed: result === 'OK', key };
  }

  async checkRateLimit(redis, config, eventType, userId) {
    const limit = config.rateLimit || DEFAULT_RATE_LIMIT;
    if (!redis?.incr) return { allowed: true, count: 1, key: null };
    const key = `notification_orchestrator:rate:${getDayKey(this.now())}:${eventType}:${userId}`;
    const count = await redis.incr(key);
    if (count === 1 && typeof redis.expire === 'function') {
      await redis.expire(key, Number(limit.windowSeconds || DEFAULT_RATE_LIMIT.windowSeconds));
    }
    return { allowed: count <= Number(limit.max || DEFAULT_RATE_LIMIT.max), count, key };
  }

  async incrementMetric(redis, field, amount = 1) {
    if (!redis?.hincrby) return;
    const key = `notification_orchestrator_metrics:${getDayKey(this.now())}`;
    await redis.hincrby(key, field, amount);
    if (typeof redis.expire === 'function') {
      await redis.expire(key, HISTORY_TTL_SECONDS);
    }
  }

  async persistHistory(redis, record = {}) {
    if (!redis) return { persisted: false };
    const recordId = record.id || `notif_${Date.now()}_${stableHash(record)}`;
    const payload = {
      ...record,
      id: recordId,
      updatedAt: this.now().toISOString()
    };
    if (typeof redis.hset === 'function') {
      await redis.hset(`notification_orchestrator:history:${recordId}`, payload);
      if (typeof redis.expire === 'function') {
        await redis.expire(`notification_orchestrator:history:${recordId}`, HISTORY_TTL_SECONDS);
      }
    }
    if (typeof redis.lpush === 'function') {
      await redis.lpush(`notification_orchestrator:history:${getDayKey(this.now())}`, JSON.stringify(payload));
      if (typeof redis.ltrim === 'function') {
        await redis.ltrim(`notification_orchestrator:history:${getDayKey(this.now())}`, 0, 499);
      }
      if (typeof redis.expire === 'function') {
        await redis.expire(`notification_orchestrator:history:${getDayKey(this.now())}`, HISTORY_TTL_SECONDS);
      }
    }
    return { persisted: true, recordId };
  }

  async dispatchEvent({ eventType, userId, userType, context = {}, preferences = {}, idempotencyKey = null, dryRun = false } = {}) {
    const normalizedEventType = normalizeText(eventType);
    const normalizedUserId = normalizeText(userId);
    const normalizedUserType = normalizeUserType(userType || context.userType);
    const config = this.getEventConfig(normalizedEventType);
    const nowIso = this.now().toISOString();

    if (!config) {
      return { success: false, status: 'rejected', reason: 'event_not_mapped' };
    }
    if (!normalizedUserId) {
      return { success: false, status: 'rejected', reason: 'user_required' };
    }
    if (config.audience.length > 0 && !config.audience.includes(normalizedUserType)) {
      return { success: false, status: 'suppressed', reason: 'audience_mismatch' };
    }

    const redis = await this.getRedisClient();
    const resolvedIdempotencyKey = this.buildIdempotencyKey(
      normalizedEventType,
      normalizedUserId,
      context,
      idempotencyKey
    );
    const notification = this.buildNotification(normalizedEventType, {
      ...context,
      userType: normalizedUserType
    });
    const record = {
      id: `orch_${stableHash({ normalizedEventType, normalizedUserId, resolvedIdempotencyKey })}`,
      eventType: normalizedEventType,
      userId: normalizedUserId,
      userType: normalizedUserType,
      category: config.category,
      channels: config.channels,
      idempotencyKey: resolvedIdempotencyKey,
      title: notification.title,
      body: notification.body,
      status: 'queued',
      createdAt: nowIso
    };

    const preferenceSuppression = this.shouldSuppressForPreferences(config, preferences);
    if (preferenceSuppression.suppressed) {
      await this.incrementMetric(redis, 'suppressed', 1);
      await this.incrementMetric(redis, `suppressed:${preferenceSuppression.reason}`, 1);
      await this.persistHistory(redis, { ...record, status: 'suppressed', reason: preferenceSuppression.reason });
      return { success: true, status: 'suppressed', reason: preferenceSuppression.reason, notification };
    }

    const dedupe = await this.claimDedupe(redis, config, normalizedEventType, normalizedUserId, resolvedIdempotencyKey);
    if (!dedupe.claimed) {
      await this.incrementMetric(redis, 'suppressed', 1);
      await this.incrementMetric(redis, 'suppressed:duplicate', 1);
      await this.persistHistory(redis, { ...record, status: 'suppressed', reason: 'duplicate' });
      return { success: true, status: 'suppressed', reason: 'duplicate', notification };
    }

    const rate = await this.checkRateLimit(redis, config, normalizedEventType, normalizedUserId);
    if (!rate.allowed) {
      await this.incrementMetric(redis, 'suppressed', 1);
      await this.incrementMetric(redis, 'suppressed:rate_limited', 1);
      await this.persistHistory(redis, { ...record, status: 'suppressed', reason: 'rate_limited' });
      return { success: true, status: 'suppressed', reason: 'rate_limited', notification };
    }

    const forcedDryRun = dryRun === true || config.dryRunOnly === true || config.channels.includes('dry_run');
    if (forcedDryRun || !config.channels.includes('push')) {
      const status = forcedDryRun ? 'dry_run' : 'persisted_only';
      await this.incrementMetric(redis, status, 1);
      await this.incrementMetric(redis, `event:${normalizedEventType}:${status}`, 1);
      await this.persistHistory(redis, { ...record, status, notification });
      return { success: true, status, notification };
    }

    let push = { success: false, error: 'push_not_attempted' };
    try {
      if (typeof this.fcmService.initialize === 'function') {
        await this.fcmService.initialize();
      }
      push = await this.fcmService.sendNotificationToUser(normalizedUserId, notification);
    } catch (error) {
      push = { success: false, error: error.message };
    }

    const status = push.success ? 'sent' : 'failed';
    await this.incrementMetric(redis, status, 1);
    await this.incrementMetric(redis, `event:${normalizedEventType}:${status}`, 1);
    await this.persistHistory(redis, { ...record, status, notification, push });

    logStructured(push.success ? 'info' : 'warn', 'Notification orchestrator dispatch', {
      service: 'notification-orchestrator',
      eventType: normalizedEventType,
      userId: normalizedUserId,
      userType: normalizedUserType,
      status,
      pushSuccess: push.success === true
    });

    return {
      success: push.success === true,
      status,
      notification,
      push
    };
  }

  async previewSmartPushRecommendation({ userId, userType = 'driver', recommendation = {}, preferences = {} } = {}) {
    const context = {
      score: recommendation.score,
      reason: recommendation.reason,
      window: recommendation.window,
      campaignId: recommendation.campaignId,
      userType
    };
    const mode = normalizeText(recommendation.mode || this.smartPushMode).toLowerCase();
    const dryRun = mode !== 'enabled';
    return this.dispatchEvent({
      eventType: 'smart_push.driver_demand_recommendation',
      userId,
      userType,
      context,
      preferences,
      idempotencyKey: recommendation.idempotencyKey || recommendation.campaignId || stableHash(recommendation),
      dryRun
    });
  }

  async getStats(date = getDayKey(this.now())) {
    const redis = await this.getRedisClient();
    const key = `notification_orchestrator_metrics:${date}`;
    const raw = redis?.hgetall ? await redis.hgetall(key) : {};
    const metrics = Object.fromEntries(
      Object.entries(raw || {}).map(([metric, value]) => [metric, Number(value) || 0])
    );
    return {
      date,
      version: MATRIX_VERSION,
      metrics,
      smartPushMode: this.smartPushMode
    };
  }
}

module.exports = NotificationOrchestratorService;
module.exports.EVENT_MATRIX = EVENT_MATRIX;
module.exports.MATRIX_VERSION = MATRIX_VERSION;
module.exports.interpolate = interpolate;
module.exports.normalizeUserType = normalizeUserType;
