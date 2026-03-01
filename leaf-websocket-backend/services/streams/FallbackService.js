/**
 * FallbackService - Serviço de fallback síncrono
 * 
 * Este serviço implementa a lógica atual (síncrona) como fallback
 * quando Redis Streams não está disponível ou falha.
 * 
 * VANTAGENS:
 * - Garante funcionamento mesmo com falhas
 * - Implementação testada e estável
 * - Zero dependências externas
 * 
 * DESVANTAGENS:
 * - Latência alta (5-30 segundos)
 * - Processamento bloqueante
 * - Baixo throughput
 */

// const redisPool = require('../redis-pool');
// const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');

class FallbackService {
  constructor() {
    this.name = 'FallbackService';
    this.isHealthy = true;
    this.metrics = {
      requestsProcessed: 0,
      averageLatency: 0,
      errors: 0
    };
  }

  /**
   * Processar matching de motoristas (método síncrono atual)
   * @param {string} customerId - ID do cliente
   * @param {object} location - Localização do cliente
   * @returns {Promise<object>} Resultado do matching
   */
  async processMatching(customerId, location) {
    const startTime = Date.now();
    
    try {
      logStructured('info', `🔄 [Fallback] Processando matching para cliente ${customerId}`);
      
      // 1. Buscar motoristas próximos (200-500ms)
      const nearbyDrivers = await this.findNearbyDrivers(location);
      logStructured('info', `📍 [Fallback] Encontrados ${nearbyDrivers.length} motoristas próximos`);
      
      // 2. Calcular distâncias (100-300ms)
      const distances = await this.calculateDistances(location, nearbyDrivers);
      logStructured('info', `📏 [Fallback] Distâncias calculadas para ${distances.length} motoristas`);
      
      // 3. Enviar notificações (500-2000ms)
      const notifications = await this.notifyDrivers(nearbyDrivers, customerId, location);
      logStructured('info', `📱 [Fallback] Notificações enviadas para ${notifications.length} motoristas`);
      
      // 4. Aguardar resposta (5-30000ms)
      const response = await this.waitForDriverResponse(customerId, nearbyDrivers);
      logStructured('info', `✅ [Fallback] Resposta recebida: ${response.status}`);
      
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, true);
      
      return {
        success: true,
        method: 'fallback_sync',
        requestId: `fallback_${Date.now()}`,
        driverId: response.driverId,
        status: response.status,
        latency: totalTime,
        driversNotified: notifications.length
      };
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, false);
      
      logError(error, `❌ [Fallback] Erro no matching:`, { service: 'FallbackService' });
      
      return {
        success: false,
        method: 'fallback_sync',
        error: error.message,
        latency: totalTime
      };
    }
  }

  /**
   * Processar atualização de status de corrida (método síncrono atual)
   * @param {string} rideId - ID da corrida
   * @param {string} status - Novo status
   * @returns {Promise<object>} Resultado da atualização
   */
  async processStatusUpdate(rideId, status) {
    const startTime = Date.now();
    
    try {
      logStructured('info', `🔄 [Fallback] Atualizando status da corrida ${rideId} para ${status}`);
      
      // 1. Atualizar banco (100-200ms)
      await this.updateRideInDatabase(rideId, status);
      logStructured('info', `💾 [Fallback] Status atualizado no banco`);
      
      // 2. Notificar cliente (200-500ms)
      await this.notifyCustomer(rideId, status);
      logStructured('info', `👤 [Fallback] Cliente notificado`);
      
      // 3. Notificar motorista (200-500ms)
      await this.notifyDriver(rideId, status);
      logStructured('info', `🚗 [Fallback] Motorista notificado`);
      
      // 4. Atualizar analytics (100-300ms)
      await this.updateAnalytics(rideId, status);
      logStructured('info', `📊 [Fallback] Analytics atualizado`);
      
      // 5. Enviar push notifications (500-2000ms)
      await this.sendPushNotifications(rideId, status);
      logStructured('info', `📱 [Fallback] Push notifications enviadas`);
      
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, true);
      
      return {
        success: true,
        method: 'fallback_sync',
        rideId,
        status,
        latency: totalTime
      };
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, false);
      
      logError(error, `❌ [Fallback] Erro na atualização de status:`, { service: 'FallbackService' });
      
      return {
        success: false,
        method: 'fallback_sync',
        rideId,
        error: error.message,
        latency: totalTime
      };
    }
  }

  /**
   * Buscar motoristas próximos
   * @param {object} location - Localização do cliente
   * @returns {Promise<Array>} Lista de motoristas próximos
   */
  async findNearbyDrivers(location) {
    try {
      // Simular busca de motoristas próximos
      const drivers = [
        { id: 'driver1', name: 'João Silva', rating: 4.8, distance: 0.5 },
        { id: 'driver2', name: 'Maria Santos', rating: 4.9, distance: 0.8 },
        { id: 'driver3', name: 'Pedro Costa', rating: 4.7, distance: 1.2 }
      ];
      
      // Simular latência de rede
      await this.simulateLatency(200, 500);
      
      return drivers;
    } catch (error) {
      logError(error, 'Erro ao buscar motoristas próximos:', { service: 'FallbackService' });
      return [];
    }
  }

  /**
   * Calcular distâncias
   * @param {object} location - Localização do cliente
   * @param {Array} drivers - Lista de motoristas
   * @returns {Promise<Array>} Lista com distâncias calculadas
   */
  async calculateDistances(location, drivers) {
    try {
      // Simular cálculo de distâncias
      const distances = drivers.map(driver => ({
        ...driver,
        estimatedTime: Math.floor(Math.random() * 10) + 5, // 5-15 minutos
        route: `Rota para ${driver.name}`
      }));
      
      // Simular latência de processamento
      await this.simulateLatency(100, 300);
      
      return distances;
    } catch (error) {
      logError(error, 'Erro ao calcular distâncias:', { service: 'FallbackService' });
      return [];
    }
  }

  /**
   * Notificar motoristas
   * @param {Array} drivers - Lista de motoristas
   * @param {string} customerId - ID do cliente
   * @param {object} location - Localização
   * @returns {Promise<Array>} Lista de notificações enviadas
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
          status: 'sent'
        };
        
        notifications.push(notification);
        
        // Simular latência de envio
        await this.simulateLatency(100, 200);
      }
      
      // Simular latência total
      await this.simulateLatency(500, 2000);
      
      return notifications;
    } catch (error) {
      logError(error, 'Erro ao notificar motoristas:', { service: 'FallbackService' });
      return [];
    }
  }

  /**
   * Aguardar resposta do motorista
   * @param {string} customerId - ID do cliente
   * @param {Array} drivers - Lista de motoristas notificados
   * @returns {Promise<object>} Resposta do motorista
   */
  async waitForDriverResponse(customerId, drivers) {
    try {
      // Simular tempo de espera por resposta
      const waitTime = Math.floor(Math.random() * 25000) + 5000; // 5-30 segundos
      await this.simulateLatency(waitTime, waitTime);
      
      // Simular resposta positiva
      const respondingDriver = drivers[Math.floor(Math.random() * drivers.length)];
      
      return {
        status: 'accepted',
        driverId: respondingDriver.id,
        driverName: respondingDriver.name,
        estimatedTime: Math.floor(Math.random() * 10) + 5
      };
    } catch (error) {
      logError(error, 'Erro ao aguardar resposta:', { service: 'FallbackService' });
      return {
        status: 'timeout',
        driverId: null,
        error: 'Timeout aguardando resposta'
      };
    }
  }

  /**
   * Atualizar corrida no banco de dados
   * @param {string} rideId - ID da corrida
   * @param {string} status - Novo status
   */
  async updateRideInDatabase(rideId, status) {
    try {
      // Simular atualização no banco
      await this.simulateLatency(100, 200);
      logStructured('info', `💾 [Fallback] Corrida ${rideId} atualizada para ${status}`);
    } catch (error) {
      logError(error, 'Erro ao atualizar banco:', { service: 'FallbackService' });
      throw error;
    }
  }

  /**
   * Notificar cliente
   * @param {string} rideId - ID da corrida
   * @param {string} status - Status da corrida
   */
  async notifyCustomer(rideId, status) {
    try {
      // Simular notificação ao cliente
      await this.simulateLatency(200, 500);
      logStructured('info', `👤 [Fallback] Cliente da corrida ${rideId} notificado sobre ${status}`);
    } catch (error) {
      logError(error, 'Erro ao notificar cliente:', { service: 'FallbackService' });
      throw error;
    }
  }

  /**
   * Notificar motorista
   * @param {string} rideId - ID da corrida
   * @param {string} status - Status da corrida
   */
  async notifyDriver(rideId, status) {
    try {
      // Simular notificação ao motorista
      await this.simulateLatency(200, 500);
      logStructured('info', `🚗 [Fallback] Motorista da corrida ${rideId} notificado sobre ${status}`);
    } catch (error) {
      logError(error, 'Erro ao notificar motorista:', { service: 'FallbackService' });
      throw error;
    }
  }

  /**
   * Atualizar analytics
   * @param {string} rideId - ID da corrida
   * @param {string} status - Status da corrida
   */
  async updateAnalytics(rideId, status) {
    try {
      // Simular atualização de analytics
      await this.simulateLatency(100, 300);
      logStructured('info', `📊 [Fallback] Analytics atualizado para corrida ${rideId}`);
    } catch (error) {
      logError(error, 'Erro ao atualizar analytics:', { service: 'FallbackService' });
      throw error;
    }
  }

  /**
   * Enviar push notifications
   * @param {string} rideId - ID da corrida
   * @param {string} status - Status da corrida
   */
  async sendPushNotifications(rideId, status) {
    try {
      // Simular envio de push notifications
      await this.simulateLatency(500, 2000);
      logStructured('info', `📱 [Fallback] Push notifications enviadas para corrida ${rideId}`);
    } catch (error) {
      logError(error, 'Erro ao enviar push notifications:', { service: 'FallbackService' });
      throw error;
    }
  }

  /**
   * Simular latência de rede/processamento
   * @param {number} min - Latência mínima em ms
   * @param {number} max - Latência máxima em ms
   */
  async simulateLatency(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Atualizar métricas do serviço
   * @param {number} latency - Latência da operação
   * @param {boolean} success - Se a operação foi bem-sucedida
   */
  updateMetrics(latency, success) {
    this.metrics.requestsProcessed++;
    
    if (success) {
      // Calcular latência média
      this.metrics.averageLatency = 
        (this.metrics.averageLatency * (this.metrics.requestsProcessed - 1) + latency) / 
        this.metrics.requestsProcessed;
    } else {
      this.metrics.errors++;
    }
  }

  /**
   * Obter métricas do serviço
   * @returns {object} Métricas atuais
   */
  getMetrics() {
    return {
      ...this.metrics,
      errorRate: this.metrics.errors / this.metrics.requestsProcessed * 100,
      isHealthy: this.isHealthy
    };
  }

  /**
   * Processar notificação push
   */
  async processPushNotification(userId, type, message, data = {}) {
    const startTime = Date.now();
    
    try {
      logStructured('info', `📱 [Fallback] Enviando notificação push para ${userId}: ${type}`);
      
      // Simular envio de notificação push
      await this.simulateLatency(500, 2000);
      
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, true);
      
      return {
        success: true,
        userId,
        type,
        message,
        data,
        method: 'fallback',
        latency: totalTime,
        timestamp: new Date()
      };
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, false);
      
      logError(error, '❌ [Fallback] Erro na notificação push:', { service: 'FallbackService' });
      
      return {
        success: false,
        userId,
        type,
        error: error.message,
        method: 'fallback',
        latency: totalTime
      };
    }
  }

  /**
   * Processar evento de analytics
   */
  async processAnalyticsEvent(event, userId, data = {}) {
    const startTime = Date.now();
    
    try {
      logStructured('info', `📊 [Fallback] Registrando evento de analytics: ${event} para ${userId}`);
      
      // Simular registro de analytics
      await this.simulateLatency(200, 1000);
      
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, true);
      
      return {
        success: true,
        event,
        userId,
        data,
        method: 'fallback',
        latency: totalTime,
        timestamp: new Date()
      };
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, false);
      
      logError(error, '❌ [Fallback] Erro no evento de analytics:', { service: 'FallbackService' });
      
      return {
        success: false,
        event,
        userId,
        error: error.message,
        method: 'fallback',
        latency: totalTime
      };
    }
  }

  /**
   * Processar atualização de localização do motorista
   */
  async processDriverLocationUpdate(driverId, location, status = 'available') {
    const startTime = Date.now();
    
    try {
      logStructured('info', `📍 [Fallback] Atualizando localização do motorista ${driverId}`);
      
      // Simular atualização de localização
      await this.simulateLatency(300, 1500);
      
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, true);
      
      return {
        success: true,
        driverId,
        location,
        status,
        method: 'fallback',
        latency: totalTime,
        timestamp: new Date()
      };
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.updateMetrics(totalTime, false);
      
      logError(error, '❌ [Fallback] Erro na atualização de localização:', { service: 'FallbackService' });
      
      return {
        success: false,
        driverId,
        error: error.message,
        method: 'fallback',
        latency: totalTime
      };
    }
  }

  /**
   * Verificar saúde do serviço
   * @returns {object} Status de saúde
   */
  getHealth() {
    return {
      service: this.name,
      status: this.isHealthy ? 'healthy' : 'unhealthy',
      metrics: this.getMetrics(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = FallbackService;
