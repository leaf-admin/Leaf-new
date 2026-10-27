// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Custos, monitoramento e crescimento

const {
  userStore,
  DASHBOARD_MONITORING_ROLES,
  analyzeDriverGrowth,
  analyzeRevenueGrowth,
  analyzeTripGrowth,
  analyzeUserGrowth,
  authenticateJWT,
  calculateCostTrend,
  calculateOverallStatus,
  calculatePotentialSavings,
  calculateTripCosts,
  collectPerformanceMetrics,
  countServicesUp,
  firebaseConfig,
  generateCohortAnalysis,
  generateGrowthForecasts,
  generateGrowthInsights,
  generateGrowthTrends,
  generatePerformanceTrends,
  generateServiceAlerts,
  identifyMainCostDriver,
  logError,
  logStructured,
  monitorFirebaseService,
  monitorGoogleApis,
  monitorRedisService,
  monitorSystemResources,
  monitorWebSocketConnections,
  redisPool,
  requireRole,
  resolveRideRevenue,
  router,
  rideAnnotationStore
} = require('./shared');

// 💲 Operational Costs Tracking - TRACKING DE CUSTOS OPERACIONAIS POR CORRIDA
router.get('/api/costs/per-trip', async (req, res) => {
  try {
    const {
      period = '30d',
      tripId,
      detailed = false
    } = req.query;

    let costsData = {
      summary: {},
      trips: [],
      breakdown: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        // Buscar corridas do período
        const bookingRecords = await rideAnnotationStore.listAnnotations(firebaseConfig.getFirestore(), 'bookings');
        const bookings = bookingRecords || {};

        // Filtrar corridas por período e status
        let tripIds = Object.keys(bookings);
        if (tripId) {
          tripIds = [tripId];
        } else {
          tripIds = tripIds.filter(id => {
            const booking = bookings[id];
            const tripDate = new Date(booking.tripdate);
            return tripDate >= startDate &&
              (booking.status === 'COMPLETE' || booking.status === 'PAID');
          });
        }

        const tripsWithCosts = tripIds.map(id => {
          const booking = bookings[id];
          const distance = parseFloat(booking.distance || 0);
          const duration = parseFloat(booking.duration || 0);
          const fare = resolveRideRevenue(booking);

          // Custos por corrida (estimativas baseadas em dados reais do mercado)
          const costs = calculateTripCosts(booking, distance, duration);

          return {
            tripId: id,
            basic: {
              date: booking.tripdate,
              distance: distance.toFixed(2) + ' km',
              duration: duration.toFixed(0) + ' min',
              fare: fare.toFixed(2),
              status: booking.status
            },
            costs: {
              // APIs Google
              mapsApi: costs.mapsApi,
              geocoding: costs.geocoding,
              directionsApi: costs.directionsApi,
              placesApi: costs.placesApi,

              // Infraestrutura
              serverCosts: costs.serverCosts,
              firebaseCosts: costs.firebaseCosts,
              redisCosts: costs.redisCosts,

              // Processamento
              paymentProcessing: costs.paymentProcessing,

              // Comunicação
              fcmNotifications: costs.fcmNotifications,
              smsNotifications: costs.smsNotifications,

              // Total
              totalApiCosts: costs.totalApiCosts,
              totalInfraCosts: costs.totalInfraCosts,
              totalCommCosts: costs.totalCommCosts,
              totalOperationalCosts: costs.totalOperationalCosts
            },
            profitability: {
              grossRevenue: fare.toFixed(2),
              operationalCosts: costs.totalOperationalCosts.toFixed(4),
              netRevenue: (fare - costs.totalOperationalCosts).toFixed(2),
              profitMargin: fare > 0 ? (((fare - costs.totalOperationalCosts) / fare) * 100).toFixed(2) + '%' : '0%',
              costPerKm: distance > 0 ? (costs.totalOperationalCosts / distance).toFixed(4) : '0.0000',
              costPerMinute: duration > 0 ? (costs.totalOperationalCosts / duration).toFixed(4) : '0.0000'
            }
          };
        });

        // Calcular resumo agregado
        const totalTrips = tripsWithCosts.length;
        const totalRevenue = tripsWithCosts.reduce((sum, trip) =>
          sum + parseFloat(trip.basic.fare), 0
        );
        const totalOperationalCosts = tripsWithCosts.reduce((sum, trip) =>
          sum + trip.costs.totalOperationalCosts, 0
        );
        const totalDistance = tripsWithCosts.reduce((sum, trip) =>
          sum + parseFloat(trip.basic.distance), 0
        );
        const totalDuration = tripsWithCosts.reduce((sum, trip) =>
          sum + parseFloat(trip.basic.duration), 0
        );

        // Breakdown por categoria de custo
        const costBreakdown = {
          apiCosts: {
            total: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.totalApiCosts, 0),
            maps: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.mapsApi, 0),
            geocoding: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.geocoding, 0),
            directions: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.directionsApi, 0),
            places: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.placesApi, 0)
          },
          infraCosts: {
            total: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.totalInfraCosts, 0),
            server: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.serverCosts, 0),
            firebase: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.firebaseCosts, 0),
            redis: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.redisCosts, 0)
          },
          processingCosts: {
            payment: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.paymentProcessing, 0)
          },
          communicationCosts: {
            total: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.totalCommCosts, 0),
            fcm: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.fcmNotifications, 0),
            sms: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.smsNotifications, 0)
          }
        };

        costsData = {
          summary: {
            period,
            totalTrips,
            totalRevenue: totalRevenue.toFixed(2),
            totalOperationalCosts: totalOperationalCosts.toFixed(4),
            totalNetRevenue: (totalRevenue - totalOperationalCosts).toFixed(2),
            avgCostPerTrip: totalTrips > 0 ? (totalOperationalCosts / totalTrips).toFixed(4) : '0.0000',
            avgRevenuePerTrip: totalTrips > 0 ? (totalRevenue / totalTrips).toFixed(2) : '0.00',
            avgProfitMargin: totalRevenue > 0 ? (((totalRevenue - totalOperationalCosts) / totalRevenue) * 100).toFixed(2) + '%' : '0%',
            avgCostPerKm: totalDistance > 0 ? (totalOperationalCosts / totalDistance).toFixed(4) : '0.0000',
            avgCostPerMinute: totalDuration > 0 ? (totalOperationalCosts / totalDuration).toFixed(4) : '0.0000'
          },
          breakdown: {
            ...costBreakdown,
            percentages: {
              apiCosts: totalOperationalCosts > 0 ? ((costBreakdown.apiCosts.total / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%',
              infraCosts: totalOperationalCosts > 0 ? ((costBreakdown.infraCosts.total / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%',
              processingCosts: totalOperationalCosts > 0 ? ((costBreakdown.processingCosts.payment / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%',
              communicationCosts: totalOperationalCosts > 0 ? ((costBreakdown.communicationCosts.total / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%'
            }
          },
          trips: detailed === 'true' ? tripsWithCosts : tripsWithCosts.slice(0, 10)
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao calcular custos operacionais:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      tripId: tripId || 'all',
      detailed: detailed === 'true',
      generatedAt: new Date().toISOString(),
      data: costsData
    });
  } catch (error) {
    logError(error, 'Erro ao buscar custos operacionais:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💲 Cost Optimization Insights
router.get('/api/costs/insights', async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let insights = {
      trends: {},
      optimization: {},
      recommendations: []
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {

        // Buscar dados históricos para análise de tendências
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        const bookingRecords = await rideAnnotationStore.listAnnotations(firebaseConfig.getFirestore(), 'bookings');
        const bookings = bookingRecords || {};

        const completedTrips = Object.keys(bookings)
          .filter(id => {
            const booking = bookings[id];
            const tripDate = new Date(booking.tripdate);
            return tripDate >= startDate &&
              (booking.status === 'COMPLETE' || booking.status === 'PAID');
          })
          .map(id => ({
            id,
            ...bookings[id],
            costs: calculateTripCosts(bookings[id],
              parseFloat(bookings[id].distance || 0),
              parseFloat(bookings[id].duration || 0)
            )
          }));

        // Análise de tendências
        const dailyCosts = {};
        completedTrips.forEach(trip => {
          const date = new Date(trip.tripdate).toISOString().split('T')[0];
          if (!dailyCosts[date]) {
            dailyCosts[date] = { trips: 0, totalCosts: 0, totalRevenue: 0 };
          }
          dailyCosts[date].trips += 1;
          dailyCosts[date].totalCosts += trip.costs.totalOperationalCosts;
          dailyCosts[date].totalRevenue += resolveRideRevenue(trip);
        });

        // Identificar otimizações
        const highCostTrips = completedTrips
          .filter(trip => trip.costs.totalOperationalCosts > 0.50) // Corridas com custo > R$ 0.50
          .sort((a, b) => b.costs.totalOperationalCosts - a.costs.totalOperationalCosts)
          .slice(0, 10);

        const costByDistance = completedTrips
          .filter(trip => parseFloat(trip.distance || 0) > 0)
          .map(trip => ({
            distance: parseFloat(trip.distance),
            costPerKm: trip.costs.totalOperationalCosts / parseFloat(trip.distance),
            id: trip.id
          }))
          .sort((a, b) => b.costPerKm - a.costPerKm);

        // Gerar recomendações
        const recommendations = [];

        if (highCostTrips.length > 0) {
          recommendations.push({
            type: 'cost_reduction',
            priority: 'high',
            title: 'Otimizar corridas de alto custo',
            description: `${highCostTrips.length} corridas com custo operacional acima de R$ 0.50`,
            impact: 'Redução potencial de 15-25% nos custos',
            action: 'Revisar rotas e otimizar chamadas de API'
          });
        }

        if (costByDistance.length > 0 && costByDistance[0].costPerKm > 0.08) {
          recommendations.push({
            type: 'efficiency',
            priority: 'medium',
            title: 'Melhorar eficiência por quilômetro',
            description: `Custo médio por km está em R$ ${costByDistance[0].costPerKm.toFixed(4)}`,
            impact: 'Economia de R$ 0.01-0.03 por km',
            action: 'Implementar cache de rotas e geocoding'
          });
        }

        const avgApiCostPerTrip = completedTrips.length > 0 ?
          completedTrips.reduce((sum, trip) => sum + trip.costs.totalApiCosts, 0) / completedTrips.length : 0;

        if (avgApiCostPerTrip > 0.15) {
          recommendations.push({
            type: 'api_optimization',
            priority: 'high',
            title: 'Reduzir custos de APIs',
            description: `Custo médio de APIs por corrida: R$ ${avgApiCostPerTrip.toFixed(4)}`,
            impact: 'Redução de 20-40% nos custos de API',
            action: 'Implementar cache inteligente e otimizar consultas'
          });
        }

        insights = {
          trends: {
            dailyCosts: Object.keys(dailyCosts).sort().map(date => ({
              date,
              trips: dailyCosts[date].trips,
              avgCostPerTrip: dailyCosts[date].trips > 0 ?
                (dailyCosts[date].totalCosts / dailyCosts[date].trips).toFixed(4) : '0.0000',
              totalCosts: dailyCosts[date].totalCosts.toFixed(4),
              totalRevenue: dailyCosts[date].totalRevenue.toFixed(2),
              profitMargin: dailyCosts[date].totalRevenue > 0 ?
                (((dailyCosts[date].totalRevenue - dailyCosts[date].totalCosts) / dailyCosts[date].totalRevenue) * 100).toFixed(2) + '%' : '0%'
            })),
            costTrend: calculateCostTrend(dailyCosts),
            avgCostPerTrip: completedTrips.length > 0 ?
              (completedTrips.reduce((sum, trip) => sum + trip.costs.totalOperationalCosts, 0) / completedTrips.length).toFixed(4) : '0.0000'
          },
          optimization: {
            highCostTrips: highCostTrips.map(trip => ({
              tripId: trip.id,
              date: trip.tripdate,
              distance: trip.distance,
              operationalCost: trip.costs.totalOperationalCosts.toFixed(4),
              costPerKm: parseFloat(trip.distance) > 0 ?
                (trip.costs.totalOperationalCosts / parseFloat(trip.distance)).toFixed(4) : '0.0000',
              mainCostDriver: identifyMainCostDriver(trip.costs)
            })),
            costEfficiencyByDistance: costByDistance.slice(0, 5),
            potentialSavings: calculatePotentialSavings(completedTrips)
          },
          recommendations
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar insights de custos:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      insights
    });
  } catch (error) {
    logError(error, 'Erro ao gerar insights de custos:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔧 Service Monitoring - MONITORAMENTO INDIVIDUAL DE SERVIÇOS
router.get('/api/monitoring/services', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    const { service, timeframe = '1h' } = req.query;

    let monitoring = {
      overview: {},
      services: {},
      alerts: []
    };

    // Monitorar Redis
    const redisStatus = await monitorRedisService();

    // Monitorar Firebase
    const firebaseStatus = await monitorFirebaseService();

    // Monitorar APIs Google
    const googleApisStatus = await monitorGoogleApis();

    // Monitorar Sistema
    const systemStatus = await monitorSystemResources();

    // Monitorar WebSocket
    const websocketStatus = await monitorWebSocketConnections();

    monitoring = {
      overview: {
        timestamp: new Date().toISOString(),
        overallStatus: calculateOverallStatus([
          redisStatus, firebaseStatus, googleApisStatus,
          systemStatus, websocketStatus
        ]),
        servicesUp: countServicesUp([
          redisStatus, firebaseStatus, googleApisStatus,
          systemStatus, websocketStatus
        ]),
        totalServices: 5,
        alertsCount: 0
      },
      services: {
        redis: redisStatus,
        firebase: firebaseStatus,
        googleApis: googleApisStatus,
        system: systemStatus,
        websocket: websocketStatus
      },
      alerts: generateServiceAlerts([
        redisStatus, firebaseStatus, googleApisStatus,
        systemStatus, websocketStatus
      ])
    };

    // Filtrar por serviço específico se solicitado
    if (service) {
      const serviceData = monitoring.services[service];
      if (serviceData) {
        res.json({
          service,
          timeframe,
          generatedAt: new Date().toISOString(),
          data: serviceData,
          alerts: monitoring.alerts.filter(alert => alert.service === service)
        });
      } else {
        res.status(404).json({ error: 'Serviço não encontrado' });
      }
    } else {
      res.json({
        timeframe,
        generatedAt: new Date().toISOString(),
        monitoring
      });
    }
  } catch (error) {
    logError(error, 'Erro ao monitorar serviços:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔧 Service Health Check
router.get('/api/monitoring/health', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    const healthChecks = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      checks: {}
    };

    // Health check rápido para cada serviço
    try {
      // Redis health check
      const redisClient = redisPool.getConnection();
      await redisClient.ping();
      healthChecks.checks.redis = { status: 'healthy', responseTime: Date.now() };
    } catch (error) {
      healthChecks.checks.redis = { status: 'unhealthy', error: error.message };
      healthChecks.status = 'degraded';
    }

    // Firebase health check
    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const startTime = Date.now();
        await db.ref('.info/connected').once('value');
        healthChecks.checks.firebase = {
          status: 'healthy',
          responseTime: Date.now() - startTime + 'ms'
        };
      } else {
        healthChecks.checks.firebase = { status: 'unavailable' };
      }
    } catch (error) {
      healthChecks.checks.firebase = { status: 'unhealthy', error: error.message };
      healthChecks.status = 'degraded';
    }

    // Sistema health check
    const os = require('os');
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;

    healthChecks.checks.system = {
      status: memoryUsage < 85 ? 'healthy' : 'warning',
      memory: {
        usage: memoryUsage.toFixed(2) + '%',
        free: (freeMem / 1024 / 1024 / 1024).toFixed(2) + 'GB',
        total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + 'GB'
      },
      cpu: {
        loadAvg: os.loadavg().map(load => load.toFixed(2))
      }
    };

    if (memoryUsage > 85) {
      healthChecks.status = 'warning';
    }

    // WebSocket health check
    const websocketConnections = global.io ? global.io.engine.clientsCount : 0;
    healthChecks.checks.websocket = {
      status: 'healthy',
      connections: websocketConnections,
      maxConnections: 1000
    };

    res.json(healthChecks);
  } catch (error) {
    logError(error, 'Erro no health check:', { service: 'dashboard-routes' });
    res.status(500).json({
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      error: error.message
    });
  }
});

// 🔧 Service Performance Metrics
router.get('/api/monitoring/performance', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    const { period = '1h' } = req.query;

    let performance = {
      summary: {},
      metrics: {},
      trends: []
    };

    // Calcular período
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case '1h':
        startDate.setHours(now.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(now.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
    }

    // Métricas de performance (simuladas - em produção viriam de monitoramento real)
    const performanceData = await collectPerformanceMetrics(startDate, now);

    performance = {
      summary: {
        period,
        avgResponseTime: performanceData.avgResponseTime,
        totalRequests: performanceData.totalRequests,
        errorRate: performanceData.errorRate,
        uptime: performanceData.uptime
      },
      metrics: {
        redis: {
          avgResponseTime: '2.3ms',
          operationsPerSecond: 1250,
          memoryUsage: '45.2MB',
          hitRate: '94.5%',
          connections: 12
        },
        firebase: {
          avgResponseTime: '89ms',
          readsPerMinute: 156,
          writesPerMinute: 34,
          bandwidth: '2.1MB/min',
          concurrentConnections: 23
        },
        googleApis: {
          mapsApi: {
            avgResponseTime: '145ms',
            requestsPerDay: 1234,
            quotaUsed: '12.3%',
            errorRate: '0.02%'
          },
          geocoding: {
            avgResponseTime: '98ms',
            requestsPerDay: 567,
            quotaUsed: '5.67%',
            errorRate: '0.01%'
          }
        },
        system: {
          cpu: {
            usage: '23.4%',
            loadAvg: [0.45, 0.52, 0.48]
          },
          memory: {
            usage: '67.8%',
            available: '2.1GB'
          },
          disk: {
            usage: '34.2%',
            iops: 145
          },
          network: {
            bytesIn: '1.2MB/min',
            bytesOut: '2.8MB/min'
          }
        }
      },
      trends: generatePerformanceTrends(period)
    };

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      performance
    });
  } catch (error) {
    logError(error, 'Erro ao buscar métricas de performance:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Growth Analytics - ANALYTICS DE CRESCIMENTO COM PERCENTUAIS E TENDÊNCIAS
router.get('/api/analytics/growth', async (req, res) => {
  try {
    const {
      period = '30d', // '7d', '30d', '90d', '1y'
      metric = 'all' // 'users', 'revenue', 'trips', 'drivers', 'all'
    } = req.query;

    let growthAnalytics = {
      summary: {},
      growth: {},
      trends: {},
      forecasts: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {

        // Calcular períodos
        const now = new Date();
        let startDate = new Date();
        let compareStartDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            compareStartDate.setDate(now.getDate() - 14);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            compareStartDate.setDate(now.getDate() - 60);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            compareStartDate.setDate(now.getDate() - 180);
            break;
          case '1y':
            startDate.setFullYear(now.getFullYear() - 1);
            compareStartDate.setFullYear(now.getFullYear() - 2);
            break;
        }

        // Buscar dados
        const [users, bookingRecords] = await Promise.all([
          userStore.listUsers(firebaseConfig.getFirestore()),
          rideAnnotationStore.listAnnotations(firebaseConfig.getFirestore(), 'bookings')
        ]);

        const bookings = bookingRecords || {};

        // Análise de crescimento de usuários
        const userGrowth = analyzeUserGrowth(users, startDate, now, compareStartDate);

        // Análise de crescimento de receita
        const revenueGrowth = analyzeRevenueGrowth(bookings, startDate, now, compareStartDate);

        // Análise de crescimento de corridas
        const tripGrowth = analyzeTripGrowth(bookings, startDate, now, compareStartDate);

        // Análise de crescimento de motoristas
        const driverGrowth = analyzeDriverGrowth(users, startDate, now, compareStartDate);

        // Tendências por período
        const trends = generateGrowthTrends(users, bookings, startDate, now, period);

        // Previsões
        const forecasts = generateGrowthForecasts(trends, period);

        growthAnalytics = {
          summary: {
            period,
            totalUsers: Object.keys(users).length,
            totalDrivers: Object.values(users).filter(u => u.usertype === 'driver').length,
            totalCustomers: Object.values(users).filter(u => u.usertype === 'customer').length,
            totalTrips: Object.keys(bookings).length,
            totalRevenue: Object.values(bookings)
              .filter(b => b.status === 'COMPLETE' || b.status === 'PAID')
              .reduce((sum, b) => sum + resolveRideRevenue(b), 0).toFixed(2),
            generatedAt: new Date().toISOString()
          },
          growth: {
            users: userGrowth,
            revenue: revenueGrowth,
            trips: tripGrowth,
            drivers: driverGrowth
          },
          trends,
          forecasts
        };

        // Filtrar por métrica específica se solicitado
        if (metric !== 'all') {
          const filteredGrowth = {};
          filteredGrowth[metric] = growthAnalytics.growth[metric];
          growthAnalytics.growth = filteredGrowth;
        }
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar analytics de crescimento:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      metric,
      generatedAt: new Date().toISOString(),
      analytics: growthAnalytics
    });
  } catch (error) {
    logError(error, 'Erro ao gerar analytics de crescimento:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Growth Insights & Recommendations
router.get('/api/analytics/growth/insights', async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let insights = {
      keyInsights: [],
      recommendations: [],
      alerts: [],
      opportunities: []
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {

        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        const [users, bookingRecords] = await Promise.all([
          userStore.listUsers(firebaseConfig.getFirestore()),
          rideAnnotationStore.listAnnotations(firebaseConfig.getFirestore(), 'bookings')
        ]);

        const bookings = bookingRecords || {};

        // Análise de insights
        insights = generateGrowthInsights(users, bookings, startDate, now, period);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar insights de crescimento:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      insights
    });
  } catch (error) {
    logError(error, 'Erro ao gerar insights de crescimento:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Growth Cohort Analysis
router.get('/api/analytics/growth/cohorts', async (req, res) => {
  try {
    const {
      cohortType = 'monthly', // 'weekly', 'monthly'
      metric = 'retention' // 'retention', 'revenue'
    } = req.query;

    let cohortAnalysis = {
      cohorts: [],
      summary: {},
      insights: []
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {

        const [users, bookingRecords] = await Promise.all([
          userStore.listUsers(firebaseConfig.getFirestore()),
          rideAnnotationStore.listAnnotations(firebaseConfig.getFirestore(), 'bookings')
        ]);

        const bookings = bookingRecords || {};

        cohortAnalysis = generateCohortAnalysis(users, bookings, cohortType, metric);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar análise de coorte:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      cohortType,
      metric,
      generatedAt: new Date().toISOString(),
      analysis: cohortAnalysis
    });
  } catch (error) {
    logError(error, 'Erro ao gerar análise de coorte:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
