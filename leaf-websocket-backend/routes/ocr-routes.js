/**
 * Rotas de OCR para extração de dados de documentos
 * Endpoints: /api/ocr/cnh e /api/ocr/vehicle
 */

const express = require('express');
const multer = require('multer');
const ocrService = require('../services/ocr-service');
const { logger } = require('../utils/logger');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// ✅ Middleware de debug para todas as requisições OCR
router.use((req, res, next) => {
  logger.info(`📥 [OCR Router] Requisição recebida: ${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    contentType: req.headers['content-type'],
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
  });
  next();
});

// Configurar multer para upload de imagens e PDFs
// ✅ CORREÇÃO: Aumentar limite de tamanho para uploads de CNH
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 10MB)
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Aceitar imagens e PDFs
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Arquivo deve ser uma imagem (JPG, PNG, etc) ou PDF'), false);
    }
  }
});

// Rate limiter para OCR (evitar abuso)
const ocrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Máximo 10 requisições por IP a cada 15 minutos
  message: {
    error: 'Muitas requisições de OCR. Tente novamente em alguns minutos.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit excedido - OCR', {
      ip: req.ip,
      endpoint: req.path,
      userAgent: req.headers['user-agent']
    });
    res.status(429).json({
      success: false,
      error: 'Muitas requisições de OCR. Tente novamente em alguns minutos.',
      retryAfter: 900
    });
  }
});

/**
 * POST /api/ocr/cnh
 * Extrai dados da CNH (Carteira Nacional de Habilitação)
 * 
 * Body (multipart/form-data):
 * - image: arquivo de imagem da CNH
 * - userId: (opcional) ID do usuário para rastreamento
 */
router.post('/cnh', ocrLimiter, upload.single('image'), async (req, res) => {
  try {
    // Validar arquivo
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Imagem da CNH é obrigatória'
      });
    }

    // Validar inicialização do serviço
    if (!ocrService.initialized) {
      return res.status(503).json({
        success: false,
        error: 'Serviço de OCR ainda não inicializado. Tente novamente em alguns segundos.',
        retryAfter: 5
      });
    }

    logger.info('📸 Processando CNH via OCR', {
      userId: req.body.userId,
      fileSize: req.file.size,
      mimetype: req.file.mimetype
    });

    // Extrair dados da CNH
    const extractedData = await ocrService.extractCNHData(req.file.buffer);

    // Retornar dados extraídos
    res.json({
      success: true,
      data: extractedData,
      message: 'Dados da CNH extraídos com sucesso'
    });

  } catch (error) {
    logger.error('❌ Erro ao processar CNH:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar imagem da CNH',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/ocr/vehicle/extract-text
 * Extrai APENAS o texto do PDF do CRLV (sem processar)
 * Mobile processa o texto localmente
 * 
 * Body (multipart/form-data):
 * - pdf: arquivo PDF do CRLV
 */
router.post('/vehicle/extract-text', ocrLimiter, upload.single('pdf'), async (req, res) => {
  try {
    logger.info('📥 Requisição recebida em /vehicle/extract-text', {
      hasFile: !!req.file,
      body: req.body,
      headers: req.headers['content-type'],
      fileSize: req.file?.size,
      mimetype: req.file?.mimetype,
    });
    
    // Validar arquivo
    if (!req.file) {
      logger.warn('⚠️ Arquivo não recebido', {
        body: req.body,
        files: req.files,
      });
      return res.status(400).json({
        success: false,
        error: 'Arquivo PDF do CRLV é obrigatório. Nenhum arquivo foi recebido.'
      });
    }

    // Validar que é PDF
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        error: 'Arquivo deve ser um PDF'
      });
    }

    // Validar inicialização do serviço
    if (!ocrService.initialized) {
      return res.status(503).json({
        success: false,
        error: 'Serviço de OCR ainda não inicializado. Tente novamente em alguns segundos.',
        retryAfter: 5
      });
    }

    logger.info('📄 Extraindo texto do PDF do CRLV', {
      fileSize: req.file.size,
      mimetype: req.file.mimetype
    });

    // Extrair APENAS o texto do PDF (sem processar)
    const text = await ocrService.extractText(req.file.buffer, 'application/pdf');

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Não foi possível extrair texto do PDF. Certifique-se de que o documento está legível.'
      });
    }

    // Retornar APENAS o texto extraído (mobile processa)
    res.json({
      success: true,
      text: text,
      message: 'Texto extraído do PDF com sucesso'
    });

  } catch (error) {
    logger.error('❌ Erro ao extrair texto do PDF:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao extrair texto do PDF',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/ocr/vehicle
 * Extrai dados do CRLV (Certificado de Registro e Licenciamento de Veículo)
 * 
 * Body (multipart/form-data):
 * - image: arquivo de imagem do CRLV
 * - userId: (opcional) ID do usuário para rastreamento
 * - vehicleId: (opcional) ID do veículo para rastreamento
 */
router.post('/vehicle', ocrLimiter, upload.single('image'), async (req, res) => {
  try {
    // Validar arquivo
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Imagem do documento do veículo é obrigatória'
      });
    }

    // Validar inicialização do serviço
    if (!ocrService.initialized) {
      return res.status(503).json({
        success: false,
        error: 'Serviço de OCR ainda não inicializado. Tente novamente em alguns segundos.',
        retryAfter: 5
      });
    }

    logger.info('📸 Processando documento do veículo via OCR', {
      userId: req.body.userId,
      vehicleId: req.body.vehicleId,
      fileSize: req.file.size,
      mimetype: req.file.mimetype
    });

    // Extrair dados do CRLV
    const extractedData = await ocrService.extractCRLVData(req.file.buffer);

    // Retornar dados extraídos
    res.json({
      success: true,
      data: extractedData,
      message: 'Dados do veículo extraídos com sucesso'
    });

  } catch (error) {
    logger.error('❌ Erro ao processar documento do veículo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar imagem do documento do veículo',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/ocr/test
 * Teste simples para verificar se a rota está funcionando
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Rota de OCR está funcionando',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/ocr/health
 * Health check do serviço de OCR
 */
router.get('/health', async (req, res) => {
  try {
    res.json({
      success: true,
      initialized: ocrService.initialized,
      service: 'OCR Service',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('❌ Erro no health check do OCR:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar status do serviço'
    });
  }
});

// ✅ Handler 404 para rotas OCR não encontradas
router.use((req, res) => {
  logger.warn(`⚠️ [OCR Router] Rota não encontrada: ${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    headers: req.headers,
  });
  res.status(404).json({
    success: false,
    error: `Rota OCR não encontrada: ${req.method} ${req.path}`,
    availableRoutes: [
      'POST /api/ocr/cnh',
      'POST /api/ocr/vehicle/extract-text',
      'POST /api/ocr/vehicle',
      'GET /api/ocr/test',
      'GET /api/ocr/health'
    ]
  });
});

module.exports = router;






















