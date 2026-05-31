const { logStructured } = require('../utils/logger');

const DEFAULT_DAILY_BUDGET_READS = 150000;
const DEFAULT_WARNING_RATIO = 0.5;
const DEFAULT_DANGER_RATIO = 0.8;
const DEFAULT_LIMIT_RATIO = 1;
const DEFAULT_READ_PRICE_USD_PER_100K = 0.06;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function secondsUntilTomorrow(date = new Date()) {
  const next = new Date(date);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((next.getTime() - date.getTime()) / 1000));
}

function parseLimit(value, fallback = 50, max = 500) {
  return clampNumber(value, fallback, 1, max);
}

class BackofficeCostGuardService {
  constructor({ redis = null } = {}) {
    this.redisPool = redis;
    this.dailyBudgetReads = clampNumber(
      process.env.BACKOFFICE_FIRESTORE_DAILY_READ_BUDGET,
      DEFAULT_DAILY_BUDGET_READS,
      1000,
      10000000
    );
    this.warningRatio = toNumber(process.env.BACKOFFICE_FIRESTORE_WARNING_RATIO, DEFAULT_WARNING_RATIO);
    this.dangerRatio = toNumber(process.env.BACKOFFICE_FIRESTORE_DANGER_RATIO, DEFAULT_DANGER_RATIO);
    this.limitRatio = toNumber(process.env.BACKOFFICE_FIRESTORE_LIMIT_RATIO, DEFAULT_LIMIT_RATIO);
    this.readPriceUsdPer100k = toNumber(
      process.env.BACKOFFICE_FIRESTORE_READ_PRICE_USD_PER_100K,
      DEFAULT_READ_PRICE_USD_PER_100K
    );
  }

  resolveRedisPool() {
    if (this.redisPool) return this.redisPool;

    try {
      // Redis Pool initializes a connection on import. Keep this lazy so route
      // unit tests and read-only dashboard rendering do not depend on Redis.
      this.redisPool = require('../utils/redis-pool');
    } catch (error) {
      logStructured('warn', 'Cost guard sem Redis disponivel', {
        service: 'backoffice-cost-guard',
        error: error.message
      });
      this.redisPool = null;
    }

    return this.redisPool;
  }

  getRedis() {
    const redisPool = this.resolveRedisPool();
    return redisPool?.getConnection ? redisPool.getConnection() : null;
  }

  dailyKey(date = new Date()) {
    return `backoffice:cost_guard:firestore_reads:${todayKey(date)}`;
  }

  routeKey(date = new Date()) {
    return `backoffice:cost_guard:firestore_reads_by_route:${todayKey(date)}`;
  }

  estimateRouteReadCost(routeKey, context = {}) {
    const limit = parseLimit(context.limit ?? context.query?.limit, 50, 1000);
    const offset = clampNumber(context.offset ?? context.query?.offset, 0, 0, 100000);
    const cacheStatus = String(context.cacheStatus || '').toUpperCase();

    const estimates = {
      'ops.commandCenter': cacheStatus === 'HIT' ? 0 : 360,
      'support.queue.summary': 80,
      'support.queue.backlog': 25 + limit + offset,
      'support.chat.inbox': context.includeClosed ? 30 + limit : 5,
      'support.chat.history': context.includeArchived ? limit : 0,
      'drivers.documents.reviewQueue': 40 + limit,
      'campaigns.list': 120,
      'campaigns.get': 1,
      'campaigns.stats': 60,
      'campaigns.commercialReport': 90,
      'campaigns.slots': 0,
      'campaigns.previewEligibility': 30,
      'financial.reconciliation.reports': 20 + limit,
      'financial.reconciliation.ride': 140,
      'financial.reconciliation.run': 200 + limit,
      'audit.logs': 10 + limit,
      'audit.stats': 1000
    };

    return Math.max(0, Math.round(estimates[routeKey] ?? toNumber(context.estimatedReads, 0)));
  }

  classifyUsage(reads = 0) {
    const ratio = this.dailyBudgetReads > 0 ? reads / this.dailyBudgetReads : 0;
    if (ratio >= this.limitRatio) return 'limit';
    if (ratio >= this.dangerRatio) return 'danger';
    if (ratio >= this.warningRatio) return 'warning';
    return 'ok';
  }

  buildPayload({ routeKey, estimatedReads, currentReads, tracking = 'redis', error = null } = {}) {
    const safeEstimatedReads = Math.max(0, Math.round(toNumber(estimatedReads, 0)));
    const safeCurrentReads = Math.max(0, Math.round(toNumber(currentReads, safeEstimatedReads)));
    const budgetUsageRatio = this.dailyBudgetReads > 0 ? safeCurrentReads / this.dailyBudgetReads : 0;
    const estimatedUsd = (safeEstimatedReads / 100000) * this.readPriceUsdPer100k;
    const dailyEstimatedUsd = (safeCurrentReads / 100000) * this.readPriceUsdPer100k;

    return {
      routeKey,
      estimatedFirestoreReads: safeEstimatedReads,
      dailyEstimatedFirestoreReads: safeCurrentReads,
      dailyBudgetReads: this.dailyBudgetReads,
      budgetUsageRatio,
      budgetUsagePercent: Number((budgetUsageRatio * 100).toFixed(2)),
      budgetStatus: this.classifyUsage(safeCurrentReads),
      estimatedUsd: Number(estimatedUsd.toFixed(6)),
      dailyEstimatedUsd: Number(dailyEstimatedUsd.toFixed(6)),
      readPriceUsdPer100k: this.readPriceUsdPer100k,
      tracking,
      error
    };
  }

  async getDailyUsageSnapshot() {
    try {
      const redisPool = this.resolveRedisPool();
      if (redisPool?.ensureConnection) {
        await redisPool.ensureConnection();
      }
      const redis = this.getRedis();
      if (!redis?.get) {
        return this.buildPayload({ routeKey: 'summary', estimatedReads: 0, currentReads: 0, tracking: 'unavailable' });
      }

      const [current, byRoute] = await Promise.all([
        redis.get(this.dailyKey()),
        redis.hgetall ? redis.hgetall(this.routeKey()) : Promise.resolve({})
      ]);

      return {
        ...this.buildPayload({
          routeKey: 'summary',
          estimatedReads: 0,
          currentReads: toNumber(current, 0),
          tracking: 'redis'
        }),
        routes: byRoute || {}
      };
    } catch (error) {
      logStructured('warn', 'Falha ao ler cost guard do backoffice', {
        service: 'backoffice-cost-guard',
        error: error.message
      });
      return this.buildPayload({
        routeKey: 'summary',
        estimatedReads: 0,
        currentReads: 0,
        tracking: 'error',
        error: error.message
      });
    }
  }

  async recordEndpointReadEstimate(routeKey, context = {}) {
    const estimatedReads = this.estimateRouteReadCost(routeKey, context);

    try {
      const redisPool = this.resolveRedisPool();
      if (redisPool?.ensureConnection) {
        await redisPool.ensureConnection();
      }
      const redis = this.getRedis();
      if (!redis?.incrby) {
        return this.buildPayload({
          routeKey,
          estimatedReads,
          currentReads: estimatedReads,
          tracking: 'unavailable'
        });
      }

      const dailyKey = this.dailyKey();
      const routesKey = this.routeKey();
      const ttl = secondsUntilTomorrow();
      const currentReads = await redis.incrby(dailyKey, estimatedReads);
      if (redis.expire) {
        await redis.expire(dailyKey, ttl);
      }
      if (redis.hincrby) {
        await redis.hincrby(routesKey, routeKey, estimatedReads);
        if (redis.expire) await redis.expire(routesKey, ttl);
      }

      return this.buildPayload({
        routeKey,
        estimatedReads,
        currentReads,
        tracking: 'redis'
      });
    } catch (error) {
      logStructured('warn', 'Falha ao registrar cost guard do backoffice', {
        service: 'backoffice-cost-guard',
        routeKey,
        estimatedReads,
        error: error.message
      });
      return this.buildPayload({
        routeKey,
        estimatedReads,
        currentReads: estimatedReads,
        tracking: 'error',
        error: error.message
      });
    }
  }

  setHeaders(res, payload = {}) {
    if (!res?.set) return;
    res.set('X-Leaf-Estimated-Firestore-Reads', String(payload.estimatedFirestoreReads ?? 0));
    res.set('X-Leaf-Firestore-Read-Budget-Status', String(payload.budgetStatus || 'unknown'));
    res.set('X-Leaf-Firestore-Read-Budget-Usage', String(payload.budgetUsagePercent ?? 0));
  }

  async attachToResponse(res, routeKey, responsePayload = {}, context = {}) {
    const costGuard = await this.recordEndpointReadEstimate(routeKey, context);
    this.setHeaders(res, costGuard);
    return {
      ...responsePayload,
      costGuard
    };
  }
}

const backofficeCostGuardService = new BackofficeCostGuardService();

module.exports = backofficeCostGuardService;
module.exports.BackofficeCostGuardService = BackofficeCostGuardService;
