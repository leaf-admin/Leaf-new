const express = require('express');
const multer = require('multer');
const IntegratedKYCService = require('../services/IntegratedKYCService');
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
        const { userId, deviceKyc } = req.body || {};

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

        const deviceResult = await this.kycService.acceptDeviceVerification(userId, deviceKyc);
        if (!deviceResult.success) {
          return res.status(400).json(deviceResult);
        }

        return res.json({
          success: true,
          userId,
          isMatch: deviceResult.isMatch,
          similarityScore: deviceResult.similarityScore,
          confidence: deviceResult.confidence,
          threshold: deviceResult.threshold,
          processingTime: deviceResult.processingTime,
          mode: deviceResult.mode
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
          const deviceResult = await this.kycService.acceptDeviceVerification(userId, req.body.deviceKyc);

          if (!deviceResult.success) {
            return res.status(400).json(deviceResult);
          }

          return res.json({
            success: true,
            userId,
            isMatch: deviceResult.isMatch,
            similarityScore: deviceResult.similarityScore,
            confidence: deviceResult.confidence,
            threshold: deviceResult.threshold,
            processingTime: deviceResult.processingTime,
            mode: deviceResult.mode
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

        if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
          return res.status(503).json({ success: false, error: 'Firebase não configurado' });
        }

        const db = firebaseConfig.getRealtimeDB();
        const userSnap = await db.ref(`users/${userId}`).once('value');
        const user = userSnap.val() || {};

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

        const status = await this.kycService.hasValidVerification(
          userId,
          maxAgeHours ? parseInt(maxAgeHours) : 24
        );

        res.json({
          success: true,
          ...status
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
