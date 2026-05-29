/**
 * 🌐 Cliente HTTP para comunicação com VPS KYC Dedicada
 * 
 * Responsável por:
 * - Enviar requisições de processamento KYC para VPS dedicada
 * - Gerenciar timeouts e retries
 * - Health check da VPS
 */

const axios = require('axios');
const FormData = require('form-data');
const BiometricFaceClient = require('./biometric-face-client');
const CnhFaceBiometricService = require('./cnh-face-biometric-service');
const { logStructured, logError } = require('../utils/logger');

function parseNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.slice(0, 4).toString('ascii') === '%PDF';
}

function guessImageContentType(buffer, fallback = 'image/jpeg') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return fallback;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return fallback;
}

class KYCVPSClient {
  constructor() {
    // VPS dedicada: 147.182.204.181
    this.vpsUrl = process.env.KYC_VPS_URL || 'http://147.182.204.181:3002';
    this.apiKey = process.env.KYC_VPS_API_KEY || '';
    // ✅ CORREÇÃO: Aumentar timeout para 60s (upload de imagens pode demorar)
    this.timeout = parseInt(process.env.KYC_VPS_TIMEOUT) || 60000; // 60 segundos (era 30s)
    this.maxRetries = 2;
    this.biometricFaceClient = new BiometricFaceClient();
    this.cnhFaceBiometricService = new CnhFaceBiometricService({
      client: this.biometricFaceClient
    });
    this.provider = String(process.env.KYC_VPS_PROVIDER || 'auto').trim().toLowerCase();
    this.useBiometricFaceService =
      this.provider === 'biometric-face-service'
      || (this.provider === 'auto' && this.biometricFaceClient.isConfigured());
    this.biometricApproveThreshold = parseNumber(
      process.env.BIOMETRIC_FACE_APPROVE_THRESHOLD,
      parseNumber(process.env.FACE_APPROVE_THRESHOLD, 0.61)
    );
    this.biometricReviewThreshold = parseNumber(
      process.env.BIOMETRIC_FACE_REVIEW_THRESHOLD,
      parseNumber(process.env.FACE_REVIEW_THRESHOLD, 0.40)
    );
  }

  /**
   * Processa KYC na VPS dedicada
   * @param {string} userId - ID do usuário
   * @param {Buffer} cnhBuffer - Buffer da CNH
   * @param {Buffer} currentImageBuffer - Buffer da foto atual (câmera)
   * @param {Object} options - Opções adicionais
   * @returns {Promise<Object>} Resultado da verificação
   */
  async processKYC(userId, cnhBuffer, currentImageBuffer, options = {}) {
    if (this.useBiometricFaceService) {
      return this.processKYCWithBiometricFaceService(
        userId,
        cnhBuffer,
        currentImageBuffer,
        options
      );
    }

    try {
      logStructured('info', `🚀 Enviando requisição KYC para VPS: ${this.vpsUrl}`);
      logStructured('info', `   UserId: ${userId}`);
      logStructured('info', `   CNH Size: ${cnhBuffer.length} bytes`);
      logStructured('info', `   Current Image Size: ${currentImageBuffer.length} bytes`);

      // Usar FormData para enviar arquivos
      const form = new FormData();
      
      form.append('userId', userId);
      form.append('cnh', cnhBuffer, {
        filename: 'cnh.jpg',
        contentType: 'image/jpeg'
      });
      form.append('current', currentImageBuffer, {
        filename: 'current.jpg',
        contentType: 'image/jpeg'
      });
      
      // Adicionar opções se fornecidas
      if (options.minConfidence) {
        form.append('minConfidence', options.minConfidence.toString());
      }
      
      const response = await axios.post(
        `${this.vpsUrl}/api/kyc/process`,
        form,
        {
          timeout: this.timeout,
          headers: {
            ...form.getHeaders(),
            'X-API-Key': this.apiKey || undefined,
            'X-Server-ID': 'main-server'
          },
          validateStatus: (status) => status < 500 // Não lançar erro para 4xx
        }
      );

      if (response.status >= 400) {
        throw new Error(`VPS retornou erro ${response.status}: ${response.data?.error || 'Unknown error'}`);
      }

      logStructured('info', `✅ Resposta recebida da VPS KYC para ${userId}`);
      return response.data;

    } catch (error) {
      if (error.response) {
        // Erro da VPS (4xx, 5xx)
        logStructured('error', `❌ Erro da VPS KYC (${error.response.status}):`, error.response.data);
        throw new Error(`VPS KYC Error: ${error.response.data?.error || error.message}`);
      } else if (error.request) {
        // Timeout ou conexão recusada
        logStructured('error', `❌ Erro de conexão com VPS KYC:`, error.message);
        throw new Error(`Não foi possível conectar à VPS KYC: ${error.message}`);
      } else {
        // Erro na configuração
        logStructured('error', `❌ Erro ao processar KYC na VPS:`, error.message);
        throw error;
      }
    }
  }

  async processKYCWithBiometricFaceService(userId, referenceImageBuffer, currentImageBuffer, options = {}) {
    const startedAt = Date.now();
    try {
      logStructured('info', 'Enviando verificação KYC para microservico biometrico', {
        service: 'kyc-vps-client',
        provider: 'biometric-face-service',
        userId,
        referenceBytes: Buffer.isBuffer(referenceImageBuffer) ? referenceImageBuffer.length : 0,
        currentBytes: Buffer.isBuffer(currentImageBuffer) ? currentImageBuffer.length : 0
      });

      const referenceEmbedding = await this.generateReferenceEmbedding(referenceImageBuffer, {
        userId,
        filename: options.referenceFilename || 'reference.jpg'
      });
      const currentEmbedding = await this.biometricFaceClient.generateEmbedding(currentImageBuffer, {
        filename: options.currentFilename || 'current.jpg',
        contentType: guessImageContentType(currentImageBuffer)
      });

      const comparison = await this.biometricFaceClient.compareEmbeddings(
        referenceEmbedding.embedding,
        currentEmbedding.embedding,
        {
          approveThreshold: this.biometricApproveThreshold,
          reviewThreshold: this.biometricReviewThreshold
        }
      );

      const confidence = Number(comparison?.cosine_similarity || 0);
      const decision = comparison?.decision || 'reject';
      const match = decision === 'approve';

      logStructured('info', 'Verificação KYC biometrica concluida', {
        service: 'kyc-vps-client',
        provider: 'biometric-face-service',
        userId,
        decision,
        confidence,
        durationMs: Date.now() - startedAt
      });

      return {
        success: true,
        match,
        needsReview: decision === 'review',
        confidence,
        similarity: confidence,
        decision,
        provider: 'biometric-face-service',
        processingTime: Date.now() - startedAt,
        reference: {
          source: referenceEmbedding.source || 'reference_image',
          faceCount: referenceEmbedding.face_count || null,
          detectionScore: referenceEmbedding.selected_face?.detection_score || null,
          model: referenceEmbedding.model || null
        },
        current: {
          faceCount: currentEmbedding.face_count || null,
          detectionScore: currentEmbedding.selected_face?.detection_score || null,
          model: currentEmbedding.model || null
        },
        thresholds: comparison?.thresholds || {
          approve: this.biometricApproveThreshold,
          review: this.biometricReviewThreshold
        }
      };
    } catch (error) {
      logError(error, 'Erro ao processar KYC no microservico biometrico', {
        service: 'kyc-vps-client',
        provider: 'biometric-face-service',
        userId,
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  async generateReferenceEmbedding(referenceImageBuffer, options = {}) {
    if (isPdfBuffer(referenceImageBuffer)) {
      return this.cnhFaceBiometricService.generateCnhFaceEmbeddingFromPdf(referenceImageBuffer, {
        filename: options.filename || 'cnh.pdf'
      });
    }

    return this.biometricFaceClient.generateEmbedding(referenceImageBuffer, {
      filename: options.filename || 'reference.jpg',
      contentType: guessImageContentType(referenceImageBuffer)
    });
  }

  /**
   * Health check da VPS KYC
   * @returns {Promise<Object>} Status da VPS
   */
  async healthCheck() {
    if (this.useBiometricFaceService) {
      const health = await this.biometricFaceClient.healthCheck();
      const rawStatus = String(health.status || '').toLowerCase();
      const healthy = health.configured === true && ['ok', 'ready', 'healthy'].includes(rawStatus);

      return {
        status: healthy ? 'healthy' : 'unhealthy',
        provider: 'biometric-face-service',
        vpsUrl: this.biometricFaceClient.baseUrl,
        response: health,
        error: healthy ? undefined : health.error || `status ${health.status || 'unknown'}`
      };
    }

    try {
      const response = await axios.get(`${this.vpsUrl}/health`, {
        timeout: 5000,
        headers: {
          'X-API-Key': this.apiKey || undefined
        }
      });

      return {
        status: 'healthy',
        vpsUrl: this.vpsUrl,
        response: response.data
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        vpsUrl: this.vpsUrl,
        error: error.message
      };
    }
  }

  /**
   * Verifica se VPS está disponível
   * @returns {Promise<boolean>} true se disponível
   */
  async isAvailable() {
    try {
      const health = await this.healthCheck();
      return health.status === 'healthy';
    } catch (error) {
      return false;
    }
  }

  /**
   * Processa KYC com retry automático
   * @param {string} userId - ID do usuário
   * @param {Buffer} cnhBuffer - Buffer da CNH
   * @param {Buffer} currentImageBuffer - Buffer da foto atual
   * @param {Object} options - Opções
   * @returns {Promise<Object>} Resultado
   */
  async processKYCWithRetry(userId, cnhBuffer, currentImageBuffer, options = {}) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logStructured('info', `🔄 Tentativa ${attempt + 1}/${this.maxRetries + 1} para ${userId}`);
          await this.delay(1000 * attempt); // Backoff exponencial
        }
        
        return await this.processKYC(userId, cnhBuffer, currentImageBuffer, options);
      } catch (error) {
        lastError = error;
        
        // Se for erro 4xx (client error), não tentar novamente
        if (error.message.includes('VPS KYC Error:') && 
            error.message.match(/4\d{2}/)) {
          throw error;
        }
        
        // Continuar tentando para outros erros
        logStructured('warn', `⚠️ Tentativa ${attempt + 1} falhou:`, error.message);
      }
    }
    
    throw lastError || new Error('Falha ao processar KYC após múltiplas tentativas');
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = KYCVPSClient;
