/**
 * StreamServiceFunctional - Serviço funcional de Redis Streams
 * 
 * Este serviço integra Redis Streams reais com consumers funcionais,
 * oferecendo uma interface completa para processamento assíncrono.
 * 
 * FUNCIONALIDADES:
 * - Redis Streams reais com conexão funcional
 * - Consumers para processamento assíncrono
 * - Fallback automático quando Redis falha
 * - Monitoramento e métricas em tempo real
 * - Integração com sistema existente
 */

const RedisStreamManager = require('./RedisStreamManager');
const DriverMatchingConsumer = require('../../consumers/DriverMatchingConsumer');
const StatusUpdateConsumer = require('../../consumers/StatusUpdateConsumer');
const NotificationConsumer = require('../../consumers/NotificationConsumer');
const FallbackService = require('./FallbackService');
const HealthMonitor = require('../../middleware/streams/HealthMonitor');
const CircuitBreaker = require('../../middleware/streams/CircuitBreaker');
const StateSynchronizer = require('../../middleware/streams/StateSynchronizer');
const streamConfig = require('../../config/streams/streamConfig');
const { logStructured, logError } = require('../../utils/logger');

class StreamServiceFunctional {
  constructor(options = {}) {
    this.name = 'StreamServiceFunctional';
    this.config = { ...streamConfig, ...options };
    this.isInitialized = false;
    this.isHealthy = true;
    
    // Serviços principais
    this.redisManager = null;
    this.fallbackService = null;
    this.healthMonitor = null;
    this.circuitBreaker = null;
    this.stateSynchronizer = null;
    
    // Consumers
    this.consumers = new Map();
    
    // Estado
    this.streams = new Map();
    this.isStreamsMode = true; // true = Redis Streams, false = Fallback
    
    // Métricas
    this.metrics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      fallbackOperations: 0,
      streamOperations: 0,
      averageLatency: 0,
      uptime: Date.now()
    };
  }

  /**
   * Inicializar o serviço
   */
  async initialize() {
    if (this.isInitialized) {
      logStructured('warn', 'Já está inicializado', { service: 'stream-service-functional' });
      return;
    }

    logStructured('info', 'Inicializando', { service: 'stream-service-functional' });
    
    try {
      // 1. Inicializar FallbackService
      this.fallbackService = new FallbackService();
      logStructured('info', 'FallbackService inicializado', { service: 'stream-service-functional' });
      
      // 2. Inicializar CircuitBreaker
      this.circuitBreaker = new CircuitBreaker({
        name: 'redis-streams-functional',
        failureThreshold: this.config.circuitBreaker.failureThreshold,
        timeout: this.config.circuitBreaker.timeout,
        resetTimeout: this.config.circuitBreaker.resetTimeout,
        successThreshold: this.config.circuitBreaker.successThreshold,
        fallbackFunction: this.fallbackService.processMatching.bind(this.fallbackService)
      });
      logStructured('info', 'CircuitBreaker inicializado', { service: 'stream-service-functional' });
      
      // 3. Inicializar RedisStreamManager
      this.redisManager = new RedisStreamManager({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db
      });
      
      // Tentar conectar ao Redis
      try {
        await this.redisManager.connect();
        this.isStreamsMode = true;
        logStructured('info', 'Redis conectado - Modo Streams ativo', { service: 'stream-service-functional' });
      } catch (redisError) {
        logStructured('warn', 'Redis não disponível - Modo Fallback ativo', { service: 'stream-service-functional' });
        this.isStreamsMode = false;
      }
      
      // 4. Inicializar HealthMonitor
      this.healthMonitor = new HealthMonitor({
        checkInterval: this.config.monitoring.healthCheckInterval,
        timeout: this.config.general.timeout,
        failureThreshold: this.config.circuitBreaker.failureThreshold,
        onHealthChange: this.handleHealthChange.bind(this),
        onFailure: this.handleHealthFailure.bind(this),
        onRecovery: this.handleHealthRecovery.bind(this)
      });
      
      // Registrar serviços para monitoramento
      this.healthMonitor.registerService(this.fallbackService);
      this.healthMonitor.registerService(this.circuitBreaker);
      if (this.redisManager) {
        this.healthMonitor.registerService(this.redisManager);
      }
      
      logStructured('info', 'HealthMonitor inicializado', { service: 'stream-service-functional' });
      
      // 5. Inicializar StateSynchronizer
      this.stateSynchronizer = new StateSynchronizer({
        syncInterval: this.config.synchronization.syncInterval,
        maxRetries: this.config.general.maxRetries,
        conflictResolution: this.config.synchronization.conflictResolution
      });
      
      // Injetar dependências no StateSynchronizer
      this.stateSynchronizer.setDependencies(this.redisManager, null); // firebaseConfig será null por enquanto
      logStructured('info', 'StateSynchronizer inicializado', { service: 'stream-service-functional' });
      
      // 6. Inicializar streams e consumers (se Redis disponível)
      if (this.isStreamsMode) {
        await this.initializeStreamsAndConsumers();
      }
      
      // 7. Iniciar serviços de monitoramento
      if (this.config.monitoring.enabled) {
        await this.healthMonitor.start();
        logStructured('info', 'Monitoramento iniciado', { service: 'stream-service-functional' });
      }
      
      // 8. Iniciar sincronização
      if (this.config.synchronization.enabled) {
        await this.stateSynchronizer.start();
        logStructured('info', 'Sincronização iniciada', { service: 'stream-service-functional' });
      }
      
      this.isInitialized = true;
      this.isHealthy = true;
      
      logStructured('info', 'Inicialização concluída com sucesso', { service: 'stream-service-functional', mode: this.isStreamsMode ? 'Redis Streams' : 'Fallback' });
      
    } catch (error) {
      logError(error, 'Erro na inicialização', { service: 'stream-service-functional' });
      this.isHealthy = false;
      throw error;
    }
  }

  /**
   * Inicializar streams e consumers
   */
  async initializeStreamsAndConsumers() {
    try {
      logStructured('info', 'Inicializando streams e consumers', { service: 'stream-service-functional' });
      
      // 1. Criar streams
      const streamNames = Object.keys(this.config.streams);
      for (const streamName of streamNames) {
        await this.redisManager.createStream(streamName, this.config.streams[streamName]);
        this.streams.set(streamName, {
          name: streamName,
          config: this.config.streams[streamName],
          exists: true
        });
      }
      
      logStructured('info', `${streamNames.length} streams criados`, { service: 'stream-service-functional', count: streamNames.length });
      
      // 2. Inicializar consumers
      await this.initializeConsumers();
      
      logStructured('info', 'Streams e consumers inicializados', { service: 'stream-service-functional' });
      
    } catch (error) {
      logError(error, 'Erro ao inicializar streams', { service: 'stream-service-functional' });
      throw error;
    }
  }

  /**
   * Inicializar consumers
   */
  async initializeConsumers() {
    try {
      // Driver Matching Consumer
      const driverMatchingConsumer = new DriverMatchingConsumer({
        batchSize: this.config.streams['driver:matching'].consumers['matching-consumer-1'].batchSize,
        blockTime: this.config.streams['driver:matching'].consumers['matching-consumer-1'].blockTime
      });
      
      await driverMatchingConsumer.start(this.redisManager);
      this.consumers.set('driver-matching', driverMatchingConsumer);
      
      // Status Update Consumer
      const statusUpdateConsumer = new StatusUpdateConsumer({
        batchSize: this.config.streams['ride:status'].consumers['status-consumer-1'].batchSize,
        blockTime: this.config.streams['ride:status'].consumers['status-consumer-1'].blockTime
      });
      
      await statusUpdateConsumer.start(this.redisManager);
      this.consumers.set('status-update', statusUpdateConsumer);
      
      // Notification Consumer
      const notificationConsumer = new NotificationConsumer({
        batchSize: this.config.streams['notifications:push'].consumers['push-consumer-1'].batchSize,
        blockTime: this.config.streams['notifications:push'].consumers['push-consumer-1'].blockTime
      });
      
      await notificationConsumer.start(this.redisManager);
      this.consumers.set('notification', notificationConsumer);
      
      logStructured('info', `${this.consumers.size} consumers iniciados`, { service: 'stream-service-functional', count: this.consumers.size });
      
    } catch (error) {
      logError(error, 'Erro ao inicializar consumers', { service: 'stream-service-functional' });
      throw error;
    }
  }

  /**
   * Enviar mensagem para stream
   */
  async sendMessage(streamName, data, options = {}) {
    const startTime = Date.now();
    this.metrics.totalOperations++;

    try {
      if (!this.isInitialized) {
        throw new Error('StreamServiceFunctional não foi inicializado');
      }

      // Verificar se deve usar fallback
      if (!this.isStreamsMode || !this.redisManager || !this.redisManager.isConnected) {
        return await this.executeFallback(streamName, data);
      }

      // Executar com circuit breaker
      const result = await this.circuitBreaker.execute(async () => {
        return await this.sendToStream(streamName, data, options);
      });

      const latency = Date.now() - startTime;
      this.updateMetrics(latency, true, 'stream');

      logStructured('info', `Mensagem enviada para ${streamName}`, { service: 'stream-service-functional', streamName, latency });
      
      return {
        success: true,
        streamName,
        messageId: result.messageId,
        latency,
        method: 'stream'
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateMetrics(latency, false, 'stream');

      logError(error, `Erro ao enviar mensagem para ${streamName}`, { service: 'stream-service-functional', streamName });

      // Tentar fallback se configurado
      if (this.config.fallback.enabled && this.fallbackService) {
        try {
          const fallbackResult = await this.executeFallback(streamName, data);
          return fallbackResult;
        } catch (fallbackError) {
          logError(fallbackError, 'Fallback também falhou', { service: 'stream-service-functional', streamName });
        }
      }

      return {
        success: false,
        streamName,
        error: error.message,
        latency,
        method: 'failed'
      };
    }
  }

  /**
   * Enviar para stream específico
   */
  async sendToStream(streamName, data, options = {}) {
    if (!this.streams.has(streamName)) {
      throw new Error(`Stream ${streamName} não encontrado`);
    }

    return await this.redisManager.sendMessage(streamName, data, options);
  }

  /**
   * Executar fallback
   */
  async executeFallback(streamName, data) {
    const startTime = Date.now();
    this.metrics.fallbackOperations++;

    try {
      logStructured('warn', `Executando fallback para ${streamName}`, { service: 'stream-service-functional', streamName });
      
      let result;
      
      switch (streamName) {
        case 'driver:matching':
          result = await this.fallbackService.processMatching(data.customerId, data.location);
          break;
        
        case 'ride:status':
          result = await this.fallbackService.processStatusUpdate(data.rideId, data.status);
          break;
        
        case 'notifications:push':
          result = await this.fallbackService.processPushNotification(data.userId, data.type, data.message, data.data);
          break;
        
        case 'analytics:events':
          result = await this.fallbackService.processAnalyticsEvent(data.event, data.userId, data.data);
          break;
        
        case 'driver:location':
          result = await this.fallbackService.processDriverLocationUpdate(data.driverId, data.location, data.status);
          break;
        
        default:
          throw new Error(`Fallback não implementado para stream ${streamName}`);
      }
      
      const latency = Date.now() - startTime;
      this.updateMetrics(latency, true, 'fallback');
      
      return {
        success: true,
        streamName,
        latency,
        method: 'fallback',
        fallbackResult: result
      };
      
    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateMetrics(latency, false, 'fallback');
      
      logError(error, 'Erro no fallback', { service: 'stream-service-functional', streamName });
      throw error;
    }
  }

  /**
   * Processar matching de motoristas
   */
  async processMatching(customerId, location) {
    return await this.sendMessage('driver:matching', {
      customerId,
      location,
      priority: 'high'
    });
  }

  /**
   * Processar atualização de status
   */
  async processStatusUpdate(rideId, status) {
    return await this.sendMessage('ride:status', {
      rideId,
      status,
      priority: 'high'
    });
  }

  /**
   * Enviar notificação push
   */
  async sendPushNotification(userId, type, message, data = {}) {
    return await this.sendMessage('notifications:push', {
      userId,
      type,
      message,
      data,
      priority: 'medium'
    });
  }

  /**
   * Registrar evento de analytics
   */
  async trackEvent(event, userId, data = {}) {
    return await this.sendMessage('analytics:events', {
      event,
      userId,
      data,
      priority: 'low'
    });
  }

  /**
   * Atualizar localização do motorista
   */
  async updateDriverLocation(driverId, location, status = 'available') {
    return await this.sendMessage('driver:location', {
      driverId,
      location,
      status,
      priority: 'medium'
    });
  }

  /**
   * Lidar com mudança de saúde
   */
  async handleHealthChange(isHealthy) {
    this.isHealthy = isHealthy;
    
    if (isHealthy) {
      logStructured('info', 'Sistema recuperado', { service: 'stream-service-functional' });
    } else {
      logStructured('warn', 'Sistema com problemas', { service: 'stream-service-functional' });
    }
  }

  /**
   * Lidar com falha de saúde
   */
  async handleHealthFailure() {
    logStructured('warn', 'Falha de saúde detectada - ativando fallbacks', { service: 'stream-service-functional' });
    
    // Ativar modo fallback
    this.isStreamsMode = false;
    
    // Parar consumers
    for (const [consumerName, consumer] of this.consumers) {
      try {
        await consumer.stop();
        logStructured('info', `Consumer ${consumerName} parado`, { service: 'stream-service-functional', consumerName });
      } catch (error) {
        logError(error, `Erro ao parar consumer ${consumerName}`, { service: 'stream-service-functional', consumerName });
      }
    }
  }

  /**
   * Lidar com recuperação de saúde
   */
  async handleHealthRecovery() {
    logStructured('info', 'Saúde recuperada - tentando reativar streams', { service: 'stream-service-functional' });
    
    try {
      // Tentar reconectar ao Redis
      if (this.redisManager && !this.redisManager.isConnected) {
        await this.redisManager.connect();
        this.isStreamsMode = true;
        
        // Reinicializar streams e consumers
        await this.initializeStreamsAndConsumers();
        
        logStructured('info', 'Streams reativados com sucesso', { service: 'stream-service-functional' });
      }
    } catch (error) {
      logError(error, 'Erro ao reativar streams', { service: 'stream-service-functional' });
      this.isStreamsMode = false;
    }
  }

  /**
   * Atualizar métricas
   */
  updateMetrics(latency, success, method) {
    if (success) {
      this.metrics.successfulOperations++;
      this.metrics.averageLatency = 
        (this.metrics.averageLatency * (this.metrics.successfulOperations - 1) + latency) / 
        this.metrics.successfulOperations;
      
      if (method === 'stream') {
        this.metrics.streamOperations++;
      }
    } else {
      this.metrics.failedOperations++;
    }
  }

  /**
   * Obter métricas
   */
  getMetrics() {
    const successRate = this.metrics.totalOperations > 0 ? 
      (this.metrics.successfulOperations / this.metrics.totalOperations) * 100 : 0;
    
    const fallbackRate = this.metrics.totalOperations > 0 ? 
      (this.metrics.fallbackOperations / this.metrics.totalOperations) * 100 : 0;

    const streamRate = this.metrics.totalOperations > 0 ? 
      (this.metrics.streamOperations / this.metrics.totalOperations) * 100 : 0;

    return {
      ...this.metrics,
      successRate,
      fallbackRate,
      streamRate,
      isHealthy: this.isHealthy,
      isInitialized: this.isInitialized,
      isStreamsMode: this.isStreamsMode,
      uptime: Date.now() - this.metrics.uptime,
      streams: Array.from(this.streams.keys()),
      consumers: Array.from(this.consumers.keys())
    };
  }

  /**
   * Obter status de saúde
   */
  getHealthStatus() {
    return {
      service: this.name,
      status: this.isHealthy ? 'healthy' : 'unhealthy',
      mode: this.isStreamsMode ? 'streams' : 'fallback',
      isInitialized: this.isInitialized,
      metrics: this.getMetrics(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Obter informações dos streams
   */
  async getStreamsInfo() {
    if (!this.isStreamsMode || !this.redisManager) {
      return { error: 'Redis não disponível' };
    }

    try {
      return await this.redisManager.getAllStreamsInfo();
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Obter métricas dos consumers
   */
  getConsumersMetrics() {
    const consumersMetrics = {};
    
    for (const [consumerName, consumer] of this.consumers) {
      consumersMetrics[consumerName] = consumer.getMetrics();
    }
    
    return consumersMetrics;
  }

  /**
   * Parar serviço
   */
  async stop() {
    logStructured('info', 'Parando serviço', { service: 'stream-service-functional' });
    
    // Parar consumers
    for (const [consumerName, consumer] of this.consumers) {
      try {
        await consumer.stop();
        logStructured('info', `Consumer ${consumerName} parado`, { service: 'stream-service-functional', consumerName });
      } catch (error) {
        logError(error, `Erro ao parar consumer ${consumerName}`, { service: 'stream-service-functional', consumerName });
      }
    }
    
    // Parar monitoramento
    if (this.healthMonitor) {
      await this.healthMonitor.stop();
    }
    
    // Parar sincronização
    if (this.stateSynchronizer) {
      await this.stateSynchronizer.stop();
    }
    
    // Desconectar Redis
    if (this.redisManager) {
      await this.redisManager.disconnect();
    }
    
    this.isInitialized = false;
    this.isHealthy = false;
    
    logStructured('info', 'Serviço parado', { service: 'stream-service-functional' });
  }
}

module.exports = StreamServiceFunctional;
