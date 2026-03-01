const axios = require('axios');
const { logStructured, logError } = require('../utils/logger');

class KYCClient {
  constructor() {
    this.kycServiceUrl = process.env.KYC_SERVICE_URL || 'http://localhost:3001';
    this.timeout = 30000; // 30 segundos
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 segundo
  }

  async makeRequest(method, endpoint, data = null, options = {}) {
    const url = `${this.kycServiceUrl}${endpoint}`;

    // 🔥 START LOCAL MOCK 🔥
    // Bypass actual KYC check for local development and Event-Driven Architecture Refactoring
    logStructured('info', `[MOCKED KYC] Intercepted ${method} ${endpoint}`, { service: 'KYCClient' });
    if (endpoint === '/health') return { status: 'healthy' };
    if (endpoint === '/upload-profile') return { success: true, userId: 'mock-user', message: 'MOCKED UPLOAD' };
    if (endpoint === '/verify-driver') return { success: true, is_match: true, similarity_score: 0.99, confidence: 'Alta' };
    if (endpoint === '/stats') return { service: 'KYC MOCKED Service', version: 'Local' };
    return { success: true, mocked: true };
    // 🔥 END LOCAL MOCK 🔥

    const config = {
      method,
      url,
      timeout: this.timeout,
      ...options
    };

    if (data) {
      if (data instanceof FormData) {
        config.data = data;
        config.headers = {
          'Content-Type': 'multipart/form-data',
          ...config.headers
        };
      } else {
        config.data = data;
        config.headers = {
          'Content-Type': 'application/json',
          ...config.headers
        };
      }
    }

    let lastError;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await axios(config);
        return response.data;
      } catch (error) {
        lastError = error;
        logStructured('warn', `Tentativa ${attempt}/${this.retryAttempts} falhou para ${endpoint}:`, error.message);

        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }

    throw new Error(`Falha após ${this.retryAttempts} tentativas: ${lastError.message}`);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async uploadProfileImage(userId, imageBuffer) {
    try {
      const FormData = require('form-data');
      const formData = new FormData();

      formData.append('userId', userId);
      formData.append('image', imageBuffer, {
        filename: `profile_${userId}.jpg`,
        contentType: 'image/jpeg'
      });

      const result = await this.makeRequest('POST', '/upload-profile', formData, {
        headers: formData.getHeaders()
      });

      return result;
    } catch (error) {
      logError(error, 'Erro no upload de perfil:', { service: 'KYCClient' });
      throw error;
    }
  }

  async verifyDriver(userId, currentImageBuffer) {
    try {
      const FormData = require('form-data');
      const formData = new FormData();

      formData.append('userId', userId);
      formData.append('currentImage', currentImageBuffer, {
        filename: `verification_${userId}_${Date.now()}.jpg`,
        contentType: 'image/jpeg'
      });

      const result = await this.makeRequest('POST', '/verify-driver', formData, {
        headers: formData.getHeaders()
      });

      return result;
    } catch (error) {
      logError(error, 'Erro na verificação:', { service: 'KYCClient' });
      throw error;
    }
  }

  async getFaceEncoding(userId) {
    try {
      const result = await this.makeRequest('GET', `/encoding/${userId}`);
      return result;
    } catch (error) {
      logError(error, 'Erro ao obter encoding:', { service: 'KYCClient' });
      throw error;
    }
  }

  async deleteFaceEncoding(userId) {
    try {
      const result = await this.makeRequest('DELETE', `/encoding/${userId}`);
      return result;
    } catch (error) {
      logError(error, 'Erro ao deletar encoding:', { service: 'KYCClient' });
      throw error;
    }
  }

  async getStats() {
    try {
      const result = await this.makeRequest('GET', '/stats');
      return result;
    } catch (error) {
      logError(error, 'Erro ao obter estatísticas:', { service: 'KYCClient' });
      throw error;
    }
  }

  async healthCheck() {
    try {
      const result = await this.makeRequest('GET', '/health');
      return result;
    } catch (error) {
      logError(error, 'Erro no health check:', { service: 'KYCClient' });
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  async isServiceAvailable() {
    try {
      const health = await this.healthCheck();
      return health.status === 'healthy';
    } catch (error) {
      return false;
    }
  }
}

module.exports = KYCClient;

