const express = require('express');
const admin = require('firebase-admin');
const { logger, logStructured, logError } = require('../utils/logger');
const Redis = require('ioredis');

const router = express.Router();

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'metrics-routes' });
}

const landingMetricsRef = admin.firestore().collection('metrics').doc('landing');

const getLandingMetrics = async () => {
  const snapshot = await landingMetricsRef.get();

  if (!snapshot.exists) {
    return {
      waitlistCount: 0,
      calculatorSimulations: 0,
      updatedAt: null
    };
  }

  const data = snapshot.data();

  return {
    waitlistCount: data.waitlistCount || 0,
    calculatorSimulations: data.calculatorSimulations || 0,
    updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null
  };
};

router.post('/api/metrics/calculator', async (req, res) => {
  try {
    await landingMetricsRef.set({
      calculatorSimulations: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao registrar simulação da calculadora:', error);
    res.status(500).json({ error: 'Erro ao registrar métrica' });
  }
});

router.get('/api/metrics/overview', async (req, res) => {
  try {
    const metrics = await getLandingMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Erro ao buscar métricas da landing:', error);
    res.status(500).json({ error: 'Erro ao buscar métricas' });
  }
});

// ==========================================
// 📊 MÉTRICAS DE CORRIDAS
// ==========================================

// GET /api/metrics/rides/daily - Corridas realizadas no dia e % canceladas (após motorista aceitar)
router.get('/api/metrics/rides/daily', async (req, res) => {
  try {
    let stats = {
      totalToday: 0,
      completedToday: 0,
      cancelledAfterAcceptance: 0,
      cancellationRate: 0,
      activeRides: 0
    };

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json(stats);
    }

    const db = firebaseConfig.getRealtimeDB();

    // Buscar todas as corridas
    const bookingsSnapshot = await db.ref('bookings').once('value');
    const bookings = bookingsSnapshot.val() || {};
    const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

    // Filtrar corridas do dia atual
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const todayBookings = bookingArray.filter(booking => {
      const tripDate = booking.tripdate ? new Date(booking.tripdate) :
        booking.createdAt ? new Date(booking.createdAt) : null;
      if (!tripDate) return false;
      return tripDate >= todayStart && tripDate < todayEnd;
    });

    stats.totalToday = todayBookings.length;

    // Corridas completadas hoje
    const completedToday = todayBookings.filter(b =>
      b.status === 'COMPLETE' || b.status === 'PAID' || b.status === 'COMPLETED'
    );
    stats.completedToday = completedToday.length;

    // Corridas canceladas APÓS motorista aceitar (status estava em ACCEPTED, ARRIVED, IN_PROGRESS)
    const cancelledAfterAcceptance = todayBookings.filter(b => {
      if (b.status !== 'CANCELLED' && b.status !== 'CANCELED') return false;
      // Verificar se tinha driver atribuído (motorista aceitou)
      return b.driver && b.driver !== '' && b.driver !== null;
    });
    stats.cancelledAfterAcceptance = cancelledAfterAcceptance.length;

    // Calcular taxa de cancelamento (após aceitar)
    if (stats.totalToday > 0) {
      const totalAccepted = todayBookings.filter(b => b.driver && b.driver !== '').length;
      stats.cancellationRate = totalAccepted > 0
        ? parseFloat((stats.cancelledAfterAcceptance / totalAccepted * 100).toFixed(2))
        : 0;
    }

    // Corridas ativas (SEARCHING, ACCEPTED, ARRIVED, IN_PROGRESS)
    const activeStatuses = ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'MATCHED'];
    stats.activeRides = bookingArray.filter(b =>
      activeStatuses.includes(b.status)
    ).length;

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas de corridas diárias:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 👥 MÉTRICAS DE USUÁRIOS
// ==========================================

// GET /api/metrics/users/status - Customers e motoristas cadastrados, online e offline
router.get('/api/metrics/users/status', async (req, res) => {
  try {
    let stats = {
      customers: {
        total: 0,
        online: 0,
        offline: 0
      },
      drivers: {
        total: 0,
        online: 0,
        offline: 0
      },
      newCustomersToday: 0,
      newDriversToday: 0
    };

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json(stats);
    }

    const db = firebaseConfig.getRealtimeDB();
    const redis = new Redis(process.env.REDIS_URL || 'redis://redis-master:6379');

    try {
      // Buscar usuários do Firebase
      const usersSnapshot = await db.ref('users').once('value');
      const users = usersSnapshot.val() || {};
      const userArray = Object.keys(users).map(key => ({ id: key, ...users[key] }));

      // Separar customers e drivers
      const customers = userArray.filter(user => user.usertype === 'customer');
      const drivers = userArray.filter(user => user.usertype === 'driver');

      stats.customers.total = customers.length;
      stats.drivers.total = drivers.length;

      // Verificar usuários online no Redis
      // Padrão: online_users contém IDs dos usuários online
      const onlineUsersSet = await redis.smembers('online_users').catch(() => []);
      const onlineUsers = new Set(onlineUsersSet || []);

      // Verificar drivers online (pode estar em outra chave)
      const onlineDriversSet = await redis.smembers('online_drivers').catch(() => []);
      const onlineDrivers = new Set(onlineDriversSet || []);

      // Contar customers online/offline
      const customersOnline = customers.filter(c =>
        onlineUsers.has(c.id) || c.status === 'online'
      ).length;
      stats.customers.online = customersOnline;
      stats.customers.offline = stats.customers.total - customersOnline;

      // Contar drivers online/offline
      const driversOnline = drivers.filter(d =>
        onlineDrivers.has(d.id) || onlineUsers.has(d.id) || d.status === 'online'
      ).length;
      stats.drivers.online = driversOnline;
      stats.drivers.offline = stats.drivers.total - driversOnline;

      // Novos usuários hoje
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      const newCustomersToday = customers.filter(c => {
        const createdAt = c.createdAt ? new Date(c.createdAt) : null;
        return createdAt && createdAt >= todayStart;
      }).length;
      stats.newCustomersToday = newCustomersToday;

      const newDriversToday = drivers.filter(d => {
        const createdAt = d.createdAt ? new Date(d.createdAt) : null;
        return createdAt && createdAt >= todayStart;
      }).length;
      stats.newDriversToday = newDriversToday;

      await redis.disconnect();
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar status de usuários:', error.message, { service: 'metrics-routes' });
      if (redis && !redis.status.includes('end')) {
        await redis.disconnect();
      }
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas de usuários:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 💰 MÉTRICAS FINANCEIRAS - VALOR TOTAL CORRIDAS
// ==========================================

// GET /api/metrics/financial/rides - Valor total das corridas com filtros temporais
router.get('/api/metrics/financial/rides', async (req, res) => {
  try {
    const { period = 'today', startDate, endDate } = req.query;

    let stats = {
      totalValue: 0,
      totalRides: 0,
      averageValue: 0,
      reserveFundLosses: 0,
      period: period,
      startDate: null,
      endDate: null
    };

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json(stats);
    }

    const db = firebaseConfig.getRealtimeDB();
    const redis = new Redis(process.env.REDIS_URL || 'redis://redis-master:6379');

    // Buscar corridas
    const bookingsSnapshot = await db.ref('bookings').once('value');
    const bookings = bookingsSnapshot.val() || {};
    const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

    // Filtrar por período
    const now = new Date();
    let start = new Date();
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    if (period === 'custom' && startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else if (period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    stats.startDate = start.toISOString();
    stats.endDate = end.toISOString();

    // Filtrar corridas completadas no período
    const completedBookings = bookingArray.filter(booking => {
      const tripDate = booking.tripdate ? new Date(booking.tripdate) :
        booking.createdAt ? new Date(booking.createdAt) : null;
      if (!tripDate) return false;

      const isCompleted = booking.status === 'COMPLETE' ||
        booking.status === 'PAID' ||
        booking.status === 'COMPLETED';

      return isCompleted && tripDate >= start && tripDate <= end;
    });

    // Calcular valores
    stats.totalRides = completedBookings.length;

    stats.totalValue = completedBookings.reduce((sum, booking) => {
      const value = parseFloat(booking.customer_paid || booking.total_fare || booking.fare || 0);
      return sum + value;
    }, 0);

    stats.averageValue = stats.totalRides > 0
      ? parseFloat((stats.totalValue / stats.totalRides).toFixed(2))
      : 0;

    try {
      // Buscar fundo de reserva (perdas pré-aceitação) do Redis
      const costStr = await redis.hget('metrics:financial', 'assumed_cancellation_costs');
      if (costStr) {
        stats.reserveFundLosses = parseFloat(costStr);
      }
      await redis.disconnect();
    } catch (redisErr) {
      // Falha silenciosa no banco de dados em memória
      if (redis && !redis.status.includes('end')) {
        await redis.disconnect();
      }
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas financeiras de corridas:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 💳 MÉTRICAS FINANCEIRAS - TAXA OPERACIONAL
// ==========================================

// GET /api/metrics/financial/operational-fee - Taxa operacional cobrada com filtros temporais
router.get('/api/metrics/financial/operational-fee', async (req, res) => {
  try {
    const { period = 'today', startDate, endDate } = req.query;

    let stats = {
      totalOperationalFee: 0,
      totalRides: 0,
      averageFee: 0,
      period: period,
      startDate: null,
      endDate: null
    };

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json(stats);
    }

    const db = firebaseConfig.getRealtimeDB();

    // Buscar corridas
    const bookingsSnapshot = await db.ref('bookings').once('value');
    const bookings = bookingsSnapshot.val() || {};
    const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

    // Filtrar por período
    const now = new Date();
    let start = new Date();
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    if (period === 'custom' && startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else if (period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    stats.startDate = start.toISOString();
    stats.endDate = end.toISOString();

    // Filtrar corridas completadas no período
    const completedBookings = bookingArray.filter(booking => {
      const tripDate = booking.tripdate ? new Date(booking.tripdate) :
        booking.createdAt ? new Date(booking.createdAt) : null;
      if (!tripDate) return false;

      const isCompleted = booking.status === 'COMPLETE' ||
        booking.status === 'PAID' ||
        booking.status === 'COMPLETED';

      return isCompleted && tripDate >= start && tripDate <= end;
    });

    stats.totalRides = completedBookings.length;

    // Calcular taxa operacional (convenience_fees ou diferença entre customer_paid e driver_share)
    stats.totalOperationalFee = completedBookings.reduce((sum, booking) => {
      // Prioridade: convenience_fees > (customer_paid - driver_share)
      let fee = 0;

      if (booking.convenience_fees) {
        fee = parseFloat(booking.convenience_fees);
      } else {
        const customerPaid = parseFloat(booking.customer_paid || booking.total_fare || 0);
        const driverShare = parseFloat(booking.driver_share || 0);
        fee = customerPaid - driverShare;
      }

      return sum + fee;
    }, 0);

    stats.averageFee = stats.totalRides > 0
      ? parseFloat((stats.totalOperationalFee / stats.totalRides).toFixed(2))
      : 0;

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar taxa operacional:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 🗺️ MAPAS - CORRIDAS POR REGIÃO
// ==========================================

// GET /api/metrics/maps/rides-by-region - Corridas por região
router.get('/api/metrics/maps/rides-by-region', async (req, res) => {
  try {
    let regions = {};

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json({ regions: {} });
    }

    const db = firebaseConfig.getRealtimeDB();

    // Buscar corridas
    const bookingsSnapshot = await db.ref('bookings').once('value');
    const bookings = bookingsSnapshot.val() || {};
    const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

    // Agrupar por região (usar cidade ou região geográfica)
    bookingArray.forEach(booking => {
      // Tentar identificar região pela localização ou cidade
      let regionKey = 'unknown';

      if (booking.region) {
        regionKey = booking.region;
      } else if (booking.city) {
        regionKey = booking.city;
      } else if (booking.pickupLocation) {
        // Usar coordenadas para agrupar em regiões (simplificado)
        try {
          const pickup = typeof booking.pickupLocation === 'string'
            ? JSON.parse(booking.pickupLocation)
            : booking.pickupLocation;

          if (pickup && pickup.lat && pickup.lng) {
            // Agrupar por grid aproximado (ex: -22.9 -> -22.9x-43.1)
            const latGrid = Math.floor(pickup.lat * 10) / 10;
            const lngGrid = Math.floor(pickup.lng * 10) / 10;
            regionKey = `${latGrid}x${lngGrid}`;
          }
        } catch (e) {
          // Ignorar erro de parsing
        }
      }

      if (!regions[regionKey]) {
        regions[regionKey] = {
          region: regionKey,
          totalRides: 0,
          completedRides: 0,
          activeRides: 0,
          cancelledRides: 0,
          totalValue: 0,
          coordinates: null
        };
      }

      regions[regionKey].totalRides++;

      if (booking.status === 'COMPLETE' || booking.status === 'PAID' || booking.status === 'COMPLETED') {
        regions[regionKey].completedRides++;
        const value = parseFloat(booking.customer_paid || booking.total_fare || 0);
        regions[regionKey].totalValue += value;
      } else if (booking.status === 'CANCELLED' || booking.status === 'CANCELED') {
        regions[regionKey].cancelledRides++;
      } else {
        regions[regionKey].activeRides++;
      }

      // Armazenar coordenadas se disponível
      if (!regions[regionKey].coordinates && booking.pickupLocation) {
        try {
          const pickup = typeof booking.pickupLocation === 'string'
            ? JSON.parse(booking.pickupLocation)
            : booking.pickupLocation;

          if (pickup && pickup.lat && pickup.lng) {
            regions[regionKey].coordinates = {
              lat: pickup.lat,
              lng: pickup.lng
            };
          }
        } catch (e) {
          // Ignorar
        }
      }
    });

    res.json({ regions: Object.values(regions) });
  } catch (error) {
    logError(error, 'Erro ao buscar corridas por região:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 🗺️ MAPAS - DEMANDA POR REGIÃO
// ==========================================

// GET /api/metrics/maps/demand-by-region - Demanda (passageiros online x motoristas online por região)
router.get('/api/metrics/maps/demand-by-region', async (req, res) => {
  try {
    let regions = {};

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json({ regions: {} });
    }

    const db = firebaseConfig.getRealtimeDB();
    const redis = new Redis(process.env.REDIS_URL || 'redis://redis-master:6379');

    try {
      // Buscar usuários
      const usersSnapshot = await db.ref('users').once('value');
      const users = usersSnapshot.val() || {};

      // Buscar localizações ativas (do Redis ou Firebase)
      const onlineUsersSet = await redis.smembers('online_users').catch(() => []);
      const onlineUsers = new Set(onlineUsersSet || []);

      // Agrupar por região
      Object.keys(users).forEach(userId => {
        const user = users[userId];
        const isOnline = onlineUsers.has(userId);

        if (!isOnline) return; // Apenas usuários online

        // Identificar região do usuário
        let regionKey = 'unknown';

        if (user.city) {
          regionKey = user.city;
        } else if (user.currentLocation) {
          try {
            const location = typeof user.currentLocation === 'string'
              ? JSON.parse(user.currentLocation)
              : user.currentLocation;

            if (location && location.lat && location.lng) {
              const latGrid = Math.floor(location.lat * 10) / 10;
              const lngGrid = Math.floor(location.lng * 10) / 10;
              regionKey = `${latGrid}x${lngGrid}`;
            }
          } catch (e) {
            // Ignorar
          }
        }

        if (!regions[regionKey]) {
          regions[regionKey] = {
            region: regionKey,
            customersOnline: 0,
            driversOnline: 0,
            demandRatio: 0, // customers/drivers
            coordinates: null
          };
        }

        if (user.usertype === 'customer') {
          regions[regionKey].customersOnline++;
        } else if (user.usertype === 'driver') {
          regions[regionKey].driversOnline++;
        }

        // Armazenar coordenadas
        if (!regions[regionKey].coordinates && user.currentLocation) {
          try {
            const location = typeof user.currentLocation === 'string'
              ? JSON.parse(user.currentLocation)
              : user.currentLocation;

            if (location && location.lat && location.lng) {
              regions[regionKey].coordinates = {
                lat: location.lat,
                lng: location.lng
              };
            }
          } catch (e) {
            // Ignorar
          }
        }
      });

      // Calcular razão de demanda
      Object.keys(regions).forEach(regionKey => {
        const region = regions[regionKey];
        if (region.driversOnline > 0) {
          region.demandRatio = parseFloat((region.customersOnline / region.driversOnline).toFixed(2));
        } else {
          region.demandRatio = region.customersOnline > 0 ? 999 : 0; // Alta demanda, sem motoristas
        }
      });

      await redis.disconnect();
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar demanda por região:', error.message, { service: 'metrics-routes' });
      if (redis && !redis.status.includes('end')) {
        await redis.disconnect();
      }
    }

    res.json({ regions: Object.values(regions) });
  } catch (error) {
    logError(error, 'Erro ao buscar demanda por região:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 💳 MOTORISTAS ASSINANTES ATIVOS
// ==========================================

// GET /api/metrics/subscriptions/active - Motoristas assinantes ativos
router.get('/api/metrics/subscriptions/active', async (req, res) => {
  try {
    let stats = {
      totalActiveSubscriptions: 0,
      subscriptionsByPlan: {},
      totalWeeklyRevenue: 0,
      overdueSubscriptions: 0
    };

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json(stats);
    }

    const db = firebaseConfig.getRealtimeDB();

    // Buscar motoristas
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val() || {};

    // Buscar assinaturas
    const subscriptionsSnapshot = await db.ref('subscriptions').once('value');
    const subscriptions = subscriptionsSnapshot.val() || {};

    const now = new Date();

    Object.keys(users).forEach(userId => {
      const user = users[userId];
      if (user.usertype !== 'driver') return;

      // Verificar se tem assinatura ativa
      const subscription = subscriptions[userId];
      let isActive = false;
      let planType = 'none';
      let weeklyFee = 0;

      if (subscription) {
        // Verificar status da assinatura
        if (subscription.status === 'active') {
          isActive = true;
          planType = subscription.planType || 'plus';
          weeklyFee = parseFloat(subscription.weeklyFee || 0);
        } else if (subscription.status === 'overdue') {
          stats.overdueSubscriptions++;
        }
      } else {
        // Verificar trial ou meses grátis
        const freeTrialEnd = user.free_trial_end ? new Date(user.free_trial_end) : null;
        const freeMonthsEnd = user.free_months_end ? new Date(user.free_months_end) : null;

        if ((freeTrialEnd && now < freeTrialEnd) || (freeMonthsEnd && now < freeMonthsEnd)) {
          isActive = true;
          planType = 'trial';
          weeklyFee = 0;
        }
      }

      if (isActive) {
        stats.totalActiveSubscriptions++;

        if (!stats.subscriptionsByPlan[planType]) {
          stats.subscriptionsByPlan[planType] = 0;
        }
        stats.subscriptionsByPlan[planType]++;

        stats.totalWeeklyRevenue += weeklyFee;
      }
    });

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar assinaturas ativas:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 📋 LISTA DE ESPERA LANDING PAGE
// ==========================================

// GET /api/metrics/waitlist/landing - Lista de espera da landing page
router.get('/api/metrics/waitlist/landing', async (req, res) => {
  try {
    let waitlist = [];
    let stats = {
      total: 0,
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      byCity: {}
    };

    if (!firebaseConfig || !firebaseConfig.getFirestore) {
      return res.json({ waitlist: [], stats });
    }

    const firestore = firebaseConfig.getFirestore();

    try {
      // Buscar da coleção waitlist_landing
      const waitlistSnapshot = await firestore.collection('waitlist_landing').get();

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      waitlistSnapshot.forEach(doc => {
        const data = doc.data();
        const timestamp = data.timestamp ? data.timestamp.toDate() : null;

        waitlist.push({
          id: doc.id,
          nome: data.nome || '',
          celular: data.celular || '',
          cidade: data.cidade || '',
          timestamp: timestamp ? timestamp.toISOString() : null,
          status: data.status || 'pending',
          origem: data.origem || 'landing_page'
        });

        stats.total++;

        if (timestamp && timestamp >= todayStart) {
          stats.today++;
        }
        if (timestamp && timestamp >= weekStart) {
          stats.thisWeek++;
        }
        if (timestamp && timestamp >= monthStart) {
          stats.thisMonth++;
        }

        // Agrupar por cidade
        const cidade = data.cidade || 'Não informado';
        if (!stats.byCity[cidade]) {
          stats.byCity[cidade] = 0;
        }
        stats.byCity[cidade]++;
      });

      // Ordenar por data mais recente
      waitlist.sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });

    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar lista de espera do Firestore:', error.message, { service: 'metrics-routes' });
    }

    res.json({ waitlist, stats });
  } catch (error) {
    logError(error, 'Erro ao buscar lista de espera:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================================
// 📊 ESTATÍSTICAS DE ACESSO LANDING PAGE
// ==========================================

// GET /api/metrics/landing-page/analytics - Estatísticas de acesso à landing page
router.get('/api/metrics/landing-page/analytics', async (req, res) => {
  try {
    let stats = {
      totalViews: 0,
      todayViews: 0,
      weekViews: 0,
      monthViews: 0,
      uniqueVisitors: 0,
      conversions: 0, // Cadastros na waitlist
      conversionRate: 0,
      byDate: {},
      byHour: {}
    };

    if (!firebaseConfig || !firebaseConfig.getFirestore) {
      return res.json(stats);
    }

    const firestore = firebaseConfig.getFirestore();

    try {
      // Buscar analytics da landing page (se existir coleção)
      // Se não existir, vamos usar os dados da waitlist como proxy de conversão
      const analyticsSnapshot = await firestore.collection('landing_page_analytics').get();

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const uniqueVisitorsSet = new Set();

      analyticsSnapshot.forEach(doc => {
        const data = doc.data();
        const timestamp = data.timestamp ? data.timestamp.toDate() : null;

        if (!timestamp) return;

        stats.totalViews++;

        if (timestamp >= todayStart) {
          stats.todayViews++;
        }
        if (timestamp >= weekStart) {
          stats.weekViews++;
        }
        if (timestamp >= monthStart) {
          stats.monthViews++;
        }

        // Unique visitors
        if (data.visitorId) {
          uniqueVisitorsSet.add(data.visitorId);
        }

        // Agrupar por data
        const dateKey = timestamp.toISOString().split('T')[0];
        if (!stats.byDate[dateKey]) {
          stats.byDate[dateKey] = 0;
        }
        stats.byDate[dateKey]++;

        // Agrupar por hora
        const hourKey = timestamp.getHours();
        if (!stats.byHour[hourKey]) {
          stats.byHour[hourKey] = 0;
        }
        stats.byHour[hourKey]++;
      });

      stats.uniqueVisitors = uniqueVisitorsSet.size;

      // Buscar conversões (cadastros na waitlist)
      const waitlistSnapshot = await firestore.collection('waitlist_landing')
        .where('origem', '==', 'landing_page')
        .get();

      stats.conversions = waitlistSnapshot.size;

      // Calcular taxa de conversão
      if (stats.totalViews > 0) {
        stats.conversionRate = parseFloat((stats.conversions / stats.totalViews * 100).toFixed(2));
      }

    } catch (error) {
      // Se não existir a coleção, usar dados básicos
      logStructured('warn', '⚠️ Coleção landing_page_analytics não encontrada, usando dados básicos', { service: 'metrics-routes' });

      // Tentar buscar pelo menos as conversões da waitlist
      try {
        const waitlistSnapshot = await firestore.collection('waitlist_landing').get();
        stats.conversions = waitlistSnapshot.size;
      } catch (e) {
        // Ignorar
      }
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar analytics da landing page:', { service: 'metrics-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ✅ NOVO: Histórico de Métricas
const MetricsHistoryService = require('../services/metrics-history-service');
const metricsHistoryService = new MetricsHistoryService();

// GET /api/metrics/history - Buscar histórico de métricas
router.get('/api/metrics/history', async (req, res) => {
  try {
    const { startDate, endDate, granularity = 'hour' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'startDate e endDate são obrigatórios (formato: YYYY-MM-DD)'
      });
    }

    const history = await metricsHistoryService.getHistory(startDate, endDate, granularity);

    res.json({
      success: true,
      data: history,
      count: history.length,
      period: {
        start: startDate,
        end: endDate,
        granularity
      }
    });
  } catch (error) {
    logError(error, '❌ Erro ao buscar histórico:', { service: 'metrics-routes' });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/metrics/history/compare - Comparar dois períodos
router.get('/api/metrics/history/compare', async (req, res) => {
  try {
    const {
      period1Start,
      period1End,
      period2Start,
      period2End
    } = req.query;

    if (!period1Start || !period1End || !period2Start || !period2End) {
      return res.status(400).json({
        error: 'Todos os parâmetros de período são obrigatórios (formato: YYYY-MM-DD)'
      });
    }

    const comparison = await metricsHistoryService.comparePeriods(
      period1Start,
      period1End,
      period2Start,
      period2End
    );

    if (!comparison) {
      return res.status(404).json({
        error: 'Dados insuficientes para comparação'
      });
    }

    res.json({
      success: true,
      data: comparison
    });
  } catch (error) {
    logError(error, '❌ Erro ao comparar períodos:', { service: 'metrics-routes' });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/metrics/history/save - Salvar snapshot manual (para testes)
router.post('/api/metrics/history/save', async (req, res) => {
  try {
    const metricsData = req.body.metrics || req.body;

    const result = await metricsHistoryService.saveMetricsSnapshot(metricsData);

    res.json({
      success: true,
      message: 'Snapshot salvo com sucesso',
      data: result
    });
  } catch (error) {
    logError(error, '❌ Erro ao salvar snapshot:', { service: 'metrics-routes' });
    res.status(500).json({ error: error.message });
  }
});

// ✅ NOVO: Sistema de Relatórios
const ReportService = require('../services/report-service');
const reportService = new ReportService();

// GET /api/reports/predefined - Listar relatórios pré-configurados
router.get('/api/reports/predefined', async (req, res) => {
  try {
    const reports = reportService.getPredefinedReports();
    res.json({
      success: true,
      reports
    });
  } catch (error) {
    logError(error, '❌ Erro ao listar relatórios:', { service: 'metrics-routes' });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reports/generate - Gerar relatório
router.post('/api/reports/generate', async (req, res) => {
  try {
    const { reportType, format = 'pdf', data, template = 'default' } = req.body;

    if (!reportType || !data) {
      return res.status(400).json({
        error: 'reportType e data são obrigatórios'
      });
    }

    let result;
    if (format === 'pdf') {
      result = await reportService.generatePDFReport(data, template);
    } else if (format === 'excel' || format === 'xlsx') {
      result = await reportService.generateExcelReport(data, template);
    } else {
      return res.status(400).json({
        error: 'Formato inválido. Use "pdf" ou "excel"'
      });
    }

    // Enviar arquivo
    res.setHeader('Content-Type', format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);

  } catch (error) {
    logError(error, '❌ Erro ao gerar relatório:', { service: 'metrics-routes' });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/generate/:reportId - Gerar relatório pré-configurado
router.get('/api/reports/generate/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { format = 'pdf', startDate, endDate } = req.query;

    const predefinedReports = reportService.getPredefinedReports();
    const reportConfig = predefinedReports.find(r => r.id === reportId);

    if (!reportConfig) {
      return res.status(404).json({
        error: 'Relatório não encontrado'
      });
    }

    // Buscar dados do relatório (implementar lógica específica para cada tipo)
    const reportData = await generateReportData(reportId, startDate, endDate);

    let result;
    if (format === 'pdf') {
      result = await reportService.generatePDFReport(reportData, 'default');
    } else {
      result = await reportService.generateExcelReport(reportData, 'default');
    }

    res.setHeader('Content-Type', format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);

  } catch (error) {
    logError(error, '❌ Erro ao gerar relatório pré-configurado:', { service: 'metrics-routes' });
    res.status(500).json({ error: error.message });
  }
});

// Função auxiliar para gerar dados do relatório
async function generateReportData(reportId, startDate, endDate) {
  // Implementar lógica específica para cada tipo de relatório
  // Por enquanto, retornar estrutura básica
  return {
    title: `Relatório ${reportId}`,
    period: startDate && endDate ? `${startDate} a ${endDate}` : 'Período não especificado',
    summary: {},
    data: []
  };
}

// ==========================================
// 📊 OBSERVABILIDADE - MÉTRICAS REDIS E SISTEMA
// ==========================================

// GET /api/metrics/observability - Métricas agregadas de observabilidade (Redis, Sistema, Commands, Events)
router.get('/api/metrics/observability', async (req, res) => {
  try {
    const { getMetrics } = require('../utils/prometheus-metrics');
    const metricsText = await getMetrics();

    // Parsear métricas do Prometheus
    const metrics = parsePrometheusMetrics(metricsText);

    // Agregar métricas de Redis
    const redisMetrics = {
      operations: {
        total: metrics.redis?.total || 0,
        success: metrics.redis?.success || 0,
        errors: metrics.redis?.errors || 0,
        errorRate: metrics.redis?.total > 0
          ? ((metrics.redis?.errors || 0) / metrics.redis?.total * 100).toFixed(2)
          : 0
      },
      latency: {
        avg: metrics.redis?.avgLatency || 0,
        p95: metrics.redis?.p95Latency || 0,
        p99: metrics.redis?.p99Latency || 0
      },
      operationsByType: metrics.redis?.byType || {}
    };

    // Agregar métricas de Sistema
    const systemMetrics = {
      cpu: metrics.system?.cpu || 0,
      memory: metrics.system?.memory || 0,
      uptime: metrics.system?.uptime || 0,
      websocketConnections: metrics.system?.websocketConnections || 0,
      throughput: metrics.system?.throughput || 0
    };

    // Agregar métricas de Commands
    const commandsMetrics = {
      total: metrics.commands?.total || 0,
      success: metrics.commands?.success || 0,
      failures: metrics.commands?.failures || 0,
      avgLatency: metrics.commands?.avgLatency || 0,
      byCommand: metrics.commands?.byCommand || {}
    };

    // Agregar métricas de Events
    const eventsMetrics = {
      published: metrics.events?.published || 0,
      consumed: metrics.events?.consumed || 0,
      lag: metrics.events?.avgLag || 0,
      byType: metrics.events?.byType || {}
    };

    // Agregar métricas de Listeners
    const listenersMetrics = {
      total: metrics.listeners?.total || 0,
      success: metrics.listeners?.success || 0,
      failures: metrics.listeners?.failures || 0,
      avgLatency: metrics.listeners?.avgLatency || 0,
      byListener: metrics.listeners?.byListener || {}
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      redis: redisMetrics,
      system: systemMetrics,
      commands: commandsMetrics,
      events: eventsMetrics,
      listeners: listenersMetrics
    });
  } catch (error) {
    logError(error, 'Erro ao buscar métricas de observabilidade:', { service: 'metrics-routes' });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Função auxiliar para parsear métricas do Prometheus
function parsePrometheusMetrics(metricsText) {
  const lines = metricsText.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  const metrics = {
    redis: {
      total: 0,
      success: 0,
      errors: 0,
      avgLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      byType: {}
    },
    system: {
      cpu: 0,
      memory: 0,
      uptime: process.uptime(),
      websocketConnections: 0,
      throughput: 0
    },
    commands: {
      total: 0,
      success: 0,
      failures: 0,
      avgLatency: 0,
      byCommand: {}
    },
    events: {
      published: 0,
      consumed: 0,
      avgLag: 0,
      byType: {}
    },
    listeners: {
      total: 0,
      success: 0,
      failures: 0,
      avgLatency: 0,
      byListener: {}
    }
  };

  // Parsear métricas Redis
  const redisDurationRegex = /^leaf_redis_duration_seconds_bucket\{operation="([^"]+)",status="([^"]+)"\} (\d+\.?\d*)/;
  const redisErrorsRegex = /^leaf_redis_errors_total\{operation="([^"]+)"\} (\d+)/;
  const redisDurationSumRegex = /^leaf_redis_duration_seconds_sum\{operation="([^"]+)",status="([^"]+)"\} (\d+\.?\d*)/;
  const redisDurationCountRegex = /^leaf_redis_duration_seconds_count\{operation="([^"]+)",status="([^"]+)"\} (\d+)/;

  // Parsear métricas de Commands
  const commandTotalRegex = /^leaf_command_total\{command_name="([^"]+)",status="([^"]+)"\} (\d+)/;
  const commandDurationSumRegex = /^leaf_command_duration_seconds_sum\{command_name="([^"]+)",status="([^"]+)"\} (\d+\.?\d*)/;
  const commandDurationCountRegex = /^leaf_command_duration_seconds_count\{command_name="([^"]+)",status="([^"]+)"\} (\d+)/;

  // Parsear métricas de Events
  const eventPublishedRegex = /^leaf_event_published_total\{event_type="([^"]+)"\} (\d+)/;
  const eventConsumedRegex = /^leaf_event_consumed_total\{event_type="([^"]+)",listener_name="([^"]+)"\} (\d+)/;
  const eventLagRegex = /^leaf_event_lag_seconds_sum\{event_type="([^"]+)",listener_name="([^"]+)"\} (\d+\.?\d*)/;
  const eventLagCountRegex = /^leaf_event_lag_seconds_count\{event_type="([^"]+)",listener_name="([^"]+)"\} (\d+)/;

  // Parsear métricas de Listeners
  const listenerTotalRegex = /^leaf_listener_total\{listener_name="([^"]+)",status="([^"]+)"\} (\d+)/;
  const listenerDurationSumRegex = /^leaf_listener_duration_seconds_sum\{listener_name="([^"]+)",status="([^"]+)"\} (\d+\.?\d*)/;
  const listenerDurationCountRegex = /^leaf_listener_duration_seconds_count\{listener_name="([^"]+)",status="([^"]+)"\} (\d+)/;

  // Parsear métricas do sistema (nodejs padrão)
  const processCpuRegex = /^process_cpu_user_seconds_total (\d+\.?\d*)/;
  const processMemoryRegex = /^process_resident_memory_bytes (\d+)/;

  // Agregadores para cálculos
  const redisLatencies = [];
  const commandLatencies = [];
  const listenerLatencies = [];
  let totalEventLag = 0;
  let totalEventLagCount = 0;

  lines.forEach(line => {
    // Redis - Erros
    const redisErrorMatch = line.match(redisErrorsRegex);
    if (redisErrorMatch) {
      const [, operation, value] = redisErrorMatch;
      metrics.redis.errors += parseInt(value);
      if (!metrics.redis.byType[operation]) {
        metrics.redis.byType[operation] = { total: 0, success: 0, errors: 0 };
      }
      metrics.redis.byType[operation].errors += parseInt(value);
    }

    // Redis - Duração (para calcular latência média)
    const redisDurationSumMatch = line.match(redisDurationSumRegex);
    if (redisDurationSumMatch) {
      const [, operation, status, value] = redisDurationSumMatch;
      if (status === 'success') {
        redisLatencies.push(parseFloat(value) * 1000); // Converter para ms
      }
    }

    const redisDurationCountMatch = line.match(redisDurationCountRegex);
    if (redisDurationCountMatch) {
      const [, operation, status, value] = redisDurationCountMatch;
      if (status === 'success') {
        metrics.redis.total += parseInt(value);
        metrics.redis.success += parseInt(value);
        if (!metrics.redis.byType[operation]) {
          metrics.redis.byType[operation] = { total: 0, success: 0, errors: 0 };
        }
        metrics.redis.byType[operation].total += parseInt(value);
        metrics.redis.byType[operation].success += parseInt(value);
      }
    }

    // Commands
    const commandTotalMatch = line.match(commandTotalRegex);
    if (commandTotalMatch) {
      const [, commandName, status, value] = commandTotalMatch;
      metrics.commands.total += parseInt(value);
      if (status === 'success') metrics.commands.success += parseInt(value);
      if (status === 'failure') metrics.commands.failures += parseInt(value);
      if (!metrics.commands.byCommand[commandName]) {
        metrics.commands.byCommand[commandName] = { total: 0, success: 0, failures: 0 };
      }
      metrics.commands.byCommand[commandName].total += parseInt(value);
      if (status === 'success') metrics.commands.byCommand[commandName].success += parseInt(value);
      if (status === 'failure') metrics.commands.byCommand[commandName].failures += parseInt(value);
    }

    const commandDurationSumMatch = line.match(commandDurationSumRegex);
    if (commandDurationSumMatch) {
      const [, commandName, status, value] = commandDurationSumMatch;
      if (status === 'success') {
        commandLatencies.push(parseFloat(value) * 1000); // Converter para ms
      }
    }

    // Events
    const eventPublishedMatch = line.match(eventPublishedRegex);
    if (eventPublishedMatch) {
      const [, eventType, value] = eventPublishedMatch;
      metrics.events.published += parseInt(value);
      if (!metrics.events.byType[eventType]) {
        metrics.events.byType[eventType] = { published: 0, consumed: 0 };
      }
      metrics.events.byType[eventType].published += parseInt(value);
    }

    const eventConsumedMatch = line.match(eventConsumedRegex);
    if (eventConsumedMatch) {
      const [, eventType, listenerName, value] = eventConsumedMatch;
      metrics.events.consumed += parseInt(value);
      if (!metrics.events.byType[eventType]) {
        metrics.events.byType[eventType] = { published: 0, consumed: 0 };
      }
      metrics.events.byType[eventType].consumed += parseInt(value);
    }

    const eventLagMatch = line.match(eventLagRegex);
    if (eventLagMatch) {
      const [, , , value] = eventLagMatch;
      totalEventLag += parseFloat(value) * 1000; // Converter para ms
    }

    const eventLagCountMatch = line.match(eventLagCountRegex);
    if (eventLagCountMatch) {
      const [, , , value] = eventLagCountMatch;
      totalEventLagCount += parseInt(value);
    }

    // Listeners
    const listenerTotalMatch = line.match(listenerTotalRegex);
    if (listenerTotalMatch) {
      const [, listenerName, status, value] = listenerTotalMatch;
      metrics.listeners.total += parseInt(value);
      if (status === 'success') metrics.listeners.success += parseInt(value);
      if (status === 'failure') metrics.listeners.failures += parseInt(value);
      if (!metrics.listeners.byListener[listenerName]) {
        metrics.listeners.byListener[listenerName] = { total: 0, success: 0, failures: 0 };
      }
      metrics.listeners.byListener[listenerName].total += parseInt(value);
      if (status === 'success') metrics.listeners.byListener[listenerName].success += parseInt(value);
      if (status === 'failure') metrics.listeners.byListener[listenerName].failures += parseInt(value);
    }

    const listenerDurationSumMatch = line.match(listenerDurationSumRegex);
    if (listenerDurationSumMatch) {
      const [, listenerName, status, value] = listenerDurationSumMatch;
      if (status === 'success') {
        listenerLatencies.push(parseFloat(value) * 1000); // Converter para ms
      }
    }

    // Sistema
    const cpuMatch = line.match(processCpuRegex);
    if (cpuMatch) {
      metrics.system.cpu = parseFloat(cpuMatch[1]) * 100; // Converter para porcentagem
    }

    const memoryMatch = line.match(processMemoryRegex);
    if (memoryMatch) {
      metrics.system.memory = parseInt(memoryMatch[1]) / 1024 / 1024; // Converter para MB
    }
  });

  // Calcular latências médias
  if (redisLatencies.length > 0) {
    metrics.redis.avgLatency = redisLatencies.reduce((a, b) => a + b, 0) / redisLatencies.length;
    const sorted = [...redisLatencies].sort((a, b) => a - b);
    metrics.redis.p95Latency = sorted[Math.floor(sorted.length * 0.95)] || 0;
    metrics.redis.p99Latency = sorted[Math.floor(sorted.length * 0.99)] || 0;
  }

  if (commandLatencies.length > 0) {
    metrics.commands.avgLatency = commandLatencies.reduce((a, b) => a + b, 0) / commandLatencies.length;
  }

  if (listenerLatencies.length > 0) {
    metrics.listeners.avgLatency = listenerLatencies.reduce((a, b) => a + b, 0) / listenerLatencies.length;
  }

  if (totalEventLagCount > 0) {
    metrics.events.avgLag = totalEventLag / totalEventLagCount;
  }

  return metrics;
}

// GET /api/metrics/prometheus - Endpoint para métricas Prometheus (formato texto)
router.get('/api/metrics/prometheus', async (req, res) => {
  try {
    const { getMetrics } = require('../utils/prometheus-metrics');
    const metricsText = await getMetrics();

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metricsText);
  } catch (error) {
    logError(error, 'Erro ao obter métricas Prometheus', {
      service: 'metrics-routes',
      operation: 'prometheus'
    });
    res.status(500).send('# Erro ao obter métricas Prometheus\n');
  }
});

// ==========================================
// 📊 SIMULADOR FINANCEIRO (TOKENOMICS)
// ==========================================

// GET /api/metrics/simulation/run - Simula operações e faturamento da plataforma
router.get('/api/metrics/simulation/run', async (req, res) => {
  try {
    const drivers = parseInt(req.query.drivers) || 250;
    const hours = parseFloat(req.query.hours) || 1;

    // Um motorista ocupado faz em média 3 corridas por hora.
    const TOTAL_EXPECTED_RIDES = Math.floor(drivers * 3 * hours);

    const CATEGORIES = {
      'Leaf Plus': { base_fare: 2.79, fixed_fee: 1.10, rate_per_hour: 15.60, rate_per_unit_distance: 1.53, min_fare: 8.50, weight: 0.85 },
      'Leaf Elite': { base_fare: 4.98, fixed_fee: 1.80, rate_per_hour: 17.40, rate_per_unit_distance: 2.41, min_fare: 10.50, weight: 0.15 }
    };

    const CHANCE_CANCELED = 0.12;
    const CHANCE_DRIVER_REJECTED = 0.08;
    const CHANCE_REFUNDED = 0.01;
    const CHANCE_TOLL = 0.08;
    const TOLL_VALUES = [8.95, 9.40];

    let report = {
      simulationParams: { drivers, hours, expectedRides: TOTAL_EXPECTED_RIDES },
      totalRequests: 0,
      completed: 0,
      canceledByPassenger: 0,
      rejectedByDriver: 0,
      refundedAfterCompletion: 0,
      totalDistanceKm: 0,
      totalTimeHours: 0,
      grossVolume: 0,
      totalTollsPaid: 0,
      totalWooviFees: 0,
      totalDriverPayout: 0,
      leafGrossRevenue: 0,
      leafNetRevenue: 0,
      preAcceptanceCancellationCosts: 0,
      distanceBrackets: { short: 0, medium: 0, long: 0 }
    };

    function randomFloat(min, max) { return Math.random() * (max - min) + min; }
    function pickCategory() { return Math.random() <= CATEGORIES['Leaf Plus'].weight ? 'Leaf Plus' : 'Leaf Elite'; }

    const numRides = Math.floor(randomFloat(TOTAL_EXPECTED_RIDES * 0.85, TOTAL_EXPECTED_RIDES * 1.15));

    for (let i = 0; i < numRides; i++) {
      report.totalRequests++;

      let isLong = Math.random() < 0.2;
      let distKm = isLong ? randomFloat(12, 35) : randomFloat(1.5, 12);
      let timeHours = distKm * randomFloat(2.5, 6) / 60;

      const rStatus = Math.random();
      let status = 'completed';
      if (rStatus < CHANCE_CANCELED) status = 'canceled_passenger';
      else if (rStatus < CHANCE_CANCELED + CHANCE_DRIVER_REJECTED) status = 'rejected_driver';
      else if (rStatus < CHANCE_CANCELED + CHANCE_DRIVER_REJECTED + CHANCE_REFUNDED) status = 'refunded_post_ride';

      let toll = 0;
      if (status !== 'canceled_passenger' && status !== 'rejected_driver' && Math.random() < CHANCE_TOLL) {
        toll = TOLL_VALUES[Math.floor(Math.random() * TOLL_VALUES.length)];
      }

      const category = pickCategory();

      if (status === 'canceled_passenger') {
        report.canceledByPassenger++;
        const cat = CATEGORIES[category];
        let distCost = distKm * cat.rate_per_unit_distance;
        let timeCost = timeHours * cat.rate_per_hour;
        let estimatedSubTotal = cat.base_fare + cat.fixed_fee + distCost + timeCost;
        if (estimatedSubTotal < cat.min_fare) estimatedSubTotal = cat.min_fare;

        let assumedWooviFee = estimatedSubTotal * 0.0008;
        if (assumedWooviFee < 0.50) assumedWooviFee = 0.50;

        report.preAcceptanceCancellationCosts += assumedWooviFee;
        report.leafNetRevenue -= assumedWooviFee;
        continue;
      }

      if (status === 'rejected_driver') {
        report.rejectedByDriver++;
        continue;
      }

      if (distKm < 5) report.distanceBrackets.short++;
      else if (distKm < 15) report.distanceBrackets.medium++;
      else report.distanceBrackets.long++;

      report.totalDistanceKm += distKm;
      report.totalTimeHours += timeHours;

      const cat = CATEGORIES[category];
      let distCost = distKm * cat.rate_per_unit_distance;
      let timeCost = timeHours * cat.rate_per_hour;
      let subTotal = cat.base_fare + cat.fixed_fee + distCost + timeCost;
      if (subTotal < cat.min_fare) subTotal = cat.min_fare;

      let grandTotal = subTotal + toll;
      let rawFare = grandTotal - toll;

      let opFee = 0;
      if (rawFare <= 10.00) opFee = 0.79;
      else if (rawFare <= 25.00) opFee = 0.99;
      else opFee = 1.49;

      let wooviFee = grandTotal * 0.0008;
      if (wooviFee < 0.50) wooviFee = 0.50;

      let driverShare = grandTotal - opFee - wooviFee;

      report.grossVolume += grandTotal;
      report.totalTollsPaid += toll;
      report.totalWooviFees += wooviFee;
      report.totalDriverPayout += driverShare;

      if (status === 'completed') {
        report.completed++;
        report.leafGrossRevenue += opFee;
        report.leafNetRevenue += opFee;
      } else if (status === 'refunded_post_ride') {
        report.refundedAfterCompletion++;
        report.leafGrossRevenue += opFee;
        report.leafNetRevenue -= (grandTotal + wooviFee - opFee);
      }
    }

    res.json(report);
  } catch (error) {
    logError(error, 'Erro ao rodar simulador financeiro', {
      service: 'metrics-routes',
      operation: 'simulation'
    });
    res.status(500).json({ error: 'Erro ao rodar simulador financeiro' });
  }
});

module.exports = router;
















