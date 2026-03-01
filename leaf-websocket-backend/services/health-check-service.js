/**
 * 🏥 Health Check Service
 * 
 * Serviço centralizado para health checks de todos os componentes
 */

const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const os = require('os');
const { logStructured, logError } = require('../utils/logger');

class HealthCheckService {
  constructor() {
    this.startTime = Date.now();
    this.redis = redisPool.getConnection();
  }

  /**
   * Executar todos os health checks
   * @param {Object} io - Instância do Socket.IO (opcional)
   */
  async runAllChecks(io = null) {
    const checks = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      uptime: this.getUptime(),
      checks: {}
    };

    // Redis Health Check
    checks.checks.redis = await this.checkRedis();

    // Firebase Health Check
    checks.checks.firebase = await this.checkFirebase();

    // WebSocket Health Check
    checks.checks.websocket = await this.checkWebSocket(io);

    // System Health Check
    checks.checks.system = this.checkSystem();

    // Determinar status geral
    const allHealthy = Object.values(checks.checks).every(
      check => check.status === 'healthy' || check.status === 'warning'
    );
    const hasCritical = Object.values(checks.checks).some(
      check => check.status === 'unhealthy'
    );

    if (hasCritical) {
      checks.status = 'unhealthy';
    } else if (!allHealthy) {
      checks.status = 'degraded';
    } else {
      const hasWarning = Object.values(checks.checks).some(
        check => check.status === 'warning'
      );
      checks.status = hasWarning ? 'warning' : 'healthy';
    }

    return checks;
  }

  /**
   * Health check do Redis
   */
  async checkRedis() {
    try {
      const startTime = Date.now();
      await this.redis.ping();
      const responseTime = Date.now() - startTime;

      // Verificar latência
      const status = responseTime > 100 ? 'warning' : 'healthy';

      return {
        status,
        responseTime: `${responseTime}ms`,
        latency: responseTime,
        message: status === 'warning' 
          ? `Redis respondendo lentamente (${responseTime}ms)`
          : 'Redis está saudável'
      };
    } catch (error) {
      logError(error, 'Redis health check falhou', {
        service: 'health-check-service',
        component: 'redis'
      });
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'Redis não está respondendo'
      };
    }
  }

  /**
   * Health check do Firebase
   */
  async checkFirebase() {
    try {
      const firestore = firebaseConfig.getFirestore();
      const realtimeDB = firebaseConfig.getRealtimeDB();

      const results = {
        firestore: { status: 'unavailable', message: 'Firestore não inicializado' },
        realtimeDB: { status: 'unavailable', message: 'Realtime DB não inicializado' }
      };

      // Check Firestore
      if (firestore) {
        try {
          const startTime = Date.now();
          // Tentar ler uma collection de teste (sem criar dados)
          await firestore.collection('_health').limit(1).get();
          const responseTime = Date.now() - startTime;
          results.firestore = {
            status: responseTime > 500 ? 'warning' : 'healthy',
            responseTime: `${responseTime}ms`,
            message: 'Firestore está saudável'
          };
        } catch (error) {
          results.firestore = {
            status: 'unhealthy',
            error: error.message,
            message: 'Firestore não está respondendo'
          };
        }
      }

      // Check Realtime DB
      if (realtimeDB) {
        try {
          const startTime = Date.now();
          await realtimeDB.ref('.info/connected').once('value');
          const responseTime = Date.now() - startTime;
          results.realtimeDB = {
            status: responseTime > 500 ? 'warning' : 'healthy',
            responseTime: `${responseTime}ms`,
            message: 'Realtime DB está saudável'
          };
        } catch (error) {
          results.realtimeDB = {
            status: 'unhealthy',
            error: error.message,
            message: 'Realtime DB não está respondendo'
          };
        }
      }

      // Status geral do Firebase
      const allHealthy = Object.values(results).every(r => r.status === 'healthy');
      const hasUnhealthy = Object.values(results).some(r => r.status === 'unhealthy');

      return {
        status: hasUnhealthy ? 'unhealthy' : (allHealthy ? 'healthy' : 'warning'),
        components: results,
        message: hasUnhealthy 
          ? 'Algum componente do Firebase não está saudável'
          : 'Firebase está saudável'
      };
    } catch (error) {
      logError(error, 'Firebase health check falhou', {
        service: 'health-check-service',
        component: 'firebase'
      });
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'Firebase não está disponível'
      };
    }
  }

  /**
   * Health check do WebSocket
   * @param {Object} io - Instância do Socket.IO (opcional)
   */
  async checkWebSocket(io = null) {
    try {
      // Tentar obter io de várias fontes
      if (!io) {
        io = global.io;
      }
      
      if (!io) {
        return {
          status: 'unavailable',
          message: 'WebSocket não inicializado'
        };
      }

      const connections = io.engine.clientsCount || 0;
      const maxConnections = parseInt(process.env.MAX_WEBSOCKET_CONNECTIONS || '10000', 10);
      const usagePercent = (connections / maxConnections) * 100;

      let status = 'healthy';
      if (usagePercent > 90) {
        status = 'critical';
      } else if (usagePercent > 75) {
        status = 'warning';
      }

      return {
        status,
        connections,
        maxConnections,
        usagePercent: `${usagePercent.toFixed(1)}%`,
        message: status === 'healthy' 
          ? 'WebSocket está saudável'
          : `WebSocket com alta utilização (${usagePercent.toFixed(1)}%)`
      };
    } catch (error) {
      logError(error, 'WebSocket health check falhou', {
        service: 'health-check-service',
        component: 'websocket'
      });
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'WebSocket não está disponível'
      };
    }
  }

  /**
   * Health check do Sistema
   */
  checkSystem() {
    try {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const usedMem = totalMem - freeMem;
      const memoryUsagePercent = (usedMem / totalMem) * 100;

      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;
      const cpuUsagePercent = (loadAvg[0] / cpuCount) * 100;

      let status = 'healthy';
      if (memoryUsagePercent > 90 || cpuUsagePercent > 90) {
        status = 'critical';
      } else if (memoryUsagePercent > 75 || cpuUsagePercent > 75) {
        status = 'warning';
      }

      return {
        status,
        memory: {
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)}GB`,
          used: `${(usedMem / 1024 / 1024 / 1024).toFixed(2)}GB`,
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)}GB`,
          usagePercent: `${memoryUsagePercent.toFixed(1)}%`
        },
        cpu: {
          loadAvg: loadAvg.map(l => l.toFixed(2)),
          usagePercent: `${cpuUsagePercent.toFixed(1)}%`,
          cores: cpuCount
        },
        uptime: {
          system: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
          process: this.getUptime()
        },
        message: status === 'healthy'
          ? 'Sistema está saudável'
          : `Sistema com alta utilização (CPU: ${cpuUsagePercent.toFixed(1)}%, RAM: ${memoryUsagePercent.toFixed(1)}%)`
      };
    } catch (error) {
      logError(error, 'System health check falhou', {
        service: 'health-check-service',
        component: 'system'
      });
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'Não foi possível verificar saúde do sistema'
      };
    }
  }

  /**
   * Obter uptime do processo
   */
  getUptime() {
    const uptimeMs = Date.now() - this.startTime;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  /**
   * Health check rápido (apenas críticos)
   */
  async quickCheck() {
    try {
      // Apenas Redis (mais crítico)
      const redisCheck = await this.checkRedis();
      
      return {
        status: redisCheck.status === 'healthy' ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: {
          redis: redisCheck
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

// Singleton
const healthCheckService = new HealthCheckService();

module.exports = healthCheckService;

