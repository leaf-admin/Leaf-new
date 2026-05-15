const express = require('express');
const admin = require('firebase-admin');
const { logger, logStructured, logError } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const { authenticateSupport, requireSupportRoles } = require('../middleware/support-auth');
const modernMetricsService = require('../services/modern-metrics-service');
const driverSubscriptionService = require('../services/driver-subscription-service');

const router = express.Router();
const METRICS_READ_ROLES = ['admin', 'manager', 'super-admin', 'viewer'];
const DASHBOARD_METRICS_CACHE_TTL_SECONDS = Math.max(
  15,
  Number.parseInt(process.env.DASHBOARD_METRICS_CACHE_TTL_SECONDS || '60', 10) || 60
);

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'metrics-routes' });
}

const getLandingMetricsRef = () => {
  // Evita crash de boot quando Firebase ainda não está disponível no ambiente
  if (admin.apps.length === 0 && firebaseConfig && firebaseConfig.initializeFirebase) {
    firebaseConfig.initializeFirebase();
  }

  if (admin.apps.length === 0) {
    return null;
  }

  return admin.firestore().collection('metrics').doc('landing');
};

const getLandingMetrics = async () => {
  const landingMetricsRef = getLandingMetricsRef();
  if (!landingMetricsRef) {
    return {
      waitlistCount: 0,
      calculatorSimulations: 0,
      updatedAt: null
    };
  }

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

function buildMetricsCacheKey(scope, params = {}) {
  const serializedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key] ?? ''}`)
    .join('&');

  return `metrics:dashboard:${scope}:${serializedParams}`;
}

async function readMetricsCache(cacheKey) {
  try {
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const cached = await redis.get(cacheKey);
    if (!cached) return null;

    const parsed = JSON.parse(cached);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function writeMetricsCache(cacheKey, payload, ttlSeconds = DASHBOARD_METRICS_CACHE_TTL_SECONDS) {
  try {
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    await redis.set(cacheKey, JSON.stringify(payload), 'EX', ttlSeconds);
  } catch (_) {
    // Cache é best-effort para não adicionar fragilidade ao runtime.
  }
}

function isPrivateNetworkAddress(ip) {
  const normalized = String(ip || '')
    .replace('::ffff:', '')
    .replace(/^::1$/, '127.0.0.1')
    .trim();

  if (!normalized) return false;
  if (normalized === '127.0.0.1' || normalized === 'localhost') return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;

  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }

  return false;
}

function allowPrometheusScrape(req, res, next) {
  const configuredToken = String(process.env.PROMETHEUS_BEARER_TOKEN || '').trim();
  const providedToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  if (configuredToken && providedToken && providedToken === configuredToken) {
    return next();
  }

  const allowPrivateScrape = String(process.env.PROMETHEUS_ALLOW_PRIVATE_SCRAPE || 'true').toLowerCase() !== 'false';
  if (allowPrivateScrape && isPrivateNetworkAddress(req.ip)) {
    return next();
  }

  return next('route');
}

async function prometheusMetricsHandler(req, res) {
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
}

router.get('/api/metrics/prometheus', allowPrometheusScrape, prometheusMetricsHandler);

router.post('/api/metrics/calculator', async (req, res) => {
  try {
    const landingMetricsRef = getLandingMetricsRef();
    if (!landingMetricsRef) {
      return res.status(503).json({ error: 'Firebase indisponível no momento' });
    }

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

// Hotfix de seguranca: apenas endpoints publicos da landing permanecem sem auth.
router.use(
  '/api/metrics',
  authenticateSupport,
  requireSupportRoles(METRICS_READ_ROLES)
);

// ==========================================
// 📊 MÉTRICAS DE CORRIDAS
// ==========================================

// GET /api/metrics/rides/daily - Corridas realizadas no dia e % canceladas (após motorista aceitar)
router.get('/api/metrics/rides/daily', async (req, res) => {
  try {
    const cacheKey = buildMetricsCacheKey('rides-daily', {
      day: new Date().toISOString().slice(0, 10)
    });
    const cached = await readMetricsCache(cacheKey);
    if (cached) {
      res.set('X-Leaf-Metrics-Cache', 'HIT');
      return res.json(cached);
    }

    try {
      const stats = await modernMetricsService.getRidesDailyStats();
      await writeMetricsCache(cacheKey, stats);
      res.set('X-Leaf-Metrics-Cache', 'MISS');
      return res.json(stats);
    } catch (modernError) {
      logStructured('warn', 'Fallback RTDB em /api/metrics/rides/daily', {
        service: 'metrics-routes',
        reason: modernError.message
      });
    }

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

    await writeMetricsCache(cacheKey, stats);
    res.set('X-Leaf-Metrics-Cache', 'MISS');
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
    try {
      const stats = await modernMetricsService.getUsersStatusStats();
      return res.json(stats);
    } catch (modernError) {
      logStructured('warn', 'Fallback RTDB em /api/metrics/users/status', {
        service: 'metrics-routes',
        reason: modernError.message
      });
    }

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
    const redis = redisPool.getConnection();

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

    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar status de usuários:', error.message, { service: 'metrics-routes' });
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

    try {
      const stats = await modernMetricsService.getFinancialRidesStats({ period, startDate, endDate });
      return res.json(stats);
    } catch (modernError) {
      logStructured('warn', 'Fallback RTDB em /api/metrics/financial/rides', {
        service: 'metrics-routes',
        reason: modernError.message
      });
    }

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
    const redis = redisPool.getConnection();

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
    } catch (redisErr) {
      // Falha silenciosa no banco de dados em memória
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

    try {
      const stats = await modernMetricsService.getOperationalFeeStats({ period, startDate, endDate });
      return res.json(stats);
    } catch (modernError) {
      logStructured('warn', 'Fallback RTDB em /api/metrics/financial/operational-fee', {
        service: 'metrics-routes',
        reason: modernError.message
      });
    }

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
    const redis = redisPool.getConnection();

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

    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar demanda por região:', error.message, { service: 'metrics-routes' });
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
    try {
      const stats = await driverSubscriptionService.getActiveSubscriptionMetrics();
      return res.json(stats);
    } catch (modernError) {
      logStructured('warn', 'Fallback RTDB em /api/metrics/subscriptions/active', {
        service: 'metrics-routes',
        reason: modernError.message
      });
    }

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

// ==========================================
// 🧭 MARKETPLACE HEALTH - MÉTRICAS CONSOLIDADAS
// ==========================================

const COMPLETED_STATUSES = new Set(['COMPLETE', 'COMPLETED', 'PAID']);
const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELED']);

function toNumber(value, fallback = 0) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseTs(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Trata segundos unix também
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && value.trim() !== '') {
      return asNum > 10_000_000_000 ? asNum : asNum * 1000;
    }
  }

  const date = new Date(value);
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function getWindow(period, startDate, endDate) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (period === 'custom' && startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
  } else if (period === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === 'week') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === '30d') {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const durationMs = Math.max(end.getTime() - start.getTime(), 1);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs);

  return {
    current: { start, end },
    previous: { start: previousStart, end: previousEnd }
  };
}

function isWithin(ts, window) {
  if (!Number.isFinite(ts)) return false;
  return ts >= window.start.getTime() && ts <= window.end.getTime();
}

function parseLatLng(source) {
  if (!source) return { lat: null, lng: null };

  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      return parseLatLng(parsed);
    } catch (_error) {
      return { lat: null, lng: null };
    }
  }

  const lat = Number.parseFloat(source.lat ?? source.latitude ?? source.pickupLat ?? source.pickup_lat);
  const lng = Number.parseFloat(source.lng ?? source.lon ?? source.longitude ?? source.pickupLng ?? source.pickup_lng);

  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null
  };
}

function parseObjectSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function pickFirstTs(...values) {
  for (const value of values) {
    const ts = parseTs(value);
    if (Number.isFinite(ts)) {
      return ts;
    }
  }
  return null;
}

function estimateBoundingAreaKm2(points = []) {
  const valid = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (valid.length < 2) return null;

  const lats = valid.map((point) => point.lat);
  const lngs = valid.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const avgLat = (minLat + maxLat) / 2;
  const latKm = Math.max((maxLat - minLat) * 111.32, 0.001);
  const lngKm = Math.max((maxLng - minLng) * 111.32 * Math.cos((avgLat * Math.PI) / 180), 0.001);
  const areaKm2 = latKm * lngKm;

  return Number.isFinite(areaKm2) ? areaKm2 : null;
}

router.get('/api/metrics/marketplace', async (req, res) => {
  try {
    const {
      period = 'month',
      startDate,
      endDate
    } = req.query;
    const cacheKey = buildMetricsCacheKey('marketplace', {
      period,
      startDate: startDate || '',
      endDate: endDate || ''
    });
    const cached = await readMetricsCache(cacheKey);
    if (cached) {
      res.set('X-Leaf-Metrics-Cache', 'HIT');
      return res.json(cached);
    }

    const response = {
      period,
      window: {},
      metrics: {},
      raw: {},
      assumptions: {
        driverUtilizationEstimated: true,
        costPerRideEstimated: true
      }
    };

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.json(response);
    }

    const db = firebaseConfig.getRealtimeDB();
    const { current, previous } = getWindow(period, startDate, endDate);
    response.window = {
      current: {
        start: current.start.toISOString(),
        end: current.end.toISOString()
      },
      previous: {
        start: previous.start.toISOString(),
        end: previous.end.toISOString()
      }
    };

    const [bookingsSnapshot, usersSnapshot] = await Promise.all([
      db.ref('bookings').once('value'),
      db.ref('users').once('value')
    ]);

    const bookings = bookingsSnapshot.val() || {};
    const users = usersSnapshot.val() || {};

    const normalizedBookings = Object.keys(bookings).map((id) => {
      const b = bookings[id] || {};
      const paymentData = parseObjectSafe(b.paymentData);
      const payment = parseObjectSafe(b.payment);
      const requestTs = parseTs(b.createdAt || b.tripdate || b.timestamp || b.activatedAt);
      const acceptTs = parseTs(b.acceptedAt || b.driverAcceptedAt || b.matchedAt);
      const arrivedTs = parseTs(b.driverArrivedAt || b.arrivedAt || b.pickupArrivedAt);
      const tripStartTs = parseTs(b.tripstart || b.startedAt || b.startTime);
      const tripEndTs = parseTs(b.tripend || b.completedAt || b.endTime || b.paidAt);
      const paymentConfirmedTs = pickFirstTs(
        b.paymentConfirmedAt,
        b.paymentApprovedAt,
        b.confirmedAt,
        paymentData?.confirmedAt,
        payment?.confirmedAt
      );
      const status = String(b.status || '').toUpperCase();
      const driverId = b.driver || b.driverId || null;
      const customerId = b.customer || b.customerId || b.user || b.userId || null;
      const fare = toNumber(b.customer_paid || b.total_fare || b.fare || b.estimate, 0);
      const convenienceFee = toNumber(b.convenience_fees, 0);
      const driverShare = toNumber(b.driver_share, 0);
      const pickupParsed = parseLatLng(b.pickup || b.pickupLocation || null);
      const destinationParsed = parseLatLng(b.drop || b.destination || null);

      return {
        id,
        status,
        requestTs,
        acceptTs,
        arrivedTs,
        paymentConfirmedTs,
        tripStartTs,
        tripEndTs,
        driverId,
        customerId,
        fare,
        convenienceFee,
        driverShare,
        pickupLat: pickupParsed.lat,
        pickupLng: pickupParsed.lng,
        destinationLat: destinationParsed.lat,
        destinationLng: destinationParsed.lng
      };
    });

    const currentBookings = normalizedBookings.filter((b) => isWithin(b.requestTs, current));
    const previousBookings = normalizedBookings.filter((b) => isWithin(b.requestTs, previous));
    const completedCurrent = currentBookings.filter((b) => COMPLETED_STATUSES.has(b.status));

    const requested = currentBookings.length;
    const accepted = currentBookings.filter((b) => b.driverId || b.acceptTs).length;
    const cancelled = currentBookings.filter((b) => CANCELLED_STATUSES.has(b.status)).length;
    const completed = completedCurrent.length;

    const waitSamplesMin = currentBookings
      .filter((b) => Number.isFinite(b.requestTs) && Number.isFinite(b.acceptTs) && b.acceptTs >= b.requestTs)
      .map((b) => (b.acceptTs - b.requestTs) / (1000 * 60));

    const pickupSamplesMin = currentBookings
      .filter((b) => Number.isFinite(b.acceptTs) && Number.isFinite(b.arrivedTs) && b.arrivedTs >= b.acceptTs)
      .map((b) => (b.arrivedTs - b.acceptTs) / (1000 * 60));
    const paymentApprovalToPickupSamplesMin = currentBookings
      .filter((b) => Number.isFinite(b.paymentConfirmedTs) && Number.isFinite(b.arrivedTs) && b.arrivedTs >= b.paymentConfirmedTs)
      .map((b) => (b.arrivedTs - b.paymentConfirmedTs) / (1000 * 60));

    const waitAvgMin = waitSamplesMin.length
      ? waitSamplesMin.reduce((sum, v) => sum + v, 0) / waitSamplesMin.length
      : null;
    const pickupAvgMin = pickupSamplesMin.length
      ? pickupSamplesMin.reduce((sum, v) => sum + v, 0) / pickupSamplesMin.length
      : null;
    const paymentApprovalToPickupAvgMin = paymentApprovalToPickupSamplesMin.length
      ? paymentApprovalToPickupSamplesMin.reduce((sum, v) => sum + v, 0) / paymentApprovalToPickupSamplesMin.length
      : null;

    const activeDriverSet = new Set(currentBookings.map((b) => b.driverId).filter(Boolean));
    const activePassengerSet = new Set(currentBookings.map((b) => b.customerId).filter(Boolean));

    const activeDrivers = activeDriverSet.size;
    const activePassengers = activePassengerSet.size;
    const passengerDriverRatio = activeDrivers > 0 ? (activePassengers / activeDrivers) : null;
    const periodDays = Math.max(
      1,
      Math.ceil((current.end.getTime() - current.start.getTime()) / (24 * 60 * 60 * 1000))
    );

    const ridesPerDriverPerDay = activeDrivers > 0
      ? requested / activeDrivers / periodDays
      : null;

    // Utilização (estimada): tempo em corrida / janela ativa por motorista
    const busyMsByDriver = {};
    const firstSeenByDriver = {};
    const lastSeenByDriver = {};
    currentBookings.forEach((b) => {
      if (!b.driverId) return;

      const marks = [b.requestTs, b.acceptTs, b.arrivedTs, b.tripStartTs, b.tripEndTs].filter(Number.isFinite);
      if (marks.length > 0) {
        const minMark = Math.min(...marks);
        const maxMark = Math.max(...marks);
        firstSeenByDriver[b.driverId] = Math.min(firstSeenByDriver[b.driverId] ?? minMark, minMark);
        lastSeenByDriver[b.driverId] = Math.max(lastSeenByDriver[b.driverId] ?? maxMark, maxMark);
      }

      if (Number.isFinite(b.tripStartTs) && Number.isFinite(b.tripEndTs) && b.tripEndTs >= b.tripStartTs) {
        busyMsByDriver[b.driverId] = (busyMsByDriver[b.driverId] || 0) + (b.tripEndTs - b.tripStartTs);
      }
    });

    const totalBusyMs = Object.values(busyMsByDriver).reduce((sum, v) => sum + v, 0);
    const estimatedOnlineMs = Object.keys(firstSeenByDriver).reduce((sum, driverId) => {
      const first = firstSeenByDriver[driverId];
      const last = lastSeenByDriver[driverId];
      if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return sum;
      const windowMs = Math.max(last - first, 30 * 60 * 1000); // piso de 30 min
      return sum + windowMs;
    }, 0);

    const driverUtilization = estimatedOnlineMs > 0 ? (totalBusyMs / estimatedOnlineMs) : null;

    const spatialPoints = currentBookings
      .map((b) => ({ lat: b.pickupLat, lng: b.pickupLng }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    const coverageAreaKm2 = estimateBoundingAreaKm2(spatialPoints);
    const driversPerKm2 = (coverageAreaKm2 && coverageAreaKm2 > 0 && activeDrivers > 0)
      ? (activeDrivers / coverageAreaKm2)
      : null;

    const revenueTotal = completedCurrent.reduce((sum, b) => sum + b.fare, 0);
    const ridesForFinancial = Math.max(completed, 1);
    const revenuePerRide = completed > 0 ? (revenueTotal / completed) : null;

    // Custo estimado por corrida (mesmo racional do dashboard financeiro avançado)
    const apiUnitCost = 0.005 + 0.002;
    const infraFixedCost = 50;
    const paymentCost = revenueTotal * 0.029;
    const totalEstimatedCost = (completed * apiUnitCost) + infraFixedCost + paymentCost;
    const costPerRide = completed > 0 ? (totalEstimatedCost / ridesForFinancial) : null;
    const marginPerRide = (revenuePerRide !== null && costPerRide !== null)
      ? (revenuePerRide - costPerRide)
      : null;
    const revenuePerDriver = activeDrivers > 0 ? (revenueTotal / activeDrivers) : null;

    // Ativos de passageiros em janelas padrão
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = now.getTime() - (7 * 24 * 60 * 60 * 1000);
    const monthStart = now.getTime() - (30 * 24 * 60 * 60 * 1000);

    const dau = new Set(normalizedBookings.filter((b) => b.customerId && Number.isFinite(b.requestTs) && b.requestTs >= dayStart).map((b) => b.customerId)).size;
    const wau = new Set(normalizedBookings.filter((b) => b.customerId && Number.isFinite(b.requestTs) && b.requestTs >= weekStart).map((b) => b.customerId)).size;
    const mau = new Set(normalizedBookings.filter((b) => b.customerId && Number.isFinite(b.requestTs) && b.requestTs >= monthStart).map((b) => b.customerId)).size;
    const monthRideCount = normalizedBookings.filter((b) => Number.isFinite(b.requestTs) && b.requestTs >= monthStart).length;
    const ridesPerPassengerMonth = mau > 0 ? (monthRideCount / mau) : null;

    // Crescimento e retenção
    const previousRequested = previousBookings.length;
    const ridesGrowth = previousRequested > 0
      ? (requested - previousRequested) / previousRequested
      : null;

    const previousActiveDrivers = new Set(previousBookings.map((b) => b.driverId).filter(Boolean));
    const retainedDriversCount = [...activeDriverSet].filter((driverId) => previousActiveDrivers.has(driverId)).length;
    const retentionDrivers = previousActiveDrivers.size > 0
      ? retainedDriversCount / previousActiveDrivers.size
      : null;

    const driversArray = Object.keys(users).map((id) => ({ id, ...(users[id] || {}) }))
      .filter((u) => String(u.usertype || '').toLowerCase() === 'driver');
    const driverUsersById = new Map(driversArray.map((driver) => [driver.id, driver]));
    const newDriversCurrent = driversArray.filter((d) => isWithin(parseTs(d.createdAt), current)).length;
    const churnDrivers = [...previousActiveDrivers].filter((driverId) => !activeDriverSet.has(driverId)).length;
    const driverGrowth = previousActiveDrivers.size > 0
      ? (newDriversCurrent - churnDrivers) / previousActiveDrivers.size
      : null;

    const driverBreakdownMap = new Map();
    currentBookings.forEach((b) => {
      if (!b.driverId) return;

      if (!driverBreakdownMap.has(b.driverId)) {
        driverBreakdownMap.set(b.driverId, {
          driverId: b.driverId,
          rides: 0,
          completedRides: 0,
          cancelledRides: 0,
          fareTotal: 0,
          activeDays: new Set()
        });
      }

      const entry = driverBreakdownMap.get(b.driverId);
      entry.rides += 1;
      if (COMPLETED_STATUSES.has(b.status)) {
        entry.completedRides += 1;
        entry.fareTotal += b.fare;
      }
      if (CANCELLED_STATUSES.has(b.status)) {
        entry.cancelledRides += 1;
      }
      if (Number.isFinite(b.requestTs)) {
        entry.activeDays.add(new Date(b.requestTs).toISOString().split('T')[0]);
      }
    });

    const driverBreakdown = [...driverBreakdownMap.values()]
      .map((entry) => {
        const driver = driverUsersById.get(entry.driverId) || {};
        const activeDaysCount = Math.max(entry.activeDays.size, 1);
        const displayName =
          driver.name ||
          driver.fullname ||
          driver.fullName ||
          driver.username ||
          driver.nickname ||
          driver.email ||
          entry.driverId;

        return {
          driverId: entry.driverId,
          displayName,
          phone: driver.phone || driver.phoneNumber || driver.mobile || null,
          rides: entry.rides,
          completedRides: entry.completedRides,
          cancelledRides: entry.cancelledRides,
          ridesPerCalendarDay: periodDays > 0 ? entry.rides / periodDays : null,
          ridesPerActiveDay: activeDaysCount > 0 ? entry.rides / activeDaysCount : null,
          activeDays: activeDaysCount,
          fareTotal: entry.fareTotal
        };
      })
      .sort((a, b) => {
        if (b.rides !== a.rides) return b.rides - a.rides;
        if (b.completedRides !== a.completedRides) return b.completedRides - a.completedRides;
        return b.fareTotal - a.fareTotal;
      });

    const conversionRate = requested > 0 ? completed / requested : null;
    const cancellationRate = requested > 0 ? cancelled / requested : null;
    const mlr = requested > 0 ? accepted / requested : null;

    response.metrics = {
      liquidity: {
        mlr,
        averageWaitMinutes: waitAvgMin,
        averagePickupMinutes: pickupAvgMin,
        averagePaymentApprovalToPickupMinutes: paymentApprovalToPickupAvgMin,
        cancellationRate
      },
      drivers: {
        ridesPerDriverPerDay,
        utilization: driverUtilization,
        activeDrivers,
        passengerDriverRatio,
        driversPerKm2,
        coverageAreaKm2
      },
      passengers: {
        activePassengers,
        dau,
        wau,
        mau,
        ridesPerPassengerMonth,
        conversionRate
      },
      financial: {
        revenuePerRide,
        costPerRide,
        marginPerRide,
        revenuePerDriver,
        totalRevenue: revenueTotal
      },
      growth: {
        driverGrowth,
        ridesGrowth,
        driverRetention: retentionDrivers
      },
      summary: {
        ridesRequested: requested,
        ridesAccepted: accepted,
        ridesCompleted: completed,
        ridesCancelled: cancelled
      }
    };

    // Série diária para drill-down
    const dailyBuckets = {};
    currentBookings.forEach((b) => {
      if (!Number.isFinite(b.requestTs)) return;
      const day = new Date(b.requestTs).toISOString().split('T')[0];
      if (!dailyBuckets[day]) {
        dailyBuckets[day] = {
          requested: 0,
          accepted: 0,
          completed: 0,
          cancelled: 0,
          waitSamples: [],
          pickupSamples: [],
          paymentApprovalToPickupSamples: [],
          fareTotal: 0,
          driverIds: new Set(),
          passengerIds: new Set(),
          busyMsByDriver: {},
          firstSeenByDriver: {},
          lastSeenByDriver: {}
        };
      }

      const bucket = dailyBuckets[day];
      bucket.requested += 1;
      if (b.driverId || b.acceptTs) bucket.accepted += 1;
      if (COMPLETED_STATUSES.has(b.status)) {
        bucket.completed += 1;
        bucket.fareTotal += b.fare;
      }
      if (CANCELLED_STATUSES.has(b.status)) bucket.cancelled += 1;
      if (b.driverId) bucket.driverIds.add(b.driverId);
      if (b.customerId) bucket.passengerIds.add(b.customerId);

      if (Number.isFinite(b.requestTs) && Number.isFinite(b.acceptTs) && b.acceptTs >= b.requestTs) {
        bucket.waitSamples.push((b.acceptTs - b.requestTs) / (1000 * 60));
      }
      if (Number.isFinite(b.acceptTs) && Number.isFinite(b.arrivedTs) && b.arrivedTs >= b.acceptTs) {
        bucket.pickupSamples.push((b.arrivedTs - b.acceptTs) / (1000 * 60));
      }
      if (Number.isFinite(b.paymentConfirmedTs) && Number.isFinite(b.arrivedTs) && b.arrivedTs >= b.paymentConfirmedTs) {
        bucket.paymentApprovalToPickupSamples.push((b.arrivedTs - b.paymentConfirmedTs) / (1000 * 60));
      }

      if (b.driverId) {
        const marks = [b.requestTs, b.acceptTs, b.arrivedTs, b.tripStartTs, b.tripEndTs].filter(Number.isFinite);
        if (marks.length > 0) {
          const minMark = Math.min(...marks);
          const maxMark = Math.max(...marks);
          bucket.firstSeenByDriver[b.driverId] = Math.min(bucket.firstSeenByDriver[b.driverId] ?? minMark, minMark);
          bucket.lastSeenByDriver[b.driverId] = Math.max(bucket.lastSeenByDriver[b.driverId] ?? maxMark, maxMark);
        }
        if (Number.isFinite(b.tripStartTs) && Number.isFinite(b.tripEndTs) && b.tripEndTs >= b.tripStartTs) {
          bucket.busyMsByDriver[b.driverId] = (bucket.busyMsByDriver[b.driverId] || 0) + (b.tripEndTs - b.tripStartTs);
        }
      }
    });

    const DAILY_INFRA_COST = 50 / 30;
    const timeline = Object.keys(dailyBuckets)
      .sort((a, b) => a.localeCompare(b))
      .map((day) => {
        const bucket = dailyBuckets[day];
        const activeDriversDay = bucket.driverIds.size;
        const activePassengersDay = bucket.passengerIds.size;
        const waitAvg = bucket.waitSamples.length
          ? bucket.waitSamples.reduce((sum, v) => sum + v, 0) / bucket.waitSamples.length
          : null;
        const pickupAvg = bucket.pickupSamples.length
          ? bucket.pickupSamples.reduce((sum, v) => sum + v, 0) / bucket.pickupSamples.length
          : null;
        const paymentApprovalToPickupAvg = bucket.paymentApprovalToPickupSamples.length
          ? bucket.paymentApprovalToPickupSamples.reduce((sum, v) => sum + v, 0) / bucket.paymentApprovalToPickupSamples.length
          : null;
        const mlrDay = bucket.requested > 0 ? bucket.accepted / bucket.requested : null;
        const cancelRateDay = bucket.requested > 0 ? bucket.cancelled / bucket.requested : null;
        const conversionDay = bucket.requested > 0 ? bucket.completed / bucket.requested : null;
        const ridesPerDriverDay = activeDriversDay > 0 ? bucket.requested / activeDriversDay : null;
        const revenuePerRideDay = bucket.completed > 0 ? bucket.fareTotal / bucket.completed : null;
        const costPerRideDay = bucket.completed > 0
          ? (((bucket.completed * (0.005 + 0.002)) + (bucket.fareTotal * 0.029) + DAILY_INFRA_COST) / bucket.completed)
          : null;
        const marginPerRideDay = (revenuePerRideDay !== null && costPerRideDay !== null)
          ? revenuePerRideDay - costPerRideDay
          : null;
        const revenuePerDriverDay = activeDriversDay > 0 ? bucket.fareTotal / activeDriversDay : null;

        const busyMs = Object.values(bucket.busyMsByDriver).reduce((sum, v) => sum + v, 0);
        const onlineMs = Object.keys(bucket.firstSeenByDriver).reduce((sum, driverId) => {
          const first = bucket.firstSeenByDriver[driverId];
          const last = bucket.lastSeenByDriver[driverId];
          if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return sum;
          return sum + Math.max(last - first, 30 * 60 * 1000);
        }, 0);
        const utilizationDay = onlineMs > 0 ? busyMs / onlineMs : null;

        return {
          date: day,
          summary: {
            ridesRequested: bucket.requested,
            ridesAccepted: bucket.accepted,
            ridesCompleted: bucket.completed,
            ridesCancelled: bucket.cancelled
          },
          liquidity: {
            mlr: mlrDay,
            averageWaitMinutes: waitAvg,
            averagePickupMinutes: pickupAvg,
            averagePaymentApprovalToPickupMinutes: paymentApprovalToPickupAvg,
            cancellationRate: cancelRateDay
          },
          drivers: {
            activeDrivers: activeDriversDay,
            ridesPerDriverPerDay: ridesPerDriverDay,
            utilization: utilizationDay
          },
          passengers: {
            activePassengers: activePassengersDay,
            conversionRate: conversionDay
          },
          financial: {
            totalRevenue: bucket.fareTotal,
            revenuePerRide: revenuePerRideDay,
            costPerRide: costPerRideDay,
            marginPerRide: marginPerRideDay,
            revenuePerDriver: revenuePerDriverDay
          }
        };
      });

    response.timeline = {
      daily: timeline
    };

    response.breakdowns = {
      drivers: driverBreakdown
    };

    response.raw = {
      numeratorDenominator: {
        mlr: { accepted, requested },
        cancellation: { cancelled, requested },
        conversion: { completed, requested },
        ridesPerDriverPerDay: { rides: requested, activeDrivers, days: periodDays },
        ridesPerPassengerMonth: { ridesMonth: monthRideCount, mau }
      },
      timingSamples: {
        waitCount: waitSamplesMin.length,
        pickupCount: pickupSamplesMin.length,
        paymentApprovalToPickupCount: paymentApprovalToPickupSamplesMin.length
      },
      growth: {
        previousRequested,
        previousActiveDrivers: previousActiveDrivers.size,
        retainedDrivers: retainedDriversCount,
        newDriversCurrent,
        churnDrivers
      },
      breakdowns: {
        activeDriverRows: driverBreakdown.length
      }
    };

    await writeMetricsCache(cacheKey, response);
    res.set('X-Leaf-Metrics-Cache', 'MISS');
    res.json(response);
  } catch (error) {
    logError(error, 'Erro ao gerar métricas consolidadas de marketplace', {
      service: 'metrics-routes',
      operation: 'marketplace-health'
    });
    res.status(500).json({ error: 'Erro ao calcular métricas de marketplace' });
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
    const { getStatus: getOtelIngestStatus } = require('../utils/otel-ingest-monitor');
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

    const realtimeMetrics = {
      total: metrics.realtime?.total || 0,
      byChannel: metrics.realtime?.byChannel || {}
    };

    const hotpathMetrics = {
      total: metrics.hotpath?.total || 0,
      success: metrics.hotpath?.success || 0,
      failures: metrics.hotpath?.failures || 0,
      avgLatencyMs: metrics.hotpath?.avgLatencyMs || 0,
      byPath: metrics.hotpath?.byPath || {}
    };

    const ridesMetrics = {
      requested: metrics.rides?.requested || 0,
      accepted: metrics.rides?.accepted || 0,
      cancelled: metrics.rides?.cancelled || 0,
      completed: metrics.rides?.completed || 0,
      timeToAcceptAvgSec: metrics.rides?.timeToAcceptAvgSec || 0,
      rideDurationAvgSec: metrics.rides?.rideDurationAvgSec || 0,
      byCity: metrics.rides?.byCity || {}
    };

    const workersMetrics = {
      total: metrics.workers?.total || 0,
      byType: metrics.workers?.byType || {}
    };

    const eventLoopLagMetrics = {
      meanMs: metrics.eventLoopLag?.meanMs || 0,
      p95Ms: metrics.eventLoopLag?.p95Ms || 0,
      maxMs: metrics.eventLoopLag?.maxMs || 0
    };

    const getRealtimeChannelResults = (channel) => {
      return realtimeMetrics?.byChannel?.[channel]?.results || {};
    };

    const sumRealtimeEntriesByPrefix = (entries, prefix) => {
      return Object.entries(entries || {})
        .filter(([key]) => key.startsWith(prefix))
        .reduce((acc, [, value]) => acc + Number(value || 0), 0);
    };

    const sumRealtimeEntriesByIncludes = (entries, token) => {
      const normalizedToken = String(token || '').trim().toLowerCase();
      if (!normalizedToken) {
        return 0;
      }
      return Object.entries(entries || {})
        .filter(([key]) => String(key || '').toLowerCase().includes(normalizedToken))
        .reduce((acc, [, value]) => acc + Number(value || 0), 0);
    };

    const requestRideCommand = commandsMetrics?.byCommand?.request_ride || {};
    const createBookingRealtime = getRealtimeChannelResults('create_booking');
    const setDriverStatusRealtime = getRealtimeChannelResults('set_driver_status');
    const authenticateRealtime = getRealtimeChannelResults('authenticate');
    const driverActivationRealtime = getRealtimeChannelResults('driver_activation');
    const docInReviewRealtime = getRealtimeChannelResults('doc_in_review');
    const docFailedRealtime = getRealtimeChannelResults('doc_failed');
    const createBookingSuccess = Number(createBookingRealtime.success || 0);
    const createBookingErrors = sumRealtimeEntriesByPrefix(createBookingRealtime, 'error_');
    const createBookingTotal = createBookingSuccess + createBookingErrors;

    const criticalSignals = {
      createBooking: {
        total: createBookingTotal,
        success: createBookingSuccess,
        errors: createBookingErrors,
        errorRatePct: createBookingTotal > 0 ? Number(((createBookingErrors / createBookingTotal) * 100).toFixed(2)) : 0,
        topErrors: Object.entries(createBookingRealtime)
          .filter(([key]) => key.startsWith('error_'))
          .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
          .slice(0, 6)
          .map(([error, count]) => ({ error, count: Number(count || 0) }))
      },
      requestRideCommand: {
        total: Number(requestRideCommand.total || 0),
        failures: Number(requestRideCommand.failures || 0),
        failureRatePct: Number(requestRideCommand.total || 0) > 0
          ? Number(((Number(requestRideCommand.failures || 0) / Number(requestRideCommand.total || 0)) * 100).toFixed(2))
          : 0
      },
      auth: {
        success: Number(authenticateRealtime.success || 0),
        authBusy: Number(authenticateRealtime.auth_busy || 0),
        invalidToken: Number(authenticateRealtime.error_invalid_token || 0),
        missingToken: Number(authenticateRealtime.error_missing_token || 0),
        exceptions: Number(authenticateRealtime.error_exception || 0)
      },
      driverOnlineGate: {
        successOnline: Number(setDriverStatusRealtime.success_online || 0),
        successOffline: Number(setDriverStatusRealtime.success_offline || 0),
        onlineNotReady: Number(setDriverStatusRealtime.error_online_not_ready || 0),
        locationRequired: Number(setDriverStatusRealtime.error_location_required || 0),
        vehicleLockFailed: Number(setDriverStatusRealtime.error_vehicle_lock_failed || 0)
      },
      socketAdmission: {
        busyRetry: Number(getRealtimeChannelResults('socket_admission').server_busy_retry || 0),
        busyTimeout: Number(getRealtimeChannelResults('socket_admission').server_busy_timeout || 0)
      },
      operationalIndicators: {
        authBusyRetries: Number(authenticateRealtime.auth_busy || 0),
        setDriverStatusErrors: Number(sumRealtimeEntriesByPrefix(setDriverStatusRealtime, 'error_') || 0),
        onlineNotReady: Number(setDriverStatusRealtime.error_online_not_ready || 0),
        locationRequired: Number(setDriverStatusRealtime.error_location_required || 0),
        createBookingRetry: Number(sumRealtimeEntriesByIncludes(createBookingRealtime, 'retry') || 0),
        docInReview: Number(driverActivationRealtime.doc_in_review || 0) + Number(docInReviewRealtime.total || 0),
        docFailed: Number(driverActivationRealtime.doc_failed || 0) + Number(docFailedRealtime.total || 0)
      }
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      redis: redisMetrics,
      system: systemMetrics,
      commands: commandsMetrics,
      events: eventsMetrics,
      listeners: listenersMetrics,
      realtime: realtimeMetrics,
      hotpath: hotpathMetrics,
      rides: ridesMetrics,
      workers: workersMetrics,
      eventLoopLag: eventLoopLagMetrics,
      critical: criticalSignals,
      otel: getOtelIngestStatus()
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
    },
    realtime: {
      total: 0,
      byChannel: {}
    },
    hotpath: {
      total: 0,
      success: 0,
      failures: 0,
      avgLatencyMs: 0,
      byPath: {}
    },
    rides: {
      requested: 0,
      accepted: 0,
      cancelled: 0,
      completed: 0,
      timeToAcceptAvgSec: 0,
      rideDurationAvgSec: 0,
      byCity: {}
    },
    workers: {
      total: 0,
      byType: {}
    },
    eventLoopLag: {
      meanMs: 0,
      p95Ms: 0,
      maxMs: 0
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

  // Parsear métricas realtime/hotpath
  const realtimeUpdatesRegex = /^leaf_realtime_updates_total\{channel="([^"]+)",result="([^"]+)"\} (\d+\.?\d*)/;
  const hotpathDurationSumRegex = /^leaf_hotpath_duration_seconds_sum\{path="([^"]+)",status="([^"]+)"\} (\d+\.?\d*)/;
  const hotpathDurationCountRegex = /^leaf_hotpath_duration_seconds_count\{path="([^"]+)",status="([^"]+)"\} (\d+\.?\d*)/;

  // Parsear métricas de negócio (corridas)
  const ridesRequestedRegex = /^leaf_rides_requested_total\{city="([^"]+)",service_type="([^"]+)"\} (\d+\.?\d*)/;
  const ridesAcceptedRegex = /^leaf_rides_accepted_total\{city="([^"]+)",service_type="([^"]+)"\} (\d+\.?\d*)/;
  const ridesCancelledRegex = /^leaf_rides_cancelled_total\{city="([^"]+)",reason="([^"]+)"\} (\d+\.?\d*)/;
  const ridesCompletedRegex = /^leaf_rides_completed_total\{city="([^"]+)",service_type="([^"]+)"\} (\d+\.?\d*)/;
  const timeToAcceptSumRegex = /^leaf_time_to_accept_seconds_sum\{city="([^"]+)"\} (\d+\.?\d*)/;
  const timeToAcceptCountRegex = /^leaf_time_to_accept_seconds_count\{city="([^"]+)"\} (\d+\.?\d*)/;
  const rideDurationSumRegex = /^leaf_ride_total_duration_seconds_sum\{city="([^"]+)"\} (\d+\.?\d*)/;
  const rideDurationCountRegex = /^leaf_ride_total_duration_seconds_count\{city="([^"]+)"\} (\d+\.?\d*)/;

  // Parsear métricas de workers/event loop
  const workersActiveRegex = /^leaf_workers_active\{worker_type="([^"]+)"\} (\d+\.?\d*)/;
  const eventLoopLagMeanRegex = /^leaf_event_loop_lag_mean_ms (\d+\.?\d*)/;
  const eventLoopLagP95Regex = /^leaf_event_loop_lag_p95_ms (\d+\.?\d*)/;
  const eventLoopLagMaxRegex = /^leaf_event_loop_lag_max_ms (\d+\.?\d*)/;

  // Parsear métricas do sistema (nodejs padrão)
  const processCpuRegex = /^process_cpu_user_seconds_total (\d+\.?\d*)/;
  const processMemoryRegex = /^process_resident_memory_bytes (\d+)/;

  // Agregadores para cálculos
  let redisLatencySumMs = 0;
  let redisLatencyCount = 0;
  const redisLatencySamplesMs = [];
  let commandLatencySumMs = 0;
  let commandLatencyCount = 0;
  let listenerLatencySumMs = 0;
  let listenerLatencyCount = 0;
  let totalEventLag = 0;
  let totalEventLagCount = 0;
  const hotpathAggregates = {};

  const ensureRealtimeChannel = (channel) => {
    if (!metrics.realtime.byChannel[channel]) {
      metrics.realtime.byChannel[channel] = {
        total: 0,
        results: {}
      };
    }
    return metrics.realtime.byChannel[channel];
  };

  const ensureRideCity = (city) => {
    if (!metrics.rides.byCity[city]) {
      metrics.rides.byCity[city] = {
        requested: 0,
        accepted: 0,
        cancelled: 0,
        completed: 0,
        timeToAcceptSumSec: 0,
        timeToAcceptCount: 0,
        rideDurationSumSec: 0,
        rideDurationCount: 0,
        timeToAcceptAvgSec: 0,
        rideDurationAvgSec: 0
      };
    }
    return metrics.rides.byCity[city];
  };

  const ensureHotpathAggregate = (path) => {
    if (!hotpathAggregates[path]) {
      hotpathAggregates[path] = {
        successCount: 0,
        failureCount: 0,
        durationSumSec: 0,
        durationCount: 0
      };
    }
    return hotpathAggregates[path];
  };

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
        redisLatencySumMs += parseFloat(value) * 1000;
      }
    }

    const redisDurationCountMatch = line.match(redisDurationCountRegex);
    if (redisDurationCountMatch) {
      const [, operation, status, value] = redisDurationCountMatch;
      if (status === 'success') {
        const numericValue = parseFloat(value);
        metrics.redis.total += numericValue;
        metrics.redis.success += numericValue;
        redisLatencyCount += numericValue;
        if (!metrics.redis.byType[operation]) {
          metrics.redis.byType[operation] = { total: 0, success: 0, errors: 0 };
        }
        metrics.redis.byType[operation].total += numericValue;
        metrics.redis.byType[operation].success += numericValue;
        if (numericValue > 0 && redisLatencySumMs > 0) {
          redisLatencySamplesMs.push((redisLatencySumMs / redisLatencyCount) || 0);
        }
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
        commandLatencySumMs += parseFloat(value) * 1000;
      }
    }

    const commandDurationCountMatch = line.match(commandDurationCountRegex);
    if (commandDurationCountMatch) {
      const [, , status, value] = commandDurationCountMatch;
      if (status === 'success') {
        commandLatencyCount += parseFloat(value);
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
        listenerLatencySumMs += parseFloat(value) * 1000;
      }
    }

    const listenerDurationCountMatch = line.match(listenerDurationCountRegex);
    if (listenerDurationCountMatch) {
      const [, , status, value] = listenerDurationCountMatch;
      if (status === 'success') {
        listenerLatencyCount += parseFloat(value);
      }
    }

    // Realtime counters
    const realtimeUpdatesMatch = line.match(realtimeUpdatesRegex);
    if (realtimeUpdatesMatch) {
      const [, channel, result, value] = realtimeUpdatesMatch;
      const numericValue = parseFloat(value);
      const channelRef = ensureRealtimeChannel(channel);
      channelRef.total += numericValue;
      channelRef.results[result] = Number(channelRef.results[result] || 0) + numericValue;
      metrics.realtime.total += numericValue;
    }

    // Hotpath
    const hotpathDurationSumMatch = line.match(hotpathDurationSumRegex);
    if (hotpathDurationSumMatch) {
      const [, path, status, value] = hotpathDurationSumMatch;
      const pathRef = ensureHotpathAggregate(path);
      pathRef.durationSumSec += parseFloat(value);
    }

    const hotpathDurationCountMatch = line.match(hotpathDurationCountRegex);
    if (hotpathDurationCountMatch) {
      const [, path, status, value] = hotpathDurationCountMatch;
      const pathRef = ensureHotpathAggregate(path);
      const numericValue = parseFloat(value);
      pathRef.durationCount += numericValue;
      if (status === 'success') {
        pathRef.successCount += numericValue;
        metrics.hotpath.success += numericValue;
      } else {
        pathRef.failureCount += numericValue;
        metrics.hotpath.failures += numericValue;
      }
      metrics.hotpath.total += numericValue;
    }

    // Rides counters
    const ridesRequestedMatch = line.match(ridesRequestedRegex);
    if (ridesRequestedMatch) {
      const [, city, , value] = ridesRequestedMatch;
      const numericValue = parseFloat(value);
      metrics.rides.requested += numericValue;
      const cityRef = ensureRideCity(city);
      cityRef.requested += numericValue;
    }

    const ridesAcceptedMatch = line.match(ridesAcceptedRegex);
    if (ridesAcceptedMatch) {
      const [, city, , value] = ridesAcceptedMatch;
      const numericValue = parseFloat(value);
      metrics.rides.accepted += numericValue;
      const cityRef = ensureRideCity(city);
      cityRef.accepted += numericValue;
    }

    const ridesCancelledMatch = line.match(ridesCancelledRegex);
    if (ridesCancelledMatch) {
      const [, city, , value] = ridesCancelledMatch;
      const numericValue = parseFloat(value);
      metrics.rides.cancelled += numericValue;
      const cityRef = ensureRideCity(city);
      cityRef.cancelled += numericValue;
    }

    const ridesCompletedMatch = line.match(ridesCompletedRegex);
    if (ridesCompletedMatch) {
      const [, city, , value] = ridesCompletedMatch;
      const numericValue = parseFloat(value);
      metrics.rides.completed += numericValue;
      const cityRef = ensureRideCity(city);
      cityRef.completed += numericValue;
    }

    const timeToAcceptSumMatch = line.match(timeToAcceptSumRegex);
    if (timeToAcceptSumMatch) {
      const [, city, value] = timeToAcceptSumMatch;
      const cityRef = ensureRideCity(city);
      cityRef.timeToAcceptSumSec += parseFloat(value);
    }

    const timeToAcceptCountMatch = line.match(timeToAcceptCountRegex);
    if (timeToAcceptCountMatch) {
      const [, city, value] = timeToAcceptCountMatch;
      const cityRef = ensureRideCity(city);
      cityRef.timeToAcceptCount += parseFloat(value);
    }

    const rideDurationSumMatch = line.match(rideDurationSumRegex);
    if (rideDurationSumMatch) {
      const [, city, value] = rideDurationSumMatch;
      const cityRef = ensureRideCity(city);
      cityRef.rideDurationSumSec += parseFloat(value);
    }

    const rideDurationCountMatch = line.match(rideDurationCountRegex);
    if (rideDurationCountMatch) {
      const [, city, value] = rideDurationCountMatch;
      const cityRef = ensureRideCity(city);
      cityRef.rideDurationCount += parseFloat(value);
    }

    // Workers
    const workersActiveMatch = line.match(workersActiveRegex);
    if (workersActiveMatch) {
      const [, workerType, value] = workersActiveMatch;
      const numericValue = parseFloat(value);
      metrics.workers.byType[workerType] = numericValue;
      metrics.workers.total += numericValue;
    }

    // Event loop lag
    const eventLoopLagMeanMatch = line.match(eventLoopLagMeanRegex);
    if (eventLoopLagMeanMatch) {
      metrics.eventLoopLag.meanMs = parseFloat(eventLoopLagMeanMatch[1]) || 0;
    }
    const eventLoopLagP95Match = line.match(eventLoopLagP95Regex);
    if (eventLoopLagP95Match) {
      metrics.eventLoopLag.p95Ms = parseFloat(eventLoopLagP95Match[1]) || 0;
    }
    const eventLoopLagMaxMatch = line.match(eventLoopLagMaxRegex);
    if (eventLoopLagMaxMatch) {
      metrics.eventLoopLag.maxMs = parseFloat(eventLoopLagMaxMatch[1]) || 0;
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
  if (redisLatencyCount > 0) {
    metrics.redis.avgLatency = redisLatencySumMs / redisLatencyCount;
    const sorted = [...redisLatencySamplesMs].sort((a, b) => a - b);
    metrics.redis.p95Latency = sorted[Math.floor(sorted.length * 0.95)] || 0;
    metrics.redis.p99Latency = sorted[Math.floor(sorted.length * 0.99)] || 0;
  }

  if (commandLatencyCount > 0) {
    metrics.commands.avgLatency = commandLatencySumMs / commandLatencyCount;
  }

  if (listenerLatencyCount > 0) {
    metrics.listeners.avgLatency = listenerLatencySumMs / listenerLatencyCount;
  }

  if (totalEventLagCount > 0) {
    metrics.events.avgLag = totalEventLag / totalEventLagCount;
  }

  // Consolidar hotpath por rota
  Object.entries(hotpathAggregates).forEach(([pathName, aggregate]) => {
    const totalCount = Number(aggregate.successCount || 0) + Number(aggregate.failureCount || 0);
    const avgLatencyMs = aggregate.durationCount > 0
      ? (aggregate.durationSumSec / aggregate.durationCount) * 1000
      : 0;
    metrics.hotpath.byPath[pathName] = {
      total: totalCount,
      success: Number(aggregate.successCount || 0),
      failures: Number(aggregate.failureCount || 0),
      avgLatencyMs
    };
  });

  if (metrics.hotpath.total > 0) {
    const weightedLatency = Object.values(metrics.hotpath.byPath).reduce((acc, item) => {
      const weight = Number(item.total || 0);
      const avgLatencyMs = Number(item.avgLatencyMs || 0);
      return acc + (avgLatencyMs * weight);
    }, 0);
    metrics.hotpath.avgLatencyMs = weightedLatency / metrics.hotpath.total;
  }

  // Consolidar métricas de corrida por cidade
  let ridesTimeToAcceptSumSec = 0;
  let ridesTimeToAcceptCount = 0;
  let ridesDurationSumSec = 0;
  let ridesDurationCount = 0;

  Object.entries(metrics.rides.byCity).forEach(([city, cityMetrics]) => {
    const timeToAcceptAvgSec = cityMetrics.timeToAcceptCount > 0
      ? cityMetrics.timeToAcceptSumSec / cityMetrics.timeToAcceptCount
      : 0;
    const rideDurationAvgSec = cityMetrics.rideDurationCount > 0
      ? cityMetrics.rideDurationSumSec / cityMetrics.rideDurationCount
      : 0;

    metrics.rides.byCity[city] = {
      requested: Number(cityMetrics.requested || 0),
      accepted: Number(cityMetrics.accepted || 0),
      cancelled: Number(cityMetrics.cancelled || 0),
      completed: Number(cityMetrics.completed || 0),
      timeToAcceptAvgSec,
      rideDurationAvgSec
    };

    ridesTimeToAcceptSumSec += Number(cityMetrics.timeToAcceptSumSec || 0);
    ridesTimeToAcceptCount += Number(cityMetrics.timeToAcceptCount || 0);
    ridesDurationSumSec += Number(cityMetrics.rideDurationSumSec || 0);
    ridesDurationCount += Number(cityMetrics.rideDurationCount || 0);
  });

  if (ridesTimeToAcceptCount > 0) {
    metrics.rides.timeToAcceptAvgSec = ridesTimeToAcceptSumSec / ridesTimeToAcceptCount;
  }
  if (ridesDurationCount > 0) {
    metrics.rides.rideDurationAvgSec = ridesDurationSumSec / ridesDurationCount;
  }

  return metrics;
}

// GET /api/metrics/prometheus - Endpoint para métricas Prometheus (formato texto)
router.get('/api/metrics/prometheus', prometheusMetricsHandler);

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

        let assumedWooviFee = estimatedSubTotal * 0.008;
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
      else if (rawFare <= 50.00) opFee = 1.49;
      else opFee = rawFare * 0.03;

      let wooviFee = grandTotal * 0.008;
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
