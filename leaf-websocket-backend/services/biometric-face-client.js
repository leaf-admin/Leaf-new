const axios = require('axios');
const FormData = require('form-data');
const { logStructured, logError } = require('../utils/logger');

class BiometricFaceClient {
  constructor(options = {}) {
    this.baseUrl = String(
      options.baseUrl || process.env.BIOMETRIC_FACE_SERVICE_URL || ''
    ).replace(/\/+$/, '');
    this.apiKey = options.apiKey || process.env.BIOMETRIC_FACE_SERVICE_API_KEY || '';
    this.apiKeyHeader = options.apiKeyHeader || process.env.BIOMETRIC_FACE_SERVICE_API_KEY_HEADER || 'X-Leaf-Biometric-Key';
    this.timeoutMs = Number(options.timeoutMs || process.env.BIOMETRIC_FACE_SERVICE_TIMEOUT_MS || 15000);
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async healthCheck() {
    if (!this.baseUrl) {
      return { status: 'unconfigured', configured: false };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: Math.min(this.timeoutMs, 5000)
      });
      return {
        configured: this.isConfigured(),
        status: response.data?.status || 'unknown',
        modelLoaded: response.data?.model_loaded === true,
        model: response.data?.model || null
      };
    } catch (error) {
      return {
        configured: this.isConfigured(),
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  async generateEmbedding(imageBuffer, options = {}) {
    this.#assertConfigured();
    this.#assertImageBuffer(imageBuffer);

    const form = new FormData();
    form.append('image', imageBuffer, {
      filename: options.filename || 'face.jpg',
      contentType: options.contentType || 'image/jpeg'
    });

    const startedAt = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/generate-embedding`,
        form,
        {
          timeout: this.timeoutMs,
          headers: {
            ...form.getHeaders(),
            [this.apiKeyHeader]: this.apiKey,
            Accept: 'application/json'
          }
        }
      );

      logStructured('info', 'Embedding facial gerado no microservico biometrico', {
        service: 'biometric-face-client',
        durationMs: Date.now() - startedAt,
        dimension: response.data?.dimension || null,
        faceCount: response.data?.face_count || null,
        detScore: response.data?.selected_face?.detection_score || null
      });

      return response.data;
    } catch (error) {
      logError(error, 'Falha ao gerar embedding facial', {
        service: 'biometric-face-client',
        durationMs: Date.now() - startedAt,
        status: error?.response?.status || null
      });
      throw this.#normalizeError(error);
    }
  }

  async compareEmbeddings(embeddingA, embeddingB, options = {}) {
    this.#assertConfigured();
    const startedAt = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/compare`,
        {
          embeddingA,
          embeddingB,
          approveThreshold: options.approveThreshold,
          reviewThreshold: options.reviewThreshold
        },
        {
          timeout: this.timeoutMs,
          headers: {
            [this.apiKeyHeader]: this.apiKey,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );

      logStructured('info', 'Embeddings faciais comparados no microservico biometrico', {
        service: 'biometric-face-client',
        durationMs: Date.now() - startedAt,
        decision: response.data?.decision || null,
        score: response.data?.cosine_similarity || null
      });

      return response.data;
    } catch (error) {
      logError(error, 'Falha ao comparar embeddings faciais', {
        service: 'biometric-face-client',
        durationMs: Date.now() - startedAt,
        status: error?.response?.status || null
      });
      throw this.#normalizeError(error);
    }
  }

  #assertConfigured() {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('BIOMETRIC_FACE_SERVICE_URL e BIOMETRIC_FACE_SERVICE_API_KEY devem estar configurados');
    }
  }

  #assertImageBuffer(imageBuffer) {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error('imageBuffer deve ser um Buffer nao vazio');
    }
  }

  #normalizeError(error) {
    const status = error?.response?.status || null;
    const detail = error?.response?.data?.detail || error?.response?.data?.error || error.message;
    const normalized = new Error(`Biometric face service error${status ? ` ${status}` : ''}: ${detail}`);
    normalized.status = status;
    normalized.cause = error;
    return normalized;
  }
}

module.exports = BiometricFaceClient;
