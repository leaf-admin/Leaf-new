const crypto = require('crypto');
const {
  RekognitionClient,
  CompareFacesCommand
} = require('@aws-sdk/client-rekognition');
const { logStructured, logError } = require('../utils/logger');
const defaultAwsKycCostGuard = require('./aws-kyc-cost-guard-service');

const PROVIDER_NAME = 'aws_rekognition_compare_faces';
const MODE_NAME = 'server_aws_compare_faces_v1';
const LIVENESS_PROVIDER = 'aws_rekognition_face_liveness';
const APPROVED_CNH_SOURCE = 'approved_cnh_pdf_crop_v1';
const MANAGED_MODEL_NAME = 'aws_rekognition_compare_faces_managed';
const REFERENCE_BINDING_VERSION = 3;
const MIN_CANONICAL_APPROVE_THRESHOLD = 0.95;
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_QUALITY_FILTERS = new Set(['NONE', 'AUTO', 'LOW', 'MEDIUM', 'HIGH']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readInteger(value, fallback, min, max) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function isSupportedImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
  return isJpeg || isPng;
}

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeReferenceImageBoundingBox(value) {
  const width = Number(value?.width);
  const height = Number(value?.height);
  const left = Number(value?.left);
  const top = Number(value?.top);
  const coordinates = [width, height, left, top];

  if (
    !coordinates.every(Number.isFinite)
    || width <= 0
    || height <= 0
    || width > 1.001
    || height > 1.001
  ) {
    return null;
  }

  const visibleLeft = Math.max(0, left);
  const visibleTop = Math.max(0, top);
  const visibleRight = Math.min(1, left + width);
  const visibleBottom = Math.min(1, top + height);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

  return {
    width: visibleRight - visibleLeft,
    height: visibleBottom - visibleTop,
    left: visibleLeft,
    top: visibleTop
  };
}

function applyHardFailDecision(result, approveThreshold) {
  const similarityScore = Number(result?.similarityScore);
  const isMatch = Number.isFinite(similarityScore) && similarityScore >= approveThreshold;
  return {
    ...result,
    isMatch,
    needsReview: false,
    decision: isMatch ? 'approve' : 'reject'
  };
}

class CanonicalAwsFaceCompareService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.enabled = options.enabled ?? readBoolean(
      this.env.KYC_AWS_COMPARE_FACES_ENABLED,
      false
    );
    this.region = String(
      options.region || this.env.AWS_REGION || this.env.AWS_LIVENESS_REGION || 'us-east-1'
    ).trim();
    this.approveThreshold = Math.max(
      MIN_CANONICAL_APPROVE_THRESHOLD,
      readNumber(
        options.approveThreshold ?? this.env.KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD,
        MIN_CANONICAL_APPROVE_THRESHOLD
      )
    );
    this.reviewThreshold = readNumber(
      options.reviewThreshold ?? this.env.KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD,
      0.80
    );
    this.qualityFilter = String(
      options.qualityFilter || this.env.KYC_AWS_COMPARE_FACES_QUALITY_FILTER || 'AUTO'
    ).trim().toUpperCase();
    this.estimatedUnitCostUsd = readNumber(
      options.estimatedUnitCostUsd
        ?? this.env.KYC_AWS_COMPARE_FACES_ESTIMATED_UNIT_COST_USD,
      0.001
    );
    this.sdkMaxAttempts = readInteger(
      options.sdkMaxAttempts ?? this.env.KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS,
      2,
      1,
      5
    );
    this.maxInlineImageBytes = readInteger(
      options.maxInlineImageBytes,
      MAX_INLINE_IMAGE_BYTES,
      1024,
      MAX_INLINE_IMAGE_BYTES
    );
    this.resultPersistenceMaxAttempts = readInteger(
      options.resultPersistenceMaxAttempts
        ?? this.env.KYC_AWS_COMPARE_RESULT_PERSIST_MAX_ATTEMPTS,
      3,
      1,
      5
    );
    this.costGuard = options.costGuard || defaultAwsKycCostGuard;
    this.client = options.client || this.createClient();
  }

  createClient() {
    if (!this.enabled) return null;

    const clientConfig = {
      region: this.region,
      maxAttempts: this.sdkMaxAttempts
    };
    if (this.env.AWS_ACCESS_KEY_ID && this.env.AWS_SECRET_ACCESS_KEY) {
      clientConfig.credentials = {
        accessKeyId: this.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: this.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: this.env.AWS_SESSION_TOKEN || undefined
      };
    }
    return new RekognitionClient(clientConfig);
  }

  getProviderName() {
    return PROVIDER_NAME;
  }

  getConfigSummary() {
    return {
      enabled: this.enabled === true,
      provider: PROVIDER_NAME,
      region: this.region,
      approveThreshold: this.approveThreshold,
      reviewThreshold: this.reviewThreshold,
      qualityFilter: this.qualityFilter,
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      sdkMaxAttempts: this.sdkMaxAttempts,
      maxInlineImageBytes: this.maxInlineImageBytes,
      resultPersistenceMaxAttempts: this.resultPersistenceMaxAttempts,
      costGuard: this.costGuard?.getConfigSummary?.() || { enabled: false }
    };
  }

  assertReady() {
    if (!this.enabled) {
      throw createError(
        'AWS Rekognition CompareFaces esta desabilitado',
        'AWS_COMPARE_FACES_DISABLED'
      );
    }
    if (!this.client || typeof this.client.send !== 'function') {
      throw createError(
        'Cliente AWS Rekognition CompareFaces nao inicializado',
        'AWS_COMPARE_FACES_CLIENT_NOT_READY'
      );
    }
    if (
      !Number.isFinite(this.reviewThreshold)
      || !Number.isFinite(this.approveThreshold)
      || this.reviewThreshold < 0
      || this.approveThreshold > 1
      || this.reviewThreshold >= this.approveThreshold
    ) {
      throw createError(
        'Thresholds AWS CompareFaces invalidos',
        'AWS_COMPARE_FACES_THRESHOLD_CONFIG_INVALID'
      );
    }
    if (!ALLOWED_QUALITY_FILTERS.has(this.qualityFilter)) {
      throw createError(
        'QualityFilter AWS CompareFaces invalido',
        'AWS_COMPARE_FACES_QUALITY_FILTER_INVALID'
      );
    }
    if (!Number.isFinite(this.estimatedUnitCostUsd) || this.estimatedUnitCostUsd < 0) {
      throw createError(
        'Custo estimado AWS CompareFaces invalido',
        'AWS_COMPARE_FACES_COST_CONFIG_INVALID'
      );
    }
    if (
      readBoolean(this.env.KYC_PRODUCTION_BIOMETRICS_ENABLED, false)
      && !this.costGuard?.isEnabled?.()
    ) {
      throw createError(
        'Circuit breaker agregado de custo AWS KYC obrigatorio',
        'KYC_AWS_COST_GUARD_REQUIRED'
      );
    }
  }

  assertImageBuffer(buffer, label) {
    const codePrefix = label === 'source'
      ? 'AWS_COMPARE_FACES_SOURCE_IMAGE'
      : 'AWS_COMPARE_FACES_LIVENESS_IMAGE';
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw createError('Imagem canonica obrigatoria', `${codePrefix}_REQUIRED`);
    }
    if (buffer.length > this.maxInlineImageBytes) {
      throw createError('Imagem canonica excede o limite AWS', `${codePrefix}_TOO_LARGE`);
    }
    if (!isSupportedImageBuffer(buffer)) {
      throw createError(
        'Imagem canonica deve estar em JPEG ou PNG',
        `${codePrefix}_FORMAT_INVALID`
      );
    }
  }

  buildReferenceBinding(driverId, sourceImageBuffer, reference = {}) {
    const source = String(reference.source || '').trim();
    const documentType = String(reference.documentType || '').trim().toLowerCase();
    const status = String(reference.status || '').trim().toLowerCase();
    const analysisStatus = String(reference.analysisStatus || '').trim().toLowerCase();
    const submissionId = String(reference.submissionId || '').trim();
    const documentPath = String(reference.documentPath || '').trim();
    const documentSha256 = String(reference.documentSha256 || '').trim().toLowerCase();
    const storageGeneration = String(reference.storageGeneration || '').trim();
    const approvalSource = String(reference.approvalSource || '').trim();
    const reviewedBy = String(reference.reviewedBy || '').trim();
    const reviewedAtMs = Date.parse(reference.reviewedAt);
    const cropVersion = String(reference.cropVersion || '').trim();
    const createdAtMs = Date.parse(reference.createdAt);
    const expectedPathPrefix = `driver-activation/${driverId}/cnh/`;

    if (
      reference.bindingVersion !== REFERENCE_BINDING_VERSION
      || source !== APPROVED_CNH_SOURCE
      || documentType !== 'cnh'
      || status !== 'approved'
      || analysisStatus !== 'approved'
      || approvalSource !== 'dashboard_manual_review'
      || !reviewedBy
      || !Number.isFinite(reviewedAtMs)
      || !submissionId
      || !documentPath.startsWith(expectedPathPrefix)
      || documentPath.includes('..')
      || !SHA256_PATTERN.test(documentSha256)
      || !/^\d+$/.test(storageGeneration)
      || !cropVersion
      || !Number.isFinite(createdAtMs)
    ) {
      throw createError(
        'Referencia deve ser o recorte da CNH atualmente aprovada',
        'AWS_COMPARE_FACES_APPROVED_CNH_REFERENCE_INVALID'
      );
    }

    const imageSha256 = sha256(sourceImageBuffer);
    const documentPathSha256 = sha256(documentPath);
    if (
      reference.imageSha256
      && (!SHA256_PATTERN.test(String(reference.imageSha256))
        || String(reference.imageSha256).toLowerCase() !== imageSha256)
    ) {
      throw createError(
        'Hash da imagem da CNH diverge da referencia aprovada',
        'AWS_COMPARE_FACES_CNH_IMAGE_HASH_MISMATCH'
      );
    }
    if (
      reference.documentPathSha256
      && (!SHA256_PATTERN.test(String(reference.documentPathSha256))
        || String(reference.documentPathSha256).toLowerCase() !== documentPathSha256)
    ) {
      throw createError(
        'Hash do caminho da CNH diverge da referencia aprovada',
        'AWS_COMPARE_FACES_CNH_PATH_HASH_MISMATCH'
      );
    }

    return {
      bindingVersion: REFERENCE_BINDING_VERSION,
      source: APPROVED_CNH_SOURCE,
      documentType: 'cnh',
      model: MANAGED_MODEL_NAME,
      submissionId,
      documentPathSha256,
      documentSha256,
      storageGeneration,
      approvalSource,
      reviewedByHash: sha256(reviewedBy),
      reviewedAt: new Date(reviewedAtMs).toISOString(),
      imageSha256,
      cropVersion,
      createdAt: new Date(createdAtMs).toISOString()
    };
  }

  buildLivenessBinding(driverId, livenessReferenceImageBuffer, liveness = {}) {
    const provider = String(liveness.provider || '').trim();
    const sessionId = String(liveness.sessionId || '').trim();
    const status = String(liveness.status || '').trim().toUpperCase();
    const confidence = Number(liveness.confidence);
    const threshold = Number(liveness.threshold);
    const referenceImageBytesAvailable = Buffer.isBuffer(livenessReferenceImageBuffer)
      && livenessReferenceImageBuffer.length > 0;
    const referenceImageSha256 = sha256(livenessReferenceImageBuffer);
    const referenceImageBoundingBox = normalizeReferenceImageBoundingBox(
      liveness.referenceImageBoundingBox
    );

    if (
      provider !== LIVENESS_PROVIDER
      || !sessionId
      || status !== 'SUCCEEDED'
      || liveness.livenessPassed !== true
      || !Number.isFinite(confidence)
      || !Number.isFinite(threshold)
      || confidence < threshold
      || !referenceImageBytesAvailable
    ) {
      throw createError(
        'Referencia facial exige sessao AWS Liveness aprovada',
        'AWS_COMPARE_FACES_LIVENESS_BINDING_INVALID'
      );
    }
    if (
      liveness.referenceImageSha256
      && (!SHA256_PATTERN.test(String(liveness.referenceImageSha256))
        || String(liveness.referenceImageSha256).toLowerCase() !== referenceImageSha256)
    ) {
      throw createError(
        'Hash da imagem AWS Liveness diverge da sessao',
        'AWS_COMPARE_FACES_LIVENESS_IMAGE_HASH_MISMATCH'
      );
    }

    return {
      provider: LIVENESS_PROVIDER,
      sessionIdHash: sha256(`${driverId}:${sessionId}`),
      status,
      livenessPassed: true,
      confidence,
      threshold,
      referenceImageSha256,
      providerBoundsPresent: Boolean(referenceImageBoundingBox),
      referenceImageFaceBoundsSha256: referenceImageBoundingBox
        ? sha256(JSON.stringify(referenceImageBoundingBox))
        : null
    };
  }

  normalizeProviderError(error, { livenessFaceDetected = false } = {}) {
    const providerCode = String(error?.name || error?.code || '').trim();
    const errorMap = {
      AccessDeniedException: ['AWS_COMPARE_FACES_ACCESS_DENIED', false],
      ImageTooLargeException: ['AWS_COMPARE_FACES_IMAGE_TOO_LARGE', false],
      InvalidImageFormatException: ['AWS_COMPARE_FACES_IMAGE_FORMAT_INVALID', false],
      InvalidParameterException: ['AWS_COMPARE_FACES_INVALID_PARAMETER', false],
      ProvisionedThroughputExceededException: ['AWS_COMPARE_FACES_THROTTLED', true],
      ThrottlingException: ['AWS_COMPARE_FACES_THROTTLED', true],
      InternalServerError: ['AWS_COMPARE_FACES_PROVIDER_UNAVAILABLE', true]
    };
    let [code, retryable] = errorMap[providerCode] || ['AWS_COMPARE_FACES_FAILED', true];
    if (providerCode === 'InvalidParameterException' && livenessFaceDetected) {
      code = 'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED';
      retryable = false;
    } else if (providerCode === 'InvalidParameterException') {
      code = 'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED';
      retryable = true;
    }
    const normalized = createError('Falha ao executar comparacao facial AWS', code);
    normalized.providerCode = providerCode || null;
    normalized.retryable = retryable;
    normalized.cause = error;
    return normalized;
  }

  async persistGuardedCompareResult(operationId, compareFingerprint, normalizedResult) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.resultPersistenceMaxAttempts; attempt += 1) {
      try {
        return await this.costGuard.completeCompare(
          operationId,
          compareFingerprint,
          normalizedResult
        );
      } catch (error) {
        lastError = error;
        const retryable = error?.code === 'KYC_AWS_COST_GUARD_UNAVAILABLE';
        if (!retryable || attempt >= this.resultPersistenceMaxAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
    throw lastError;
  }

  async persistProviderInputFailure(operationId, compareFingerprint, normalizedError) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.resultPersistenceMaxAttempts; attempt += 1) {
      try {
        return await this.costGuard.markCompareProviderInputFailed(
          operationId,
          compareFingerprint,
          {
            code: normalizedError.code,
            providerCode: normalizedError.providerCode
          }
        );
      } catch (error) {
        lastError = error;
        const retryable = error?.code === 'KYC_AWS_COST_GUARD_UNAVAILABLE';
        if (!retryable || attempt >= this.resultPersistenceMaxAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
    throw lastError;
  }

  async verifyApprovedCnhAgainstLiveness({
    driverId,
    sourceImageBuffer,
    livenessReferenceImageBuffer,
    reference,
    liveness
  } = {}) {
    this.assertReady();
    const safeDriverId = String(driverId || '').trim();
    if (!safeDriverId) {
      throw createError('Motorista obrigatorio', 'AWS_COMPARE_FACES_DRIVER_REQUIRED');
    }
    this.assertImageBuffer(sourceImageBuffer, 'source');
    this.assertImageBuffer(livenessReferenceImageBuffer, 'liveness');

    const referenceBinding = this.buildReferenceBinding(
      safeDriverId,
      sourceImageBuffer,
      reference
    );
    const livenessBinding = this.buildLivenessBinding(
      safeDriverId,
      livenessReferenceImageBuffer,
      liveness
    );
    const compareFingerprint = JSON.stringify({
      driverIdHash: sha256(safeDriverId),
      reference: referenceBinding,
      liveness: livenessBinding,
      approveThreshold: this.approveThreshold,
      reviewThreshold: this.reviewThreshold,
      qualityFilter: this.qualityFilter,
      mode: MODE_NAME
    });
    const costGuardClaim = await this.costGuard.claimCompareDispatch(
      liveness.costGuardOperationId,
      compareFingerprint
    );
    if (costGuardClaim?.replay === true && costGuardClaim.result) {
      return {
        ...applyHardFailDecision(costGuardClaim.result, this.approveThreshold),
        userId: safeDriverId,
        idempotentReplay: true
      };
    }
    const startedAt = Date.now();

    let response;
    try {
      response = await this.client.send(new CompareFacesCommand({
        SourceImage: { Bytes: sourceImageBuffer },
        TargetImage: { Bytes: livenessReferenceImageBuffer },
        SimilarityThreshold: this.reviewThreshold * 100,
        QualityFilter: this.qualityFilter
      }));
    } catch (error) {
      logError(error, 'Falha no provider AWS CompareFaces', {
        service: 'canonical-aws-face-compare-service',
        provider: PROVIDER_NAME,
        driverId: safeDriverId,
        providerCode: error?.name || error?.code || null,
        durationMs: Date.now() - startedAt
      });
      const normalizedError = this.normalizeProviderError(error, {
        livenessFaceDetected: Boolean(livenessBinding.referenceImageFaceBoundsSha256)
      });
      if (normalizedError.providerCode === 'InvalidParameterException') {
        await this.persistProviderInputFailure(
          liveness.costGuardOperationId,
          compareFingerprint,
          normalizedError
        );
      }
      throw normalizedError;
    }

    const matches = Array.isArray(response?.FaceMatches) ? response.FaceMatches : [];
    const similarities = matches
      .map((match) => Number(match?.Similarity))
      .filter(Number.isFinite)
      .map((value) => Math.max(0, Math.min(100, value)));
    const similarityPercent = similarities.length > 0 ? Math.max(...similarities) : null;
    const similarityScore = similarityPercent == null ? 0 : similarityPercent / 100;
    // The canonical AWS path is intentionally binary: a score below the
    // approval threshold is a hard failure. Manual review belongs to document
    // onboarding and must never become an online-activation fallback.
    const decision = similarityScore >= this.approveThreshold ? 'approve' : 'reject';
    const processingTime = Date.now() - startedAt;

    const normalizedResult = {
      success: true,
      userId: safeDriverId,
      isMatch: decision === 'approve',
      needsReview: false,
      similarityScore,
      similarityPercent,
      confidence: similarityScore,
      threshold: this.approveThreshold,
      reviewThreshold: this.reviewThreshold,
      decision,
      processingTime,
      mode: MODE_NAME,
      provider: PROVIDER_NAME,
      comparisonProvider: PROVIDER_NAME,
      embeddingDimension: null,
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      providerRequestId: response?.$metadata?.requestId || null,
      reference: referenceBinding,
      liveness: livenessBinding,
      current: {
        model: MANAGED_MODEL_NAME,
        imageSha256: livenessBinding.referenceImageSha256,
        faceMatchesCount: matches.length,
        unmatchedFacesCount: Array.isArray(response?.UnmatchedFaces)
          ? response.UnmatchedFaces.length
          : 0,
        sourceFaceConfidence: Number.isFinite(Number(response?.SourceImageFace?.Confidence))
          ? Number(response.SourceImageFace.Confidence)
          : null
      }
    };
    const { userId: _rawUserId, ...durableComparePayload } = normalizedResult;
    const durableResult = await this.persistGuardedCompareResult(
      liveness.costGuardOperationId,
      compareFingerprint,
      durableComparePayload
    );

    logStructured('info', 'Comparacao facial canonica AWS concluida', {
      service: 'canonical-aws-face-compare-service',
      provider: PROVIDER_NAME,
      driverId: safeDriverId,
      decision,
      similarityScore,
      faceMatchesCount: matches.length,
      durationMs: processingTime,
      estimatedUnitCostUsd: this.estimatedUnitCostUsd
    });

    return {
      ...durableResult,
      isMatch: decision === 'approve',
      needsReview: false,
      decision,
      userId: safeDriverId
    };
  }
}

module.exports = CanonicalAwsFaceCompareService;
module.exports.constants = Object.freeze({
  PROVIDER_NAME,
  MODE_NAME,
  LIVENESS_PROVIDER,
  APPROVED_CNH_SOURCE,
  MANAGED_MODEL_NAME,
  REFERENCE_BINDING_VERSION,
  MIN_CANONICAL_APPROVE_THRESHOLD,
  MAX_INLINE_IMAGE_BYTES
});
