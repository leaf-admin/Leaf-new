const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const { getAdminUser } = require('../utils/admin-user-cache');
const canonicalDriverDocumentApprovalService = require('./canonical-driver-document-approval-service');
const driverIdentityTrustService = require('./driver-identity-trust-service');
const kycFailedBiometricEvidenceService = require('./kyc-failed-biometric-evidence-service');
const supportTicketService = require('./support-ticket-service');
const {
  resolveKycPersistenceScope,
  buildScopedPersistenceEnvelope,
  assertStoredRecordMatchesScope,
  assertScopedResourceName
} = require('./sandbox-persistence-context');
const {
  KycIdentityReviewCaseService,
  CASE_STATUSES,
  DEFAULT_COLLECTIONS
} = require('./kyc-identity-review-case-service');

const REVIEWER_ROLES = new Set(['admin', 'super-admin', 'manager']);
const OPEN_CASE_STATUSES = new Set([CASE_STATUSES.OPEN, CASE_STATUSES.UNDER_REVIEW]);
const MANUAL_REVIEW_RETRY_SCOPE_PREFIX = 'manual_review_retry_';
const ORPHAN_HOLD_RETRY_SCOPE_PREFIX = 'orphan_hold_retry_';
const MANUAL_REVIEW_CASE_ID_PATTERN = /^kyc_ir_[a-f0-9]{32}$/;
const ORPHAN_RECOVERY_ID_PATTERN = /^kyc_or_[a-f0-9]{32}$/;
const ORPHAN_RECOVERY_PURPOSE = 'ORPHAN_HOLD_ONE_CLEAN_IDENTITY_RETRY';
const MANUAL_REVIEW_RETRY_PURPOSE = 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY';
const ORPHAN_RECOVERY_ENFORCEMENT_STATUS = 'ORPHAN_HOLD_RETRY_AUTHORIZED';
const ORPHAN_HOLD_ENFORCEMENT_STATUS = 'ORPHAN_IDENTITY_HOLD';
const ORPHAN_RECOVERY_TTL_MS = 30 * 60 * 1000;
const ORPHAN_RECOVERY_MIN_TTL_MS = 5 * 60 * 1000;
const ORPHAN_RECOVERY_MAX_TTL_MS = 60 * 60 * 1000;
const RETRY_TERMINAL_OUTCOMES = new Set(['SUCCEEDED', 'REJECTED', 'ABORTED']);

function domainError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requiredId(value, field, code = 'KYC_IDENTITY_REVIEW_INPUT_INVALID') {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 160 || normalized.includes('/') || normalized.includes('..')) {
    throw domainError(code, `${field} invalido`, { field });
  }
  return normalized;
}

function optionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function requiredReason(value) {
  const normalized = String(value || '').trim();
  if (normalized.length < 20 || normalized.length > 1000) {
    throw domainError(
      'KYC_ORPHAN_HOLD_RECOVERY_REASON_REQUIRED',
      'A recuperacao exige uma justificativa de 20 a 1000 caracteres'
    );
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw domainError('KYC_ORPHAN_HOLD_RECOVERY_INPUT_INVALID', `${field} invalido`, { field });
  }
  return normalized;
}

function sameIso(left, right) {
  const leftMs = Date.parse(String(left || ''));
  const rightMs = Date.parse(String(right || ''));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function normalizeEmail(value) {
  return optionalString(value)?.toLowerCase() || null;
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  throw domainError(
    'KYC_IDENTITY_REVIEW_TIMESTAMP_INVALID',
    'A evidencia nao possui data canonica valida'
  );
}

function reviewerFromContext(reviewerContext = {}) {
  return {
    uid: optionalString(reviewerContext.uid || reviewerContext.id),
    email: normalizeEmail(reviewerContext.email)
  };
}

function isSandboxTicket(ticket = {}) {
  const metadata = ticket.metadata && typeof ticket.metadata === 'object'
    ? ticket.metadata
    : {};
  const namespaces = [
    ticket.financialNamespace,
    ticket.financialContext?.namespace,
    metadata.financialNamespace,
    metadata.namespace,
    metadata.financialContext?.namespace
  ].map((value) => String(value || '').trim().toLowerCase());
  const providerEnvironments = [
    ticket.financialContext?.providerEnvironment,
    metadata.providerEnvironment,
    metadata.financialContext?.providerEnvironment
  ].map((value) => String(value || '').trim().toLowerCase());

  return namespaces.includes('sandbox')
    || providerEnvironments.includes('sandbox')
    || ticket.testData === true
    || metadata.testData === true
    || metadata.sandbox === true;
}

function safeTicketMetadata(ticket = {}) {
  return {
    id: optionalString(ticket.id),
    userId: optionalString(ticket.userId),
    userType: optionalString(ticket.userType),
    subject: optionalString(ticket.subject),
    category: optionalString(ticket.category),
    priority: optionalString(ticket.priority),
    status: optionalString(ticket.status),
    createdAt: ticket.createdAt || null,
    updatedAt: ticket.updatedAt || null
  };
}

function safeEvidenceMetadata(metadata = {}) {
  return {
    evidenceId: optionalString(metadata.evidenceId),
    driverId: optionalString(metadata.driverId),
    state: optionalString(metadata.state),
    contentType: optionalString(metadata.contentType),
    byteLength: Number.isFinite(Number(metadata.byteLength)) ? Number(metadata.byteLength) : null,
    cnhSubmissionId: optionalString(metadata.cnhSubmissionId),
    decision: optionalString(metadata.decision),
    similarityScore: Number.isFinite(Number(metadata.similarityScore))
      ? Number(metadata.similarityScore)
      : null,
    threshold: Number.isFinite(Number(metadata.threshold)) ? Number(metadata.threshold) : null,
    ticketId: optionalString(metadata.ticketId),
    caseId: optionalString(metadata.caseId),
    reviewOutcome: optionalString(metadata.reviewOutcome),
    permanentBlockRecommended: metadata.permanentBlockRecommended === true,
    createdAt: metadata.createdAt || null,
    expiresAt: metadata.expiresAt || null
  };
}

function safeCaseMetadata(record = {}) {
  const evidenceBinding = record.evidenceBinding && typeof record.evidenceBinding === 'object'
    ? record.evidenceBinding
    : {};
  const faceCompare = evidenceBinding.faceCompare && typeof evidenceBinding.faceCompare === 'object'
    ? evidenceBinding.faceCompare
    : {};
  const approvedCnh = evidenceBinding.approvedCnh && typeof evidenceBinding.approvedCnh === 'object'
    ? evidenceBinding.approvedCnh
    : {};
  const review = record.review && typeof record.review === 'object' ? record.review : null;
  const resolution = record.resolution && typeof record.resolution === 'object'
    ? record.resolution
    : null;
  return {
    schemaVersion: record.schemaVersion || null,
    caseId: optionalString(record.caseId),
    driverId: optionalString(record.driverId),
    ticketId: optionalString(record.ticketId),
    ticketIds: Array.isArray(record.ticketIds)
      ? record.ticketIds.map(optionalString).filter(Boolean)
      : [],
    status: optionalString(record.status),
    revision: Number(record.revision || 0),
    evidenceBindingHash: optionalString(record.evidenceBindingHash),
    evidence: {
      evidenceId: optionalString(evidenceBinding.evidenceId),
      approvedCnhSubmissionId: optionalString(approvedCnh.documentId),
      faceCompare: {
        provider: optionalString(faceCompare.provider),
        decision: optionalString(faceCompare.decision),
        similarityScore: Number.isFinite(Number(faceCompare.similarityScore))
          ? Number(faceCompare.similarityScore)
          : null,
        threshold: Number.isFinite(Number(faceCompare.threshold))
          ? Number(faceCompare.threshold)
          : null,
        comparedAt: faceCompare.comparedAt || null
      },
      retainUntil: record.evidenceAccess?.retainUntil || null,
      classification: optionalString(record.evidenceAccess?.classification)
    },
    review: review ? {
      startedBy: review.startedBy ? {
        uid: optionalString(review.startedBy.uid),
        email: normalizeEmail(review.startedBy.email)
      } : null,
      startedAt: review.startedAt || null,
      reason: optionalString(review.reason),
      ticketId: optionalString(review.ticketId)
    } : null,
    resolution: resolution ? {
      decision: optionalString(resolution.decision),
      explicitAdminDecision: resolution.explicitAdminDecision === true,
      reviewer: resolution.reviewer ? {
        uid: optionalString(resolution.reviewer.uid),
        email: normalizeEmail(resolution.reviewer.email)
      } : null,
      reason: optionalString(resolution.reason),
      ticketId: optionalString(resolution.ticketId),
      decidedAt: resolution.decidedAt || null
    } : null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    closedAt: record.closedAt || null
  };
}

function safeRetryAuthorizationMetadata(record = {}) {
  return {
    authorizationId: optionalString(record.authorizationId),
    recoveryId: optionalString(record.recoveryId),
    caseId: optionalString(record.caseId),
    driverId: optionalString(record.driverId),
    purpose: optionalString(record.purpose),
    status: optionalString(record.status),
    allowedAttempts: Number(record.allowedAttempts || 0),
    remainingAttempts: Number(record.remainingAttempts || 0),
    authorizedAt: record.authorizedAt || null,
    expiresAt: record.expiresAt || null,
    consumedAt: record.consumedAt || null,
    terminalAt: record.terminalAt || null,
    identityApproved: record.identityApproved === true
  };
}

function buildReviewerAuthorizer({ reviewerContext, adminUserProvider }) {
  return async ({ reviewer }) => {
    try {
      const contextUid = optionalString(reviewerContext?.uid || reviewerContext?.id);
      const contextEmail = normalizeEmail(reviewerContext?.email);
      const contextRole = String(reviewerContext?.role || '').trim().toLowerCase();
      const reviewerUid = optionalString(reviewer?.uid);
      const reviewerEmail = normalizeEmail(reviewer?.email);

      if (
        !contextUid
        || !contextEmail
        || !REVIEWER_ROLES.has(contextRole)
        || reviewerUid !== contextUid
        || reviewerEmail !== contextEmail
      ) {
        return false;
      }

      const adminRecord = await adminUserProvider(contextUid, {
        source: 'kyc-identity-review-workflow.reviewer-authorizer',
        maxAgeMs: 0
      });
      const adminData = adminRecord?.data || {};
      const persistedRole = String(adminData.role || '').trim().toLowerCase();
      const persistedEmail = normalizeEmail(adminData.email);
      return adminRecord?.exists === true
        && adminData.active === true
        && REVIEWER_ROLES.has(persistedRole)
        && persistedRole === contextRole
        && persistedEmail === contextEmail;
    } catch (_error) {
      return false;
    }
  };
}

function createCaseService({
  reviewerContext = null,
  firestoreProvider = () => firebaseConfig.getFirestore(),
  adminUserProvider = getAdminUser,
  identityTrustService = driverIdentityTrustService,
  now,
  collections,
  persistenceContext = null,
  allowExplicitSandboxAccess = false
} = {}) {
  return new KycIdentityReviewCaseService({
    firestoreProvider,
    reviewerAuthorizer: buildReviewerAuthorizer({ reviewerContext, adminUserProvider }),
    runOutsideActiveTrip: async (driverId, _action, callback) => {
      if (
        !identityTrustService
        || typeof identityTrustService.assertVerificationOutsideActiveTrip !== 'function'
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_ACTIVE_TRIP_GUARD_UNAVAILABLE',
          'O guard canonico de corrida ativa nao esta disponivel'
        );
      }
      if (typeof callback !== 'function') {
        throw domainError(
          'KYC_IDENTITY_REVIEW_CALLBACK_INVALID',
          'A operacao protegida nao foi informada'
        );
      }
      await identityTrustService.assertVerificationOutsideActiveTrip(driverId);
      return callback();
    },
    ...(now ? { now } : {}),
    ...(collections ? { collections } : {}),
    ...(persistenceContext ? {
      persistenceContext,
      allowExplicitSandboxAccess
    } : {})
  });
}

class KycIdentityReviewWorkflowService {
  constructor(options = {}) {
    this.firestoreProvider = options.firestoreProvider || (() => firebaseConfig.getFirestore());
    this.adminUserProvider = options.adminUserProvider || getAdminUser;
    this.persistenceContext = options.persistenceContext || null;
    this.persistenceScope = resolveKycPersistenceScope(this.persistenceContext || {}, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: options.allowExplicitSandboxAccess === true
    });
    if (
      this.persistenceContext
      && !options.identityTrustService
      && typeof driverIdentityTrustService.createScopedDriverIdentityTrustService !== 'function'
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_SCOPED_TRUST_SERVICE_REQUIRED',
        'O workflow scoped exige um servico de trust no mesmo contexto'
      );
    }
    if (
      this.persistenceContext
      && !options.evidenceService
      && typeof kycFailedBiometricEvidenceService.createScopedKycFailedBiometricEvidenceService
        !== 'function'
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_SCOPED_EVIDENCE_SERVICE_REQUIRED',
        'O workflow scoped exige um servico de evidencia no mesmo contexto'
      );
    }
    this.identityTrustService = options.identityTrustService || (this.persistenceContext
      ? driverIdentityTrustService.createScopedDriverIdentityTrustService(
        this.persistenceContext,
        {
          firestoreProvider: this.firestoreProvider,
          allowExplicitSandboxAccess: options.allowExplicitSandboxAccess === true,
          ...(options.identityTrustServiceOptions || {})
        }
      )
      : driverIdentityTrustService);
    this.evidenceService = options.evidenceService || (this.persistenceContext
      ? kycFailedBiometricEvidenceService.createScopedKycFailedBiometricEvidenceService(
        this.persistenceContext,
        {
          firestoreProvider: this.firestoreProvider,
          allowExplicitSandboxAccess: options.allowExplicitSandboxAccess === true,
          ...(options.evidenceServiceOptions || {})
        }
      )
      : kycFailedBiometricEvidenceService);
    this.canonicalApprovalService = options.canonicalApprovalService
      || canonicalDriverDocumentApprovalService;
    this.supportTicketService = options.supportTicketService || supportTicketService;
    const scopedCollections = this.persistenceScope.collections;
    const scopedResources = this.persistenceScope.kycResources;
    const resolveCollection = (actual, expected, resource) => assertScopedResourceName({
      scopeInput: this.persistenceScope,
      actual: actual || expected,
      expected,
      resource
    });
    this.caseServiceFactory = options.caseServiceFactory || ((factoryOptions = {}) =>
      createCaseService({
        firestoreProvider: this.firestoreProvider,
        adminUserProvider: this.adminUserProvider,
        identityTrustService: this.identityTrustService,
        persistenceContext: this.persistenceContext,
        allowExplicitSandboxAccess: options.allowExplicitSandboxAccess === true,
        collections: {
          cases: this.caseCollection,
          enforcement: this.enforcementCollection,
          retryAuthorizations: this.retryAuthorizationCollection,
          audit: this.auditCollection
        },
        ...factoryOptions
      }));
    this.caseCollection = resolveCollection(
      options.caseCollection,
      scopedCollections.kycIdentityReviewCases,
      'Colecao de casos KYC'
    );
    this.enforcementCollection = resolveCollection(
      options.enforcementCollection,
      scopedCollections.driverIdentityEnforcement,
      'Colecao de enforcement KYC'
    );
    this.retryAuthorizationCollection = resolveCollection(
      options.retryAuthorizationCollection,
      scopedCollections.kycIdentityRetryAuthorizations,
      'Colecao de autorizacoes KYC'
    );
    this.auditCollection = resolveCollection(
      options.auditCollection,
      scopedCollections.kycIdentityReviewAudit,
      'Colecao de auditoria KYC'
    );
    this.identityTrustCollection = resolveCollection(
      options.identityTrustCollection,
      scopedCollections.driverIdentityTrust,
      'Colecao de trust KYC'
    );
    this.identityTrustEvidenceCollection = resolveCollection(
      options.identityTrustEvidenceCollection,
      scopedResources.identityTrustEvidenceCollection,
      'Subcolecao de evidencia do trust KYC'
    );
    this.failedEvidenceCollection = resolveCollection(
      options.failedEvidenceCollection,
      scopedCollections.kycFailedBiometricEvidence,
      'Colecao de evidencia biometrica KYC'
    );
    this.now = options.now || (() => new Date());
    const requestedOrphanRecoveryTtlMs = Number(options.orphanRecoveryTtlMs);
    this.orphanRecoveryTtlMs = Number.isFinite(requestedOrphanRecoveryTtlMs)
      ? Math.max(
        ORPHAN_RECOVERY_MIN_TTL_MS,
        Math.min(ORPHAN_RECOVERY_MAX_TTL_MS, requestedOrphanRecoveryTtlMs)
      )
      : ORPHAN_RECOVERY_TTL_MS;
  }

  nowDate() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw domainError('KYC_IDENTITY_REVIEW_CLOCK_INVALID', 'Relogio do workflow invalido');
    }
    return date;
  }

  persistenceEnvelope(record = null) {
    return buildScopedPersistenceEnvelope(this.persistenceScope, { record });
  }

  assertRecordScope(record) {
    assertStoredRecordMatchesScope(record, this.persistenceScope);
    return record;
  }

  scopedWriteRecord(record = {}, current = null) {
    return {
      ...(record && typeof record === 'object' ? record : {}),
      ...this.persistenceEnvelope(current)
    };
  }

  recordFromSnapshot(snapshot) {
    if (!snapshot?.exists) return null;
    return this.assertRecordScope(snapshot.data() || {});
  }

  recordsFromQuerySnapshot(snapshot) {
    return (snapshot?.docs || []).map((doc) => ({
      ...this.assertRecordScope(doc.data() || {}),
      id: doc.id
    }));
  }

  firestore() {
    const firestore = this.firestoreProvider();
    if (!firestore || typeof firestore.collection !== 'function') {
      throw domainError(
        'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE',
        'Firestore indisponivel para o fluxo de revisao de identidade'
      );
    }
    return firestore;
  }

  caseService(reviewerContext = null) {
    return this.caseServiceFactory({ reviewerContext });
  }

  async runOutsideActiveTrip(driverId, callback) {
    const safeDriverId = requiredId(driverId, 'driverId');
    if (
      !this.identityTrustService
      || typeof this.identityTrustService.assertVerificationOutsideActiveTrip !== 'function'
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_ACTIVE_TRIP_GUARD_UNAVAILABLE',
        'O guard canonico de corrida ativa nao esta disponivel'
      );
    }
    if (typeof callback !== 'function') {
      throw domainError(
        'KYC_IDENTITY_REVIEW_CALLBACK_INVALID',
        'A operacao protegida nao foi informada'
      );
    }
    await this.identityTrustService.assertVerificationOutsideActiveTrip(safeDriverId);
    return callback();
  }

  async runWithVerificationWindow(driverId, scope, callback) {
    const safeDriverId = requiredId(driverId, 'driverId');
    if (
      typeof this.identityTrustService?.claimVerificationWindow !== 'function'
      || typeof this.identityTrustService?.releaseVerificationWindow !== 'function'
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_ACTIVE_TRIP_GUARD_UNAVAILABLE',
        'A exclusao atomica entre corrida e identidade nao esta disponivel'
      );
    }
    if (typeof callback !== 'function') {
      throw domainError(
        'KYC_IDENTITY_REVIEW_CALLBACK_INVALID',
        'A operacao protegida nao foi informada'
      );
    }

    const claim = await this.identityTrustService.claimVerificationWindow(safeDriverId, { scope });
    if (!claim?.acquired) {
      throw domainError(
        'KYC_VERIFICATION_IN_PROGRESS',
        'Outra validacao de identidade ja esta em andamento'
      );
    }
    try {
      return await callback(claim);
    } finally {
      await this.identityTrustService.releaseVerificationWindow(claim).catch(() => null);
    }
  }

  async assertReviewer(reviewerContext, action, caseRecord = {}) {
    const service = this.caseService(reviewerContext);
    const reviewer = reviewerFromContext(reviewerContext);
    await service.assertAuthorizedReviewer({ reviewer, action, caseRecord });
    return { service, reviewer };
  }

  async captureFailure({ driverId, referenceImageBuffer, liveness, comparison } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    await this.assertKycOperationAllowed(safeDriverId);
    const captured = await this.runOutsideActiveTrip(safeDriverId, () =>
      this.evidenceService.captureRejectedComparisonEvidence({
        driverId: safeDriverId,
        referenceImageBuffer,
        liveness,
        comparison,
        cnh: comparison?.reference
      }));
    this.assertRecordScope(captured);
    return safeEvidenceMetadata(captured);
  }

  async getOperationalTicket(ticketId) {
    const safeTicketId = requiredId(
      ticketId,
      'ticketId',
      'KYC_IDENTITY_REVIEW_TICKET_REQUIRED'
    );
    const ticket = await this.supportTicketService.getTicket(
      safeTicketId,
      this.persistenceContext
    );
    if (!ticket) {
      throw domainError('KYC_IDENTITY_REVIEW_TICKET_NOT_FOUND', 'Chamado nao encontrado');
    }
    if (!this.persistenceContext && isSandboxTicket(ticket)) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_SANDBOX_TICKET_FORBIDDEN',
        'Chamados sandbox nao podem autorizar revisao biometrica operacional'
      );
    }
    this.assertRecordScope(ticket);
    return ticket;
  }

  assertTicketBelongsToEvidence({ ticket, driverId, evidenceId }) {
    const metadata = ticket.metadata && typeof ticket.metadata === 'object'
      ? ticket.metadata
      : {};
    const metadataDriverId = optionalString(
      metadata.driverId || metadata.driver_id || metadata.targetDriverId
    );
    const metadataEvidenceId = optionalString(
      metadata.kycEvidenceId || metadata.evidenceId || metadata.kyc_evidence_id
    );
    if (
      optionalString(ticket.userId) !== driverId
      || metadataDriverId !== driverId
      || metadataEvidenceId !== evidenceId
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_TICKET_BINDING_INVALID',
        'O chamado nao pertence ao motorista e a evidencia informados'
      );
    }
  }

  assertEvidenceBelongsToDriver(metadata, driverId) {
    if (optionalString(metadata?.driverId) !== driverId) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_EVIDENCE_DRIVER_MISMATCH',
        'A evidencia nao pertence ao motorista informado'
      );
    }
  }

  assertCanonicalCnhBinding(evidence, canonicalCnh) {
    if (
      optionalString(evidence?.cnhSubmissionId) !== optionalString(canonicalCnh?.submissionId)
      || String(evidence?.cnhDocumentSha256 || '').trim().toLowerCase()
        !== String(canonicalCnh?.documentSha256 || '').trim().toLowerCase()
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_CNH_BINDING_MISMATCH',
        'A CNH aprovada atual nao corresponde a CNH usada na comparacao facial'
      );
    }
  }

  buildEvidenceBinding(evidence, canonicalCnh) {
    return {
      evidenceId: evidence.evidenceId,
      livenessSessionHash: evidence.livenessSessionSha256,
      referenceSelfie: {
        storagePath: evidence.objectPath,
        sha256: evidence.referenceImageSha256,
        generation: String(evidence.storageGeneration || ''),
        expiresAt: toIso(evidence.expiresAt)
      },
      approvedCnh: {
        documentId: canonicalCnh.submissionId,
        storagePath: canonicalCnh.filePath,
        sha256: canonicalCnh.documentSha256,
        approvalRevision: optionalString(
          canonicalCnh.approvalRevision || canonicalCnh.reviewedAt || canonicalCnh.storageGeneration
        )
      },
      faceCompare: {
        provider: evidence.compareProvider,
        decision: evidence.decision,
        similarityScore: Number(evidence.similarityScore),
        threshold: Number(evidence.threshold),
        comparedAt: toIso(evidence.createdAt)
      }
    };
  }

  async openCaseFromTicket({
    driverId,
    evidenceId,
    ticketId,
    requestedBy,
    reconciledBy = null
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeEvidenceId = requiredId(
      evidenceId,
      'evidenceId',
      'KYC_IDENTITY_REVIEW_EVIDENCE_REQUIRED'
    );
    const safeTicketId = requiredId(
      ticketId,
      'ticketId',
      'KYC_IDENTITY_REVIEW_TICKET_REQUIRED'
    );
    let linkActor;
    if (reconciledBy) {
      const { reviewer } = await this.assertReviewer(
        reconciledBy,
        'RECONCILE_IDENTITY_REVIEW_CASE',
        { driverId: safeDriverId, ticketId: safeTicketId, evidenceId: safeEvidenceId }
      );
      linkActor = {
        uid: reviewer.uid,
        email: reviewer.email,
        type: 'admin_reconciliation'
      };
    } else {
      const requesterId = requiredId(
        requestedBy?.uid || requestedBy?.id,
        'requestedBy.uid',
        'KYC_IDENTITY_REVIEW_REQUESTER_INVALID'
      );
      if (requesterId !== safeDriverId) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_REQUESTER_INVALID',
          'Somente o proprio motorista pode abrir a revisao a partir do chamado'
        );
      }
      linkActor = {
        uid: requesterId,
        email: normalizeEmail(requestedBy?.email),
        type: optionalString(requestedBy?.type) || 'driver'
      };
    }

    await this.assertKycOperationAllowed(safeDriverId);
    const [ticket, evidence, canonicalCnh] = await Promise.all([
      this.getOperationalTicket(safeTicketId),
      this.evidenceService.getMetadata(safeEvidenceId),
      this.canonicalApprovalService.requireApprovedCnh(safeDriverId)
    ]);
    this.assertTicketBelongsToEvidence({
      ticket,
      driverId: safeDriverId,
      evidenceId: safeEvidenceId
    });
    this.assertRecordScope(evidence);
    this.assertEvidenceBelongsToDriver(evidence, safeDriverId);
    this.assertCanonicalCnhBinding(evidence, canonicalCnh);
    if (evidence.ticketId && evidence.ticketId !== safeTicketId) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_EVIDENCE_TICKET_CONFLICT',
        'A evidencia ja esta vinculada a outro chamado'
      );
    }

    const service = this.caseService();
    const expectedCaseId = service.caseIdFor(safeDriverId, safeEvidenceId);
    const metadataCaseId = optionalString(ticket.metadata?.kycReviewCaseId);
    if (metadataCaseId && metadataCaseId !== expectedCaseId) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_CASE_BINDING_INVALID',
        'O chamado aponta para outro caso de revisao'
      );
    }
    const created = await service.createOrLinkCase({
      driverId: safeDriverId,
      ticketId: safeTicketId,
      evidenceBinding: this.buildEvidenceBinding(evidence, canonicalCnh),
      requestedBy: {
        uid: linkActor.uid,
        email: linkActor.email,
        type: linkActor.type
      }
    });
    const reviewCase = created?.case || {};
    this.assertRecordScope(reviewCase);
    if (optionalString(reviewCase.driverId) !== safeDriverId || !reviewCase.caseId) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_CASE_BINDING_INVALID',
        'O caso criado nao preservou o vinculo do motorista'
      );
    }
    if (reviewCase.caseId !== expectedCaseId) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_CASE_BINDING_INVALID',
        'O caso criado divergiu do identificador canonico esperado'
      );
    }

    await this.evidenceService.linkTicket(safeEvidenceId, {
      ticketId: safeTicketId,
      caseId: reviewCase.caseId,
      actorId: linkActor.uid
    });

    return {
      case: safeCaseMetadata(reviewCase),
      ticket: safeTicketMetadata(ticket),
      evidence: safeEvidenceMetadata({
        ...evidence,
        ticketId: safeTicketId,
        caseId: reviewCase.caseId
      }),
      idempotentReplay: created.idempotentReplay === true,
      ticketLinked: created.ticketLinked === true
    };
  }

  async listCaseRecordsForDriver(driverId) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const snapshot = await this.firestore()
      .collection(this.caseCollection)
      .where('driverId', '==', safeDriverId)
      .get();
    const records = this.recordsFromQuerySnapshot(snapshot).map((record) => ({
      ...record,
      caseId: record.id
    }));
    return records.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
      const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
      return rightTime - leftTime;
    });
  }

  async listCasesForDriver(driverId, { reviewerContext } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    await this.assertReviewer(reviewerContext, 'LIST_IDENTITY_REVIEW_CASES', {
      driverId: safeDriverId
    });
    const records = await this.listCaseRecordsForDriver(safeDriverId);
    return records.map(safeCaseMetadata);
  }

  async getCaseRecordForDriver(driverId, caseId) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeCaseId = requiredId(caseId, 'caseId');
    const service = this.caseService();
    const record = await service.getCase(safeCaseId);
    if (!record || optionalString(record.driverId) !== safeDriverId) {
      throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
    }
    return this.assertRecordScope(record);
  }

  async getCaseForDriver(driverId, caseId, { reviewerContext } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeCaseId = requiredId(caseId, 'caseId');
    await this.assertReviewer(reviewerContext, 'GET_IDENTITY_REVIEW_CASE', {
      driverId: safeDriverId,
      caseId: safeCaseId
    });
    const record = await this.getCaseRecordForDriver(safeDriverId, safeCaseId);
    return safeCaseMetadata(record);
  }

  async getEnforcement(driverId) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const snapshot = await this.firestore()
      .collection(this.enforcementCollection)
      .doc(safeDriverId)
      .get();
    return this.recordFromSnapshot(snapshot);
  }

  async getOrphanHoldRecoveryCandidate(driverId, { reviewerContext } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    await this.assertReviewer(
      reviewerContext,
      'VIEW_ORPHAN_IDENTITY_HOLD_RECOVERY',
      { driverId: safeDriverId }
    );

    if (typeof this.identityTrustService?.readState !== 'function') {
      throw domainError(
        'KYC_ORPHAN_HOLD_RECOVERY_TRUST_UNAVAILABLE',
        'Estado canonico de identidade indisponivel para recuperacao'
      );
    }

    const trust = await this.identityTrustService.readState(
      safeDriverId,
      { bypassCache: true }
    );
    if (trust) this.assertRecordScope(trust);

    const stateRevision = Number(trust?.stateRevision || 0);
    const revokedAt = optionalString(trust?.revokedAt);
    if (
      String(trust?.status || '').trim().toLowerCase() !== 'revoked'
      || String(trust?.revocationReason || '').trim().toLowerCase()
        !== 'canonical_face_compare_failed'
      || !Number.isSafeInteger(stateRevision)
      || stateRevision <= 0
      || !revokedAt
      || !sameIso(trust?.lastFailure?.recordedAt, revokedAt)
    ) {
      return null;
    }

    const firestore = this.firestore();
    const evidenceQuery = this.identityTrustStateRef(safeDriverId)
      .collection(this.identityTrustEvidenceCollection)
      .where('recordedAt', '==', revokedAt)
      .limit(2);
    const caseQuery = firestore
      .collection(this.caseCollection)
      .where('driverId', '==', safeDriverId)
      .limit(1);
    const failedEvidenceQuery = firestore
      .collection(this.failedEvidenceCollection)
      .where('driverId', '==', safeDriverId)
      .limit(1);

    const [evidenceSnapshot, caseSnapshot, failedEvidenceSnapshot, enforcement] =
      await Promise.all([
        evidenceQuery.get(),
        caseQuery.get(),
        failedEvidenceQuery.get(),
        this.getEnforcement(safeDriverId)
      ]);
    const evidenceRecords = this.recordsFromQuerySnapshot(evidenceSnapshot)
      .filter((record) => (
        optionalString(record.driverId) === safeDriverId
        && String(record.terminalOutcome || '').trim().toLowerCase()
          === 'face_compare_failed'
        && sameIso(record.recordedAt, revokedAt)
      ));
    const cases = this.recordsFromQuerySnapshot(caseSnapshot);
    const failedEvidence = this.recordsFromQuerySnapshot(failedEvidenceSnapshot);

    if (enforcement || cases.length > 0 || failedEvidence.length > 0 || evidenceRecords.length !== 1) {
      return null;
    }

    const failureEvidenceId = requiredId(
      evidenceRecords[0].evidenceId || evidenceRecords[0].id,
      'failureEvidenceId',
      'KYC_ORPHAN_HOLD_RECOVERY_FAILURE_EVIDENCE_NOT_FOUND'
    );
    return {
      available: true,
      status: 'ready',
      failureEvidenceId,
      expectedStateRevision: stateRevision,
      expectedRevokedAt: toIso(revokedAt)
    };
  }

  orphanRecoveryIdFor(driverId, failureEvidenceId, stateRevision) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeFailureEvidenceId = requiredId(failureEvidenceId, 'failureEvidenceId');
    const safeStateRevision = positiveInteger(stateRevision, 'expectedStateRevision');
    return `kyc_or_${crypto
      .createHash('sha256')
      .update(`${safeDriverId}:${safeStateRevision}:${safeFailureEvidenceId}`)
      .digest('hex')
      .slice(0, 32)}`;
  }

  identityTrustStateRef(driverId) {
    return this.firestore()
      .collection(this.identityTrustCollection)
      .doc(requiredId(driverId, 'driverId'));
  }

  identityTrustEvidenceRef(driverId, evidenceId) {
    const stateRef = this.identityTrustStateRef(driverId);
    if (typeof stateRef.collection !== 'function') {
      throw domainError(
        'KYC_TRUST_STORE_UNAVAILABLE',
        'Firestore nao suporta a evidencia canonica vinculada ao trust'
      );
    }
    return stateRef
      .collection(this.identityTrustEvidenceCollection)
      .doc(requiredId(evidenceId, 'failureEvidenceId'));
  }

  async authorizeOrphanHoldRecovery({
    driverId,
    failureEvidenceId,
    expectedStateRevision,
    expectedRevokedAt,
    reviewerContext,
    reason
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeFailureEvidenceId = requiredId(failureEvidenceId, 'failureEvidenceId');
    const safeStateRevision = positiveInteger(expectedStateRevision, 'expectedStateRevision');
    const safeExpectedRevokedAt = toIso(expectedRevokedAt);
    const safeReason = requiredReason(reason);
    const recoveryId = this.orphanRecoveryIdFor(
      safeDriverId,
      safeFailureEvidenceId,
      safeStateRevision
    );
    const { reviewer } = await this.assertReviewer(
      reviewerContext,
      'AUTHORIZE_ORPHAN_IDENTITY_HOLD_RECOVERY',
      {
        driverId: safeDriverId,
        recoveryId,
        failureEvidenceId: safeFailureEvidenceId
      }
    );

    return this.runWithVerificationWindow(
      safeDriverId,
      'orphan_hold_recovery_authorization',
      async () => {
        const canonicalCnh = await this.canonicalApprovalService.requireApprovedCnh(safeDriverId);
        const cnhSubmissionId = requiredId(
          canonicalCnh?.submissionId,
          'canonicalCnh.submissionId',
          'KYC_ORPHAN_HOLD_RECOVERY_CNH_BINDING_INVALID'
        );
        const cnhDocumentSha256 = String(canonicalCnh?.documentSha256 || '')
          .trim()
          .toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(cnhDocumentSha256)) {
          throw domainError(
            'KYC_ORPHAN_HOLD_RECOVERY_CNH_BINDING_INVALID',
            'A CNH canonica aprovada nao possui binding integro'
          );
        }
        const firestore = this.firestore();
        const trustRef = this.identityTrustStateRef(safeDriverId);
        const failureRef = this.identityTrustEvidenceRef(
          safeDriverId,
          safeFailureEvidenceId
        );
        const enforcementRef = firestore
          .collection(this.enforcementCollection)
          .doc(safeDriverId);
        const authorizationRef = this.retryAuthorizationRef(recoveryId);
        const caseQuery = firestore
          .collection(this.caseCollection)
          .where('driverId', '==', safeDriverId)
          .limit(1);
        const failedEvidenceQuery = firestore
          .collection(this.failedEvidenceCollection)
          .where('driverId', '==', safeDriverId)
          .limit(1);
        const now = this.nowDate();
        const nowIso = now.toISOString();

        const result = await firestore.runTransaction(async (transaction) => {
          const [
            trustSnapshot,
            failureSnapshot,
            enforcementSnapshot,
            authorizationSnapshot,
            caseSnapshot,
            failedEvidenceSnapshot
          ] = await Promise.all([
            transaction.get(trustRef),
            transaction.get(failureRef),
            transaction.get(enforcementRef),
            transaction.get(authorizationRef),
            transaction.get(caseQuery),
            transaction.get(failedEvidenceQuery)
          ]);

          const trust = this.recordFromSnapshot(trustSnapshot);
          const failureEvidence = this.recordFromSnapshot(failureSnapshot);
          const enforcement = this.recordFromSnapshot(enforcementSnapshot);
          const existingAuthorization = this.recordFromSnapshot(authorizationSnapshot);
          const existingCases = this.recordsFromQuerySnapshot(caseSnapshot);
          const existingFailedEvidence = this.recordsFromQuerySnapshot(failedEvidenceSnapshot);

          if (!trust) {
            throw domainError(
              'KYC_ORPHAN_HOLD_RECOVERY_TRUST_NOT_FOUND',
              'Estado canonico de identidade nao encontrado'
            );
          }
          if (
            String(trust.status || '').trim().toLowerCase() !== 'revoked'
            || String(trust.revocationReason || '').trim().toLowerCase()
              !== 'canonical_face_compare_failed'
            || Number(trust.stateRevision || 0) !== safeStateRevision
            || !sameIso(trust.revokedAt, safeExpectedRevokedAt)
            || !sameIso(trust.lastFailure?.recordedAt, safeExpectedRevokedAt)
          ) {
            throw domainError(
              'KYC_ORPHAN_HOLD_RECOVERY_TRUST_CONFLICT',
              'O hold canonico mudou ou nao e elegivel para recuperacao orfa'
            );
          }

          if (!failureEvidence) {
            throw domainError(
              'KYC_ORPHAN_HOLD_RECOVERY_FAILURE_EVIDENCE_NOT_FOUND',
              'Evidencia canonica da falha nao encontrada'
            );
          }
          if (
            optionalString(failureEvidence.driverId) !== safeDriverId
            || optionalString(failureEvidence.evidenceId) !== safeFailureEvidenceId
            || String(failureEvidence.terminalOutcome || '').trim().toLowerCase()
              !== 'face_compare_failed'
            || !sameIso(failureEvidence.recordedAt, safeExpectedRevokedAt)
          ) {
            throw domainError(
              'KYC_ORPHAN_HOLD_RECOVERY_FAILURE_EVIDENCE_CONFLICT',
              'A evidencia canonica nao corresponde ao hold atual'
            );
          }

          if (existingCases.length > 0) {
            throw domainError(
              'KYC_ORPHAN_HOLD_RECOVERY_CASE_EXISTS',
              'Ja existe caso de revisao; use o fluxo canonico de analise'
            );
          }
          if (existingFailedEvidence.length > 0) {
            throw domainError(
              'KYC_ORPHAN_HOLD_RECOVERY_PRIVATE_EVIDENCE_EXISTS',
              'Ja existe evidencia privada; use o fluxo canonico de analise'
            );
          }

          this.assertNotPermanentlyBlocked(enforcement);

          if (existingAuthorization) {
            const sameBinding = existingAuthorization.purpose === ORPHAN_RECOVERY_PURPOSE
              && optionalString(existingAuthorization.driverId) === safeDriverId
              && optionalString(existingAuthorization.recoveryId) === recoveryId
              && optionalString(existingAuthorization.sourceTrust?.failureEvidenceId)
                === safeFailureEvidenceId
              && Number(existingAuthorization.sourceTrust?.stateRevision || 0)
                === safeStateRevision
              && sameIso(existingAuthorization.sourceTrust?.revokedAt, safeExpectedRevokedAt)
              && optionalString(existingAuthorization.sourceCnh?.submissionId) === cnhSubmissionId
              && String(existingAuthorization.sourceCnh?.documentSha256 || '').toLowerCase()
                === cnhDocumentSha256;
            const ownEnforcement = enforcement?.permanent !== true
              && optionalString(enforcement?.recoveryId) === recoveryId
              && [
                ORPHAN_RECOVERY_ENFORCEMENT_STATUS,
                ORPHAN_HOLD_ENFORCEMENT_STATUS,
                'RESOLVED_BY_CANONICAL_MATCH',
                'IDENTITY_MISMATCH_HOLD'
              ].includes(String(enforcement.status || '').trim().toUpperCase());
            if (!sameBinding || !ownEnforcement) {
              throw domainError(
                'KYC_ORPHAN_HOLD_RECOVERY_IDEMPOTENCY_CONFLICT',
                'A recuperacao existente possui binding divergente'
              );
            }
            return {
              authorization: existingAuthorization,
              enforcement,
              idempotentReplay: true
            };
          }

          if (enforcementSnapshot.exists) {
            throw domainError(
              'KYC_ORPHAN_HOLD_RECOVERY_ENFORCEMENT_EXISTS',
              'Ja existe enforcement de identidade para este motorista'
            );
          }

          const failureEvidenceBindingHash = crypto
            .createHash('sha256')
            .update(JSON.stringify({
              driverId: safeDriverId,
              evidenceId: safeFailureEvidenceId,
              terminalOutcome: failureEvidence.terminalOutcome,
              recordedAt: toIso(failureEvidence.recordedAt),
              referenceImageSha256: optionalString(failureEvidence.referenceImageSha256)
            }))
            .digest('hex');
          const authorization = this.scopedWriteRecord({
            schemaVersion: 1,
            authorizationId: recoveryId,
            recoveryId,
            caseId: null,
            driverId: safeDriverId,
            purpose: ORPHAN_RECOVERY_PURPOSE,
            status: 'AVAILABLE',
            allowedAttempts: 1,
            remainingAttempts: 1,
            sourceTrust: {
              stateRevision: safeStateRevision,
              revokedAt: safeExpectedRevokedAt,
              revocationReason: 'canonical_face_compare_failed',
              failureEvidenceId: safeFailureEvidenceId,
              failureEvidenceBindingHash
            },
            sourceCnh: {
              submissionId: cnhSubmissionId,
              documentSha256: cnhDocumentSha256
            },
            authorizedBy: reviewer,
            authorizationReason: safeReason,
            authorizedAt: nowIso,
            expiresAt: new Date(now.getTime() + this.orphanRecoveryTtlMs).toISOString(),
            claimedAt: null,
            consumedAt: null,
            terminalAt: null,
            identityApproved: false
          });
          const nextEnforcement = this.scopedWriteRecord({
            schemaVersion: 1,
            driverId: safeDriverId,
            status: ORPHAN_RECOVERY_ENFORCEMENT_STATUS,
            active: true,
            permanent: false,
            reasonCode: 'ORPHAN_CANONICAL_FACE_COMPARE_HOLD',
            recoveryId,
            sourceFailureEvidenceId: safeFailureEvidenceId,
            retryAllowed: true,
            retryAttempts: 1,
            identityApproved: false,
            authorizedBy: reviewer,
            authorizedAt: nowIso,
            expiresAt: authorization.expiresAt,
            updatedAt: nowIso
          });
          const auditRef = firestore
            .collection(this.auditCollection)
            .doc(`${recoveryId}_000001_orphan_hold_recovery_authorized`);
          transaction.set(authorizationRef, authorization, { merge: false });
          transaction.set(enforcementRef, nextEnforcement, { merge: false });
          transaction.set(auditRef, this.scopedWriteRecord({
            schemaVersion: 1,
            recoveryId,
            driverId: safeDriverId,
            action: 'ORPHAN_HOLD_RECOVERY_AUTHORIZED',
            actor: reviewer,
            reason: safeReason,
            sourceFailureEvidenceId: safeFailureEvidenceId,
            sourceStateRevision: safeStateRevision,
            occurredAt: nowIso,
            immutable: true
          }), { merge: false });
          return {
            authorization,
            enforcement: nextEnforcement,
            idempotentReplay: false
          };
        });

        return {
          recoveryId,
          attemptScope: `${ORPHAN_HOLD_RETRY_SCOPE_PREFIX}${recoveryId}`,
          authorization: safeRetryAuthorizationMetadata(result.authorization),
          enforcementStatus: result.enforcement?.status || null,
          idempotentReplay: result.idempotentReplay === true
        };
      }
    );
  }

  async abortOrphanHoldRecoverySetup({ driverId, recoveryId, reason } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeRecoveryId = requiredId(recoveryId, 'recoveryId');
    if (!ORPHAN_RECOVERY_ID_PATTERN.test(safeRecoveryId)) {
      throw domainError(
        'KYC_ORPHAN_HOLD_RECOVERY_ID_INVALID',
        'Identificador da recuperacao orfa invalido'
      );
    }
    const safeReason = requiredReason(reason);
    const firestore = this.firestore();
    const authorizationRef = this.retryAuthorizationRef(safeRecoveryId);
    const enforcementRef = firestore
      .collection(this.enforcementCollection)
      .doc(safeDriverId);
    const abortedAt = this.nowDate().toISOString();

    return firestore.runTransaction(async (transaction) => {
      const [authorizationSnapshot, enforcementSnapshot] = await Promise.all([
        transaction.get(authorizationRef),
        transaction.get(enforcementRef)
      ]);
      const authorization = this.recordFromSnapshot(authorizationSnapshot);
      const enforcement = this.recordFromSnapshot(enforcementSnapshot);
      if (!authorization || !enforcement) {
        throw domainError(
          'KYC_ORPHAN_HOLD_RECOVERY_NOT_FOUND',
          'Recuperacao orfa nao encontrada para compensacao'
        );
      }
      this.assertNotPermanentlyBlocked(enforcement);
      if (
        authorization.purpose !== ORPHAN_RECOVERY_PURPOSE
        || optionalString(authorization.driverId) !== safeDriverId
        || optionalString(authorization.recoveryId) !== safeRecoveryId
        || optionalString(enforcement.recoveryId) !== safeRecoveryId
      ) {
        throw domainError(
          'KYC_ORPHAN_HOLD_RECOVERY_BINDING_INVALID',
          'A recuperacao orfa nao corresponde ao motorista informado'
        );
      }
      if (authorization.status === 'ABORTED_SETUP') {
        if (authorization.terminalReason !== safeReason) {
          throw domainError(
            'KYC_ORPHAN_HOLD_RECOVERY_ABORT_REASON_CONFLICT',
            'A compensacao existente possui outra justificativa'
          );
        }
        return {
          authorization: safeRetryAuthorizationMetadata(authorization),
          enforcement,
          idempotentReplay: true
        };
      }
      if (
        authorization.status !== 'AVAILABLE'
        || Number(authorization.remainingAttempts) !== 1
        || authorization.claimedAt
        || authorization.consumedAt
        || authorization.claimTokenHash
      ) {
        throw domainError(
          'KYC_ORPHAN_HOLD_RECOVERY_ALREADY_DISPATCHED',
          'A recuperacao ja foi reclamada ou consumida e nao pode ser compensada'
        );
      }
      if (
        enforcement.active !== true
        || String(enforcement.status || '').trim().toUpperCase()
          !== ORPHAN_RECOVERY_ENFORCEMENT_STATUS
      ) {
        throw domainError(
          'KYC_ORPHAN_HOLD_RECOVERY_ENFORCEMENT_INVALID',
          'O enforcement nao esta no estado autorizado para compensacao'
        );
      }

      const terminalAuthorization = this.scopedWriteRecord({
        ...authorization,
        status: 'ABORTED_SETUP',
        remainingAttempts: 0,
        terminalAt: abortedAt,
        terminalReason: safeReason,
        identityApproved: false,
        updatedAt: abortedAt
      }, authorization);
      const holdEnforcement = this.scopedWriteRecord({
        ...enforcement,
        active: true,
        permanent: false,
        status: ORPHAN_HOLD_ENFORCEMENT_STATUS,
        reasonCode: 'ORPHAN_RECOVERY_SETUP_FAILED',
        retryAllowed: false,
        retryAttempts: 0,
        identityApproved: false,
        updatedAt: abortedAt
      }, enforcement);
      const auditRef = firestore
        .collection(this.auditCollection)
        .doc(`${safeRecoveryId}_setup_aborted`);
      transaction.set(authorizationRef, terminalAuthorization, { merge: false });
      transaction.set(enforcementRef, holdEnforcement, { merge: false });
      transaction.set(auditRef, this.scopedWriteRecord({
        schemaVersion: 1,
        recoveryId: safeRecoveryId,
        driverId: safeDriverId,
        action: 'ORPHAN_HOLD_RECOVERY_SETUP_ABORTED',
        actor: { uid: 'system:kyc-recovery-setup', type: 'system' },
        reason: safeReason,
        occurredAt: abortedAt,
        immutable: true
      }), { merge: false });
      return {
        authorization: safeRetryAuthorizationMetadata(terminalAuthorization),
        enforcement: holdEnforcement,
        idempotentReplay: false
      };
    });
  }

  retryAuthorizationRef(caseId) {
    return this.firestore()
      .collection(this.retryAuthorizationCollection)
      .doc(requiredId(caseId, 'caseId'));
  }

  caseIdFromManualReviewScope(attemptScope) {
    const normalized = String(attemptScope || '').trim().toLowerCase();
    if (!normalized.startsWith(MANUAL_REVIEW_RETRY_SCOPE_PREFIX)) return null;
    const caseId = normalized.slice(MANUAL_REVIEW_RETRY_SCOPE_PREFIX.length);
    if (!MANUAL_REVIEW_CASE_ID_PATTERN.test(caseId)) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_RETRY_SCOPE_INVALID',
        'A autorizacao de nova tentativa nao corresponde a um caso valido'
      );
    }
    return caseId;
  }

  recoveryIdFromOrphanHoldScope(attemptScope) {
    const normalized = String(attemptScope || '').trim().toLowerCase();
    if (!normalized.startsWith(ORPHAN_HOLD_RETRY_SCOPE_PREFIX)) return null;
    const recoveryId = normalized.slice(ORPHAN_HOLD_RETRY_SCOPE_PREFIX.length);
    if (!ORPHAN_RECOVERY_ID_PATTERN.test(recoveryId)) {
      throw domainError(
        'KYC_ORPHAN_HOLD_RECOVERY_SCOPE_INVALID',
        'A autorizacao de recuperacao orfa nao e valida'
      );
    }
    return recoveryId;
  }

  retryAuthorizationBindingFromScope(attemptScope) {
    const normalized = String(attemptScope || '').trim().toLowerCase();
    const caseId = this.caseIdFromManualReviewScope(normalized);
    if (caseId) {
      return {
        authorizationId: caseId,
        caseId,
        recoveryId: null,
        purpose: MANUAL_REVIEW_RETRY_PURPOSE,
        enforcementStatus: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
        attemptScope: normalized,
        kind: 'manual_review'
      };
    }
    const recoveryId = this.recoveryIdFromOrphanHoldScope(normalized);
    if (recoveryId) {
      return {
        authorizationId: recoveryId,
        caseId: null,
        recoveryId,
        purpose: ORPHAN_RECOVERY_PURPOSE,
        enforcementStatus: ORPHAN_RECOVERY_ENFORCEMENT_STATUS,
        attemptScope: normalized,
        kind: 'orphan_hold'
      };
    }
    return null;
  }

  isRetryAuthorizationAvailable(authorization, {
    driverId,
    caseId = null,
    recoveryId = null,
    authorizationId = caseId || recoveryId,
    purpose = caseId ? MANUAL_REVIEW_RETRY_PURPOSE : ORPHAN_RECOVERY_PURPOSE
  } = {}) {
    const expiresAtMs = Date.parse(authorization?.expiresAt || '');
    return authorization?.status === 'AVAILABLE'
      && authorization?.purpose === purpose
      && optionalString(authorization?.driverId) === driverId
      && optionalString(authorization?.authorizationId || authorization?.caseId)
        === authorizationId
      && (caseId == null || optionalString(authorization?.caseId) === caseId)
      && (recoveryId == null || optionalString(authorization?.recoveryId) === recoveryId)
      && Number(authorization?.allowedAttempts) === 1
      && Number(authorization?.remainingAttempts) === 1
      && Number.isFinite(expiresAtMs)
      && expiresAtMs > this.nowDate().getTime()
      && authorization?.identityApproved !== true;
  }

  isRetryAuthorizationSessionBound(authorization, {
    driverId,
    authorizationId,
    purpose,
    sessionId
  } = {}) {
    const safeSessionId = optionalString(sessionId);
    if (!safeSessionId) return false;
    const expiresAtMs = Date.parse(authorization?.expiresAt || '');
    return authorization?.status === 'CONSUMED'
      && authorization?.purpose === purpose
      && optionalString(authorization?.driverId) === driverId
      && optionalString(authorization?.authorizationId || authorization?.caseId)
        === authorizationId
      && Number(authorization?.allowedAttempts) === 1
      && Number(authorization?.remainingAttempts) === 0
      && Number.isFinite(expiresAtMs)
      && expiresAtMs > this.nowDate().getTime()
      && authorization?.identityApproved !== true
      && optionalString(authorization?.consumedSessionIdHash) === sha256(safeSessionId);
  }

  isRetryAuthorizationResumeCandidate(authorization, {
    driverId,
    caseId = null,
    recoveryId = null,
    authorizationId = caseId || recoveryId,
    purpose = caseId ? MANUAL_REVIEW_RETRY_PURPOSE : ORPHAN_RECOVERY_PURPOSE
  } = {}) {
    const status = String(authorization?.status || '').trim().toUpperCase();
    const expiresAtMs = Date.parse(authorization?.expiresAt || '');
    const hasStatusBinding = (
      status === 'CLAIMED'
        ? /^[a-f0-9]{64}$/.test(optionalString(authorization?.claimTokenHash) || '')
        : (
          status === 'CONSUMED'
          && /^[a-f0-9]{64}$/.test(
            optionalString(authorization?.consumedSessionIdHash) || ''
          )
        )
    );
    return hasStatusBinding
      && authorization?.purpose === purpose
      && optionalString(authorization?.driverId) === driverId
      && optionalString(authorization?.authorizationId || authorization?.caseId)
        === authorizationId
      && (caseId == null || optionalString(authorization?.caseId) === caseId)
      && (recoveryId == null || optionalString(authorization?.recoveryId) === recoveryId)
      && Number(authorization?.allowedAttempts) === 1
      && Number(authorization?.remainingAttempts) === 0
      && Number.isFinite(expiresAtMs)
      && expiresAtMs > this.nowDate().getTime()
      && authorization?.identityApproved !== true;
  }

  async getRetryAuthorization(caseId) {
    if (!caseId) return null;
    const snapshot = await this.retryAuthorizationRef(caseId).get();
    return this.recordFromSnapshot(snapshot);
  }

  assertNotPermanentlyBlocked(enforcement) {
    const status = String(enforcement?.status || '').trim().toUpperCase();
    if (
      enforcement?.active === true
      && (enforcement?.permanent === true || status === 'PERMANENTLY_BLOCKED')
    ) {
      throw domainError(
        'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK',
        'A identidade deste motorista possui bloqueio permanente confirmado',
        {
          caseId: optionalString(enforcement.latestCaseId || enforcement.primaryCaseId),
          ticketId: optionalString(enforcement.ticketId)
        }
      );
    }
  }

  async assertKycOperationAllowed(driverId, {
    attemptScope = null,
    awsSessionId = null
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const [enforcement, cases, trustState] = await Promise.all([
      this.getEnforcement(safeDriverId),
      this.listCaseRecordsForDriver(safeDriverId),
      typeof this.identityTrustService.readState === 'function'
        ? this.identityTrustService.readState(safeDriverId, { bypassCache: true })
        : Promise.resolve(null)
    ]);
    if (trustState) this.assertRecordScope(trustState);
    this.assertNotPermanentlyBlocked(enforcement);
    const holdCase = cases.find((record) => OPEN_CASE_STATUSES.has(record.status)) || null;
    const enforcementStatus = String(enforcement?.status || '').trim().toUpperCase();
    const retryBinding = enforcementStatus === 'FALSE_POSITIVE_RETRY_AUTHORIZED'
      ? {
        authorizationId: optionalString(enforcement?.caseId),
        caseId: optionalString(enforcement?.caseId),
        recoveryId: null,
        purpose: MANUAL_REVIEW_RETRY_PURPOSE,
        enforcementStatus: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
        kind: 'manual_review'
      }
      : (enforcementStatus === ORPHAN_RECOVERY_ENFORCEMENT_STATUS
        ? {
          authorizationId: optionalString(enforcement?.recoveryId),
          caseId: null,
          recoveryId: optionalString(enforcement?.recoveryId),
          purpose: ORPHAN_RECOVERY_PURPOSE,
          enforcementStatus: ORPHAN_RECOVERY_ENFORCEMENT_STATUS,
          kind: 'orphan_hold'
        }
        : null);
    const retryAuthorization = retryBinding?.authorizationId
      ? await this.getRetryAuthorization(retryBinding.authorizationId)
      : null;
    const enforcementHold = enforcement?.active === true &&
      ['IDENTITY_MISMATCH_HOLD', ORPHAN_HOLD_ENFORCEMENT_STATUS]
        .includes(enforcementStatus);
    const falsePositiveRetryState = enforcement?.active === true &&
      enforcementStatus === 'FALSE_POSITIVE_RETRY_AUTHORIZED';
    const orphanRecoveryState = enforcement?.active === true &&
      enforcementStatus === ORPHAN_RECOVERY_ENFORCEMENT_STATUS;
    const cleanRetryAuthorized = Boolean(retryBinding) &&
      this.isRetryAuthorizationAvailable(retryAuthorization, {
        driverId: safeDriverId,
        caseId: retryBinding.caseId,
        recoveryId: retryBinding.recoveryId,
        authorizationId: retryBinding.authorizationId,
        purpose: retryBinding.purpose
      });
    const retrySessionResumeCandidate = Boolean(
      retryBinding
      && !holdCase
      && enforcement?.active === true
      && this.isRetryAuthorizationResumeCandidate(retryAuthorization, {
        driverId: safeDriverId,
        caseId: retryBinding.caseId,
        recoveryId: retryBinding.recoveryId,
        authorizationId: retryBinding.authorizationId,
        purpose: retryBinding.purpose
      })
    );
    const requestBinding = attemptScope
      ? this.retryAuthorizationBindingFromScope(attemptScope)
      : null;
    const sessionBoundRetryAuthorized = Boolean(
      retryBinding
      && requestBinding
      && requestBinding.authorizationId === retryBinding.authorizationId
      && requestBinding.purpose === retryBinding.purpose
      && this.isRetryAuthorizationSessionBound(retryAuthorization, {
        driverId: safeDriverId,
        authorizationId: retryBinding.authorizationId,
        purpose: retryBinding.purpose,
        sessionId: awsSessionId
      })
    );
    const executionBindingProvided = Boolean(attemptScope || awsSessionId);
    const retryAuthorized = executionBindingProvided
      ? sessionBoundRetryAuthorized
      : cleanRetryAuthorized;
    const trustMismatchHold = String(trustState?.status || '').trim().toLowerCase() === 'revoked' &&
      ['canonical_face_compare_failed', 'identity_reverification_failed']
        .includes(String(trustState?.revocationReason || '').trim().toLowerCase());
    const identityReviewHold = Boolean(
      holdCase
      || enforcementHold
      || (trustMismatchHold && !retryAuthorized)
      || ((falsePositiveRetryState || orphanRecoveryState) && !retryAuthorized)
    );
    return {
      allowed: true,
      driverId: safeDriverId,
      permanentBlock: false,
      identityReviewHold,
      cnhReplacementHold:
        identityReviewHold || falsePositiveRetryState || orphanRecoveryState,
      cleanRetryAuthorized,
      retrySessionResumeCandidate,
      sessionBoundRetryAuthorized,
      executionBindingProvided,
      retryAuthorizationId: retryBinding?.authorizationId || null,
      retryAuthorizationKind: retryBinding?.kind || null,
      holdCaseId: holdCase?.caseId || enforcement?.caseId || null,
      holdRecoveryId: enforcement?.recoveryId || null,
      holdTicketId: holdCase?.ticketId || enforcement?.ticketId || null,
      holdStatus: holdCase?.status || (enforcementHold ? enforcementStatus : null),
      reviewAvailable: Boolean(holdCase?.caseId)
    };
  }

  async claimCleanRetryAuthorization(driverId, attemptScope) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const binding = this.retryAuthorizationBindingFromScope(attemptScope);
    if (!binding) return null;
    const currentCanonicalCnh = binding.kind === 'orphan_hold'
      ? await this.canonicalApprovalService.requireApprovedCnh(safeDriverId)
      : null;
    const ref = this.retryAuthorizationRef(binding.authorizationId);
    const enforcementRef = this.firestore()
      .collection(this.enforcementCollection)
      .doc(safeDriverId);
    const trustRef = binding.kind === 'orphan_hold'
      ? this.identityTrustStateRef(safeDriverId)
      : null;
    const claimToken = crypto.randomBytes(24).toString('hex');
    const claimTokenHash = crypto.createHash('sha256').update(claimToken).digest('hex');
    const claimedAt = this.nowDate().toISOString();

    await this.firestore().runTransaction(async (transaction) => {
      const [snapshot, enforcementSnapshot, trustSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(enforcementRef),
        trustRef ? transaction.get(trustRef) : Promise.resolve(null)
      ]);
      const authorization = this.recordFromSnapshot(snapshot);
      const enforcement = this.recordFromSnapshot(enforcementSnapshot);
      const trust = this.recordFromSnapshot(trustSnapshot);
      this.assertNotPermanentlyBlocked(enforcement);
      if (
        enforcement?.active !== true
        || String(enforcement?.status || '').trim().toUpperCase()
          !== binding.enforcementStatus
        || optionalString(
          binding.kind === 'orphan_hold' ? enforcement?.recoveryId : enforcement?.caseId
        ) !== binding.authorizationId
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID',
          'A autorizacao de nova tentativa nao esta ativa para este caso'
        );
      }
      if (!this.isRetryAuthorizationAvailable(authorization, {
        driverId: safeDriverId,
        caseId: binding.caseId,
        recoveryId: binding.recoveryId,
        authorizationId: binding.authorizationId,
        purpose: binding.purpose
      })) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_NOT_AVAILABLE',
          'A nova tentativa autorizada ja foi utilizada ou expirou'
        );
      }
      if (binding.kind === 'orphan_hold') {
        if (
          !trust
          || String(trust.status || '').trim().toLowerCase() !== 'revoked'
          || String(trust.revocationReason || '').trim().toLowerCase()
            !== 'canonical_face_compare_failed'
          || Number(trust.stateRevision || 0)
            !== Number(authorization.sourceTrust?.stateRevision || 0)
          || !sameIso(trust.revokedAt, authorization.sourceTrust?.revokedAt)
        ) {
          throw domainError(
            'KYC_ORPHAN_HOLD_RECOVERY_TRUST_CONFLICT',
            'O trust mudou depois da autorizacao; a recuperacao foi bloqueada'
          );
        }
        const sourceFailureEvidenceId = requiredId(
          authorization.sourceTrust?.failureEvidenceId,
          'failureEvidenceId'
        );
        const failureSnapshot = await transaction.get(
          this.identityTrustEvidenceRef(safeDriverId, sourceFailureEvidenceId)
        );
        const failureEvidence = this.recordFromSnapshot(failureSnapshot);
        if (
          !failureEvidence
          || optionalString(failureEvidence.driverId) !== safeDriverId
          || optionalString(failureEvidence.evidenceId) !== sourceFailureEvidenceId
          || String(failureEvidence.terminalOutcome || '').trim().toLowerCase()
            !== 'face_compare_failed'
          || !sameIso(failureEvidence.recordedAt, authorization.sourceTrust?.revokedAt)
        ) {
          throw domainError(
            'KYC_ORPHAN_HOLD_RECOVERY_FAILURE_EVIDENCE_CONFLICT',
            'A evidencia de falha mudou depois da autorizacao'
          );
        }
        const currentCnhSha256 = String(currentCanonicalCnh?.documentSha256 || '')
          .trim()
          .toLowerCase();
        if (
          optionalString(currentCanonicalCnh?.submissionId)
            !== optionalString(authorization.sourceCnh?.submissionId)
          || !/^[a-f0-9]{64}$/.test(currentCnhSha256)
          || currentCnhSha256
            !== String(authorization.sourceCnh?.documentSha256 || '').trim().toLowerCase()
        ) {
          throw domainError(
            'KYC_ORPHAN_HOLD_RECOVERY_CNH_BINDING_CONFLICT',
            'A CNH canonica mudou depois da autorizacao; a recuperacao foi bloqueada'
          );
        }
      }
      transaction.set(ref, this.scopedWriteRecord({
        status: 'CLAIMED',
        remainingAttempts: 0,
        claimedAt,
        claimTokenHash,
        updatedAt: claimedAt
      }, authorization), { merge: true });
    });

    return {
      driverId: safeDriverId,
      authorizationId: binding.authorizationId,
      caseId: binding.caseId,
      recoveryId: binding.recoveryId,
      purpose: binding.purpose,
      kind: binding.kind,
      attemptScope: binding.attemptScope,
      claimToken
    };
  }

  async consumeCleanRetryAuthorization(claim, sessionId) {
    if (!claim) return null;
    const safeDriverId = requiredId(claim.driverId, 'driverId');
    const safeAuthorizationId = requiredId(
      claim.authorizationId || claim.caseId || claim.recoveryId,
      'authorizationId'
    );
    const safeSessionId = requiredId(
      sessionId,
      'sessionId',
      'KYC_IDENTITY_REVIEW_RETRY_SESSION_REQUIRED'
    );
    const claimTokenHash = crypto
      .createHash('sha256')
      .update(String(claim.claimToken || ''))
      .digest('hex');
    const sessionIdHash = crypto
      .createHash('sha256')
      .update(safeSessionId)
      .digest('hex');
    const ref = this.retryAuthorizationRef(safeAuthorizationId);
    const consumedAt = this.nowDate().toISOString();

    await this.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = this.recordFromSnapshot(snapshot);
      if (
        !current
        || current.status !== 'CLAIMED'
        || optionalString(current.driverId) !== safeDriverId
        || optionalString(current.authorizationId || current.caseId) !== safeAuthorizationId
        || (claim.purpose && current.purpose !== claim.purpose)
        || current.claimTokenHash !== claimTokenHash
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_CLAIM_INVALID',
          'A autorizacao da nova tentativa nao pode ser consumida'
        );
      }
      transaction.set(ref, this.scopedWriteRecord({
        status: 'CONSUMED',
        remainingAttempts: 0,
        consumedAt,
        consumedSessionIdHash: sessionIdHash,
        claimTokenHash: null,
        updatedAt: consumedAt
      }, current), { merge: true });
    });

    return {
      authorizationId: safeAuthorizationId,
      caseId: claim.caseId || null,
      recoveryId: claim.recoveryId || null,
      status: 'CONSUMED',
      consumedAt
    };
  }

  async resumeCleanRetryAuthorization(driverId, attemptScope, sessionId) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const binding = this.retryAuthorizationBindingFromScope(attemptScope);
    if (!binding) {
      throw domainError(
        'KYC_IDENTITY_RETRY_BINDING_REQUIRED',
        'A retomada exige o escopo exato da autorizacao'
      );
    }
    const safeSessionId = requiredId(
      sessionId,
      'sessionId',
      'KYC_IDENTITY_REVIEW_RETRY_SESSION_REQUIRED'
    );
    const sessionIdHash = sha256(safeSessionId);
    const firestore = this.firestore();
    const authorizationRef = this.retryAuthorizationRef(binding.authorizationId);
    const enforcementRef = firestore
      .collection(this.enforcementCollection)
      .doc(safeDriverId);
    const resumedAt = this.nowDate().toISOString();

    return firestore.runTransaction(async (transaction) => {
      const [authorizationSnapshot, enforcementSnapshot] = await Promise.all([
        transaction.get(authorizationRef),
        transaction.get(enforcementRef)
      ]);
      const authorization = this.recordFromSnapshot(authorizationSnapshot);
      const enforcement = this.recordFromSnapshot(enforcementSnapshot);
      this.assertNotPermanentlyBlocked(enforcement);

      const enforcementPointer = binding.kind === 'orphan_hold'
        ? optionalString(enforcement?.recoveryId)
        : optionalString(enforcement?.caseId);
      if (
        enforcement?.active !== true
        || String(enforcement?.status || '').trim().toUpperCase()
          !== binding.enforcementStatus
        || enforcementPointer !== binding.authorizationId
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID',
          'O enforcement nao corresponde a autorizacao que criou a sessao'
        );
      }
      if (!this.isRetryAuthorizationResumeCandidate(authorization, {
        driverId: safeDriverId,
        caseId: binding.caseId,
        recoveryId: binding.recoveryId,
        authorizationId: binding.authorizationId,
        purpose: binding.purpose
      })) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_RESUME_NOT_AVAILABLE',
          'A sessao anterior nao pode mais ser retomada'
        );
      }

      if (String(authorization.status || '').trim().toUpperCase() === 'CONSUMED') {
        if (optionalString(authorization.consumedSessionIdHash) !== sessionIdHash) {
          throw domainError(
            'KYC_IDENTITY_REVIEW_RETRY_SESSION_BINDING_INVALID',
            'A sessao nao corresponde a autorizacao consumida'
          );
        }
        return {
          authorization: safeRetryAuthorizationMetadata(authorization),
          status: 'CONSUMED',
          idempotentReplay: true,
          resumedAt: authorization.consumedAt || null
        };
      }

      const consumedAuthorization = this.scopedWriteRecord({
        status: 'CONSUMED',
        remainingAttempts: 0,
        consumedAt: authorization.consumedAt || resumedAt,
        consumedSessionIdHash: sessionIdHash,
        claimTokenHash: null,
        recoveredSessionAt: resumedAt,
        updatedAt: resumedAt
      }, authorization);
      transaction.set(authorizationRef, consumedAuthorization, { merge: true });
      return {
        authorization: safeRetryAuthorizationMetadata(consumedAuthorization),
        status: 'CONSUMED',
        idempotentReplay: false,
        resumedAt
      };
    });
  }

  async releaseCleanRetryAuthorization(claim, { reason = 'session_creation_failed' } = {}) {
    if (!claim) return null;
    const safeDriverId = requiredId(claim.driverId, 'driverId');
    const safeAuthorizationId = requiredId(
      claim.authorizationId || claim.caseId || claim.recoveryId,
      'authorizationId'
    );
    const claimTokenHash = crypto
      .createHash('sha256')
      .update(String(claim.claimToken || ''))
      .digest('hex');
    const ref = this.retryAuthorizationRef(safeAuthorizationId);
    const releasedAt = this.nowDate().toISOString();

    return this.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = this.recordFromSnapshot(snapshot);
      if (
        !current
        || current.status !== 'CLAIMED'
        || optionalString(current.driverId) !== safeDriverId
        || optionalString(current.authorizationId || current.caseId) !== safeAuthorizationId
        || current.claimTokenHash !== claimTokenHash
      ) {
        return { released: false };
      }
      transaction.set(ref, this.scopedWriteRecord({
        status: 'AVAILABLE',
        remainingAttempts: 1,
        claimedAt: null,
        claimTokenHash: null,
        lastReleaseReason: optionalString(reason) || 'session_creation_failed',
        lastReleasedAt: releasedAt,
        updatedAt: releasedAt
      }, current), { merge: true });
      return {
        released: true,
        authorizationId: safeAuthorizationId,
        caseId: claim.caseId || null,
        recoveryId: claim.recoveryId || null,
        releasedAt
      };
    });
  }

  async finalizeCleanRetryAuthorization({
    driverId,
    attemptScope,
    sessionId,
    outcome,
    resultEvidenceId = null,
    reason = null
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const binding = this.retryAuthorizationBindingFromScope(attemptScope);
    if (!binding) return null;
    const safeSessionId = requiredId(
      sessionId,
      'sessionId',
      'KYC_IDENTITY_REVIEW_RETRY_SESSION_REQUIRED'
    );
    const safeOutcome = String(outcome || '').trim().toUpperCase();
    if (!RETRY_TERMINAL_OUTCOMES.has(safeOutcome)) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_RETRY_OUTCOME_INVALID',
        'O resultado do retry deve ser SUCCEEDED, REJECTED ou ABORTED'
      );
    }
    const safeResultEvidenceId = resultEvidenceId
      ? requiredId(resultEvidenceId, 'resultEvidenceId')
      : null;
    if (['SUCCEEDED', 'REJECTED'].includes(safeOutcome) && !safeResultEvidenceId) {
      throw domainError(
        safeOutcome === 'SUCCEEDED'
          ? 'KYC_IDENTITY_REVIEW_RETRY_SUCCESS_EVIDENCE_REQUIRED'
          : 'KYC_IDENTITY_REVIEW_RETRY_REJECTION_EVIDENCE_REQUIRED',
        safeOutcome === 'SUCCEEDED'
          ? 'O sucesso exige a evidencia canonica aprovada'
          : 'A rejeicao exige a evidencia canonica de falha'
      );
    }

    const firestore = this.firestore();
    const authorizationRef = this.retryAuthorizationRef(binding.authorizationId);
    const enforcementRef = firestore
      .collection(this.enforcementCollection)
      .doc(safeDriverId);
    const trustRef = this.identityTrustStateRef(safeDriverId);
    const resultEvidenceRef = safeResultEvidenceId
      ? this.identityTrustEvidenceRef(safeDriverId, safeResultEvidenceId)
      : null;
    const sessionIdHash = sha256(safeSessionId);
    const terminalAt = this.nowDate().toISOString();

    return firestore.runTransaction(async (transaction) => {
      const [authorizationSnapshot, enforcementSnapshot, trustSnapshot, resultEvidenceSnapshot] =
        await Promise.all([
          transaction.get(authorizationRef),
          transaction.get(enforcementRef),
          transaction.get(trustRef),
          resultEvidenceRef ? transaction.get(resultEvidenceRef) : Promise.resolve(null)
        ]);
      const authorization = this.recordFromSnapshot(authorizationSnapshot);
      const enforcement = this.recordFromSnapshot(enforcementSnapshot);
      const trust = this.recordFromSnapshot(trustSnapshot);
      const resultEvidence = this.recordFromSnapshot(resultEvidenceSnapshot);
      if (!authorization) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_NOT_AVAILABLE',
          'A autorizacao de nova tentativa nao foi encontrada'
        );
      }
      this.assertNotPermanentlyBlocked(enforcement);
      if (
        authorization.purpose !== binding.purpose
        || optionalString(authorization.driverId) !== safeDriverId
        || optionalString(authorization.authorizationId || authorization.caseId)
          !== binding.authorizationId
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_BINDING_INVALID',
          'A autorizacao nao corresponde ao motorista e escopo informados'
        );
      }

      if (RETRY_TERMINAL_OUTCOMES.has(String(authorization.status || '').toUpperCase())) {
        if (
          String(authorization.status || '').toUpperCase() === safeOutcome
          && authorization.consumedSessionIdHash === sessionIdHash
          && optionalString(authorization.resultEvidenceId) === safeResultEvidenceId
        ) {
          return {
            authorization: safeRetryAuthorizationMetadata(authorization),
            enforcement,
            idempotentReplay: true
          };
        }
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_OUTCOME_CONFLICT',
          'A autorizacao ja possui outro resultado terminal'
        );
      }

      if (
        authorization.status !== 'CONSUMED'
        || authorization.consumedSessionIdHash !== sessionIdHash
        || Number(authorization.remainingAttempts) !== 0
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_SESSION_BINDING_INVALID',
          'O resultado nao corresponde a sessao consumida pela autorizacao'
        );
      }
      if (!enforcement) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID',
          'O enforcement da autorizacao nao foi encontrado'
        );
      }
      const enforcementPointer = binding.kind === 'orphan_hold'
        ? optionalString(enforcement.recoveryId)
        : optionalString(enforcement.caseId);
      if (enforcementPointer !== binding.authorizationId) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID',
          'O enforcement nao corresponde a autorizacao consumida'
        );
      }

      if (safeOutcome === 'SUCCEEDED') {
        if (
          !trust
          || String(trust.status || '').trim().toLowerCase() !== 'active'
          || trust.revokedAt
          || optionalString(trust.lastEvidenceId) !== safeResultEvidenceId
          || !resultEvidence
          || optionalString(resultEvidence.driverId) !== safeDriverId
          || optionalString(resultEvidence.evidenceId) !== safeResultEvidenceId
          || String(resultEvidence.status || '').trim().toLowerCase() !== 'approved'
        ) {
          throw domainError(
            'KYC_IDENTITY_REVIEW_RETRY_SUCCESS_EVIDENCE_INVALID',
            'O trust ainda nao possui sucesso canonico vinculado a esta tentativa'
          );
        }
      } else if (safeOutcome === 'ABORTED') {
        if (
          !trust
          || String(trust.status || '').trim().toLowerCase() !== 'revoked'
          || Number(trust.stateRevision || 0)
            !== Number(authorization.sourceTrust?.stateRevision || trust.stateRevision || 0)
          || (
            authorization.sourceTrust?.revokedAt
            && !sameIso(trust.revokedAt, authorization.sourceTrust.revokedAt)
          )
        ) {
          throw domainError(
            'KYC_IDENTITY_REVIEW_RETRY_ABORT_TRUST_CONFLICT',
            'O trust mudou antes do encerramento da tentativa'
          );
        }
      } else if (
        !trust
        || String(trust.status || '').trim().toLowerCase() !== 'revoked'
        || !['canonical_face_compare_failed', 'identity_reverification_failed']
          .includes(String(trust.revocationReason || '').trim().toLowerCase())
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_REJECTION_TRUST_INVALID',
          'A rejeicao nao esta refletida no trust canonico'
        );
      }

      if (safeOutcome === 'REJECTED' && resultEvidenceRef) {
        if (
          !resultEvidence
          || optionalString(resultEvidence.driverId) !== safeDriverId
          || optionalString(resultEvidence.evidenceId) !== safeResultEvidenceId
          || String(resultEvidence.terminalOutcome || '').trim().toLowerCase()
            !== 'face_compare_failed'
        ) {
          throw domainError(
            'KYC_IDENTITY_REVIEW_RETRY_REJECTION_EVIDENCE_INVALID',
            'A rejeicao nao corresponde a uma evidencia canonica de falha'
          );
        }
      }

      const terminalAuthorization = this.scopedWriteRecord({
        ...authorization,
        status: safeOutcome,
        terminalAt,
        terminalReason: optionalString(reason),
        resultEvidenceId: safeResultEvidenceId,
        identityApproved: safeOutcome === 'SUCCEEDED',
        updatedAt: terminalAt
      }, authorization);
      const terminalEnforcement = safeOutcome === 'SUCCEEDED'
        ? this.scopedWriteRecord({
          ...enforcement,
          active: false,
          permanent: false,
          status: 'RESOLVED_BY_CANONICAL_MATCH',
          retryAllowed: false,
          identityApproved: true,
          resolvedAt: terminalAt,
          resultEvidenceId: safeResultEvidenceId,
          updatedAt: terminalAt
        }, enforcement)
        : this.scopedWriteRecord({
          ...enforcement,
          active: true,
          permanent: false,
          status: safeOutcome === 'ABORTED' && binding.kind === 'orphan_hold'
            ? ORPHAN_HOLD_ENFORCEMENT_STATUS
            : 'IDENTITY_MISMATCH_HOLD',
          reasonCode: safeOutcome === 'ABORTED'
            ? 'IDENTITY_RETRY_ABORTED'
            : 'CANONICAL_FACE_COMPARE_MISMATCH',
          retryAllowed: false,
          identityApproved: false,
          resultEvidenceId: safeResultEvidenceId,
          updatedAt: terminalAt
        }, enforcement);
      const auditRef = firestore
        .collection(this.auditCollection)
        .doc(`${binding.authorizationId}_terminal_${safeOutcome.toLowerCase()}`);
      transaction.set(authorizationRef, terminalAuthorization, { merge: false });
      transaction.set(enforcementRef, terminalEnforcement, { merge: false });
      transaction.set(auditRef, this.scopedWriteRecord({
        schemaVersion: 1,
        authorizationId: binding.authorizationId,
        recoveryId: binding.recoveryId,
        caseId: binding.caseId,
        driverId: safeDriverId,
        action: `IDENTITY_RETRY_${safeOutcome}`,
        actor: { uid: 'system:kyc-canonical-verification', type: 'system' },
        reason: optionalString(reason),
        resultEvidenceId: safeResultEvidenceId,
        sessionIdHash,
        occurredAt: terminalAt,
        immutable: true
      }), { merge: false });
      return {
        authorization: safeRetryAuthorizationMetadata(terminalAuthorization),
        enforcement: terminalEnforcement,
        idempotentReplay: false
      };
    });
  }

  async assertCnhUploadAllowed(driverId) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const kycState = await this.assertKycOperationAllowed(safeDriverId);
    if (kycState.cnhReplacementHold) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_HOLD',
        'A CNH nao pode ser substituida enquanto a divergencia de identidade esta em analise',
        {
          caseId: kycState.holdCaseId,
          ticketId: kycState.holdTicketId,
          status: kycState.holdStatus
        }
      );
    }
    return { allowed: true, driverId: safeDriverId, identityReviewHold: false };
  }

  async clearResolvedMismatchHold(driverId, { source = 'canonical_identity_success' } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const firestore = this.firestore();
    const ref = firestore.collection(this.enforcementCollection).doc(safeDriverId);
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { cleared: false, missing: true };
      const current = this.recordFromSnapshot(snapshot);
      this.assertNotPermanentlyBlocked(current);
      const status = String(current.status || '').trim().toUpperCase();
      if (![
        'IDENTITY_MISMATCH_HOLD',
        'FALSE_POSITIVE_RETRY_AUTHORIZED',
        ORPHAN_RECOVERY_ENFORCEMENT_STATUS,
        ORPHAN_HOLD_ENFORCEMENT_STATUS
      ].includes(status)) {
        return { cleared: false, status };
      }
      const updatedAt = new Date().toISOString();
      transaction.set(ref, this.scopedWriteRecord({
        active: false,
        permanent: false,
        status: 'RESOLVED_BY_CANONICAL_MATCH',
        retryAllowed: false,
        resolvedAt: updatedAt,
        resolvedBy: source,
        updatedAt
      }, current), { merge: true });
      return { cleared: true, status: 'RESOLVED_BY_CANONICAL_MATCH', updatedAt };
    });
  }

  async validateLinkedReviewArtifacts({ driverId, caseId, ticketId }) {
    const record = await this.getCaseRecordForDriver(driverId, caseId);
    const evidenceId = requiredId(
      record.evidenceBinding?.evidenceId,
      'evidenceId',
      'KYC_IDENTITY_REVIEW_EVIDENCE_REQUIRED'
    );
    const [ticket, evidence] = await Promise.all([
      this.getOperationalTicket(ticketId),
      this.evidenceService.getMetadata(evidenceId)
    ]);
    this.assertRecordScope(evidence);
    this.assertTicketBelongsToEvidence({ ticket, driverId, evidenceId });
    this.assertEvidenceBelongsToDriver(evidence, driverId);
    const linkedTickets = Array.isArray(record.ticketIds)
      ? record.ticketIds
      : [record.ticketId].filter(Boolean);
    if (
      !linkedTickets.includes(ticketId)
      || evidence.ticketId !== ticketId
      || evidence.caseId !== caseId
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_ARTIFACT_BINDING_INVALID',
        'Caso, chamado e evidencia nao possuem o mesmo vinculo canonico'
      );
    }
    return { record, ticket, evidence };
  }

  async getReviewContext({
    driverId,
    caseId,
    ticketId,
    reviewerContext,
    reason
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeCaseId = requiredId(caseId, 'caseId');
    const safeTicketId = requiredId(
      ticketId,
      'ticketId',
      'KYC_IDENTITY_REVIEW_TICKET_REQUIRED'
    );
    const safeReason = optionalString(reason);
    if (!safeReason) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_REASON_REQUIRED',
        'A justificativa de acesso e obrigatoria'
      );
    }
    const { service, reviewer } = await this.assertReviewer(
      reviewerContext,
      'VIEW_REVIEW_CONTEXT',
      { driverId: safeDriverId, caseId: safeCaseId }
    );
    const { record, ticket, evidence } = await this.validateLinkedReviewArtifacts({
      driverId: safeDriverId,
      caseId: safeCaseId,
      ticketId: safeTicketId
    });
    await service.getReviewEvidence({
      caseId: safeCaseId,
      ticketId: safeTicketId,
      reviewer,
      reason: safeReason,
      evidenceBindingHash: record.evidenceBindingHash
    });

    return {
      case: safeCaseMetadata(record),
      ticket: safeTicketMetadata(ticket),
      evidence: safeEvidenceMetadata(evidence),
      accessClassification: optionalString(record.evidenceAccess?.classification)
        || 'RESTRICTED_KYC',
      publicUrlAllowed: false
    };
  }

  async grantEvidenceReadAccess({
    driverId,
    caseId,
    ticketId,
    reviewerContext,
    reason,
    ttlSeconds
  } = {}) {
    const context = await this.getReviewContext({
      driverId,
      caseId,
      ticketId,
      reviewerContext,
      reason
    });
    const access = await this.evidenceService.createReadAccess(
      context.evidence.evidenceId,
      {
        actorId: reviewerFromContext(reviewerContext).uid,
        ticketId: context.ticket.id,
        reason,
        ...(ttlSeconds == null ? {} : { ttlSeconds })
      }
    );
    return {
      evidenceId: access.evidenceId,
      signedUrl: access.signedUrl,
      expiresAt: access.expiresAt,
      contentType: access.contentType
    };
  }
}

function createScopedKycIdentityReviewWorkflowService(persistenceContext, options = {}) {
  if (!persistenceContext || typeof persistenceContext !== 'object') {
    throw domainError(
      'KYC_IDENTITY_REVIEW_PERSISTENCE_CONTEXT_REQUIRED',
      'Contexto de persistencia obrigatorio para factory do workflow KYC'
    );
  }
  return new KycIdentityReviewWorkflowService({
    ...options,
    persistenceContext
  });
}

const singleton = new KycIdentityReviewWorkflowService();

module.exports = singleton;
module.exports.KycIdentityReviewWorkflowService = KycIdentityReviewWorkflowService;
module.exports.createCaseService = createCaseService;
module.exports.createScopedKycIdentityReviewWorkflowService =
  createScopedKycIdentityReviewWorkflowService;
module.exports.REVIEWER_ROLES = REVIEWER_ROLES;
module.exports.OPEN_CASE_STATUSES = OPEN_CASE_STATUSES;
module.exports.safeCaseMetadata = safeCaseMetadata;
module.exports.safeEvidenceMetadata = safeEvidenceMetadata;
module.exports.isSandboxTicket = isSandboxTicket;
module.exports.domainError = domainError;
