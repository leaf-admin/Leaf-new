const Redis = require('ioredis');
const KYCFaceWorker = require('./KYCFaceWorker');
const KYCRetryService = require('./KYCRetryService');
const KYCAnalyticsService = require('./KYCAnalyticsService');
const KYCNotificationService = require('./KYCNotificationService');
const KYCVPSClient = require('./kyc-vps-client');
const FirebaseStorageService = require('./firebase-storage-service');
const DeviceFaceEmbeddingVerificationService = require('./device-face-embedding-verification-service');
const { evaluateDeviceVerificationTrust } = require('./kyc-biometric-production-policy');
const biometricJobLimiter = require('./biometric-job-limiter');
const { logStructured, logError } = require('../utils/logger');

function parseNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeEmbeddingVector(value, expectedDimension = 512) {
  if (!Array.isArray(value)) {
    const error = new Error('embedding deve ser um array numerico');
    error.code = 'FACE_EMBEDDING_INVALID_TYPE';
    throw error;
  }

  if (value.length !== expectedDimension) {
    const error = new Error(`embedding deve ter dimensao ${expectedDimension}`);
    error.code = 'FACE_EMBEDDING_INVALID_DIMENSION';
    throw error;
  }

  return value.map((item, index) => {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      const error = new Error(`embedding contem valor invalido no indice ${index}`);
      error.code = 'FACE_EMBEDDING_INVALID_VALUE';
      throw error;
    }
    return numeric;
  });
}

class IntegratedKYCService {
  constructor() {
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_DB || 0,
      password: process.env.REDIS_PASSWORD || null
    });

    this.faceWorker = new KYCFaceWorker();
    this.retryService = new KYCRetryService();
    this.analyticsService = new KYCAnalyticsService();
    this.notificationService = new KYCNotificationService();
    
    // VPS e Firebase Storage Services
    this.vpsClient = new KYCVPSClient();
    this.firebaseStorage = new FirebaseStorageService();
    this.deviceFaceEmbeddingVerificationService = new DeviceFaceEmbeddingVerificationService({
      faceClient: this.vpsClient.biometricFaceClient
    });
    this.useVPS = process.env.KYC_USE_VPS !== 'false'; // Por padrão, usar VPS se configurada
    
    // Threshold simples para KYC diário (MVP): 50%
    this.similarityThreshold = parseFloat(process.env.KYC_SIMILARITY_THRESHOLD || '0.5');
    this.initialized = false;

    this.initialize();
  }

  async initialize() {
    try {
      // Redis já conecta automaticamente com ioredis
      logStructured('info', 'Redis conectado para KYC', { service: 'integrated-kyc-service' });
      
      // Verificar se VPS está disponível
      if (this.useVPS) {
        try {
          const vpsHealth = await this.vpsClient.healthCheck();
          if (vpsHealth.status === 'healthy') {
            logStructured('info', 'VPS KYC disponível e saudável', { service: 'integrated-kyc-service' });
            this.vpsAvailable = true;
          } else {
            logStructured('warn', 'VPS KYC não está saudável, usando processamento local', { service: 'integrated-kyc-service' });
            this.vpsAvailable = false;
          }
        } catch (error) {
          logStructured('warn', 'VPS KYC não disponível, usando processamento local', { service: 'integrated-kyc-service', error: error.message });
          this.vpsAvailable = false;
        }
      } else {
        logStructured('info', 'VPS KYC desabilitada, usando processamento local', { service: 'integrated-kyc-service' });
        this.vpsAvailable = false;
      }
      
      this.initialized = true;
      logStructured('info', 'KYC Service inicializado', { service: 'integrated-kyc-service' });
      
    } catch (error) {
      logError(error, 'Erro ao inicializar KYC Service', { service: 'integrated-kyc-service' });
      throw error;
    }
  }

  async preprocessProfileImage(userId, imageBuffer) {
    try {
      if (!this.initialized) {
        throw new Error('KYC Service não inicializado');
      }

      // Validar UUID
      if (!this.isValidUUID(userId)) {
        throw new Error('userId deve ser um UUID válido');
      }

      // Processar imagem no worker
      const result = await this.faceWorker.preprocessProfileImage(userId, imageBuffer);
      
      if (result.success) {
        // Salvar encoding no Redis
        const redisKey = `face_encoding:${userId}`;
        await this.redisClient.setEx(redisKey, 86400, JSON.stringify(result.encoding));

        // Salvar metadados
        const metadataKey = `face_metadata:${userId}`;
        const metadata = {
          userId: userId,
          processedAt: Date.now(),
          encodingCount: result.encoding.descriptor.length,
          featuresCount: Object.keys(result.encoding.features).length
        };
        
        await this.redisClient.setEx(metadataKey, 86400, JSON.stringify(metadata));

        return {
          success: true,
          userId: userId,
          message: 'Imagem de perfil processada com sucesso',
          encodingSaved: true,
          confidence: result.confidence
        };
      } else {
        return result;
      }

    } catch (error) {
      logError(error, 'Erro ao processar imagem de perfil', { service: 'integrated-kyc-service', userId });
      return {
        success: false,
        error: error.message,
        userId: userId
      };
    }
  }

  async verifyDriver(userId, currentImageBuffer, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!this.initialized) {
        throw new Error('KYC Service não inicializado');
      }

      // Validar UUID - apenas aviso, não bloquear (Firebase UIDs não são UUIDs)
      if (!this.isValidUUID(userId)) {
        logStructured('warn', 'userId não é UUID válido, mas continuando', { service: 'integrated-kyc-service', userId });
      }

      // ✅ CACHE: Verificar se já existe verificação válida recente
      const cacheKey = `kyc_verification:${userId}`;
      const cachedVerification = await this.redisClient.get(cacheKey);
      
      if (cachedVerification && !options.forceRecheck) {
        const cached = JSON.parse(cachedVerification);
        const cacheAge = Date.now() - cached.timestamp;
        const cacheValidity = options.cacheValidityHours ? options.cacheValidityHours * 3600000 : 24 * 3600000; // 24h padrão
        
        // Se verificação está válida e dentro do período de cache
        if (cached.success && cached.isMatch && cacheAge < cacheValidity) {
          logStructured('info', 'Usando verificação em cache', { service: 'integrated-kyc-service', userId, cacheAgeMinutes: Math.round(cacheAge / 1000 / 60) });
          
          return {
            success: true,
            userId: userId,
            isMatch: cached.isMatch,
            similarityScore: cached.similarityScore,
            confidence: cached.confidence,
            threshold: cached.threshold,
            processingTime: 0, // Cache é instantâneo
            fromCache: true,
            cacheAge: Math.round(cacheAge / 1000), // em segundos
            timestamp: new Date(cached.timestamp).toISOString()
          };
        }
      }

      logStructured('info', 'Verificando driver', { service: 'integrated-kyc-service', userId });

      // Enviar notificação de início
      await this.notificationService.sendVerificationStarted(userId, {
        driverId: userId,
        timestamp: new Date().toISOString()
      });

      let retryResult;

      // 🚀 Usar VPS se disponível
      if (this.useVPS && this.vpsAvailable && currentImageBuffer) {
        try {
          logStructured('info', 'Usando VPS dedicada para processamento', { service: 'integrated-kyc-service', userId });
          
          // ✅ CORREÇÃO: Buscar foto âncora (foto de perfil) primeiro
          logStructured('info', 'Buscando foto âncora (foto de perfil) no Firestore', { service: 'integrated-kyc-service', userId });
          const anchorData = await this.firebaseStorage.getAnchorImage(userId);
          
          let referenceImageBuffer = null;
          let usingAnchorImage = false;
          
          if (anchorData && anchorData.url) {
            // ✅ Usar foto âncora (foto de perfil)
            logStructured('info', 'Foto âncora encontrada, usando para comparação', { service: 'integrated-kyc-service', userId });
            referenceImageBuffer = await this.firebaseStorage.downloadFile(anchorData.url);
            usingAnchorImage = true;
            logStructured('info', 'Foto âncora baixada com sucesso', { service: 'integrated-kyc-service', userId, size: referenceImageBuffer.length });
          } else {
            // Fallback: usar CNH se foto âncora não estiver disponível
            logStructured('warn', 'Foto âncora não encontrada, usando CNH como fallback', { service: 'integrated-kyc-service', userId });
            const cnhUrl = await this.firebaseStorage.getCNHUrl(userId);
            
            if (!cnhUrl) {
              logStructured('warn', 'CNH também não encontrada', { service: 'integrated-kyc-service', userId });
              throw new Error('Foto de perfil (âncora) não encontrada. Por favor, complete o onboarding KYC primeiro.');
            } else {
              // Baixar CNH do Firebase Storage
              logStructured('info', 'CNH encontrada, baixando do Firebase Storage', { service: 'integrated-kyc-service', userId, cnhUrl: cnhUrl.substring(0, 100) });
              referenceImageBuffer = await this.firebaseStorage.downloadFile(cnhUrl);
              logStructured('info', 'CNH baixada com sucesso', { service: 'integrated-kyc-service', userId, size: referenceImageBuffer.length });
            }
          }
          
          // Processar na VPS
          const vpsResult = await this.vpsClient.processKYC(
            userId,
            referenceImageBuffer,
            currentImageBuffer,
            {
              minConfidence: options.minConfidence || 0.75
            }
          );

          // Converter resultado da VPS para formato esperado
          retryResult = {
            success: vpsResult.success !== false && vpsResult.match !== false,
            result: {
              isMatch: vpsResult.match || false,
              similarityScore: vpsResult.confidence || 0,
              confidence: vpsResult.confidence || 0,
              threshold: this.similarityThreshold,
              processingTime: Date.now() - startTime
            },
            attempts: 1,
            totalTime: Date.now() - startTime,
            fromVPS: true,
            usingAnchorImage: usingAnchorImage // ✅ Indicar se usou foto âncora ou CNH
          };

          logStructured('info', 'Processamento VPS concluído', { 
            service: 'integrated-kyc-service', 
            userId, 
            isMatch: retryResult.result.isMatch, 
            confidence: retryResult.result.confidence,
            usingAnchorImage: usingAnchorImage
          });
        } catch (vpsError) {
          // Se o erro for por falta de foto âncora/CNH, propagar o erro
          if (vpsError.message && (vpsError.message.includes('não encontrada') || vpsError.message.includes('onboarding'))) {
            logError(vpsError, 'Foto âncora/CNH não encontrada, não fazendo fallback', { service: 'integrated-kyc-service', userId });
            throw vpsError;
          }
          
          logError(vpsError, 'Erro ao processar na VPS, fazendo fallback para processamento local', { service: 'integrated-kyc-service', userId });
          // Fallback para processamento local usando método que busca anchor image
          retryResult = await this.verifyWithLocalProcessing(userId, currentImageBuffer, options);
        }
      } else {
        // Processamento local (fallback ou VPS desabilitada)
        logStructured('info', 'Usando processamento local', { service: 'integrated-kyc-service', userId });
        retryResult = await this.verifyWithLocalProcessing(userId, currentImageBuffer, options);
      }

      const duration = Date.now() - startTime;

      if (retryResult.success) {
        // Registrar sucesso no analytics
        await this.analyticsService.trackVerificationAttempt(userId, {
          attempt: retryResult.attempts,
          confidence: retryResult.result.confidence,
          duration,
          success: true,
          imageQuality: options.imageQuality || 'unknown',
          deviceInfo: options.deviceInfo || {},
          location: options.location || null
        });

        // ✅ Processar bloqueio/liberação baseado no resultado
        try {
          const kycDriverStatusService = require('./kyc-driver-status-service');
          await kycDriverStatusService.processVerificationResult(userId, {
            success: retryResult.result.isMatch,
            isMatch: retryResult.result.isMatch,
            similarityScore: retryResult.result.similarityScore,
            confidence: retryResult.result.confidence,
            attempts: retryResult.attempts
          });
        } catch (statusError) {
          logError(statusError, 'Erro ao atualizar status do motorista (não bloqueia verificação)', {
            service: 'integrated-kyc-service',
            userId
          });
        }

        // Enviar notificação de sucesso
        await this.notificationService.sendVerificationSuccess(userId, {
          driverId: userId,
          confidence: retryResult.result.confidence,
          duration,
          attempts: retryResult.attempts
        });

        logStructured('info', 'Verificação bem-sucedida para driver', { service: 'integrated-kyc-service', userId });

        const verificationResult = {
          success: true,
          userId: userId,
          isMatch: retryResult.result.isMatch,
          similarityScore: retryResult.result.similarityScore,
          confidence: retryResult.result.confidence,
          threshold: retryResult.result.threshold,
          processingTime: retryResult.result.processingTime,
          attempts: retryResult.attempts,
          totalTime: retryResult.totalTime,
          timestamp: new Date().toISOString(),
          stats: retryResult.stats,
          fromCache: false,
          fromVPS: retryResult.fromVPS || false
        };

        // ✅ CACHE: Salvar verificação bem-sucedida no cache
        if (retryResult.result.isMatch) {
          const cacheValidity = options.cacheValidityHours ? options.cacheValidityHours * 3600000 : 24 * 3600000; // 24h padrão
          await this.redisClient.setEx(
            cacheKey,
            Math.floor(cacheValidity / 1000), // TTL em segundos
            JSON.stringify({
              success: true,
              isMatch: retryResult.result.isMatch,
              similarityScore: retryResult.result.similarityScore,
              confidence: retryResult.result.confidence,
              threshold: retryResult.result.threshold,
              timestamp: Date.now()
            })
          );
          logStructured('info', 'Verificação salva no cache', { service: 'integrated-kyc-service', userId, cacheValidityHours: Math.floor(cacheValidity / 1000 / 3600) });
        }

        return verificationResult;

      } else {
        // Registrar falha no analytics
        await this.analyticsService.trackVerificationAttempt(userId, {
          attempt: retryResult.attempts,
          confidence: 0,
          duration,
          success: false,
          retryReason: retryResult.retryReason,
          errorMessage: retryResult.error,
          imageQuality: options.imageQuality || 'unknown',
          deviceInfo: options.deviceInfo || {},
          location: options.location || null
        });

        // Enviar notificação de falha
        await this.notificationService.sendVerificationFailed(userId, {
          driverId: userId,
          retryCount: retryResult.attempts,
          errorMessage: retryResult.error,
          duration
        });

        logStructured('warn', 'Verificação falhou para driver', { service: 'integrated-kyc-service', userId });

        return {
          success: false,
          error: retryResult.error,
          userId: userId,
          attempts: retryResult.attempts,
          totalTime: retryResult.totalTime,
          retryReason: retryResult.retryReason
        };
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Registrar erro no analytics
      await this.analyticsService.trackVerificationAttempt(userId, {
        attempt: 1,
        confidence: 0,
        duration,
        success: false,
        errorMessage: error.message,
        imageQuality: options.imageQuality || 'unknown',
        deviceInfo: options.deviceInfo || {},
        location: options.location || null
      });

      // Enviar notificação de falha
      await this.notificationService.sendVerificationFailed(userId, {
        driverId: userId,
        errorMessage: error.message,
        duration
      });

      logError(error, 'Erro na verificação', { service: 'integrated-kyc-service', userId });
      return {
        success: false,
        error: error.message,
        userId: userId,
        duration
      };
    }
  }

  /**
   * Verificar driver usando processamento local (com foto âncora)
   * @param {string} userId - ID do usuário
   * @param {Buffer} currentImageBuffer - Buffer da imagem atual
   * @param {Object} options - Opções
   * @returns {Promise<Object>} Resultado da verificação
   */
  async verifyWithLocalProcessing(userId, currentImageBuffer, options = {}) {
    try {
      logStructured('info', 'Usando comparação biométrica server-side como fallback local', {
        service: 'integrated-kyc-service',
        userId
      });

      const serverResult = await this.verifyDriverServerSideSelfie(userId, currentImageBuffer, {
        ...options,
        requirement: options.requirement || 'LEGACY_LOCAL_PROCESSING_FALLBACK',
        skipStatusSideEffects: options.skipStatusSideEffects !== false
      });

      return {
        success: serverResult.success === true,
        result: {
          isMatch: serverResult.isMatch === true,
          similarityScore: serverResult.similarityScore || 0,
          confidence: serverResult.confidence || 0,
          threshold: serverResult.threshold || this.similarityThreshold,
          processingTime: serverResult.processingTime || 0
        },
        attempts: serverResult.attempts || 1,
        totalTime: serverResult.totalTime || serverResult.processingTime || 0,
        fromVPS: serverResult.fromVPS === true,
        mode: serverResult.mode || 'server_biometric_selfie_v1',
        provider: serverResult.provider || serverResult.comparisonProvider || 'leaf_face_compare_service',
        usingCnhFaceEmbedding: true,
        error: serverResult.error || null,
        code: serverResult.code || null
      };
    } catch (error) {
      logError(error, 'Erro no processamento local', { service: 'integrated-kyc-service', userId });
      throw error;
    }
  }

  async getFaceEncoding(userId) {
    try {
      const redisKey = `face_encoding:${userId}`;
      const encodingData = await this.redisClient.get(redisKey);
      
      if (encodingData) {
        const encoding = JSON.parse(encodingData);
        return {
          success: true,
          userId: userId,
          encoding: {
            features: encoding.features,
            metadata: encoding.metadata
          }
        };
      } else {
        return {
          success: false,
          error: 'Encoding não encontrado'
        };
      }
    } catch (error) {
      logError(error, 'Erro ao obter encoding', { service: 'integrated-kyc-service', userId });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async deleteFaceEncoding(userId) {
    try {
      const redisKey = `face_encoding:${userId}`;
      const metadataKey = `face_metadata:${userId}`;
      const verificationKey = `verification_result:${userId}`;
      
      await this.redisClient.del(redisKey);
      await this.redisClient.del(metadataKey);
      await this.redisClient.del(verificationKey);
      
      return {
        success: true,
        userId: userId,
        message: 'Encoding removido com sucesso'
      };
    } catch (error) {
      logError(error, 'Erro ao deletar encoding', { service: 'integrated-kyc-service', userId });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getStats() {
    try {
      const encodingKeys = await this.redisClient.keys('face_encoding:*');
      const metadataKeys = await this.redisClient.keys('face_metadata:*');
      const verificationKeys = await this.redisClient.keys('verification_result:*');
      
      const workerStats = this.faceWorker.getStats();
      
      return {
        success: true,
        service: 'Integrated KYC Service',
        version: '1.0.0',
        timestamp: Date.now(),
        stats: {
          totalEncodings: encodingKeys.length,
          totalMetadata: metadataKeys.length,
          totalVerifications: verificationKeys.length,
          similarityThreshold: this.similarityThreshold,
          initialized: this.initialized,
          workerStats: workerStats,
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime()
        }
      };
    } catch (error) {
      logError(error, 'Erro ao obter estatísticas', { service: 'integrated-kyc-service' });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async healthCheck() {
    try {
      const stats = await this.getStats();
      
      return {
        status: 'healthy',
        timestamp: Date.now(),
        initialized: this.initialized,
        redisConnected: true,
        workersActive: stats.stats.workerStats.activeWorkers,
        services: {
          kycService: 'active',
          redis: 'active',
          faceWorker: 'active'
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: Date.now(),
        error: error.message
      };
    }
  }

  isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Invalidar cache de verificação (usado quando há report de violação)
   */
  async invalidateVerificationCache(userId) {
    try {
      const cacheKey = `kyc_verification:${userId}`;
      await this.redisClient.del(cacheKey);
      logStructured('info', 'Cache de verificação invalidado', { service: 'integrated-kyc-service', userId });
      return { success: true };
    } catch (error) {
      logError(error, 'Erro ao invalidar cache', { service: 'integrated-kyc-service', userId });
      return { success: false, error: error.message };
    }
  }

  /**
   * Verificar se motorista tem verificação válida (sem processar)
   */
  async hasValidVerification(userId, maxAgeHours = 24) {
    try {
      const cacheKey = `kyc_verification:${userId}`;
      const cachedVerification = await this.redisClient.get(cacheKey);
      
      if (!cachedVerification) {
        return { hasValid: false, reason: 'Nenhuma verificação encontrada' };
      }

      const cached = JSON.parse(cachedVerification);
      const cacheAge = Date.now() - cached.timestamp;
      const maxAge = maxAgeHours * 3600000;

      if (cached.success && cached.isMatch && cacheAge < maxAge) {
        return {
          hasValid: true,
          age: Math.round(cacheAge / 1000), // em segundos
          confidence: cached.confidence,
          similarityScore: cached.similarityScore
        };
      }

      return { hasValid: false, reason: 'Verificação expirada ou inválida' };
    } catch (error) {
      logError(error, 'Erro ao verificar cache', { service: 'integrated-kyc-service', userId });
      return { hasValid: false, reason: error.message };
    }
  }

  /**
   * Registrar resultado de verificação calculado no dispositivo.
   * Backend atua apenas como coordenador (cache + bloqueio/liberação + auditoria).
   */
  async acceptDeviceVerification(userId, devicePayload = {}) {
    try {
      let resolvedPayload = { ...devicePayload };
      let embeddingVerification = null;

      if (this.deviceFaceEmbeddingVerificationService.isDeviceEmbeddingPayload(devicePayload)) {
        embeddingVerification = await this.deviceFaceEmbeddingVerificationService.verify(userId, devicePayload);
        resolvedPayload = {
          ...devicePayload,
          mode: embeddingVerification.mode,
          provider: embeddingVerification.provider,
          isMatch: embeddingVerification.isMatch,
          similarityScore: embeddingVerification.similarityScore,
          confidence: embeddingVerification.confidence,
          threshold: embeddingVerification.threshold,
          reviewThreshold: embeddingVerification.reviewThreshold,
          decision: embeddingVerification.decision,
          processingTime: embeddingVerification.processingTime,
          embeddingFormat: embeddingVerification.embeddingFormat,
          embeddingDimension: embeddingVerification.embeddingDimension,
          reference: embeddingVerification.reference,
          comparisonProvider: embeddingVerification.comparisonProvider
        };
      }

      const trustGate = evaluateDeviceVerificationTrust(resolvedPayload, {
        embeddingVerification
      });
      if (!trustGate.allowed) {
        const error = new Error(trustGate.message);
        error.code = trustGate.code;
        error.policy = trustGate.policy;
        throw error;
      }

      const similarityScore = Number(resolvedPayload.similarityScore || 0);
      const threshold = Number(resolvedPayload.threshold || this.similarityThreshold);
      const isMatch = Boolean(resolvedPayload.isMatch === true || similarityScore >= threshold);
      const confidence = Number(resolvedPayload.confidence || similarityScore || 0);
      const timestamp = Date.now();
      const shouldRecoverBlocked = resolvedPayload.recoverBlocked === true;
      const verificationMode = String(
        resolvedPayload.mode
        || resolvedPayload.provider
        || 'device_signature_v1'
      );

      const verificationResult = {
        success: true,
        userId,
        isMatch,
        similarityScore,
        confidence,
        threshold,
        processingTime: Number(resolvedPayload.processingTime || 0),
        attempts: 1,
        totalTime: Number(resolvedPayload.processingTime || 0),
        timestamp: new Date(timestamp).toISOString(),
        fromCache: false,
        fromVPS: false,
        mode: verificationMode,
        decision: resolvedPayload.decision || (isMatch ? 'approve' : 'reject'),
        embeddingDimension: resolvedPayload.embeddingDimension || null,
        reference: resolvedPayload.reference || null,
        comparisonProvider: resolvedPayload.comparisonProvider || null
      };

      // Fast-path: para match positivo, evitar rotina pesada de status a cada request.
      // Só dispara fluxo completo quando há mismatch ou quando o cliente pedir recuperação.
      try {
        const kycDriverStatusService = require('./kyc-driver-status-service');
        if (!isMatch) {
          await kycDriverStatusService.processVerificationResult(userId, {
            success: false,
            isMatch: false,
            similarityScore,
            confidence,
            attempts: 1,
            source: verificationMode
          });
        } else if (shouldRecoverBlocked) {
          await kycDriverStatusService.processVerificationResult(userId, {
            success: true,
            isMatch: true,
            similarityScore,
            confidence,
            attempts: 1,
            source: verificationMode
          });
        }
      } catch (statusError) {
        logError(statusError, 'Erro ao atualizar status com verificação device-first', {
          service: 'integrated-kyc-service',
          userId
        });
      }

      // Persistir cache de 24h para gate de online
      const cacheKey = `kyc_verification:${userId}`;
      const cachePayload = JSON.stringify({
        success: true,
        isMatch,
        similarityScore,
        confidence,
        threshold,
        timestamp,
        mode: verificationMode
      });
      // Persistência curta de observabilidade pode ser desabilitada para reduzir latência.
      const writeAuditKey = String(process.env.KYC_WRITE_AUDIT_KEY || 'false').toLowerCase() === 'true';
      const redisOps = this.redisClient.multi();
      redisOps.set(cacheKey, cachePayload, 'EX', 24 * 60 * 60);
      if (writeAuditKey) {
        const verificationKey = `verification_result:${userId}`;
        const verificationPayload = JSON.stringify({
          success: true,
          isMatch,
          similarityScore,
          confidence,
          threshold,
          timestamp,
          mode: verificationMode,
          decision: verificationResult.decision,
          embeddingDimension: verificationResult.embeddingDimension,
          reference: verificationResult.reference,
          comparisonProvider: verificationResult.comparisonProvider
        });
        redisOps.set(verificationKey, verificationPayload, 'EX', 24 * 60 * 60);
      }
      await redisOps.exec();

      return verificationResult;
    } catch (error) {
      logError(error, 'Erro ao aceitar verificação device-first', {
        service: 'integrated-kyc-service',
        userId
      });
      return {
        success: false,
        error: error.message,
        code: error.code || 'KYC_DEVICE_VERIFICATION_FAILED',
        userId
      };
    }
  }

  /**
   * Compara selfie atual contra o embedding facial extraído da CNH.
   * Caminho de produção para pós-AWS Liveness: o app envia a selfie bruta,
   * backend gera o embedding no microserviço e decide sem confiar no cliente.
   */
  async verifyDriverServerSideSelfie(userId, currentImageBuffer, options = {}) {
    const startedAt = Date.now();

    try {
      if (!this.initialized) {
        throw new Error('KYC Service não inicializado');
      }

      if (!Buffer.isBuffer(currentImageBuffer) || currentImageBuffer.length === 0) {
        const error = new Error('Selfie atual é obrigatória');
        error.code = 'KYC_SELFIE_IMAGE_REQUIRED';
        throw error;
      }

      const faceClient = this.vpsClient?.biometricFaceClient;
      if (!faceClient?.isConfigured?.()) {
        const error = new Error('Microserviço biométrico não configurado');
        error.code = 'BIOMETRIC_FACE_SERVICE_NOT_CONFIGURED';
        throw error;
      }

      const expectedDimension = Number.parseInt(
        options.expectedDimension || process.env.MOBILE_FACE_EMBEDDING_DIMENSION || '512',
        10
      );
      const approveThreshold = parseNumber(
        options.approveThreshold || process.env.BIOMETRIC_FACE_APPROVE_THRESHOLD,
        0.61
      );
      const reviewThreshold = parseNumber(
        options.reviewThreshold || process.env.BIOMETRIC_FACE_REVIEW_THRESHOLD,
        0.40
      );

      const reference = await this.deviceFaceEmbeddingVerificationService.getCnhFaceEmbedding(userId);
      if (!reference?.embedding) {
        const error = new Error('Embedding facial da CNH não encontrado para este motorista');
        error.code = 'CNH_FACE_EMBEDDING_NOT_FOUND';
        throw error;
      }

      const referenceEmbedding = normalizeEmbeddingVector(reference.embedding, expectedDimension);
      const limitedVerification = await biometricJobLimiter.run('server_side_selfie_embedding', async () => {
        const currentEmbeddingPayload = await faceClient.generateEmbedding(currentImageBuffer, {
          filename: options.filename || 'driver-selfie.jpg',
          contentType: options.contentType || 'image/jpeg'
        });
        const currentEmbedding = normalizeEmbeddingVector(
          currentEmbeddingPayload?.embedding,
          expectedDimension
        );
        const comparison = await faceClient.compareEmbeddings(referenceEmbedding, currentEmbedding, {
          approveThreshold,
          reviewThreshold
        });
        return {
          currentEmbeddingPayload,
          comparison
        };
      });
      const { currentEmbeddingPayload, comparison } = limitedVerification.result;
      const queueWaitMs = limitedVerification.waitMs;

      const score = Number(comparison?.cosine_similarity || 0);
      const decision = comparison?.decision || (
        score >= approveThreshold ? 'approve' : (score >= reviewThreshold ? 'review' : 'reject')
      );
      const isMatch = decision === 'approve';
      const confidence = score;
      const timestamp = Date.now();
      const verificationMode = 'server_biometric_selfie_v1';

      const skipStatusSideEffects = options.skipStatusSideEffects === true
        || options.requirement === 'IDENTITY_REVERIFICATION';

      try {
        const kycDriverStatusService = require('./kyc-driver-status-service');
        if (!isMatch && !skipStatusSideEffects) {
          await kycDriverStatusService.processVerificationResult(userId, {
            success: false,
            isMatch: false,
            similarityScore: score,
            confidence,
            attempts: 1,
            source: verificationMode
          });
        } else if (isMatch && !skipStatusSideEffects && options.recoverBlocked === true) {
          await kycDriverStatusService.processVerificationResult(userId, {
            success: true,
            isMatch: true,
            similarityScore: score,
            confidence,
            attempts: 1,
            source: verificationMode
          });
        }
      } catch (statusError) {
        logError(statusError, 'Erro ao atualizar status com verificação server-side', {
          service: 'integrated-kyc-service',
          userId
        });
      }

      const verificationResult = {
        success: true,
        userId,
        isMatch,
        needsReview: decision === 'review',
        similarityScore: score,
        confidence,
        threshold: approveThreshold,
        reviewThreshold,
        decision,
        processingTime: Date.now() - startedAt,
        queueWaitMs,
        attempts: 1,
        totalTime: Date.now() - startedAt,
        timestamp: new Date(timestamp).toISOString(),
        fromCache: false,
        fromVPS: true,
        mode: verificationMode,
        provider: 'leaf_face_compare_service',
        comparisonProvider: comparison?.provider || 'leaf_face_compare_service',
        embeddingDimension: expectedDimension,
        reference: {
          source: reference.source || 'cnh_face_embedding',
          model: reference.model || null,
          createdAt: reference.createdAt || null,
          submissionId: reference.submissionId || null
        },
        current: {
          model: currentEmbeddingPayload?.model || null,
          faceCount: currentEmbeddingPayload?.face_count || null,
          selectedFace: currentEmbeddingPayload?.selected_face || null
        }
      };

      if (isMatch && options.writeVerificationCache !== false) {
        const cacheKey = `kyc_verification:${userId}`;
        const cachePayload = JSON.stringify({
          success: true,
          isMatch,
          similarityScore: score,
          confidence,
          threshold: approveThreshold,
          timestamp,
          mode: verificationMode
        });
        const writeAuditKey = String(process.env.KYC_WRITE_AUDIT_KEY || 'false').toLowerCase() === 'true';
        const redisOps = this.redisClient.multi();
        redisOps.set(cacheKey, cachePayload, 'EX', 24 * 60 * 60);
        if (writeAuditKey) {
          redisOps.set(`verification_result:${userId}`, JSON.stringify({
            ...verificationResult,
            current: {
              model: verificationResult.current.model,
              faceCount: verificationResult.current.faceCount
            }
          }), 'EX', 24 * 60 * 60);
        }
        await redisOps.exec();
      }

      logStructured('info', 'Selfie server-side comparada contra CNH', {
        service: 'integrated-kyc-service',
        userId,
        decision,
        score,
        queueWaitMs,
        durationMs: Date.now() - startedAt
      });

      return verificationResult;
    } catch (error) {
      logError(error, 'Erro ao verificar selfie server-side', {
        service: 'integrated-kyc-service',
        userId
      });
      return {
        success: false,
        error: error.message,
        code: error.code || 'KYC_SERVER_SIDE_SELFIE_FAILED',
        userId
      };
    }
  }

  // Métodos para Analytics
  async getAnalytics(driverId = null, days = 7) {
    try {
      if (driverId) {
        return await this.analyticsService.getDriverMetrics(driverId, days);
      } else {
        return await this.analyticsService.getGlobalMetrics(days);
      }
    } catch (error) {
      logError(error, 'Erro ao obter analytics', { service: 'integrated-kyc-service' });
      throw error;
    }
  }

  async getDailyAnalytics(days = 7) {
    try {
      return await this.analyticsService.getDailyMetrics(days);
    } catch (error) {
      logError(error, 'Erro ao obter analytics diários', { service: 'integrated-kyc-service' });
      throw error;
    }
  }

  async getRealtimeAnalytics(hours = 1) {
    try {
      return await this.analyticsService.getRealtimeMetrics(hours);
    } catch (error) {
      logError(error, 'Erro ao obter analytics em tempo real', { service: 'integrated-kyc-service' });
      throw error;
    }
  }

  async generateAnalyticsReport(options = {}) {
    try {
      return await this.analyticsService.generateAnalyticsReport(options);
    } catch (error) {
      logError(error, 'Erro ao gerar relatório de analytics', { service: 'integrated-kyc-service' });
      throw error;
    }
  }

  // Métodos para Notificações
  async sendLivenessCheckNotification(driverId, data = {}) {
    try {
      await this.notificationService.sendLivenessCheck(driverId, data);
    } catch (error) {
      logError(error, 'Erro ao enviar notificação de liveness', { service: 'integrated-kyc-service', userId });
    }
  }

  async sendRetryNotification(driverId, data = {}) {
    try {
      await this.notificationService.sendRetryAttempt(driverId, data);
    } catch (error) {
      logError(error, 'Erro ao enviar notificação de retry', { service: 'integrated-kyc-service', userId });
    }
  }

  async sendCompletionNotification(driverId, data = {}) {
    try {
      await this.notificationService.sendVerificationCompleted(driverId, data);
    } catch (error) {
      logError(error, 'Erro ao enviar notificação de conclusão', { service: 'integrated-kyc-service', userId });
    }
  }

  // Métodos para Retry Service
  async getRetryStats(driverId = null) {
    try {
      if (driverId) {
        return this.retryService.getDriverStats(driverId);
      } else {
        return this.retryService.getGlobalStats();
      }
    } catch (error) {
      logError(error, 'Erro ao obter stats de retry', { service: 'integrated-kyc-service' });
      throw error;
    }
  }

  async configureRetry(options) {
    try {
      this.retryService.configureRetry(options);
    } catch (error) {
      logError(error, 'Erro ao configurar retry', { service: 'integrated-kyc-service', userId });
      throw error;
    }
  }

  // Método para limpeza de dados
  async cleanupOldData() {
    try {
      await this.analyticsService.cleanupOldData();
      logStructured('info', 'Limpeza de dados antigos concluída', { service: 'integrated-kyc-service', deletedCount });
    } catch (error) {
      logError(error, 'Erro na limpeza de dados', { service: 'integrated-kyc-service' });
    }
  }

  async cleanup() {
    try {
      await this.faceWorker.cleanup();
      await this.redisClient.quit();
      logStructured('info', 'KYC Service limpo', { service: 'integrated-kyc-service' });
    } catch (error) {
      logError(error, 'Erro durante limpeza', { service: 'integrated-kyc-service' });
    }
  }
}

module.exports = IntegratedKYCService;
