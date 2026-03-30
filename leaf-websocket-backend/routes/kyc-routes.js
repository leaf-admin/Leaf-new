const express = require('express');
const multer = require('multer');
const IntegratedKYCService = require('../services/IntegratedKYCService');
const AwsFaceLivenessService = require('../services/aws-face-liveness-service');
const kycPolicyService = require('../services/kyc-policy-service');
const { logStructured, logError } = require('../utils/logger');
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'kyc-routes-routes' });
}

class KYCRoutes {
  constructor() {
    this.router = express.Router();
    this.kycService = new IntegratedKYCService();
    this.awsLivenessService = new AwsFaceLivenessService();
    this.initializeUpload();
    this.initializeRoutes();
  }

  initializeUpload() {
    // Configurar multer para upload de imagens
    // ✅ CORREÇÃO: Aumentar limite de tamanho para uploads de CNH
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 5MB)
        files: 1
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Arquivo deve ser uma imagem'), false);
        }
      }
    });
  }

  initializeRoutes() {
    // Middleware para verificar inicialização
    this.router.use(async (req, res, next) => {
      if (!this.kycService.initialized) {
        return res.status(503).json({
          success: false,
          error: 'KYC Service ainda não inicializado',
          retryAfter: 5
        });
      }
      next();
    });

    this.router.get('/liveness/provider', async (_req, res) => {
      try {
        return res.json({
          success: true,
          provider: this.awsLivenessService.getProviderName(),
          config: this.awsLivenessService.getConfigSummary()
        });
      } catch (error) {
        logError(error, 'Erro ao consultar provider de liveness', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    this.router.post('/liveness/aws/session', async (req, res) => {
      try {
        const { userId, challengeId, requirement } = req.body || {};
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }

        const session = await this.awsLivenessService.createSession({
          userId,
          challengeId: typeof challengeId === 'string' ? challengeId : null,
          requirement: typeof requirement === 'string' ? requirement : null
        });

        return res.status(201).json({
          success: true,
          ...session
        });
      } catch (error) {
        const isDisabled = error?.code === 'AWS_LIVENESS_DISABLED';
        const statusCode = isDisabled ? 503 : 500;
        logError(error, 'Erro ao criar sessão AWS liveness', { service: 'kyc-routes-routes' });
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          code: error.code || 'KYC_AWS_LIVENESS_SESSION_ERROR'
        });
      }
    });

    this.router.get('/liveness/aws/session/:sessionId', async (req, res) => {
      try {
        const { sessionId } = req.params;
        const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
        const result = await this.awsLivenessService.getSessionResult({
          sessionId,
          userId
        });

        return res.json({
          success: true,
          ...result
        });
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_RESULT_ERROR';
        let statusCode = 500;
        if (code === 'AWS_LIVENESS_DISABLED') statusCode = 503;
        if (code === 'AWS_LIVENESS_SESSION_ID_REQUIRED') statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'ResourceNotFoundException' || code === 'SessionNotFoundException') statusCode = 404;
        if (code === 'ValidationException') statusCode = 400;

        logError(error, 'Erro ao consultar resultado AWS liveness', { service: 'kyc-routes-routes' });
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          code
        });
      }
    });

    this.router.get('/liveness/aws/credentials', async (req, res) => {
      try {
        const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }
        const credentialsResult = await this.awsLivenessService.issueTemporaryCredentials({ userId });

        return res.json({
          success: true,
          provider: credentialsResult.provider,
          region: credentialsResult.region,
          source: credentialsResult.source,
          credentials: credentialsResult.credentials
        });
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_CREDENTIALS_ERROR';
        let statusCode = 500;
        if (code === 'AWS_LIVENESS_DISABLED' || code === 'AWS_LIVENESS_CREDENTIALS_DISABLED') statusCode = 503;
        if (code === 'AWS_LIVENESS_ASSUME_ROLE_MISSING') statusCode = 503;
        if (code === 'AccessDenied' || code === 'AccessDeniedException') statusCode = 403;
        if (code === 'ValidationError' || code === 'ValidationException') statusCode = 400;

        logError(error, 'Erro ao emitir credenciais AWS liveness', { service: 'kyc-routes-routes' });
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          code
        });
      }
    });

    // Upload de imagem de perfil
    this.router.post('/upload-profile', this.upload.single('image'), async (req, res) => {
      try {
        const { userId } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Imagem é obrigatória'
          });
        }

        const result = await this.kycService.preprocessProfileImage(
          userId,
          req.file.buffer
        );

        if (result.success) {
          res.json({
            success: true,
            userId: userId,
            message: 'Imagem de perfil processada com sucesso',
            encodingSaved: true,
            confidence: result.confidence
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        logError(error, 'Erro no upload de perfil:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Verificação facial
    this.router.post('/verify-driver/device', async (req, res) => {
      try {
        const { userId, deviceKyc, challengeId, requirement } = req.body || {};

        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!deviceKyc || typeof deviceKyc !== 'object') {
          return res.status(400).json({
            success: false,
            error: 'deviceKyc é obrigatório'
          });
        }

        let challenge = null;
        let effectiveRequirement = requirement || null;
        if (challengeId) {
          challenge = await kycPolicyService.getStepUpChallenge(challengeId, userId);
          if (!challenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = effectiveRequirement || challenge.requirement || 'VERIFY_REQUIRED';
        }

        const firstAccessPolicy = await kycPolicyService.requiresFirstAccessLiveness(userId);
        const firstAccessLivenessRequired = !challengeId && firstAccessPolicy.required === true;
        if (!effectiveRequirement && firstAccessLivenessRequired) {
          effectiveRequirement = 'LIVENESS_REQUIRED';
        }

        let verificationPayload = {
          ...deviceKyc,
          recoverBlocked:
            deviceKyc.recoverBlocked === true
            || Boolean(challengeId)
            || firstAccessLivenessRequired
        };

        const awsSessionId = deviceKyc?.aws?.sessionId || deviceKyc?.awsSessionId || null;
        if (awsSessionId) {
          try {
            const awsResult = await this.awsLivenessService.getSessionResult({ sessionId: awsSessionId, userId });
            if (!awsResult.completed) {
              return res.status(202).json({
                success: false,
                code: 'KYC_AWS_LIVENESS_PENDING',
                error: 'Sessão AWS de liveness ainda está em processamento',
                provider: awsResult.provider,
                sessionId: awsResult.sessionId,
                status: awsResult.status
              });
            }
            verificationPayload = this.awsLivenessService.toDevicePayload(awsResult, verificationPayload);
          } catch (awsError) {
            const awsCode = awsError?.code || awsError?.name || 'KYC_AWS_LIVENESS_FAILED';
            const awsStatus = awsCode === 'AWS_LIVENESS_DISABLED'
              ? 503
              : (awsCode === 'ResourceNotFoundException' ? 404 : 400);
            return res.status(awsStatus).json({
              success: false,
              error: awsError.message,
              code: awsCode
            });
          }
        }

        if (
          effectiveRequirement === 'LIVENESS_REQUIRED'
          && !kycPolicyService.isLivenessSatisfied(verificationPayload)
        ) {
          return res.status(412).json({
            success: false,
            error: 'Liveness obrigatório para concluir esta verificação',
            code: 'KYC_LIVENESS_REQUIRED',
            requirement: effectiveRequirement
          });
        }

        const deviceResult = await this.kycService.acceptDeviceVerification(userId, verificationPayload);
        if (!deviceResult.success) {
          return res.status(400).json(deviceResult);
        }

        if ((challengeId || firstAccessLivenessRequired) && !deviceResult.isMatch) {
          return res.status(403).json({
            success: false,
            error: 'Verificação facial não aprovada para este desafio',
            code: 'KYC_CHALLENGE_NOT_PASSED',
            userId,
            isMatch: false,
            similarityScore: deviceResult.similarityScore,
            confidence: deviceResult.confidence
          });
        }

        if (challengeId && deviceResult.isMatch) {
          const challengeResolution = await kycPolicyService.resolveStepUpChallenge({
            challengeId,
            driverId: userId,
            requirement: effectiveRequirement,
            verificationPayload: {
              ...verificationPayload,
              ...deviceResult
            }
          });

          if (!challengeResolution.success) {
            return res.status(400).json(challengeResolution);
          }
        }

        if (deviceResult.isMatch) {
          await kycPolicyService.recordVerificationSuccess(userId, {
            source: challengeId ? 'stepup_challenge' : 'device_verify',
            markFirstAccess: firstAccessLivenessRequired,
            clearReverify: true
          });
        }

        return res.json({
          success: true,
          userId,
          isMatch: deviceResult.isMatch,
          similarityScore: deviceResult.similarityScore,
          confidence: deviceResult.confidence,
          threshold: deviceResult.threshold,
          processingTime: deviceResult.processingTime,
          mode: deviceResult.mode,
          requirement: effectiveRequirement || 'VERIFY_REQUIRED',
          challengeId: challengeId || null
        });
      } catch (error) {
        logError(error, 'Erro na verificação device-first:', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    this.router.post('/verify-driver', this.upload.single('currentImage'), async (req, res) => {
      try {
        const { userId, forceRecheck, cacheValidityHours } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        // Device-first: app já envia resultado calculado localmente
        if (req.body && req.body.deviceKyc) {
          const challengeId = req.body.challengeId || null;
          let effectiveRequirement = req.body.requirement || null;
          if (challengeId) {
            const challenge = await kycPolicyService.getStepUpChallenge(challengeId, userId);
            if (!challenge) {
              return res.status(404).json({
                success: false,
                error: 'Challenge KYC não encontrado ou expirado',
                code: 'KYC_CHALLENGE_NOT_FOUND'
              });
            }
            effectiveRequirement = effectiveRequirement || challenge.requirement || 'VERIFY_REQUIRED';
          }

          let verificationPayload = {
            ...req.body.deviceKyc,
            recoverBlocked:
              req.body.deviceKyc.recoverBlocked === true
              || Boolean(challengeId)
          };

          const awsSessionId = req.body?.deviceKyc?.aws?.sessionId || req.body?.deviceKyc?.awsSessionId || null;
          if (awsSessionId) {
            try {
              const awsResult = await this.awsLivenessService.getSessionResult({ sessionId: awsSessionId, userId });
              if (!awsResult.completed) {
                return res.status(202).json({
                  success: false,
                  code: 'KYC_AWS_LIVENESS_PENDING',
                  error: 'Sessão AWS de liveness ainda está em processamento',
                  provider: awsResult.provider,
                  sessionId: awsResult.sessionId,
                  status: awsResult.status
                });
              }
              verificationPayload = this.awsLivenessService.toDevicePayload(awsResult, verificationPayload);
            } catch (awsError) {
              const awsCode = awsError?.code || awsError?.name || 'KYC_AWS_LIVENESS_FAILED';
              const awsStatus = awsCode === 'AWS_LIVENESS_DISABLED'
                ? 503
                : (awsCode === 'ResourceNotFoundException' ? 404 : 400);
              return res.status(awsStatus).json({
                success: false,
                error: awsError.message,
                code: awsCode
              });
            }
          }

          if (
            effectiveRequirement === 'LIVENESS_REQUIRED'
            && !kycPolicyService.isLivenessSatisfied(verificationPayload)
          ) {
            return res.status(412).json({
              success: false,
              error: 'Liveness obrigatório para concluir esta verificação',
              code: 'KYC_LIVENESS_REQUIRED',
              requirement: effectiveRequirement
            });
          }

          const deviceResult = await this.kycService.acceptDeviceVerification(userId, verificationPayload);

          if (!deviceResult.success) {
            return res.status(400).json(deviceResult);
          }

          if (challengeId && !deviceResult.isMatch) {
            return res.status(403).json({
              success: false,
              error: 'Verificação facial não aprovada para este desafio',
              code: 'KYC_CHALLENGE_NOT_PASSED',
              userId,
              isMatch: false,
              similarityScore: deviceResult.similarityScore,
              confidence: deviceResult.confidence
            });
          }

          if (challengeId && deviceResult.isMatch) {
            const challengeResolution = await kycPolicyService.resolveStepUpChallenge({
              challengeId,
              driverId: userId,
              requirement: effectiveRequirement,
              verificationPayload: {
                ...verificationPayload,
                ...deviceResult
              }
            });

            if (!challengeResolution.success) {
              return res.status(400).json(challengeResolution);
            }
          }

          if (deviceResult.isMatch) {
            await kycPolicyService.recordVerificationSuccess(userId, {
              source: challengeId ? 'stepup_challenge' : 'device_verify',
              clearReverify: true
            });
          }

          return res.json({
            success: true,
            userId,
            isMatch: deviceResult.isMatch,
            similarityScore: deviceResult.similarityScore,
            confidence: deviceResult.confidence,
            threshold: deviceResult.threshold,
            processingTime: deviceResult.processingTime,
            mode: deviceResult.mode,
            requirement: effectiveRequirement || 'VERIFY_REQUIRED',
            challengeId
          });
        }

        if (!req.file && !forceRecheck) {
          return res.status(400).json({
            success: false,
            error: 'Imagem atual é obrigatória'
          });
        }

        const result = await this.kycService.verifyDriver(
          userId,
          req.file ? req.file.buffer : null,
          {
            forceRecheck: forceRecheck === 'true' || forceRecheck === true,
            cacheValidityHours: cacheValidityHours ? parseInt(cacheValidityHours) : 24
          }
        );

        if (result.success) {
          if (result.isMatch) {
            await kycPolicyService.recordVerificationSuccess(userId, {
              source: 'backend_verify',
              clearReverify: true
            });
          }

          res.json({
            success: true,
            userId: userId,
            isMatch: result.isMatch,
            similarityScore: result.similarityScore,
            confidence: result.confidence,
            threshold: result.threshold,
            processingTime: result.processingTime
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        logError(error, 'Erro na verificação:', { service: 'kyc-routes-routes' });
        
        // Se o erro for por falta de CNH, retornar erro 400 com mensagem específica
        if (error.message && error.message.includes('CNH não encontrada')) {
          return res.status(400).json({
            success: false,
            error: error.message,
            details: 'CNH não encontrada no Firebase Storage'
          });
        }
        
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Obter assinatura âncora device-first (fallback quando app não tiver cache local)
    this.router.get('/device-anchor/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({ success: false, error: 'userId inválido' });
        }

        if (!firebaseConfig || !firebaseConfig.getFromRealtimeDB) {
          return res.status(503).json({ success: false, error: 'Firebase não configurado' });
        }

        const user = (await firebaseConfig.getFromRealtimeDB(`users/${userId}`)) || {};

        res.json({
          success: true,
          userId,
          anchorSignature: user.kycDeviceAnchorSignature || null,
          anchorAlgorithm: user.kycDeviceAnchorAlgorithm || null,
          anchorUpdatedAt: user.kycDeviceAnchorUpdatedAt || null
        });
      } catch (error) {
        logError(error, 'Erro ao buscar assinatura âncora device-first', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Consultar challenge KYC ativo (usado em step-up de saque)
    this.router.get('/stepup-challenge/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const challengeId = req.query.challengeId || null;

        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const challenge = await kycPolicyService.getStepUpChallenge(challengeId, userId);
        if (!challenge) {
          return res.status(404).json({
            success: false,
            error: 'Nenhum challenge KYC ativo',
            code: 'KYC_CHALLENGE_NOT_FOUND'
          });
        }

        return res.json({
          success: true,
          challenge
        });
      } catch (error) {
        logError(error, 'Erro ao buscar challenge KYC ativo', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Obter encoding facial
    this.router.get('/encoding/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        
        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const encoding = await this.kycService.getFaceEncoding(userId);
        
        if (encoding.success) {
          res.json(encoding);
        } else {
          res.status(404).json(encoding);
        }

      } catch (error) {
        logError(error, 'Erro ao obter encoding:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Deletar encoding facial
    this.router.delete('/encoding/:userId', async (req, res) => {
      try {
        const { userId } = req.params;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const result = await this.kycService.deleteFaceEncoding(userId);
        
        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }

      } catch (error) {
        logError(error, 'Erro ao deletar encoding:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Estatísticas do serviço
    this.router.get('/stats', async (req, res) => {
      try {
        const stats = await this.kycService.getStats();
        res.json(stats);

      } catch (error) {
        logError(error, 'Erro ao obter estatísticas:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Health check
    this.router.get('/health', async (req, res) => {
      try {
        const health = await this.kycService.healthCheck();
        res.json(health);

      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          timestamp: Date.now(),
          error: error.message
        });
      }
    });

    // Verificar se motorista tem verificação válida (sem processar)
    this.router.get('/verification-status/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const { maxAgeHours } = req.query;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const [status, firstAccessPolicy, activeChallenge] = await Promise.all([
          this.kycService.hasValidVerification(
            userId,
            maxAgeHours ? parseInt(maxAgeHours) : 24
          ),
          kycPolicyService.requiresFirstAccessLiveness(userId),
          kycPolicyService.getStepUpChallenge(null, userId)
        ]);

        res.json({
          success: true,
          ...status,
          firstAccessLivenessRequired: Boolean(firstAccessPolicy?.required),
          firstAccessReason: firstAccessPolicy?.reason || null,
          activeStepUpChallenge: activeChallenge
            ? {
                challengeId: activeChallenge.challengeId,
                requirement: activeChallenge.requirement,
                expiresAt: activeChallenge.expiresAt,
                source: activeChallenge.source
              }
            : null
        });

      } catch (error) {
        logError(error, 'Erro ao verificar status:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Invalidar cache de verificação (usado quando há report de violação)
    this.router.post('/invalidate-cache/:userId', async (req, res) => {
      try {
        const { userId } = req.params;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const result = await this.kycService.invalidateVerificationCache(userId);
        res.json(result);

      } catch (error) {
        logError(error, 'Erro ao invalidar cache:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Middleware de tratamento de erros
    this.router.use((error, req, res, next) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: 'Arquivo muito grande. Máximo 5MB.'
          });
        }
      }
      
      logError(error, 'Erro não tratado:', { service: 'kyc-routes-routes' });
      res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      });
    });
  }

  getRouter() {
    return this.router;
  }
}

module.exports = new KYCRoutes();
