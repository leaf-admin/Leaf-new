const redisPool = require('../utils/redis-pool');
const modernMetricsService = require('./modern-metrics-service');
const opsOverviewService = require('./ops-overview-service');
const campaignCenterService = require('./campaign-center-service');
const healthCheckService = require('./health-check-service');
const driverApplicationService = require('./driver-application-service');
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

function sourceStatus(sources, id, fallback = 'unknown') {
  return sources.find((source) => source.id === id)?.status || fallback;
}

function buildDomainHealth({ sources, status, campaignStats, driverOnboardingSummary, opsOverview, workerDLQ, workerLag }) {
  const dlqSize = toNumber(workerDLQ?.dlqSize ?? workerDLQ?.size ?? workerDLQ?.count, 0);
  const lag = toNumber(workerLag?.lag?.lag ?? workerLag?.lag ?? workerLag, 0);
  const supportBreaches = toNumber(opsOverview?.supportQueue?.overdueAckCount, 0)
    + toNumber(opsOverview?.supportQueue?.overdueFirstResponseCount, 0);
  const pendingDocuments = toNumber(driverOnboardingSummary?.byStatus?.pending, 0);

  const domains = [
    {
      id: 'api',
      label: 'API e dashboard',
      status: sourceStatus(sources, 'health') === 'ok' ? status : 'unhealthy',
      source: 'health',
      action: sourceStatus(sources, 'health') === 'ok'
        ? 'Manter monitoramento normal.'
        : 'Abrir health check e revisar API antes da operação.'
    },
    {
      id: 'socket',
      label: 'Socket e tempo real',
      status: sourceStatus(sources, 'workerHealth') === 'ok' && lag <= 100 ? 'healthy' : 'warning',
      source: 'workerHealth',
      action: lag > 100
        ? 'Checar lag dos workers e consumidores ativos.'
        : 'Conexões em acompanhamento pelo snapshot.'
    },
    {
      id: 'support',
      label: 'Suporte',
      status: supportBreaches > 0 ? 'warning' : 'healthy',
      source: 'opsOverview',
      action: supportBreaches > 0
        ? 'Priorizar tickets fora do SLA.'
        : 'Fila dentro do esperado.'
    },
    {
      id: 'campaigns',
      label: 'Campanhas',
      status: sourceStatus(sources, 'campaignStats') === 'ok' ? 'healthy' : 'warning',
      source: 'campaignStats',
      action: toNumber(campaignStats?.active, 0) > 0
        ? 'Campanhas ativas com leitura agregada.'
        : 'Validar se existe campanha ativa para as superfícies principais.'
    },
    {
      id: 'driver-onboarding',
      label: 'Cadastro motorista',
      status: pendingDocuments > 0 ? 'warning' : 'healthy',
      source: 'driverOnboarding',
      action: pendingDocuments > 0
        ? 'Revisar documentos pendentes na fila de motoristas.'
        : 'Sem pendência crítica de documentos.'
    },
    {
      id: 'finance',
      label: 'Financeiro',
      status: sourceStatus(sources, 'financialToday') === 'ok' && sourceStatus(sources, 'operationalRevenue') === 'ok'
        ? 'healthy'
        : 'warning',
      source: 'financialToday',
      action: 'Conferir holding, split e divergências na reconciliação.'
    },
    {
      id: 'workers',
      label: 'Workers e filas',
      status: dlqSize > 0 || lag > 100 ? 'warning' : 'healthy',
      source: 'workerDLQ',
      action: dlqSize > 0
        ? 'Inspecionar DLQ antes de novos canaries.'
        : 'Sem DLQ crítica no snapshot.'
    }
  ];

  return domains.map((domain) => ({
    ...domain,
    lastCheckedAt: new Date().toISOString()
  }));
}

function buildActionItems({ status, sources, opsOverview, campaignStats, driverOnboardingSummary, workerDLQ, workerLag }) {
  const items = [];
  const dlqSize = toNumber(workerDLQ?.dlqSize ?? workerDLQ?.size ?? workerDLQ?.count, 0);
  const lag = toNumber(workerLag?.lag?.lag ?? workerLag?.lag ?? workerLag, 0);
  const supportBreaches = toNumber(opsOverview?.supportQueue?.overdueAckCount, 0)
    + toNumber(opsOverview?.supportQueue?.overdueFirstResponseCount, 0);
  const ticketsWithoutOwner = toNumber(opsOverview?.supportQueue?.ticketsWithoutOwner, 0);
  const pendingDocuments = toNumber(driverOnboardingSummary?.byStatus?.pending, 0);

  for (const source of sources) {
    if (source.status !== 'error') continue;
    items.push({
      id: `source-${source.id}`,
      priority: source.critical ? 'alta' : 'media',
      title: `${source.label} falhou`,
      description: source.error || 'Fonte sem resposta no snapshot.',
      href: '/observability'
    });
  }

  if (supportBreaches > 0) {
    items.push({
      id: 'support-sla',
      priority: 'alta',
      title: 'Suporte fora do SLA',
      description: `${supportBreaches} item(ns) precisam de resposta agora.`,
      href: '/support'
    });
  }

  if (ticketsWithoutOwner > 0) {
    items.push({
      id: 'support-owner',
      priority: 'media',
      title: 'Tickets sem responsável',
      description: `${ticketsWithoutOwner} ticket(s) ainda sem dono.`,
      href: '/support'
    });
  }

  if (pendingDocuments > 0) {
    items.push({
      id: 'driver-docs',
      priority: 'media',
      title: 'Documentos aguardando revisão',
      description: `${pendingDocuments} documento(s) de motorista pendente(s).`,
      href: '/drivers/review-queue'
    });
  }

  if (toNumber(campaignStats?.active, 0) === 0) {
    items.push({
      id: 'campaigns-empty',
      priority: 'baixa',
      title: 'Sem campanha ativa',
      description: 'Confira se passenger_home e driver_home devem ter banner publicado hoje.',
      href: '/campaign-center'
    });
  }

  if (dlqSize > 0 || lag > 100) {
    items.push({
      id: 'workers-attention',
      priority: dlqSize > 0 ? 'alta' : 'media',
      title: 'Workers pedem atenção',
      description: dlqSize > 0 ? `${dlqSize} item(ns) em DLQ.` : `Lag em ${lag}.`,
      href: '/observability'
    });
  }

  if (!items.length) {
    items.push({
      id: 'operation-ok',
      priority: 'baixa',
      title: status === 'healthy' ? 'Operação estável' : 'Operação em acompanhamento',
      description: 'Nenhuma ação urgente apareceu no snapshot cacheado.',
      href: '/dashboard'
    });
  }

  return items.slice(0, 8);
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
    driverApplications = driverApplicationService,
    workerHealthMonitor = new WorkerHealthMonitor()
  } = {}) {
    this.redisPool = redis;
    this.metrics = metrics;
    this.ops = ops;
    this.campaignCenter = campaignCenter;
    this.health = health;
    this.driverApplications = driverApplications;
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
        id: 'driverOnboarding',
        label: 'Cadastro de motoristas',
        critical: false,
        run: () => this.driverApplications.getReviewQueueSummary()
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
    const driverOnboardingQueue = this.sourceValue(sources, 'driverOnboarding', {});
    const workerHealth = this.sourceValue(sources, 'workerHealth', null);
    const workerLag = this.sourceValue(sources, 'workerLag', null);
    const workerDLQ = this.sourceValue(sources, 'workerDLQ', null);

    const gmvCents = toCents(financialToday.totalValue);
    const grossRevenueCents = toCents(operationalRevenue.totalOperationalFee);
    const totalCustomers = toNumber(usersStatus?.customers?.total, 0);
    const completedRides = toNumber(financialToday.totalRides ?? ridesToday.completedToday, 0);
    const openSupportTickets = toNumber(opsOverview?.supportQueue?.totalOpenTickets, 0);
    const driverOnboardingSummary = driverOnboardingQueue?.summary || {};
    const driverOnboardingByStatus = driverOnboardingSummary.byStatus || {};

    const status = classifyStatus({
      sources,
      health,
      workerHealth,
      workerLag,
      workerDLQ,
      opsOverview
    });
    const domainHealth = buildDomainHealth({
      sources,
      status,
      campaignStats,
      driverOnboardingSummary,
      opsOverview,
      workerDLQ,
      workerLag
    });
    const actionItems = buildActionItems({
      status,
      sources,
      opsOverview,
      campaignStats,
      driverOnboardingSummary,
      workerDLQ,
      workerLag
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
        domainHealth,
        sources: sources.map(({ value, ...source }) => source)
      },
      actionItems,
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
      driverOnboarding: {
        totalDocuments: toNumber(driverOnboardingSummary.total, 0),
        pendingDocuments: toNumber(driverOnboardingByStatus.pending, 0),
        approvedDocuments: toNumber(driverOnboardingByStatus.approved, 0),
        rejectedDocuments: toNumber(driverOnboardingByStatus.rejected, 0),
        reviewQueueSource: driverOnboardingQueue?.source || 'driver_documents_index_stats'
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
