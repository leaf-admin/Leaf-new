/**
 * 🔐 KYC Driver Status Service
 * 
 * Gerencia bloqueio/liberação automática de motoristas baseado em KYC
 * 
 * Funcionalidades:
 * - Bloquear motorista quando KYC falhar
 * - Liberar motorista quando KYC for aprovado
 * - Atualizar status no Redis e Firestore
 * - Enviar notificações
 * - Validar se motorista pode fazer corridas
 */

const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');
const KYCNotificationService = require('./KYCNotificationService');

class KYCDriverStatusService {
  constructor() {
    this.redis = redisPool.getConnection();
    this.notificationService = new KYCNotificationService();
    this.statusKeys = {
      kycStatus: 'kyc_status', // 'approved', 'rejected', 'pending', 'blocked'
      kycBlocked: 'kyc_blocked', // true/false
      kycBlockedAt: 'kyc_blocked_at',
      kycBlockedReason: 'kyc_blocked_reason',
      kycApprovedAt: 'kyc_approved_at',
      kycLastVerification: 'kyc_last_verification'
    };
  }

  /**
   * Bloquear motorista por falha no KYC
   * @param {string} driverId - ID do motorista
   * @param {string} reason - Motivo do bloqueio
   * @param {Object} options - Opções adicionais
   * @returns {Promise<Object>} Resultado do bloqueio
   */
  async blockDriver(driverId, reason = 'KYC não aprovado', options = {}) {
    try {
      logStructured('info', 'Bloqueando motorista por KYC', {
        service: 'kyc-driver-status-service',
        driverId,
        reason
      });

      const timestamp = new Date().toISOString();
      const blockData = {
        blocked: true,
        blockedAt: timestamp,
        reason: reason,
        similarityScore: options.similarityScore || null,
        confidence: options.confidence || null,
        verificationAttempts: options.verificationAttempts || 1
      };

      // 1. Atualizar Redis
      await this.updateRedisStatus(driverId, {
        [this.statusKeys.kycStatus]: 'blocked',
        [this.statusKeys.kycBlocked]: 'true',
        [this.statusKeys.kycBlockedAt]: timestamp,
        [this.statusKeys.kycBlockedReason]: reason,
        [this.statusKeys.kycLastVerification]: timestamp
      });

      // 2. Forçar motorista offline no Redis
      await this.forceDriverOffline(driverId);

      // 3. Atualizar Firestore
      await this.updateFirestoreStatus(driverId, {
        kycStatus: 'blocked',
        kycBlocked: true,
        kycBlockedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycBlockedReason: reason,
        kycLastVerification: admin.firestore.FieldValue.serverTimestamp(),
        ...blockData
      });

      // 4. Enviar notificação
      await this.notificationService.sendCustomNotification(
        driverId,
        '🚫 Conta Bloqueada',
        `Sua conta foi bloqueada: ${reason}. Entre em contato com o suporte para mais informações.`,
        {
          type: 'kyc_blocked',
          reason,
          blockedAt: timestamp
        }
      );

      logStructured('info', 'Motorista bloqueado com sucesso', {
        service: 'kyc-driver-status-service',
        driverId,
        reason
      });

      return {
        success: true,
        driverId,
        blocked: true,
        blockedAt: timestamp,
        reason
      };

    } catch (error) {
      logError(error, 'Erro ao bloquear motorista', {
        service: 'kyc-driver-status-service',
        driverId
      });
      throw error;
    }
  }

  /**
   * Liberar motorista após aprovação do KYC
   * @param {string} driverId - ID do motorista
   * @param {Object} options - Opções adicionais
   * @returns {Promise<Object>} Resultado da liberação
   */
  async unblockDriver(driverId, options = {}) {
    try {
      logStructured('info', 'Liberando motorista após aprovação KYC', {
        service: 'kyc-driver-status-service',
        driverId
      });

      const timestamp = new Date().toISOString();

      // 1. Atualizar Redis
      await this.updateRedisStatus(driverId, {
        [this.statusKeys.kycStatus]: 'approved',
        [this.statusKeys.kycBlocked]: 'false',
        [this.statusKeys.kycApprovedAt]: timestamp,
        [this.statusKeys.kycLastVerification]: timestamp
      });

      // 2. Remover bloqueio do Redis (não forçar offline)
      // Motorista pode escolher quando ficar online

      // 3. Atualizar Firestore
      await this.updateFirestoreStatus(driverId, {
        kycStatus: 'approved',
        kycBlocked: false,
        kycApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycLastVerification: admin.firestore.FieldValue.serverTimestamp(),
        kycBlockedAt: admin.firestore.FieldValue.delete(),
        kycBlockedReason: admin.firestore.FieldValue.delete(),
        similarityScore: options.similarityScore || null,
        confidence: options.confidence || null
      });

      // 4. Enviar notificação
      await this.notificationService.sendVerificationSuccess(driverId, {
        driverId,
        confidence: options.confidence || 1.0,
        message: 'Sua conta foi aprovada! Você já pode começar a trabalhar.'
      });

      logStructured('info', 'Motorista liberado com sucesso', {
        service: 'kyc-driver-status-service',
        driverId
      });

      return {
        success: true,
        driverId,
        blocked: false,
        approvedAt: timestamp
      };

    } catch (error) {
      logError(error, 'Erro ao liberar motorista', {
        service: 'kyc-driver-status-service',
        driverId
      });
      throw error;
    }
  }

  /**
   * Verificar se motorista está bloqueado
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} Status do bloqueio
   */
  async isDriverBlocked(driverId) {
    try {
      // 1. Verificar Redis primeiro (mais rápido)
      const redisKey = `driver:${driverId}`;
      const driverData = await this.redis.hgetall(redisKey);

      if (driverData && driverData[this.statusKeys.kycBlocked] === 'true') {
        return {
          blocked: true,
          reason: driverData[this.statusKeys.kycBlockedReason] || 'KYC não aprovado',
          blockedAt: driverData[this.statusKeys.kycBlockedAt] || null,
          source: 'redis'
        };
      }

      // 2. Verificar Firestore (fallback)
      const firestore = admin.firestore();
      const driverDoc = await firestore.collection('drivers').doc(driverId).get();

      if (driverDoc.exists) {
        const driverData = driverDoc.data();
        if (driverData.kycBlocked === true) {
          return {
            blocked: true,
            reason: driverData.kycBlockedReason || 'KYC não aprovado',
            blockedAt: driverData.kycBlockedAt?.toDate?.()?.toISOString() || null,
            source: 'firestore'
          };
        }
      }

      // 3. Verificar também em users (estrutura alternativa)
      const userDoc = await firestore.collection('users').doc(driverId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.kycBlocked === true) {
          return {
            blocked: true,
            reason: userData.kycBlockedReason || 'KYC não aprovado',
            blockedAt: userData.kycBlockedAt?.toDate?.()?.toISOString() || null,
            source: 'firestore-users'
          };
        }
      }

      return {
        blocked: false,
        source: 'none'
      };

    } catch (error) {
      logError(error, 'Erro ao verificar bloqueio do motorista', {
        service: 'kyc-driver-status-service',
        driverId
      });
      // Em caso de erro, assumir não bloqueado (fail-open)
      return {
        blocked: false,
        error: error.message,
        source: 'error'
      };
    }
  }

  /**
   * Verificar se motorista pode fazer corridas
   * @param {string} driverId - ID do motorista
   * @returns {Promise<boolean>} true se pode fazer corridas
   */
  async canDriverWork(driverId) {
    try {
      const blockStatus = await this.isDriverBlocked(driverId);
      
      if (blockStatus.blocked) {
        logStructured('warn', 'Motorista bloqueado tentou trabalhar', {
          service: 'kyc-driver-status-service',
          driverId,
          reason: blockStatus.reason
        });
        return false;
      }

      return true;

    } catch (error) {
      logError(error, 'Erro ao verificar se motorista pode trabalhar', {
        service: 'kyc-driver-status-service',
        driverId
      });
      // Em caso de erro, permitir (fail-open)
      return true;
    }
  }

  /**
   * Atualizar status no Redis
   */
  async updateRedisStatus(driverId, statusData) {
    try {
      const redisKey = `driver:${driverId}`;
      await this.redis.hset(redisKey, statusData);
      
      // Expirar após 30 dias de inatividade
      await this.redis.expire(redisKey, 30 * 24 * 60 * 60);

    } catch (error) {
      logError(error, 'Erro ao atualizar status no Redis', {
        service: 'kyc-driver-status-service',
        driverId
      });
      throw error;
    }
  }

  /**
   * Atualizar status no Firestore
   */
  async updateFirestoreStatus(driverId, statusData) {
    try {
      const firestore = admin.firestore();

      // Atualizar em drivers/{driverId}
      const driverRef = firestore.collection('drivers').doc(driverId);
      await driverRef.set(statusData, { merge: true });

      // Atualizar também em users/{driverId} (compatibilidade)
      const userRef = firestore.collection('users').doc(driverId);
      await userRef.set(statusData, { merge: true });

    } catch (error) {
      logError(error, 'Erro ao atualizar status no Firestore', {
        service: 'kyc-driver-status-service',
        driverId
      });
      throw error;
    }
  }

  /**
   * Forçar motorista offline
   */
  async forceDriverOffline(driverId) {
    try {
      const redisKey = `driver:${driverId}`;
      await this.redis.hset(redisKey, {
        isOnline: 'false',
        status: 'OFFLINE'
      });

      // Remover da geolocalização
      await this.redis.zrem('drivers:available', driverId);

      logStructured('info', 'Motorista forçado offline', {
        service: 'kyc-driver-status-service',
        driverId
      });

    } catch (error) {
      logError(error, 'Erro ao forçar motorista offline', {
        service: 'kyc-driver-status-service',
        driverId
      });
    }
  }

  /**
   * Processar resultado do onboarding KYC
   * @param {string} driverId - ID do motorista
   * @param {Object} kycResult - Resultado do KYC
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processOnboardingResult(driverId, kycResult) {
    try {
      if (kycResult.approved) {
        // Aprovado - liberar motorista
        return await this.unblockDriver(driverId, {
          similarityScore: kycResult.similarity,
          confidence: kycResult.similarity
        });
      } else {
        // Rejeitado - bloquear motorista
        const reason = kycResult.needsReview 
          ? 'KYC precisa de revisão manual (similaridade baixa)'
          : 'KYC não aprovado (similaridade insuficiente)';
        
        return await this.blockDriver(driverId, reason, {
          similarityScore: kycResult.similarity,
          confidence: kycResult.similarity
        });
      }

    } catch (error) {
      logError(error, 'Erro ao processar resultado do onboarding KYC', {
        service: 'kyc-driver-status-service',
        driverId
      });
      throw error;
    }
  }

  /**
   * Processar resultado da verificação KYC
   * @param {string} driverId - ID do motorista
   * @param {Object} verificationResult - Resultado da verificação
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processVerificationResult(driverId, verificationResult) {
    try {
      if (verificationResult.success && verificationResult.isMatch) {
        // Verificação bem-sucedida - manter liberado
        logStructured('info', 'Verificação KYC bem-sucedida, motorista continua liberado', {
          service: 'kyc-driver-status-service',
          driverId,
          confidence: verificationResult.confidence
        });

        // Atualizar última verificação
        await this.updateRedisStatus(driverId, {
          [this.statusKeys.kycLastVerification]: new Date().toISOString()
        });

        return {
          success: true,
          driverId,
          blocked: false,
          message: 'Verificação bem-sucedida'
        };

      } else {
        // Verificação falhou - bloquear motorista
        const reason = verificationResult.error || 'Verificação facial falhou';
        
        return await this.blockDriver(driverId, reason, {
          similarityScore: verificationResult.similarityScore || 0,
          confidence: verificationResult.confidence || 0,
          verificationAttempts: verificationResult.attempts || 1
        });
      }

    } catch (error) {
      logError(error, 'Erro ao processar resultado da verificação KYC', {
        service: 'kyc-driver-status-service',
        driverId
      });
      throw error;
    }
  }
}

// Singleton
const kycDriverStatusService = new KYCDriverStatusService();

module.exports = kycDriverStatusService;

