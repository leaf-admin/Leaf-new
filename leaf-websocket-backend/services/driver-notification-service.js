const admin = require('firebase-admin');
const { logger } = require('../utils/logger');

class DriverNotificationService {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    try {
      this.isInitialized = true;
      logger.info('✅ Driver Notification Service inicializado');
    } catch (error) {
      logger.error('❌ Erro ao inicializar Driver Notification Service:', error);
      throw error;
    }
  }

  // Enviar notificação de aprovação
  async sendApprovalNotification(driverId, status, reason = '') {
    try {
      // Buscar dados do motorista
      const userRef = admin.firestore().collection('users').doc(driverId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        throw new Error('Motorista não encontrado');
      }

      const userData = userDoc.data();
      const fcmToken = userData.fcmToken;

      if (!fcmToken) {
        logger.warn(`⚠️ Motorista ${driverId} não possui FCM token`);
        return false;
      }

      // Preparar notificação
      let title, body, data;
      
      if (status === 'approved') {
        title = '🎉 Parabéns! Você foi aprovado!';
        body = 'Sua conta de motorista foi aprovada. Você já pode começar a trabalhar!';
        data = {
          type: 'driver_approval',
          status: 'approved',
          message: 'Conta aprovada com sucesso'
        };
      } else if (status === 'rejected') {
        title = '❌ Aprovação não aprovada';
        body = `Sua solicitação foi rejeitada: ${reason}`;
        data = {
          type: 'driver_approval',
          status: 'rejected',
          reason: reason,
          message: 'Solicitação rejeitada'
        };
      } else {
        title = '📋 Status da aprovação atualizado';
        body = `Seu status foi alterado para: ${status}`;
        data = {
          type: 'driver_approval',
          status: status,
          message: 'Status atualizado'
        };
      }

      // Enviar via FCM
      const message = {
        token: fcmToken,
        notification: {
          title: title,
          body: body
        },
        data: data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'driver_approvals',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      const response = await admin.messaging().send(message);
      
      // Salvar no histórico
      await this.saveNotificationHistory(driverId, status, title, body, reason);
      
      logger.info(`✅ Notificação de ${status} enviada para motorista ${driverId}: ${response}`);
      return true;

    } catch (error) {
      logger.error('❌ Erro ao enviar notificação de aprovação:', error);
      return false;
    }
  }

  // Enviar notificação de documento verificado
  async sendDocumentVerificationNotification(driverId, documentType, verified, notes = '') {
    try {
      const userRef = admin.firestore().collection('users').doc(driverId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        throw new Error('Motorista não encontrado');
      }

      const userData = userDoc.data();
      const fcmToken = userData.fcmToken;

      if (!fcmToken) {
        logger.warn(`⚠️ Motorista ${driverId} não possui FCM token`);
        return false;
      }

      const title = verified ? '✅ Documento verificado' : '❌ Documento rejeitado';
      const body = verified 
        ? `Seu ${documentType} foi verificado com sucesso!`
        : `Seu ${documentType} foi rejeitado: ${notes}`;

      const message = {
        token: fcmToken,
        notification: {
          title: title,
          body: body
        },
        data: {
          type: 'document_verification',
          documentType: documentType,
          verified: verified.toString(),
          notes: notes
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'driver_documents',
            priority: 'high'
          }
        }
      };

      const response = await admin.messaging().send(message);
      
      logger.info(`✅ Notificação de verificação de documento enviada para ${driverId}: ${response}`);
      return true;

    } catch (error) {
      logger.error('❌ Erro ao enviar notificação de verificação:', error);
      return false;
    }
  }

  // Enviar notificação de status atualizado
  async sendStatusUpdateNotification(driverId, oldStatus, newStatus, reason = '') {
    try {
      const userRef = admin.firestore().collection('users').doc(driverId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        throw new Error('Motorista não encontrado');
      }

      const userData = userDoc.data();
      const fcmToken = userData.fcmToken;

      if (!fcmToken) {
        logger.warn(`⚠️ Motorista ${driverId} não possui FCM token`);
        return false;
      }

      const statusMessages = {
        'pending': 'Aguardando aprovação',
        'under_review': 'Em análise',
        'approved': 'Aprovado',
        'rejected': 'Rejeitado',
        'suspended': 'Suspenso',
        'blocked': 'Bloqueado'
      };

      const title = '📋 Status atualizado';
      const body = `Seu status foi alterado de "${statusMessages[oldStatus]}" para "${statusMessages[newStatus]}"${reason ? `: ${reason}` : ''}`;

      const message = {
        token: fcmToken,
        notification: {
          title: title,
          body: body
        },
        data: {
          type: 'status_update',
          oldStatus: oldStatus,
          newStatus: newStatus,
          reason: reason
        },
        android: {
          priority: 'normal',
          notification: {
            channelId: 'driver_status',
            priority: 'normal'
          }
        }
      };

      const response = await admin.messaging().send(message);
      
      logger.info(`✅ Notificação de status enviada para ${driverId}: ${response}`);
      return true;

    } catch (error) {
      logger.error('❌ Erro ao enviar notificação de status:', error);
      return false;
    }
  }

  // Salvar histórico de notificações
  async saveNotificationHistory(driverId, type, title, body, reason = '') {
    try {
      const historyRef = admin.firestore().collection('notificationHistory');
      await historyRef.add({
        driverId,
        type,
        title,
        body,
        reason,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false
      });

      logger.info(`✅ Histórico de notificação salvo para ${driverId}`);
    } catch (error) {
      logger.error('❌ Erro ao salvar histórico de notificação:', error);
    }
  }

  // Buscar histórico de notificações
  async getNotificationHistory(driverId, limit = 50) {
    try {
      const historyRef = admin.firestore().collection('notificationHistory');
      const snapshot = await historyRef
        .where('driverId', '==', driverId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const notifications = [];
      snapshot.forEach(doc => {
        notifications.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return notifications;
    } catch (error) {
      logger.error('❌ Erro ao buscar histórico de notificações:', error);
      return [];
    }
  }

  // Marcar notificação como lida
  async markNotificationAsRead(notificationId) {
    try {
      const notificationRef = admin.firestore().collection('notificationHistory').doc(notificationId);
      await notificationRef.update({
        read: true,
        readAt: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info(`✅ Notificação ${notificationId} marcada como lida`);
      return true;
    } catch (error) {
      logger.error('❌ Erro ao marcar notificação como lida:', error);
      return false;
    }
  }

  // Enviar notificação em massa para motoristas
  async sendBulkNotification(driverIds, title, body, data = {}) {
    try {
      const tokens = [];
      
      // Buscar FCM tokens dos motoristas
      for (const driverId of driverIds) {
        const userRef = admin.firestore().collection('users').doc(driverId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          if (userData.fcmToken) {
            tokens.push(userData.fcmToken);
          }
        }
      }

      if (tokens.length === 0) {
        logger.warn('⚠️ Nenhum FCM token encontrado para os motoristas');
        return 0;
      }

      // Enviar em lotes de 500 (limite do FCM)
      const batchSize = 500;
      let successCount = 0;

      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        
        const message = {
          notification: {
            title: title,
            body: body
          },
          data: {
            type: 'bulk_notification',
            ...data
          },
          android: {
            priority: 'normal',
            notification: {
              channelId: 'driver_bulk',
              priority: 'normal'
            }
          }
        };

        const response = await admin.messaging().sendMulticast({
          tokens: batch,
          ...message
        });

        successCount += response.successCount;
        
        if (response.failureCount > 0) {
          logger.warn(`⚠️ ${response.failureCount} notificações falharam no lote ${i / batchSize + 1}`);
        }
      }

      logger.info(`✅ ${successCount} notificações em massa enviadas com sucesso`);
      return successCount;

    } catch (error) {
      logger.error('❌ Erro ao enviar notificações em massa:', error);
      return 0;
    }
  }

  // Obter estatísticas de notificações
  async getNotificationStats() {
    try {
      const stats = {
        totalSent: 0,
        totalRead: 0,
        totalUnread: 0,
        byType: {}
      };

      const historyRef = admin.firestore().collection('notificationHistory');
      const snapshot = await historyRef.get();

      snapshot.forEach(doc => {
        const data = doc.data();
        stats.totalSent++;
        
        if (data.read) {
          stats.totalRead++;
        } else {
          stats.totalUnread++;
        }

        if (data.type) {
          stats.byType[data.type] = (stats.byType[data.type] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas de notificações:', error);
      return {};
    }
  }

  destroy() {
    this.isInitialized = false;
    logger.info('🗑️ Driver Notification Service destruído');
  }
}

module.exports = DriverNotificationService;
