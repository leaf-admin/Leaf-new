/**
 * 🏥 Health Check Service
 * 
 * Serviço centralizado para health checks de todos os componentes
 */

const redisPool = require('../utils/redis-pool');
const Redis = require('ioredis');
const DockerDetector = require('../utils/docker-detector');
const firebaseConfig = require('../firebase-config');
const os = require('os');
const { logStructured, logError } = require('../utils/logger');

class HealthCheckService {
  constructor() {
    this.startTime = Date.now();
    this.redisHealthClient = null;
    this.redisHealthConfigKey = '';
    this.redisHealthInFlight = null;
    this.redisHealthCache = null;
    this.firebaseHealthInFlight = null;
    this.firebaseHealthCache = null;
  }

  getFirebaseHealthCacheTtlMs() {
    return Math.max(
      30 * 1000,
      Number.parseInt(process.env.HEALTH_FIREBASE_CACHE_TTL_MS || String(5 * 60 * 1000), 10)
    );
  }

  getFirebaseThresholds() {
    return {
      warningMs: Math.max(
        500,
        Number.parseInt(process.env.HEALTH_FIREBASE_WARNING_MS || '2500', 10)
      ),
      unhealthyMs: Math.max(
        1000,
        Number.parseInt(process.env.HEALTH_FIREBASE_UNHEALTHY_MS || '8000', 10)
      )
    };
  }

  getSystemThresholds() {
    const isProduction = process.env.NODE_ENV === 'production';
    const parsePercent = (value, fallback) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const thresholds = {
      memoryWarningPercent: parsePercent(
        process.env.HEALTH_SYSTEM_MEMORY_WARNING_PERCENT,
        isProduction ? 80 : 75
      ),
      memoryCriticalPercent: parsePercent(
        process.env.HEALTH_SYSTEM_MEMORY_CRITICAL_PERCENT,
        isProduction ? 92 : 90
      ),
      cpuWarningPercent: parsePercent(
        process.env.HEALTH_SYSTEM_CPU_WARNING_PERCENT,
        isProduction ? 120 : 75
      ),
      cpuCriticalPercent: parsePercent(
        process.env.HEALTH_SYSTEM_CPU_CRITICAL_PERCENT,
        isProduction ? 200 : 100
      ),
      cpuSustainedCriticalPercent: parsePercent(
        process.env.HEALTH_SYSTEM_CPU_SUSTAINED_CRITICAL_PERCENT,
        isProduction ? 140 : 90
      )
    };

    return {
      ...thresholds,
      memoryCriticalPercent: Math.max(
        thresholds.memoryCriticalPercent,
        thresholds.memoryWarningPercent
      ),
      cpuCriticalPercent: Math.max(
        thresholds.cpuCriticalPercent,
        thresholds.cpuWarningPercent
      ),
      cpuSustainedCriticalPercent: Math.max(
        thresholds.cpuSustainedCriticalPercent,
        thresholds.cpuWarningPercent
      )
    };
  }

  getRedisThresholds() {
    return {
      warningThresholdMs: Number.parseInt(
        process.env.HEALTH_REDIS_WARNING_MS ||
          (process.env.NODE_ENV === 'production' ? '300' : '1200'),
        10
      ),
      unhealthyThresholdMs: Number.parseInt(
        process.env.HEALTH_REDIS_UNHEALTHY_MS ||
          (process.env.NODE_ENV === 'production' ? '1500' : '4000'),
        10
      )
    };
  }

  getRedisSampleCount() {
    return Math.max(
      1,
      Number.parseInt(process.env.HEALTH_REDIS_PING_SAMPLES || '3', 10)
    );
  }

  getRedisHealthCacheTtlMs() {
    return Math.max(
      0,
      Number.parseInt(process.env.HEALTH_REDIS_CACHE_TTL_MS || '1500', 10)
    );
  }

  getSocketIoRedisAdapterStatus() {
    const status = global.socketIoRedisAdapterStatus || null;
    if (!status) {
      return {
        state: 'unknown',
        enabled: null,
        required: false,
        runtimeRole: String(process.env.RUNTIME_ROLE || 'gateway').trim().toLowerCase(),
        message: 'Status do Socket.IO Redis Adapter ainda não informado pelo runtime'
      };
    }

    return {
      state: status.state || 'unknown',
      enabled: status.enabled,
      required: Boolean(status.required),
      runtimeRole: status.runtimeRole || String(process.env.RUNTIME_ROLE || 'gateway').trim().toLowerCase(),
      updatedAt: status.updatedAt || null,
      error: status.error || null
    };
  }

  checkSocketIoRedisAdapterReadiness() {
    const adapter = this.getSocketIoRedisAdapterStatus();
    if (adapter.required && adapter.state !== 'ready') {
      return {
        status: 'unhealthy',
        ...adapter,
        message: 'Socket.IO Redis Adapter obrigatório não está pronto'
      };
    }

    if (adapter.enabled === true && !['ready', 'disabled'].includes(adapter.state)) {
      return {
        status: 'warning',
        ...adapter,
        message: `Socket.IO Redis Adapter em estado ${adapter.state}`
      };
    }

    return {
      status: 'healthy',
      ...adapter,
      message: adapter.state === 'ready'
        ? 'Socket.IO Redis Adapter pronto'
        : 'Socket.IO Redis Adapter não obrigatório'
    };
  }

  getCachedRedisHealth() {
    const cache = this.redisHealthCache;
    if (!cache) {
      return null;
    }

    const ttlMs = this.getRedisHealthCacheTtlMs();
    if (ttlMs <= 0) {
      return null;
    }

    if (Date.now() - cache.timestamp > ttlMs) {
      return null;
    }

    return cache.payload;
  }

  setCachedRedisHealth(payload) {
    this.redisHealthCache = {
      timestamp: Date.now(),
      payload
    };
  }

  getRedisHealthProbeTimeouts() {
    return {
      connectTimeout: Number.parseInt(process.env.HEALTH_REDIS_CONNECT_TIMEOUT_MS || '1500', 10),
      commandTimeout: Number.parseInt(process.env.HEALTH_REDIS_COMMAND_TIMEOUT_MS || '1500', 10)
    };
  }

  getRedisHealthConfig() {
    const baseConfig = DockerDetector.getRedisConfig();
    const { connectTimeout, commandTimeout } = this.getRedisHealthProbeTimeouts();

    return {
      ...baseConfig,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout,
      commandTimeout,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null
    };
  }

  getRedisHealthConfigKey(config) {
    const passwordMarker = config.password ? 'with-pass' : 'without-pass';
    if (Array.isArray(config.sentinels)) {
      const endpoints = config.sentinels.map(item => `${item.host}:${item.port}`).join(',');
      return `sentinel:${config.name}:${endpoints}:${config.db}:${passwordMarker}`;
    }
    return `${config.host}:${config.port}:${config.db}:${passwordMarker}`;
  }

  waitForClientReady(client, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('timeout aguardando Redis ready'));
      }, timeoutMs);

      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = error => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        client.off('ready', onReady);
        client.off('error', onError);
      };

      client.once('ready', onReady);
      client.once('error', onError);
    });
  }

  async getDedicatedRedisHealthClient() {
    const config = this.getRedisHealthConfig();
    const configKey = this.getRedisHealthConfigKey(config);

    const needsNewClient =
      !this.redisHealthClient ||
      this.redisHealthConfigKey !== configKey ||
      this.redisHealthClient.status === 'close' ||
      this.redisHealthClient.status === 'end';

    if (needsNewClient) {
      await this.resetRedisHealthClient();
      this.redisHealthClient = new Redis(config);
      this.redisHealthConfigKey = configKey;
      this.redisHealthClient.on('error', error => {
        if (this.redisHealthClient?.status === 'end' || this.redisHealthClient?.status === 'close') {
          return;
        }
        logError(error, 'Erro no Redis health probe client', {
          service: 'health-check-service',
          component: 'redis-health-probe'
        });
      });
    }

    if (this.redisHealthClient.status === 'wait') {
      await this.redisHealthClient.connect();
    } else if (this.redisHealthClient.status === 'connecting' || this.redisHealthClient.status === 'connect') {
      await this.waitForClientReady(this.redisHealthClient, this.getRedisHealthProbeTimeouts().connectTimeout + 800);
    }

    return this.redisHealthClient;
  }

  async resetRedisHealthClient() {
    if (!this.redisHealthClient) {
      return;
    }

    try {
      this.redisHealthClient.disconnect(false);
    } catch (_error) {
      // Sem impacto: cliente de health check é descartável
    } finally {
      this.redisHealthClient = null;
      this.redisHealthConfigKey = '';
    }
  }

  async collectRedisSamples(redis, sampleCount) {
    const samples = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const sampleStart = process.hrtime.bigint();
      await redis.ping();
      const elapsedMs = Number((process.hrtime.bigint() - sampleStart) / BigInt(1e6));
      samples.push(elapsedMs);
    }
    return samples;
  }

  buildRedisHealthPayload(samples, thresholds, source = 'dedicated') {
    const responseTime = Math.round(
      samples.reduce((acc, value) => acc + value, 0) / samples.length
    );
    const minLatency = Math.min(...samples);
    const maxLatency = Math.max(...samples);
    const status =
      responseTime >= thresholds.unhealthyThresholdMs
        ? 'unhealthy'
        : responseTime >= thresholds.warningThresholdMs
          ? 'warning'
          : 'healthy';

    return {
      status,
      source,
      responseTime: `${responseTime}ms`,
      latency: responseTime,
      minLatency,
      maxLatency,
      samples,
      thresholds: {
        warningMs: thresholds.warningThresholdMs,
        unhealthyMs: thresholds.unhealthyThresholdMs
      },
      message: status === 'warning'
        ? `Redis respondendo lentamente (${responseTime}ms)`
        : status === 'unhealthy'
          ? `Redis com latência crítica (${responseTime}ms)`
          : 'Redis está saudável'
    };
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

    // Em desenvolvimento, "critical" de sistema costuma refletir carga momentânea local
    // (build/test), não necessariamente indisponibilidade real.
    if (
      process.env.NODE_ENV !== 'production' &&
      checks.checks.system?.status === 'critical'
    ) {
      checks.checks.system.status = 'warning';
      checks.checks.system.message = `${checks.checks.system.message} (degradado para warning em desenvolvimento)`;
    }

    // Determinar status geral
    const allHealthy = Object.values(checks.checks).every(
      check => check.status === 'healthy' || check.status === 'warning'
    );
    const hasCritical = Object.values(checks.checks).some(
      check => check.status === 'unhealthy' || check.status === 'critical'
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
    const cached = this.getCachedRedisHealth();
    if (cached) {
      return cached;
    }

    if (!this.redisHealthInFlight) {
      this.redisHealthInFlight = (async () => {
        const thresholds = this.getRedisThresholds();
        const sampleCount = this.getRedisSampleCount();

        try {
          const redis = await this.getDedicatedRedisHealthClient();
          const samples = await this.collectRedisSamples(redis, sampleCount);
          return this.buildRedisHealthPayload(samples, thresholds, 'dedicated');
        } catch (dedicatedError) {
          await this.resetRedisHealthClient();
          logError(dedicatedError, 'Redis health check dedicado falhou, tentando fallback no pool compartilhado', {
            service: 'health-check-service',
            component: 'redis-health-probe'
          });

          try {
            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();
            const samples = await this.collectRedisSamples(redis, sampleCount);
            const fallbackPayload = this.buildRedisHealthPayload(samples, thresholds, 'shared-fallback');
            return {
              ...fallbackPayload,
              fallbackReason: dedicatedError.message
            };
          } catch (fallbackError) {
            logError(fallbackError, 'Redis health check falhou também no fallback compartilhado', {
              service: 'health-check-service',
              component: 'redis'
            });

            return {
              status: 'unhealthy',
              error: fallbackError.message,
              fallbackReason: dedicatedError.message,
              message: 'Redis não está respondendo'
            };
          }
        }
      })();
    }

    try {
      const payload = await this.redisHealthInFlight;
      this.setCachedRedisHealth(payload);
      return payload;
    } finally {
      this.redisHealthInFlight = null;
    }
  }

  /**
   * Health check do Firebase
   */
  async checkFirebase() {
    const now = Date.now();
    if (
      this.firebaseHealthCache &&
      now - this.firebaseHealthCache.checkedAt < this.getFirebaseHealthCacheTtlMs()
    ) {
      return {
        ...this.firebaseHealthCache.payload,
        cache: {
          status: 'HIT',
          ageMs: now - this.firebaseHealthCache.checkedAt,
          ttlMs: this.getFirebaseHealthCacheTtlMs()
        }
      };
    }

    if (this.firebaseHealthInFlight) {
      return this.firebaseHealthInFlight;
    }

    this.firebaseHealthInFlight = this.runFirebaseHealthCheck()
      .then((payload) => {
        this.firebaseHealthCache = { checkedAt: Date.now(), payload };
        return {
          ...payload,
          cache: {
            status: 'MISS',
            ageMs: 0,
            ttlMs: this.getFirebaseHealthCacheTtlMs()
          }
        };
      });
    try {
      return await this.firebaseHealthInFlight;
    } finally {
      this.firebaseHealthInFlight = null;
    }
  }

  waitForRealtimeConnection(realtimeDB, timeoutMs) {
    return new Promise((resolve, reject) => {
      const connectedRef = realtimeDB.ref('.info/connected');
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        connectedRef.off('value', onValue);
      };
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      };
      const onValue = (snapshot) => {
        if (snapshot?.val?.() === true) {
          finish();
        }
      };
      const onError = (error) => finish(error);
      const timeout = setTimeout(() => {
        const error = new Error(`timeout aguardando conexão RTDB (${timeoutMs}ms)`);
        error.code = 'FIREBASE_RTDB_HEALTH_TIMEOUT';
        finish(error);
      }, timeoutMs);
      timeout.unref?.();

      try {
        connectedRef.on('value', onValue, onError);
      } catch (error) {
        finish(error);
      }
    });
  }

  async checkFirebaseReadiness() {
    const thresholds = this.getFirebaseThresholds();
    try {
      const firestore = firebaseConfig.getFirestore();
      const realtimeDB = firebaseConfig.getRealtimeDB();
      const storage = firebaseConfig.getStorage();
      const components = {
        firestore: Boolean(firestore),
        realtimeDB: Boolean(realtimeDB),
        storage: Boolean(storage)
      };

      if (Object.values(components).some((ready) => ready !== true)) {
        return {
          status: 'unhealthy',
          components,
          message: 'Clientes Firebase obrigatórios não foram inicializados'
        };
      }

      const startTime = Date.now();
      await this.waitForRealtimeConnection(realtimeDB, thresholds.unhealthyMs);
      const responseTime = Date.now() - startTime;
      return {
        status: responseTime >= thresholds.unhealthyMs ? 'unhealthy' : 'healthy',
        components,
        realtimeConnected: true,
        responseTime: `${responseTime}ms`,
        thresholds,
        message: 'Clientes Firebase e conexão RTDB prontos'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        realtimeConnected: false,
        error: error.message,
        message: 'Firebase não está pronto para receber tráfego'
      };
    }
  }

  async runFirebaseHealthCheck() {
    try {
      const firestore = firebaseConfig.getFirestore();
      const realtimeDB = firebaseConfig.getRealtimeDB();
      const thresholds = this.getFirebaseThresholds();

      const results = {
        firestore: { status: 'unhealthy', message: 'Firestore não inicializado' },
        realtimeDB: { status: 'unhealthy', message: 'Realtime DB não inicializado' }
      };

      // Check Firestore
      if (firestore) {
        try {
          const startTime = Date.now();
          // Tentar ler uma collection de teste (sem criar dados)
          await firestore.collection('_health').limit(1).get();
          const responseTime = Date.now() - startTime;
          results.firestore = {
            status: responseTime >= thresholds.unhealthyMs
              ? 'unhealthy'
              : responseTime >= thresholds.warningMs
                ? 'warning'
                : 'healthy',
            responseTime: `${responseTime}ms`,
            thresholds,
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
          await this.waitForRealtimeConnection(realtimeDB, thresholds.unhealthyMs);
          const responseTime = Date.now() - startTime;
          results.realtimeDB = {
            status: responseTime >= thresholds.unhealthyMs
              ? 'unhealthy'
              : responseTime >= thresholds.warningMs
                ? 'warning'
                : 'healthy',
            responseTime: `${responseTime}ms`,
            thresholds,
            connected: true,
            message: 'Realtime DB está saudável'
          };
        } catch (error) {
          results.realtimeDB = {
            status: 'unhealthy',
            connected: false,
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
      const redisAdapter = this.getSocketIoRedisAdapterStatus();

      let status = 'healthy';
      if (usagePercent > 90) {
        status = 'critical';
      } else if (usagePercent > 75) {
        status = 'warning';
      }

      if (redisAdapter.required && redisAdapter.state !== 'ready') {
        status = 'unhealthy';
      } else if (
        redisAdapter.enabled === true &&
        !['ready', 'disabled'].includes(redisAdapter.state)
      ) {
        status = status === 'healthy' ? 'warning' : status;
      }

      let message = 'WebSocket está saudável';
      if (redisAdapter.required && redisAdapter.state !== 'ready') {
        message = 'Socket.IO Redis Adapter obrigatório não está pronto';
      } else if (redisAdapter.enabled === true && redisAdapter.state !== 'ready') {
        message = `Socket.IO Redis Adapter em estado ${redisAdapter.state}`;
      } else if (status !== 'healthy') {
        message = `WebSocket com alta utilização (${usagePercent.toFixed(1)}%)`;
      }

      return {
        status,
        connections,
        maxConnections,
        usagePercent: `${usagePercent.toFixed(1)}%`,
        redisAdapter,
        message
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
      const cpuUsagePercent5m = (loadAvg[1] / cpuCount) * 100;
      const cpuUsagePercent15m = (loadAvg[2] / cpuCount) * 100;
      const thresholds = this.getSystemThresholds();

      const memoryCritical =
        memoryUsagePercent >= thresholds.memoryCriticalPercent;
      const memoryWarning =
        memoryUsagePercent >= thresholds.memoryWarningPercent;
      const cpuCritical =
        cpuUsagePercent >= thresholds.cpuCriticalPercent &&
        cpuUsagePercent5m >= thresholds.cpuSustainedCriticalPercent;
      const cpuWarning =
        cpuUsagePercent >= thresholds.cpuWarningPercent ||
        cpuUsagePercent5m >= thresholds.cpuWarningPercent;

      let status = 'healthy';
      if (memoryCritical || cpuCritical) {
        status = 'critical';
      } else if (memoryWarning || cpuWarning) {
        status = 'warning';
      }

      return {
        status,
        thresholds,
        memory: {
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)}GB`,
          used: `${(usedMem / 1024 / 1024 / 1024).toFixed(2)}GB`,
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)}GB`,
          usagePercent: `${memoryUsagePercent.toFixed(1)}%`
        },
        cpu: {
          loadAvg: loadAvg.map(l => l.toFixed(2)),
          usagePercent: `${cpuUsagePercent.toFixed(1)}%`,
          usagePercent5m: `${cpuUsagePercent5m.toFixed(1)}%`,
          usagePercent15m: `${cpuUsagePercent15m.toFixed(1)}%`,
          cores: cpuCount
        },
        uptime: {
          system: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
          process: this.getUptime()
        },
        message: status === 'healthy'
          ? 'Sistema está saudável'
          : status === 'critical'
            ? `Sistema com pressão sustentada (CPU 1m: ${cpuUsagePercent.toFixed(1)}%, CPU 5m: ${cpuUsagePercent5m.toFixed(1)}%, RAM: ${memoryUsagePercent.toFixed(1)}%)`
            : `Sistema com pressão moderada (CPU 1m: ${cpuUsagePercent.toFixed(1)}%, CPU 5m: ${cpuUsagePercent5m.toFixed(1)}%, RAM: ${memoryUsagePercent.toFixed(1)}%)`
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
      const [redisCheck, firebaseCheck] = await Promise.all([
        this.checkRedis(),
        this.checkFirebaseReadiness()
      ]);
      const socketRedisAdapterCheck = this.checkSocketIoRedisAdapterReadiness();
      
      return {
        // warning ainda significa backend pronto para tráfego
        status: redisCheck.status === 'unhealthy'
          || firebaseCheck.status === 'unhealthy'
          || socketRedisAdapterCheck.status === 'unhealthy'
          ? 'unhealthy'
          : 'healthy',
        timestamp: new Date().toISOString(),
        checks: {
          redis: redisCheck,
          firebase: firebaseCheck,
          socketRedisAdapter: socketRedisAdapterCheck
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
