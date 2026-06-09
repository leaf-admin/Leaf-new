const redisPool = require('../utils/redis-pool');
const modernMetricsService = require('./modern-metrics-service');
const opsOverviewService = require('./ops-overview-service');
const campaignCenterService = require('./campaign-center-service');
const healthCheckService = require('./health-check-service');
const driverApplicationService = require('./driver-application-service');
const paymentRuntimeProfileService = require('./payment-runtime-profile-service');
const skuCostMonitorService = require('./backoffice-sku-cost-monitor-service');
const rideCostAlertService = require('./ride-cost-alert-service');
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

function buildDomainHealth({
  sources,
  status,
  campaignStats,
  driverOnboardingSummary,
  opsOverview,
  workerDLQ,
  workerLag,
  paymentRuntime
}) {
  const dlqSize = toNumber(workerDLQ?.dlqSize ?? workerDLQ?.size ?? workerDLQ?.count, 0);
  const lag = toNumber(workerLag?.lag?.lag ?? workerLag?.lag ?? workerLag, 0);
  const supportBreaches = toNumber(opsOverview?.supportQueue?.overdueAckCount, 0)
    + toNumber(opsOverview?.supportQueue?.overdueFirstResponseCount, 0);
  const pendingDocuments = toNumber(driverOnboardingSummary?.byStatus?.pending, 0);
  const paymentSourceOk = sourceStatus(sources, 'paymentRuntime') === 'ok';
  const redisSourceOk = sourceStatus(sources, 'redis') === 'ok';
  const firebaseSourceOk = ['usersStatus', 'ridesToday', 'financialToday', 'driverOnboarding']
    .every((sourceId) => sourceStatus(sources, sourceId) === 'ok');

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
      id: 'payment-runtime',
      label: 'Woovi runtime',
      status: paymentSourceOk ? 'healthy' : 'warning',
      source: 'paymentRuntime',
      action: paymentSourceOk
        ? `Backend controla ${paymentRuntime?.defaultEnvironment || 'ambiente'} e perfis canary.`
        : 'Revisar perfis de pagamento antes de canary.'
    },
    {
      id: 'redis',
      label: 'Redis e cache',
      status: redisSourceOk ? 'healthy' : 'warning',
      source: 'redis',
      action: redisSourceOk
        ? 'Cache e streams respondendo.'
        : 'Cache indisponível; dashboard pode ficar mais caro/lento.'
    },
    {
      id: 'firebase',
      label: 'Firebase/Firestore/RTDB',
      status: firebaseSourceOk ? 'healthy' : 'warning',
      source: 'metrics',
      action: firebaseSourceOk
        ? 'Leituras agregadas responderam.'
        : 'Validar índices e permissões do backend.'
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

function buildActionItems({
  status,
  sources,
  opsOverview,
  campaignStats,
  driverOnboardingSummary,
  workerDLQ,
  workerLag,
  paymentRuntime,
  skuMonitor,
  rideCostAnomaly
}) {
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

  if (paymentRuntime?.globalSandboxEnabled) {
    items.push({
      id: 'payment-global-sandbox',
      priority: 'alta',
      title: 'Sandbox global ativo',
      description: 'Perfil sandbox global está ativo. Use somente em janela controlada de teste.',
      href: '/payment-runtime'
    });
  } else if (
    paymentRuntime &&
    paymentRuntime.defaultEnvironment === 'production' &&
    toNumber(paymentRuntime.sandboxProfileCount, 0) === 0
  ) {
    items.push({
      id: 'payment-canary-profile',
      priority: 'baixa',
      title: 'Canary usa produção por padrão',
      description: 'Crie perfil sandbox por usuário/telefone antes de teste pago.',
      href: '/payment-runtime'
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

  if (['warning', 'danger'].includes(skuMonitor?.status)) {
    items.push({
      id: 'sku-cost-monitor',
      priority: skuMonitor.status === 'danger' ? 'alta' : 'media',
      title: 'Custo por corrida subiu',
      description: `Monitor SKU em ${skuMonitor.finance?.costRatioPercent || 0}% da taxa operacional media.`,
      href: '/dashboard'
    });
  }

  if (rideCostAnomaly && ['warning', 'danger'].includes(rideCostAnomaly.status)) {
    const isCritical = rideCostAnomaly.status === 'danger';
    items.push({
      id: 'ride-cost-anomaly',
      priority: isCritical ? 'alta' : 'media',
      title: isCritical
        ? 'Custo medio por corrida acima do critico'
        : 'Custo medio por corrida acima do limite de aviso',
      description: `R$ ${toNumber(rideCostAnomaly.averageBrl).toFixed(4)} medio / R$ ${toNumber(rideCostAnomaly.warningThreshold).toFixed(2)} aviso / R$ ${toNumber(rideCostAnomaly.criticalThreshold).toFixed(2)} critico; ${rideCostAnomaly.aboveWarningCount}/${rideCostAnomaly.completedRides} acima do aviso.`,
      href: '/dashboard'
    });
  }

  if (
    rideCostAnomaly &&
    toNumber(rideCostAnomaly.completedRides, 0) > 0 &&
    rideCostAnomaly.status !== 'no_data' &&
    toNumber(rideCostAnomaly.directionsPerRide, 0) >= toNumber(rideCostAnomaly.directionsWarningPerRide, 0)
  ) {
    const directionsPerRide = toNumber(rideCostAnomaly.directionsPerRide, 0);
    const directionsWarningPerRide = toNumber(rideCostAnomaly.directionsWarningPerRide, 0);
    const directionsCriticalPerRide = toNumber(rideCostAnomaly.directionsCriticalPerRide, 0);
    const isCritical = directionsPerRide >= directionsCriticalPerRide;
    items.push({
      id: 'directions-anomaly',
      priority: isCritical ? 'alta' : 'media',
      title: 'Directions por corrida elevado',
      description: `${directionsPerRide.toFixed(2)} directions/corrida (limite aviso: ${directionsWarningPerRide}, critico: ${directionsCriticalPerRide}).`,
      href: '/dashboard'
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

function buildCanaryPack({ status, paymentRuntime, domainHealth, costControls }) {
  const paymentEnvironment = paymentRuntime?.defaultEnvironment || 'unknown';
  const sandboxProfileCount = toNumber(paymentRuntime?.sandboxProfileCount, 0);
  const canarySandboxEnabled = paymentRuntime?.canarySandboxEnabled === true;
  const globalSandboxEnabled = paymentRuntime?.globalSandboxEnabled === true;
  const firestoreGuard = costControls?.firestoreReadGuard || {};
  const domainStatus = (id) => domainHealth.find((domain) => domain.id === id)?.status || 'unknown';

  return {
    generatedAt: new Date().toISOString(),
    paymentRuntime: {
      provider: paymentRuntime?.provider || 'woovi',
      defaultEnvironment: paymentEnvironment,
      sandboxProfileCount,
      canarySandboxEnabled,
      globalSandboxEnabled,
      href: '/payment-runtime'
    },
    links: [
      { label: 'Cockpit', href: '/dashboard' },
      { label: 'Suporte', href: '/support' },
      { label: 'Campanhas', href: '/campaign-center' },
      { label: 'Cadastro motorista', href: '/drivers/review-queue' },
      { label: 'Reconciliação', href: '/financial-reconciliation' },
      { label: 'Runtime pagamento', href: '/payment-runtime' },
      { label: 'Convites', href: '/programs' },
      { label: 'Waitlist motorista', href: '/waitlist' }
    ],
    readiness: [
      {
        id: 'payment-runtime',
        label: 'Pagamento por backend',
        status: globalSandboxEnabled
          ? 'attention'
          : (paymentEnvironment === 'production' && !canarySandboxEnabled ? 'attention' : 'ready'),
        detail: globalSandboxEnabled
          ? 'Sandbox global ativo. Evitar fora de janela controlada.'
          : `${paymentEnvironment} padrão; ${sandboxProfileCount} perfil(is) sandbox ativo(s).`
      },
      {
        id: 'support',
        label: 'Suporte inbox',
        status: domainStatus('support') === 'healthy' ? 'ready' : 'attention',
        detail: 'Responder, assumir, escalar, resolver e converter chat em chamado.'
      },
      {
        id: 'driver-onboarding',
        label: 'Cadastro motorista',
        status: domainStatus('driver-onboarding') === 'healthy' ? 'ready' : 'attention',
        detail: 'Aprovar, rejeitar, pedir reenvio e registrar auditoria.'
      },
      {
        id: 'campaigns',
        label: 'Campanhas',
        status: domainStatus('campaigns') === 'healthy' ? 'ready' : 'attention',
        detail: 'Impressões, cliques, CTR, CPM, CPC, conversão e valor contratado.'
      },
      {
        id: 'cost-guard',
        label: 'Cost guard',
        status: ['warning', 'danger', 'limit'].includes(firestoreGuard.budgetStatus) ? 'attention' : 'ready',
        detail: 'Dashboard usa snapshot agregado/cacheado; browser não chama Google/Woovi/Firebase direto.'
      }
    ],
    testUsers: [
      { role: 'Passageiro canary', instruction: 'Usar usuário de teste cadastrado nas instruções das lojas.' },
      { role: 'Motorista canary', instruction: 'Usar motorista aprovado ou aprovar pela fila antes do smoke.' }
    ],
    flowSteps: [
      'Entrar como passageiro e motorista.',
      'Confirmar runtime Woovi no backend antes de gerar PIX.',
      'Acompanhar cockpit, suporte, campanhas e cadastro durante o fluxo.',
      'Registrar qualquer falha como ticket e manter evidência do snapshot.'
    ],
    successCriteria: [
      'Sem chamada externa paga disparada pelo browser do dashboard.',
      'Pagamento usa o perfil de backend esperado.',
      'Inbox mostra mensagens não lidas e permite resposta humana.',
      'Cadastro motorista registra decisão e auditoria.',
      'Campanhas mostram métricas e status sem fan-out caro.'
    ],
    failureCriteria: [
      'Woovi em ambiente inesperado.',
      'Custo/reads fora do teto.',
      'Fila de suporte/cadastro parada.',
      'Serviço API/socket/Redis/Firebase em warning persistente.'
    ],
    overallStatus: status === 'healthy' && !globalSandboxEnabled ? 'ready' : 'attention'
  };
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
    paymentRuntime = paymentRuntimeProfileService,
    skuCostMonitor = skuCostMonitorService,
    workerHealthMonitor = new WorkerHealthMonitor()
  } = {}) {
    this.redisPool = redis;
    this.metrics = metrics;
    this.ops = ops;
    this.campaignCenter = campaignCenter;
    this.health = health;
    this.driverApplications = driverApplications;
    this.paymentRuntime = paymentRuntime;
    this.skuCostMonitor = skuCostMonitor;
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
        id: 'paymentRuntime',
        label: 'Runtime de pagamento',
        critical: false,
        run: () => this.paymentRuntime.getRuntimeSummary({})
      },
      {
        id: 'skuCostMonitor',
        label: 'Monitor SKU/custos',
        critical: false,
        run: () => this.skuCostMonitor.collectUsageSnapshot({})
      },
      {
        id: 'redis',
        label: 'Redis/cache',
        critical: false,
        run: async () => {
          if (this.redisPool?.ensureConnection) {
            await this.redisPool.ensureConnection();
          }
          const redis = this.getRedis();
          if (redis?.ping) {
            const response = await redis.ping();
            return { status: response || 'PONG' };
          }
          if (redis?.get) return { status: 'available' };
          return { status: 'unavailable' };
        }
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
      },
      {
        id: 'rideCostAlertSummary',
        label: 'Monitor de custo por corrida',
        critical: false,
        run: () => rideCostAlertService.collectRecentCostSummary({})
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
    const paymentRuntime = this.sourceValue(sources, 'paymentRuntime', {});
    const skuCostUsage = this.sourceValue(sources, 'skuCostMonitor', {});
    const driverOnboardingQueue = this.sourceValue(sources, 'driverOnboarding', {});
    const workerHealth = this.sourceValue(sources, 'workerHealth', null);
    const workerLag = this.sourceValue(sources, 'workerLag', null);
    const workerDLQ = this.sourceValue(sources, 'workerDLQ', null);
    const rideCostAlertSummary = this.sourceValue(sources, 'rideCostAlertSummary', null);

    const gmvCents = toCents(financialToday.totalValue);
    const grossRevenueCents = toCents(operationalRevenue.totalOperationalFee);
    const totalCustomers = toNumber(usersStatus?.customers?.total, 0);
    const completedRides = toNumber(financialToday.totalRides ?? ridesToday.completedToday, 0);
    const openSupportTickets = toNumber(opsOverview?.supportQueue?.totalOpenTickets, 0);
    const paymentPendingCount = toNumber(
      opsOverview?.paymentQueue?.pendingCount ??
      opsOverview?.payments?.pendingCount ??
      opsOverview?.disputes?.openCount,
      0
    );
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
    const skuMonitor = this.skuCostMonitor.attachFinancials(skuCostUsage, {
      financialToday,
      operationalRevenue,
      ridesToday
    });
    const domainHealth = buildDomainHealth({
      sources,
      status,
      campaignStats,
      driverOnboardingSummary,
      opsOverview,
      workerDLQ,
      workerLag,
      paymentRuntime
    });
    const rideCostCompleted = toNumber(rideCostAlertSummary?.completedRides, 0);
    const rideCostAnomaly = rideCostAlertSummary
      ? {
          status: rideCostCompleted <= 0
            ? 'no_data'
            : rideCostAlertSummary.aboveCriticalCount > 0
              ? 'danger'
              : rideCostAlertSummary.aboveWarningCount > 0 || rideCostAlertSummary.averageBrl >= rideCostAlertSummary.warningBrl
                ? 'warning'
                : 'healthy',
          averageBrl: rideCostAlertSummary.averageBrl || 0,
          averageGoogleBrl: rideCostAlertSummary.averageGoogleBrl || 0,
          directionsPerRide: rideCostAlertSummary.directionsPerRide || 0,
          maxBrl: rideCostAlertSummary.maxBrl || 0,
          aboveWarningCount: rideCostAlertSummary.aboveWarningCount || 0,
          aboveCriticalCount: rideCostAlertSummary.aboveCriticalCount || 0,
          completedRides: rideCostAlertSummary.completedRides || 0,
          warningThreshold: rideCostAlertSummary.warningBrl || 0,
          criticalThreshold: rideCostAlertSummary.criticalBrl || 0,
          directionsWarningPerRide: rideCostAlertSummary.directionsWarningPerRide || 0,
          directionsCriticalPerRide: rideCostAlertSummary.directionsCriticalPerRide || 0,
          generatedAt: rideCostAlertSummary.generatedAt || null
        }
      : null;
    const actionItems = buildActionItems({
      status,
      sources,
      opsOverview,
      campaignStats,
      driverOnboardingSummary,
      workerDLQ,
      workerLag,
      paymentRuntime,
      skuMonitor,
      rideCostAnomaly
    });

    const baseCostControls = {
      externalPaidApisCalled: false,
      paidApiFamilies: [],
      dashboardFanOutReduced: true,
      skuMonitor,
      rideCostAnomaly,
      notes: [
        'Snapshot agregado no backend com cache Redis.',
        'Monitor SKU usa somente telemetria recente ja persistida no Redis.',
        'Alerta de custo por corrida avalia media contra limites configurados no backend (RIDE_COST_WARNING_BRL, RIDE_COST_CRITICAL_BRL).',
        'Nao chama Google Places, Google Routes, Directions, Woovi ou provedores pagos.',
        'Pagina /maps segue separada porque carregar Google Maps JS pode gerar custo de mapa.'
      ]
    };
    const canaryPack = buildCanaryPack({
      status,
      paymentRuntime,
      domainHealth,
      costControls: baseCostControls
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
        paymentPendingCount,
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
      paymentRuntime: {
        provider: paymentRuntime?.provider || 'woovi',
        defaultEnvironment: paymentRuntime?.defaultEnvironment || 'unknown',
        activeProfileCount: toNumber(paymentRuntime?.activeProfileCount, 0),
        sandboxProfileCount: toNumber(paymentRuntime?.sandboxProfileCount, 0),
        productionProfileCount: toNumber(paymentRuntime?.productionProfileCount, 0),
        canarySandboxEnabled: paymentRuntime?.canarySandboxEnabled === true,
        globalSandboxEnabled: paymentRuntime?.globalSandboxEnabled === true,
        profiles: Array.isArray(paymentRuntime?.profiles) ? paymentRuntime.profiles.slice(0, 8) : []
      },
      canaryPack,
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
      costControls: baseCostControls
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
