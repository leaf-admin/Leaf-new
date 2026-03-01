/**
 * NotificationConsumer - Consumer para notificações push
 * 
 * Este consumer processa mensagens do stream 'notifications:push' de forma assíncrona,
 * enviando notificações push para usuários.
 * 
 * FUNCIONALIDADES:
 * - Processamento assíncrono de notificações
 * - Envio de push notifications
 * - Suporte a diferentes tipos de notificação
 * - Confirmação de processamento
 */

const RedisStreamManager = require('../services/streams/RedisStreamManager');

class NotificationConsumer {
  constructor(options = {}) {
    this.name = 'NotificationConsumer';
    this.streamName = 'notifications:push';
    this.groupName = 'push-group';
    this.consumerName = `push-consumer-${Date.now()}`;
    
    this.config = {
      batchSize: options.batchSize || 10,
      blockTime: options.blockTime || 2000,
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
      console.log('⚠️ [NotificationConsumer] Já está rodando');
      return;
    }

    this.redisManager = redisManager;
    this.isRunning = true;
    this.metrics.uptime = Date.now();

    try {
      console.log(`🚀 [NotificationConsumer] Iniciando consumer ${this.consumerName}...`);
      
      // Criar consumer group
      await this.redisManager.createConsumerGroup(
        this.streamName, 
        this.groupName, 
        { startId: '0', mkstream: true }
      );
      
      console.log(`✅ [NotificationConsumer] Consumer group criado`);
      
      // Iniciar loop de processamento
      this.processingLoop();
      
      console.log(`🎉 [NotificationConsumer] Consumer iniciado com sucesso!`);
      
    } catch (error) {
      console.error('❌ [NotificationConsumer] Erro ao iniciar:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Parar consumer
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ [NotificationConsumer] Não está rodando');
      return;
    }

    console.log('🛑 [NotificationConsumer] Parando consumer...');
    this.isRunning = false;
    
    console.log('✅ [NotificationConsumer] Consumer parado');
  }

  /**
   * Loop principal de processamento
   */
  async processingLoop() {
    while (this.isRunning) {
      try {
        await this.processMessages();
        await this.sleep(200); // Pausa para notificações
      } catch (error) {
        console.error('❌ [NotificationConsumer] Erro no loop de processamento:', error);
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
          noack: true // Auto-ack para notificações
        }
      );

      if (messages.length === 0) {
        return; // Nenhuma mensagem para processar
      }

      console.log(`📨 [NotificationConsumer] Processando ${messages.length} notificações...`);

      // Processar cada mensagem
      for (const message of messages) {
        await this.processMessage(message);
      }

    } catch (error) {
      console.error('❌ [NotificationConsumer] Erro ao processar mensagens:', error);
    }
  }

  /**
   * Processar mensagem individual
   */
  async processMessage(message) {
    const startTime = Date.now();
    this.metrics.totalProcessed++;

    try {
      console.log(`🔄 [NotificationConsumer] Processando notificação ${message.id}...`);
      
      // Extrair dados da mensagem
      const { userId, type, message: notificationMessage, data } = message.fields;
      
      if (!userId || !type || !notificationMessage) {
        throw new Error('Dados inválidos na mensagem');
      }

      // Processar notificação
      const result = await this.processNotification(userId, type, notificationMessage, data);
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      
      console.log(`✅ [NotificationConsumer] Notificação ${message.id} processada com sucesso (${processingTime}ms)`);
      
      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      
      console.error(`❌ [NotificationConsumer] Erro ao processar notificação ${message.id}:`, error);
      
      throw error;
    }
  }

  /**
   * Processar notificação
   */
  async processNotification(userId, type, message, data = {}) {
    try {
      console.log(`📱 [NotificationConsumer] Enviando notificação ${type} para usuário ${userId}...`);
      
      // 1. Preparar dados da notificação
      const notificationData = {
        userId,
        type,
        message,
        data,
        timestamp: new Date(),
        priority: this.getNotificationPriority(type)
      };
      
      // 2. Enviar push notification
      const pushResult = await this.sendPushNotification(notificationData);
      console.log(`📤 [NotificationConsumer] Push notification enviada`);
      
      // 3. Registrar no analytics
      await this.recordNotificationAnalytics(notificationData);
      console.log(`📊 [NotificationConsumer] Analytics registrado`);
      
      return {
        success: true,
        userId,
        type,
        message,
        pushResult,
        timestamp: new Date()
      };
      
    } catch (error) {
      console.error('❌ [NotificationConsumer] Erro no processamento da notificação:', error);
      throw error;
    }
  }

  /**
   * Enviar push notification
   */
  async sendPushNotification(notificationData) {
    try {
      // Simular envio de push notification
      await this.simulateLatency(100, 500);
      
      // Simular diferentes tipos de notificação
      const pushResult = {
        sent: true,
        platform: 'fcm', // Firebase Cloud Messaging
        messageId: `push_${Date.now()}`,
        deliveryStatus: 'delivered',
        timestamp: new Date()
      };
      
      console.log(`📱 [NotificationConsumer] Push notification enviada via ${pushResult.platform}`);
      
      return pushResult;
    } catch (error) {
      console.error('❌ [NotificationConsumer] Erro ao enviar push notification:', error);
      throw error;
    }
  }

  /**
   * Registrar analytics da notificação
   */
  async recordNotificationAnalytics(notificationData) {
    try {
      // Simular registro de analytics
      await this.simulateLatency(20, 80);
      
      const analyticsData = {
        event: 'notification_sent',
        userId: notificationData.userId,
        type: notificationData.type,
        timestamp: notificationData.timestamp,
        priority: notificationData.priority
      };
      
      console.log(`📊 [NotificationConsumer] Analytics registrado: ${analyticsData.event}`);
      
      return analyticsData;
    } catch (error) {
      console.error('❌ [NotificationConsumer] Erro ao registrar analytics:', error);
      throw error;
    }
  }

  /**
   * Obter prioridade da notificação
   */
  getNotificationPriority(type) {
    const priorities = {
      'ride_request': 'high',
      'ride_accepted': 'high',
      'ride_started': 'medium',
      'ride_completed': 'medium',
      'ride_cancelled': 'high',
      'driver_arrived': 'high',
      'payment_received': 'low',
      'promotion': 'low',
      'system_update': 'low'
    };
    
    return priorities[type] || 'medium';
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

module.exports = NotificationConsumer;
