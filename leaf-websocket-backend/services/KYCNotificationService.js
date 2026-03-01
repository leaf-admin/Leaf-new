/**
 * KYCNotificationService - Serviço de notificações para KYC
 * 
 * Este serviço integra o sistema KYC com notificações push,
 * enviando feedback em tempo real para motoristas.
 */

const FCMService = require('./fcm-service');
const { logStructured, logError } = require('../utils/logger');

class KYCNotificationService {
  constructor() {
    this.fcmService = new FCMService();
    this.notificationTypes = {
      VERIFICATION_STARTED: 'kyc_verification_started',
      VERIFICATION_SUCCESS: 'kyc_verification_success',
      VERIFICATION_FAILED: 'kyc_verification_failed',
      RETRY_ATTEMPT: 'kyc_retry_attempt',
      VERIFICATION_COMPLETED: 'kyc_verification_completed',
      LIVENESS_CHECK: 'kyc_liveness_check',
      PERMISSION_REQUIRED: 'kyc_permission_required'
    };
    
    this.notificationTemplates = {
      [this.notificationTypes.VERIFICATION_STARTED]: {
        title: '🔍 Verificação Facial Iniciada',
        body: 'Posicione seu rosto dentro do círculo verde para continuar',
        priority: 'high'
      },
      [this.notificationTypes.VERIFICATION_SUCCESS]: {
        title: '✅ Verificação Aprovada',
        body: 'Sua identidade foi verificada com sucesso! Você pode ficar online agora.',
        priority: 'high'
      },
      [this.notificationTypes.VERIFICATION_FAILED]: {
        title: '❌ Verificação Falhou',
        body: 'Não foi possível verificar sua identidade. Tente novamente.',
        priority: 'normal'
      },
      [this.notificationTypes.RETRY_ATTEMPT]: {
        title: '🔄 Tentando Novamente',
        body: 'Verificação em andamento... Aguarde um momento.',
        priority: 'normal'
      },
      [this.notificationTypes.VERIFICATION_COMPLETED]: {
        title: '🎉 Verificação Concluída',
        body: 'Parabéns! Você está online e pronto para receber corridas.',
        priority: 'high'
      },
      [this.notificationTypes.LIVENESS_CHECK]: {
        title: '😊 Verificação de Vida',
        body: 'Sorria para completar a verificação de segurança',
        priority: 'high'
      },
      [this.notificationTypes.PERMISSION_REQUIRED]: {
        title: '📷 Permissão Necessária',
        body: 'É necessário acesso à câmera para verificação facial',
        priority: 'normal'
      }
    };
  }

  /**
   * Enviar notificação de início de verificação
   */
  async sendVerificationStarted(driverId, data = {}) {
    try {
      const notification = this.buildNotification(
        this.notificationTypes.VERIFICATION_STARTED,
        data
      );
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Verificação iniciada enviada para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação de início:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Enviar notificação de sucesso
   */
  async sendVerificationSuccess(driverId, data = {}) {
    try {
      const notification = this.buildNotification(
        this.notificationTypes.VERIFICATION_SUCCESS,
        {
          ...data,
          confidence: data.confidence ? `Confiança: ${Math.round(data.confidence * 100)}%` : ''
        }
      );
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Sucesso enviado para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação de sucesso:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Enviar notificação de falha
   */
  async sendVerificationFailed(driverId, data = {}) {
    try {
      const notification = this.buildNotification(
        this.notificationTypes.VERIFICATION_FAILED,
        {
          ...data,
          retryCount: data.retryCount ? `Tentativa ${data.retryCount}` : '',
          errorMessage: data.errorMessage || 'Erro desconhecido'
        }
      );
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Falha enviada para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação de falha:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Enviar notificação de retry
   */
  async sendRetryAttempt(driverId, data = {}) {
    try {
      const notification = this.buildNotification(
        this.notificationTypes.RETRY_ATTEMPT,
        {
          ...data,
          attempt: data.attempt ? `Tentativa ${data.attempt}` : '',
          reason: data.reason ? `Motivo: ${this.getReasonDescription(data.reason)}` : ''
        }
      );
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Retry enviado para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação de retry:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Enviar notificação de conclusão
   */
  async sendVerificationCompleted(driverId, data = {}) {
    try {
      const notification = this.buildNotification(
        this.notificationTypes.VERIFICATION_COMPLETED,
        {
          ...data,
          totalTime: data.totalTime ? `Tempo total: ${Math.round(data.totalTime / 1000)}s` : '',
          attempts: data.attempts ? `Tentativas: ${data.attempts}` : ''
        }
      );
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Conclusão enviada para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação de conclusão:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Enviar notificação de liveness check
   */
  async sendLivenessCheck(driverId, data = {}) {
    try {
      const notification = this.buildNotification(
        this.notificationTypes.LIVENESS_CHECK,
        data
      );
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Liveness check enviado para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação de liveness:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Enviar notificação de permissão necessária
   */
  async sendPermissionRequired(driverId, data = {}) {
    try {
      const notification = this.buildNotification(
        this.notificationTypes.PERMISSION_REQUIRED,
        data
      );
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Permissão enviada para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação de permissão:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Construir notificação
   */
  buildNotification(type, data = {}) {
    const template = this.notificationTemplates[type];
    
    if (!template) {
      throw new Error(`Tipo de notificação não encontrado: ${type}`);
    }
    
    // Personalizar título e corpo com dados
    let title = template.title;
    let body = template.body;
    
    if (data.confidence) {
      body += ` (${Math.round(data.confidence * 100)}% de confiança)`;
    }
    
    if (data.retryCount) {
      body += ` (Tentativa ${data.retryCount})`;
    }
    
    if (data.totalTime) {
      body += ` (${Math.round(data.totalTime / 1000)}s)`;
    }
    
    return {
      title,
      body,
      priority: template.priority,
      data: {
        type,
        driverId: data.driverId,
        timestamp: new Date().toISOString(),
        ...data
      },
      android: {
        priority: template.priority,
        notification: {
          channelId: 'kyc_verification',
          priority: template.priority,
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: 'ic_notification',
          color: this.getNotificationColor(type)
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            category: 'KYC_VERIFICATION'
          }
        }
      }
    };
  }

  /**
   * Enviar notificação para driver
   */
  async sendToDriver(driverId, notification) {
    try {
      // Verificar se FCM está disponível
      if (!this.fcmService.isServiceAvailable()) {
        logStructured('warn', '⚠️ [KYCNotification] FCM Service não disponível');
        return;
      }
      
      // Enviar notificação
      const result = await this.fcmService.sendNotificationToUsers([driverId], notification);
      
      if (result.success) {
        logStructured('info', `✅ [KYCNotification] Notificação enviada para driver ${driverId}`);
      } else {
        logStructured('error', `❌ [KYCNotification] Falha ao enviar notificação para driver ${driverId}:`, result.error);
      }
      
      return result;
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação:', { service: 'KYCNotificationService' });
      throw error;
    }
  }

  /**
   * Obter cor da notificação baseada no tipo
   */
  getNotificationColor(type) {
    const colors = {
      [this.notificationTypes.VERIFICATION_STARTED]: '#2196F3', // Azul
      [this.notificationTypes.VERIFICATION_SUCCESS]: '#4CAF50', // Verde
      [this.notificationTypes.VERIFICATION_FAILED]: '#F44336', // Vermelho
      [this.notificationTypes.RETRY_ATTEMPT]: '#FF9800', // Laranja
      [this.notificationTypes.VERIFICATION_COMPLETED]: '#4CAF50', // Verde
      [this.notificationTypes.LIVENESS_CHECK]: '#9C27B0', // Roxo
      [this.notificationTypes.PERMISSION_REQUIRED]: '#FF5722' // Vermelho escuro
    };
    
    return colors[type] || '#2196F3';
  }

  /**
   * Obter descrição da razão de retry
   */
  getReasonDescription(reason) {
    const descriptions = {
      'confidence_too_low': 'Confiança baixa',
      'face_not_detected': 'Rosto não detectado',
      'network_error': 'Erro de rede',
      'server_error': 'Erro do servidor',
      'timeout': 'Tempo esgotado',
      'unknown': 'Erro desconhecido'
    };
    
    return descriptions[reason] || 'Erro desconhecido';
  }

  /**
   * Enviar notificação personalizada
   */
  async sendCustomNotification(driverId, title, body, data = {}) {
    try {
      const notification = {
        title,
        body,
        priority: 'normal',
        data: {
          type: 'kyc_custom',
          driverId,
          timestamp: new Date().toISOString(),
          ...data
        },
        android: {
          priority: 'normal',
          notification: {
            channelId: 'kyc_verification',
            priority: 'normal',
            defaultSound: true,
            defaultVibrateTimings: true
          }
        }
      };
      
      await this.sendToDriver(driverId, notification);
      
      logStructured('info', `📱 [KYCNotification] Notificação personalizada enviada para driver ${driverId}`);
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação personalizada:', { service: 'KYCNotificationService' });
    }
  }

  /**
   * Enviar notificação para múltiplos drivers
   */
  async sendToMultipleDrivers(driverIds, type, data = {}) {
    try {
      const notification = this.buildNotification(type, data);
      
      const results = await Promise.allSettled(
        driverIds.map(driverId => this.sendToDriver(driverId, notification))
      );
      
      const successful = results.filter(result => result.status === 'fulfilled').length;
      const failed = results.filter(result => result.status === 'rejected').length;
      
      logStructured('info', `📱 [KYCNotification] Notificação enviada para ${successful} drivers, ${failed} falharam`);
      
      return { successful, failed, total: driverIds.length };
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao enviar notificação para múltiplos drivers:', { service: 'KYCNotificationService' });
      throw error;
    }
  }

  /**
   * Verificar se notificações estão habilitadas para um driver
   */
  async isNotificationEnabled(driverId) {
    try {
      // Verificar se o driver tem token FCM válido
      const hasValidToken = await this.fcmService.hasValidToken(driverId);
      
      // Verificar configurações de notificação do driver
      const notificationSettings = await this.getDriverNotificationSettings(driverId);
      
      return hasValidToken && notificationSettings.kycEnabled !== false;
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao verificar configurações:', { service: 'KYCNotificationService' });
      return false;
    }
  }

  /**
   * Obter configurações de notificação do driver
   */
  async getDriverNotificationSettings(driverId) {
    try {
      // Implementar busca das configurações do driver
      // Por enquanto, retornar configurações padrão
      return {
        kycEnabled: true,
        pushEnabled: true,
        soundEnabled: true,
        vibrationEnabled: true
      };
      
    } catch (error) {
      logError(error, '❌ [KYCNotification] Erro ao obter configurações:', { service: 'KYCNotificationService' });
      return {
        kycEnabled: true,
        pushEnabled: true,
        soundEnabled: true,
        vibrationEnabled: true
      };
    }
  }
}

module.exports = KYCNotificationService;
