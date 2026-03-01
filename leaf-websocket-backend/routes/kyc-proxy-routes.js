const express = require('express');
const multer = require('multer');
const KYCClient = require('../services/KYCClient');
const { logStructured, logError } = require('../utils/logger');

class KYCProxyRoutes {
  constructor() {
    this.router = express.Router();
    this.kycClient = new KYCClient();
    this.initializeUpload();
    this.initializeRoutes();
  }

  initializeUpload() {
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
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
    // Middleware para verificar disponibilidade do serviço KYC
    this.router.use(async (req, res, next) => {
      const isAvailable = await this.kycClient.isServiceAvailable();
      if (!isAvailable) {
        return res.status(503).json({
          success: false,
          error: 'Serviço KYC temporariamente indisponível',
          retryAfter: 30
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

        const result = await this.kycClient.uploadProfileImage(userId, req.file.buffer);
        res.json(result);

      } catch (error) {
        logError(error, 'Erro no proxy de upload:', { service: 'kyc-proxy-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Verificação facial
    this.router.post('/verify-driver', this.upload.single('currentImage'), async (req, res) => {
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
            error: 'Imagem atual é obrigatória'
          });
        }

        const result = await this.kycClient.verifyDriver(userId, req.file.buffer);
        res.json(result);

      } catch (error) {
        logError(error, 'Erro no proxy de verificação:', { service: 'kyc-proxy-routes-routes' });
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
        const result = await this.kycClient.getFaceEncoding(userId);
        res.json(result);
      } catch (error) {
        logError(error, 'Erro no proxy de encoding:', { service: 'kyc-proxy-routes-routes' });
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
        const result = await this.kycClient.deleteFaceEncoding(userId);
        res.json(result);
      } catch (error) {
        logError(error, 'Erro no proxy de delete:', { service: 'kyc-proxy-routes-routes' });
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
        const result = await this.kycClient.getStats();
        res.json(result);
      } catch (error) {
        logError(error, 'Erro no proxy de stats:', { service: 'kyc-proxy-routes-routes' });
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
        const result = await this.kycClient.healthCheck();
        res.json(result);
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: error.message
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
      
      logError(error, 'Erro não tratado no proxy KYC:', { service: 'kyc-proxy-routes-routes' });
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

module.exports = new KYCProxyRoutes();

