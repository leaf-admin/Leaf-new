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
const { logStructured, logError } = require('../utils/logger');

class KYCVPSClient {
  constructor() {
    // VPS dedicada: 147.93.66.253
    this.vpsUrl = process.env.KYC_VPS_URL || 'http://147.93.66.253:3002';
    this.apiKey = process.env.KYC_VPS_API_KEY || '';
    // ✅ CORREÇÃO: Aumentar timeout para 60s (upload de imagens pode demorar)
    this.timeout = parseInt(process.env.KYC_VPS_TIMEOUT) || 60000; // 60 segundos (era 30s)
    this.maxRetries = 2;
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

  /**
   * Health check da VPS KYC
   * @returns {Promise<Object>} Status da VPS
   */
  async healthCheck() {
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


