/**
 * DriverMatchingConsumer - Consumer para processamento de matching de motoristas
 * 
 * Este consumer processa mensagens do stream 'driver:matching' de forma assíncrona,
 * encontrando motoristas próximos e enviando notificações.
 * 
 * FUNCIONALIDADES:
 * - Processamento assíncrono de requests de matching
 * - Busca de motoristas próximos
 * - Cálculo de distâncias e tempos
 * - Envio de notificações para motoristas
 * - Confirmação de processamento
 */

const RedisStreamManager = require('../services/streams/RedisStreamManager');

class DriverMatchingConsumer {
  constructor(options = {}) {
    this.name = 'DriverMatchingConsumer';
    this.streamName = 'driver:matching';
    this.groupName = 'matching-group';
    this.consumerName = `matching-consumer-${Date.now()}`;
    
    this.config = {
      batchSize: options.batchSize || 5,
      blockTime: options.blockTime || 1000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };
    
    this.redisManager = null;
    this.isRunning = false;
    this.processedMessages = 0;
    this.failedMessages = 0;
    
    // Métricas
    this.metrics = {
      totalProcessed: 0,
      successfulProcessed: 0,
      failedProcessed: 0,
      averageProcessingTime: 0,
      uptime: Date.now()
    };
  }

  /**
   * Iniciar consumer
   */
  async start(redisManager) {
    if (this.isRunning) {
      console.log('⚠️ [DriverMatchingConsumer] Já está rodando');
      return;
    }

    this.redisManager = redisManager;
    this.isRunning = true;
    this.metrics.uptime = Date.now();

    try {
      console.log(`🚀 [DriverMatchingConsumer] Iniciando consumer ${this.consumerName}...`);
      
      // Criar consumer group
      await this.redisManager.createConsumerGroup(
        this.streamName, 
        this.groupName, 
        { startId: '0', mkstream: true }
      );
      
      console.log(`✅ [DriverMatchingConsumer] Consumer group criado`);
      
      // Iniciar loop de processamento
      this.processingLoop();
      
      console.log(`🎉 [DriverMatchingConsumer] Consumer iniciado com sucesso!`);
      
    } catch (error) {
      console.error('❌ [DriverMatchingConsumer] Erro ao iniciar:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Parar consumer
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ [DriverMatchingConsumer] Não está rodando');
      return;
    }

    console.log('🛑 [DriverMatchingConsumer] Parando consumer...');
    this.isRunning = false;
    
    console.log('✅ [DriverMatchingConsumer] Consumer parado');
  }

  /**
   * Loop principal de processamento
   */
  async processingLoop() {
    while (this.isRunning) {
      try {
        await this.processMessages();
        await this.sleep(100); // Pequena pausa entre ciclos
      } catch (error) {
        console.error('❌ [DriverMatchingConsumer] Erro no loop de processamento:', error);
        await this.sleep(this.config.retryDelay);
      }
    }
  }

  /**
   * Processar mensagens do stream
   */
  async processMessages() {
    try {
      // Ler mensagens do consumer group
      const messages = await this.redisManager.readGroupMessages(
        this.streamName,
        this.groupName,
        this.consumerName,
        {
          count: this.config.batchSize,
          block: this.config.blockTime,
          noack: false
        }
      );

      if (messages.length === 0) {
        return; // Nenhuma mensagem para processar
      }

      console.log(`📨 [DriverMatchingConsumer] Processando ${messages.length} mensagens...`);

      // Processar cada mensagem
      for (const message of messages) {
        await this.processMessage(message);
      }

    } catch (error) {
      console.error('❌ [DriverMatchingConsumer] Erro ao processar mensagens:', error);
    }
  }

  /**
   * Processar mensagem individual
   */
  async processMessage(message) {
    const startTime = Date.now();
    this.metrics.totalProcessed++;

    try {
      console.log(`🔄 [DriverMatchingConsumer] Processando mensagem ${message.id}...`);
      
      // Extrair dados da mensagem
      const { customerId, location, priority } = message.fields;
      
      if (!customerId || !location) {
        throw new Error('Dados inválidos na mensagem');
      }

      // Processar matching
      const result = await this.processMatching(customerId, location, priority);
      
      // Confirmar processamento
      await this.redisManager.ackMessage(this.streamName, this.groupName, message.id);
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      
      console.log(`✅ [DriverMatchingConsumer] Mensagem ${message.id} processada com sucesso (${processingTime}ms)`);
      
      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      
      console.error(`❌ [DriverMatchingConsumer] Erro ao processar mensagem ${message.id}:`, error);
      
      // Em caso de erro, ainda confirmar para evitar reprocessamento infinito
      try {
        await this.redisManager.ackMessage(this.streamName, this.groupName, message.id);
      } catch (ackError) {
        console.error('❌ [DriverMatchingConsumer] Erro ao confirmar mensagem:', ackError);
      }
      
      throw error;
    }
  }

  /**
   * Processar matching de motoristas
   */
  async processMatching(customerId, location, priority = 'normal') {
    try {
      console.log(`🔍 [DriverMatchingConsumer] Buscando motoristas para cliente ${customerId}...`);
      
      // 1. Buscar motoristas próximos
      const nearbyDrivers = await this.findNearbyDrivers(location);
      console.log(`📍 [DriverMatchingConsumer] Encontrados ${nearbyDrivers.length} motoristas próximos`);
      
      // 2. Calcular distâncias e tempos
      const driversWithDistances = await this.calculateDistances(location, nearbyDrivers);
      console.log(`📏 [DriverMatchingConsumer] Distâncias calculadas para ${driversWithDistances.length} motoristas`);
      
      // 3. Enviar notificações para motoristas
      const notifications = await this.notifyDrivers(driversWithDistances, customerId, location);
      console.log(`📱 [DriverMatchingConsumer] Notificações enviadas para ${notifications.length} motoristas`);
      
      // 4. Aguardar resposta (simulação)
      const response = await this.waitForDriverResponse(customerId, driversWithDistances);
      console.log(`✅ [DriverMatchingConsumer] Resposta recebida: ${response.status}`);
      
      return {
        success: true,
        customerId,
        location,
        driverId: response.driverId,
        driverName: response.driverName,
        status: response.status,
        estimatedTime: response.estimatedTime,
        driversNotified: notifications.length,
        priority
      };
      
    } catch (error) {
      console.error('❌ [DriverMatchingConsumer] Erro no matching:', error);
      throw error;
    }
  }

  /**
   * Buscar motoristas próximos
   */
  async findNearbyDrivers(location) {
    try {
      // Simular busca de motoristas próximos
      const drivers = [
        { 
          id: 'driver1', 
          name: 'João Silva', 
          rating: 4.8, 
          distance: 0.5,
          location: {
            lat: location.lat + 0.001,
            lng: location.lng + 0.001
          }
        },
        { 
          id: 'driver2', 
          name: 'Maria Santos', 
          rating: 4.9, 
          distance: 0.8,
          location: {
            lat: location.lat - 0.001,
            lng: location.lng + 0.002
          }
        },
        { 
          id: 'driver3', 
          name: 'Pedro Costa', 
          rating: 4.7, 
          distance: 1.2,
          location: {
            lat: location.lat + 0.002,
            lng: location.lng - 0.001
          }
        }
      ];
      
      // Simular latência de rede
      await this.simulateLatency(50, 150);
      
      return drivers;
    } catch (error) {
      console.error('❌ [DriverMatchingConsumer] Erro ao buscar motoristas:', error);
      return [];
    }
  }

  /**
   * Calcular distâncias
   */
  async calculateDistances(customerLocation, drivers) {
    try {
      const driversWithDistances = drivers.map(driver => ({
        ...driver,
        estimatedTime: Math.floor(Math.random() * 10) + 5, // 5-15 minutos
        route: `Rota para ${driver.name}`,
        distance: Math.sqrt(
          Math.pow(driver.location.lat - customerLocation.lat, 2) +
          Math.pow(driver.location.lng - customerLocation.lng, 2)
        ) * 111 // Aproximação para km
      }));
      
      // Simular latência de processamento
      await this.simulateLatency(30, 100);
      
      return driversWithDistances;
    } catch (error) {
      console.error('❌ [DriverMatchingConsumer] Erro ao calcular distâncias:', error);
      return [];
    }
  }

  /**
   * Notificar motoristas
   */
  async notifyDrivers(drivers, customerId, location) {
    try {
      const notifications = [];
      
      for (const driver of drivers) {
        // Simular envio de notificação
        const notification = {
          driverId: driver.id,
          customerId,
          location,
          timestamp: Date.now(),
          status: 'sent',
          message: `Nova corrida disponível próximo a você!`
        };
        
        notifications.push(notification);
        
        // Simular latência de envio
        await this.simulateLatency(20, 80);
      }
      
      // Simular latência total
      await this.simulateLatency(100, 300);
      
      return notifications;
    } catch (error) {
      console.error('❌ [DriverMatchingConsumer] Erro ao notificar motoristas:', error);
      return [];
    }
  }

  /**
   * Aguardar resposta do motorista
   */
  async waitForDriverResponse(customerId, drivers) {
    try {
      // Simular tempo de espera por resposta (muito mais rápido que fallback)
      const waitTime = Math.floor(Math.random() * 3000) + 1000; // 1-4 segundos
      await this.simulateLatency(waitTime, waitTime);
      
      // Simular resposta positiva
      const respondingDriver = drivers[Math.floor(Math.random() * drivers.length)];
      
      return {
        status: 'accepted',
        driverId: respondingDriver.id,
        driverName: respondingDriver.name,
        estimatedTime: respondingDriver.estimatedTime
      };
    } catch (error) {
      console.error('❌ [DriverMatchingConsumer] Erro ao aguardar resposta:', error);
      return {
        status: 'timeout',
        driverId: null,
        error: 'Timeout aguardando resposta'
      };
    }
  }

  /**
   * Simular latência
   */
  async simulateLatency(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Atualizar métricas
   */
  updateMetrics(processingTime, success) {
    if (success) {
      this.metrics.successfulProcessed++;
      this.metrics.averageProcessingTime = 
        (this.metrics.averageProcessingTime * (this.metrics.successfulProcessed - 1) + processingTime) / 
        this.metrics.successfulProcessed;
    } else {
      this.metrics.failedProcessed++;
    }
  }

  /**
   * Obter métricas
   */
  getMetrics() {
    const successRate = this.metrics.totalProcessed > 0 ? 
      (this.metrics.successfulProcessed / this.metrics.totalProcessed) * 100 : 0;

    return {
      ...this.metrics,
      successRate,
      isRunning: this.isRunning,
      consumerName: this.consumerName,
      streamName: this.streamName,
      groupName: this.groupName,
      uptime: Date.now() - this.metrics.uptime
    };
  }

  /**
   * Obter status de saúde
   */
  getHealthStatus() {
    return {
      service: this.name,
      status: this.isRunning ? 'healthy' : 'stopped',
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

module.exports = DriverMatchingConsumer;
