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

// 📊 Financial Metrics - DADOS REAIS (Firebase)
router.get('/api/metrics/financial', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { period } = req.query;

    let metrics = {
      revenue: {
        total: 0,
        rides: 0,
        subscriptions: 0,
        marketing: 0,
        growth: 0
      },
      costs: {
        total: 0,
        infrastructure: 0,
        apis: 0,
        growth: 0
      },
      profit: {
        gross: 0,
        margin: 0,
        growth: 0
      },
      rides: {
        total: 0,
        completed: 0,
        cancelled: 0,
        avgFare: 0,
        growth: 0
      }
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar corridas do Firebase
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};

        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        // Filtrar por período se especificado
        let filteredBookings = bookingArray;
        if (period) {
          const today = new Date();
          let startDate = new Date();

          switch (period) {
            case 'today':
              startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
              break;
            case 'week':
              startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
              break;
            case 'month':
              startDate = new Date(today.getFullYear(), today.getMonth(), 1);
              break;
          }

          filteredBookings = bookingArray.filter(booking => {
            const tripDate = new Date(booking.tripdate || 0);
            return tripDate >= startDate;
          });
        }

        // Calcular métricas reais
        const completedBookings = filteredBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID');
        const cancelledBookings = filteredBookings.filter(b => b.status === 'CANCELLED');

        const totalRevenue = completedBookings.reduce((sum, booking) => {
          return sum + resolveRideRevenue(booking);
        }, 0);

        const convenienceFees = completedBookings.reduce((sum, booking) => {
          return sum + resolveRideOperationalFee(booking);
        }, 0);

        const totalFares = completedBookings.reduce((sum, booking) => {
          return sum + resolveRideDriverNetAmount(booking);
        }, 0);

        metrics = {
          revenue: {
            total: totalRevenue,
            rides: totalFares,
            subscriptions: 0, // TODO: Implementar sistema de assinaturas
            marketing: 0, // TODO: Implementar receita de marketing
            growth: 0 // TODO: Calcular crescimento
          },
          costs: {
            total: convenienceFees * 0.3, // Estimativa: 30% da taxa de conveniência são custos
            infrastructure: convenienceFees * 0.15,
            apis: convenienceFees * 0.10,
            growth: 0
          },
          profit: {
            gross: totalRevenue - (convenienceFees * 0.3),
            margin: totalRevenue > 0 ? (((totalRevenue - (convenienceFees * 0.3)) / totalRevenue) * 100).toFixed(1) : 0,
            growth: 0
          },
          rides: {
            total: filteredBookings.length,
            completed: completedBookings.length,
            cancelled: cancelledBookings.length,
            avgFare: completedBookings.length > 0 ? (totalRevenue / completedBookings.length).toFixed(2) : 0,
            growth: 0
          }
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar dados financeiros do Firebase:', error.message, { service: 'dashboard-routes' });
    }

    res.json(metrics);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas financeiras:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💰 Advanced Financial Metrics - CUSTOS OPERACIONAIS REAIS
router.get('/api/metrics/financial/advanced', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    let metrics = {
      operationalCosts: {
        totalPerRide: 0,
        apiCosts: 0,
        serverCosts: 0,
        paymentProcessing: 0,
        breakdown: []
      },
      revenueAnalysis: {
        grossRevenue: 0,
        netRevenue: 0,
        commissionRevenue: 0,
        subscriptionRevenue: 0,
        marginPercent: 0
      },
      profitAnalysis: {
        grossProfit: 0,
        netProfit: 0,
        profitPerRide: 0,
        profitMargin: 0
      },
      costBreakdown: {
        infrastructure: 0,
        apis: {
          googleMaps: 0,
          firebase: 0,
          payment: 0
        },
        operations: 0,
        marketing: 0
      }
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar corridas do período
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        // Filtrar por período
        const today = new Date();
        let startDate = new Date();

        switch (period) {
          case 'today':
            startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            break;
          case 'week':
            startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
          case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        }

        const filteredBookings = bookingArray.filter(booking => {
          const tripDate = new Date(booking.tripdate || 0);
          return tripDate >= startDate;
        });

        const completedBookings = filteredBookings.filter(b =>
          b.status === 'COMPLETE' || b.status === 'PAID'
        );

        if (completedBookings.length > 0) {
          // Calcular receitas reais
          const grossRevenue = completedBookings.reduce((sum, booking) => {
            return sum + resolveRideRevenue(booking);
          }, 0);

          const commissionRevenue = completedBookings.reduce((sum, booking) => {
            return sum + resolveRideOperationalFee(booking);
          }, 0);

          const driverPayouts = completedBookings.reduce((sum, booking) => {
            return sum + resolveRideDriverNetAmount(booking);
          }, 0);

          // Calcular custos operacionais reais por corrida
          const totalRides = completedBookings.length;

          // Custos estimados baseados na realidade do mercado
          const apiCostsPerRide = {
            googleMaps: 0.005, // $0.005 por request de direção
            firebase: 0.002,   // $0.002 por operação
            payment: grossRevenue * 0.029, // 2.9% taxa de pagamento
          };

          const serverCostsPerRide = 50 / Math.max(totalRides, 1); // $50/mês dividido pelas corridas

          const totalApiCosts = totalRides * (apiCostsPerRide.googleMaps + apiCostsPerRide.firebase);
          const totalServerCosts = totalRides * serverCostsPerRide;
          const totalPaymentCosts = apiCostsPerRide.payment;

          const totalOperationalCosts = totalApiCosts + totalServerCosts + totalPaymentCosts;

          metrics = {
            operationalCosts: {
              totalPerRide: (totalOperationalCosts / Math.max(totalRides, 1)).toFixed(4),
              apiCosts: totalApiCosts.toFixed(2),
              serverCosts: totalServerCosts.toFixed(2),
              paymentProcessing: totalPaymentCosts.toFixed(2),
              breakdown: [
                { name: 'Google Maps API', cost: (totalRides * apiCostsPerRide.googleMaps).toFixed(4) },
                { name: 'Firebase', cost: (totalRides * apiCostsPerRide.firebase).toFixed(4) },
                { name: 'Servidor VPS', cost: totalServerCosts.toFixed(2) },
                { name: 'Processamento Pagamento', cost: totalPaymentCosts.toFixed(2) }
              ]
            },
            revenueAnalysis: {
              grossRevenue: grossRevenue.toFixed(2),
              netRevenue: (grossRevenue - driverPayouts).toFixed(2),
              commissionRevenue: commissionRevenue.toFixed(2),
              subscriptionRevenue: 0, // TODO: Implementar sistema de assinaturas
              marginPercent: grossRevenue > 0 ? (((grossRevenue - driverPayouts) / grossRevenue) * 100).toFixed(1) : 0
            },
            profitAnalysis: {
              grossProfit: (grossRevenue - driverPayouts).toFixed(2),
              netProfit: (grossRevenue - driverPayouts - totalOperationalCosts).toFixed(2),
              profitPerRide: ((grossRevenue - driverPayouts - totalOperationalCosts) / Math.max(totalRides, 1)).toFixed(2),
              profitMargin: grossRevenue > 0 ? (((grossRevenue - driverPayouts - totalOperationalCosts) / grossRevenue) * 100).toFixed(1) : 0
            },
            costBreakdown: {
              infrastructure: totalServerCosts.toFixed(2),
              apis: {
                googleMaps: (totalRides * apiCostsPerRide.googleMaps).toFixed(4),
                firebase: (totalRides * apiCostsPerRide.firebase).toFixed(4),
                payment: totalPaymentCosts.toFixed(2)
              },
              operations: (totalOperationalCosts * 0.1).toFixed(2), // 10% para operações
              marketing: (commissionRevenue * 0.05).toFixed(2) // 5% da comissão para marketing
            }
          };
        }
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao calcular métricas financeiras avançadas:', error.message, { service: 'dashboard-routes' });
    }

    res.json(metrics);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas financeiras avançadas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚗 Booking Analytics - ANÁLISE COMPLETA DE CORRIDAS
router.get('/api/analytics/bookings', async (req, res) => {
  try {
    const { period = 'month', status } = req.query;

    let analytics = {
      summary: {
        total: 0,
        completed: 0,
        cancelled: 0,
        ongoing: 0,
        completionRate: 0,
        cancellationRate: 0
      },
      performance: {
        averageWaitTime: 0,
        averageTripTime: 0,
        averageDistance: 0,
        averageRating: 0,
        peakHours: []
      },
      trends: {
        daily: [],
        hourly: [],
        weekday: []
      },
      cancellationAnalysis: {
        byReason: [],
        byTimeOfDay: [],
        customerCancellations: 0,
        driverCancellations: 0
      }
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar corridas
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        // Filtrar por período
        const today = new Date();
        let startDate = new Date();

        switch (period) {
          case 'today':
            startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            break;
          case 'week':
            startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
          case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        }

        let filteredBookings = bookingArray.filter(booking => {
          const tripDate = new Date(booking.tripdate || 0);
          return tripDate >= startDate;
        });

        // Filtrar por status se especificado
        if (status) {
          filteredBookings = filteredBookings.filter(b => b.status === status);
        }

        // Calcular estatísticas básicas
        const completed = filteredBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID');
        const cancelled = filteredBookings.filter(b => b.status === 'CANCELLED');
        const ongoing = filteredBookings.filter(b => ['NEW', 'ACCEPTED', 'STARTED'].includes(b.status));

        analytics.summary = {
          total: filteredBookings.length,
          completed: completed.length,
          cancelled: cancelled.length,
          ongoing: ongoing.length,
          completionRate: filteredBookings.length > 0 ? ((completed.length / filteredBookings.length) * 100).toFixed(1) : 0,
          cancellationRate: filteredBookings.length > 0 ? ((cancelled.length / filteredBookings.length) * 100).toFixed(1) : 0
        };

        // Calcular performance (apenas corridas completas)
        if (completed.length > 0) {
          const totalDistance = completed.reduce((sum, booking) => {
            return sum + parseFloat(booking.distance || 0);
          }, 0);
          const avgWaitMinutes = calculateAverageWaitTime(completed);
          const avgTripMinutes = calculateAverageTripTime(completed);
          const ratedBookings = completed.filter((booking) => Number.isFinite(Number.parseFloat(booking.rating)));
          const totalRating = ratedBookings.reduce((sum, booking) => {
            return sum + Number.parseFloat(booking.rating || 0);
          }, 0);

          analytics.performance = {
            averageWaitTime: Number(avgWaitMinutes.toFixed(1)),
            averageTripTime: Number(avgTripMinutes.toFixed(1)),
            averageDistance: completed.length > 0 ? (totalDistance / completed.length).toFixed(2) : 0,
            averageRating: ratedBookings.length > 0 ? (totalRating / ratedBookings.length).toFixed(1) : 0,
            peakHours: getPeakHours(completed)
          };
        }

        // Análise de tendências diárias (últimos 7 dias)
        const dailyTrends = [];
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
          const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

          const dayBookings = bookingArray.filter(booking => {
            const tripDate = new Date(booking.tripdate || 0);
            return tripDate >= dayStart && tripDate < dayEnd;
          });

          dailyTrends.push({
            date: date.toISOString().split('T')[0],
            total: dayBookings.length,
            completed: dayBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID').length,
            cancelled: dayBookings.filter(b => b.status === 'CANCELLED').length
          });
        }
        analytics.trends.daily = dailyTrends;

        // Análise de cancelamentos
        const cancelReasons = {};
        cancelled.forEach(booking => {
          const reason = booking.reason || 'Não especificado';
          cancelReasons[reason] = (cancelReasons[reason] || 0) + 1;
        });

        analytics.cancellationAnalysis = {
          byReason: Object.keys(cancelReasons).map(reason => ({
            reason,
            count: cancelReasons[reason],
            percentage: ((cancelReasons[reason] / Math.max(cancelled.length, 1)) * 100).toFixed(1)
          })),
          byTimeOfDay: getHourlyTripDistribution(cancelled).filter(({ trips }) => trips > 0),
          customerCancellations: cancelled.filter(b => b.cancelled_by === 'customer').length,
          driverCancellations: cancelled.filter(b => b.cancelled_by === 'driver').length
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao calcular analytics de corridas:', error.message, { service: 'dashboard-routes' });
    }

    res.json(analytics);
  } catch (error) {
    logError(error, 'Erro ao buscar analytics de corridas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
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
