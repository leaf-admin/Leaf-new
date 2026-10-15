// Gerado a partir de routes/kyc-routes.js (divisão mecânica, sem mudança de regra).
// Dependências e helpers de módulo usados pelas rotas.

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const IntegratedKYCService = require('../../services/IntegratedKYCService');
const AwsFaceLivenessService = require('../../services/aws-face-liveness-service');
const CanonicalAwsFaceCompareService = require('../../services/canonical-aws-face-compare-service');
const { resolveKycRuntimeForUser } = require('../../services/kyc-runtime-scope-service');
const {
  assertStoredRecordMatchesScope,
  buildScopedPersistenceEnvelope
} = require('../../services/sandbox-persistence-context');
const canonicalDriverDocumentApprovalService = require('../../services/canonical-driver-document-approval-service');
const { evaluateProductionReadiness } = require('../../services/kyc-biometric-production-policy');
const { requireFirebaseUser, requireFirebaseSelf } = require('../../middleware/firebase-user-auth');
const { logStructured, logError } = require('../../utils/logger');
let firebaseConfig = null;
try {
  firebaseConfig = require('../../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'kyc-routes-routes' });
}

const bodyUserId = (req) => req.body?.userId;
const paramUserId = (req) => req.params?.userId;
const queryUserId = (req) => req.query?.userId;
const IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT =
  'KYC_IDENTITY_REVERIFY_RECONCILIATION_CONFLICT';
const IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT_CODES = new Set([
  'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE',
  'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK',
  'KYC_IDENTITY_REVERIFY_REJECTION_INVALID',
  'KYC_IDENTITY_REVERIFY_CANONICAL_TIMESTAMP_REQUIRED',
  'KYC_IDENTITY_REVERIFY_RETRY_BINDING_INVALID'
]);
const IDENTITY_REVERIFY_REJECTION_MIRROR_SUPERSEDED_CODES = new Set([
  'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE',
  'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
]);

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
  if (IDENTITY_REVERIFY_REJECTION_MIRROR_SUPERSEDED_CODES.has(code)) {
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
  ].includes(code)
    || IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT_CODES.has(code)
    || code === IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT
  ) {
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

module.exports = {
  express,
  multer,
  crypto,
  IntegratedKYCService,
  AwsFaceLivenessService,
  CanonicalAwsFaceCompareService,
  resolveKycRuntimeForUser,
  assertStoredRecordMatchesScope,
  buildScopedPersistenceEnvelope,
  canonicalDriverDocumentApprovalService,
  evaluateProductionReadiness,
  requireFirebaseUser,
  requireFirebaseSelf,
  logStructured,
  logError,
  firebaseConfig,
  bodyUserId,
  paramUserId,
  queryUserId,
  IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT,
  IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT_CODES,
  IDENTITY_REVERIFY_REJECTION_MIRROR_SUPERSEDED_CODES,
  withoutSensitiveBiometricPayload,
  buildPublicCanonicalCompareResult,
  resolvePublicAwsLivenessCredentialsFailure,
  resolvePublicCanonicalConflictFailure,
  normalizeLivenessAttemptScope,
  sendIdentityReviewGateResponse,
  persistIdentityMismatchHold,
  resolveRequestKycRuntime,
  getKycSessionPersistenceBinding,
  getExpectedKycSessionPersistenceBinding,
  isIdentityReverificationRequest,
  resolveLivenessAttemptScope,
  assertPersistedRetrySessionResumable,
  buildResumedLivenessSessionResponse,
  buildPublicLivenessSessionResponse,
  createIdentityLeaseHeartbeat,
  requiresCanonicalVerificationRoute,
  sendCanonicalRouteRequired,
  sendSandboxLegacyRouteDisabled,
  requireOperationalLegacyKycRoute,
  resolveLivenessRetryWindow,
  sendLivenessAttemptRateLimit,
  isLivenessAttemptRateLimited,
};
