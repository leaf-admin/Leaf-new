// 📡 DASHBOARD WEBSOCKET SERVICE
// Gerencia eventos WebSocket específicos para o dashboard

const admin = require('firebase-admin');
const { logStructured, logError } = require('../utils/logger');

class DashboardWebSocketService {
  constructor(io) {
    this.io = io;
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
      socket.on('request_live_data', () => {
        this.sendLiveData(socket);
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
  sendLiveData(socket) {
    const liveData = {
      drivers: [
        {
          id: 'driver1',
          name: 'João Silva',
          lat: -23.5505 + (Math.random() - 0.5) * 0.01,
          lng: -46.6333 + (Math.random() - 0.5) * 0.01,
          status: 'available',
          vehicle: { model: 'Honda Civic', plate: 'ABC-1234' },
          rating: 4.8,
          tripsToday: 12,
          lastUpdate: new Date().toISOString()
        },
        {
          id: 'driver2',
          name: 'Maria Santos',
          lat: -23.5615 + (Math.random() - 0.5) * 0.01,
          lng: -46.6565 + (Math.random() - 0.5) * 0.01,
          status: 'busy',
          vehicle: { model: 'Toyota Corolla', plate: 'XYZ-5678' },
          rating: 4.9,
          tripsToday: 8,
          lastUpdate: new Date().toISOString()
        }
      ],
      passengers: [
        {
          id: 'passenger1',
          name: 'Carlos Oliveira',
          lat: -23.5405 + (Math.random() - 0.5) * 0.01,
          lng: -46.6405 + (Math.random() - 0.5) * 0.01,
          status: 'waiting',
          waitingTime: Math.floor(Math.random() * 10) + 1,
          lastUpdate: new Date().toISOString()
        }
      ],
      trips: [
        {
          id: 'trip1',
          driver: { id: 'driver2', name: 'Maria Santos' },
          passenger: { id: 'passenger1', name: 'Carlos Oliveira' },
          pickup: { lat: -23.5405, lng: -46.6405, address: 'Av. Paulista, 1000' },
          destination: { lat: -23.5705, lng: -46.6505, address: 'Shopping Ibirapuera' },
          status: 'in_progress',
          estimatedTime: 15,
          distance: 8.5,
          fare: 25.50,
          startTime: new Date().toISOString()
        }
      ],
      stats: {
        driversOnline: 245 + Math.floor(Math.random() * 20) - 10,
        driversAvailable: 120 + Math.floor(Math.random() * 10) - 5,
        passengerWaiting: 15 + Math.floor(Math.random() * 10) - 5,
        activeTrips: 67 + Math.floor(Math.random() * 10) - 5,
        avgWaitTime: 3.2 + (Math.random() - 0.5),
        avgTripTime: 18.5 + (Math.random() - 0.5) * 2
      }
    };

    socket.emit('live_stats', liveData.stats);
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
    // Buscar métricas reais do sistema
    // Por enquanto, retornar estrutura básica
    // TODO: Integrar com serviços de métricas reais
    return {
      users: {
        totalUsers: 1234,
        activeUsers: 890,
        newUsersToday: 45,
        growthRate: 20.1
      },
      rides: {
        totalRides: 5678,
        activeRides: 89,
        completedToday: 234,
        averageValue: 25.50,
        growthRate: 12.5
      },
      revenue: {
        todayRevenue: 12345,
        monthlyRevenue: 234567,
        averageTicket: 25.50,
        growthRate: 8.2
      },
      conversion: {
        conversionRate: 78.5,
        completionRate: 92.3,
        growthRate: 2.1
      },
      timestamp: new Date().toISOString()
    };
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
    
    // Atualizar stats a cada 30 segundos
    setInterval(() => {
      this.dashboardNamespace.emit('live_stats_update', {
        driversOnline: 245 + Math.floor(Math.random() * 20) - 10,
        driversAvailable: 120 + Math.floor(Math.random() * 10) - 5,
        passengerWaiting: 15 + Math.floor(Math.random() * 10) - 5,
        activeTrips: 67 + Math.floor(Math.random() * 10) - 5,
        timestamp: new Date().toISOString()
      });
    }, 30000);

    // Simular novas aplicações de motoristas
    setInterval(() => {
      if (Math.random() < 0.3) { // 30% chance a cada minuto
        this.dashboardNamespace.emit('new_driver_application', {
          id: 'app_' + Date.now(),
          driver: {
            name: `Motorista ${Math.floor(Math.random() * 1000)}`,
            email: `driver${Math.floor(Math.random() * 1000)}@email.com`
          },
          status: 'pending',
          applicationDate: new Date().toISOString(),
          score: 6 + Math.random() * 4
        });
      }
    }, 60000);

    // Simular novos usuários
    setInterval(() => {
      if (Math.random() < 0.5) { // 50% chance a cada 2 minutos
        this.dashboardNamespace.emit('user_registered', {
          id: 'user_' + Date.now(),
          type: Math.random() < 0.7 ? 'customer' : 'driver',
          registrationDate: new Date().toISOString()
        });
      }
    }, 120000);
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
