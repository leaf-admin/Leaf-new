// 📡 DASHBOARD WEBSOCKET SERVICE
// Gerencia eventos WebSocket específicos para o dashboard

const admin = require('firebase-admin');
const { logStructured, logError } = require('../utils/logger');
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (error) {
  logStructured('warn', '⚠️ Firebase config não encontrado para dashboard websocket', { service: 'dashboard-websocket' });
}

class DashboardWebSocketService {
  constructor(io, redis) {
    this.io = io;
    this.redis = redis;
    this.dashboardNamespace = io.of('/dashboard');
    this.setupDashboardEvents();
    this.startPeriodicUpdates();
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
            const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || 'leaf-admin-secret-key-change-in-production';

            const decoded = jwt.verify(jwtToken, JWT_SECRET);

            // Verificar se usuário é admin no Firestore
            const firestore = admin.firestore();
            const adminUserDoc = await firestore.collection('adminUsers').doc(decoded.userId).get();

            if (!adminUserDoc.exists) {
              socket.emit('authentication_error', {
                message: 'Usuário não possui permissões de admin'
              });
              socket.disconnect();
              return;
            }

            const adminData = adminUserDoc.data();
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
            socket.userRole = decoded.role || adminData.role;
            socket.userPermissions = decoded.permissions || adminData.permissions || [];

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

          // Verificar se o usuário é admin no Firestore
          const firestore = admin.firestore();
          const adminUserDoc = await firestore.collection('adminUsers').doc(decodedToken.uid).get();

          if (!adminUserDoc.exists) {
            socket.emit('authentication_error', {
              message: 'Usuário não possui permissões de admin'
            });
            socket.disconnect();
            return;
          }

          const adminData = adminUserDoc.data();
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
        await this.sendLiveData(socket);
      });

      socket.on('request_user_stats', () => {
        this.sendUserStats(socket);
      });

      socket.on('request_rides_stats', () => {
        this.sendRidesStats(socket);
      });

      socket.on('request_revenue_stats', () => {
        this.sendRevenueStats(socket);
      });

      socket.on('request_approval_stats', () => {
        this.sendApprovalStats(socket);
      });

      socket.on('request_dashboard_metrics', (data) => {
        this.sendDashboardMetrics(socket, data);
      });

      socket.on('request_subscription_stats', () => {
        this.sendSubscriptionStats(socket);
      });

      socket.on('request_promotion_stats', () => {
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
    if (!this.redis) return null;

    try {
      const [driverIds, activeTripsCount] = await Promise.all([
        this.redis.zrange('driver_locations', 0, -1),
        this.redis.hlen('bookings:active').catch(() => 0)
      ]);

      const drivers = [];
      if (Array.isArray(driverIds) && driverIds.length > 0) {
        const pipeline = this.redis.pipeline();
        driverIds.forEach((driverId) => {
          pipeline.geopos('driver_locations', driverId);
          pipeline.hgetall(`driver:${driverId}`);
        });
        const rows = await pipeline.exec();

        for (let i = 0; i < driverIds.length; i++) {
          const driverId = driverIds[i];
          const geoResult = rows[i * 2]?.[1];
          const hash = rows[i * 2 + 1]?.[1] || {};
          const coords = Array.isArray(geoResult) ? geoResult[0] : null;
          if (!coords || coords.length < 2) continue;

          const lng = Number(coords[0]);
          const lat = Number(coords[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

          const isOnline = String(hash?.isOnline || 'true') === 'true';
          const status = this.normalizeDriverStatus(hash?.status, isOnline);

          drivers.push({
            id: driverId,
            type: 'driver',
            name: hash?.name || hash?.displayName || '',
            location: {
              lat,
              lng,
              heading: Number(hash?.heading || 0),
              speed: Number(hash?.speed || 0),
              lastUpdate: hash?.lastUpdate ? new Date(Number(hash.lastUpdate)).toISOString() : new Date().toISOString()
            },
            status,
            vehicle: {
              plate: hash?.vehicleNumber || hash?.vehiclePlate || '',
              type: hash?.carType || hash?.vehicleCategory || ''
            },
            rating: Number(hash?.rating || 0)
          });
        }
      }

      const driversAvailable = drivers.filter((driver) => driver.status === 'available').length;
      const driversBusy = drivers.filter((driver) => driver.status === 'busy').length;

      return {
        drivers,
        passengers: [],
        trips: [],
        stats: {
          driversOnline: drivers.length,
          driversAvailable,
          driversBusy,
          passengerWaiting: 0,
          activeTrips: Number(activeTripsCount || 0),
          avgWaitTime: 0,
          avgTripTime: 0
        }
      };
    } catch (error) {
      logError(error, 'Erro ao montar live data via Redis', { service: 'dashboard-websocket' });
      return null;
    }
  }

  async getLiveDataFromFirebase() {
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) return null;

    try {
      const db = firebaseConfig.getRealtimeDB();
      const [locationsSnapshot, usersSnapshot] = await Promise.all([
        db.ref('locations').once('value'),
        db.ref('users').once('value')
      ]);

      const locationsData = locationsSnapshot.val() || {};
      const users = usersSnapshot.val() || {};
      const drivers = [];

      Object.keys(locationsData).forEach((userId) => {
        const locationData = locationsData[userId];
        const user = users[userId];
        if (!user || user.usertype !== 'driver') return;
        const lat = Number(locationData?.lat);
        const lng = Number(locationData?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const status = locationData?.online ? (locationData?.busy ? 'busy' : 'available') : 'offline';
        drivers.push({
          id: userId,
          type: 'driver',
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          location: {
            lat,
            lng,
            heading: Number(locationData?.heading || 0),
            speed: Number(locationData?.speed || 0),
            lastUpdate: locationData?.timestamp ? new Date(locationData.timestamp).toISOString() : new Date().toISOString()
          },
          status,
          vehicle: {
            plate: user?.carPlate || user?.vehiclePlate || '',
            type: user?.carType || ''
          },
          rating: Number(user?.driverRating || 0)
        });
      });

      const driversOnline = drivers.filter((driver) => driver.status !== 'offline').length;
      const driversAvailable = drivers.filter((driver) => driver.status === 'available').length;
      const driversBusy = drivers.filter((driver) => driver.status === 'busy').length;

      return {
        drivers,
        passengers: [],
        trips: [],
        stats: {
          driversOnline,
          driversAvailable,
          driversBusy,
          passengerWaiting: 0,
          activeTrips: 0,
          avgWaitTime: 0,
          avgTripTime: 0
        }
      };
    } catch (error) {
      logError(error, 'Erro ao montar live data via Firebase', { service: 'dashboard-websocket' });
      return null;
    }
  }

  async getLiveData() {
    return (await this.getLiveDataFromRedis()) || (await this.getLiveDataFromFirebase()) || {
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
    try {
      const firestore = admin.firestore();

      // 1. Contagem de Usuários (Total)
      let totalUsersCount = 0;
      let newUsersToday = 0;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();

      try {
        const usersSnapshot = await firestore.collection('users').get();
        totalUsersCount = usersSnapshot.size;

        // Count users created today
        usersSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.createdAt && data.createdAt >= todayISO) {
            newUsersToday++;
          }
        });
      } catch (err) {
        logError(err, 'Erro ao contar usuarios no Firestore', { service: 'dashboard-websocket' });
      }

      // 2. Corridas Ativas (Redis) e Histórico Diário (Firestore)
      let activeRidesCount = 0;
      if (this.redis) {
        try {
          const activeBookings = await this.redis.hkeys('bookings:active');
          activeRidesCount = activeBookings.length;
        } catch (err) { }
      }

      let completedToday = 0;
      let todayRevenue = 0;
      let totalRidesCount = 0;

      try {
        // Query daily completed rides (status = 'paid' or 'completed')
        // We fetch all from today
        const ridesSnapshot = await firestore.collection('bookings')
          .where('createdAt', '>=', todayISO)
          .get();

        ridesSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.status === 'completed' || data.status === 'PAID') {
            completedToday++;
            todayRevenue += parseFloat(data.finalPrice || data.estimate || 0);
          }
        });

        // Optional: Count all time rides (might be heavy if lots of rides, using arbitrary count for now)
        // A robust way in production is using Firestore aggregation queries (count)
        const allRidesMeta = await firestore.collection('bookings').count().get();
        totalRidesCount = allRidesMeta.data().count;

      } catch (err) {
        logError(err, 'Erro ao contar corridas no Firestore', { service: 'dashboard-websocket' });
      }

      // 3. Buscar Dados do Fundo de Reserva (Custos Prejudiciais Absorvidos)
      let assumedCancellationCosts = 0;
      if (this.redis) {
        try {
          const costStr = await this.redis.hget('metrics:financial', 'assumed_cancellation_costs');
          if (costStr) assumedCancellationCosts = parseFloat(costStr);
        } catch (err) { }
      }

      const activeUsers = 0; // We define online drivers later

      return {
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
          averageValue: completedToday > 0 ? (todayRevenue / completedToday) : 0,
          growthRate: 0
        },
        revenue: {
          todayRevenue: todayRevenue,
          monthlyRevenue: todayRevenue * 30, // Rough estimate placeholder until we implement monthly aggregation
          reserveFundLosses: assumedCancellationCosts, // ✅ Nova métrica de perdas absorvidas
          netRevenueToday: todayRevenue > 0 ? (todayRevenue - assumedCancellationCosts) : 0,
          averageTicket: completedToday > 0 ? (todayRevenue / completedToday) : 0,
          growthRate: 0
        },
        conversion: {
          conversionRate: 100, // Placeholder
          completionRate: 100, // Placeholder
          growthRate: 0
        },
        timestamp: new Date().toISOString()
      };
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
    // Atualizar métricas gerais a cada 5 segundos
    setInterval(async () => {
      try {
        // Buscar métricas reais (se disponível)
        const metrics = await this.getRealTimeMetrics();

        // Emitir para todos os dashboards conectados e autenticados
        this.dashboardNamespace.emit('metrics:updated', metrics);
      } catch (error) {
        logError(error, 'Erro ao buscar métricas em tempo real', { service: 'dashboard-websocket' });
      }
    }, 5000); // A cada 5 segundos

    // Atualizar live data real a cada 5 segundos
    setInterval(async () => {
      try {
        const liveData = await this.getLiveData();
        this.dashboardNamespace.emit('live_stats_update', liveData.stats);
        this.dashboardNamespace.emit('driver_location_update', { drivers: liveData.drivers });
        this.dashboardNamespace.emit('passenger_location_update', { passengers: liveData.passengers });
        this.dashboardNamespace.emit('trip_update', { trips: liveData.trips });
      } catch (error) {
        logError(error, 'Erro ao publicar live data em tempo real', { service: 'dashboard-websocket' });
      }
    }, 5000);
  }

  // 📡 Métodos públicos para eventos externos
  emitDriverLocationUpdate(driverId, location) {
    this.dashboardNamespace.emit('driver_location_update', {
      driverId,
      lat: location.lat,
      lng: location.lng,
      timestamp: new Date().toISOString()
    });
  }

  emitTripUpdate(tripData) {
    this.dashboardNamespace.emit('trip_update', tripData);
  }

  emitUserRegistered(userData) {
    this.dashboardNamespace.emit('user_registered', userData);
  }

  emitNewDriverApplication(applicationData) {
    this.dashboardNamespace.emit('new_driver_application', applicationData);
  }
}

module.exports = DashboardWebSocketService;
