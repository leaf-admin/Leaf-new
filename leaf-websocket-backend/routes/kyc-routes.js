const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const IntegratedKYCService = require('../services/IntegratedKYCService');
const AwsFaceLivenessService = require('../services/aws-face-liveness-service');
const CanonicalAwsFaceCompareService = require('../services/canonical-aws-face-compare-service');
const kycPolicyService = require('../services/kyc-policy-service');
const driverIdentityTrustService = require('../services/driver-identity-trust-service');
const failedBiometricEvidenceService = require('../services/kyc-failed-biometric-evidence-service');
const kycIdentityReviewWorkflowService = require('../services/kyc-identity-review-workflow-service');
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

function normalizeLivenessAttemptScope(value) {
  const normalized = String(value || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 64);
  return normalized || 'general';
}

async function persistIdentityMismatchHold(driverId, {
  evidenceId = null,
  decision = 'reject'
} = {}) {
  const firestore = firebaseConfig?.getFirestore?.();
  if (!firestore) {
    const error = new Error('Firestore indisponivel para o hold de identidade');
    error.code = 'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE';
    throw error;
  }
  const ref = firestore.collection('driver_identity_enforcement').doc(driverId);
  const nowIso = new Date().toISOString();
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? (snapshot.data() || {}) : {};
    if (
      current.active === true &&
      (current.permanent === true || String(current.status || '').toUpperCase() === 'PERMANENTLY_BLOCKED')
    ) {
      return current;
    }
    const next = {
      ...current,
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
    transaction.set(ref, next, { merge: false });
    return next;
  });
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
    if (reviewScope.startsWith('manual_review_retry_')) {
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
    error: 'Esta validacao deve usar a comparacao canonica server-side',
    code: 'KYC_CANONICAL_ROUTE_REQUIRED',
    endpoint: '/api/kyc/verify-driver/server-side-selfie'
  });
}

function sendRedisCriticalAuthorityUnavailable(res, error) {
  if (error?.code !== 'REDIS_CRITICAL_AUTHORITY_NOT_READY') return null;
  return res.status(503).json({
    success: false,
    error: 'Serviço de verificação temporariamente indisponível. Tente novamente.',
    code: 'REDIS_CRITICAL_AUTHORITY_NOT_READY',
    retryable: true
  });
}

async function softBlockLivenessAttemptsExhausted({ userId, challengeId = null, attemptState = null, source = 'kyc_route', attemptScope = null } = {}) {
  if (!userId) return null;

  try {
    return await kycPolicyService.markDriverForLivenessAttemptsExhausted({
      driverId: userId,
      challengeId,
      attemptState: attemptState || {},
      metadata: {
        source,
        attemptScope: attemptScope || attemptState?.attemptScope || null
      }
    });
  } catch (error) {
    logError(error, 'Falha ao aplicar soft block por limite de liveness', {
      service: 'kyc-routes-routes',
      userId,
      challengeId,
      source
    });
    return null;
  }
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
        return res.json({
          success: true,
          provider: this.awsLivenessService.getProviderName(),
          config: this.awsLivenessService.getConfigSummary()
        });
      } catch (error) {
        logError(error, 'Erro ao consultar provider de liveness', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    this.router.get('/biometrics/readiness', requireFirebaseUser, async (_req, res) => {
      try {
        const readiness = evaluateProductionReadiness(process.env);
        return res.status(readiness.ok ? 200 : 503).json({
          success: readiness.ok,
          ...readiness,
          awsLiveness: this.awsLivenessService.getConfigSummary(),
          awsFaceCompare: this.awsFaceCompareService.getConfigSummary(),
          biometricFaceService: {
            configured: Boolean(
              String(process.env.BIOMETRIC_FACE_SERVICE_URL || '').trim()
              && String(process.env.BIOMETRIC_FACE_SERVICE_API_KEY || '').trim()
            ),
            urlConfigured: Boolean(String(process.env.BIOMETRIC_FACE_SERVICE_URL || '').trim())
          }
        });
      } catch (error) {
        logError(error, 'Erro ao consultar prontidão biométrica', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
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
      try {
        const { userId, challengeId, requirement } = req.body || {};
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }

        const identityReviewGate = await kycIdentityReviewWorkflowService
          .assertKycOperationAllowed(userId);
        if (identityReviewGate.identityReviewHold) {
          return res.status(423).json({
            success: false,
            error: 'Sua solicitacao de analise de identidade esta em andamento.',
            code: 'KYC_IDENTITY_REVIEW_HOLD',
            reviewAvailable: true,
            reviewCaseId: identityReviewGate.holdCaseId || null
          });
        }

        const effectiveChallengeId = typeof challengeId === 'string' && challengeId.trim()
          ? challengeId.trim()
          : null;
        let challenge = null;
        let authorizedAttemptScope = null;
        let effectiveRequirement = typeof requirement === 'string' && requirement.trim()
          ? requirement.trim()
          : null;
        const isIdentityReverification = isIdentityReverificationRequest({
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement
        });

        if (effectiveChallengeId && !isIdentityReverification) {
          challenge = await kycPolicyService.getStepUpChallenge(effectiveChallengeId, userId);
          if (!challenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = challenge.requirement || effectiveRequirement || 'VERIFY_REQUIRED';
        } else if (isIdentityReverification) {
          const identityState = await Promise.resolve(
            firebaseConfig?.getFromRealtimeDB?.(`users/${userId}/identityReverification`)
          ).catch(() => null);
          const identityChallengeIsActive = Boolean(
            effectiveChallengeId
            && identityState?.challengeId === effectiveChallengeId
            && identityState?.requirement === 'IDENTITY_REVERIFICATION'
            && ['requested', 'failed'].includes(identityState?.status)
          );
          if (!identityChallengeIsActive) {
            return res.status(404).json({
              success: false,
              error: 'Revalidacao de identidade nao encontrada ou ja concluida',
              code: 'KYC_IDENTITY_REVERIFICATION_NOT_ACTIVE'
            });
          }
          const candidateAttemptScope = normalizeLivenessAttemptScope(identityState?.attemptScope || '');
          authorizedAttemptScope = candidateAttemptScope.startsWith('manual_review_retry_')
            ? candidateAttemptScope
            : null;
          effectiveRequirement = 'IDENTITY_REVERIFICATION';
        } else {
          const firstAccessPolicy = await kycPolicyService.requiresFirstAccessLiveness(userId)
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

        await this.canonicalDriverDocumentApprovalService.requireApprovedCnh(userId);

        const attemptScope = resolveLivenessAttemptScope({
          challenge,
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement,
          authorizedAttemptScope
        });

        verificationWindowClaim = await driverIdentityTrustService.claimVerificationWindow(userId, {
          scope: 'aws_liveness_session'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }

        if (isIdentityReverification) {
          const startedResult = await kycPolicyService.recordIdentityReverificationStarted(userId, {
            challengeId: effectiveChallengeId,
            requirement: 'IDENTITY_REVERIFICATION'
          });
          if (startedResult?.recorded !== true) {
            return res.status(409).json({
              success: false,
              error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
              code: startedResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
            });
          }
        }

        cleanRetryAuthorizationClaim = await kycIdentityReviewWorkflowService
          .claimCleanRetryAuthorization(userId, attemptScope);

        const session = await this.awsLivenessService.createSession({
          userId,
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement,
          attemptScope,
          verificationWindowToken: verificationWindowClaim.token
        });
        cleanRetrySessionCreated = true;
        if (cleanRetryAuthorizationClaim) {
          await kycIdentityReviewWorkflowService.consumeCleanRetryAuthorization(
            cleanRetryAuthorizationClaim,
            session.sessionId
          );
        }
        retainVerificationWindow = true;

        return res.status(201).json({
          success: true,
          ...session
        });
      } catch (error) {
        if (
          cleanRetryAuthorizationClaim
          && !cleanRetrySessionCreated
          && error?.providerDispatched !== true
        ) {
          await kycIdentityReviewWorkflowService.releaseCleanRetryAuthorization(
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
        const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
        if (authorityUnavailable) return authorityUnavailable;
        const isDisabled = error?.code === 'AWS_LIVENESS_DISABLED';
        const attemptsExhausted = error?.code === 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED';
        const activeTripDeferred = error?.code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
        const verificationBusy = error?.code === 'KYC_VERIFICATION_IN_PROGRESS';
        const stateUnavailable = [
          'KYC_REVERIFY_STATE_UNAVAILABLE',
          'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE',
          'KYC_TRUST_STORE_UNAVAILABLE'
        ].includes(error?.code);
        const dispatchOutcomeUnknown = error?.code === 'KYC_AWS_LIVENESS_DISPATCH_OUTCOME_UNKNOWN';
        const unsupportedS3Output = error?.code === 'AWS_LIVENESS_S3_OUTPUT_UNSUPPORTED';
        const costGuardUnavailable = new Set([
          'KYC_AWS_COST_GUARD_REQUIRED',
          'KYC_AWS_COST_GUARD_CONFIG_INVALID',
          'KYC_AWS_COST_GUARD_UNAVAILABLE',
          'KYC_AWS_COST_BUDGET_EXHAUSTED'
        ]).has(error?.code);
        const canonicalCnhMissing = [
          'KYC_CANONICAL_APPROVED_CNH_REQUIRED',
          'KYC_CANONICAL_DOCUMENT_REUPLOAD_REQUIRED'
        ].includes(error?.code);
        const identityPermanentlyBlocked = error?.code === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK';
        const statusCode = identityPermanentlyBlocked
          ? 423
          : attemptsExhausted
          ? 423
          : ((activeTripDeferred || verificationBusy || canonicalCnhMissing)
            ? 409
            : ((isDisabled
              || stateUnavailable
              || unsupportedS3Output
              || costGuardUnavailable
              || dispatchOutcomeUnknown) ? 503 : 500));
        let softBlock = null;
        if (attemptsExhausted && error.attemptState?.softBlocked === true) {
          softBlock = await softBlockLivenessAttemptsExhausted({
            userId: req.body?.userId,
            challengeId: req.body?.challengeId || null,
            attemptState: error.attemptState || null,
            source: 'create_liveness_session_guard',
            attemptScope: error.attemptState?.attemptScope || null
          });
        }
        logError(error, 'Erro ao criar sessão AWS liveness', { service: 'kyc-routes-routes' });
        return res.status(statusCode).json({
          success: false,
          error: identityPermanentlyBlocked
            ? 'Esta conta nao pode usar o modo motorista.'
            : error.message,
          code: error.code || 'KYC_AWS_LIVENESS_SESSION_ERROR',
          softBlocked: Boolean(softBlock?.softBlocked),
          supportTicketId: softBlock?.supportTicketId || null,
          attemptState: error.attemptState || null,
          retryAt: error.retryAt || null
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await driverIdentityTrustService
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

        await driverIdentityTrustService.assertVerificationOutsideActiveTrip(userId);
        const result = await this.awsLivenessService.abandonSession({
          sessionId,
          userId
        });

        return res.json({
          success: true,
          abandoned: true,
          sessionId: result.sessionId
        });
      } catch (error) {
        const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
        if (authorityUnavailable) return authorityUnavailable;
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
      try {
        const { sessionId } = req.params;
        const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, { userId });
        verificationWindowClaim = await driverIdentityTrustService.claimVerificationWindow(userId, {
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
        let softBlock = null;
        if (
          result?.completed === true
          && result?.livenessPassed !== true
          && result?.attemptState?.softBlocked === true
          && result?.attemptState?.justExhausted === true
        ) {
          softBlock = await softBlockLivenessAttemptsExhausted({
            userId,
            challengeId: result?.challengeId || null,
            attemptState: result.attemptState,
            source: 'get_liveness_result',
            attemptScope: result?.attemptScope || result?.attemptState?.attemptScope || null
          });
        }
        if (result?.completed === true && result?.livenessPassed !== true) {
          retainVerificationWindow = false;
        }

        return res.json({
          success: true,
          ...result,
          softBlocked: Boolean(softBlock?.softBlocked)
        });
      } catch (error) {
        const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
        if (authorityUnavailable) return authorityUnavailable;
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
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          code
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await driverIdentityTrustService
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
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, { userId });
        const verificationWindowClaim = await driverIdentityTrustService.claimVerificationWindow(
          userId,
          {
            token: sessionMetadata.verificationWindowToken || null,
            scope: 'aws_liveness_credentials'
          }
        );
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }
        await driverIdentityTrustService.assertVerificationOutsideActiveTrip(userId);
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
        const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
        if (authorityUnavailable) return authorityUnavailable;
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_CREDENTIALS_ERROR';
        let statusCode = 500;
        if (code === 'AWS_LIVENESS_DISABLED' || code === 'AWS_LIVENESS_CREDENTIALS_DISABLED') statusCode = 503;
        if (code === 'AWS_LIVENESS_ASSUME_ROLE_MISSING') statusCode = 503;
        if (code === 'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED') statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_METADATA_REQUIRED') statusCode = 404;
        if (code === 'AWS_LIVENESS_SESSION_EXPIRED') statusCode = 410;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'AWS_LIVENESS_SESSION_ABANDONED') statusCode = 409;
        if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP' || code === 'KYC_VERIFICATION_IN_PROGRESS') statusCode = 409;
        if (code === 'AWS_LIVENESS_SESSION_BINDING_INVALID' || code === 'AWS_LIVENESS_SESSION_NOT_FOUND') statusCode = 404;
        if (code === 'AccessDenied' || code === 'AccessDeniedException') statusCode = 403;
        if (code === 'ValidationError' || code === 'ValidationException') statusCode = 400;

        logError(error, 'Erro ao emitir credenciais AWS liveness', { service: 'kyc-routes-routes' });
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          code
        });
      }
      }
    );

    // Upload de imagem de perfil
    this.router.post(
      '/upload-profile',
      requireFirebaseUser,
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

        const approvalGate = await kycPolicyService.requireApprovedKyc(userId);
        const implicitChallenge = !challengeId
          ? await kycPolicyService.getStepUpChallenge(null, userId)
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
          challenge = await kycPolicyService.getStepUpChallenge(challengeId, userId);
          if (!challenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = effectiveRequirement || challenge.requirement || 'VERIFY_REQUIRED';
        }

        const firstAccessPolicy = await kycPolicyService.requiresFirstAccessLiveness(userId);
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
          this.awsLivenessService.assertBoundSessionMetadata(boundSessionMetadata, { userId });
        }
        if (requiresCanonicalVerificationRoute({
          awsSessionId,
          challenge,
          requirement: effectiveRequirement,
          firstAccessLivenessRequired
        })) {
          return sendCanonicalRouteRequired(res);
        }
        verificationWindowClaim = await driverIdentityTrustService.claimVerificationWindow(userId, {
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
          kycPolicyService.requireApprovedKyc(userId),
          kycPolicyService.requiresFirstAccessLiveness(userId),
          kycPolicyService.getStepUpChallenge(null, userId)
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
            if (
              awsResult?.completed === true
              && awsResult?.livenessPassed !== true
              && awsResult?.attemptState?.softBlocked === true
              && awsResult?.attemptState?.justExhausted === true
            ) {
              await softBlockLivenessAttemptsExhausted({
                userId,
                challengeId,
                attemptState: awsResult.attemptState,
                source: 'device_verify_liveness_result',
                attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null
              });
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
          && !kycPolicyService.isLivenessSatisfied(verificationPayload)
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
          const challengeResolution = await kycPolicyService.resolveStepUpChallenge({
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
          await kycPolicyService.recordVerificationSuccess(userId, {
            source: challengeId ? 'stepup_challenge' : 'device_verify'
          });
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
        const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
        if (authorityUnavailable) return authorityUnavailable;
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
          await driverIdentityTrustService
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
      try {
        const { userId, awsSessionId, challengeId, requirement, forceRecheck } = req.body || {};

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

        const identityReviewGate = await kycIdentityReviewWorkflowService
          .assertKycOperationAllowed(userId);
        if (identityReviewGate.identityReviewHold) {
          return res.status(423).json({
            success: false,
            error: 'Sua solicitacao de analise de identidade esta em andamento.',
            code: 'KYC_IDENTITY_REVIEW_HOLD',
            reviewAvailable: true,
            reviewCaseId: identityReviewGate.holdCaseId || null
          });
        }

        const isIdentityReverificationRequest =
          requirement === 'IDENTITY_REVERIFICATION' ||
          String(challengeId || '').startsWith('idrev_');
        let effectiveRequirement = requirement || null;
        let stepUpChallenge = null;
        if (isIdentityReverificationRequest) {
          effectiveRequirement = 'IDENTITY_REVERIFICATION';
        } else if (challengeId) {
          stepUpChallenge = await kycPolicyService.getStepUpChallenge(challengeId, userId);
          if (!stepUpChallenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = stepUpChallenge.requirement || effectiveRequirement || 'VERIFY_REQUIRED';
        }

        const firstAccessPolicy = await kycPolicyService.requiresFirstAccessLiveness(userId);
        const firstAccessLivenessRequired = !challengeId && firstAccessPolicy.required === true;
        if (!effectiveRequirement && firstAccessLivenessRequired) {
          effectiveRequirement = 'LIVENESS_REQUIRED';
        }

        let boundSessionMetadata = null;
        let sessionMetadataCandidate = null;
        let sessionMetadataError = null;
        try {
          sessionMetadataCandidate = await this.awsLivenessService.getSessionMetadata(awsSessionId);
          this.awsLivenessService.assertBoundSessionMetadata(sessionMetadataCandidate, {
            userId,
            expectedChallengeId: challengeId || null,
            expectedRequirement: effectiveRequirement || null
          });
          boundSessionMetadata = sessionMetadataCandidate;
        } catch (error) {
          sessionMetadataError = error;
        }
        if (sessionMetadataError?.code === 'AWS_LIVENESS_SESSION_ABANDONED') {
          throw sessionMetadataError;
        }

        canonicalSessionClaim = await driverIdentityTrustService.claimCanonicalSession(
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
            () => driverIdentityTrustService.renewCanonicalSessionClaim(canonicalSessionClaim)
          );
          await leaseHeartbeat.assertHeld();
          const reconciledVerification = (
            isIdentityReverificationRequest || firstAccessLivenessRequired
          )
            ? driverIdentityTrustService.restoreApprovedIdentityVerification(
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
            await driverIdentityTrustService.assertVerificationOutsideActiveTrip(userId);
            if (isIdentityReverificationRequest) {
              const identityResult = await kycPolicyService.recordIdentityReverificationResult(
                userId,
                {
                  ...reconciledVerification,
                  reconciliationOnly: true
                }
              );
              if (identityResult?.recorded !== true) {
                retainVerificationWindow = false;
                return res.status(409).json({
                  success: false,
                  error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
                  code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
                });
              }
            }
            await kycPolicyService.recordVerificationSuccess(userId, {
              source: firstAccessLivenessRequired
                ? 'canonical_first_access_reconciliation'
                : 'canonical_identity_reconciliation',
              markFirstAccess: firstAccessLivenessRequired,
              clearReverify: false
            });
            await kycIdentityReviewWorkflowService.clearResolvedMismatchHold(userId, {
              source: firstAccessLivenessRequired
                ? 'canonical_first_access_reconciliation'
                : 'canonical_identity_reconciliation'
            });
            await leaseHeartbeat.assertHeld();
            retainVerificationWindow = false;
            return res.json({
              ...reconciledVerification,
              idempotentReconciliation: true
            });
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
          () => driverIdentityTrustService.renewCanonicalSessionClaim(canonicalSessionClaim)
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
              provider: awsResult.provider,
              sessionId: awsResult.sessionId,
              status: awsResult.status
            });
          }
          livenessPayload = this.awsLivenessService.toDevicePayload(awsResult, livenessPayload);
          if (
            awsResult?.completed === true
            && awsResult?.livenessPassed !== true
            && awsResult?.attemptState?.softBlocked === true
            && awsResult?.attemptState?.justExhausted === true
          ) {
            await softBlockLivenessAttemptsExhausted({
              userId,
              challengeId,
              attemptState: awsResult.attemptState,
              source: 'server_side_selfie_liveness_result',
              attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null
            });
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

        if (!kycPolicyService.isLivenessSatisfied(livenessPayload)) {
          retainVerificationWindow = false;
          return res.status(412).json({
            success: false,
            error: 'Liveness obrigatório para concluir esta verificação',
            code: 'KYC_LIVENESS_REQUIRED',
            requirement: effectiveRequirement || 'LIVENESS_REQUIRED'
          });
        }

        await driverIdentityTrustService.assertVerificationOutsideActiveTrip(userId);

        if (isIdentityReverificationRequest) {
          const currentIdentityChallenge = await kycPolicyService.recordIdentityReverificationStarted(
            userId,
            {
              challengeId: challengeId || null,
              requirement: 'IDENTITY_REVERIFICATION',
              canonicalPreCompareCheck: true
            }
          );
          if (currentIdentityChallenge?.recorded !== true) {
            retainVerificationWindow = false;
            return res.status(409).json({
              success: false,
              error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
              code: currentIdentityChallenge?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
            });
          }
        }

        const referenceImageAvailable = Buffer.isBuffer(awsResult?.referenceImageBuffer)
          && awsResult.referenceImageBuffer.length > 0;
        if (!referenceImageAvailable) {
          await leaseHeartbeat.assertHeld();
          const recovery = await this.awsLivenessService.grantReferenceImageRecoveryAttempt({
            userId,
            sessionId: awsSessionId,
            requirement: effectiveRequirement,
            attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null
          });
          retainVerificationWindow = false;
          if (recovery.canRetry !== true) {
            return res.status(503).json({
              success: false,
              error: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.',
              code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
              retryable: false,
              attemptState: recovery.attemptState || null
            });
          }
          return res.status(422).json({
            success: false,
            error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.',
            code: 'KYC_AWS_REFERENCE_IMAGE_REQUIRED',
            retryable: true,
            attemptState: recovery.attemptState || null
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
            attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null
          });
          retainVerificationWindow = false;
          if (recovery.canRetry !== true) {
            return res.status(503).json({
              success: false,
              error: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.',
              code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
              retryable: false,
              attemptState: recovery.attemptState || null
            });
          }
          return res.status(422).json({
            success: false,
            error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.',
            code: comparisonError.code,
            retryable: true,
            attemptState: recovery.attemptState || null
          });
        }

        if (!verificationResult.success) {
          const status = verificationResult.code === 'BIOMETRIC_FACE_SERVICE_NOT_CONFIGURED'
            ? 503
            : (verificationResult.code === 'CNH_FACE_EMBEDDING_NOT_FOUND' ? 409 : 400);
          return res.status(status).json(verificationResult);
        }

        await leaseHeartbeat.assertHeld();
        await driverIdentityTrustService.assertVerificationOutsideActiveTrip(userId);

        if (!verificationResult.isMatch) {
          const failureRecord = await driverIdentityTrustService.recordCanonicalFailure(userId, {
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
          try {
            reviewEvidence = await failedBiometricEvidenceService.captureRejectedComparisonEvidence({
              driverId: userId,
              referenceImageBuffer: awsResult.referenceImageBuffer,
              liveness: verificationResult.liveness,
              comparison: verificationResult,
              cnh: verificationResult.reference
            });
          } catch (evidenceError) {
            // A indisponibilidade da trilha de revisão jamais transforma uma
            // divergência canônica em aprovação. O hard-fail permanece ativo.
            logError(evidenceError, 'Falha ao reter evidencia privada de divergencia facial', {
              service: 'kyc-routes-routes',
              userId,
              code: evidenceError?.code || null
            });
          }
          try {
            await persistIdentityMismatchHold(userId, {
              evidenceId: reviewEvidence?.evidenceId || null,
              decision: verificationResult.decision || 'reject'
            });
          } catch (holdError) {
            // O trust canônico já foi revogado acima; este espelho adicional
            // existe para impedir troca de CNH e novas chamadas pagas.
            logError(holdError, 'Falha ao persistir hold de divergencia facial', {
              service: 'kyc-routes-routes',
              userId,
              code: holdError?.code || null
            });
          }
          if (isIdentityReverificationRequest) {
            const identityResult = await kycPolicyService.recordIdentityReverificationResult(userId, {
              ...verificationResult,
              requirement: effectiveRequirement,
              challengeId: challengeId || null
            });
            if (identityResult?.recorded !== true) {
              return res.status(409).json({
                success: false,
                error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
                code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
              });
            }
          }
          retainVerificationWindow = false;
          return res.status(403).json({
            success: false,
            error: isIdentityReverificationRequest
              ? 'Não foi possível concluir a validação agora'
              : 'Verificação facial não aprovada para este desafio',
            code: 'KYC_CHALLENGE_NOT_PASSED',
            userId,
            isMatch: false,
            reviewAvailable: Boolean(reviewEvidence?.evidenceId),
            evidenceId: reviewEvidence?.evidenceId || null,
            reviewCaseId: null
          });
        }

        let canonicalRecord = null;
        if (verificationResult.isMatch) {
          try {
            canonicalRecord = await driverIdentityTrustService.recordCanonicalSuccess(userId, {
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
            return res.status(canonicalConflict ? 409 : 503).json({
              success: false,
              error: canonicalConflict
                ? canonicalError.message
                : 'A validacao foi concluida, mas nao foi possivel registrar a evidencia agora.',
              code: canonicalError.code || 'KYC_CANONICAL_EVIDENCE_PERSIST_FAILED'
            });
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
          const identityResult = await kycPolicyService.recordIdentityReverificationResult(userId, {
            ...verificationResult,
            requirement: effectiveRequirement,
            challengeId: challengeId || null
          });
          if (identityResult?.recorded !== true) {
            return res.status(409).json({
              success: false,
              error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
              code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
            });
          }
        }

        if (verificationResult.isMatch) {
          await kycPolicyService.recordVerificationSuccess(userId, {
            source: challengeId ? 'stepup_challenge' : 'server_side_selfie_verify',
            markFirstAccess: firstAccessLivenessRequired,
            clearReverify: false
          });
          await kycIdentityReviewWorkflowService.clearResolvedMismatchHold(userId, {
            source: 'server_side_aws_reference_compare'
          });
        }

        retainVerificationWindow = false;

        return res.json({
          success: true,
          userId,
          isMatch: verificationResult.isMatch,
          needsReview: verificationResult.needsReview || false,
          similarityScore: verificationResult.similarityScore,
          confidence: verificationResult.confidence,
          threshold: verificationResult.threshold,
          reviewThreshold: verificationResult.reviewThreshold,
          processingTime: verificationResult.processingTime,
          mode: verificationResult.mode,
          decision: verificationResult.decision || null,
          embeddingDimension: verificationResult.embeddingDimension || null,
          comparisonProvider: verificationResult.comparisonProvider || null,
          provider: verificationResult.provider || null,
          requirement: effectiveRequirement || 'LIVENESS_REQUIRED',
          challengeId: challengeId || null
        });
      } catch (error) {
        logError(error, 'Erro na verificação server-side pós-liveness:', { service: 'kyc-routes-routes' });
        const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
        if (authorityUnavailable) return authorityUnavailable;
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
        const costGuardUnavailable = new Set([
          'KYC_AWS_COST_GUARD_REQUIRED',
          'KYC_AWS_COST_GUARD_CONFIG_INVALID',
          'KYC_AWS_COST_GUARD_UNAVAILABLE',
          'KYC_AWS_COST_OPERATION_NOT_FOUND',
          'KYC_AWS_COST_OPERATION_STATE_INVALID',
          'KYC_AWS_COMPARE_OUTCOME_UNKNOWN'
        ]).has(error?.code);
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
          : (stateUnavailable || costGuardUnavailable)
          ? 503
          : (conflictCodes.has(error?.code)
            ? 409
            : ((isDocumentImageFailure || isLivenessImageFailure) ? 422 : 500));
        const safeError = identityPermanentlyBlocked
          ? 'Esta conta nao pode usar o modo motorista.'
          : isDocumentImageFailure
          ? 'Não conseguimos identificar a foto na CNH aprovada. Envie uma nova versão do documento.'
          : (isLivenessImageFailure
            ? 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.'
            : ((stateUnavailable || costGuardUnavailable || conflictCodes.has(error?.code))
              ? error.message
              : 'Erro interno do servidor'));
        return res.status(statusCode).json({
          success: false,
          error: safeError,
          code: error?.code || 'KYC_SERVER_SIDE_VERIFICATION_ERROR',
          details: undefined
        });
      } finally {
        leaseHeartbeat?.stop();
        await driverIdentityTrustService
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
      this.upload.single('currentImage'),
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      try {
        const { userId, forceRecheck, cacheValidityHours } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        const legacyChallengeId = req.body?.challengeId || null;
        const [approvalGate, firstAccessPolicy, implicitChallenge] = await Promise.all([
          kycPolicyService.requireApprovedKyc(userId),
          kycPolicyService.requiresFirstAccessLiveness(userId),
          legacyChallengeId
            ? Promise.resolve(null)
            : kycPolicyService.getStepUpChallenge(null, userId)
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
          this.awsLivenessService.assertBoundSessionMetadata(boundSessionMetadata, { userId });
          return sendCanonicalRouteRequired(res);
        }
        verificationWindowClaim = await driverIdentityTrustService.claimVerificationWindow(userId, {
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
          kycPolicyService.requireApprovedKyc(userId),
          kycPolicyService.requiresFirstAccessLiveness(userId),
          kycPolicyService.getStepUpChallenge(null, userId)
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
            const challenge = await kycPolicyService.getStepUpChallenge(challengeId, userId);
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
            && !kycPolicyService.isLivenessSatisfied(verificationPayload)
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
            const challengeResolution = await kycPolicyService.resolveStepUpChallenge({
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
            await kycPolicyService.recordVerificationSuccess(userId, {
              source: challengeId ? 'stepup_challenge' : 'device_verify'
            });
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
            await kycPolicyService.recordVerificationSuccess(userId, {
              source: 'backend_verify'
            });
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
        const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
        if (authorityUnavailable) return authorityUnavailable;

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
          await driverIdentityTrustService
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

        const challenge = await kycPolicyService.getStepUpChallenge(challengeId, userId);
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

        const [status, firstAccessPolicy, activeChallenge] = await Promise.all([
          this.kycService.hasValidVerification(
            userId,
            maxAgeHours ? parseInt(maxAgeHours) : 24
          ),
          kycPolicyService.requiresFirstAccessLiveness(userId),
          kycPolicyService.getStepUpChallenge(null, userId)
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

      const authorityUnavailable = sendRedisCriticalAuthorityUnavailable(res, error);
      if (authorityUnavailable) return authorityUnavailable;
      
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
