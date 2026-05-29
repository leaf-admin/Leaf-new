const BiometricFaceClient = require('./biometric-face-client');
const { logStructured, logError } = require('../utils/logger');

function parseNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeEmbeddingVector(value, expectedDimension = 512) {
  if (!Array.isArray(value)) {
    const error = new Error('embedding deve ser um array numerico');
    error.code = 'DEVICE_FACE_EMBEDDING_INVALID_TYPE';
    throw error;
  }

  if (value.length !== expectedDimension) {
    const error = new Error(`embedding deve ter dimensao ${expectedDimension}`);
    error.code = 'DEVICE_FACE_EMBEDDING_INVALID_DIMENSION';
    throw error;
  }

  return value.map((item, index) => {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      const error = new Error(`embedding contem valor invalido no indice ${index}`);
      error.code = 'DEVICE_FACE_EMBEDDING_INVALID_VALUE';
      throw error;
    }
    return numeric;
  });
}

function l2Norm(vector) {
  const sum = vector.reduce((acc, item) => acc + (item * item), 0);
  return Math.sqrt(sum);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    const error = new Error('embeddings incompatíveis para comparação');
    error.code = 'DEVICE_FACE_EMBEDDING_COMPARE_INVALID';
    throw error;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = Number(a[index]);
    const bv = Number(b[index]);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA <= 0 || normB <= 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class DeviceFaceEmbeddingVerificationService {
  constructor(options = {}) {
    this.faceClient = options.faceClient || new BiometricFaceClient();
    this.getCnhFaceEmbedding = options.getCnhFaceEmbedding || this.getCnhFaceEmbeddingFromRealtimeDb.bind(this);
    this.enabled = String(
      options.enabled ?? process.env.MOBILE_FACE_EMBEDDING_ENABLED ?? 'true'
    ).toLowerCase() === 'true';
    this.expectedDimension = Number.parseInt(
      options.expectedDimension || process.env.MOBILE_FACE_EMBEDDING_DIMENSION || '512',
      10
    );
    this.expectedFormat = String(
      options.expectedFormat || process.env.MOBILE_FACE_EMBEDDING_FORMAT || 'float32-l2-normalized-512'
    ).trim();
    this.allowedModes = String(
      options.allowedModes || process.env.MOBILE_FACE_EMBEDDING_ALLOWED_MODES || 'mobile_arcface_w600k_r50_v1,device_embedding_v1'
    )
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    this.normMin = parseNumber(options.normMin || process.env.MOBILE_FACE_EMBEDDING_NORM_MIN, 0.95);
    this.normMax = parseNumber(options.normMax || process.env.MOBILE_FACE_EMBEDDING_NORM_MAX, 1.05);
    this.approveThreshold = parseNumber(
      options.approveThreshold || process.env.BIOMETRIC_FACE_APPROVE_THRESHOLD,
      0.61
    );
    this.reviewThreshold = parseNumber(
      options.reviewThreshold || process.env.BIOMETRIC_FACE_REVIEW_THRESHOLD,
      0.40
    );
    this.allowLocalCompareFallback = String(
      options.allowLocalCompareFallback ?? process.env.MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK ?? 'true'
    ).toLowerCase() === 'true';
  }

  isDeviceEmbeddingPayload(payload = {}) {
    return Boolean(
      payload
      && typeof payload === 'object'
      && (
        Array.isArray(payload.embedding)
        || String(payload.mode || payload.provider || '').trim() === 'device_embedding_v1'
        || String(payload.mode || payload.provider || '').trim().startsWith('mobile_arcface')
      )
    );
  }

  async verify(userId, payload = {}) {
    const startedAt = Date.now();
    if (!this.enabled) {
      const error = new Error('Embedding facial no dispositivo está desabilitado');
      error.code = 'DEVICE_FACE_EMBEDDING_DISABLED';
      throw error;
    }

    const mode = String(payload.mode || payload.provider || '').trim();
    if (!mode || !this.allowedModes.includes(mode)) {
      const error = new Error('Modo de embedding facial do dispositivo não permitido');
      error.code = 'DEVICE_FACE_EMBEDDING_MODE_NOT_ALLOWED';
      throw error;
    }

    if (payload.embeddingFormat && String(payload.embeddingFormat).trim() !== this.expectedFormat) {
      const error = new Error('Formato de embedding facial do dispositivo não permitido');
      error.code = 'DEVICE_FACE_EMBEDDING_FORMAT_NOT_ALLOWED';
      throw error;
    }

    const currentEmbedding = normalizeEmbeddingVector(payload.embedding, this.expectedDimension);
    const currentNorm = l2Norm(currentEmbedding);
    if (currentNorm < this.normMin || currentNorm > this.normMax) {
      const error = new Error('Embedding facial do dispositivo fora da normalização esperada');
      error.code = 'DEVICE_FACE_EMBEDDING_NORM_INVALID';
      throw error;
    }

    const reference = await this.getCnhFaceEmbedding(userId);
    if (!reference?.embedding) {
      const error = new Error('Embedding facial da CNH não encontrado para este motorista');
      error.code = 'CNH_FACE_EMBEDDING_NOT_FOUND';
      throw error;
    }

    const referenceEmbedding = normalizeEmbeddingVector(reference.embedding, this.expectedDimension);
    const comparison = await this.compare(referenceEmbedding, currentEmbedding);
    const score = Number(comparison.cosine_similarity || 0);
    const decision = comparison.decision || (
      score >= this.approveThreshold ? 'approve' : (score >= this.reviewThreshold ? 'review' : 'reject')
    );
    const isMatch = decision === 'approve';

    logStructured('info', 'Embedding facial do app comparado contra CNH', {
      service: 'device-face-embedding-verification-service',
      userId,
      mode,
      decision,
      score,
      durationMs: Date.now() - startedAt
    });

    return {
      success: true,
      isMatch,
      needsReview: decision === 'review',
      similarityScore: score,
      confidence: score,
      threshold: this.approveThreshold,
      reviewThreshold: this.reviewThreshold,
      decision,
      processingTime: Date.now() - startedAt,
      mode,
      provider: 'mobile_face_embedding',
      embeddingFormat: this.expectedFormat,
      embeddingDimension: this.expectedDimension,
      reference: {
        source: reference.source || 'cnh_face_embedding',
        model: reference.model || null,
        createdAt: reference.createdAt || null,
        submissionId: reference.submissionId || null
      },
      comparisonProvider: comparison.provider || 'local_cosine'
    };
  }

  async compare(referenceEmbedding, currentEmbedding) {
    if (this.faceClient?.isConfigured?.()) {
      try {
        return await this.faceClient.compareEmbeddings(referenceEmbedding, currentEmbedding, {
          approveThreshold: this.approveThreshold,
          reviewThreshold: this.reviewThreshold
        });
      } catch (error) {
        if (!this.allowLocalCompareFallback) {
          throw error;
        }
        logError(error, 'Falha ao comparar no microservico; usando cosseno local', {
          service: 'device-face-embedding-verification-service'
        });
      }
    }

    const score = cosineSimilarity(referenceEmbedding, currentEmbedding);
    return {
      provider: 'local_cosine',
      cosine_similarity: score,
      decision: score >= this.approveThreshold
        ? 'approve'
        : (score >= this.reviewThreshold ? 'review' : 'reject'),
      thresholds: {
        approve: this.approveThreshold,
        review: this.reviewThreshold
      }
    };
  }

  async getCnhFaceEmbeddingFromRealtimeDb(userId) {
    try {
      const firebaseConfig = require('../firebase-config');
      if (!firebaseConfig?.getFromRealtimeDB) {
        return null;
      }

      const payload = await firebaseConfig.getFromRealtimeDB(`users/${userId}/biometrics/cnhFace`);
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      if (!Array.isArray(payload.embedding)) {
        return null;
      }

      return payload;
    } catch (error) {
      logError(error, 'Falha ao buscar embedding facial da CNH', {
        service: 'device-face-embedding-verification-service',
        userId
      });
      return null;
    }
  }
}

module.exports = DeviceFaceEmbeddingVerificationService;
