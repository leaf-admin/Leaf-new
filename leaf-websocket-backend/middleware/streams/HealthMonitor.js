/**
 * HealthMonitor - Monitor de saúde do Redis e serviços de stream
 * 
 * Este serviço monitora continuamente a saúde do Redis e dos serviços
 * relacionados a streams, detectando falhas e ativando fallbacks quando necessário.
 * 
 * FUNCIONALIDADES:
 * - Monitoramento contínuo do Redis
 * - Detecção de falhas em tempo real
 * - Ativação automática de fallbacks
 * - Métricas de saúde e performance
 * - Alertas para problemas críticos
 */

// const redisPool = require('../redis-pool');

class HealthMonitor {
  constructor(options = {}) {
    this.name = 'HealthMonitor';
    this.isRunning = false;
    this.checkInterval = options.checkInterval || 10000; // 10 segundos (menos sensível)
    this.timeout = options.timeout || 5000; // 5 segundos (mais tolerante)
    this.failureThreshold = options.failureThreshold || 5; // 5 falhas consecutivas (menos sensível)
    
    // Estado atual
    this.isHealthy = true;
    this.consecutiveFailures = 0;
    this.lastCheck = null;
    this.lastFailure = null;
    
    // Métricas
    this.metrics = {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      averageResponseTime: 0,
      uptime: Date.now(),
      lastHealthChange: Date.now()
    };
    
    // Callbacks para eventos
    this.onHealthChange = options.onHealthChange || (() => {});
    this.onFailure = options.onFailure || (() => {});
    this.onRecovery = options.onRecovery || (() => {});
    
    // Serviços monitorados
    this.monitoredServices = new Map();
  }

  /**
   * Iniciar monitoramento
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ [HealthMonitor] Já está rodando');
      return;
    }

    console.log('🚀 [HealthMonitor] Iniciando monitoramento...');
    this.isRunning = true;
    this.metrics.uptime = Date.now();
    
    // Iniciar loop de monitoramento
    this.monitoringLoop();
    
    console.log('✅ [HealthMonitor] Monitoramento iniciado');
  }

  /**
   * Parar monitoramento
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ [HealthMonitor] Não está rodando');
      return;
    }

    console.log('🛑 [HealthMonitor] Parando monitoramento...');
    this.isRunning = false;
    
    console.log('✅ [HealthMonitor] Monitoramento parado');
  }

  /**
   * Loop principal de monitoramento
   */
  async monitoringLoop() {
    while (this.isRunning) {
      try {
        await this.performHealthCheck();
        await this.sleep(this.checkInterval);
      } catch (error) {
        console.error('❌ [HealthMonitor] Erro no loop de monitoramento:', error);
        await this.sleep(this.checkInterval);
      }
    }
  }

  /**
   * Realizar verificação de saúde
   */
  async performHealthCheck() {
    const startTime = Date.now();
    this.metrics.totalChecks++;
    this.lastCheck = new Date();

    try {
      // 1. Verificar conectividade básica do Redis
      const redisHealth = await this.checkRedisConnectivity();
      
      // 2. Verificar performance do Redis
      const redisPerformance = await this.checkRedisPerformance();
      
      // 3. Verificar streams específicos
      const streamsHealth = await this.checkStreamsHealth();
      
      // 4. Verificar serviços monitorados
      const servicesHealth = await this.checkMonitoredServices();
      
      // Calcular saúde geral
      const overallHealth = this.calculateOverallHealth({
        redis: redisHealth,
        performance: redisPerformance,
        streams: streamsHealth,
        services: servicesHealth
      });

      const responseTime = Date.now() - startTime;
      this.updateMetrics(responseTime, true);

      // Verificar mudança de estado (só mudar se realmente necessário)
      if (overallHealth.isHealthy !== this.isHealthy) {
        // Só mudar estado se tiver certeza (threshold mais alto)
        if (this.consecutiveFailures >= this.failureThreshold || overallHealth.isHealthy) {
          await this.handleHealthChange(overallHealth.isHealthy);
          this.isHealthy = overallHealth.isHealthy;
        }
      }

      // Reset contador de falhas apenas se realmente saudável
      if (overallHealth.isHealthy) {
        this.consecutiveFailures = 0;
      }

      console.log(`✅ [HealthMonitor] Saúde verificada: ${overallHealth.isHealthy ? 'SAUDÁVEL' : 'PROBLEMAS'} (${responseTime}ms)`);

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateMetrics(responseTime, false);
      this.consecutiveFailures++;
      this.lastFailure = new Date();

      console.error(`❌ [HealthMonitor] Falha na verificação:`, error);

      // Se excedeu o threshold de falhas, marcar como não saudável
      if (this.consecutiveFailures >= this.failureThreshold && this.isHealthy) {
        await this.handleHealthChange(false);
      }
    }
  }

  /**
   * Verificar conectividade do Redis
   */
  async checkRedisConnectivity() {
    try {
      const startTime = Date.now();
      
      // Teste básico de ping
      const pingResult = await redisPool.pool.ping();
      
      const responseTime = Date.now() - startTime;
      
      return {
        isHealthy: pingResult === 'PONG',
        responseTime,
        details: {
          ping: pingResult,
          connection: 'active'
        }
      };
    } catch (error) {
      return {
        isHealthy: false,
        responseTime: 0,
        details: {
          error: error.message,
          connection: 'failed'
        }
      };
    }
  }

  /**
   * Verificar performance do Redis
   */
  async checkRedisPerformance() {
    try {
      const startTime = Date.now();
      
      // Teste de escrita
      const testKey = `health_check_${Date.now()}`;
      const testValue = 'health_check_value';
      
      await redisPool.pool.set(testKey, testValue, 'EX', 10); // Expira em 10 segundos
      
      // Teste de leitura
      const retrievedValue = await redisPool.pool.get(testKey);
      
      // Teste de stream (se suportado)
      let streamTest = false;
      try {
        await redisPool.pool.xAdd('health_check_stream', '*', { test: 'value' });
        streamTest = true;
      } catch (streamError) {
        console.warn('⚠️ [HealthMonitor] Streams não suportados:', streamError.message);
      }
      
      const responseTime = Date.now() - startTime;
      
      return {
        isHealthy: retrievedValue === testValue,
        responseTime,
        details: {
          writeTest: true,
          readTest: retrievedValue === testValue,
          streamTest,
          latency: responseTime
        }
      };
    } catch (error) {
      return {
        isHealthy: false,
        responseTime: 0,
        details: {
          error: error.message,
          writeTest: false,
          readTest: false,
          streamTest: false
        }
      };
    }
  }

  /**
   * Verificar saúde dos streams
   */
  async checkStreamsHealth() {
    try {
      const streams = [
        'driver:matching',
        'ride:status',
        'notifications:push',
        'analytics:events'
      ];

      const streamHealth = {};

      for (const stream of streams) {
        try {
          // Verificar se o stream existe e obter informações
          const info = await redisPool.pool.xInfo('STREAM', stream);
          
          streamHealth[stream] = {
            exists: true,
            length: info.length || 0,
            consumers: info.consumers || 0,
            isHealthy: true
          };
        } catch (error) {
          // Stream não existe ou erro
          streamHealth[stream] = {
            exists: false,
            length: 0,
            consumers: 0,
            isHealthy: false,
            error: error.message
          };
        }
      }

      const healthyStreams = Object.values(streamHealth).filter(s => s.isHealthy).length;
      const totalStreams = streams.length;

      return {
        isHealthy: healthyStreams > 0, // Pelo menos um stream deve estar saudável
        responseTime: 0,
        details: {
          totalStreams,
          healthyStreams,
          streams: streamHealth
        }
      };
    } catch (error) {
      return {
        isHealthy: false,
        responseTime: 0,
        details: {
          error: error.message,
          totalStreams: 0,
          healthyStreams: 0
        }
      };
    }
  }

  /**
   * Verificar serviços monitorados
   */
  async checkMonitoredServices() {
    const services = Array.from(this.monitoredServices.values());
    const healthyServices = services.filter(s => s.isHealthy).length;
    const totalServices = services.length;

    return {
      isHealthy: totalServices === 0 || healthyServices > 0,
      responseTime: 0,
      details: {
        totalServices,
        healthyServices,
        services: services.map(s => ({
          name: s.name,
          isHealthy: s.isHealthy,
          lastCheck: s.lastCheck
        }))
      }
    };
  }

  /**
   * Calcular saúde geral baseada em todos os componentes
   */
  calculateOverallHealth(components) {
    const weights = {
      redis: 0.3,        // 30% - Redis é importante mas não crítico
      performance: 0.2,   // 20% - Performance é menos crítica
      streams: 0.3,      // 30% - Streams são importantes
      services: 0.2      // 20% - Serviços são importantes
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const [component, health] of Object.entries(components)) {
      const weight = weights[component] || 0;
      const score = health.isHealthy ? 1 : 0;
      
      totalScore += score * weight;
      totalWeight += weight;
    }

    const overallScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const isHealthy = overallScore >= 0.5; // 50% de threshold (menos rigoroso)

    return {
      isHealthy,
      score: overallScore,
      components,
      details: {
        threshold: 0.5,
        score: overallScore,
        weighted: true
      }
    };
  }

  /**
   * Lidar com mudança de estado de saúde
   */
  async handleHealthChange(isHealthy) {
    const previousState = this.isHealthy;
    this.isHealthy = isHealthy;
    this.metrics.lastHealthChange = Date.now();

    if (isHealthy && !previousState) {
      // Recuperação
      console.log('🟢 [HealthMonitor] Sistema recuperado!');
      await this.onRecovery();
    } else if (!isHealthy && previousState) {
      // Falha
      console.log('🔴 [HealthMonitor] Sistema com problemas!');
      await this.onFailure();
    }

    // Notificar mudança
    await this.onHealthChange(isHealthy);
  }

  /**
   * Registrar serviço para monitoramento
   */
  registerService(service) {
    this.monitoredServices.set(service.name, {
      name: service.name,
      service: service,
      isHealthy: true,
      lastCheck: new Date()
    });
    
    console.log(`📝 [HealthMonitor] Serviço ${service.name} registrado para monitoramento`);
  }

  /**
   * Atualizar métricas
   */
  updateMetrics(responseTime, success) {
    if (success) {
      this.metrics.successfulChecks++;
      this.metrics.averageResponseTime = 
        (this.metrics.averageResponseTime * (this.metrics.successfulChecks - 1) + responseTime) / 
        this.metrics.successfulChecks;
    } else {
      this.metrics.failedChecks++;
    }
  }

  /**
   * Obter métricas do monitor
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.uptime;
    const successRate = this.metrics.totalChecks > 0 ? 
      (this.metrics.successfulChecks / this.metrics.totalChecks) * 100 : 0;

    return {
      ...this.metrics,
      uptime,
      successRate,
      consecutiveFailures: this.consecutiveFailures,
      isHealthy: this.isHealthy,
      lastCheck: this.lastCheck,
      lastFailure: this.lastFailure
    };
  }

  /**
   * Obter status de saúde completo
   */
  getHealthStatus() {
    return {
      service: this.name,
      status: this.isHealthy ? 'healthy' : 'unhealthy',
      isRunning: this.isRunning,
      metrics: this.getMetrics(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = HealthMonitor;
