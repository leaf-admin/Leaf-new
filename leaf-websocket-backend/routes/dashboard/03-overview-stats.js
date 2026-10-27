const readBudget = require('../../utils/metrics-read-budget');
// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Assinaturas, listas ativas e indicadores do painel

const {
  userStore,
  RedisScan,
  buildRecentRideActivities,
  calculateAverageTripTime,
  calculateAverageWaitTime,
  firebaseConfig,
  loadBookingHashes,
  logError,
  logStructured,
  modernMetricsService,
  redisPool,
  rejectDashboardMockEndpointInProduction,
  resolveRideRevenue,
  router,
  sampleRedisKeys,
  rideAnnotationStore
} = require('./shared');

// 💳 Subscriptions
router.get('/api/subscriptions', async (req, res) => {
  try {
    if (rejectDashboardMockEndpointInProduction(req, res, 'subscriptions_mock')) {
      return;
    }

    const subscriptions = [
      {
        id: 'sub1',
        driver: {
          name: 'João Silva',
          email: 'joao@email.com',
          vehicle: { model: 'Honda Civic', plate: 'ABC-1234' }
        },
        plan: {
          name: 'Plano Semanal Premium',
          price: 49.90,
          duration: 'weekly'
        },
        status: 'active',
        startDate: '2024-01-01',
        endDate: '2024-01-08',
        totalPaid: 199.60,
        autoRenewal: true
      }
    ];

    res.json(subscriptions);
  } catch (error) {
    logError(error, 'Erro ao buscar assinaturas:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

router.get('/api/subscriptions/stats', async (req, res) => {
  try {
    if (rejectDashboardMockEndpointInProduction(req, res, 'subscriptions_stats_mock')) {
      return;
    }

    const stats = {
      total: 234,
      active: 187,
      expired: 23,
      cancelled: 15,
      pending: 7,
      suspended: 2,
      revenue: {
        total: 28450.30,
        weekly: 18200.50,
        monthly: 10249.80,
        growth: 12.5
      },
      churnRate: 8.2,
      renewalRate: 84.5,
      avgLifetime: 3.8
    };

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de assinaturas:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

// 🗺️ Live Map Data
router.get('/api/drivers/active', async (req, res) => {
  try {
    const drivers = [
      {
        id: 'driver1',
        name: 'João Silva',
        lat: -23.5505,
        lng: -46.6333,
        status: 'available',
        vehicle: { model: 'Honda Civic', plate: 'ABC-1234' },
        rating: 4.8,
        tripsToday: 12
      }
    ];

    res.json(drivers);
  } catch (error) {
    logError(error, 'Erro ao buscar motoristas ativos:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

router.get('/api/passengers/active', async (req, res) => {
  try {
    const passengers = [
      {
        id: 'passenger1',
        name: 'Carlos Oliveira',
        lat: -23.5405,
        lng: -46.6405,
        status: 'waiting',
        waitingTime: 3
      }
    ];

    res.json(passengers);
  } catch (error) {
    logError(error, 'Erro ao buscar passageiros ativos:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

router.get('/api/trips/active', async (req, res) => {
  try {
    const trips = [
      {
        id: 'trip1',
        driverId: 'driver1',
        passengerId: 'passenger1',
        pickup: { lat: -23.5405, lng: -46.6405, address: 'Av. Paulista, 1000' },
        destination: { lat: -23.5705, lng: -46.6505, address: 'Shopping Ibirapuera' },
        status: 'in_progress',
        estimatedTime: 15,
        distance: 8.5,
        fare: 25.50
      }
    ];

    res.json(trips);
  } catch (error) {
    logError(error, 'Erro ao buscar corridas ativas:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

router.get('/api/live/stats', async (req, res) => {
  try {
    let stats = {
      driversOnline: 0,
      driversAvailable: 0,
      passengerWaiting: 0,
      activeTrips: 0,
      avgWaitTime: 0,
      avgTripTime: 0
    };

    try {
      const redis = redisPool.getConnection();

      // Dados reais do Redis
      const totalDrivers = await redis.zcard('driver_locations') || 0;
      const onlineUsers = await redis.scard('online_users') || 0;
      const activeBookings = await modernMetricsService.getActiveRidesCount();
      const availableDrivers = await redis.scard('available_drivers');
      // No keyspace scan or arbitrary sample called an exact average.
      const avgWaitTime = null;
      const avgTripTime = null;

      stats = {
        driversOnline: totalDrivers,
        driversAvailable: availableDrivers,
        passengerWaiting: Math.max(0, onlineUsers - totalDrivers), // Passageiros sem motorista
        activeTrips: activeBookings,
        avgWaitTime: avgWaitTime,
        avgTripTime: avgTripTime
      };

    } catch (redisError) {
      logStructured('warn', '⚠️ Redis não disponível para stats ao vivo:', redisError.message, { service: 'dashboard-routes' });
      throw readBudget.unavailable();
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats em tempo real:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

// 🔐 Authentication - Removido: Usar apenas Firebase Auth no frontend
// O dashboard agora usa Firebase Authentication diretamente
// Não há mais autenticação hardcoded por questões de segurança

// 📊 Dashboard Stats Endpoints
// Endpoints específicos para o dashboard frontend

// 🚗 Rides Stats
router.get('/api/rides/stats', async (req, res) => {
  try {
    const { period = 'today', startDate, endDate } = req.query || {};

    try {
      const stats = await modernMetricsService.getRidesStats({ period, startDate, endDate });
      return res.json(stats);
    } catch (modernError) {
      // Sem fallback legado: a fonte moderna é a única.
      throw readBudget.unavailable();
    }
  } catch (error) {
    logError(error, 'Erro ao buscar stats de corridas:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

// 💰 Revenue Stats
router.get('/api/revenue/stats', async (req, res) => {
  try {
    if (process.env.ENABLE_OPS_METRIC_READS === 'true') {
      const today = await modernMetricsService.getFinancialRidesStats({ period: 'today' });
      const month = await modernMetricsService.getFinancialRidesStats({ period: 'month' });
      return res.json({ todayRevenue: today.totalValue, monthlyRevenue: month.totalValue,
        averageTicket: month.averageValue, growthRate: 0, metadata: month.metadata });
    }

    let stats = {
      todayRevenue: 0,
      monthlyRevenue: 0,
      averageTicket: 0,
      growthRate: 0
    };

    try {
      if (firebaseConfig && firebaseConfig.getFirestore) {
        const bookingRecords = await readBudget.recordsSnapshot(limit => rideAnnotationStore.listAnnotations(firebaseConfig.getFirestore(), 'bookings', { limit }));
        const bookings = bookingRecords || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);

        const completedToday = bookingArray.filter(b => {
          const tripDate = new Date(b.tripdate || 0);
          return tripDate >= today && (b.status === 'COMPLETE' || b.status === 'PAID');
        });

        const completedThisMonth = bookingArray.filter(b => {
          const tripDate = new Date(b.tripdate || 0);
          return tripDate >= thisMonth && (b.status === 'COMPLETE' || b.status === 'PAID');
        });

        const todayRevenue = completedToday.reduce((sum, b) =>
          sum + resolveRideRevenue(b), 0
        );

        const monthlyRevenue = completedThisMonth.reduce((sum, b) =>
          sum + resolveRideRevenue(b), 0
        );

        stats = {
          todayRevenue,
          monthlyRevenue,
          averageTicket: completedThisMonth.length > 0 ? monthlyRevenue / completedThisMonth.length : 0,
          growthRate: 0
        };
      }
    } catch (error) {
      logError(error, 'Erro ao buscar stats de receita:', { service: 'dashboard-routes' });
      throw error;
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de receita:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

// 🔍 KYC Analytics Stats
router.get('/api/kyc-analytics/stats', async (req, res) => {
  try {
    let stats = {
      approved: 0,
      pending: 0,
      rejected: 0,
      successRate: 0
    };

    try {
      // Motoristas em users/{uid} no Firestore
      const firestore = firebaseConfig?.getFirestore?.();
      if (firestore) {
        const drivers = await readBudget.recordsSnapshot(limit => userStore.queryUsers(firestore, 'usertype', 'driver', { limit }));

        let approved = 0;
        let pending = 0;
        let rejected = 0;

        Object.keys(drivers).forEach(driverId => {
          const driver = drivers[driverId];
          // Verificar status de aprovação
          if (driver.approved === true || driver.approval_status === 'approved') {
            approved++;
          } else if (driver.approval_status === 'pending' || (!driver.approved && !driver.approval_status)) {
            pending++;
          } else if (driver.approval_status === 'rejected') {
            rejected++;
          }
        });

        const total = approved + pending + rejected;
        stats = {
          approved,
          pending,
          rejected,
          successRate: total > 0 ? (approved / total) * 100 : 0
        };
      }
    } catch (error) {
      logError(error, 'Erro ao buscar stats de KYC:', { service: 'dashboard-routes' });
      throw error;
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de KYC:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

// ⚙️ System Status
router.get('/api/system/status', async (req, res) => {
  try {
    const redis = redisPool.getConnection();

    let services = [
      {
        service: 'Redis',
        status: 'online',
        uptime: 0,
        latency: 0
      },
      {
        service: 'Firebase',
        status: 'online',
        uptime: 0,
        latency: 0
      },
      {
        service: 'WebSocket',
        status: 'online',
        uptime: 0,
        latency: 0
      }
    ];

    try {
      // Testar Redis
      const redisStart = Date.now();
      await redis.ping();
      const redisLatency = Date.now() - redisStart;
      services[0].latency = redisLatency;
      services[0].status = 'online';
    } catch (error) {
      services[0].status = 'offline';
    }

    try {
      // Firebase: cliente Firestore inicializado (sem leitura paga a cada consulta).
      if (firebaseConfig?.getFirestore?.()) {
        services[1].latency = 0;
        services[1].status = 'online';
      }
    } catch (error) {
      services[1].status = 'offline';
    }

    res.json(services);
  } catch (error) {
    logError(error, 'Erro ao buscar status do sistema:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});

// 📋 Recent Activity
router.get('/api/activity/recent', async (req, res) => {
  try {
    let activities = [];

    try {
      if (firebaseConfig && firebaseConfig.getFirestore) {
        const firestore = firebaseConfig.getFirestore();
        const modernSnapshot = await firestore
          .collection('rides')
          .orderBy('createdAt', 'desc')
          .limit(20)
          .get();

        const modernRides = modernSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        activities = buildRecentRideActivities(modernRides, 10);
      }
    } catch (error) {
      logError(error, 'Erro ao buscar atividades recentes:', { service: 'dashboard-routes' });
      throw error;
    }

    res.json(activities);
  } catch (error) {
    logError(error, 'Erro ao buscar atividades recentes:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 503 ? 'Métricas temporariamente indisponíveis' : 'Erro interno do servidor' });
  }
});
