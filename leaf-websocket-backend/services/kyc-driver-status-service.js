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
const {
  commitDriverOnlineProjection
} = require('./driver-online-projection-service');

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

  normalizeManualAuditEvidence(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') return { ref: item };
          if (item && typeof item === 'object') return item;
          return null;
        })
        .filter(Boolean);
    }

    if (value && typeof value === 'object') {
      return [value];
    }

    if (typeof value === 'string' && value.trim()) {
      return [{ ref: value.trim() }];
    }

    return [];
  }

  normalizeManualKycAudit(driverId, action, options = {}) {
    const audit = options.audit || options.auditTrail || {};
    const actorId = String(
      audit.actorId ||
        options.actorId ||
        audit.actor?.id ||
        ''
    ).trim();
    const actorRole = String(
      audit.actorRole ||
        options.actorRole ||
        audit.actor?.role ||
        'admin'
    ).trim();
    const reason = String(
      audit.reason ||
        options.reason ||
        options.reviewReason ||
        options.justification ||
        ''
    ).trim();
    const provenance = String(
      audit.provenance ||
        options.provenance ||
        options.source ||
        ''
    ).trim();
    const evidence = this.normalizeManualAuditEvidence(
      audit.evidence ||
        audit.evidenceRefs ||
        options.evidence ||
        options.evidenceRefs
    );

    if (!actorId || !actorRole || !reason || !provenance || evidence.length === 0) {
      const error = new Error('KYC manual override exige actorId, actorRole, reason, provenance e evidence.');
      error.code = `${action.toUpperCase()}_AUDIT_REQUIRED`;
      throw error;
    }

    return {
      action,
      driverId,
      actorId,
      actorRole,
      reason,
      provenance,
      evidence,
      createdAt: new Date().toISOString()
    };
  }

  async getKycPreviousState(driverId) {
    const firestore = admin.firestore();
    const [driverDoc, userDoc] = await Promise.all([
      firestore.collection('drivers').doc(driverId).get(),
      firestore.collection('users').doc(driverId).get()
    ]);
    const driverData = driverDoc.exists ? (driverDoc.data() || {}) : {};
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    const source = userDoc.exists ? userData : driverData;

    return {
      exists: Boolean(driverDoc.exists || userDoc.exists),
      kycStatus: source.kycStatus || source.kyc_status || null,
      kycBlocked: source.kycBlocked ?? source.kyc_blocked ?? null,
      kycBlockedReason: source.kycBlockedReason || source.kyc_blocked_reason || null,
      kycReverifyRequired: source.kycReverifyRequired ?? source.kyc_reverify_required ?? null
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

      // 1. Aplicar bloqueio KYC e revogação operacional no mesmo commit Redis.
      await this.forceDriverOffline(driverId, {
        [this.statusKeys.kycStatus]: 'blocked',
        [this.statusKeys.kycBlocked]: 'true',
        [this.statusKeys.kycBlockedAt]: timestamp,
        [this.statusKeys.kycBlockedReason]: reason,
        [this.statusKeys.kycLastVerification]: timestamp
      });

      // 2. Atualizar Firestore
      await this.updateFirestoreStatus(driverId, {
        kycStatus: 'blocked',
        kycBlocked: true,
        kycBlockedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycBlockedReason: reason,
        kycLastVerification: admin.firestore.FieldValue.serverTimestamp(),
        ...blockData
      });

      // 3. Enviar notificação
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
      let manualAudit = null;
      if (options.manualOverride === true) {
        manualAudit = this.normalizeManualKycAudit(driverId, 'kyc_unblock', options);
        manualAudit.previousState = await this.getKycPreviousState(driverId);
        manualAudit.nextState = {
          kycStatus: 'approved',
          kycBlocked: false
        };
      }

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
        confidence: options.confidence || null,
        ...(manualAudit ? {
          kycManualOverrideAudit: manualAudit,
          kycManualOverrideAt: admin.firestore.FieldValue.serverTimestamp(),
          kycManualOverrideActorId: manualAudit.actorId,
          kycManualOverrideReason: manualAudit.reason
        } : {})
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
      return {
        blocked: true,
        reason: 'KYC indisponivel para validacao operacional',
        code: 'KYC_STATUS_UNAVAILABLE',
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
      return false;
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
  async forceDriverOffline(driverId, statusFields = {}) {
    const checkedAt = new Date().toISOString();
    try {
      await commitDriverOnlineProjection(this.redis, {
        driverId,
        eligibleGeoKey: process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
        isOnline: false,
        dispatchEligible: false,
        ttlSeconds: 30 * 24 * 60 * 60,
        fields: {
          ...statusFields,
          isOnline: 'false',
          status: 'OFFLINE',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'KYC_BLOCKED',
          dispatchEligibilityCheckedAt: checkedAt,
          updatedAt: checkedAt
        }
      });
    } catch (error) {
      logError(error, 'Erro ao forçar motorista offline', {
        service: 'kyc-driver-status-service',
        driverId
      });
      throw error;
    }

    // Índice legado sem leitores no runtime; a autoridade operacional já foi
    // confirmada atomicamente acima e esta remoção permanece melhor esforço.
    await this.redis.zrem('drivers:available', driverId).catch((error) => {
      logStructured('warn', 'Falha ao limpar índice legado de motoristas disponíveis', {
        service: 'kyc-driver-status-service',
        driverId,
        error: error.message
      });
    });

    logStructured('info', 'Motorista forçado offline', {
      service: 'kyc-driver-status-service',
      driverId
    });
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
        // Verificação bem-sucedida - manter liberado.
        // Fast-path: não persiste/loga em toda chamada para evitar latência alta sob pico.
        if (String(process.env.KYC_LOG_SUCCESS_VERBOSE || 'false').toLowerCase() === 'true') {
          logStructured('debug', 'Verificação KYC bem-sucedida', {
            service: 'kyc-driver-status-service',
            driverId,
            confidence: verificationResult.confidence
          });
        }

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
