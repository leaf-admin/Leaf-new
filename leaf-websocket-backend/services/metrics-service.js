const admin = require('firebase-admin');
const Redis = require('ioredis');
const { logger } = require('../utils/logger');

class MetricsService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.isInitialized = false;
    this.cacheTTL = 5 * 60; // 5 minutos
  }

  async initialize() {
    try {
      await this.redis.ping();
      this.isInitialized = true;
      logger.info('✅ Metrics Service inicializado');
    } catch (error) {
      logger.error('❌ Erro ao inicializar Metrics Service:', error);
      throw error;
    }
  }

  // ===== MÉTRICAS GERAIS =====
  async getGeneralMetrics() {
    try {
      const cacheKey = 'metrics:general';
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const [
        userStats,
        financialStats,
        performanceStats,
        approvalStats
      ] = await Promise.all([
        this.getUserStats(),
        this.getFinancialStats(),
        this.getPerformanceStats(),
        this.getApprovalStats()
      ]);

      const metrics = {
        timestamp: new Date().toISOString(),
        userStats,
        financialStats,
        performanceStats,
        approvalStats,
        system: {
          status: 'healthy',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.version
        }
      };

      // Cache por 5 minutos
      await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(metrics));
      
      return metrics;
    } catch (error) {
      logger.error('❌ Erro ao obter métricas gerais:', error);
      throw error;
    }
  }

  // ===== MÉTRICAS DE USUÁRIOS =====
  async getUserStats() {
    try {
      const cacheKey = 'metrics:users';
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Buscar usuários do Firebase
      const usersRef = admin.firestore().collection('users');
      const snapshot = await usersRef.get();

      let totalUsers = 0;
      let totalCustomers = 0;
      let totalDrivers = 0;
      let onlineUsers = 0;
      let pendingApprovals = 0;
      let approvedDrivers = 0;
      let rejectedDrivers = 0;

      const userTypes = {};
      const userStatuses = {};
      const userLocations = {};

      snapshot.forEach(doc => {
        const userData = doc.data();
        totalUsers++;

        // Contar por tipo
        const userType = userData.userType || 'unknown';
        userTypes[userType] = (userTypes[userType] || 0) + 1;

        if (userType === 'customer') {
          totalCustomers++;
        } else if (userType === 'driver') {
          totalDrivers++;
          
          // Contar por status
          const status = userData.status || 'unknown';
          userStatuses[status] = (userStatuses[status] || 0) + 1;

          if (status === 'pending_approval') pendingApprovals++;
          else if (status === 'approved') approvedDrivers++;
          else if (status === 'rejected') rejectedDrivers++;
        }

        // Verificar se está online (última atividade < 5 minutos)
        if (userData.lastActivity) {
          const lastActivity = new Date(userData.lastActivity.toDate());
          const now = new Date();
          const diffMinutes = (now - lastActivity) / (1000 * 60);
          
          if (diffMinutes < 5) {
            onlineUsers++;
          }
        }

        // Contar por localização
        if (userData.city) {
          userLocations[userData.city] = (userLocations[userData.city] || 0) + 1;
        }
      });

      // Buscar usuários online do Redis
      const onlineFromRedis = await this.redis.scard('online_users');
      onlineUsers = Math.max(onlineUsers, onlineFromRedis);

      const stats = {
        totalUsers,
        totalCustomers,
        totalDrivers,
        onlineUsers,
        pendingApprovals,
        approvedDrivers,
        rejectedDrivers,
        userTypes,
        userStatuses,
        userLocations,
        onlinePercentage: totalUsers > 0 ? ((onlineUsers / totalUsers) * 100).toFixed(2) : 0,
        approvalRate: totalDrivers > 0 ? ((approvedDrivers / totalDrivers) * 100).toFixed(2) : 0
      };

      // Cache por 2 minutos (usuários mudam frequentemente)
      await this.redis.setex(cacheKey, 120, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas de usuários:', error);
      throw error;
    }
  }

  // ===== MÉTRICAS FINANCEIRAS =====
  async getFinancialStats() {
    try {
      const cacheKey = 'metrics:financial';
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Buscar viagens do Firebase
      const tripsRef = admin.firestore().collection('trips');
      const snapshot = await tripsRef.get();

      let totalTrips = 0;
      let totalRevenue = 0;
      let totalCosts = 0;
      let todayTrips = 0;
      let todayRevenue = 0;
      let monthlyTrips = 0;
      let monthlyRevenue = 0;

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      snapshot.forEach(doc => {
        const tripData = doc.data();
        totalTrips++;

        const tripValue = tripData.fare || 0;
        const tripCost = tripData.cost || (tripValue * 0.3); // 30% de custo estimado

        totalRevenue += tripValue;
        totalCosts += tripCost;

        // Viagens de hoje
        if (tripData.completedAt) {
          const completedAt = tripData.completedAt.toDate();
          if (completedAt >= today) {
            todayTrips++;
            todayRevenue += tripValue;
          }

          // Viagens do mês
          if (completedAt >= monthStart) {
            monthlyTrips++;
            monthlyRevenue += tripValue;
          }
        }
      });

      const totalProfit = totalRevenue - totalCosts;
      const todayProfit = todayRevenue - (todayRevenue * 0.3);
      const monthlyProfit = monthlyRevenue - (monthlyRevenue * 0.3);

      const stats = {
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalCosts: parseFloat(totalCosts.toFixed(2)),
        totalProfit: parseFloat(totalProfit.toFixed(2)),
        totalTrips,
        averageTripValue: totalTrips > 0 ? parseFloat((totalRevenue / totalTrips).toFixed(2)) : 0,
        
        todayRevenue: parseFloat(todayRevenue.toFixed(2)),
        todayTrips,
        todayProfit: parseFloat(todayProfit.toFixed(2)),
        todayAverageTrip: todayTrips > 0 ? parseFloat((todayRevenue / todayTrips).toFixed(2)) : 0,
        
        monthlyRevenue: parseFloat(monthlyRevenue.toFixed(2)),
        monthlyTrips,
        monthlyProfit: parseFloat(monthlyProfit.toFixed(2)),
        monthlyAverageTrip: monthlyTrips > 0 ? parseFloat((monthlyRevenue / monthlyTrips).toFixed(2)) : 0,
        
        profitMargin: totalRevenue > 0 ? parseFloat(((totalProfit / totalRevenue) * 100).toFixed(2)) : 0,
        costPercentage: totalRevenue > 0 ? parseFloat(((totalCosts / totalRevenue) * 100).toFixed(2)) : 0,
        
        revenueGrowth: this.calculateGrowth(monthlyRevenue, totalRevenue),
        profitGrowth: this.calculateGrowth(monthlyProfit, totalProfit),
        tripsGrowth: this.calculateGrowth(monthlyTrips, totalTrips)
      };

      // Cache por 10 minutos (financeiro muda menos)
      await this.redis.setex(cacheKey, 600, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas financeiras:', error);
      throw error;
    }
  }

  // ===== MÉTRICAS DE PERFORMANCE =====
  async getPerformanceStats() {
    try {
      const cacheKey = 'metrics:performance';
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Buscar viagens do Firebase para métricas de performance
      const tripsRef = admin.firestore().collection('trips');
      const snapshot = await tripsRef.get();

      let totalTrips = 0;
      let completedTrips = 0;
      let cancelledTrips = 0;
      let averageTripDuration = 0;
      let averageWaitTime = 0;
      let totalDistance = 0;
      let totalDuration = 0;
      let totalWaitTime = 0;

      const tripStatuses = {};
      const tripTypes = {};
      const hourlyDistribution = {};

      snapshot.forEach(doc => {
        const tripData = doc.data();
        totalTrips++;

        // Contar por status
        const status = tripData.status || 'unknown';
        tripStatuses[status] = (tripStatuses[status] || 0) + 1;

        if (status === 'completed') completedTrips++;
        else if (status === 'cancelled') cancelledTrips++;

        // Contar por tipo
        const type = tripData.type || 'standard';
        tripTypes[type] = (tripTypes[type] || 0) + 1;

        // Calcular duração da viagem
        if (tripData.startedAt && tripData.completedAt) {
          const startTime = tripData.startedAt.toDate();
          const endTime = tripData.completedAt.toDate();
          const duration = (endTime - startTime) / (1000 * 60); // minutos
          totalDuration += duration;
        }

        // Calcular tempo de espera
        if (tripData.requestedAt && tripData.startedAt) {
          const requestTime = tripData.requestedAt.toDate();
          const startTime = tripData.startedAt.toDate();
          const waitTime = (startTime - requestTime) / (1000 * 60); // minutos
          totalWaitTime += waitTime;
        }

        // Calcular distância
        if (tripData.distance) {
          totalDistance += tripData.distance;
        }

        // Distribuição horária
        if (tripData.requestedAt) {
          const hour = tripData.requestedAt.toDate().getHours();
          hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
        }
      });

      averageTripDuration = completedTrips > 0 ? totalDuration / completedTrips : 0;
      averageWaitTime = completedTrips > 0 ? totalWaitTime / completedTrips : 0;

      const stats = {
        totalTrips,
        completedTrips,
        cancelledTrips,
        completionRate: totalTrips > 0 ? parseFloat(((completedTrips / totalTrips) * 100).toFixed(2)) : 0,
        cancellationRate: totalTrips > 0 ? parseFloat(((cancelledTrips / totalTrips) * 100).toFixed(2)) : 0,
        
        averageTripDuration: parseFloat(averageTripDuration.toFixed(2)),
        averageWaitTime: parseFloat(averageWaitTime.toFixed(2)),
        totalDistance: parseFloat(totalDistance.toFixed(2)),
        
        tripStatuses,
        tripTypes,
        hourlyDistribution,
        
        performance: {
          excellent: completedTrips > 0 && averageWaitTime < 5 ? 'Baixo tempo de espera' : 'Pode melhorar',
          rating: completedTrips > 0 ? Math.min(5, Math.max(1, 5 - (averageWaitTime / 2))) : 0
        }
      };

      // Cache por 3 minutos (performance muda frequentemente)
      await this.redis.setex(cacheKey, 180, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas de performance:', error);
      throw error;
    }
  }

  // ===== MÉTRICAS DE APROVAÇÃO =====
  async getApprovalStats() {
    try {
      const cacheKey = 'metrics:approval';
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Buscar aprovações do Redis (mais rápido)
      const pendingApprovals = await this.redis.scard('approvals_by_status:pending');
      const approvedDrivers = await this.redis.scard('approvals_by_status:approved');
      const rejectedDrivers = await this.redis.scard('approvals_by_status:rejected');

      const totalApprovals = pendingApprovals + approvedDrivers + rejectedDrivers;
      const approvalRate = totalApprovals > 0 ? ((approvedDrivers / totalApprovals) * 100).toFixed(2) : 0;

      // Buscar dados adicionais do Firebase
      const usersRef = admin.firestore().collection('users');
      const snapshot = await usersRef
        .where('userType', '==', 'driver')
        .where('status', '==', 'pending_approval')
        .get();

      const pendingDetails = [];
      snapshot.forEach(doc => {
        const userData = doc.data();
        pendingDetails.push({
          id: doc.id,
          name: userData.name || userData.displayName,
          email: userData.email,
          phone: userData.phoneNumber,
          createdAt: userData.createdAt?.toDate() || new Date(),
          documentsCount: userData.documents?.length || 0
        });
      });

      const stats = {
        totalApprovals,
        pendingApprovals,
        approvedDrivers,
        rejectedDrivers,
        approvalRate: parseFloat(approvalRate),
        pendingDetails,
        
        trends: {
          daily: await this.getApprovalTrends('daily'),
          weekly: await this.getApprovalTrends('weekly'),
          monthly: await this.getApprovalTrends('monthly')
        },
        
        averageProcessingTime: await this.getAverageProcessingTime(),
        documentCompleteness: await this.getDocumentCompleteness()
      };

      // Cache por 2 minutos
      await this.redis.setex(cacheKey, 120, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas de aprovação:', error);
      throw error;
    }
  }

  // ===== MÉTRICAS EM TEMPO REAL =====
  async getRealTimeMetrics() {
    try {
      const cacheKey = 'metrics:realtime';
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        const cachedData = JSON.parse(cached);
        const cacheAge = Date.now() - new Date(cachedData.timestamp).getTime();
        
        // Se cache tem menos de 30 segundos, usar
        if (cacheAge < 30000) {
          return cachedData;
        }
      }

      // Buscar dados em tempo real
      const [
        activeUsers,
        activeTrips,
        systemLoad,
        recentActivity
      ] = await Promise.all([
        this.getActiveUsers(),
        this.getActiveTrips(),
        this.getSystemLoad(),
        this.getRecentActivity()
      ]);

      const metrics = {
        timestamp: new Date().toISOString(),
        activeUsers,
        activeTrips,
        systemLoad,
        recentActivity,
        alerts: await this.getSystemAlerts()
      };

      // Cache por 30 segundos (tempo real)
      await this.redis.setex(cacheKey, 30, JSON.stringify(metrics));
      
      return metrics;
    } catch (error) {
      logger.error('❌ Erro ao obter métricas em tempo real:', error);
      throw error;
    }
  }

  // ===== MÉTODOS AUXILIARES =====

  calculateGrowth(current, total) {
    if (total === 0) return '0%';
    const growth = ((current / total) * 100).toFixed(2);
    return `${growth}%`;
  }

  async getApprovalTrends(period) {
    try {
      // Implementar lógica de tendências baseada no histórico
      const trends = {
        daily: { pending: 0, approved: 0, rejected: 0 },
        weekly: { pending: 0, approved: 0, rejected: 0 },
        monthly: { pending: 0, approved: 0, rejected: 0 }
      };

      return trends[period] || trends.daily;
    } catch (error) {
      logger.error('❌ Erro ao obter tendências de aprovação:', error);
      return { pending: 0, approved: 0, rejected: 0 };
    }
  }

  async getAverageProcessingTime() {
    try {
      // Implementar cálculo de tempo médio de processamento
      return 2.5; // dias (exemplo)
    } catch (error) {
      logger.error('❌ Erro ao obter tempo médio de processamento:', error);
      return 0;
    }
  }

  async getDocumentCompleteness() {
    try {
      // Implementar cálculo de completude de documentos
      return 85; // porcentagem (exemplo)
    } catch (error) {
      logger.error('❌ Erro ao obter completude de documentos:', error);
      return 0;
    }
  }

  async getActiveUsers() {
    try {
      const onlineUsers = await this.redis.scard('online_users');
      const activeSessions = await this.redis.scard('active_sessions');
      
      return {
        online: onlineUsers,
        activeSessions,
        totalActive: onlineUsers + activeSessions
      };
    } catch (error) {
      logger.error('❌ Erro ao obter usuários ativos:', error);
      return { online: 0, activeSessions: 0, totalActive: 0 };
    }
  }

  async getActiveTrips() {
    try {
      const activeTrips = await this.redis.scard('active_trips');
      const pendingTrips = await this.redis.scard('pending_trips');
      
      return {
        active: activeTrips,
        pending: pendingTrips,
        total: activeTrips + pendingTrips
      };
    } catch (error) {
      logger.error('❌ Erro ao obter viagens ativas:', error);
      return { active: 0, pending: 0, total: 0 };
    }
  }

  async getSystemLoad() {
    try {
      const cpuUsage = process.cpuUsage();
      const memoryUsage = process.memoryUsage();
      
      return {
        cpu: {
          user: Math.round(cpuUsage.user / 1000000), // segundos
          system: Math.round(cpuUsage.system / 1000000), // segundos
          total: Math.round((cpuUsage.user + cpuUsage.system) / 1000000) // segundos
        },
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024) // MB
        },
        uptime: Math.round(process.uptime()) // segundos
      };
    } catch (error) {
      logger.error('❌ Erro ao obter carga do sistema:', error);
      return { cpu: {}, memory: {}, uptime: 0 };
    }
  }

  async getRecentActivity() {
    try {
      // Buscar atividades recentes do Redis
      const recentLogs = await this.redis.lrange('recent_activity', 0, 9);
      
      return recentLogs.map(log => {
        try {
          return JSON.parse(log);
        } catch {
          return { message: log, timestamp: new Date().toISOString() };
        }
      });
    } catch (error) {
      logger.error('❌ Erro ao obter atividades recentes:', error);
      return [];
    }
  }

  async getSystemAlerts() {
    try {
      const alerts = [];
      
      // Verificar alertas do sistema
      const systemHealth = await this.redis.get('system:health');
      if (systemHealth) {
        const health = JSON.parse(systemHealth);
        if (health.status === 'warning' || health.status === 'critical') {
          alerts.push({
            type: health.status,
            message: health.message,
            timestamp: health.timestamp
          });
        }
      }

      return alerts;
    } catch (error) {
      logger.error('❌ Erro ao obter alertas do sistema:', error);
      return [];
    }
  }

  // ===== LIMPEZA DE CACHE =====
  async clearCache() {
    try {
      const keys = await this.redis.keys('metrics:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info(`✅ Cache de métricas limpo: ${keys.length} chaves removidas`);
      }
      return true;
    } catch (error) {
      logger.error('❌ Erro ao limpar cache:', error);
      return false;
    }
  }

  // ===== ESTATÍSTICAS DO SERVIÇO =====
  async getServiceStats() {
    try {
      const stats = {
        isInitialized: this.isInitialized,
        cacheSize: await this.getCacheSize(),
        lastUpdate: new Date().toISOString(),
        endpoints: [
          'GET /metrics',
          'GET /stats/users',
          'GET /stats/financial',
          'GET /metrics/realtime',
          'GET /health'
        ]
      };

      return stats;
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas do serviço:', error);
      return {};
    }
  }

  async getCacheSize() {
    try {
      const keys = await this.redis.keys('metrics:*');
      return keys.length;
    } catch (error) {
      return 0;
    }
  }

  destroy() {
    this.isInitialized = false;
    logger.info('🗑️ Metrics Service destruído');
  }
}

module.exports = MetricsService;
