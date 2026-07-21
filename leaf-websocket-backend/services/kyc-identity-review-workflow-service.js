const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const { getAdminUser } = require('../utils/admin-user-cache');
const canonicalDriverDocumentApprovalService = require('./canonical-driver-document-approval-service');
const driverIdentityTrustService = require('./driver-identity-trust-service');
const kycFailedBiometricEvidenceService = require('./kyc-failed-biometric-evidence-service');
const supportTicketService = require('./support-ticket-service');
const {
  KycIdentityReviewCaseService,
  CASE_STATUSES,
  DEFAULT_COLLECTIONS
} = require('./kyc-identity-review-case-service');

const REVIEWER_ROLES = new Set(['admin', 'super-admin', 'manager']);
const OPEN_CASE_STATUSES = new Set([CASE_STATUSES.OPEN, CASE_STATUSES.UNDER_REVIEW]);
const MANUAL_REVIEW_RETRY_SCOPE_PREFIX = 'manual_review_retry_';
const MANUAL_REVIEW_CASE_ID_PATTERN = /^kyc_ir_[a-f0-9]{32}$/;

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
  collections
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
    ...(collections ? { collections } : {})
  });
}

class KycIdentityReviewWorkflowService {
  constructor(options = {}) {
    this.firestoreProvider = options.firestoreProvider || (() => firebaseConfig.getFirestore());
    this.adminUserProvider = options.adminUserProvider || getAdminUser;
    this.identityTrustService = options.identityTrustService || driverIdentityTrustService;
    this.evidenceService = options.evidenceService || kycFailedBiometricEvidenceService;
    this.canonicalApprovalService = options.canonicalApprovalService
      || canonicalDriverDocumentApprovalService;
    this.supportTicketService = options.supportTicketService || supportTicketService;
    this.caseServiceFactory = options.caseServiceFactory || ((factoryOptions = {}) =>
      createCaseService({
        firestoreProvider: this.firestoreProvider,
        adminUserProvider: this.adminUserProvider,
        identityTrustService: this.identityTrustService,
        ...factoryOptions
      }));
    this.caseCollection = options.caseCollection || DEFAULT_COLLECTIONS.cases;
    this.enforcementCollection = options.enforcementCollection || DEFAULT_COLLECTIONS.enforcement;
    this.retryAuthorizationCollection = options.retryAuthorizationCollection
      || DEFAULT_COLLECTIONS.retryAuthorizations;
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
    return safeEvidenceMetadata(captured);
  }

  async getOperationalTicket(ticketId) {
    const safeTicketId = requiredId(
      ticketId,
      'ticketId',
      'KYC_IDENTITY_REVIEW_TICKET_REQUIRED'
    );
    const ticket = await this.supportTicketService.getTicket(safeTicketId);
    if (!ticket) {
      throw domainError('KYC_IDENTITY_REVIEW_TICKET_NOT_FOUND', 'Chamado nao encontrado');
    }
    if (isSandboxTicket(ticket)) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_SANDBOX_TICKET_FORBIDDEN',
        'Chamados sandbox nao podem autorizar revisao biometrica operacional'
      );
    }
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
    const records = (snapshot.docs || []).map((doc) => ({
      ...(doc.data() || {}),
      caseId: doc.id
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
    return record;
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
    return snapshot.exists ? (snapshot.data() || {}) : null;
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

  isRetryAuthorizationAvailable(authorization, { driverId, caseId } = {}) {
    const expiresAtMs = Date.parse(authorization?.expiresAt || '');
    return authorization?.status === 'AVAILABLE'
      && authorization?.purpose === 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY'
      && optionalString(authorization?.driverId) === driverId
      && optionalString(authorization?.caseId) === caseId
      && Number(authorization?.allowedAttempts) === 1
      && Number(authorization?.remainingAttempts) === 1
      && Number.isFinite(expiresAtMs)
      && expiresAtMs > Date.now()
      && authorization?.identityApproved !== true;
  }

  async getRetryAuthorization(caseId) {
    if (!caseId) return null;
    const snapshot = await this.retryAuthorizationRef(caseId).get();
    return snapshot.exists ? (snapshot.data() || {}) : null;
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

  async assertKycOperationAllowed(driverId) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const [enforcement, cases, trustState] = await Promise.all([
      this.getEnforcement(safeDriverId),
      this.listCaseRecordsForDriver(safeDriverId),
      typeof this.identityTrustService.readState === 'function'
        ? this.identityTrustService.readState(safeDriverId, { bypassCache: true })
        : Promise.resolve(null)
    ]);
    this.assertNotPermanentlyBlocked(enforcement);
    const holdCase = cases.find((record) => OPEN_CASE_STATUSES.has(record.status)) || null;
    const enforcementStatus = String(enforcement?.status || '').trim().toUpperCase();
    const retryCaseId = enforcementStatus === 'FALSE_POSITIVE_RETRY_AUTHORIZED'
      ? optionalString(enforcement?.caseId)
      : null;
    const retryAuthorization = retryCaseId
      ? await this.getRetryAuthorization(retryCaseId)
      : null;
    const enforcementHold = enforcement?.active === true &&
      enforcementStatus === 'IDENTITY_MISMATCH_HOLD';
    const falsePositiveRetryState = enforcement?.active === true &&
      enforcementStatus === 'FALSE_POSITIVE_RETRY_AUTHORIZED';
    const cleanRetryAuthorized = falsePositiveRetryState &&
      this.isRetryAuthorizationAvailable(retryAuthorization, {
        driverId: safeDriverId,
        caseId: retryCaseId
      });
    const trustMismatchHold = String(trustState?.status || '').trim().toLowerCase() === 'revoked' &&
      ['canonical_face_compare_failed', 'identity_reverification_failed']
        .includes(String(trustState?.revocationReason || '').trim().toLowerCase());
    const identityReviewHold = Boolean(
      holdCase
      || enforcementHold
      || (trustMismatchHold && !cleanRetryAuthorized)
      || (falsePositiveRetryState && !cleanRetryAuthorized)
    );
    return {
      allowed: true,
      driverId: safeDriverId,
      permanentBlock: false,
      identityReviewHold,
      cnhReplacementHold: identityReviewHold || falsePositiveRetryState,
      cleanRetryAuthorized,
      holdCaseId: holdCase?.caseId || enforcement?.caseId || null,
      holdTicketId: holdCase?.ticketId || enforcement?.ticketId || null,
      holdStatus: holdCase?.status || (enforcementHold ? 'IDENTITY_MISMATCH_HOLD' : null)
    };
  }

  async claimCleanRetryAuthorization(driverId, attemptScope) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const caseId = this.caseIdFromManualReviewScope(attemptScope);
    if (!caseId) return null;
    const ref = this.retryAuthorizationRef(caseId);
    const enforcementRef = this.firestore()
      .collection(this.enforcementCollection)
      .doc(safeDriverId);
    const claimToken = crypto.randomBytes(24).toString('hex');
    const claimTokenHash = crypto.createHash('sha256').update(claimToken).digest('hex');
    const claimedAt = new Date().toISOString();

    await this.firestore().runTransaction(async (transaction) => {
      const [snapshot, enforcementSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(enforcementRef)
      ]);
      const authorization = snapshot.exists ? (snapshot.data() || {}) : null;
      const enforcement = enforcementSnapshot.exists
        ? (enforcementSnapshot.data() || {})
        : null;
      this.assertNotPermanentlyBlocked(enforcement);
      if (
        enforcement?.active !== true
        || String(enforcement?.status || '').trim().toUpperCase()
          !== 'FALSE_POSITIVE_RETRY_AUTHORIZED'
        || optionalString(enforcement?.caseId) !== caseId
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID',
          'A autorizacao de nova tentativa nao esta ativa para este caso'
        );
      }
      if (!this.isRetryAuthorizationAvailable(authorization, {
        driverId: safeDriverId,
        caseId
      })) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_NOT_AVAILABLE',
          'A nova tentativa autorizada ja foi utilizada ou expirou'
        );
      }
      transaction.set(ref, {
        status: 'CLAIMED',
        remainingAttempts: 0,
        claimedAt,
        claimTokenHash,
        updatedAt: claimedAt
      }, { merge: true });
    });

    return {
      driverId: safeDriverId,
      caseId,
      attemptScope: String(attemptScope || '').trim().toLowerCase(),
      claimToken
    };
  }

  async consumeCleanRetryAuthorization(claim, sessionId) {
    if (!claim) return null;
    const safeDriverId = requiredId(claim.driverId, 'driverId');
    const safeCaseId = requiredId(claim.caseId, 'caseId');
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
    const ref = this.retryAuthorizationRef(safeCaseId);
    const consumedAt = new Date().toISOString();

    await this.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? (snapshot.data() || {}) : {};
      if (
        current.status !== 'CLAIMED'
        || optionalString(current.driverId) !== safeDriverId
        || optionalString(current.caseId) !== safeCaseId
        || current.claimTokenHash !== claimTokenHash
      ) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_RETRY_CLAIM_INVALID',
          'A autorizacao da nova tentativa nao pode ser consumida'
        );
      }
      transaction.set(ref, {
        status: 'CONSUMED',
        remainingAttempts: 0,
        consumedAt,
        consumedSessionIdHash: sessionIdHash,
        claimTokenHash: null,
        updatedAt: consumedAt
      }, { merge: true });
    });

    return { caseId: safeCaseId, status: 'CONSUMED', consumedAt };
  }

  async releaseCleanRetryAuthorization(claim, { reason = 'session_creation_failed' } = {}) {
    if (!claim) return null;
    const safeDriverId = requiredId(claim.driverId, 'driverId');
    const safeCaseId = requiredId(claim.caseId, 'caseId');
    const claimTokenHash = crypto
      .createHash('sha256')
      .update(String(claim.claimToken || ''))
      .digest('hex');
    const ref = this.retryAuthorizationRef(safeCaseId);
    const releasedAt = new Date().toISOString();

    return this.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? (snapshot.data() || {}) : {};
      if (
        current.status !== 'CLAIMED'
        || optionalString(current.driverId) !== safeDriverId
        || current.claimTokenHash !== claimTokenHash
      ) {
        return { released: false };
      }
      transaction.set(ref, {
        status: 'AVAILABLE',
        remainingAttempts: 1,
        claimedAt: null,
        claimTokenHash: null,
        lastReleaseReason: optionalString(reason) || 'session_creation_failed',
        lastReleasedAt: releasedAt,
        updatedAt: releasedAt
      }, { merge: true });
      return { released: true, caseId: safeCaseId, releasedAt };
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
      const current = snapshot.data() || {};
      this.assertNotPermanentlyBlocked(current);
      const status = String(current.status || '').trim().toUpperCase();
      if (!['IDENTITY_MISMATCH_HOLD', 'FALSE_POSITIVE_RETRY_AUTHORIZED'].includes(status)) {
        return { cleared: false, status };
      }
      const updatedAt = new Date().toISOString();
      transaction.set(ref, {
        active: false,
        permanent: false,
        status: 'RESOLVED_BY_CANONICAL_MATCH',
        retryAllowed: false,
        resolvedAt: updatedAt,
        resolvedBy: source,
        updatedAt
      }, { merge: true });
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

const singleton = new KycIdentityReviewWorkflowService();

module.exports = singleton;
module.exports.KycIdentityReviewWorkflowService = KycIdentityReviewWorkflowService;
module.exports.createCaseService = createCaseService;
module.exports.REVIEWER_ROLES = REVIEWER_ROLES;
module.exports.OPEN_CASE_STATUSES = OPEN_CASE_STATUSES;
module.exports.safeCaseMetadata = safeCaseMetadata;
module.exports.safeEvidenceMetadata = safeEvidenceMetadata;
module.exports.isSandboxTicket = isSandboxTicket;
module.exports.domainError = domainError;
