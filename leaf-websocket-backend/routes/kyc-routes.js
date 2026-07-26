const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const IntegratedKYCService = require('../services/IntegratedKYCService');
const AwsFaceLivenessService = require('../services/aws-face-liveness-service');
const CanonicalAwsFaceCompareService = require('../services/canonical-aws-face-compare-service');
const { resolveKycRuntimeForUser } = require('../services/kyc-runtime-scope-service');
const {
  assertStoredRecordMatchesScope,
  buildScopedPersistenceEnvelope
} = require('../services/sandbox-persistence-context');
const canonicalDriverDocumentApprovalService = require('../services/canonical-driver-document-approval-service');
const { evaluateProductionReadiness } = require('../services/kyc-biometric-production-policy');
const { requireFirebaseUser, requireFirebaseSelf } = require('../middleware/firebase-user-auth');
const { logStructured, logError } = require('../utils/logger');
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'kyc-routes-routes' });
}

const bodyUserId = (req) => req.body?.userId;
const paramUserId = (req) => req.params?.userId;
const queryUserId = (req) => req.query?.userId;

function withoutSensitiveBiometricPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const {
    embedding,
    embeddingA,
    embeddingB,
    ...safePayload
  } = payload;
  return safePayload;
}

function buildPublicCanonicalCompareResult(payload = {}, overrides = {}) {
  const source = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    ...(overrides && typeof overrides === 'object' ? overrides : {})
  };
  const result = {
    success: source.success === true
  };
  const booleanFields = [
    'isMatch',
    'needsReview',
    'retryable',
    'idempotentReconciliation'
  ];
  const resourceFields = [
    'code',
    'error',
    'requirement',
    'challengeId'
  ];
  const reviewCaseId = typeof source.reviewCaseId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(source.reviewCaseId.trim())
    ? source.reviewCaseId.trim()
    : null;
  const evidenceId = typeof source.evidenceId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(source.evidenceId.trim())
    ? source.evidenceId.trim()
    : null;
  const hasPublicReview = source.reviewAvailable === true && Boolean(reviewCaseId || evidenceId);

  for (const field of booleanFields) {
    if (typeof source[field] === 'boolean') {
      result[field] = source[field];
    }
  }
  for (const field of resourceFields) {
    if (source[field] === null || typeof source[field] === 'string') {
      result[field] = source[field];
    }
  }
  if (typeof source.reviewAvailable === 'boolean') {
    result.reviewAvailable = hasPublicReview;
  }
  if (hasPublicReview && reviewCaseId) {
    result.reviewCaseId = reviewCaseId;
  }
  if (hasPublicReview && evidenceId) {
    result.evidenceId = evidenceId;
  }

  return result;
}

function resolvePublicAwsLivenessCredentialsFailure(code) {
  if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') {
    return {
      error: 'A validação deve ser feita fora de uma corrida.',
      retryable: true
    };
  }
  if (code === 'AWS_LIVENESS_SESSION_ABANDONED') {
    return {
      error: 'Esta sessão foi encerrada. Inicie uma nova validação.',
      retryable: false
    };
  }
  if (['AWS_LIVENESS_SESSION_METADATA_REQUIRED', 'AWS_LIVENESS_SESSION_EXPIRED'].includes(code)) {
    return {
      error: 'Esta sessão expirou. Inicie uma nova validação.',
      retryable: false
    };
  }
  if ([
    'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED',
    'AWS_LIVENESS_SESSION_USER_MISMATCH',
    'AccessDenied',
    'AccessDeniedException',
    'ValidationError',
    'ValidationException'
  ].includes(code)) {
    return {
      error: 'Não foi possível usar esta sessão de validação.',
      retryable: false
    };
  }
  return {
    error: 'Não foi possível preparar a validação agora. Tente novamente em alguns minutos.',
    retryable: true
  };
}

function resolvePublicCanonicalConflictFailure(code, { stateUnavailable = false } = {}) {
  if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') {
    return {
      error: 'A validação deve ser feita fora de uma corrida.',
      retryable: true
    };
  }
  if (code === 'KYC_VERIFICATION_LEASE_LOST') {
    return {
      error: 'Não foi possível confirmar esta validação. Tente novamente em alguns instantes.',
      retryable: true
    };
  }
  if (code === 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE') {
    return {
      error: 'Esta solicitação foi substituída por uma validação mais recente.',
      retryable: false
    };
  }
  if (code === 'AWS_LIVENESS_SESSION_ABANDONED') {
    return {
      error: 'Esta sessão foi encerrada. Inicie uma nova validação.',
      retryable: false
    };
  }
  if (code === 'KYC_IDENTITY_REVIEW_HOLD') {
    return {
      error: 'Sua identidade está sendo analisada. Avisaremos quando houver uma atualização.',
      retryable: false
    };
  }
  if (code === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK') {
    return {
      error: 'Esta conta não pode usar o modo motorista.',
      retryable: false
    };
  }
  if ([
    'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT',
    'KYC_CANONICAL_CHALLENGE_BINDING_INVALID',
    'KYC_CANONICAL_CHALLENGE_NOT_FOUND'
  ].includes(code)) {
    return {
      error: 'Não foi possível confirmar esta validação com segurança.',
      retryable: false
    };
  }
  if (stateUnavailable) {
    return {
      error: 'A validação está temporariamente indisponível. Tente novamente em alguns minutos.',
      retryable: true
    };
  }
  return {
    error: 'Não foi possível confirmar esta validação agora.',
    retryable: false
  };
}

function normalizeLivenessAttemptScope(value) {
  const normalized = String(value || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 64);
  return normalized || 'general';
}

function sendIdentityReviewGateResponse(res, identityReviewGate = {}) {
  const reviewCaseId = typeof identityReviewGate.holdCaseId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(identityReviewGate.holdCaseId.trim())
    ? identityReviewGate.holdCaseId.trim()
    : null;
  const evidenceId = typeof identityReviewGate.holdEvidenceId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(identityReviewGate.holdEvidenceId.trim())
    ? identityReviewGate.holdEvidenceId.trim()
    : null;
  const hasTraceableReview = Boolean(
    (reviewCaseId || evidenceId) && identityReviewGate.reviewAvailable === true
  );

  return res.status(423).json({
    success: false,
    error: hasTraceableReview && reviewCaseId
      ? 'Sua identidade esta sendo analisada. Avisaremos quando houver uma atualizacao.'
      : hasTraceableReview
        ? 'Nao foi possivel confirmar sua identidade. Voce pode solicitar uma analise.'
        : 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
    code: hasTraceableReview
      ? 'KYC_IDENTITY_REVIEW_HOLD'
      : 'KYC_IDENTITY_RECOVERY_REQUIRED',
    reviewAvailable: hasTraceableReview,
    ...(hasTraceableReview && reviewCaseId ? { reviewCaseId } : {}),
    ...(hasTraceableReview && evidenceId ? { evidenceId } : {})
  });
}

async function persistIdentityMismatchHold(driverId, {
  evidenceId = null,
  decision = 'reject',
  persistenceScope = null
} = {}) {
  const firestore = firebaseConfig?.getFirestore?.();
  if (!firestore) {
    const error = new Error('Firestore indisponivel para o hold de identidade');
    error.code = 'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE';
    throw error;
  }
  if (!persistenceScope?.collections?.driverIdentityEnforcement) {
    const error = new Error('Escopo de persistencia KYC indisponivel');
    error.code = 'KYC_PERSISTENCE_SCOPE_REQUIRED';
    throw error;
  }
  const ref = firestore
    .collection(persistenceScope.collections.driverIdentityEnforcement)
    .doc(driverId);
  const nowIso = new Date().toISOString();
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? (snapshot.data() || {}) : {};
    if (snapshot.exists) {
      assertStoredRecordMatchesScope(current, persistenceScope);
    }
    if (
      current.active === true &&
      (current.permanent === true || String(current.status || '').toUpperCase() === 'PERMANENTLY_BLOCKED')
    ) {
      return current;
    }
    const next = {
      ...current,
      ...buildScopedPersistenceEnvelope(persistenceScope, {
        record: snapshot.exists ? current : null
      }),
      schemaVersion: 1,
      driverId,
      status: 'IDENTITY_MISMATCH_HOLD',
      active: true,
      permanent: false,
      reasonCode: 'CANONICAL_FACE_COMPARE_MISMATCH',
      evidenceId: evidenceId || current.evidenceId || null,
      decision,
      retryAllowed: false,
      identityApproved: false,
      createdAt: current.createdAt || nowIso,
      updatedAt: nowIso
    };
    [
      'caseId',
      'ticketId',
      'evidenceBindingHash',
      'recoveryId',
      'failureEvidenceId',
      'resultEvidenceId',
      'retryAuthorizationId',
      'retryAuthorizationKind',
      'retryConsumedAt',
      'primaryCaseId',
      'latestCaseId',
      'corroboratingCaseIds'
    ].forEach((field) => {
      delete next[field];
    });
    next.evidenceId = evidenceId || null;
    transaction.set(ref, next, { merge: false });
    return next;
  });
}

function resolveRequestKycRuntime(req, userId) {
  return resolveKycRuntimeForUser({
    userId,
    phone: req?.authenticatedUser?.phoneNumber || req?.firebaseUser?.phone_number || null,
    actor: req?.authenticatedUser || req?.firebaseUser || null
  });
}

function getKycSessionPersistenceBinding(kycRuntime) {
  const persistenceNamespace = String(kycRuntime?.scope?.namespace || '').trim();
  const financialContextId = String(kycRuntime?.scope?.financialContextId || '').trim();
  if (!['operational', 'sandbox'].includes(persistenceNamespace) || !financialContextId) {
    const error = new Error('Escopo KYC nao pode ser vinculado a sessao AWS');
    error.code = 'KYC_AWS_LIVENESS_PERSISTENCE_BINDING_REQUIRED';
    throw error;
  }
  return {
    persistenceNamespace,
    financialContextId
  };
}

function getExpectedKycSessionPersistenceBinding(kycRuntime) {
  const binding = getKycSessionPersistenceBinding(kycRuntime);
  return {
    expectedPersistenceNamespace: binding.persistenceNamespace,
    expectedFinancialContextId: binding.financialContextId
  };
}

function isIdentityReverificationRequest({ challengeId = null, requirement = null } = {}) {
  return requirement === 'IDENTITY_REVERIFICATION'
    || String(challengeId || '').startsWith('idrev_');
}

function resolveLivenessAttemptScope({
  challenge = null,
  challengeId = null,
  requirement = null,
  authorizedAttemptScope = null
} = {}) {
  const source = normalizeLivenessAttemptScope(challenge?.source || '');
  if (source === 'withdrawal' || source === 'driver_online') {
    return source;
  }

  if (isIdentityReverificationRequest({ challengeId, requirement })) {
    const reviewScope = normalizeLivenessAttemptScope(authorizedAttemptScope || '');
    if (
      reviewScope.startsWith('manual_review_retry_')
      || reviewScope.startsWith('orphan_hold_retry_')
    ) {
      return reviewScope;
    }
    return 'identity_reverification';
  }

  if (!challengeId && requirement === 'LIVENESS_REQUIRED') {
    return 'first_access';
  }

  return source !== 'general'
    ? source
    : normalizeLivenessAttemptScope(requirement || 'general');
}

function assertPersistedRetrySessionResumable({
  userId,
  challengeId,
  requirement,
  attemptScope,
  attemptState,
  sessionMetadata
} = {}) {
  const sessionId = typeof attemptState?.lastSessionId === 'string'
    ? attemptState.lastSessionId.trim()
    : '';
  if (!sessionId) {
    const error = new Error('A sessao anterior nao foi encontrada para retomada');
    error.code = 'KYC_IDENTITY_RETRY_RESUME_SESSION_NOT_FOUND';
    throw error;
  }
  if (
    attemptState?.userId !== userId
    || sessionMetadata?.userId !== userId
    || attemptState?.requirement !== requirement
    || attemptState?.attemptScope !== attemptScope
    || sessionMetadata?.attemptScope !== attemptScope
  ) {
    const error = new Error('A sessao anterior nao corresponde a esta autorizacao');
    error.code = 'KYC_IDENTITY_RETRY_RESUME_BINDING_INVALID';
    throw error;
  }
  if (
    (sessionMetadata?.challengeId || null) !== (challengeId || null)
    || (sessionMetadata?.requirement || null) !== (requirement || null)
  ) {
    const error = new Error('A sessao anterior pertence a outro desafio');
    error.code = 'KYC_IDENTITY_RETRY_RESUME_CHALLENGE_INVALID';
    throw error;
  }

  const providerStatuses = [
    sessionMetadata?.status,
    sessionMetadata?.lastStatus,
    attemptState?.lastStatus
  ]
    .map((status) => String(status || '').trim().toUpperCase())
    .filter(Boolean);
  const providerStatus = providerStatuses[0] || 'CREATED';
  const completedSuccessfully = providerStatus === 'SUCCEEDED'
    && sessionMetadata?.livenessPassed === true;
  if (
    (sessionMetadata?.completedAt && !completedSuccessfully)
    || sessionMetadata?.abandonedAt
    || providerStatuses.some((status) => (
      !['CREATED', 'IN_PROGRESS', 'SUCCEEDED'].includes(status)
      || (status === 'SUCCEEDED' && !completedSuccessfully)
    ))
  ) {
    const error = new Error('A sessao anterior ja foi encerrada e nao pode ser retomada');
    error.code = 'KYC_IDENTITY_RETRY_RESUME_SESSION_TERMINAL';
    throw error;
  }

  const verificationWindowToken = typeof sessionMetadata?.verificationWindowToken === 'string'
    ? sessionMetadata.verificationWindowToken.trim()
    : '';
  if (!verificationWindowToken) {
    const error = new Error('A sessao anterior perdeu o vinculo da janela de verificacao');
    error.code = 'KYC_IDENTITY_RETRY_RESUME_WINDOW_BINDING_REQUIRED';
    throw error;
  }
  return {
    sessionId,
    verificationWindowToken,
    status: providerStatus,
    completed: completedSuccessfully,
    livenessPassed: completedSuccessfully
  };
}

function buildResumedLivenessSessionResponse({
  provider,
  sessionId,
  sessionMetadata,
  config
} = {}) {
  const status = String(
    sessionMetadata.status || sessionMetadata.lastStatus || 'CREATED'
  ).trim().toUpperCase();
  const completedSuccessfully = status === 'SUCCEEDED'
    && sessionMetadata.livenessPassed === true;
  return buildPublicLivenessSessionResponse({
    provider,
    region: config.region,
    sessionId,
    challengeType: sessionMetadata.challengeType || config.challengeType,
    expiresAt: sessionMetadata.expiresAt,
    status,
    ...(completedSuccessfully
      ? { completed: true, livenessPassed: true }
      : {})
  });
}

function buildPublicLivenessSessionResponse(payload = {}) {
  const response = { success: true };
  for (const field of [
    'provider',
    'region',
    'sessionId',
    'challengeType',
    'expiresAt',
    'status'
  ]) {
    if (typeof payload[field] === 'string' && payload[field].trim()) {
      response[field] = payload[field].trim();
    }
  }
  if (typeof payload.completed === 'boolean') {
    response.completed = payload.completed;
  }
  if (payload.completed === true && typeof payload.livenessPassed === 'boolean') {
    response.livenessPassed = payload.livenessPassed;
  }
  return response;
}

function createIdentityLeaseHeartbeat(renew, intervalMs = 10 * 1000) {
  let stopped = false;
  let lost = false;
  let inFlight = null;

  const renewNow = async () => {
    if (stopped) return !lost;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => renew())
      .then((held) => {
        if (held !== true) lost = true;
        return held === true;
      })
      .catch(() => {
        lost = true;
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const timer = setInterval(() => {
    void renewNow();
  }, intervalMs);
  timer.unref?.();

  return {
    async assertHeld() {
      if (lost || !(await renewNow())) {
        const error = new Error('A trava da verificacao expirou; tente novamente fora de corrida');
        error.code = 'KYC_VERIFICATION_LEASE_LOST';
        throw error;
      }
      return true;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

function requiresCanonicalVerificationRoute({
  awsSessionId = null,
  challenge = null,
  requirement = null,
  firstAccessLivenessRequired = false
} = {}) {
  return Boolean(
    awsSessionId
    || challenge?.metadata?.canonicalEvidenceRequired === true
    || requirement === 'LIVENESS_REQUIRED'
    || requirement === 'IDENTITY_REVERIFICATION'
    || firstAccessLivenessRequired
  );
}

function sendCanonicalRouteRequired(res) {
  return res.status(409).json({
    success: false,
    error: 'Inicie uma nova validacao de identidade pelo aplicativo.',
    code: 'KYC_CANONICAL_ROUTE_REQUIRED',
    endpoint: '/api/kyc/verify-driver/server-side-selfie'
  });
}

function sendSandboxLegacyRouteDisabled(res) {
  return res.status(409).json({
    success: false,
    error: 'Esta etapa antiga nao esta disponivel para sua conta de teste. Use o fluxo atual de validacao.',
    code: 'KYC_SANDBOX_LEGACY_ROUTE_DISABLED'
  });
}

async function requireOperationalLegacyKycRoute(req, res, next) {
  try {
    const userId = String(
      req?.authenticatedUser?.uid || req?.firebaseUser?.uid || ''
    ).trim();
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Sua sessao expirou. Entre novamente para continuar.',
        code: 'KYC_AUTHENTICATED_USER_REQUIRED'
      });
    }
    const kycRuntime = await resolveRequestKycRuntime(req, userId);
    if (kycRuntime.namespace === 'sandbox') {
      return sendSandboxLegacyRouteDisabled(res);
    }
    req.legacyKycRuntime = kycRuntime;
    return next();
  } catch (error) {
    logError(error, 'Falha ao classificar runtime antes de rota KYC legada', {
      service: 'kyc-routes-routes'
    });
    return res.status(503).json({
      success: false,
      error: 'Nao foi possivel preparar esta etapa agora. Tente novamente em alguns minutos.',
      code: 'KYC_RUNTIME_SCOPE_UNAVAILABLE'
    });
  }
}

function resolveLivenessRetryWindow(source = {}) {
  const attemptState = source?.attemptState && typeof source.attemptState === 'object'
    ? source.attemptState
    : source;
  const suppliedRetryAt = source?.retryAt || attemptState?.retryAt || null;
  const suppliedRetryAtMs = Date.parse(suppliedRetryAt || '');
  const suppliedRetryAfterSeconds = Number(
    source?.retryAfterSeconds ?? attemptState?.retryAfterSeconds
  );
  const nowMs = Date.now();
  const retryAfterFromTimestamp = Number.isFinite(suppliedRetryAtMs)
    ? Math.ceil((suppliedRetryAtMs - nowMs) / 1000)
    : 0;
  const retryAfterSeconds = Math.max(
    1,
    Number.isFinite(suppliedRetryAfterSeconds)
      ? Math.ceil(suppliedRetryAfterSeconds)
      : 0,
    retryAfterFromTimestamp
  );
  const retryAt = Number.isFinite(suppliedRetryAtMs) && suppliedRetryAtMs > nowMs
    ? new Date(suppliedRetryAtMs).toISOString()
    : new Date(nowMs + (retryAfterSeconds * 1000)).toISOString();

  return {
    retryAt,
    retryAfterSeconds
  };
}

function sendLivenessAttemptRateLimit(res, source = {}) {
  const retryWindow = resolveLivenessRetryWindow(source);
  res.set('Retry-After', String(retryWindow.retryAfterSeconds));
  return res.status(429).json({
    success: false,
    error: 'Aguarde um pouco antes de iniciar uma nova validação.',
    code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
    retryable: true,
    retryAt: retryWindow.retryAt,
    retryAfterSeconds: retryWindow.retryAfterSeconds
  });
}

function isLivenessAttemptRateLimited(result = {}) {
  return result?.completed === true
    && result?.livenessPassed !== true
    && result?.attemptState?.attemptsExhausted === true;
}

class KYCRoutes {
  constructor() {
    this.router = express.Router();
    this.kycService = new IntegratedKYCService();
    this.awsLivenessService = new AwsFaceLivenessService();
    this.awsFaceCompareService = new CanonicalAwsFaceCompareService();
    this.cnhFaceBiometricService = null;
    this.firebaseStorageService = null;
    this.canonicalDriverDocumentApprovalService = canonicalDriverDocumentApprovalService;
    this.initializeUpload();
    this.initializeRoutes();
  }

  usesAwsCanonicalFaceCompare() {
    return String(process.env.KYC_FACE_COMPARE_PROVIDER || '')
      .trim()
      .toLowerCase() === 'aws_rekognition_compare_faces';
  }

  async loadCanonicalApprovedCnhPortrait(userId) {
    if (!this.cnhFaceBiometricService) {
      const CnhFaceBiometricService = require('../services/cnh-face-biometric-service');
      this.cnhFaceBiometricService = new CnhFaceBiometricService();
    }
    if (!this.firebaseStorageService) {
      const FirebaseStorageService = require('../services/firebase-storage-service');
      this.firebaseStorageService = new FirebaseStorageService();
    }
    const document = await this.canonicalDriverDocumentApprovalService.requireApprovedCnh(userId);
    const status = String(document.status || '').trim().toLowerCase();
    const analysisStatus = String(document.analysisStatus || '').trim().toLowerCase();
    const submissionId = String(document.submissionId || '').trim();
    const documentPath = String(document.filePath || '').trim();
    const documentSha256 = String(document.documentSha256 || '').trim().toLowerCase();
    const storageGeneration = String(document.storageGeneration || '').trim();
    const createdAt = document.reviewedAt;
    const downloaded = await this.firebaseStorageService.downloadStoragePath(documentPath, {
      generation: storageGeneration,
      includeMetadata: true
    });
    const documentBuffer = downloaded.buffer;
    const actualDocumentSha256 = crypto
      .createHash('sha256')
      .update(documentBuffer)
      .digest('hex');
    if (
      downloaded.metadata?.generation !== storageGeneration
      || actualDocumentSha256 !== documentSha256
    ) {
      const error = new Error('PDF da CNH diverge da aprovacao canonica');
      error.code = 'KYC_CANONICAL_CNH_DOCUMENT_INTEGRITY_MISMATCH';
      throw error;
    }
    const portrait = await this.cnhFaceBiometricService.extractCnhPortraitImage(
      documentBuffer,
      { allowFullPageFallback: false }
    );
    if (portrait.source !== 'approved_cnh_pdf_crop_v1') {
      const error = new Error('A referência canônica deve vir do recorte do PDF da CNH aprovada');
      error.code = 'KYC_CANONICAL_CNH_PDF_CROP_REQUIRED';
      throw error;
    }

    return {
      sourceImageBuffer: portrait.imageBuffer,
      reference: {
        bindingVersion: 3,
        source: portrait.source,
        documentType: 'cnh',
        status,
        analysisStatus,
        approvalSource: document.approvalSource,
        reviewedBy: document.reviewedBy,
        reviewedAt: document.reviewedAt,
        submissionId,
        documentPath,
        documentPathSha256: crypto.createHash('sha256').update(documentPath).digest('hex'),
        documentSha256,
        storageGeneration,
        imageSha256: portrait.imageSha256,
        cropVersion: portrait.cropVersion,
        createdAt
      }
    };
  }

  async verifyCanonicalFaceMatch(userId, awsResult, options = {}) {
    if (!this.usesAwsCanonicalFaceCompare()) {
      return this.kycService.verifyDriverServerSideSelfie(
        userId,
        awsResult.referenceImageBuffer,
        options
      );
    }

    const approvedCnh = await this.loadCanonicalApprovedCnhPortrait(userId);
    return this.awsFaceCompareService.verifyApprovedCnhAgainstLiveness({
      driverId: userId,
      sourceImageBuffer: approvedCnh.sourceImageBuffer,
      livenessReferenceImageBuffer: awsResult.referenceImageBuffer,
      reference: approvedCnh.reference,
      liveness: {
        provider: awsResult.provider,
        sessionId: awsResult.sessionId,
        status: awsResult.status,
        livenessPassed: awsResult.livenessPassed === true,
        confidence: awsResult.confidence,
        threshold: awsResult.confidenceThreshold,
        costGuardOperationId: awsResult.sessionMetadata?.costGuardOperationId || null,
        referenceImageSha256: crypto
          .createHash('sha256')
          .update(awsResult.referenceImageBuffer)
          .digest('hex'),
        referenceImageBoundingBox: awsResult.referenceImageBoundingBox || null
      }
    });
  }

  initializeUpload() {
    // Configurar multer para upload de imagens
    // ✅ CORREÇÃO: Aumentar limite de tamanho para uploads de CNH
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 5MB)
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
    // Middleware para verificar inicialização
    this.router.use(async (req, res, next) => {
      if (!this.kycService.initialized) {
        return res.status(503).json({
          success: false,
          error: 'KYC Service ainda não inicializado',
          retryAfter: 5
        });
      }
      next();
    });

    this.router.get('/liveness/provider', requireFirebaseUser, async (_req, res) => {
      try {
        const config = this.awsLivenessService.getConfigSummary();
        return res.json({
          success: true,
          provider: this.awsLivenessService.getProviderName(),
          config: {
            enabled: config.enabled === true,
            credentialsEnabled: config.credentialsEnabled === true,
            hasAssumeRoleArn: config.hasAssumeRoleArn === true
          }
        });
      } catch (error) {
        logError(error, 'Erro ao consultar provider de liveness', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor'
        });
      }
    });

    this.router.get('/biometrics/readiness', requireFirebaseUser, async (_req, res) => {
      try {
        const readiness = evaluateProductionReadiness(process.env);
        const ready = readiness.ok === true
          && readiness.enabled === true
          && readiness.policy?.productionRuntime === true
          && readiness.policy?.productionBiometricsEnabled === true
          && readiness.policy?.strictProductionMode === true;
        return res.status(ready ? 200 : 503).json({
          success: ready,
          ready,
          code: ready ? 'KYC_BIOMETRICS_READY' : 'KYC_BIOMETRICS_NOT_READY'
        });
      } catch (error) {
        logError(error, 'Erro ao consultar prontidão biométrica', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          ready: false,
          code: 'KYC_BIOMETRICS_READINESS_UNAVAILABLE',
          error: 'Erro interno do servidor'
        });
      }
    });

    this.router.post(
      '/liveness/aws/session',
      requireFirebaseUser,
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let cleanRetryAuthorizationClaim = null;
      let cleanRetrySessionCreated = false;
      let kycRuntime = null;
      try {
        const { userId, challengeId, requirement } = req.body || {};
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        const {
          trustService,
          workflowService,
          policyService
        } = kycRuntime;

        const identityReviewGate = await workflowService
          .assertKycOperationAllowed(userId);
        if (
          identityReviewGate.identityReviewHold
          && identityReviewGate.retrySessionResumeCandidate !== true
        ) {
          return sendIdentityReviewGateResponse(res, identityReviewGate);
        }

        let effectiveChallengeId = typeof challengeId === 'string' && challengeId.trim()
          ? challengeId.trim()
          : null;
        let challenge = null;
        let authorizedAttemptScope = null;
        let identityChallengeAlreadyValidating = false;
        let canonicalRetryIdentityState = null;
        let effectiveRequirement = typeof requirement === 'string' && requirement.trim()
          ? requirement.trim()
          : null;

        if (
          kycRuntime.namespace === 'operational'
          && (
            identityReviewGate.cleanRetryAuthorized === true
            || (
              identityReviewGate.retrySessionResumeCandidate === true
              && !isIdentityReverificationRequest({
                challengeId: effectiveChallengeId,
                requirement: effectiveRequirement
              })
            )
          )
        ) {
          const retryAuthorizationId = String(
            identityReviewGate.retryAuthorizationId || ''
          ).trim().toLowerCase();
          const retryScopePrefix = identityReviewGate.retryAuthorizationKind === 'manual_review'
            ? 'manual_review_retry_'
            : (identityReviewGate.retryAuthorizationKind === 'orphan_hold'
              ? 'orphan_hold_retry_'
              : '');
          const identityState = await Promise.resolve(
            firebaseConfig?.getFromRealtimeDB?.(`users/${userId}/identityReverification`)
          ).catch(() => null);
          canonicalRetryIdentityState = identityState;
          const canonicalChallengeId = String(identityState?.challengeId || '').trim();
          const canonicalRequirement = String(identityState?.requirement || '').trim();
          const canonicalStatus = String(identityState?.status || '').trim().toLowerCase();
          const canonicalAttemptScope = normalizeLivenessAttemptScope(
            identityState?.attemptScope || ''
          );
          const expectedAttemptScope = retryScopePrefix && retryAuthorizationId
            ? `${retryScopePrefix}${retryAuthorizationId}`
            : '';
          const canonicalBindingValid = Boolean(
            canonicalChallengeId.startsWith('idrev_')
            && canonicalRequirement === 'IDENTITY_REVERIFICATION'
            && ['requested', 'failed', 'validating'].includes(canonicalStatus)
            && expectedAttemptScope
            && canonicalAttemptScope === expectedAttemptScope
          );
          if (!canonicalBindingValid) {
            const error = new Error('A nova tentativa perdeu o vinculo de autorizacao');
            error.code = 'KYC_IDENTITY_RETRY_BINDING_REQUIRED';
            throw error;
          }
          effectiveChallengeId = canonicalChallengeId;
          effectiveRequirement = canonicalRequirement;
        }
        const isIdentityReverification = isIdentityReverificationRequest({
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement
        });

        if (effectiveChallengeId && !isIdentityReverification) {
          challenge = await policyService.getStepUpChallenge(effectiveChallengeId, userId);
          if (!challenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = challenge.requirement || effectiveRequirement || 'VERIFY_REQUIRED';
        } else if (isIdentityReverification) {
          const identityState = kycRuntime.namespace === 'sandbox'
            ? await policyService.getStepUpChallenge(effectiveChallengeId, userId)
            : (canonicalRetryIdentityState || await Promise.resolve(
              firebaseConfig?.getFromRealtimeDB?.(`users/${userId}/identityReverification`)
            ).catch(() => null));
          identityChallengeAlreadyValidating = identityState?.status === 'validating';
          const identityChallengeIsActive = Boolean(
            effectiveChallengeId
            && (identityState?.challengeId || null) === effectiveChallengeId
            && identityState?.requirement === 'IDENTITY_REVERIFICATION'
            && (
              (
                kycRuntime.namespace === 'sandbox'
                  ? identityState?.status === 'pending'
                  : ['requested', 'failed'].includes(identityState?.status)
              )
              || identityChallengeAlreadyValidating
            )
          );
          if (!identityChallengeIsActive) {
            return res.status(404).json({
              success: false,
              error: 'Revalidacao de identidade nao encontrada ou ja concluida',
              code: 'KYC_IDENTITY_REVERIFICATION_NOT_ACTIVE'
            });
          }
          const candidateAttemptScope = normalizeLivenessAttemptScope(
            identityState?.attemptScope || identityState?.metadata?.attemptScope || ''
          );
          authorizedAttemptScope = (
            candidateAttemptScope.startsWith('manual_review_retry_')
            || candidateAttemptScope.startsWith('orphan_hold_retry_')
          )
            ? candidateAttemptScope
            : null;
          effectiveRequirement = 'IDENTITY_REVERIFICATION';
        } else {
          const firstAccessPolicy = kycRuntime.namespace === 'sandbox'
            ? { required: false }
            : await policyService.requiresFirstAccessLiveness(userId)
              .catch(() => ({ required: false }));
          if (firstAccessPolicy?.required === true) {
            effectiveRequirement = 'LIVENESS_REQUIRED';
          } else {
            return res.status(409).json({
              success: false,
              error: 'Nenhuma validacao de liveness esta pendente para esta conta',
              code: 'KYC_LIVENESS_NOT_REQUIRED'
            });
          }
        }

        const attemptScope = resolveLivenessAttemptScope({
          challenge,
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement,
          authorizedAttemptScope
        });
        const requiresDurableRetryAuthorization = (
          attemptScope.startsWith('manual_review_retry_')
          || attemptScope.startsWith('orphan_hold_retry_')
          || identityReviewGate.cleanRetryAuthorized === true
        );
        if (
          identityReviewGate.cleanRetryAuthorized === true
          && !(
            attemptScope.startsWith('manual_review_retry_')
            || attemptScope.startsWith('orphan_hold_retry_')
          )
        ) {
          const error = new Error('A nova tentativa perdeu o vinculo de autorizacao');
          error.code = 'KYC_IDENTITY_RETRY_BINDING_REQUIRED';
          throw error;
        }

        if (
          identityReviewGate.retrySessionResumeCandidate === true
          && !requiresDurableRetryAuthorization
        ) {
          const error = new Error('A retomada perdeu o vinculo de autorizacao');
          error.code = 'KYC_IDENTITY_RETRY_BINDING_REQUIRED';
          throw error;
        }
        if (typeof this.awsLivenessService.getAttemptState !== 'function') {
          const error = new Error('Estado duravel da tentativa indisponivel');
          error.code = 'KYC_IDENTITY_RETRY_RESUME_STATE_UNAVAILABLE';
          throw error;
        }
        const attemptState = await this.awsLivenessService.getAttemptState({
          userId,
          requirement: effectiveRequirement,
          attemptScope,
          ...getKycSessionPersistenceBinding(kycRuntime)
        });
        const persistedSessionId = typeof attemptState?.lastSessionId === 'string'
          ? attemptState.lastSessionId.trim()
          : '';
        const terminalSessionCodes = new Set([
          'KYC_IDENTITY_RETRY_RESUME_SESSION_TERMINAL',
          'AWS_LIVENESS_SESSION_ABANDONED',
          'AWS_LIVENESS_SESSION_EXPIRED'
        ]);
        let persistedSessionIsTerminal = false;

        if (persistedSessionId) {
          let sessionMetadata = null;
          try {
            sessionMetadata = await this.awsLivenessService
              .getSessionMetadata(persistedSessionId);
          } catch (metadataError) {
            if (
              !requiresDurableRetryAuthorization
              && terminalSessionCodes.has(metadataError?.code)
            ) {
              persistedSessionIsTerminal = true;
            } else {
              throw metadataError;
            }
          }
          if (
            !sessionMetadata
            && !persistedSessionIsTerminal
            && typeof this.awsLivenessService.recoverCommittedSession === 'function'
          ) {
            verificationWindowClaim = await trustService.claimVerificationWindow(userId, {
              scope: 'aws_liveness_session_recovery'
            });
            if (!verificationWindowClaim.acquired) {
              return res.status(409).json({
                success: false,
                error: 'Outra validacao de identidade ja esta em andamento',
                code: 'KYC_VERIFICATION_IN_PROGRESS'
              });
            }
            let recovered = await this.awsLivenessService.recoverCommittedSession({
              userId,
              challengeId: effectiveChallengeId,
              requirement: effectiveRequirement,
              attemptScope,
              verificationWindowToken: verificationWindowClaim.token,
              ...getKycSessionPersistenceBinding(kycRuntime)
            });
            if (
              !recovered
              && typeof this.awsLivenessService.recoverExpiredSessionMetadata === 'function'
            ) {
              recovered = await this.awsLivenessService.recoverExpiredSessionMetadata({
                userId,
                sessionId: persistedSessionId,
                challengeId: effectiveChallengeId,
                requirement: effectiveRequirement,
                attemptScope,
                ...getKycSessionPersistenceBinding(kycRuntime)
              });
            }
            if (recovered?.sessionId !== persistedSessionId) {
              const error = new Error('A sessao paga nao pode ser retomada com seguranca');
              error.code = 'KYC_IDENTITY_RETRY_RESUME_SESSION_NOT_FOUND';
              error.providerDispatched = true;
              throw error;
            }
            sessionMetadata = recovered.sessionMetadata;
          }

          let resumableSession = null;
          if (sessionMetadata && !persistedSessionIsTerminal) {
            try {
              this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
                userId,
                expectedChallengeId: effectiveChallengeId,
                expectedRequirement: effectiveRequirement,
                ...getExpectedKycSessionPersistenceBinding(kycRuntime)
              });
              resumableSession = assertPersistedRetrySessionResumable({
                userId,
                challengeId: effectiveChallengeId,
                requirement: effectiveRequirement,
                attemptScope,
                attemptState,
                sessionMetadata
              });
            } catch (resumeError) {
              if (
                !requiresDurableRetryAuthorization
                && terminalSessionCodes.has(resumeError?.code)
              ) {
                persistedSessionIsTerminal = true;
              } else {
                throw resumeError;
              }
            }
          }

          if (resumableSession) {
            if (!verificationWindowClaim) {
              verificationWindowClaim = await trustService.claimVerificationWindow(userId, {
                token: resumableSession.verificationWindowToken,
                scope: 'aws_liveness_session_resume'
              });
              if (!verificationWindowClaim.acquired) {
                return res.status(409).json({
                  success: false,
                  error: 'Outra validacao de identidade ja esta em andamento',
                  code: 'KYC_VERIFICATION_IN_PROGRESS'
                });
              }
            }
            retainVerificationWindow = true;
            if (requiresDurableRetryAuthorization) {
              await workflowService.resumeCleanRetryAuthorization(
                userId,
                attemptScope,
                resumableSession.sessionId
              );
            }
            return res.status(200).json(buildResumedLivenessSessionResponse({
              provider: this.awsLivenessService.getProviderName(),
              sessionId: resumableSession.sessionId,
              sessionMetadata,
              config: this.awsLivenessService.getConfigSummary()
            }));
          }
        }

        if (verificationWindowClaim && persistedSessionIsTerminal) {
          await trustService.releaseVerificationWindow(verificationWindowClaim);
          verificationWindowClaim = null;
        }

        if (
          identityReviewGate.retrySessionResumeCandidate === true
          || (identityChallengeAlreadyValidating && !persistedSessionIsTerminal)
        ) {
          const error = new Error('A sessao anterior nao foi encontrada para retomada');
          error.code = 'KYC_IDENTITY_RETRY_RESUME_SESSION_NOT_FOUND';
          throw error;
        }

        verificationWindowClaim = await trustService.claimVerificationWindow(userId, {
          scope: 'aws_liveness_session'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }

        cleanRetryAuthorizationClaim = await workflowService
          .claimCleanRetryAuthorization(userId, attemptScope);
        if (requiresDurableRetryAuthorization && !cleanRetryAuthorizationClaim) {
          const error = new Error('A autorizacao desta nova tentativa nao esta disponivel');
          error.code = 'KYC_IDENTITY_RETRY_AUTHORIZATION_REQUIRED';
          throw error;
        }

        if (isIdentityReverification) {
          const startedResult = typeof policyService.recordIdentityReverificationStarted === 'function'
            ? await policyService.recordIdentityReverificationStarted(userId, {
              challengeId: effectiveChallengeId,
              requirement: 'IDENTITY_REVERIFICATION'
            })
            : { success: true, recorded: true };
          if (startedResult?.recorded !== true) {
            const error = new Error(
              'Esta revalidacao foi substituida por uma solicitacao mais recente'
            );
            error.code = startedResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE';
            throw error;
          }
        }

        const session = await this.awsLivenessService.createSession({
          userId,
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement,
          attemptScope,
          verificationWindowToken: verificationWindowClaim.token,
          ...getKycSessionPersistenceBinding(kycRuntime)
        });
        cleanRetrySessionCreated = true;
        if (cleanRetryAuthorizationClaim) {
          await workflowService.consumeCleanRetryAuthorization(
            cleanRetryAuthorizationClaim,
            session.sessionId
          );
        }
        retainVerificationWindow = true;

        const publicSessionConfig = this.awsLivenessService.getConfigSummary();
        return res.status(201).json(buildPublicLivenessSessionResponse({
          ...session,
          provider: this.awsLivenessService.getProviderName(),
          region: publicSessionConfig.region
        }));
      } catch (error) {
        if (
          cleanRetryAuthorizationClaim
          && !cleanRetrySessionCreated
          && error?.providerDispatched !== true
        ) {
          await kycRuntime.workflowService.releaseCleanRetryAuthorization(
            cleanRetryAuthorizationClaim,
            { reason: error?.code || 'session_creation_failed_before_provider_dispatch' }
          ).catch((releaseError) => {
            logError(releaseError, 'Falha ao liberar autorizacao de retry nao despachada', {
              service: 'kyc-routes-routes',
              userId: req.body?.userId,
              caseId: cleanRetryAuthorizationClaim.caseId
            });
          });
        }
        const isDisabled = error?.code === 'AWS_LIVENESS_DISABLED';
        const attemptsExhausted = [
          'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
          'KYC_AWS_USER_DAILY_SESSION_LIMIT_EXHAUSTED'
        ].includes(error?.code);
        const activeTripDeferred = error?.code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
        const verificationBusy = error?.code === 'KYC_VERIFICATION_IN_PROGRESS';
        const retryResumeUnavailable = String(error?.code || '')
          .startsWith('KYC_IDENTITY_RETRY_RESUME_')
          || [
            'KYC_IDENTITY_REVIEW_RETRY_RESUME_NOT_AVAILABLE',
            'KYC_IDENTITY_REVIEW_RETRY_SESSION_BINDING_INVALID',
            'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID',
            'AWS_LIVENESS_SESSION_METADATA_REQUIRED',
            'AWS_LIVENESS_SESSION_METADATA_INVALID',
            'AWS_LIVENESS_SESSION_EXPIRED',
            'AWS_LIVENESS_SESSION_ABANDONED',
            'AWS_LIVENESS_SESSION_USER_MISMATCH',
            'AWS_LIVENESS_SESSION_PROVIDER_MISMATCH',
            'AWS_LIVENESS_SESSION_ATTEMPT_SCOPE_INVALID',
            'AWS_LIVENESS_SESSION_CHALLENGE_MISMATCH',
            'AWS_LIVENESS_SESSION_REQUIREMENT_MISMATCH',
            'AWS_LIVENESS_SESSION_PERSISTENCE_SCOPE_MISMATCH',
            'AWS_LIVENESS_SESSION_FINANCIAL_CONTEXT_MISMATCH'
          ].includes(error?.code);
        const stateUnavailable = [
          'KYC_REVERIFY_STATE_UNAVAILABLE',
          'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE',
          'KYC_TRUST_STORE_UNAVAILABLE',
          'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE',
          'KYC_RUNTIME_SERVICE_UNAVAILABLE',
          'KYC_RUNTIME_SERVICE_SCOPE_MISMATCH',
          'KYC_RUNTIME_SANDBOX_CONTEXT_REQUIRED',
          'KYC_AWS_LIVENESS_PERSISTENCE_BINDING_REQUIRED',
          'KYC_AWS_LIVENESS_COMMITTED_SESSION_RECOVERY_REQUIRED',
          'KYC_AWS_LIVENESS_RECOVERY_BINDING_REQUIRED',
          'KYC_AWS_LIVENESS_RECOVERY_BINDING_MISMATCH',
          'KYC_AWS_LIVENESS_RECOVERY_BINDING_COMMIT_FAILED',
          'KYC_AWS_LIVENESS_RECOVERY_EXPIRED',
          'KYC_AWS_LIVENESS_RECOVERY_STATE_UNAVAILABLE',
          'KYC_AWS_LIVENESS_EXPIRED_PROOF_BINDING_MISMATCH',
          'KYC_AWS_LIVENESS_EXPIRED_PROOF_NOT_TERMINAL',
          'KYC_AWS_LIVENESS_EXPIRED_PROOF_UNAVAILABLE',
          'KYC_AWS_LIVENESS_PERSISTENCE_BINDING_MISMATCH',
          'KYC_AWS_LIVENESS_METADATA_BINDING_COMMIT_FAILED',
          'KYC_AWS_COST_GUARD_REQUIRED',
          'KYC_AWS_COST_GUARD_UNAVAILABLE',
          'KYC_AWS_COST_OPERATION_NOT_FOUND',
          'KYC_AWS_COST_OPERATION_MISMATCH',
          'KYC_AWS_COST_OPERATION_STATE_INVALID',
          'KYC_IDENTITY_RETRY_BINDING_REQUIRED',
          'KYC_IDENTITY_RETRY_AUTHORIZATION_REQUIRED'
        ].includes(error?.code)
          || String(error?.code || '').startsWith('PERSISTENCE_');
        const identityPermanentlyBlocked = error?.code === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK';
        const challengeStale =
          error?.code === 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE';
        if (attemptsExhausted) {
          logError(error, 'Limite temporario de sessoes AWS liveness atingido', {
            service: 'kyc-routes-routes',
            userId: req.body?.userId || null
          });
          return sendLivenessAttemptRateLimit(res, error);
        }
        const statusCode = identityPermanentlyBlocked
          ? 423
          : ((activeTripDeferred || verificationBusy || retryResumeUnavailable || challengeStale)
            ? 409
            : ((isDisabled || stateUnavailable) ? 503 : 500));
        logError(error, 'Erro ao criar sessão AWS liveness', { service: 'kyc-routes-routes' });
        const publicError = identityPermanentlyBlocked
          ? 'Esta conta nao pode usar o modo motorista.'
          : challengeStale
            ? 'Sua solicitacao de validacao foi atualizada. Tente novamente.'
          : retryResumeUnavailable
            ? 'Sua sessao anterior nao esta mais disponivel. Fale com o suporte para liberar uma nova tentativa.'
            : stateUnavailable
              ? 'Nao foi possivel preparar a validacao com seguranca agora. Tente novamente em alguns minutos.'
              : (activeTripDeferred
                ? 'A validacao deve ser feita fora de uma corrida.'
                : (verificationBusy
                  ? 'Outra validacao de identidade ja esta em andamento.'
                  : 'Nao foi possivel preparar a validacao agora. Tente novamente.'));
        return res.status(statusCode).json({
          success: false,
          error: publicError,
          code: error.code || 'KYC_AWS_LIVENESS_SESSION_ERROR'
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await kycRuntime?.trustService
            .releaseVerificationWindow(verificationWindowClaim)
            .catch(() => null);
        }
      }
      }
    );

    this.router.post(
      '/liveness/aws/session/:sessionId/abandon',
      requireFirebaseUser,
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      try {
        const sessionId = typeof req.params.sessionId === 'string'
          ? req.params.sessionId.trim()
          : '';
        const userId = typeof req.body?.userId === 'string'
          ? req.body.userId.trim()
          : '';
        if (!sessionId) {
          return res.status(400).json({
            success: false,
            error: 'A sessao de validacao e obrigatoria',
            code: 'AWS_LIVENESS_SESSION_ID_REQUIRED'
          });
        }
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId e obrigatorio',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        await kycRuntime.trustService.assertVerificationOutsideActiveTrip(userId);
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
          userId,
          ...getExpectedKycSessionPersistenceBinding(kycRuntime),
          allowAbandoned: true,
          allowExpired: true
        });
        const result = await this.awsLivenessService.abandonSession({
          sessionId,
          userId
        });
        await kycRuntime.workflowService.finalizeCleanRetryAuthorization({
          driverId: userId,
          attemptScope: sessionMetadata?.attemptScope || null,
          sessionId,
          outcome: 'ABORTED',
          reason: 'user_abandoned_liveness_session'
        });

        return res.json({
          success: true,
          abandoned: true,
          sessionId: result.sessionId
        });
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_ABANDON_ERROR';
        const clientErrorCodes = new Set([
          'AWS_LIVENESS_SESSION_ID_REQUIRED',
          'KYC_AWS_LIVENESS_USER_REQUIRED'
        ]);
        const conflictCodes = new Set([
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_AWS_LIVENESS_RESUME_REQUIRED',
          'KYC_AWS_LIVENESS_ABANDON_WINDOW_BINDING_REQUIRED'
        ]);
        const transientProviderCodes = new Set([
          'ThrottlingException',
          'ServiceUnavailableException',
          'InternalServerError',
          'InternalServerErrorException',
          'ProvisionedThroughputExceededException',
          'RequestTimeout',
          'TimeoutError'
        ]);
        let statusCode = 500;
        if (clientErrorCodes.has(code)) statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'AWS_LIVENESS_SESSION_METADATA_REQUIRED') statusCode = 404;
        if (conflictCodes.has(code)) statusCode = 409;
        if (code === 'AWS_LIVENESS_DISABLED') statusCode = 503;
        if (transientProviderCodes.has(code)) statusCode = 503;

        logError(error, 'Erro ao encerrar sessao AWS liveness', {
          service: 'kyc-routes-routes',
          userId: req.body?.userId || null,
          sessionId: req.params?.sessionId || null
        });
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          code,
          ...(code === 'KYC_AWS_LIVENESS_RESUME_REQUIRED'
            ? {
              completed: true,
              livenessPassed: true,
              sessionId: error.result?.sessionId || req.params?.sessionId || null
            }
            : {})
        });
      }
      }
    );

    this.router.get(
      '/liveness/aws/session/:sessionId',
      requireFirebaseUser,
      requireFirebaseSelf(queryUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let kycRuntime = null;
      try {
        const { sessionId } = req.params;
        const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
        kycRuntime = await resolveRequestKycRuntime(req, userId);
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
          userId,
          ...getExpectedKycSessionPersistenceBinding(kycRuntime)
        });
        verificationWindowClaim = await kycRuntime.trustService.claimVerificationWindow(userId, {
          token: sessionMetadata.verificationWindowToken || null,
          scope: 'aws_liveness_poll'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }
        retainVerificationWindow = true;
        const result = await this.awsLivenessService.getSessionResult({
          sessionId,
          userId,
          requireBoundMetadata: true
        });
        if (result?.completed === true && result?.livenessPassed !== true) {
          retainVerificationWindow = false;
        }
        if (isLivenessAttemptRateLimited(result)) {
          return sendLivenessAttemptRateLimit(res, result.attemptState);
        }

        return res.json(buildPublicLivenessSessionResponse({
          ...result,
          provider: this.awsLivenessService.getProviderName(),
          region: this.awsLivenessService.getConfigSummary().region,
          challengeType: sessionMetadata.challengeType || null,
          expiresAt: sessionMetadata.expiresAt || null
        }));
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_RESULT_ERROR';
        let statusCode = 500;
        if (code === 'AWS_LIVENESS_DISABLED') statusCode = 503;
        if (code === 'AWS_LIVENESS_SESSION_ID_REQUIRED') statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'AWS_LIVENESS_SESSION_ABANDONED') statusCode = 409;
        if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') statusCode = 409;
        if (code === 'ResourceNotFoundException' || code === 'SessionNotFoundException') statusCode = 404;
        if (code === 'ValidationException') statusCode = 400;

        logError(error, 'Erro ao consultar resultado AWS liveness', { service: 'kyc-routes-routes' });
        const publicError = code === 'AWS_LIVENESS_SESSION_ABANDONED'
          ? 'Esta sessao foi encerrada. Inicie uma nova validacao.'
          : (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP'
            ? 'A validacao deve ser feita fora de uma corrida.'
            : ((code === 'ResourceNotFoundException' || code === 'SessionNotFoundException')
              ? 'Esta sessao expirou. Inicie uma nova validacao.'
              : 'Nao foi possivel confirmar a validacao agora. Tente novamente.'));
        return res.status(statusCode).json({
          success: false,
          error: publicError,
          code
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await kycRuntime?.trustService
            .releaseVerificationWindow(verificationWindowClaim)
            .catch(() => null);
        }
      }
      }
    );

    this.router.get(
      '/liveness/aws/credentials',
      requireFirebaseUser,
      requireFirebaseSelf(queryUserId),
      async (req, res) => {
      try {
        const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
        const sessionId = typeof req.query.sessionId === 'string'
          ? req.query.sessionId.trim()
          : '';
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }
        if (!sessionId) {
          return res.status(400).json({
            success: false,
            error: 'A sessão de validação é obrigatória',
            code: 'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED'
          });
        }
        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        await kycRuntime.trustService.assertVerificationOutsideActiveTrip(userId);
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
          userId,
          ...getExpectedKycSessionPersistenceBinding(kycRuntime)
        });
        const credentialsResult = await this.awsLivenessService.issueTemporaryCredentials({
          userId,
          sessionId
        });

        return res.json({
          success: true,
          provider: credentialsResult.provider,
          region: credentialsResult.region,
          source: credentialsResult.source,
          credentials: credentialsResult.credentials
        });
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_CREDENTIALS_ERROR';
        let statusCode = 500;
        if (code === 'AWS_LIVENESS_DISABLED' || code === 'AWS_LIVENESS_CREDENTIALS_DISABLED') statusCode = 503;
        if (code === 'AWS_LIVENESS_ASSUME_ROLE_MISSING') statusCode = 503;
        if (code === 'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED') statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_METADATA_REQUIRED') statusCode = 404;
        if (code === 'AWS_LIVENESS_SESSION_EXPIRED') statusCode = 410;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'AWS_LIVENESS_SESSION_ABANDONED') statusCode = 409;
        if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') statusCode = 409;
        if (code === 'AccessDenied' || code === 'AccessDeniedException') statusCode = 403;
        if (code === 'ValidationError' || code === 'ValidationException') statusCode = 400;

        logError(error, 'Erro ao emitir credenciais AWS liveness', { service: 'kyc-routes-routes' });
        const publicFailure = resolvePublicAwsLivenessCredentialsFailure(code);
        return res.status(statusCode).json({
          success: false,
          error: publicFailure.error,
          code,
          retryable: publicFailure.retryable
        });
      }
      }
    );

    // Upload de imagem de perfil
    this.router.post(
      '/upload-profile',
      requireFirebaseUser,
      requireOperationalLegacyKycRoute,
      this.upload.single('image'),
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      try {
        const { userId } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Imagem é obrigatória'
          });
        }

        const result = await this.kycService.preprocessProfileImage(
          userId,
          req.file.buffer
        );

        if (result.success) {
          res.json({
            success: true,
            userId: userId,
            message: 'Imagem de perfil processada com sucesso',
            encodingSaved: true,
            confidence: result.confidence
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        logError(error, 'Erro no upload de perfil:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Verificação facial
    this.router.post(
      '/verify-driver/device',
      requireFirebaseUser,
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let kycRuntime = null;
      try {
        const { userId, deviceKyc, challengeId, requirement } = req.body || {};

        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!deviceKyc || typeof deviceKyc !== 'object') {
          return res.status(400).json({
            success: false,
            error: 'deviceKyc é obrigatório'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendCanonicalRouteRequired(res);
        }
        const { policyService } = kycRuntime;

        const approvalGate = await policyService.requireApprovedKyc(userId);
        const implicitChallenge = !challengeId
          ? await policyService.getStepUpChallenge(null, userId)
          : null;
        if (
          approvalGate?.code === 'KYC_REVERIFY_REQUIRED'
          || requiresCanonicalVerificationRoute({
            challenge: implicitChallenge,
            requirement: implicitChallenge?.requirement || null
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }

        let challenge = null;
        let effectiveRequirement = requirement || null;
        if (challengeId) {
          challenge = await policyService.getStepUpChallenge(challengeId, userId);
          if (!challenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = effectiveRequirement || challenge.requirement || 'VERIFY_REQUIRED';
        }

        const firstAccessPolicy = kycRuntime.namespace === 'sandbox'
          ? { required: false }
          : await policyService.requiresFirstAccessLiveness(userId);
        const firstAccessLivenessRequired = !challengeId && firstAccessPolicy.required === true;
        if (!effectiveRequirement && firstAccessLivenessRequired) {
          effectiveRequirement = 'LIVENESS_REQUIRED';
        }

        let verificationPayload = {
          ...deviceKyc,
          recoverBlocked:
            deviceKyc.recoverBlocked === true
            || Boolean(challengeId)
            || firstAccessLivenessRequired
        };

        const awsSessionId = deviceKyc?.aws?.sessionId || deviceKyc?.awsSessionId || null;
        let boundSessionMetadata = null;
        if (awsSessionId) {
          boundSessionMetadata = await this.awsLivenessService.getSessionMetadata(awsSessionId);
          this.awsLivenessService.assertBoundSessionMetadata(boundSessionMetadata, {
            userId,
            ...getExpectedKycSessionPersistenceBinding(kycRuntime)
          });
        }
        if (requiresCanonicalVerificationRoute({
          awsSessionId,
          challenge,
          requirement: effectiveRequirement,
          firstAccessLivenessRequired
        })) {
          return sendCanonicalRouteRequired(res);
        }
        verificationWindowClaim = await kycRuntime.trustService.claimVerificationWindow(userId, {
          token: boundSessionMetadata?.verificationWindowToken || null,
          scope: 'legacy_device_verify'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }
        const [lockedApprovalGate, lockedFirstAccessPolicy, lockedActiveChallenge] = await Promise.all([
          policyService.requireApprovedKyc(userId),
          kycRuntime.namespace === 'sandbox'
            ? Promise.resolve({ required: false })
            : policyService.requiresFirstAccessLiveness(userId),
          policyService.getStepUpChallenge(null, userId)
        ]);
        if (
          lockedApprovalGate?.code === 'KYC_REVERIFY_REQUIRED'
          || requiresCanonicalVerificationRoute({
            challenge: lockedActiveChallenge,
            requirement: lockedActiveChallenge?.requirement || null,
            firstAccessLivenessRequired:
              !challengeId && lockedFirstAccessPolicy?.required === true
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }
        retainVerificationWindow = Boolean(awsSessionId);
        if (awsSessionId) {
          try {
            const awsResult = await this.awsLivenessService.getSessionResult({
              sessionId: awsSessionId,
              userId,
              requireBoundMetadata: true
            });
            if (!awsResult.completed) {
              return res.status(202).json({
                success: false,
                code: 'KYC_AWS_LIVENESS_PENDING',
                error: 'Sessão AWS de liveness ainda está em processamento',
                provider: awsResult.provider,
                sessionId: awsResult.sessionId,
                status: awsResult.status
              });
            }
            retainVerificationWindow = false;
            verificationPayload = this.awsLivenessService.toDevicePayload(awsResult, verificationPayload);
            if (isLivenessAttemptRateLimited(awsResult)) {
              return sendLivenessAttemptRateLimit(res, awsResult.attemptState);
            }
          } catch (awsError) {
            const awsCode = awsError?.code || awsError?.name || 'KYC_AWS_LIVENESS_FAILED';
            const awsStatus = awsCode === 'AWS_LIVENESS_DISABLED'
              ? 503
              : (awsCode === 'ResourceNotFoundException' ? 404 : 400);
            return res.status(awsStatus).json({
              success: false,
              error: awsError.message,
              code: awsCode
            });
          }
        }

        if (
          effectiveRequirement === 'LIVENESS_REQUIRED'
          && !policyService.isLivenessSatisfied(verificationPayload)
        ) {
          return res.status(412).json({
            success: false,
            error: 'Liveness obrigatório para concluir esta verificação',
            code: 'KYC_LIVENESS_REQUIRED',
            requirement: effectiveRequirement
          });
        }

        const deviceResult = await this.kycService.acceptDeviceVerification(userId, verificationPayload);
        if (!deviceResult.success) {
          return res.status(400).json(deviceResult);
        }

        if ((challengeId || firstAccessLivenessRequired) && !deviceResult.isMatch) {
          return res.status(403).json({
            success: false,
            error: 'Verificação facial não aprovada para este desafio',
            code: 'KYC_CHALLENGE_NOT_PASSED',
            userId,
            isMatch: false,
            similarityScore: deviceResult.similarityScore,
            confidence: deviceResult.confidence
          });
        }

        if (challengeId && deviceResult.isMatch) {
          const challengeResolution = await policyService.resolveStepUpChallenge({
            challengeId,
            driverId: userId,
            requirement: effectiveRequirement,
            verificationPayload: {
              ...withoutSensitiveBiometricPayload(verificationPayload),
              ...deviceResult
            }
          });

          if (!challengeResolution.success) {
            return res.status(400).json(challengeResolution);
          }
        }

        if (deviceResult.isMatch) {
          if (typeof policyService.recordVerificationSuccess === 'function') {
            await policyService.recordVerificationSuccess(userId, {
              source: challengeId ? 'stepup_challenge' : 'device_verify'
            });
          }
        }

        return res.json({
          success: true,
          userId,
          isMatch: deviceResult.isMatch,
          similarityScore: deviceResult.similarityScore,
          confidence: deviceResult.confidence,
          threshold: deviceResult.threshold,
          processingTime: deviceResult.processingTime,
          mode: deviceResult.mode,
          decision: deviceResult.decision || null,
          embeddingDimension: deviceResult.embeddingDimension || null,
          comparisonProvider: deviceResult.comparisonProvider || null,
          requirement: effectiveRequirement || 'VERIFY_REQUIRED',
          challengeId: challengeId || null
        });
      } catch (error) {
        logError(error, 'Erro na verificação device-first:', { service: 'kyc-routes-routes' });
        const conflict = [
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_VERIFICATION_IN_PROGRESS'
        ].includes(error?.code);
        return res.status(conflict ? 409 : 500).json({
          success: false,
          error: conflict ? error.message : 'Erro interno do servidor',
          code: error?.code || 'KYC_DEVICE_VERIFICATION_ERROR',
          details: error.message
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await kycRuntime?.trustService
            .releaseVerificationWindow(verificationWindowClaim)
            .catch(() => null);
        }
      }
      }
    );

    this.router.post(
      '/verify-driver/server-side-selfie',
      requireFirebaseUser,
      this.upload.single('currentImage'),
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let canonicalSessionClaim = null;
      let retainVerificationWindow = false;
      let leaseHeartbeat = null;
      let kycRuntime = null;
      try {
        const { userId, awsSessionId, forceRecheck } = req.body || {};
        let { challengeId, requirement } = req.body || {};

        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!awsSessionId) {
          return res.status(400).json({
            success: false,
            error: 'Sessão AWS de liveness é obrigatória para esta verificação',
            code: 'KYC_AWS_LIVENESS_SESSION_REQUIRED'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        const {
          trustService,
          evidenceService,
          workflowService,
          policyService,
          scope: persistenceScope
        } = kycRuntime;

        if (kycRuntime.namespace === 'sandbox' && !this.usesAwsCanonicalFaceCompare()) {
          return res.status(503).json({
            success: false,
            error: 'A validacao de identidade esta temporariamente indisponivel. Tente novamente em alguns minutos.',
            code: 'KYC_CANONICAL_FACE_PROVIDER_UNAVAILABLE'
          });
        }

        let isIdentityReverificationRequest =
          requirement === 'IDENTITY_REVERIFICATION' ||
          String(challengeId || '').startsWith('idrev_');
        let effectiveRequirement = requirement || null;
        let stepUpChallenge = null;
        if (isIdentityReverificationRequest) {
          effectiveRequirement = 'IDENTITY_REVERIFICATION';
        } else if (challengeId) {
          stepUpChallenge = await policyService.getStepUpChallenge(challengeId, userId);
          if (!stepUpChallenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = stepUpChallenge.requirement || effectiveRequirement || 'VERIFY_REQUIRED';
        }

        const firstAccessPolicy = kycRuntime.namespace === 'sandbox'
          ? { required: false }
          : await policyService.requiresFirstAccessLiveness(userId);
        let firstAccessLivenessRequired = !challengeId && firstAccessPolicy.required === true;
        if (!effectiveRequirement && firstAccessLivenessRequired) {
          effectiveRequirement = 'LIVENESS_REQUIRED';
        }

        let boundSessionMetadata = null;
        let sessionMetadataCandidate = null;
        let sessionMetadataError = null;
        try {
          sessionMetadataCandidate = await this.awsLivenessService.getSessionMetadata(awsSessionId);
          const canonicalRetryAttemptScope = normalizeLivenessAttemptScope(
            sessionMetadataCandidate?.attemptScope || ''
          );
          if (
            canonicalRetryAttemptScope.startsWith('manual_review_retry_')
            || canonicalRetryAttemptScope.startsWith('orphan_hold_retry_')
          ) {
            const canonicalChallengeId = String(
              sessionMetadataCandidate?.challengeId || ''
            ).trim();
            const canonicalRequirement = String(
              sessionMetadataCandidate?.requirement || ''
            ).trim();
            if (
              !canonicalChallengeId.startsWith('idrev_')
              || canonicalRequirement !== 'IDENTITY_REVERIFICATION'
            ) {
              const bindingError = new Error('A sessao perdeu o vinculo canonico de revalidacao');
              bindingError.code = 'AWS_LIVENESS_SESSION_METADATA_INVALID';
              throw bindingError;
            }
            challengeId = canonicalChallengeId;
            requirement = canonicalRequirement;
            effectiveRequirement = canonicalRequirement;
            isIdentityReverificationRequest = true;
            firstAccessLivenessRequired = false;
            stepUpChallenge = null;
          }
          this.awsLivenessService.assertBoundSessionMetadata(sessionMetadataCandidate, {
            userId,
            expectedChallengeId: challengeId || null,
            expectedRequirement: effectiveRequirement || null,
            ...getExpectedKycSessionPersistenceBinding(kycRuntime)
          });
          boundSessionMetadata = sessionMetadataCandidate;
        } catch (error) {
          sessionMetadataError = error;
        }
        if (sessionMetadataError?.code === 'AWS_LIVENESS_SESSION_ABANDONED') {
          throw sessionMetadataError;
        }
        if ([
          'AWS_LIVENESS_SESSION_PERSISTENCE_SCOPE_MISMATCH',
          'AWS_LIVENESS_SESSION_FINANCIAL_CONTEXT_MISMATCH',
          'AWS_LIVENESS_SESSION_METADATA_INVALID'
        ].includes(sessionMetadataError?.code)) {
          throw sessionMetadataError;
        }

        const identityReviewGate = await workflowService
          .assertKycOperationAllowed(userId, {
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            awsSessionId
          });
        if (
          identityReviewGate.retryAuthorizationId
          && identityReviewGate.sessionBoundRetryAuthorized !== true
        ) {
          retainVerificationWindow = false;
          return res.status(409).json({
            success: false,
            error: 'Esta sessao nao corresponde a nova tentativa autorizada. Inicie uma nova validacao.',
            code: 'KYC_IDENTITY_RETRY_SESSION_BINDING_REQUIRED'
          });
        }
        if (identityReviewGate.identityReviewHold) {
          retainVerificationWindow = false;
          return sendIdentityReviewGateResponse(res, identityReviewGate);
        }

        canonicalSessionClaim = await trustService.claimCanonicalSession(
          userId,
          awsSessionId,
          {
            verificationWindowToken:
              sessionMetadataCandidate?.verificationWindowToken || null
          }
        );
        if (canonicalSessionClaim.verificationWindowClaim?.acquired) {
          retainVerificationWindow = true;
        }
        if (!canonicalSessionClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Esta sessao AWS ja esta sendo processada',
            code: 'KYC_CANONICAL_SESSION_BUSY'
          });
        }
        if (canonicalSessionClaim.consumed) {
          leaseHeartbeat = createIdentityLeaseHeartbeat(
            () => trustService.renewCanonicalSessionClaim(canonicalSessionClaim)
          );
          await leaseHeartbeat.assertHeld();
          const reconciledRejection = typeof trustService.restoreRejectedIdentityVerification === 'function'
            ? trustService.restoreRejectedIdentityVerification(
              userId,
              canonicalSessionClaim.sessionHash || null,
              canonicalSessionClaim.existingEvidence,
              {
                challengeId: challengeId || null,
                requirement: effectiveRequirement
              }
            )
            : null;
          if (reconciledRejection) {
            const reviewEvidenceCandidate = String(
              reconciledRejection.reviewEvidenceId || ''
            ).trim();
            const reviewEvidenceId = /^[A-Za-z0-9_-]{16,128}$/
              .test(reviewEvidenceCandidate)
              ? reviewEvidenceCandidate
              : null;
            await trustService.assertVerificationOutsideActiveTrip(userId);
            await workflowService.finalizeCleanRetryAuthorization({
              driverId: userId,
              attemptScope: sessionMetadataCandidate?.attemptScope || null,
              sessionId: awsSessionId,
              outcome: 'REJECTED',
              resultEvidenceId: reconciledRejection.evidenceId,
              reason: 'canonical_face_compare_rejection_reconciliation'
            });
            if (
              isIdentityReverificationRequest
              && typeof policyService.recordIdentityReverificationResult === 'function'
            ) {
              try {
                await policyService.recordIdentityReverificationResult(userId, {
                  ...reconciledRejection,
                  reconciliationOnly: true
                });
              } catch (policyError) {
                logError(policyError, 'Falha no espelho de uma rejeicao canonica reconciliada', {
                  service: 'kyc-routes-routes',
                  userId,
                  challengeId: challengeId || null
                });
              }
            }
            await leaseHeartbeat.assertHeld();
            retainVerificationWindow = false;
            return res.status(403).json(buildPublicCanonicalCompareResult({}, {
              success: false,
              error: 'Não foi possível confirmar sua identidade.',
              code: 'KYC_CHALLENGE_NOT_PASSED',
              isMatch: false,
              reviewAvailable: Boolean(reviewEvidenceId),
              evidenceId: reviewEvidenceId,
              idempotentReconciliation: true
            }));
          }
          const reconciledVerification = typeof trustService.restoreApprovedIdentityVerification === 'function'
            ? trustService.restoreApprovedIdentityVerification(
              userId,
              canonicalSessionClaim.sessionHash || null,
              canonicalSessionClaim.existingEvidence,
              {
                challengeId: challengeId || null,
                requirement: effectiveRequirement
              }
            )
            : null;
          if (reconciledVerification) {
            await trustService.assertVerificationOutsideActiveTrip(userId);
            if (isIdentityReverificationRequest) {
              const identityResult = typeof policyService.recordIdentityReverificationResult === 'function'
                ? await policyService.recordIdentityReverificationResult(
                userId,
                {
                  ...reconciledVerification,
                  reconciliationOnly: true
                }
                )
                : { success: true, recorded: true };
              if (identityResult?.recorded !== true) {
                retainVerificationWindow = false;
                return res.status(409).json({
                  success: false,
                  error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
                  code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
                });
              }
            }
            const reconciliationSource = isIdentityReverificationRequest
              ? 'canonical_identity_reconciliation'
              : 'canonical_first_access_reconciliation';
            if (typeof policyService.recordVerificationSuccess === 'function') {
              await policyService.recordVerificationSuccess(userId, {
                source: reconciliationSource,
                markFirstAccess: firstAccessLivenessRequired,
                clearReverify: false
              });
            }
            await workflowService.finalizeCleanRetryAuthorization({
              driverId: userId,
              attemptScope: sessionMetadataCandidate?.attemptScope || null,
              sessionId: awsSessionId,
              outcome: 'SUCCEEDED',
              resultEvidenceId: canonicalSessionClaim.sessionHash || null,
              reason: reconciliationSource
            });
            await workflowService.clearResolvedMismatchHold(userId, {
              source: reconciliationSource
            });
            await leaseHeartbeat.assertHeld();
            retainVerificationWindow = false;
            return res.json(buildPublicCanonicalCompareResult(reconciledVerification, {
              idempotentReconciliation: true
            }));
          }
          retainVerificationWindow = false;
          return res.status(409).json({
            success: false,
            error: 'Sessao AWS ja consumida por uma evidencia canonica',
            code: 'KYC_AWS_SESSION_ALREADY_CONSUMED'
          });
        }
        if (sessionMetadataError) {
          retainVerificationWindow = false;
          throw sessionMetadataError;
        }
        retainVerificationWindow = true;
        leaseHeartbeat = createIdentityLeaseHeartbeat(
          () => trustService.renewCanonicalSessionClaim(canonicalSessionClaim)
        );
        await leaseHeartbeat.assertHeld();

        let livenessPayload = {
          mode: 'server_biometric_selfie_v1',
          provider: 'leaf_face_compare_service',
          awsSessionId,
          aws: {
            sessionId: awsSessionId,
            provider: this.awsLivenessService.getProviderName()
          }
        };

        let awsResult = null;
        try {
          awsResult = await this.awsLivenessService.getSessionResult({
            sessionId: awsSessionId,
            userId,
            requireBoundMetadata: true,
            expectedChallengeId: challengeId || null,
            expectedRequirement: effectiveRequirement || null,
            includeReferenceImage: true
          });
          if (!awsResult.completed) {
            return res.status(202).json({
              success: false,
              code: 'KYC_AWS_LIVENESS_PENDING',
              error: 'Sessão AWS de liveness ainda está em processamento',
              sessionId: awsResult.sessionId,
              status: awsResult.status
            });
          }
          livenessPayload = this.awsLivenessService.toDevicePayload(awsResult, livenessPayload);
          if (isLivenessAttemptRateLimited(awsResult)) {
            await workflowService.finalizeCleanRetryAuthorization({
              driverId: userId,
              attemptScope: sessionMetadataCandidate?.attemptScope || null,
              sessionId: awsSessionId,
              outcome: 'ABORTED',
              reason: 'aws_liveness_attempt_rate_limited'
            });
            retainVerificationWindow = false;
            return sendLivenessAttemptRateLimit(res, awsResult.attemptState);
          }
        } catch (awsError) {
          const awsCode = awsError?.code || awsError?.name || 'KYC_AWS_LIVENESS_FAILED';
          const awsStatus = awsCode === 'AWS_LIVENESS_DISABLED'
            ? 503
            : (awsCode === 'ResourceNotFoundException' ? 404 : 400);
          return res.status(awsStatus).json({
            success: false,
            error: awsStatus === 404
              ? 'A sessao de validacao foi encerrada. Inicie uma nova tentativa.'
              : 'Nao foi possivel confirmar a validacao agora. Tente novamente.',
            code: awsCode
          });
        }

        if (!policyService.isLivenessSatisfied(livenessPayload)) {
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'ABORTED',
            reason: 'aws_liveness_not_satisfied'
          });
          retainVerificationWindow = false;
          return res.status(412).json({
            success: false,
            error: 'Liveness obrigatório para concluir esta verificação',
            code: 'KYC_LIVENESS_REQUIRED',
            requirement: effectiveRequirement || 'LIVENESS_REQUIRED'
          });
        }

        await trustService.assertVerificationOutsideActiveTrip(userId);

        const referenceImageAvailable = Buffer.isBuffer(awsResult?.referenceImageBuffer)
          && awsResult.referenceImageBuffer.length > 0;
        if (!referenceImageAvailable) {
          await leaseHeartbeat.assertHeld();
          const recovery = await this.awsLivenessService.grantReferenceImageRecoveryAttempt({
            userId,
            sessionId: awsSessionId,
            requirement: effectiveRequirement,
            attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null,
            persistenceNamespace: sessionMetadataCandidate?.persistenceNamespace || null,
            financialContextId: sessionMetadataCandidate?.financialContextId || null
          });
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'ABORTED',
            reason: 'aws_reference_image_unavailable'
          });
          retainVerificationWindow = false;
          if (recovery.canRetry !== true) {
            return res.status(503).json({
              success: false,
              error: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.',
              code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
              retryable: false
            });
          }
          return res.status(422).json({
            success: false,
            error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.',
            code: 'KYC_AWS_REFERENCE_IMAGE_REQUIRED',
            retryable: true
          });
        }

        await leaseHeartbeat.assertHeld();

        let verificationResult;
        try {
          verificationResult = await this.verifyCanonicalFaceMatch(
            userId,
            awsResult,
            {
              recoverBlocked: true,
              skipStatusSideEffects: true,
              writeVerificationCache: false,
              forceRecheck: forceRecheck === 'true' || forceRecheck === true,
              requirement: effectiveRequirement,
              challengeId: challengeId || null,
              filename: 'aws-liveness-reference.jpg',
              contentType: 'image/jpeg'
            }
          );
        } catch (comparisonError) {
          if (comparisonError?.code !== 'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED') {
            throw comparisonError;
          }
          await leaseHeartbeat.assertHeld();
          const recovery = await this.awsLivenessService.grantReferenceImageRecoveryAttempt({
            userId,
            sessionId: awsSessionId,
            requirement: effectiveRequirement,
            attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null,
            persistenceNamespace: sessionMetadataCandidate?.persistenceNamespace || null,
            financialContextId: sessionMetadataCandidate?.financialContextId || null
          });
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'ABORTED',
            reason: comparisonError.code || 'aws_reference_face_not_detected'
          });
          retainVerificationWindow = false;
          if (recovery.canRetry !== true) {
            return res.status(503).json({
              success: false,
              error: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.',
              code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
              retryable: false
            });
          }
          return res.status(422).json({
            success: false,
            error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.',
            code: comparisonError.code,
            retryable: true
          });
        }

        if (!verificationResult.success) {
          const status = verificationResult.code === 'BIOMETRIC_FACE_SERVICE_NOT_CONFIGURED'
            ? 503
            : (verificationResult.code === 'CNH_FACE_EMBEDDING_NOT_FOUND' ? 409 : 400);
          return res.status(status).json(buildPublicCanonicalCompareResult(
            verificationResult,
            {
              success: false,
              error: 'Não foi possível concluir a validação agora.',
              code: verificationResult.code || 'KYC_CANONICAL_COMPARE_FAILED',
              requirement: effectiveRequirement || 'LIVENESS_REQUIRED',
              challengeId: challengeId || null
            }
          ));
        }

        await leaseHeartbeat.assertHeld();
        await trustService.assertVerificationOutsideActiveTrip(userId);

        if (!verificationResult.isMatch) {
          const failureRecord = await trustService.recordCanonicalFailure(userId, {
            awsSessionId,
            sourcePath: 'server_side_aws_reference_compare',
            reason: isIdentityReverificationRequest
              ? 'identity_reverification_failed'
              : 'canonical_face_compare_failed',
            challengeId: challengeId || null,
            requirement: effectiveRequirement || null,
            decision: verificationResult.decision || null,
            similarityScore: verificationResult.similarityScore,
            referenceImageSha256: crypto
              .createHash('sha256')
              .update(awsResult.referenceImageBuffer)
              .digest('hex')
          });
          if (failureRecord?.idempotentReplay) {
            retainVerificationWindow = false;
            return res.status(409).json({
              success: false,
              error: 'Sessao AWS ja utilizada anteriormente',
              code: 'KYC_AWS_SESSION_ALREADY_CONSUMED'
            });
          }

          let reviewEvidence = null;
          let reviewEvidenceLinkedToTrust = false;
          try {
            reviewEvidence = await evidenceService.captureRejectedComparisonEvidence({
              driverId: userId,
              referenceImageBuffer: awsResult.referenceImageBuffer,
              liveness: verificationResult.liveness,
              comparison: verificationResult,
              cnh: verificationResult.reference
            });
            await trustService.linkReviewEvidenceToCanonicalFailure(userId, {
              failureEvidenceId: failureRecord?.evidenceId,
              reviewEvidenceId: reviewEvidence?.evidenceId
            });
            reviewEvidenceLinkedToTrust = true;
          } catch (evidenceError) {
            // A indisponibilidade da trilha de revisão jamais transforma uma
            // divergência canônica em aprovação. O hard-fail permanece ativo.
            logError(evidenceError, 'Falha ao reter evidencia privada de divergencia facial', {
              service: 'kyc-routes-routes',
              userId,
              code: evidenceError?.code || null
            });
          }
          let mismatchHoldPersisted = false;
          try {
            await persistIdentityMismatchHold(userId, {
              evidenceId: reviewEvidence?.evidenceId || null,
              decision: verificationResult.decision || 'reject',
              persistenceScope
            });
            mismatchHoldPersisted = true;
          } catch (holdError) {
            // O trust canônico já foi revogado acima; este espelho adicional
            // existe para impedir troca de CNH e novas chamadas pagas.
            logError(holdError, 'Falha ao persistir hold de divergencia facial', {
              service: 'kyc-routes-routes',
              userId,
              code: holdError?.code || null
            });
          }
          if (reviewEvidence?.evidenceId && !reviewEvidenceLinkedToTrust && !mismatchHoldPersisted) {
            await evidenceService.deleteEvidence(reviewEvidence.evidenceId, {
              actorId: 'system:kyc_mismatch_binding_recovery',
              reason: 'review_evidence_binding_failed'
            }).catch((cleanupError) => {
              logError(cleanupError, 'Falha ao limpar evidencia sem binding recuperavel', {
                service: 'kyc-routes-routes',
                userId,
                code: cleanupError?.code || null
              });
            });
          }
          const reviewEvidenceTraceable = Boolean(
            reviewEvidence?.evidenceId
            && (reviewEvidenceLinkedToTrust || mismatchHoldPersisted)
          );
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'REJECTED',
            resultEvidenceId: failureRecord?.evidenceId || null,
            reason: 'canonical_face_compare_rejected'
          });
          if (isIdentityReverificationRequest) {
            const identityResult = typeof policyService.recordIdentityReverificationResult === 'function'
              ? await policyService.recordIdentityReverificationResult(userId, {
                ...verificationResult,
                requirement: effectiveRequirement,
                challengeId: challengeId || null
              })
              : { success: true, recorded: true };
            if (identityResult?.recorded !== true) {
              return res.status(409).json({
                success: false,
                error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
                code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
              });
            }
          }
          retainVerificationWindow = false;
          return res.status(403).json(buildPublicCanonicalCompareResult({}, {
            success: false,
            error: isIdentityReverificationRequest
              ? 'Não foi possível concluir a validação agora'
              : 'Verificação facial não aprovada para este desafio',
            code: 'KYC_CHALLENGE_NOT_PASSED',
            isMatch: false,
            reviewAvailable: reviewEvidenceTraceable,
            evidenceId: reviewEvidenceTraceable ? reviewEvidence.evidenceId : null
          }));
        }

        let canonicalRecord = null;
        if (verificationResult.isMatch) {
          try {
            canonicalRecord = await trustService.recordCanonicalSuccess(userId, {
              driverId: userId,
              sourcePath: 'server_side_aws_reference_compare',
              awsSessionId,
              livenessProvider: awsResult.provider,
              livenessStatus: awsResult.status,
              livenessPassed: awsResult.livenessPassed === true,
              livenessConfidence: awsResult.confidence,
              livenessThreshold: awsResult.confidenceThreshold,
              referenceImageSha256: crypto
                .createHash('sha256')
                .update(awsResult.referenceImageBuffer)
                .digest('hex'),
              isMatch: verificationResult.isMatch,
              needsReview: verificationResult.needsReview === true,
              similarityScore: verificationResult.similarityScore,
              threshold: verificationResult.threshold,
              reviewThreshold: verificationResult.reviewThreshold,
              decision: verificationResult.decision,
              provider: verificationResult.provider,
              comparisonProvider: verificationResult.comparisonProvider,
              embeddingDimension: verificationResult.embeddingDimension,
              reference: verificationResult.reference || null,
              currentModel: verificationResult.current?.model || null,
              verifiedAt: awsResult.completedAt
                || awsResult.sessionMetadata?.completedAt
                || awsResult.sessionMetadata?.createdAt
                || verificationResult.timestamp
                || new Date().toISOString(),
              challengeId: challengeId || null,
              challengeSource: stepUpChallenge?.source || (
                isIdentityReverificationRequest ? 'identity_reverification' : 'first_access'
              ),
              requirement: effectiveRequirement || null,
              randomAuditDay: stepUpChallenge?.metadata?.randomAuditDay || null,
              resolveStepUpChallenge: Boolean(challengeId && !isIdentityReverificationRequest)
            });
          } catch (canonicalError) {
            logError(canonicalError, 'Falha ao persistir evidencia canonica de identidade', {
              service: 'kyc-routes-routes',
              userId,
              challengeId
            });
            const canonicalConflict = new Set([
              'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
              'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT',
              'KYC_CANONICAL_CHALLENGE_BINDING_INVALID',
              'KYC_CANONICAL_CHALLENGE_NOT_FOUND'
            ]).has(canonicalError.code);
            const publicFailure = resolvePublicCanonicalConflictFailure(
              canonicalError?.code,
              { stateUnavailable: !canonicalConflict }
            );
            return res.status(canonicalConflict ? 409 : 503).json(buildPublicCanonicalCompareResult({}, {
              success: false,
              error: publicFailure.error,
              code: canonicalError.code || 'KYC_CANONICAL_EVIDENCE_PERSIST_FAILED',
              retryable: publicFailure.retryable
            }));
          }
        }

        if (canonicalRecord?.idempotentReplay) {
          retainVerificationWindow = false;
          return res.status(409).json({
            success: false,
            error: 'Sessao AWS ja utilizada anteriormente',
            code: 'KYC_AWS_SESSION_ALREADY_CONSUMED'
          });
        }

        if (isIdentityReverificationRequest) {
          const identityResult = typeof policyService.recordIdentityReverificationResult === 'function'
            ? await policyService.recordIdentityReverificationResult(userId, {
              ...verificationResult,
              requirement: effectiveRequirement,
              challengeId: challengeId || null
            })
            : { success: true, recorded: true };
          if (identityResult?.recorded !== true) {
            return res.status(409).json({
              success: false,
              error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
              code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
            });
          }
        }

        if (verificationResult.isMatch) {
          if (typeof policyService.recordVerificationSuccess === 'function') {
            await policyService.recordVerificationSuccess(userId, {
              source: challengeId ? 'stepup_challenge' : 'server_side_selfie_verify',
              markFirstAccess: firstAccessLivenessRequired,
              clearReverify: false
            });
          }
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'SUCCEEDED',
            resultEvidenceId: canonicalRecord?.evidenceId || null,
            reason: 'canonical_identity_match'
          });
          await workflowService.clearResolvedMismatchHold(userId, {
            source: 'server_side_aws_reference_compare'
          });
        }

        retainVerificationWindow = false;

        return res.json(buildPublicCanonicalCompareResult(verificationResult, {
          success: true,
          isMatch: verificationResult.isMatch,
          needsReview: verificationResult.needsReview || false,
          requirement: effectiveRequirement || 'LIVENESS_REQUIRED',
          challengeId: challengeId || null
        }));
      } catch (error) {
        logError(error, 'Erro na verificação server-side pós-liveness:', { service: 'kyc-routes-routes' });
        const conflictCodes = new Set([
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_VERIFICATION_LEASE_LOST',
          'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE',
          'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT',
          'KYC_CANONICAL_CHALLENGE_BINDING_INVALID',
          'KYC_CANONICAL_CHALLENGE_NOT_FOUND',
          'AWS_LIVENESS_SESSION_ABANDONED',
          'KYC_IDENTITY_REVIEW_HOLD',
          'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK'
        ]);
        const stateUnavailable = [
          'KYC_REVERIFY_STATE_UNAVAILABLE',
          'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE',
          'KYC_TRUST_STORE_UNAVAILABLE'
        ].includes(error?.code);
        const documentImageCodes = new Set([
          'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
          'KYC_CNH_PORTRAIT_LAYOUT_UNSUPPORTED',
          'KYC_CNH_PORTRAIT_EXTRACTION_FAILED'
        ]);
        const livenessImageCodes = new Set([
          'AWS_COMPARE_FACES_LIVENESS_FACE_BOUNDS_REQUIRED',
          'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED',
          'KYC_AWS_REFERENCE_IMAGE_REQUIRED'
        ]);
        const isDocumentImageFailure = documentImageCodes.has(error?.code);
        const isLivenessImageFailure = livenessImageCodes.has(error?.code);
        if (isDocumentImageFailure || isLivenessImageFailure) {
          retainVerificationWindow = false;
        }
        const identityPermanentlyBlocked = error?.code === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK';
        const statusCode = identityPermanentlyBlocked
          ? 423
          : stateUnavailable
          ? 503
          : (conflictCodes.has(error?.code)
            ? 409
            : ((isDocumentImageFailure || isLivenessImageFailure) ? 422 : 500));
        const canonicalPublicFailure = resolvePublicCanonicalConflictFailure(error?.code, {
          stateUnavailable
        });
        const safeError = identityPermanentlyBlocked
          ? canonicalPublicFailure.error
          : isDocumentImageFailure
          ? 'Não conseguimos identificar a foto na CNH aprovada. Envie uma nova versão do documento.'
          : (isLivenessImageFailure
            ? 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.'
            : ((stateUnavailable || conflictCodes.has(error?.code))
              ? canonicalPublicFailure.error
              : 'Erro interno do servidor'));
        return res.status(statusCode).json(buildPublicCanonicalCompareResult({}, {
          success: false,
          error: safeError,
          code: error?.code || 'KYC_SERVER_SIDE_VERIFICATION_ERROR',
          ...((stateUnavailable || conflictCodes.has(error?.code))
            ? { retryable: canonicalPublicFailure.retryable }
            : {})
        }));
      } finally {
        leaseHeartbeat?.stop();
        await kycRuntime?.trustService
          .releaseCanonicalSessionClaim(canonicalSessionClaim, {
            releaseVerificationWindow: (
              canonicalSessionClaim?.consumed === true
              && canonicalSessionClaim?.acquired === true
            ) || !retainVerificationWindow
          })
          .catch(() => null);
      }
      }
    );

    this.router.post(
      '/verify-driver',
      requireFirebaseUser,
      requireOperationalLegacyKycRoute,
      this.upload.single('currentImage'),
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let kycRuntime = null;
      try {
        const { userId, forceRecheck, cacheValidityHours } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendCanonicalRouteRequired(res);
        }
        const { policyService } = kycRuntime;

        const legacyChallengeId = req.body?.challengeId || null;
        const [approvalGate, firstAccessPolicy, implicitChallenge] = await Promise.all([
          policyService.requireApprovedKyc(userId),
          kycRuntime.namespace === 'sandbox'
            ? Promise.resolve({ required: false })
            : policyService.requiresFirstAccessLiveness(userId),
          legacyChallengeId
            ? Promise.resolve(null)
            : policyService.getStepUpChallenge(null, userId)
        ]);
        if (
          approvalGate?.code === 'KYC_REVERIFY_REQUIRED'
          || requiresCanonicalVerificationRoute({
            challenge: implicitChallenge,
            requirement: implicitChallenge?.requirement || null,
            firstAccessLivenessRequired:
              !legacyChallengeId && firstAccessPolicy?.required === true
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }

        const legacyAwsSessionId = req.body?.deviceKyc?.aws?.sessionId
          || req.body?.deviceKyc?.awsSessionId
          || null;
        let boundSessionMetadata = null;
        if (legacyAwsSessionId) {
          boundSessionMetadata = await this.awsLivenessService.getSessionMetadata(legacyAwsSessionId);
          this.awsLivenessService.assertBoundSessionMetadata(boundSessionMetadata, {
            userId,
            ...getExpectedKycSessionPersistenceBinding(kycRuntime)
          });
          return sendCanonicalRouteRequired(res);
        }
        verificationWindowClaim = await kycRuntime.trustService.claimVerificationWindow(userId, {
          token: boundSessionMetadata?.verificationWindowToken || null,
          scope: 'legacy_verify_driver'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }
        const [lockedApprovalGate, lockedFirstAccessPolicy, lockedActiveChallenge] = await Promise.all([
          policyService.requireApprovedKyc(userId),
          kycRuntime.namespace === 'sandbox'
            ? Promise.resolve({ required: false })
            : policyService.requiresFirstAccessLiveness(userId),
          policyService.getStepUpChallenge(null, userId)
        ]);
        if (
          lockedApprovalGate?.code === 'KYC_REVERIFY_REQUIRED'
          || requiresCanonicalVerificationRoute({
            challenge: lockedActiveChallenge,
            requirement: lockedActiveChallenge?.requirement || null,
            firstAccessLivenessRequired:
              !legacyChallengeId && lockedFirstAccessPolicy?.required === true
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }
        retainVerificationWindow = Boolean(legacyAwsSessionId);

        // Device-first: app já envia resultado calculado localmente
        if (req.body && req.body.deviceKyc) {
          const challengeId = req.body.challengeId || null;
          let effectiveRequirement = req.body.requirement || null;
          if (challengeId) {
            const challenge = await policyService.getStepUpChallenge(challengeId, userId);
            if (!challenge) {
              return res.status(404).json({
                success: false,
                error: 'Challenge KYC não encontrado ou expirado',
                code: 'KYC_CHALLENGE_NOT_FOUND'
              });
            }
            effectiveRequirement = effectiveRequirement || challenge.requirement || 'VERIFY_REQUIRED';
            if (requiresCanonicalVerificationRoute({
              challenge,
              requirement: effectiveRequirement
            })) {
              return sendCanonicalRouteRequired(res);
            }
          }

          let verificationPayload = {
            ...req.body.deviceKyc,
            recoverBlocked:
              req.body.deviceKyc.recoverBlocked === true
              || Boolean(challengeId)
          };

          const awsSessionId = legacyAwsSessionId;
          if (awsSessionId) {
            try {
              const awsResult = await this.awsLivenessService.getSessionResult({
                sessionId: awsSessionId,
                userId,
                requireBoundMetadata: true
              });
              if (!awsResult.completed) {
                return res.status(202).json({
                  success: false,
                  code: 'KYC_AWS_LIVENESS_PENDING',
                  error: 'Sessão AWS de liveness ainda está em processamento',
                  provider: awsResult.provider,
                  sessionId: awsResult.sessionId,
                  status: awsResult.status
                });
              }
              retainVerificationWindow = false;
              verificationPayload = this.awsLivenessService.toDevicePayload(awsResult, verificationPayload);
            } catch (awsError) {
              const awsCode = awsError?.code || awsError?.name || 'KYC_AWS_LIVENESS_FAILED';
              const awsStatus = awsCode === 'AWS_LIVENESS_DISABLED'
                ? 503
                : (awsCode === 'ResourceNotFoundException' ? 404 : 400);
              return res.status(awsStatus).json({
                success: false,
                error: awsError.message,
                code: awsCode
              });
            }
          }

          if (
            effectiveRequirement === 'LIVENESS_REQUIRED'
            && !policyService.isLivenessSatisfied(verificationPayload)
          ) {
            return res.status(412).json({
              success: false,
              error: 'Liveness obrigatório para concluir esta verificação',
              code: 'KYC_LIVENESS_REQUIRED',
              requirement: effectiveRequirement
            });
          }

          const deviceResult = await this.kycService.acceptDeviceVerification(userId, verificationPayload);

          if (!deviceResult.success) {
            return res.status(400).json(deviceResult);
          }

          if (challengeId && !deviceResult.isMatch) {
            return res.status(403).json({
              success: false,
              error: 'Verificação facial não aprovada para este desafio',
              code: 'KYC_CHALLENGE_NOT_PASSED',
              userId,
              isMatch: false,
              similarityScore: deviceResult.similarityScore,
              confidence: deviceResult.confidence
            });
          }

          if (challengeId && deviceResult.isMatch) {
            const challengeResolution = await policyService.resolveStepUpChallenge({
              challengeId,
              driverId: userId,
              requirement: effectiveRequirement,
              verificationPayload: {
                ...withoutSensitiveBiometricPayload(verificationPayload),
                ...deviceResult
              }
            });

            if (!challengeResolution.success) {
              return res.status(400).json(challengeResolution);
            }
          }

          if (deviceResult.isMatch) {
            if (typeof policyService.recordVerificationSuccess === 'function') {
              await policyService.recordVerificationSuccess(userId, {
                source: challengeId ? 'stepup_challenge' : 'device_verify'
              });
            }
          }

          return res.json({
            success: true,
            userId,
            isMatch: deviceResult.isMatch,
            similarityScore: deviceResult.similarityScore,
            confidence: deviceResult.confidence,
            threshold: deviceResult.threshold,
            processingTime: deviceResult.processingTime,
            mode: deviceResult.mode,
            decision: deviceResult.decision || null,
            embeddingDimension: deviceResult.embeddingDimension || null,
            comparisonProvider: deviceResult.comparisonProvider || null,
            requirement: effectiveRequirement || 'VERIFY_REQUIRED',
            challengeId
          });
        }

        if (!req.file && !forceRecheck) {
          return res.status(400).json({
            success: false,
            error: 'Imagem atual é obrigatória'
          });
        }

        const result = await this.kycService.verifyDriver(
          userId,
          req.file ? req.file.buffer : null,
          {
            forceRecheck: forceRecheck === 'true' || forceRecheck === true,
            cacheValidityHours: cacheValidityHours ? parseInt(cacheValidityHours) : 24
          }
        );

        if (result.success) {
          if (result.isMatch) {
            if (typeof policyService.recordVerificationSuccess === 'function') {
              await policyService.recordVerificationSuccess(userId, {
                source: 'backend_verify'
              });
            }
          }

          res.json({
            success: true,
            userId: userId,
            isMatch: result.isMatch,
            similarityScore: result.similarityScore,
            confidence: result.confidence,
            threshold: result.threshold,
            processingTime: result.processingTime
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        logError(error, 'Erro na verificação:', { service: 'kyc-routes-routes' });

        if ([
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_VERIFICATION_IN_PROGRESS'
        ].includes(error?.code)) {
          return res.status(409).json({
            success: false,
            error: error.message,
            code: error.code
          });
        }
        
        // Se o erro for por falta de CNH, retornar erro 400 com mensagem específica
        if (error.message && error.message.includes('CNH não encontrada')) {
          return res.status(400).json({
            success: false,
            error: error.message,
            details: 'CNH não encontrada no Firebase Storage'
          });
        }
        
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await kycRuntime?.trustService
            .releaseVerificationWindow(verificationWindowClaim)
            .catch(() => null);
        }
      }
      }
    );

    // Obter assinatura âncora device-first (fallback quando app não tiver cache local)
    this.router.get(
      '/device-anchor/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({ success: false, error: 'userId inválido' });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        if (!firebaseConfig || !firebaseConfig.getFromRealtimeDB) {
          return res.status(503).json({ success: false, error: 'Firebase não configurado' });
        }

        const user = (await firebaseConfig.getFromRealtimeDB(`users/${userId}`)) || {};

        res.json({
          success: true,
          userId,
          anchorSignature: user.kycDeviceAnchorSignature || null,
          anchorAlgorithm: user.kycDeviceAnchorAlgorithm || null,
          anchorUpdatedAt: user.kycDeviceAnchorUpdatedAt || null
        });
      } catch (error) {
        logError(error, 'Erro ao buscar assinatura âncora device-first', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Consultar challenge KYC ativo (usado em step-up de saque)
    this.router.get(
      '/stepup-challenge/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        const challengeId = req.query.challengeId || null;

        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        const challenge = await kycRuntime.policyService.getStepUpChallenge(challengeId, userId);
        if (!challenge) {
          return res.status(404).json({
            success: false,
            error: 'Nenhum challenge KYC ativo',
            code: 'KYC_CHALLENGE_NOT_FOUND'
          });
        }

        return res.json({
          success: true,
          challenge
        });
      } catch (error) {
        logError(error, 'Erro ao buscar challenge KYC ativo', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Obter encoding facial
    this.router.get(
      '/encoding/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        
        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        const encoding = await this.kycService.getFaceEncoding(userId);
        
        if (encoding.success) {
          res.json(encoding);
        } else {
          res.status(404).json(encoding);
        }

      } catch (error) {
        logError(error, 'Erro ao obter encoding:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Deletar encoding facial
    this.router.delete(
      '/encoding/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        const result = await this.kycService.deleteFaceEncoding(userId);
        
        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }

      } catch (error) {
        logError(error, 'Erro ao deletar encoding:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Estatísticas do serviço
    this.router.get('/stats', requireFirebaseUser, async (req, res) => {
      try {
        const authenticatedUserId = req?.authenticatedUser?.uid || req?.firebaseUser?.uid || null;
        if (authenticatedUserId) {
          const kycRuntime = await resolveRequestKycRuntime(req, authenticatedUserId);
          if (kycRuntime.namespace === 'sandbox') {
            return sendSandboxLegacyRouteDisabled(res);
          }
        }
        const stats = await this.kycService.getStats();
        res.json(stats);

      } catch (error) {
        logError(error, 'Erro ao obter estatísticas:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Health check
    this.router.get('/health', requireFirebaseUser, async (req, res) => {
      try {
        const authenticatedUserId = req?.authenticatedUser?.uid || req?.firebaseUser?.uid || null;
        if (authenticatedUserId) {
          const kycRuntime = await resolveRequestKycRuntime(req, authenticatedUserId);
          if (kycRuntime.namespace === 'sandbox') {
            return sendSandboxLegacyRouteDisabled(res);
          }
        }
        const health = await this.kycService.healthCheck();
        res.json(health);

      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          timestamp: Date.now(),
          error: error.message
        });
      }
    });

    // Verificar se motorista tem verificação válida (sem processar)
    this.router.get(
      '/verification-status/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        const { maxAgeHours } = req.query;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        const maxAge = maxAgeHours ? parseInt(maxAgeHours) : 24;
        const [status, firstAccessPolicy, activeChallenge] = await Promise.all([
          kycRuntime.trustService.readCanonicalCompatibilityVerification(userId, maxAge),
          kycRuntime.namespace === 'sandbox'
            ? Promise.resolve({ required: false, reason: null })
            : kycRuntime.policyService.requiresFirstAccessLiveness(userId),
          kycRuntime.policyService.getStepUpChallenge(null, userId)
        ]);

        res.json({
          success: true,
          ...status,
          firstAccessLivenessRequired: Boolean(firstAccessPolicy?.required),
          firstAccessReason: firstAccessPolicy?.reason || null,
          activeStepUpChallenge: activeChallenge
            ? {
                challengeId: activeChallenge.challengeId,
                requirement: activeChallenge.requirement,
                expiresAt: activeChallenge.expiresAt,
                source: activeChallenge.source
              }
            : null
        });

      } catch (error) {
        logError(error, 'Erro ao verificar status:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Invalidar cache de verificação (usado quando há report de violação)
    this.router.post(
      '/invalidate-cache/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        const result = await this.kycService.invalidateVerificationCache(userId);
        res.json(result);

      } catch (error) {
        logError(error, 'Erro ao invalidar cache:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

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
      
      logError(error, 'Erro não tratado:', { service: 'kyc-routes-routes' });
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

module.exports = new KYCRoutes();
