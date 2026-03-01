/**
 * StatusUpdateConsumer - Consumer para atualizações de status de corridas
 * 
 * Este consumer processa mensagens do stream 'ride:status' de forma assíncrona,
 * atualizando status de corridas e enviando notificações.
 * 
 * FUNCIONALIDADES:
 * - Processamento assíncrono de atualizações de status
 * - Notificação de clientes e motoristas
 * - Atualização de analytics
 * - Envio de push notifications
 * - Confirmação de processamento
 */

const RedisStreamManager = require('../services/streams/RedisStreamManager');

class StatusUpdateConsumer {
  constructor(options = {}) {
    this.name = 'StatusUpdateConsumer';
    this.streamName = 'ride:status';
    this.groupName = 'status-group';
    this.consumerName = `status-consumer-${Date.now()}`;
    
    this.config = {
      batchSize: options.batchSize || 3,
      blockTime: options.blockTime || 500,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };
    
    this.redisManager = null;
    this.isRunning = false;
    
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
      console.log('⚠️ [StatusUpdateConsumer] Já está rodando');
      return;
    }

    this.redisManager = redisManager;
    this.isRunning = true;
    this.metrics.uptime = Date.now();

    try {
      console.log(`🚀 [StatusUpdateConsumer] Iniciando consumer ${this.consumerName}...`);
      
      // Criar consumer group
      await this.redisManager.createConsumerGroup(
        this.streamName, 
        this.groupName, 
        { startId: '0', mkstream: true }
      );
      
      console.log(`✅ [StatusUpdateConsumer] Consumer group criado`);
      
      // Iniciar loop de processamento
      this.processingLoop();
      
      console.log(`🎉 [StatusUpdateConsumer] Consumer iniciado com sucesso!`);
      
    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro ao iniciar:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Parar consumer
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ [StatusUpdateConsumer] Não está rodando');
      return;
    }

    console.log('🛑 [StatusUpdateConsumer] Parando consumer...');
    this.isRunning = false;
    
    console.log('✅ [StatusUpdateConsumer] Consumer parado');
  }

  /**
   * Loop principal de processamento
   */
  async processingLoop() {
    while (this.isRunning) {
      try {
        await this.processMessages();
        await this.sleep(50); // Pausa menor para status updates
      } catch (error) {
        console.error('❌ [StatusUpdateConsumer] Erro no loop de processamento:', error);
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

      console.log(`📨 [StatusUpdateConsumer] Processando ${messages.length} mensagens...`);

      // Processar cada mensagem
      for (const message of messages) {
        await this.processMessage(message);
      }

    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro ao processar mensagens:', error);
    }
  }

  /**
   * Processar mensagem individual
   */
  async processMessage(message) {
    const startTime = Date.now();
    this.metrics.totalProcessed++;

    try {
      console.log(`🔄 [StatusUpdateConsumer] Processando mensagem ${message.id}...`);
      
      // Extrair dados da mensagem
      const { rideId, status, driverId, customerId } = message.fields;
      
      if (!rideId || !status) {
        throw new Error('Dados inválidos na mensagem');
      }

      // Processar atualização de status
      const result = await this.processStatusUpdate(rideId, status, driverId, customerId);
      
      // Confirmar processamento
      await this.redisManager.ackMessage(this.streamName, this.groupName, message.id);
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      
      console.log(`✅ [StatusUpdateConsumer] Mensagem ${message.id} processada com sucesso (${processingTime}ms)`);
      
      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      
      console.error(`❌ [StatusUpdateConsumer] Erro ao processar mensagem ${message.id}:`, error);
      
      // Em caso de erro, ainda confirmar para evitar reprocessamento infinito
      try {
        await this.redisManager.ackMessage(this.streamName, this.groupName, message.id);
      } catch (ackError) {
        console.error('❌ [StatusUpdateConsumer] Erro ao confirmar mensagem:', ackError);
      }
      
      throw error;
    }
  }

  /**
   * Processar atualização de status
   */
  async processStatusUpdate(rideId, status, driverId, customerId) {
    try {
      console.log(`🔄 [StatusUpdateConsumer] Atualizando status da corrida ${rideId} para ${status}...`);
      
      // 1. Atualizar banco de dados
      await this.updateRideInDatabase(rideId, status);
      console.log(`💾 [StatusUpdateConsumer] Status atualizado no banco`);
      
      // 2. Notificar cliente
      await this.notifyCustomer(rideId, status, customerId);
      console.log(`👤 [StatusUpdateConsumer] Cliente notificado`);
      
      // 3. Notificar motorista
      await this.notifyDriver(rideId, status, driverId);
      console.log(`🚗 [StatusUpdateConsumer] Motorista notificado`);
      
      // 4. Atualizar analytics
      await this.updateAnalytics(rideId, status);
      console.log(`📊 [StatusUpdateConsumer] Analytics atualizado`);
      
      // 5. Enviar push notifications
      await this.sendPushNotifications(rideId, status, customerId, driverId);
      console.log(`📱 [StatusUpdateConsumer] Push notifications enviadas`);
      
      return {
        success: true,
        rideId,
        status,
        driverId,
        customerId,
        timestamp: new Date()
      };
      
    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro na atualização de status:', error);
      throw error;
    }
  }

  /**
   * Atualizar corrida no banco de dados
   */
  async updateRideInDatabase(rideId, status) {
    try {
      // Simular atualização no banco
      await this.simulateLatency(50, 150);
      console.log(`💾 [StatusUpdateConsumer] Corrida ${rideId} atualizada para ${status}`);
    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro ao atualizar banco:', error);
      throw error;
    }
  }

  /**
   * Notificar cliente
   */
  async notifyCustomer(rideId, status, customerId) {
    try {
      // Simular notificação ao cliente
      await this.simulateLatency(30, 100);
      console.log(`👤 [StatusUpdateConsumer] Cliente ${customerId} da corrida ${rideId} notificado sobre ${status}`);
    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro ao notificar cliente:', error);
      throw error;
    }
  }

  /**
   * Notificar motorista
   */
  async notifyDriver(rideId, status, driverId) {
    try {
      // Simular notificação ao motorista
      await this.simulateLatency(30, 100);
      console.log(`🚗 [StatusUpdateConsumer] Motorista ${driverId} da corrida ${rideId} notificado sobre ${status}`);
    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro ao notificar motorista:', error);
      throw error;
    }
  }

  /**
   * Atualizar analytics
   */
  async updateAnalytics(rideId, status) {
    try {
      // Simular atualização de analytics
      await this.simulateLatency(20, 80);
      console.log(`📊 [StatusUpdateConsumer] Analytics atualizado para corrida ${rideId}`);
    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro ao atualizar analytics:', error);
      throw error;
    }
  }

  /**
   * Enviar push notifications
   */
  async sendPushNotifications(rideId, status, customerId, driverId) {
    try {
      // Simular envio de push notifications
      await this.simulateLatency(100, 300);
      console.log(`📱 [StatusUpdateConsumer] Push notifications enviadas para corrida ${rideId}`);
    } catch (error) {
      console.error('❌ [StatusUpdateConsumer] Erro ao enviar push notifications:', error);
      throw error;
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

module.exports = StatusUpdateConsumer;
