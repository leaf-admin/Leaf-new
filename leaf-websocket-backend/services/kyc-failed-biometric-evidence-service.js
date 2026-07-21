const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const auditService = require('./audit-service');

const COLLECTION_NAME = 'kyc_failed_biometric_evidence';
const STORAGE_PREFIX = 'restricted/kyc-failed-biometric-evidence/v1';
const SCHEMA_VERSION = 1;
const RETENTION_DAYS = 30;
const MIN_READ_ACCESS_SECONDS = 30;
const DEFAULT_READ_ACCESS_SECONDS = 180;
const MAX_READ_ACCESS_SECONDS = 300;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const LIVENESS_PROVIDER = 'aws_rekognition_face_liveness';
const COMPARE_PROVIDER = 'aws_rekognition_compare_faces';
const COMPARE_MODE = 'server_aws_compare_faces_v1';
const CNH_REFERENCE_SOURCE = 'approved_cnh_pdf_crop_v1';
const MIN_CANONICAL_THRESHOLD = 0.95;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EVIDENCE_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const REVIEW_OUTCOMES = Object.freeze({
  FRAUD_CONFIRMED: 'fraud_confirmed',
  NO_FRAUD_CONFIRMED: 'no_fraud_confirmed',
  INCONCLUSIVE: 'inconclusive'
});
const ALLOWED_REVIEW_OUTCOMES = new Set(Object.values(REVIEW_OUTCOMES));

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return Date.parse(value);
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}

function normalizeRequiredString(value, label, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) {
    throw createError(`${label} obrigatorio ou invalido`, code);
  }
  return normalized;
}

function normalizeOptionalId(value, label, code) {
  if (value == null || value === '') return null;
  const normalized = normalizeRequiredString(value, label, code, 160);
  if (normalized.includes('/') || normalized.includes('..')) {
    throw createError(`${label} invalido`, code);
  }
  return normalized;
}

function normalizeSha256(value, label, code) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw createError(`${label} invalido`, code);
  }
  return normalized;
}

function identifyImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > MAX_IMAGE_BYTES) {
    throw createError(
      'ReferenceImage AWS ausente, vazia ou acima do limite',
      'KYC_FAILED_EVIDENCE_IMAGE_INVALID'
    );
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) return { contentType: 'image/jpeg', extension: 'jpg' };

  const isPng = buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
  if (isPng) return { contentType: 'image/png', extension: 'png' };

  throw createError(
    'ReferenceImage AWS deve estar em JPEG ou PNG',
    'KYC_FAILED_EVIDENCE_IMAGE_FORMAT_INVALID'
  );
}

function defaultEvidenceId() {
  return crypto.randomBytes(24).toString('hex');
}

class KycFailedBiometricEvidenceService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.firestoreProvider = options.firestoreProvider || (() => firebaseConfig.getFirestore());
    this.storageProvider = options.storageProvider || (() => firebaseConfig.getStorage());
    this.auditService = options.auditService || auditService;
    this.now = options.now || (() => new Date());
    this.idGenerator = options.idGenerator || defaultEvidenceId;
    this.collectionName = options.collectionName || COLLECTION_NAME;
    this.storagePrefix = options.storagePrefix || STORAGE_PREFIX;
    this.retentionDays = Number.isInteger(options.retentionDays)
      ? options.retentionDays
      : RETENTION_DAYS;
    this.bucketName = String(
      options.bucketName
      || this.env.FIREBASE_STORAGE_BUCKET
      || 'leaf-reactnative.firebasestorage.app'
    ).trim();
  }

  getFirestore() {
    const firestore = this.firestoreProvider?.();
    if (!firestore || typeof firestore.collection !== 'function') {
      throw createError(
        'Firestore indisponivel para evidencia biometrica',
        'KYC_FAILED_EVIDENCE_STORE_UNAVAILABLE'
      );
    }
    return firestore;
  }

  getBucket() {
    const storage = this.storageProvider?.();
    if (!storage || typeof storage.bucket !== 'function' || !this.bucketName) {
      throw createError(
        'Storage indisponivel para evidencia biometrica',
        'KYC_FAILED_EVIDENCE_STORAGE_UNAVAILABLE'
      );
    }
    return storage.bucket(this.bucketName);
  }

  evidenceDoc(evidenceId) {
    const safeEvidenceId = normalizeRequiredString(
      evidenceId,
      'evidenceId',
      'KYC_FAILED_EVIDENCE_ID_INVALID',
      128
    );
    if (!EVIDENCE_ID_PATTERN.test(safeEvidenceId)) {
      throw createError('evidenceId invalido', 'KYC_FAILED_EVIDENCE_ID_INVALID');
    }
    return this.getFirestore().collection(this.collectionName).doc(safeEvidenceId);
  }

  isExpired(metadata, now = this.now()) {
    const expiresAtMs = toMillis(metadata?.expiresAt);
    return !Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime();
  }

  assertActive(metadata, now = this.now()) {
    if (!metadata) {
      throw createError('Evidencia biometrica nao encontrada', 'KYC_FAILED_EVIDENCE_NOT_FOUND');
    }
    if (this.isExpired(metadata, now)) {
      throw createError('Evidencia biometrica expirada', 'KYC_FAILED_EVIDENCE_EXPIRED');
    }
  }

  validateCaptureInput({
    driverId,
    referenceImageBuffer,
    liveness,
    comparison,
    cnh,
    ticketId,
    caseId
  } = {}) {
    const safeDriverId = normalizeRequiredString(
      driverId,
      'driverId',
      'KYC_FAILED_EVIDENCE_DRIVER_REQUIRED',
      160
    );
    const image = identifyImage(referenceImageBuffer);
    const imageSha256 = sha256(referenceImageBuffer);
    const livenessData = liveness && typeof liveness === 'object' ? liveness : {};
    const comparisonData = comparison && typeof comparison === 'object' ? comparison : {};
    const canonicalReference = comparisonData.reference
      && typeof comparisonData.reference === 'object'
      ? comparisonData.reference
      : {};
    const cnhData = cnh && typeof cnh === 'object'
      ? cnh
      : canonicalReference;

    const livenessImageSha256 = normalizeSha256(
      livenessData.referenceImageSha256,
      'Hash da ReferenceImage AWS',
      'KYC_FAILED_EVIDENCE_LIVENESS_BINDING_INVALID'
    );
    const livenessSessionSha256 = normalizeSha256(
      livenessData.sessionIdHash || livenessData.sessionSha256,
      'Hash da sessao AWS',
      'KYC_FAILED_EVIDENCE_LIVENESS_BINDING_INVALID'
    );
    if (
      livenessData.provider !== LIVENESS_PROVIDER
      || String(livenessData.status || '').toUpperCase() !== 'SUCCEEDED'
      || livenessData.livenessPassed !== true
      || livenessImageSha256 !== imageSha256
    ) {
      throw createError(
        'Evidencia exige ReferenceImage de uma sessao AWS Liveness aprovada',
        'KYC_FAILED_EVIDENCE_LIVENESS_BINDING_INVALID'
      );
    }

    const compareProvider = String(
      comparisonData.provider || comparisonData.comparisonProvider || ''
    ).trim();
    const similarityScore = Number(comparisonData.similarityScore);
    const threshold = Number(comparisonData.threshold);
    const providerRequestId = normalizeRequiredString(
      comparisonData.providerRequestId,
      'providerRequestId',
      'KYC_FAILED_EVIDENCE_COMPARE_RESULT_INVALID',
      256
    );
    if (
      comparisonData.success !== true
      || comparisonData.decision !== 'reject'
      || comparisonData.isMatch !== false
      || comparisonData.needsReview !== false
      || compareProvider !== COMPARE_PROVIDER
      || comparisonData.mode !== COMPARE_MODE
      || canonicalReference.bindingVersion !== 3
      || canonicalReference.source !== CNH_REFERENCE_SOURCE
      || String(canonicalReference.documentType || '').toLowerCase() !== 'cnh'
      || !Number.isFinite(similarityScore)
      || similarityScore < 0
      || similarityScore > 1
      || !Number.isFinite(threshold)
      || threshold < MIN_CANONICAL_THRESHOLD
      || threshold > 1
      || similarityScore >= threshold
    ) {
      throw createError(
        'Evidencia permitida apenas para rejeicao canonica concluida pelo CompareFaces',
        'KYC_FAILED_EVIDENCE_COMPARE_RESULT_INVALID'
      );
    }

    return {
      driverId: safeDriverId,
      image,
      imageSha256,
      livenessSessionSha256,
      livenessProvider: LIVENESS_PROVIDER,
      compareProvider,
      providerRequestId,
      similarityScore,
      threshold,
      cnhSubmissionId: normalizeRequiredString(
        cnhData.submissionId,
        'CNH submissionId',
        'KYC_FAILED_EVIDENCE_CNH_BINDING_INVALID',
        256
      ),
      cnhDocumentSha256: normalizeSha256(
        cnhData.documentSha256,
        'Hash da CNH',
        'KYC_FAILED_EVIDENCE_CNH_BINDING_INVALID'
      ),
      ticketId: normalizeOptionalId(
        ticketId,
        'ticketId',
        'KYC_FAILED_EVIDENCE_TICKET_INVALID'
      ),
      caseId: normalizeOptionalId(
        caseId,
        'caseId',
        'KYC_FAILED_EVIDENCE_CASE_INVALID'
      )
    };
  }

  async recordAudit(eventData) {
    if (!this.auditService || typeof this.auditService.logEvent !== 'function') {
      throw createError(
        'Auditoria indisponivel para evidencia biometrica',
        'KYC_FAILED_EVIDENCE_AUDIT_UNAVAILABLE'
      );
    }
    const result = await this.auditService.logEvent(eventData);
    if (!result?.success) {
      throw createError(
        'Nao foi possivel auditar a operacao de evidencia biometrica',
        'KYC_FAILED_EVIDENCE_AUDIT_FAILED'
      );
    }
    return result;
  }

  async captureRejectedComparisonEvidence(input = {}) {
    const normalized = this.validateCaptureInput(input);
    const evidenceId = String(this.idGenerator()).trim();
    if (!EVIDENCE_ID_PATTERN.test(evidenceId)) {
      throw createError(
        'Gerador retornou evidenceId invalido',
        'KYC_FAILED_EVIDENCE_ID_GENERATION_FAILED'
      );
    }

    const createdAt = this.now();
    const expiresAt = new Date(
      createdAt.getTime() + (this.retentionDays * 24 * 60 * 60 * 1000)
    );
    const objectPath = `${this.storagePrefix}/${evidenceId}.${normalized.image.extension}`;
    const bucket = this.getBucket();
    const storageFile = bucket.file(objectPath);
    const docRef = this.evidenceDoc(evidenceId);
    let generation = null;
    let uploaded = false;
    let metadataPersisted = false;

    try {
      await storageFile.save(input.referenceImageBuffer, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: normalized.image.contentType,
          cacheControl: 'private, no-store, max-age=0',
          contentDisposition: 'inline',
          metadata: {
            classification: 'restricted_kyc_failed_biometric_evidence',
            evidenceId,
            sha256: normalized.imageSha256,
            expiresAt: expiresAt.toISOString()
          }
        }
      });
      uploaded = true;
      const [objectMetadata] = await storageFile.getMetadata();
      generation = String(objectMetadata?.generation || '').trim();
      if (!/^\d+$/.test(generation)) {
        throw createError(
          'Storage nao retornou generation canonica',
          'KYC_FAILED_EVIDENCE_STORAGE_GENERATION_MISSING'
        );
      }

      const metadata = {
        schemaVersion: SCHEMA_VERSION,
        evidenceId,
        driverId: normalized.driverId,
        state: 'available',
        objectPath,
        storageGeneration: generation,
        contentType: normalized.image.contentType,
        byteLength: input.referenceImageBuffer.length,
        referenceImageSha256: normalized.imageSha256,
        cnhSubmissionId: normalized.cnhSubmissionId,
        cnhDocumentSha256: normalized.cnhDocumentSha256,
        livenessSessionSha256: normalized.livenessSessionSha256,
        livenessProvider: normalized.livenessProvider,
        compareProvider: normalized.compareProvider,
        providerRequestId: normalized.providerRequestId,
        decision: 'reject',
        similarityScore: normalized.similarityScore,
        threshold: normalized.threshold,
        ticketId: normalized.ticketId,
        caseId: normalized.caseId,
        reviewOutcome: null,
        reviewedAt: null,
        reviewedBy: null,
        reviewReason: null,
        permanentBlockRecommended: false,
        createdAt,
        updatedAt: createdAt,
        expiresAt
      };

      if (typeof docRef.create === 'function') {
        await docRef.create(metadata);
      } else {
        await docRef.set(metadata);
      }
      metadataPersisted = true;

      await this.recordAudit({
        userId: normalized.driverId,
        action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_CAPTURED',
        resource: 'kyc_failed_biometric_evidence',
        severity: 'WARNING',
        success: true,
        details: {
          evidenceId,
          decision: 'reject',
          expiresAt: expiresAt.toISOString(),
          ticketId: normalized.ticketId,
          caseId: normalized.caseId
        }
      });

      return metadata;
    } catch (error) {
      if (uploaded) {
        try {
          await bucket
            .file(objectPath, generation ? { generation } : undefined)
            .delete({ ignoreNotFound: true });
        } catch (cleanupError) {
          const cleanupFailure = createError(
            'Falha ao remover evidencia biometrica apos gravacao incompleta',
            'KYC_FAILED_EVIDENCE_CLEANUP_FAILED'
          );
          cleanupFailure.evidenceId = evidenceId;
          cleanupFailure.cause = error;
          cleanupFailure.cleanupCause = cleanupError;
          throw cleanupFailure;
        }
      }
      if (metadataPersisted) {
        await docRef.delete();
      }
      throw error;
    }
  }

  async getMetadata(evidenceId, { includeExpired = false } = {}) {
    const snapshot = await this.evidenceDoc(evidenceId).get();
    if (!snapshot.exists) {
      throw createError('Evidencia biometrica nao encontrada', 'KYC_FAILED_EVIDENCE_NOT_FOUND');
    }
    const metadata = snapshot.data() || null;
    if (!includeExpired) this.assertActive(metadata);
    return metadata;
  }

  async updateMetadata(evidenceId, updater) {
    const firestore = this.getFirestore();
    const docRef = this.evidenceDoc(evidenceId);
    if (typeof firestore.runTransaction !== 'function') {
      throw createError(
        'Transacoes Firestore indisponiveis',
        'KYC_FAILED_EVIDENCE_STORE_UNAVAILABLE'
      );
    }

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        throw createError('Evidencia biometrica nao encontrada', 'KYC_FAILED_EVIDENCE_NOT_FOUND');
      }
      const current = snapshot.data() || {};
      this.assertActive(current);
      const result = updater(current);
      if (result?.unchanged === true) return { ...current, idempotentReplay: true };
      const patch = {
        ...(result?.patch || {}),
        updatedAt: this.now()
      };
      transaction.set(docRef, patch, { merge: true });
      return { ...current, ...patch, idempotentReplay: false };
    });
  }

  async linkTicket(evidenceId, {
    ticketId,
    caseId = null,
    actorId
  } = {}) {
    const safeTicketId = normalizeOptionalId(
      ticketId,
      'ticketId',
      'KYC_FAILED_EVIDENCE_TICKET_INVALID'
    );
    if (!safeTicketId) {
      throw createError('ticketId obrigatorio', 'KYC_FAILED_EVIDENCE_TICKET_INVALID');
    }
    const safeCaseId = normalizeOptionalId(
      caseId,
      'caseId',
      'KYC_FAILED_EVIDENCE_CASE_INVALID'
    );
    const safeActorId = normalizeRequiredString(
      actorId,
      'actorId',
      'KYC_FAILED_EVIDENCE_ACTOR_REQUIRED',
      160
    );

    const updated = await this.updateMetadata(evidenceId, (current) => {
      if (current.ticketId && current.ticketId !== safeTicketId) {
        throw createError(
          'Evidencia ja vinculada a outro chamado',
          'KYC_FAILED_EVIDENCE_TICKET_CONFLICT'
        );
      }
      if (safeCaseId && current.caseId && current.caseId !== safeCaseId) {
        throw createError(
          'Evidencia ja vinculada a outro caso',
          'KYC_FAILED_EVIDENCE_CASE_CONFLICT'
        );
      }
      if (current.ticketId === safeTicketId && (!safeCaseId || current.caseId === safeCaseId)) {
        return { unchanged: true };
      }
      return {
        patch: {
          ticketId: safeTicketId,
          caseId: safeCaseId || current.caseId || null,
          linkedAt: this.now(),
          linkedBy: safeActorId
        }
      };
    });

    await this.recordAudit({
      userId: safeActorId,
      action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_TICKET_LINKED',
      resource: 'kyc_failed_biometric_evidence',
      severity: 'WARNING',
      success: true,
      details: {
        evidenceId: updated.evidenceId,
        ticketId: safeTicketId,
        caseId: safeCaseId,
        idempotentReplay: updated.idempotentReplay === true
      }
    });
    return updated;
  }

  async createReadAccess(evidenceId, {
    actorId,
    ticketId,
    reason,
    ttlSeconds = DEFAULT_READ_ACCESS_SECONDS
  } = {}) {
    const safeActorId = normalizeRequiredString(
      actorId,
      'actorId',
      'KYC_FAILED_EVIDENCE_ACTOR_REQUIRED',
      160
    );
    const safeTicketId = normalizeOptionalId(
      ticketId,
      'ticketId',
      'KYC_FAILED_EVIDENCE_TICKET_INVALID'
    );
    const safeReason = normalizeRequiredString(
      reason,
      'Justificativa',
      'KYC_FAILED_EVIDENCE_ACCESS_REASON_REQUIRED',
      1000
    );
    const safeTtlSeconds = Number(ttlSeconds);
    if (
      !Number.isInteger(safeTtlSeconds)
      || safeTtlSeconds < MIN_READ_ACCESS_SECONDS
      || safeTtlSeconds > MAX_READ_ACCESS_SECONDS
    ) {
      throw createError(
        'TTL de acesso deve estar entre 30 e 300 segundos',
        'KYC_FAILED_EVIDENCE_ACCESS_TTL_INVALID'
      );
    }

    const metadata = await this.getMetadata(evidenceId);
    if (!safeTicketId || !metadata.ticketId || metadata.ticketId !== safeTicketId) {
      throw createError(
        'Acesso exige o chamado vinculado a evidencia',
        'KYC_FAILED_EVIDENCE_TICKET_REQUIRED'
      );
    }

    const now = this.now();
    const expiresAtMs = Math.min(
      now.getTime() + (safeTtlSeconds * 1000),
      toMillis(metadata.expiresAt)
    );
    const accessExpiresAt = new Date(expiresAtMs);
    const file = this.getBucket().file(
      metadata.objectPath,
      { generation: String(metadata.storageGeneration) }
    );
    const [objectMetadata] = await file.getMetadata();
    if (String(objectMetadata?.generation || '') !== String(metadata.storageGeneration)) {
      throw createError(
        'Generation da evidencia biometrica divergiu',
        'KYC_FAILED_EVIDENCE_STORAGE_GENERATION_MISMATCH'
      );
    }
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: accessExpiresAt,
      responseDisposition: 'inline'
    });
    if (!String(signedUrl || '').trim()) {
      throw createError(
        'Storage nao retornou acesso assinado',
        'KYC_FAILED_EVIDENCE_SIGNED_ACCESS_FAILED'
      );
    }

    await this.recordAudit({
      userId: safeActorId,
      action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_READ_ACCESS_GRANTED',
      resource: 'kyc_failed_biometric_evidence',
      severity: 'WARNING',
      success: true,
      details: {
        evidenceId: metadata.evidenceId,
        ticketId: safeTicketId,
        reason: safeReason,
        accessExpiresAt: accessExpiresAt.toISOString()
      }
    });

    return {
      evidenceId: metadata.evidenceId,
      signedUrl,
      expiresAt: accessExpiresAt.toISOString(),
      contentType: metadata.contentType,
      storageGeneration: String(metadata.storageGeneration)
    };
  }

  async recordReviewOutcome(evidenceId, {
    outcome,
    actorId,
    ticketId,
    caseId = null,
    reason
  } = {}) {
    const safeOutcome = String(outcome || '').trim().toLowerCase();
    if (!ALLOWED_REVIEW_OUTCOMES.has(safeOutcome)) {
      throw createError(
        'Resultado de revisao invalido',
        'KYC_FAILED_EVIDENCE_REVIEW_OUTCOME_INVALID'
      );
    }
    const safeActorId = normalizeRequiredString(
      actorId,
      'actorId',
      'KYC_FAILED_EVIDENCE_ACTOR_REQUIRED',
      160
    );
    const safeTicketId = normalizeOptionalId(
      ticketId,
      'ticketId',
      'KYC_FAILED_EVIDENCE_TICKET_INVALID'
    );
    const safeCaseId = normalizeOptionalId(
      caseId,
      'caseId',
      'KYC_FAILED_EVIDENCE_CASE_INVALID'
    );
    const safeReason = normalizeRequiredString(
      reason,
      'Justificativa',
      'KYC_FAILED_EVIDENCE_REVIEW_REASON_REQUIRED',
      1000
    );

    const updated = await this.updateMetadata(evidenceId, (current) => {
      if (!safeTicketId || !current.ticketId || current.ticketId !== safeTicketId) {
        throw createError(
          'Revisao exige o chamado vinculado a evidencia',
          'KYC_FAILED_EVIDENCE_TICKET_REQUIRED'
        );
      }
      if (safeCaseId && current.caseId && current.caseId !== safeCaseId) {
        throw createError(
          'Caso informado diverge da evidencia',
          'KYC_FAILED_EVIDENCE_CASE_CONFLICT'
        );
      }
      if (current.reviewOutcome) {
        if (
          current.reviewOutcome === safeOutcome
          && current.reviewedBy === safeActorId
          && current.reviewReason === safeReason
        ) {
          return { unchanged: true };
        }
        throw createError(
          'Evidencia ja possui uma decisao final de revisao',
          'KYC_FAILED_EVIDENCE_REVIEW_CONFLICT'
        );
      }
      return {
        patch: {
          caseId: safeCaseId || current.caseId || null,
          reviewOutcome: safeOutcome,
          reviewedAt: this.now(),
          reviewedBy: safeActorId,
          reviewReason: safeReason,
          permanentBlockRecommended: safeOutcome === REVIEW_OUTCOMES.FRAUD_CONFIRMED
        }
      };
    });

    await this.recordAudit({
      userId: safeActorId,
      action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_REVIEW_RECORDED',
      resource: 'kyc_failed_biometric_evidence',
      severity: safeOutcome === REVIEW_OUTCOMES.FRAUD_CONFIRMED ? 'CRITICAL' : 'WARNING',
      success: true,
      details: {
        evidenceId: updated.evidenceId,
        ticketId: safeTicketId,
        caseId: safeCaseId || updated.caseId || null,
        outcome: safeOutcome,
        permanentBlockRecommended: safeOutcome === REVIEW_OUTCOMES.FRAUD_CONFIRMED,
        reason: safeReason,
        idempotentReplay: updated.idempotentReplay === true
      }
    });
    return updated;
  }

  async deleteEvidence(evidenceId, {
    actorId,
    reason
  } = {}) {
    const safeActorId = normalizeRequiredString(
      actorId,
      'actorId',
      'KYC_FAILED_EVIDENCE_ACTOR_REQUIRED',
      160
    );
    const safeReason = normalizeRequiredString(
      reason,
      'Justificativa',
      'KYC_FAILED_EVIDENCE_DELETE_REASON_REQUIRED',
      1000
    );
    let metadata;
    try {
      metadata = await this.getMetadata(evidenceId, { includeExpired: true });
    } catch (error) {
      if (error?.code === 'KYC_FAILED_EVIDENCE_NOT_FOUND') {
        return { evidenceId: String(evidenceId || ''), deleted: false };
      }
      throw error;
    }

    await this.recordAudit({
      userId: safeActorId,
      action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_DELETION_AUTHORIZED',
      resource: 'kyc_failed_biometric_evidence',
      severity: 'WARNING',
      success: true,
      details: {
        evidenceId: metadata.evidenceId,
        ticketId: metadata.ticketId || null,
        caseId: metadata.caseId || null,
        reason: safeReason,
        expired: this.isExpired(metadata)
      }
    });

    const file = this.getBucket().file(
      metadata.objectPath,
      { generation: String(metadata.storageGeneration) }
    );
    await file.delete({ ignoreNotFound: true });
    await this.evidenceDoc(metadata.evidenceId).delete();

    return { evidenceId: metadata.evidenceId, deleted: true };
  }

  async deleteExpiredEvidence(evidenceId, {
    actorId = 'system-retention',
    reason = 'retention_expired'
  } = {}) {
    const metadata = await this.getMetadata(evidenceId, { includeExpired: true });
    if (!this.isExpired(metadata)) {
      return { evidenceId: metadata.evidenceId, deleted: false, expired: false };
    }
    const result = await this.deleteEvidence(evidenceId, { actorId, reason });
    return { ...result, expired: true };
  }
}

const singleton = new KycFailedBiometricEvidenceService();

module.exports = singleton;
module.exports.KycFailedBiometricEvidenceService = KycFailedBiometricEvidenceService;
module.exports.REVIEW_OUTCOMES = REVIEW_OUTCOMES;
module.exports.constants = Object.freeze({
  COLLECTION_NAME,
  STORAGE_PREFIX,
  SCHEMA_VERSION,
  RETENTION_DAYS,
  MIN_READ_ACCESS_SECONDS,
  DEFAULT_READ_ACCESS_SECONDS,
  MAX_READ_ACCESS_SECONDS,
  MAX_IMAGE_BYTES,
  LIVENESS_PROVIDER,
  COMPARE_PROVIDER,
  COMPARE_MODE,
  CNH_REFERENCE_SOURCE,
  MIN_CANONICAL_THRESHOLD
});
module.exports.createError = createError;
