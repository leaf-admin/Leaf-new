/**
 * Rotas de OCR para extração de dados de documentos
 * Endpoints: /api/ocr/cnh e /api/ocr/vehicle
 */

const express = require('express');
const multer = require('multer');
const ocrService = require('../services/ocr-service');
const documentAIExtractionService = require('../services/document-ai-extraction-service');
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

function hasUsefulCnhText(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (raw.length < 700) return false;

  const upper = raw.toUpperCase();
  const markers = ['CPF', 'REGISTRO', 'VALIDADE', 'CATEGORIA', 'NOME', 'HABILIT'];
  const hitCount = markers.reduce((acc, marker) => (upper.includes(marker) ? acc + 1 : acc), 0);
  return hitCount >= 2;
}

function hasUsefulVehicleText(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (raw.length < 350) return false;

  const upper = raw.toUpperCase();
  const markers = ['PLACA', 'RENAVAM', 'CHASSI', 'MUNICIPIO', 'MARCA', 'MODELO'];
  const hitCount = markers.reduce((acc, marker) => (upper.includes(marker) ? acc + 1 : acc), 0);
  return hitCount >= 2;
}

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
 * POST /api/ocr/cnh/pdf
 * Extrai dados da CNH a partir de PDF (CNH Digital).
 * Fluxo: OCR/PDF text -> GPT-5.4-mini (ou multimodal com imagem).
 */
router.post('/cnh/pdf', ocrLimiter, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Arquivo PDF da CNH é obrigatório'
      });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        error: 'Arquivo deve ser um PDF'
      });
    }

    if (!ocrService.initialized) {
      return res.status(503).json({
        success: false,
        error: 'Serviço de OCR ainda não inicializado. Tente novamente em alguns segundos.',
        retryAfter: 5
      });
    }

    logger.info('📄 Processando PDF da CNH', {
      fileSize: req.file.size,
      mimetype: req.file.mimetype,
      userId: req.body?.userId || null
    });

    if (!documentAIExtractionService.enabled) {
      return res.status(503).json({
        success: false,
        error: 'Extração por IA indisponível. Configure OPENAI_API_KEY para processar CNH em PDF.',
        source: 'openai_not_configured'
      });
    }

    let extractedText = '';
    try {
      extractedText = await ocrService.extractTextFromPDF(req.file.buffer);
    } catch (textExtractionError) {
      logger.warn('⚠️ Extração textual nativa da CNH falhou, tentando rota multimodal', {
        message: textExtractionError?.message || textExtractionError
      });
    }

    let data = null;
    let model = 'gpt-5.4-mini';
    let extractionSource = 'pdf_text';

    try {
      if (hasUsefulCnhText(extractedText)) {
        data = await documentAIExtractionService.extractCNHFromText(extractedText, {
          source: 'pdf_text',
          textLength: extractedText.length
        });
        extractionSource = 'pdf_text';
      } else {
        logger.info('🧾 Texto da CNH insuficiente, migrando para extração multimodal por imagem', {
          textLength: Number(extractedText?.length || 0)
        });
        const imageBuffer = await ocrService.convertPDFToImage(req.file.buffer);
        data = await documentAIExtractionService.extractCNHFromImageBuffer(imageBuffer, {
          source: 'pdf_image',
          imageBytes: imageBuffer.length
        });
        extractionSource = 'pdf_image';
      }
      model = data?.extractedBy || model;
    } catch (aiError) {
      logger.warn('⚠️ IA indisponível para extração da CNH', {
        message: aiError?.message || aiError
      });
      if (!extractedText || !extractedText.trim()) {
        return res.status(422).json({
          success: false,
          error: 'Não foi possível extrair dados da CNH com IA. Tente enviar outro PDF da CNH-e.',
          source: 'openai_failed'
        });
      }
      return res.status(422).json({
        success: false,
        error: 'Não foi possível extrair dados da CNH com IA a partir do texto do PDF. Tente outro arquivo.',
        source: 'openai_failed',
        details: process.env.NODE_ENV === 'development' ? aiError.message : undefined
      });
    }

    return res.json({
      success: true,
      source: 'openai',
      model,
      textLength: extractedText.length,
      extractionSource,
      data,
      message: 'Dados da CNH extraídos com IA com sucesso'
    });
  } catch (error) {
    logger.error('❌ Erro ao processar PDF da CNH:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao processar PDF da CNH',
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
 * POST /api/ocr/vehicle/pdf
 * Extrai dados do documento do veículo (CRLV) via PDF.
 * Fluxo: OCR/PDF text -> GPT-5.4-mini (ou multimodal com imagem).
 */
router.post('/vehicle/pdf', ocrLimiter, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Arquivo PDF do documento do veículo é obrigatório'
      });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        error: 'Arquivo deve ser um PDF'
      });
    }

    if (!ocrService.initialized) {
      return res.status(503).json({
        success: false,
        error: 'Serviço de OCR ainda não inicializado. Tente novamente em alguns segundos.',
        retryAfter: 5
      });
    }

    logger.info('📄 Processando PDF do documento do veículo', {
      fileSize: req.file.size,
      mimetype: req.file.mimetype,
      userId: req.body?.userId || null
    });

    if (!documentAIExtractionService.enabled) {
      return res.status(503).json({
        success: false,
        error: 'Extração por IA indisponível. Configure OPENAI_API_KEY para processar CRLV em PDF.',
        source: 'openai_not_configured'
      });
    }

    let extractedText = '';
    try {
      extractedText = await ocrService.extractTextFromPDF(req.file.buffer);
    } catch (textExtractionError) {
      logger.warn('⚠️ Extração textual nativa do CRLV falhou, tentando rota multimodal', {
        message: textExtractionError?.message || textExtractionError
      });
    }

    let data = null;
    let model = 'gpt-5.4-mini';
    let extractionSource = 'pdf_text';

    try {
      if (hasUsefulVehicleText(extractedText)) {
        data = await documentAIExtractionService.extractVehicleFromText(extractedText, {
          source: 'pdf_text',
          textLength: extractedText.length
        });
        extractionSource = 'pdf_text';
      } else {
        logger.info('🧾 Texto do CRLV insuficiente, migrando para extração multimodal por imagem', {
          textLength: Number(extractedText?.length || 0)
        });
        const imageBuffer = await ocrService.convertPDFToImage(req.file.buffer);
        data = await documentAIExtractionService.extractVehicleFromImageBuffer(imageBuffer, {
          source: 'pdf_image',
          imageBytes: imageBuffer.length
        });
        extractionSource = 'pdf_image';
      }
      model = data?.extractedBy || model;
    } catch (aiError) {
      logger.warn('⚠️ IA indisponível para extração de CRLV', {
        message: aiError?.message || aiError
      });
      if (!extractedText || !extractedText.trim()) {
        return res.status(422).json({
          success: false,
          error: 'Não foi possível extrair dados do CRLV com IA. Tente enviar outro PDF do CRLV-e.',
          source: 'openai_failed'
        });
      }
      return res.status(422).json({
        success: false,
        error: 'Não foi possível extrair dados do CRLV com IA a partir do texto do PDF. Tente outro arquivo.',
        source: 'openai_failed',
        details: process.env.NODE_ENV === 'development' ? aiError.message : undefined
      });
    }

    return res.json({
      success: true,
      source: 'openai',
      model,
      textLength: extractedText.length,
      extractionSource,
      data,
      message: 'Dados do veículo extraídos com IA com sucesso'
    });
  } catch (error) {
    logger.error('❌ Erro ao processar PDF do veículo:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao processar PDF do veículo',
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
      'POST /api/ocr/cnh/pdf',
      'POST /api/ocr/vehicle/extract-text',
      'POST /api/ocr/vehicle',
      'POST /api/ocr/vehicle/pdf',
      'GET /api/ocr/test',
      'GET /api/ocr/health'
    ]
  });
});

module.exports = router;















