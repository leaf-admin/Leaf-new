// 📡 DASHBOARD WEBSOCKET SERVICE
// Gerencia eventos WebSocket específicos para o dashboard

const admin = require('firebase-admin');
const { logStructured, logError } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');
const { getAdminUser } = require('../utils/admin-user-cache');
const { resolveJwtSecret } = require('../utils/jwt-secret-resolver');
const { getDashboardLiveData } = require('./dashboard-live-data-service');
const { getRideOperationsSnapshot } = require('./ride-health-monitor');
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (error) {
  logStructured('warn', '⚠️ Firebase config não encontrado para dashboard websocket', { service: 'dashboard-websocket' });
}

const DASHBOARD_JWT_SECRET = resolveJwtSecret(['JWT_SECRET', 'ADMIN_JWT_SECRET'], {
  context: 'dashboard-websocket'
});

class DashboardWebSocketService {
  constructor(io, redis) {
    this.io = io;
    this.redis = redis;
    this.dashboardNamespace = io.of('/dashboard');
    this.authenticatedRoom = 'dashboard:authenticated';
    this.authenticatedSocketIds = new Set();
    this.metricsIntervalId = null;
    this.liveIntervalId = null;
    this.metricsIntervalMs = Math.max(
      5000,
      Number.parseInt(process.env.DASHBOARD_METRICS_INTERVAL_MS || '60000', 10)
    );
    this.liveIntervalMs = Math.max(
      3000,
      Number.parseInt(process.env.DASHBOARD_LIVE_INTERVAL_MS || '5000', 10)
    );
    this.metricsCache = null;
    this.liveDataCache = null;
    this.h3RefreshCooldownMs = Math.max(
      500,
      Number.parseInt(process.env.DASHBOARD_H3_REFRESH_COOLDOWN_MS || '900', 10)
    );
    this.lastH3RefreshAt = 0;
    this.pendingH3RefreshTimerId = null;
    this.pendingH3RefreshPayload = null;
    this.setupDashboardEvents();
  }

  getMetricsCacheTtlMs() {
    return Math.max(
      5000,
      Number.parseInt(
        process.env.DASHBOARD_METRICS_CACHE_TTL_MS || String(Math.min(this.metricsIntervalMs, 45000)),
        10
      )
    );
  }

  getLiveCacheTtlMs() {
    return Math.max(
      1000,
      Number.parseInt(
        process.env.DASHBOARD_LIVE_CACHE_TTL_MS || String(Math.min(this.liveIntervalMs, 4000)),
        10
      )
    );
  }

  isCacheValid(cache, ttlMs) {
    return Boolean(cache && (Date.now() - cache.timestamp) < ttlMs);
  }

  setCache(kind, payload) {
    const entry = {
      timestamp: Date.now(),
      payload
    };

    if (kind === 'metrics') {
      this.metricsCache = entry;
      return;
    }

    if (kind === 'live') {
      this.liveDataCache = entry;
    }
  }

  getCachedPayload(kind) {
    if (kind === 'metrics' && this.isCacheValid(this.metricsCache, this.getMetricsCacheTtlMs())) {
      return this.metricsCache.payload;
    }

    if (kind === 'live' && this.isCacheValid(this.liveDataCache, this.getLiveCacheTtlMs())) {
      return this.liveDataCache.payload;
    }

    return null;
  }

  hasAuthenticatedClients() {
    return this.authenticatedSocketIds.size > 0;
  }

  ensureAuthenticated(socket) {
    if (socket?.authenticated) {
      return true;
    }

    socket?.emit('authentication_error', {
      message: 'Dashboard não autenticado'
    });
    return false;
  }

  markSocketAuthenticated(socket) {
    if (!socket || this.authenticatedSocketIds.has(socket.id)) {
      return;
    }

    this.authenticatedSocketIds.add(socket.id);
    socket.join(this.authenticatedRoom);

    if (this.authenticatedSocketIds.size === 1) {
      this.startPeriodicUpdates();
    }
  }

  unmarkSocketAuthenticated(socket) {
    if (!socket || !this.authenticatedSocketIds.has(socket.id)) {
      return;
    }

    this.authenticatedSocketIds.delete(socket.id);
    socket.leave(this.authenticatedRoom);

    if (!this.hasAuthenticatedClients()) {
      this.stopPeriodicUpdates();
    }
  }

  emitToAuthenticated(event, payload) {
    this.dashboardNamespace.to(this.authenticatedRoom).emit(event, payload);
  }

  emitH3RefreshNow(payload = {}) {
    this.lastH3RefreshAt = Date.now();
    const finalPayload = {
      scope: 'viewport',
      surfaces: ['dashboard'],
      timestamp: new Date().toISOString(),
      ...payload
    };
    metrics.recordH3RefreshHint('dashboard', finalPayload.reason || 'unknown');
    this.emitToAuthenticated('map_h3_refresh', finalPayload);
  }

  scheduleH3Refresh(payload = {}) {
    if (!this.hasAuthenticatedClients()) {
      return;
    }

    this.pendingH3RefreshPayload = {
      ...(this.pendingH3RefreshPayload || {}),
      ...payload
    };

    const now = Date.now();
    const remainingMs = Math.max(0, this.h3RefreshCooldownMs - (now - this.lastH3RefreshAt));

    if (remainingMs === 0 && !this.pendingH3RefreshTimerId) {
      const nextPayload = this.pendingH3RefreshPayload;
      this.pendingH3RefreshPayload = null;
      this.emitH3RefreshNow(nextPayload);
      return;
    }

    if (this.pendingH3RefreshTimerId) {
      return;
    }

    this.pendingH3RefreshTimerId = setTimeout(() => {
      this.pendingH3RefreshTimerId = null;
      const nextPayload = this.pendingH3RefreshPayload;
      this.pendingH3RefreshPayload = null;
      this.emitH3RefreshNow(nextPayload);
    }, remainingMs || this.h3RefreshCooldownMs);
  }

  async pushInitialSnapshot(socket) {
    try {
      const [metrics, liveData] = await Promise.all([
        this.getRealTimeMetrics(),
        this.getLiveData()
      ]);

      if (metrics) {
        socket.emit('metrics:updated', metrics);
      }

      if (liveData) {
        socket.emit('live_stats', liveData.stats);
        socket.emit('live_stats_update', liveData.stats);
        socket.emit('driver_location_update', { drivers: liveData.drivers });
        socket.emit('passenger_location_update', { passengers: liveData.passengers });
        socket.emit('trip_update', { trips: liveData.trips });
        socket.emit('map_h3_refresh', {
          scope: 'viewport',
          surfaces: ['dashboard'],
          reason: 'initial_snapshot',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logError(error, 'Erro ao enviar snapshot inicial do dashboard', { service: 'dashboard-websocket' });
    }
  }

  async runCountAggregate(aggregateQuery, logMessage, fallback = 0) {
    try {
      const snapshot = await aggregateQuery.get();
      return Number(snapshot?.data?.().count || 0);
    } catch (error) {
      logError(error, logMessage, { service: 'dashboard-websocket' });
      return fallback;
    }
  }

  parseMetricNumber(value, fallback = 0) {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  setupDashboardEvents() {
    this.dashboardNamespace.on('connection', (socket) => {
      logStructured('info', 'Dashboard conectado', { service: 'dashboard-websocket', socketId: socket.id });

      // 🔐 Autenticação do dashboard via JWT ou Firebase Auth Token
      socket.on('authenticate', async (data) => {
        const { firebaseToken, jwtToken } = data;

        // Prioridade 1: JWT Token (novo método)
        if (jwtToken) {
          try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(jwtToken, DASHBOARD_JWT_SECRET);

            const adminUserRecord = await getAdminUser(decoded.userId, {
              source: 'dashboard-websocket.authenticate.jwt',
              maxAgeMs: 15 * 1000
            });

            if (!adminUserRecord.exists) {
              socket.emit('authentication_error', {
                message: 'Usuário não possui permissões de admin'
              });
              socket.disconnect();
              return;
            }

            const adminData = adminUserRecord.data || {};
            if (!adminData.active) {
              socket.emit('authentication_error', {
                message: 'Conta de admin desativada'
              });
              socket.disconnect();
              return;
            }

            // Autenticação bem-sucedida
            socket.authenticated = true;
            socket.userId = decoded.userId;
            socket.userRole = adminData.role || 'viewer';
            socket.userPermissions = Array.isArray(adminData.permissions) ? adminData.permissions : [];
            this.markSocketAuthenticated(socket);

            socket.emit('authenticated', {
              message: 'Dashboard autenticado com sucesso',
              user: {
                id: decoded.userId,
                email: decoded.email || adminData.email,
                role: socket.userRole,
                permissions: socket.userPermissions
              }
            });

            logStructured('info', 'Dashboard autenticado (JWT)', { service: 'dashboard-websocket', socketId: socket.id, email: decoded.email || adminData.email, role: socket.userRole });
            this.pushInitialSnapshot(socket).catch(() => {});
            return;

          } catch (error) {
            logError(error, 'Erro na autenticação JWT do dashboard', { service: 'dashboard-websocket', socketId: socket.id });
            socket.emit('authentication_error', {
              message: 'Token JWT inválido ou expirado'
            });
            socket.disconnect();
            return;
          }
        }

        // Prioridade 2: Firebase Auth Token (fallback)
        if (!firebaseToken) {
          socket.emit('authentication_error', {
            message: 'Token de autenticação não fornecido (JWT ou Firebase)'
          });
          socket.disconnect();
          return;
        }

        try {
          // Verificar token Firebase usando Admin SDK
          const decodedToken = await admin.auth().verifyIdToken(firebaseToken);

          const adminUserRecord = await getAdminUser(decodedToken.uid, {
            source: 'dashboard-websocket.authenticate.firebase',
            maxAgeMs: 15 * 1000
          });

          if (!adminUserRecord.exists) {
            socket.emit('authentication_error', {
              message: 'Usuário não possui permissões de admin'
            });
            socket.disconnect();
            return;
          }

          const adminData = adminUserRecord.data || {};
          if (!adminData.active) {
            socket.emit('authentication_error', {
              message: 'Conta de admin desativada'
            });
            socket.disconnect();
            return;
          }

          // Autenticação bem-sucedida
          socket.authenticated = true;
          socket.userId = decodedToken.uid;
          socket.userRole = adminData.role;
          socket.userPermissions = adminData.permissions || [];
          this.markSocketAuthenticated(socket);

          socket.emit('authenticated', {
            message: 'Dashboard autenticado com sucesso',
            user: {
              uid: decodedToken.uid,
              email: decodedToken.email,
              role: adminData.role,
              permissions: adminData.permissions
            }
          });

          logStructured('info', 'Dashboard autenticado (Firebase)', { service: 'dashboard-websocket', socketId: socket.id, email: decodedToken.email, role: adminData.role });
          this.pushInitialSnapshot(socket).catch(() => {});

        } catch (error) {
          logError(error, 'Erro na autenticação do dashboard', { service: 'dashboard-websocket', socketId: socket.id });
          socket.emit('authentication_error', {
            message: 'Token inválido ou expirado'
          });
          socket.disconnect();
        }
      });

      // 📊 Solicitar dados específicos
      socket.on('request_live_data', async () => {
        if (!this.ensureAuthenticated(socket)) return;
        await this.sendLiveData(socket);
      });

      socket.on('request_user_stats', () => {
        if (!this.ensureAuthenticated(socket)) return;
        this.sendUserStats(socket);
      });

      socket.on('request_rides_stats', () => {
        if (!this.ensureAuthenticated(socket)) return;
        this.sendRidesStats(socket);
      });

      socket.on('request_revenue_stats', () => {
        if (!this.ensureAuthenticated(socket)) return;
        this.sendRevenueStats(socket);
      });

      socket.on('request_approval_stats', () => {
        if (!this.ensureAuthenticated(socket)) return;
        this.sendApprovalStats(socket);
      });

      socket.on('request_dashboard_metrics', (data) => {
        if (!this.ensureAuthenticated(socket)) return;
        this.sendDashboardMetrics(socket, data);
      });

      socket.on('request_subscription_stats', () => {
        if (!this.ensureAuthenticated(socket)) return;
        this.sendSubscriptionStats(socket);
      });

      socket.on('request_promotion_stats', () => {
        if (!this.ensureAuthenticated(socket)) return;
        this.sendPromotionStats(socket);
      });

      // 🚗 Ações de aprovação de motoristas
      socket.on('review_driver_application', (data) => {
        this.handleDriverApplicationReview(socket, data);
      });

      // 💳 Ações de assinaturas
      socket.on('subscription_action', (data) => {
        this.handleSubscriptionAction(socket, data);
      });

      // 🎁 Ações de promoções
      socket.on('promotion_action', (data) => {
        this.handlePromotionAction(socket, data);
      });

      socket.on('create_promotion', (data) => {
        this.handleCreatePromotion(socket, data);
      });

      // 👥 Ações de usuários
      socket.on('block_user', (data) => {
        this.handleBlockUser(socket, data);
      });

      socket.on('unblock_user', (data) => {
        this.handleUnblockUser(socket, data);
      });

      socket.on('disconnect', () => {
        this.unmarkSocketAuthenticated(socket);
        logStructured('info', 'Dashboard desconectado', { service: 'dashboard-websocket', socketId: socket.id });
      });
    });
  }

  // 📊 Métodos para enviar dados
  normalizeDriverStatus(rawStatus, isOnline) {
    const status = String(rawStatus || '').toLowerCase();
    if (status === 'busy' || status === 'in_trip' || status === 'started') return 'busy';
    if (status === 'available' || status === 'online') return 'available';
    return isOnline ? 'available' : 'offline';
  }

  async getLiveDataFromRedis() {
    return getDashboardLiveData(this.redis);
  }

  async getLiveDataFromFirebase() {
    return null;
  }

  async getLiveData() {
    const cachedPayload = this.getCachedPayload('live');
    if (cachedPayload) {
      return cachedPayload;
    }

    const liveData = (await this.getLiveDataFromRedis()) || {
      drivers: [],
      passengers: [],
      trips: [],
      stats: {
        driversOnline: 0,
        driversAvailable: 0,
        driversBusy: 0,
        passengerWaiting: 0,
        activeTrips: 0,
        avgWaitTime: 0,
        avgTripTime: 0
      }
    };

    this.setCache('live', liveData);
    return liveData;
  }

  async sendLiveData(socket) {
    const liveData = await this.getLiveData();
    socket.emit('live_stats', liveData.stats);
    socket.emit('live_stats_update', liveData.stats);
    socket.emit('driver_location_update', { drivers: liveData.drivers });
    socket.emit('passenger_location_update', { passengers: liveData.passengers });
    socket.emit('trip_update', { trips: liveData.trips });
  }

  sendUserStats(socket) {
    const stats = {
      total: 1247 + Math.floor(Math.random() * 10),
      customers: 892 + Math.floor(Math.random() * 5),
      drivers: 355 + Math.floor(Math.random() * 3),
      newToday: 12 + Math.floor(Math.random() * 5),
      newThisWeek: 87 + Math.floor(Math.random() * 10),
      newThisMonth: 234 + Math.floor(Math.random() * 20),
      activeToday: 789 + Math.floor(Math.random() * 20),
      growthRate: 15.2 + (Math.random() - 0.5) * 2,
      conversionRate: 3.8 + (Math.random() - 0.5)
    };

    socket.emit('user_stats_update', stats);
    socket.emit('users:stats:updated', stats);
  }

  sendRidesStats(socket) {
    const stats = {
      totalRides: 5678 + Math.floor(Math.random() * 50),
      activeRides: 89 + Math.floor(Math.random() * 10),
      completedToday: 234 + Math.floor(Math.random() * 20),
      averageValue: 25.50 + (Math.random() - 0.5) * 2,
      growthRate: 12.5 + (Math.random() - 0.5) * 2,
      timestamp: new Date().toISOString()
    };

    socket.emit('rides_stats_update', stats);
    socket.emit('rides:stats:updated', stats);
  }

  sendRevenueStats(socket) {
    const stats = {
      todayRevenue: 12345 + Math.floor(Math.random() * 500),
      monthlyRevenue: 234567 + Math.floor(Math.random() * 5000),
      averageTicket: 25.50 + (Math.random() - 0.5) * 2,
      growthRate: 8.2 + (Math.random() - 0.5) * 2,
      timestamp: new Date().toISOString()
    };

    socket.emit('revenue_stats_update', stats);
    socket.emit('revenue:stats:updated', stats);
  }

  async getRealTimeMetrics() {
    const cachedPayload = this.getCachedPayload('metrics');
    if (cachedPayload) {
      return cachedPayload;
    }

    try {
      const firestore = admin.firestore();
      const usersCollection = firestore.collection('users');
      const bookingsCollection = firestore.collection('bookings');

      // 1. Contagem de Usuários (Total)
      let totalUsersCount = 0;
      let newUsersToday = 0;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();

      totalUsersCount = await this.runCountAggregate(
        usersCollection.count(),
        'Erro ao contar usuarios totais no Firestore'
      );
      newUsersToday = await this.runCountAggregate(
        usersCollection.where('createdAt', '>=', todayISO).count(),
        'Erro ao contar novos usuarios do dia no Firestore'
      );

      // 2. Corridas Ativas (Redis) e Histórico Diário (Firestore)
      let activeRidesCount = 0;
      if (this.redis) {
        try {
          activeRidesCount = await this.redis.hlen('bookings:active');
        } catch (err) { }
      }

      let completedToday = 0;
      let todayRevenue = 0;
      let totalRidesCount = 0;
      let averageTicket = 0;
      let monthlyRevenue = 0;

      totalRidesCount = await this.runCountAggregate(
        bookingsCollection.count(),
        'Erro ao contar corridas totais no Firestore'
      );
      completedToday = await this.runCountAggregate(
        bookingsCollection
          .where('createdAt', '>=', todayISO)
          .where('status', 'in', ['completed', 'PAID'])
          .count(),
        'Erro ao contar corridas concluídas do dia no Firestore'
      );

      // 3. Buscar Dados do Fundo de Reserva (Custos Prejudiciais Absorvidos)
      let assumedCancellationCosts = 0;
      let financialMetrics = {};
      let operations = {
        reassignmentPending: {
          total: 0,
          stuck: 0,
          oldestAgeMs: 0,
          oldestBookingId: null,
          bookingIds: [],
          stuckThresholdMs: 0
        },
        earlyEndedReview: {
          total: 0,
          recent: 0,
          oldestAgeMs: 0,
          oldestBookingId: null,
          bookingIds: [],
          recentWindowMs: 0
        }
      };
      if (this.redis) {
        try {
          financialMetrics = await this.redis.hgetall('metrics:financial');
          const costStr = financialMetrics?.assumed_cancellation_costs;
          if (costStr) assumedCancellationCosts = this.parseMetricNumber(costStr);
          todayRevenue = this.parseMetricNumber(
            financialMetrics?.today_revenue ??
            financialMetrics?.todayRevenue ??
            financialMetrics?.daily_revenue,
            0
          );
          monthlyRevenue = this.parseMetricNumber(
            financialMetrics?.monthly_revenue ??
            financialMetrics?.monthlyRevenue,
            0
          );
          averageTicket = this.parseMetricNumber(
            financialMetrics?.average_ticket ??
            financialMetrics?.averageTicket,
            0
          );
          operations = await getRideOperationsSnapshot(this.redis, {
            nowIso: new Date().toISOString()
          });
        } catch (err) { }
      }

      const activeUsers = 0; // We define online drivers later

      const payload = {
        users: {
          totalUsers: totalUsersCount,
          activeUsers: activeUsers,
          newUsersToday: newUsersToday,
          growthRate: 0 // Placeholder
        },
        rides: {
          totalRides: totalRidesCount,
          activeRides: activeRidesCount,
          completedToday: completedToday,
          averageValue: averageTicket || (completedToday > 0 ? (todayRevenue / completedToday) : 0),
          growthRate: 0
        },
        revenue: {
          todayRevenue: todayRevenue,
          monthlyRevenue: monthlyRevenue,
          reserveFundLosses: assumedCancellationCosts,
          netRevenueToday: todayRevenue > 0 ? (todayRevenue - assumedCancellationCosts) : 0,
          averageTicket: averageTicket || (completedToday > 0 ? (todayRevenue / completedToday) : 0),
          growthRate: 0
        },
        conversion: {
          conversionRate: 100, // Placeholder
          completionRate: 100, // Placeholder
          growthRate: 0
        },
        operations,
        timestamp: new Date().toISOString()
      };

      this.setCache('metrics', payload);
      return payload;
    } catch (error) {
      logError(error, 'Erro fatal em getRealTimeMetrics', { service: 'dashboard-websocket' });
      return null;
    }
  }

  sendApprovalStats(socket) {
    const stats = {
      pending: 15 + Math.floor(Math.random() * 5),
      inReview: 8 + Math.floor(Math.random() * 3),
      approved: 234 + Math.floor(Math.random() * 10),
      rejected: 45 + Math.floor(Math.random() * 5),
      suspended: 3,
      banned: 2,
      totalApplications: 307 + Math.floor(Math.random() * 10),
      approvalRate: 76.2 + (Math.random() - 0.5) * 5,
      avgReviewTime: 2.3 + (Math.random() - 0.5),
      pendingOlderThan24h: Math.floor(Math.random() * 8)
    };

    socket.emit('approval_stats_update', stats);
  }

  sendDashboardMetrics(socket, data) {
    const { dateRange } = data || {};

    const financialMetrics = {
      revenue: {
        total: 125400.50 + Math.random() * 1000,
        rides: 89200.30 + Math.random() * 500,
        subscriptions: 28900.20 + Math.random() * 200,
        marketing: 7300.00 + Math.random() * 100,
        growth: 15.2 + (Math.random() - 0.5) * 2
      },
      costs: {
        total: 23450.80 + Math.random() * 100,
        infrastructure: 12500.00,
        apis: 8950.80,
        growth: -8.5 + (Math.random() - 0.5)
      }
    };

    const serviceMetrics = {
      websocket: {
        connections: 1247 + Math.floor(Math.random() * 50) - 25,
        messagesPerSec: 340 + Math.floor(Math.random() * 20) - 10,
        latency: 47 + Math.floor(Math.random() * 20) - 10,
        uptime: 99.8
      },
      redis: {
        operations: 125000 + Math.floor(Math.random() * 1000),
        hitRate: 94.2 + (Math.random() - 0.5),
        memory: 2.1 + (Math.random() - 0.5) * 0.2,
        connections: 45 + Math.floor(Math.random() * 5)
      }
    };

    socket.emit('financial_metrics_update', financialMetrics);
    socket.emit('service_metrics_update', serviceMetrics);
  }

  sendSubscriptionStats(socket) {
    const stats = {
      total: 234 + Math.floor(Math.random() * 10),
      active: 187 + Math.floor(Math.random() * 5),
      expired: 23 + Math.floor(Math.random() * 3),
      cancelled: 15 + Math.floor(Math.random() * 2),
      pending: 7 + Math.floor(Math.random() * 3),
      suspended: 2,
      revenue: {
        total: 28450.30 + Math.random() * 500,
        weekly: 18200.50 + Math.random() * 200,
        monthly: 10249.80 + Math.random() * 100,
        growth: 12.5 + (Math.random() - 0.5) * 2
      },
      churnRate: 8.2 + (Math.random() - 0.5),
      renewalRate: 84.5 + (Math.random() - 0.5) * 2,
      avgLifetime: 3.8 + (Math.random() - 0.5) * 0.5
    };

    socket.emit('subscription_stats_update', stats);
  }

  sendPromotionStats(socket) {
    const stats = {
      total: 8,
      active: 5,
      paused: 1,
      expired: 1,
      cancelled: 1,
      totalRevenue: 45600.80 + Math.random() * 1000,
      totalSavings: 12300.50 + Math.random() * 200,
      totalUsers: 1247 + Math.floor(Math.random() * 20),
      conversionRate: 24.8 + (Math.random() - 0.5) * 2
    };

    socket.emit('promotion_stats_update', stats);
  }

  // 🎬 Métodos para ações
  handleDriverApplicationReview(socket, data) {
    const { applicationId, action, notes, rejectionReasons } = data;

    logStructured('info', `Revisão de aplicação: ${action}`, { service: 'dashboard-websocket', applicationId, action, notes, rejectionReasons });

    // Simular processamento
    setTimeout(() => {
      socket.emit('application_status_changed', {
        applicationId,
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewDate: new Date().toISOString(),
        reviewedBy: 'admin',
        notes,
        rejectionReasons: action === 'reject' ? rejectionReasons : undefined
      });

      // Emitir para todos os dashboards conectados
      this.dashboardNamespace.emit('application_review_completed', {
        applicationId,
        action,
        timestamp: new Date().toISOString()
      });
    }, 1000);
  }

  handleSubscriptionAction(socket, data) {
    const { subscriptionId, action } = data;

    logStructured('info', `Ação em assinatura: ${action}`, { service: 'dashboard-websocket', subscriptionId, action });

    socket.emit('subscription_updated', {
      subscriptionId,
      action,
      timestamp: new Date().toISOString()
    });
  }

  handlePromotionAction(socket, data) {
    const { promotionId, action } = data;

    logStructured('info', `Ação em promoção: ${action}`, { service: 'dashboard-websocket', promotionId, action });

    socket.emit('promotion_updated', {
      promotionId,
      action,
      timestamp: new Date().toISOString()
    });
  }

  handleCreatePromotion(socket, data) {
    logStructured('info', 'Criando nova promoção', { service: 'dashboard-websocket', promotionName: data.name, ...data });

    // Simular criação
    setTimeout(() => {
      const newPromotion = {
        ...data,
        id: 'promo_' + Date.now(),
        createdAt: new Date().toISOString()
      };

      socket.emit('promotion_created', newPromotion);

      // Emitir para todos os dashboards
      this.dashboardNamespace.emit('new_promotion_created', {
        promotion: newPromotion,
        timestamp: new Date().toISOString()
      });
    }, 500);
  }

  handleBlockUser(socket, data) {
    const { userId } = data;

    logStructured('warn', 'Bloqueando usuário', { service: 'dashboard-websocket', userId });

    socket.emit('user_status_changed', {
      userId,
      status: 'blocked',
      timestamp: new Date().toISOString()
    });
  }

  handleUnblockUser(socket, data) {
    const { userId } = data;

    logStructured('info', 'Desbloqueando usuário', { service: 'dashboard-websocket', userId });

    socket.emit('user_status_changed', {
      userId,
      status: 'active',
      timestamp: new Date().toISOString()
    });
  }

  // 🔄 Atualizações periódicas
  startPeriodicUpdates() {
    if (this.metricsIntervalId || this.liveIntervalId) {
      return;
    }

    this.metricsIntervalId = setInterval(async () => {
      if (!this.hasAuthenticatedClients()) {
        return;
      }

      try {
        const metrics = await this.getRealTimeMetrics();
        if (metrics) {
          this.emitToAuthenticated('metrics:updated', metrics);
        }
      } catch (error) {
        logError(error, 'Erro ao buscar métricas em tempo real', { service: 'dashboard-websocket' });
      }
    }, this.metricsIntervalMs);

    this.liveIntervalId = setInterval(async () => {
      if (!this.hasAuthenticatedClients()) {
        return;
      }

      try {
        const liveData = await this.getLiveData();
        this.emitToAuthenticated('live_stats_update', liveData.stats);
        this.emitToAuthenticated('driver_location_update', { drivers: liveData.drivers });
        this.emitToAuthenticated('passenger_location_update', { passengers: liveData.passengers });
        this.emitToAuthenticated('trip_update', { trips: liveData.trips });
        this.scheduleH3Refresh({
          reason: 'live_loop'
        });
      } catch (error) {
        logError(error, 'Erro ao publicar live data em tempo real', { service: 'dashboard-websocket' });
      }
    }, this.liveIntervalMs);

    logStructured('info', 'Loops periódicos do dashboard iniciados', {
      service: 'dashboard-websocket',
      metricsIntervalMs: this.metricsIntervalMs,
      liveIntervalMs: this.liveIntervalMs
    });
  }

  stopPeriodicUpdates() {
    if (this.metricsIntervalId) {
      clearInterval(this.metricsIntervalId);
      this.metricsIntervalId = null;
    }

    if (this.liveIntervalId) {
      clearInterval(this.liveIntervalId);
      this.liveIntervalId = null;
    }

    if (this.pendingH3RefreshTimerId) {
      clearTimeout(this.pendingH3RefreshTimerId);
      this.pendingH3RefreshTimerId = null;
    }
    this.pendingH3RefreshPayload = null;

    logStructured('info', 'Loops periódicos do dashboard parados', {
      service: 'dashboard-websocket'
    });
  }

  // 📡 Métodos públicos para eventos externos
  emitDriverLocationUpdate(driverId, location) {
    this.dashboardNamespace.emit('driver_location_update', {
      driverId,
      lat: location.lat,
      lng: location.lng,
      timestamp: new Date().toISOString()
    });
    this.scheduleH3Refresh({
      reason: 'driver_location_update',
      driverId
    });
  }

  emitTripUpdate(tripData) {
    this.dashboardNamespace.emit('trip_update', tripData);
    this.scheduleH3Refresh({
      reason: 'trip_update',
      bookingId: tripData?.bookingId || tripData?.id || null
    });
  }

  emitUserRegistered(userData) {
    this.dashboardNamespace.emit('user_registered', userData);
  }

  emitNewDriverApplication(applicationData) {
    this.dashboardNamespace.emit('new_driver_application', applicationData);
  }
}

module.exports = DashboardWebSocketService;
