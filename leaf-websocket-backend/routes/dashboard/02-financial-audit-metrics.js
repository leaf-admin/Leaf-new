// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Conciliação financeira, auditoria, métricas e analytics de reservas

const {
  DASHBOARD_FINANCIAL_ROLES,
  DASHBOARD_MONITORING_ROLES,
  FinancialLedgerService,
  auditService,
  authenticateJWT,
  backofficeCostGuardService,
  calculateAverageTripTime,
  calculateAverageWaitTime,
  extractRedisConnections,
  extractRedisMemoryInMb,
  extractRedisStatValue,
  financialReconciliationDashboardService,
  firebaseConfig,
  getHourlyTripDistribution,
  getPeakHours,
  logError,
  logStructured,
  os,
  parseAuditDate,
  redisPool,
  requireRole,
  resolveRideDriverNetAmount,
  resolveRideOperationalFee,
  resolveRideRevenue,
  router
} = require('./shared');

// Ledger financeiro: relatorios e reconciliacao de corridas
router.get('/api/financial/reconciliation/reports', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  const result = await financialReconciliationDashboardService.listReports({
    status: req.query.status,
    severity: req.query.severity,
    code: req.query.code,
    rideId: req.query.rideId,
    limit: req.query.limit,
    cursor: req.query.cursor,
    includeTestData: req.query.includeTestData,
    financialContext: req.query.financialContext || null,
    providerEnvironment: req.query.providerEnvironment || null
  });

  if (!result.success) {
    const statusCode = String(result.error || '').includes('Firestore') ? 503 : 500;
    return res.status(statusCode).json(result);
  }

  const payload = await backofficeCostGuardService.attachToResponse(
    res,
    'financial.reconciliation.reports',
    result,
    { limit: req.query.limit }
  );
  return res.json(payload);
});

router.get('/api/financial/reconciliation/rides/:rideId', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  const result = await financialReconciliationDashboardService.getRideDetail(req.params.rideId, {
    financialContext: req.query.financialContext || null,
    providerEnvironment: req.query.providerEnvironment || null
  });

  if (!result.success) {
    const statusCode = String(result.error || '').includes('Firestore') ? 503 : 500;
    return res.status(statusCode).json(result);
  }

  const payload = await backofficeCostGuardService.attachToResponse(
    res,
    'financial.reconciliation.ride',
    result
  );
  return res.json(payload);
});

router.post('/api/financial/reconciliation/rides/:rideId/run', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  const ledgerService = new FinancialLedgerService();
  const result = await ledgerService.reconcileRideFinancials({
    rideId: req.params.rideId,
    financialContext: req.body?.financialContext || req.query.financialContext || null,
    providerEnvironment: req.body?.providerEnvironment || req.query.providerEnvironment || null
  });

  if (!result.success) {
    const statusCode = String(result.error || '').includes('Firestore') ? 503 : 500;
    return res.status(statusCode).json(result);
  }

  const payload = await backofficeCostGuardService.attachToResponse(
    res,
    'financial.reconciliation.run',
    result,
    { limit: 1 }
  );
  return res.json(payload);
});

router.post('/api/financial/reconciliation/run', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  const ledgerService = new FinancialLedgerService();
  const result = await ledgerService.reconcileRecentRideFinancials({
    rideId: req.body?.rideId || req.query.rideId || null,
    limit: req.body?.limit || req.query.limit || 100,
    includeTestData: req.body?.includeTestData || req.query.includeTestData || false,
    financialContext: req.body?.financialContext || req.query.financialContext || null,
    providerEnvironment: req.body?.providerEnvironment || req.query.providerEnvironment || null
  });

  if (!result.success) {
    const statusCode = String(result.error || '').includes('Firestore') ? 503 : 500;
    return res.status(statusCode).json(result);
  }

  const payload = await backofficeCostGuardService.attachToResponse(
    res,
    'financial.reconciliation.run',
    result,
    { limit: req.body?.limit || req.query.limit || 100 }
  );
  return res.json(payload);
});

// Auditoria operacional: logs de ações críticas e leitura RBAC para backoffice
router.get('/api/audit/logs', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
  const filters = {
    userId: req.query.userId || undefined,
    action: req.query.action || undefined,
    resource: req.query.resource || undefined,
    severity: req.query.severity || undefined,
    startDate: parseAuditDate(req.query.startDate),
    endDate: parseAuditDate(req.query.endDate)
  };

  Object.keys(filters).forEach((key) => {
    if (!filters[key]) delete filters[key];
  });

  const result = await auditService.getAuditLogs(filters, limit);
  if (!result.success) {
    return res.status(503).json(result);
  }

  const payload = await backofficeCostGuardService.attachToResponse(
    res,
    'audit.logs',
    {
      ...result,
      filters,
      limit
    },
    { limit }
  );
  return res.json(payload);
});

router.get('/api/audit/stats', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  const result = await auditService.getAuditStats(
    parseAuditDate(req.query.startDate),
    parseAuditDate(req.query.endDate)
  );

  if (!result.success) {
    return res.status(503).json(result);
  }

  const payload = await backofficeCostGuardService.attachToResponse(
    res,
    'audit.stats',
    result
  );
  return res.json(payload);
});

router.get('/api/metrics/services', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    let metrics = {
      websocket: {
        connections: 0,
        messagesPerSec: 0,
        latency: 0,
        uptime: 0
      },
      redis: {
        operations: 0,
        hitRate: 0,
        memory: 0,
        connections: 0
      },
      firebase: {
        reads: 0,
        writes: 0,
        functions: 0,
        storage: 0
      },
      vultr: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0
      }
    };

    try {
      // Dados reais do Redis
      const redis = redisPool.getConnection();

      // Informações reais do Redis
      const redisInfo = await redis.info();
      const dbSize = await redis.dbsize();
      const redisPingStart = Date.now();
      await redis.ping();
      const redisPingMs = Date.now() - redisPingStart;

      // Parse das informações do Redis
      const memoryUsedMb = extractRedisMemoryInMb(redisInfo);
      const totalCommandsProcessed = extractRedisStatValue(redisInfo, 'total_commands_processed');
      const keyspaceHits = extractRedisStatValue(redisInfo, 'keyspace_hits');
      const keyspaceMisses = extractRedisStatValue(redisInfo, 'keyspace_misses');
      const totalLookups = keyspaceHits + keyspaceMisses;
      const hitRate = totalLookups > 0 ? (keyspaceHits / totalLookups) * 100 : 0;

      metrics.redis = {
        operations: totalCommandsProcessed || dbSize,
        hitRate: Number(hitRate.toFixed(2)),
        memory: Number(memoryUsedMb.toFixed(2)),
        connections: extractRedisConnections(redisInfo)
      };

      // Dados reais do WebSocket (via global se disponível)
      if (global.io && global.io.engine) {
        metrics.websocket = {
          connections: global.io.engine.clientsCount || 0,
          messagesPerSec: 0, // Sem contador dedicado ainda
          latency: redisPingMs,
          uptime: 100
        };
      }

      // Dados do sistema (básicos)
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const cpuLoad = os.loadavg()[0];
      const cores = Math.max(os.cpus().length, 1);

      metrics.vultr = {
        cpu: Math.min(100, (cpuLoad / cores) * 100),
        memory: ((totalMem - freeMem) / totalMem) * 100,
        disk: 0,
        network: 0
      };

    } catch (error) {
      logStructured('warn', '⚠️ Erro ao obter métricas reais:', error.message, { service: 'dashboard-routes' });
      // Manter zeros em caso de erro
    }

    res.json(metrics);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas de serviços:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
