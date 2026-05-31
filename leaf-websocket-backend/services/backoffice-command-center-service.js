const redisPool = require('../utils/redis-pool');
const modernMetricsService = require('./modern-metrics-service');
const opsOverviewService = require('./ops-overview-service');
const campaignCenterService = require('./campaign-center-service');
const healthCheckService = require('./health-check-service');
const WorkerHealthMonitor = require('../workers/health-monitor');
const { logStructured } = require('../utils/logger');

const DEFAULT_TTL_SECONDS = 20;
const MIN_TTL_SECONDS = 5;
const MAX_TTL_SECONDS = 120;

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toCents(value) {
  return Math.round(toNumber(value, 0) * 100);
}

function compactError(error) {
  const message = error?.message || String(error || 'erro desconhecido');
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function classifyStatus({ sources = [], health, workerHealth, workerLag, workerDLQ, opsOverview } = {}) {
  const criticalFailures = sources.filter((source) => source.critical && source.status === 'error').length;
  if (criticalFailures > 0) return 'unhealthy';

  const healthStatus = normalizeStatus(health?.status);
  if (['unhealthy', 'degraded', 'error'].includes(healthStatus)) return 'unhealthy';

  const workerStatus = normalizeStatus(workerHealth?.status);
  if (['unhealthy', 'error'].includes(workerStatus)) return 'unhealthy';

  const dlqSize = toNumber(workerDLQ?.dlqSize ?? workerDLQ?.size ?? workerDLQ?.count, 0);
  const lag = toNumber(workerLag?.lag?.lag ?? workerLag?.lag ?? workerLag, 0);
  const supportBreaches = toNumber(opsOverview?.supportQueue?.overdueAckCount, 0)
    + toNumber(opsOverview?.supportQueue?.overdueFirstResponseCount, 0);

  if (sources.some((source) => source.status === 'error')) return 'warning';
  if (['warning', 'warn', 'degraded'].includes(healthStatus)) return 'warning';
  if (['warning', 'warn', 'degraded'].includes(workerStatus)) return 'warning';
  if (dlqSize > 0 || lag > 100 || supportBreaches > 0) return 'warning';

  return 'healthy';
}

function buildSource(id, label, critical, settled, startedAt) {
  const durationMs = Math.max(0, Date.now() - startedAt);
  if (settled.status === 'fulfilled') {
    return {
      id,
      label,
      critical,
      status: 'ok',
      durationMs,
      error: null,
      value: settled.value
    };
  }

  return {
    id,
    label,
    critical,
    status: 'error',
    durationMs,
    error: compactError(settled.reason),
    value: null
  };
}

class BackofficeCommandCenterService {
  constructor({
    redis = redisPool,
    metrics = modernMetricsService,
    ops = opsOverviewService,
    campaignCenter = campaignCenterService,
    health = healthCheckService,
    workerHealthMonitor = new WorkerHealthMonitor()
  } = {}) {
    this.redisPool = redis;
    this.metrics = metrics;
    this.ops = ops;
    this.campaignCenter = campaignCenter;
    this.health = health;
    this.workerHealthMonitor = workerHealthMonitor;
    this.ttlSeconds = clampNumber(
      process.env.BACKOFFICE_COMMAND_CENTER_TTL_SECONDS,
      DEFAULT_TTL_SECONDS,
      MIN_TTL_SECONDS,
      MAX_TTL_SECONDS
    );
  }

  getRedis() {
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  buildCacheKey({ hours, period }) {
    return `backoffice:command-center:v1:h${hours}:p${period}`;
  }

  async readCache(cacheKey) {
    try {
      if (this.redisPool?.ensureConnection) {
        await this.redisPool.ensureConnection();
      }
      const redis = this.getRedis();
      if (!redis?.get) return null;
      const cached = await redis.get(cacheKey);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      logStructured('warn', 'Falha ao ler cache do command center', {
        service: 'backoffice-command-center',
        error: error.message
      });
      return null;
    }
  }

  async writeCache(cacheKey, payload) {
    try {
      if (this.redisPool?.ensureConnection) {
        await this.redisPool.ensureConnection();
      }
      const redis = this.getRedis();
      if (!redis?.set) return;
      await redis.set(cacheKey, JSON.stringify(payload), 'EX', this.ttlSeconds);
    } catch (error) {
      logStructured('warn', 'Falha ao escrever cache do command center', {
        service: 'backoffice-command-center',
        error: error.message
      });
    }
  }

  async collectSources({ hours, period }) {
    const definitions = [
      {
        id: 'health',
        label: 'Health rápido',
        critical: true,
        run: () => this.health.quickCheck()
      },
      {
        id: 'opsOverview',
        label: 'Resumo operacional',
        critical: true,
        run: () => this.ops.getOverview({ hours, autoEscalate: false })
      },
      {
        id: 'usersStatus',
        label: 'Usuários e motoristas',
        critical: true,
        run: () => this.metrics.getUsersStatusStats()
      },
      {
        id: 'ridesToday',
        label: 'Corridas do dia',
        critical: true,
        run: () => this.metrics.getRidesStats({ period })
      },
      {
        id: 'financialToday',
        label: 'GMV do dia',
        critical: true,
        run: () => this.metrics.getFinancialRidesStats({ period })
      },
      {
        id: 'operationalRevenue',
        label: 'Receita operacional',
        critical: true,
        run: () => this.metrics.getOperationalFeeStats({ period })
      },
      {
        id: 'campaignStats',
        label: 'Campanhas in-app',
        critical: false,
        run: () => this.campaignCenter.getStats({})
      },
      {
        id: 'workerHealth',
        label: 'Workers',
        critical: true,
        run: () => this.workerHealthMonitor.getHealth()
      },
      {
        id: 'workerLag',
        label: 'Lag dos workers',
        critical: true,
        run: () => this.workerHealthMonitor.getStreamLag()
      },
      {
        id: 'workerDLQ',
        label: 'DLQ dos workers',
        critical: true,
        run: () => this.workerHealthMonitor.getDLQSize().then((dlqSize) => ({ dlqSize }))
      }
    ];

    const startedAt = Date.now();
    const results = await Promise.allSettled(definitions.map((definition) => definition.run()));
    return definitions.map((definition, index) =>
      buildSource(definition.id, definition.label, definition.critical, results[index], startedAt)
    );
  }

  sourceValue(sources, id, fallback = null) {
    return sources.find((source) => source.id === id)?.value ?? fallback;
  }

  buildSnapshot({ sources, hours, period, generatedAt }) {
    const health = this.sourceValue(sources, 'health', null);
    const opsOverview = this.sourceValue(sources, 'opsOverview', {});
    const usersStatus = this.sourceValue(sources, 'usersStatus', {});
    const ridesToday = this.sourceValue(sources, 'ridesToday', {});
    const financialToday = this.sourceValue(sources, 'financialToday', {});
    const operationalRevenue = this.sourceValue(sources, 'operationalRevenue', {});
    const campaignStats = this.sourceValue(sources, 'campaignStats', {});
    const workerHealth = this.sourceValue(sources, 'workerHealth', null);
    const workerLag = this.sourceValue(sources, 'workerLag', null);
    const workerDLQ = this.sourceValue(sources, 'workerDLQ', null);

    const gmvCents = toCents(financialToday.totalValue);
    const grossRevenueCents = toCents(operationalRevenue.totalOperationalFee);
    const totalCustomers = toNumber(usersStatus?.customers?.total, 0);
    const completedRides = toNumber(financialToday.totalRides ?? ridesToday.completedToday, 0);
    const openSupportTickets = toNumber(opsOverview?.supportQueue?.totalOpenTickets, 0);

    const status = classifyStatus({
      sources,
      health,
      workerHealth,
      workerLag,
      workerDLQ,
      opsOverview
    });

    return {
      success: true,
      generatedAt,
      status,
      scope: {
        hours,
        period,
        ttlSeconds: this.ttlSeconds
      },
      services: {
        status,
        health,
        workerHealth,
        workerLag,
        workerDLQ,
        sources: sources.map(({ value, ...source }) => source)
      },
      dailyMetrics: {
        activeDrivers: toNumber(usersStatus?.drivers?.online, 0),
        activePassengers: toNumber(usersStatus?.customers?.online, 0),
        activeRides: toNumber(ridesToday.activeRides, 0),
        ridesToday: toNumber(ridesToday.totalRides ?? ridesToday.totalToday, 0),
        completedRidesToday: completedRides,
        gmvCents,
        grossRevenueCents,
        arpuBaseCents: totalCustomers > 0 ? Math.round(gmvCents / totalCustomers) : 0,
        averageRideTicketCents: completedRides > 0 ? Math.round(gmvCents / completedRides) : 0,
        totalDrivers: toNumber(usersStatus?.drivers?.total, 0),
        totalPassengers: totalCustomers,
        cancellationRate: toNumber(ridesToday.cancellationRate, 0)
      },
      support: {
        totalOpenTickets: openSupportTickets,
        backlogByPriority: opsOverview?.supportQueue?.backlogByPriority || { N1: 0, N2: 0, N3: 0 },
        overdueAckCount: toNumber(opsOverview?.supportQueue?.overdueAckCount, 0),
        overdueFirstResponseCount: toNumber(opsOverview?.supportQueue?.overdueFirstResponseCount, 0),
        ticketsWithoutOwner: toNumber(opsOverview?.supportQueue?.ticketsWithoutOwner, 0),
        medianFirstResponseMinutes: opsOverview?.supportQueue?.medianFirstResponseMinutes ?? null
      },
      campaigns: {
        total: toNumber(campaignStats.total, 0),
        active: toNumber(campaignStats.active, 0),
        paused: toNumber(campaignStats.paused, 0),
        impressions: toNumber(campaignStats.impressions, 0),
        clicks: toNumber(campaignStats.clicks, 0),
        conversions: toNumber(campaignStats.conversions, 0),
        ctr: toNumber(campaignStats.ctr, 0),
        campaignValueCents: toNumber(campaignStats.campaignValueCents, 0),
        effectiveCpmCents: toNumber(campaignStats.effectiveCpmCents, 0),
        effectiveCpcCents: toNumber(campaignStats.effectiveCpcCents, 0)
      },
      operations: {
        overview: opsOverview,
        incidents: opsOverview?.incidents || null,
        rideHealth: opsOverview?.rideHealth || null,
        disputes: opsOverview?.disputes || null,
        activePolicies: opsOverview?.activePolicies || []
      },
      costControls: {
        externalPaidApisCalled: false,
        paidApiFamilies: [],
        dashboardFanOutReduced: true,
        notes: [
          'Snapshot agregado no backend com cache Redis.',
          'Nao chama Google Places, Google Routes, Directions, Woovi ou provedores pagos.',
          'Pagina /maps segue separada porque carregar Google Maps JS pode gerar custo de mapa.'
        ]
      }
    };
  }

  async getSnapshot({ hours = 1, period = 'today', forceRefresh = false } = {}) {
    const safeHours = clampNumber(hours, 1, 1, 24);
    const safePeriod = ['today', 'week', 'month', '7d', '30d'].includes(String(period))
      ? String(period)
      : 'today';
    const cacheKey = this.buildCacheKey({ hours: safeHours, period: safePeriod });

    if (!forceRefresh) {
      const cached = await this.readCache(cacheKey);
      if (cached) {
        const generatedTs = Date.parse(cached.generatedAt || '');
        const ageSeconds = Number.isFinite(generatedTs)
          ? Math.max(0, Math.round((Date.now() - generatedTs) / 1000))
          : null;
        return {
          ...cached,
          cache: {
            status: 'HIT',
            key: cacheKey,
            ttlSeconds: this.ttlSeconds,
            ageSeconds
          }
        };
      }
    }

    const generatedAt = new Date().toISOString();
    const sources = await this.collectSources({ hours: safeHours, period: safePeriod });
    const snapshot = this.buildSnapshot({
      sources,
      hours: safeHours,
      period: safePeriod,
      generatedAt
    });

    await this.writeCache(cacheKey, snapshot);

    return {
      ...snapshot,
      cache: {
        status: forceRefresh ? 'BYPASS' : 'MISS',
        key: cacheKey,
        ttlSeconds: this.ttlSeconds,
        ageSeconds: 0
      }
    };
  }
}

const backofficeCommandCenterService = new BackofficeCommandCenterService();

module.exports = backofficeCommandCenterService;
module.exports.BackofficeCommandCenterService = BackofficeCommandCenterService;
