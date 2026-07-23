const crypto = require('crypto');
const {
  resolveKycPersistenceScope,
  buildScopedPersistenceEnvelope,
  assertStoredRecordMatchesScope,
  assertScopedResourceName
} = require('./sandbox-persistence-context');

const CASE_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  CONFIRMED_FRAUD: 'CONFIRMED_FRAUD',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  CLOSED: 'CLOSED'
});

const REVIEW_DECISIONS = Object.freeze({
  CONFIRMED_FRAUD: CASE_STATUSES.CONFIRMED_FRAUD,
  FALSE_POSITIVE: CASE_STATUSES.FALSE_POSITIVE
});

const DEFAULT_COLLECTIONS = Object.freeze({
  cases: 'kyc_identity_review_cases',
  enforcement: 'driver_identity_enforcement',
  retryAuthorizations: 'kyc_identity_retry_authorizations',
  audit: 'kyc_identity_review_audit'
});

const FAILED_FACE_DECISIONS = new Set([
  'reject',
  'rejected',
  'mismatch',
  'not_match',
  'failed'
]);

function domainError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requiredString(value, field, code = 'KYC_IDENTITY_REVIEW_INPUT_INVALID') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw domainError(code, `${field} e obrigatorio`, { field });
  }
  return normalized;
}

function optionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function finiteNumber(value, field) {
  if (value == null || String(value).trim() === '') {
    throw domainError(
      'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID',
      `${field} deve ser numerico`,
      { field }
    );
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw domainError(
      'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID',
      `${field} deve ser numerico`,
      { field }
    );
  }
  return normalized;
}

function storagePath(value, field) {
  const normalized = requiredString(
    value,
    field,
    'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
  );
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    throw domainError(
      'KYC_IDENTITY_REVIEW_PUBLIC_EVIDENCE_URL_FORBIDDEN',
      `${field} deve ser uma chave privada de armazenamento, nunca uma URL publica`,
      { field }
    );
  }
  return normalized;
}

function isoTimestamp(value, field) {
  const normalized = requiredString(
    value,
    field,
    'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
  );
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw domainError(
      'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID',
      `${field} deve ser uma data valida`,
      { field }
    );
  }
  return new Date(parsed).toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeReviewer(reviewer = {}) {
  return {
    uid: requiredString(
      reviewer.uid,
      'reviewer.uid',
      'KYC_IDENTITY_REVIEW_REVIEWER_REQUIRED'
    ),
    email: requiredString(
      reviewer.email,
      'reviewer.email',
      'KYC_IDENTITY_REVIEW_REVIEWER_REQUIRED'
    ).toLowerCase()
  };
}

function normalizeRequester(requestedBy = {}) {
  return {
    uid: optionalString(requestedBy.uid),
    email: optionalString(requestedBy.email)?.toLowerCase() || null,
    type: optionalString(requestedBy.type) || 'system'
  };
}

function normalizeEvidenceBinding(binding = {}) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw domainError(
      'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID',
      'evidenceBinding e obrigatorio'
    );
  }

  const referenceSelfie = binding.referenceSelfie || {};
  const approvedCnh = binding.approvedCnh || {};
  const faceCompare = binding.faceCompare || {};
  const decision = requiredString(
    faceCompare.decision,
    'evidenceBinding.faceCompare.decision',
    'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
  ).toLowerCase();

  if (!FAILED_FACE_DECISIONS.has(decision)) {
    throw domainError(
      'KYC_IDENTITY_REVIEW_FAILED_EVIDENCE_REQUIRED',
      'O caso so pode ser aberto a partir de uma divergencia facial concluida'
    );
  }

  const normalized = {
    evidenceId: requiredString(
      binding.evidenceId,
      'evidenceBinding.evidenceId',
      'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
    ),
    livenessSessionHash: requiredString(
      binding.livenessSessionHash,
      'evidenceBinding.livenessSessionHash',
      'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
    ),
    referenceSelfie: {
      bucket: optionalString(referenceSelfie.bucket),
      storagePath: storagePath(
        referenceSelfie.storagePath,
        'evidenceBinding.referenceSelfie.storagePath'
      ),
      sha256: requiredString(
        referenceSelfie.sha256,
        'evidenceBinding.referenceSelfie.sha256',
        'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
      ),
      generation: optionalString(referenceSelfie.generation),
      expiresAt: optionalString(referenceSelfie.expiresAt)
        ? isoTimestamp(
          referenceSelfie.expiresAt,
          'evidenceBinding.referenceSelfie.expiresAt'
        )
        : null
    },
    approvedCnh: {
      documentId: requiredString(
        approvedCnh.documentId,
        'evidenceBinding.approvedCnh.documentId',
        'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
      ),
      bucket: optionalString(approvedCnh.bucket),
      storagePath: storagePath(
        approvedCnh.storagePath,
        'evidenceBinding.approvedCnh.storagePath'
      ),
      sha256: requiredString(
        approvedCnh.sha256,
        'evidenceBinding.approvedCnh.sha256',
        'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
      ),
      approvalRevision: optionalString(approvedCnh.approvalRevision)
    },
    faceCompare: {
      provider: requiredString(
        faceCompare.provider,
        'evidenceBinding.faceCompare.provider',
        'KYC_IDENTITY_REVIEW_EVIDENCE_INVALID'
      ),
      decision,
      similarityScore: finiteNumber(
        faceCompare.similarityScore,
        'evidenceBinding.faceCompare.similarityScore'
      ),
      threshold: finiteNumber(
        faceCompare.threshold,
        'evidenceBinding.faceCompare.threshold'
      ),
      comparedAt: isoTimestamp(
        faceCompare.comparedAt,
        'evidenceBinding.faceCompare.comparedAt'
      )
    }
  };

  if (normalized.faceCompare.similarityScore >= normalized.faceCompare.threshold) {
    throw domainError(
      'KYC_IDENTITY_REVIEW_FAILED_EVIDENCE_REQUIRED',
      'A evidencia informada nao representa uma divergencia facial'
    );
  }

  return normalized;
}

function buildEvidenceBindingHash(binding) {
  return sha256(canonicalJson(normalizeEvidenceBinding(binding)));
}

class KycIdentityReviewCaseService {
  constructor(options = {}) {
    this.firestoreProvider = options.firestoreProvider || (() => null);
    this.reviewerAuthorizer = options.reviewerAuthorizer || (async () => false);
    this.runOutsideActiveTrip = options.runOutsideActiveTrip || (async () => {
      throw domainError(
        'KYC_IDENTITY_REVIEW_ACTIVE_TRIP_GUARD_UNAVAILABLE',
        'O guard canonico de corrida ativa nao foi configurado'
      );
    });
    this.now = options.now || (() => new Date());
    this.persistenceScope = resolveKycPersistenceScope(options.persistenceContext || {}, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: options.allowExplicitSandboxAccess === true
    });
    const expectedCollections = {
      cases: this.persistenceScope.collections.kycIdentityReviewCases,
      enforcement: this.persistenceScope.collections.driverIdentityEnforcement,
      retryAuthorizations: this.persistenceScope.collections.kycIdentityRetryAuthorizations,
      audit: this.persistenceScope.collections.kycIdentityReviewAudit
    };
    this.collections = Object.fromEntries(
      Object.entries(expectedCollections).map(([key, expected]) => [
        key,
        assertScopedResourceName({
          scopeInput: this.persistenceScope,
          actual: options.collections?.[key] || expected,
          expected,
          resource: `Colecao KYC ${key}`
        })
      ])
    );
    this.evidenceRetentionMs = Number.isFinite(options.evidenceRetentionMs)
      ? options.evidenceRetentionMs
      : 30 * 24 * 60 * 60 * 1000;
    this.retryAuthorizationTtlMs = Number.isFinite(options.retryAuthorizationTtlMs)
      ? options.retryAuthorizationTtlMs
      : 7 * 24 * 60 * 60 * 1000;
  }

  persistenceEnvelope(record = null) {
    return buildScopedPersistenceEnvelope(this.persistenceScope, { record });
  }

  assertRecordScope(record) {
    assertStoredRecordMatchesScope(record, this.persistenceScope);
    return record;
  }

  firestore() {
    const firestore = this.firestoreProvider();
    if (!firestore || typeof firestore.runTransaction !== 'function') {
      throw domainError(
        'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE',
        'Firestore indisponivel para casos de revisao de identidade'
      );
    }
    return firestore;
  }

  nowDate() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw domainError('KYC_IDENTITY_REVIEW_CLOCK_INVALID', 'Relogio do servico invalido');
    }
    return date;
  }

  caseIdFor(driverId, evidenceId) {
    return `kyc_ir_${sha256(`${driverId}:${evidenceId}`).slice(0, 32)}`;
  }

  auditIdFor(caseId, revision, action) {
    return `${caseId}_${String(revision).padStart(6, '0')}_${action.toLowerCase()}`;
  }

  caseRef(firestore, caseId) {
    return firestore.collection(this.collections.cases).doc(caseId);
  }

  async getCase(caseId) {
    const safeCaseId = requiredString(caseId, 'caseId');
    const snapshot = await this.caseRef(this.firestore(), safeCaseId).get();
    if (!snapshot.exists) return null;
    return this.assertRecordScope(snapshot.data() || {});
  }

  assertTicketLinked(caseRecord, ticketId) {
    const safeTicketId = requiredString(
      ticketId,
      'ticketId',
      'KYC_IDENTITY_REVIEW_TICKET_REQUIRED'
    );
    const linkedTickets = Array.isArray(caseRecord.ticketIds)
      ? caseRecord.ticketIds
      : [caseRecord.ticketId].filter(Boolean);
    if (!linkedTickets.includes(safeTicketId)) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_TICKET_BINDING_INVALID',
        'O chamado nao esta vinculado a este caso',
        { ticketId: safeTicketId }
      );
    }
    return safeTicketId;
  }

  assertEvidenceHash(caseRecord, evidenceBindingHash) {
    const safeHash = requiredString(
      evidenceBindingHash,
      'evidenceBindingHash',
      'KYC_IDENTITY_REVIEW_EVIDENCE_BINDING_REQUIRED'
    );
    if (safeHash !== caseRecord.evidenceBindingHash) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_EVIDENCE_BINDING_INVALID',
        'A decisao nao corresponde ao par selfie/CNH vinculado ao caso'
      );
    }
    return safeHash;
  }

  async assertAuthorizedReviewer({ reviewer, action, caseRecord }) {
    const normalized = normalizeReviewer(reviewer);
    const authorized = await this.reviewerAuthorizer({
      reviewer: normalized,
      action,
      caseRecord
    });
    if (authorized !== true) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_ADMIN_REQUIRED',
        'A decisao exige um administrador KYC autorizado'
      );
    }
    return normalized;
  }

  buildAuditRecord({
    caseRecord,
    action,
    actor,
    reason,
    ticketId,
    revision,
    occurredAt,
    details = {}
  }) {
    return {
      ...this.persistenceEnvelope(caseRecord),
      schemaVersion: 1,
      caseId: caseRecord.caseId,
      driverId: caseRecord.driverId,
      ticketId,
      action,
      actor,
      reason: reason || null,
      evidenceBindingHash: caseRecord.evidenceBindingHash,
      previousStatus: details.previousStatus || null,
      nextStatus: details.nextStatus || null,
      revision,
      severity: details.severity || 'INFO',
      details: details.metadata || {},
      occurredAt,
      immutable: true
    };
  }

  async createOrLinkCase({
    driverId,
    ticketId,
    evidenceBinding,
    requestedBy = {}
  } = {}) {
    const safeDriverId = requiredString(driverId, 'driverId');
    const safeTicketId = requiredString(
      ticketId,
      'ticketId',
      'KYC_IDENTITY_REVIEW_TICKET_REQUIRED'
    );
    const normalizedEvidence = normalizeEvidenceBinding(evidenceBinding);
    const evidenceBindingHash = sha256(canonicalJson(normalizedEvidence));
    const caseId = this.caseIdFor(safeDriverId, normalizedEvidence.evidenceId);
    const requester = normalizeRequester(requestedBy);
    const firestore = this.firestore();
    const caseRef = this.caseRef(firestore, caseId);
    const now = this.nowDate();
    const nowIso = now.toISOString();

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(caseRef);
      if (snapshot.exists) {
        const current = snapshot.data() || {};
        this.assertRecordScope(current);
        if (
          current.driverId !== safeDriverId ||
          current.evidenceBindingHash !== evidenceBindingHash
        ) {
          throw domainError(
            'KYC_IDENTITY_REVIEW_IDEMPOTENCY_CONFLICT',
            'A evidencia ja esta vinculada a um caso divergente'
          );
        }

        const currentTicketIds = Array.isArray(current.ticketIds)
          ? current.ticketIds
          : [current.ticketId].filter(Boolean);
        if (currentTicketIds.includes(safeTicketId)) {
          return { case: current, idempotentReplay: true, ticketLinked: false };
        }

        const revision = Number(current.revision || 0) + 1;
        const next = {
          ...current,
          ticketIds: [...currentTicketIds, safeTicketId],
          revision,
          updatedAt: nowIso
        };
        const auditRef = firestore.collection(this.collections.audit).doc(
          this.auditIdFor(caseId, revision, 'CASE_TICKET_LINKED')
        );
        transaction.set(caseRef, next, { merge: false });
        transaction.set(auditRef, this.buildAuditRecord({
          caseRecord: next,
          action: 'CASE_TICKET_LINKED',
          actor: requester,
          ticketId: safeTicketId,
          revision,
          occurredAt: nowIso,
          details: {
            previousStatus: current.status,
            nextStatus: current.status
          }
        }), { merge: false });
        return { case: next, idempotentReplay: false, ticketLinked: true };
      }

      const policyRetainUntilMs = now.getTime() + this.evidenceRetentionMs;
      const evidenceExpiresAtMs = Date.parse(normalizedEvidence.referenceSelfie.expiresAt || '');
      const retainUntilMs = Number.isFinite(evidenceExpiresAtMs)
        ? Math.min(policyRetainUntilMs, evidenceExpiresAtMs)
        : policyRetainUntilMs;
      const reviewCase = {
        ...this.persistenceEnvelope(),
        schemaVersion: 1,
        caseId,
        driverId: safeDriverId,
        ticketId: safeTicketId,
        ticketIds: [safeTicketId],
        status: CASE_STATUSES.OPEN,
        revision: 1,
        evidenceBindingHash,
        evidenceBinding: normalizedEvidence,
        evidenceAccess: {
          classification: 'RESTRICTED_KYC',
          failedAttemptsOnly: true,
          publicUrlAllowed: false,
          legalHold: false,
          retainUntil: new Date(retainUntilMs).toISOString()
        },
        resolution: null,
        createdBy: requester,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      const auditRef = firestore.collection(this.collections.audit).doc(
        this.auditIdFor(caseId, 1, 'CASE_OPENED')
      );
      transaction.set(caseRef, reviewCase, { merge: false });
      transaction.set(auditRef, this.buildAuditRecord({
        caseRecord: reviewCase,
        action: 'CASE_OPENED',
        actor: requester,
        ticketId: safeTicketId,
        revision: 1,
        occurredAt: nowIso,
        details: { nextStatus: CASE_STATUSES.OPEN }
      }), { merge: false });

      return { case: reviewCase, idempotentReplay: false, ticketLinked: true };
    });
  }

  async startReview({
    caseId,
    ticketId,
    reviewer,
    reason,
    evidenceBindingHash
  } = {}) {
    const safeCaseId = requiredString(caseId, 'caseId');
    const safeReason = requiredString(
      reason,
      'reason',
      'KYC_IDENTITY_REVIEW_REASON_REQUIRED'
    );
    const firestore = this.firestore();
    const caseRef = this.caseRef(firestore, safeCaseId);
    const currentSnapshot = await caseRef.get();
    if (!currentSnapshot.exists) {
      throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
    }
    const preflightCase = currentSnapshot.data() || {};
    this.assertRecordScope(preflightCase);
    const safeTicketId = this.assertTicketLinked(preflightCase, ticketId);
    const safeEvidenceHash = this.assertEvidenceHash(preflightCase, evidenceBindingHash);
    const actor = await this.assertAuthorizedReviewer({
      reviewer,
      action: 'START_REVIEW',
      caseRecord: preflightCase
    });
    const nowIso = this.nowDate().toISOString();

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(caseRef);
      if (!snapshot.exists) {
        throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
      }
      const current = snapshot.data() || {};
      this.assertRecordScope(current);
      this.assertTicketLinked(current, safeTicketId);
      this.assertEvidenceHash(current, safeEvidenceHash);

      if (current.status === CASE_STATUSES.UNDER_REVIEW) {
        const existing = current.review || {};
        if (
          existing.startedBy?.uid === actor.uid &&
          existing.reason === safeReason
        ) {
          return { case: current, idempotentReplay: true };
        }
        throw domainError(
          'KYC_IDENTITY_REVIEW_ALREADY_ASSIGNED',
          'O caso ja esta em analise por outro contexto administrativo'
        );
      }
      if (current.status !== CASE_STATUSES.OPEN) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_TRANSITION_INVALID',
          `Nao e possivel iniciar analise a partir de ${current.status}`
        );
      }

      const revision = Number(current.revision || 0) + 1;
      const next = {
        ...current,
        status: CASE_STATUSES.UNDER_REVIEW,
        revision,
        review: {
          startedBy: actor,
          startedAt: nowIso,
          reason: safeReason,
          ticketId: safeTicketId,
          evidenceBindingHash: safeEvidenceHash
        },
        updatedAt: nowIso
      };
      const auditRef = firestore.collection(this.collections.audit).doc(
        this.auditIdFor(safeCaseId, revision, 'REVIEW_STARTED')
      );
      transaction.set(caseRef, next, { merge: false });
      transaction.set(auditRef, this.buildAuditRecord({
        caseRecord: next,
        action: 'REVIEW_STARTED',
        actor,
        reason: safeReason,
        ticketId: safeTicketId,
        revision,
        occurredAt: nowIso,
        details: {
          previousStatus: current.status,
          nextStatus: next.status
        }
      }), { merge: false });
      return { case: next, idempotentReplay: false };
    });
  }

  buildPermanentBlockProjection({ caseRecord, ticketId, reviewer, reason, decidedAt }) {
    const blockMetadata = {
      permanent: true,
      reasonCode: 'CONFIRMED_IDENTITY_FRAUD',
      caseId: caseRecord.caseId,
      ticketId,
      evidenceBindingHash: caseRecord.evidenceBindingHash,
      decidedAt,
      decidedByUid: reviewer.uid,
      decidedByEmail: reviewer.email
    };
    return {
      users: {
        accountStatus: 'blocked',
        driverStatus: 'blocked',
        kycStatus: 'blocked',
        kycBlocked: true,
        kycBlockedReason: 'confirmed_identity_fraud',
        kycReverifyRequired: false,
        identityFraudBlock: blockMetadata
      },
      drivers: {
        accountStatus: 'blocked',
        kycStatus: 'blocked',
        kycBlocked: true,
        kycBlockedReason: 'confirmed_identity_fraud',
        identityFraudBlock: blockMetadata
      },
      redis: {
        status: 'OFFLINE',
        isOnline: 'false',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK',
        kyc_status: 'blocked',
        kyc_blocked: 'true',
        kyc_blocked_reason: 'confirmed_identity_fraud'
      },
      geo: {
        removeFromEligibleDriverIndex: true
      },
      reason
    };
  }

  async decideCase({
    caseId,
    ticketId,
    reviewer,
    reason,
    evidenceBindingHash,
    decision,
    explicitDecision = false,
    confirmPermanentBlock = false
  } = {}) {
    const safeCaseId = requiredString(caseId, 'caseId');
    const safeReason = requiredString(
      reason,
      'reason',
      'KYC_IDENTITY_REVIEW_REASON_REQUIRED'
    );
    const safeDecision = requiredString(
      decision,
      'decision',
      'KYC_IDENTITY_REVIEW_DECISION_REQUIRED'
    ).toUpperCase();
    if (!Object.values(REVIEW_DECISIONS).includes(safeDecision)) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_DECISION_INVALID',
        'A decisao deve ser CONFIRMED_FRAUD ou FALSE_POSITIVE'
      );
    }
    if (explicitDecision !== true) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_EXPLICIT_DECISION_REQUIRED',
        'A conclusao exige confirmacao administrativa explicita'
      );
    }
    if (
      safeDecision === REVIEW_DECISIONS.CONFIRMED_FRAUD &&
      confirmPermanentBlock !== true
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_PERMANENT_BLOCK_CONFIRMATION_REQUIRED',
        'O bloqueio permanente exige confirmacao explicita separada'
      );
    }

    const firestore = this.firestore();
    const caseRef = this.caseRef(firestore, safeCaseId);
    const currentSnapshot = await caseRef.get();
    if (!currentSnapshot.exists) {
      throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
    }
    const preflightCase = currentSnapshot.data() || {};
    this.assertRecordScope(preflightCase);
    const safeTicketId = this.assertTicketLinked(preflightCase, ticketId);
    const safeEvidenceHash = this.assertEvidenceHash(preflightCase, evidenceBindingHash);
    const actor = await this.assertAuthorizedReviewer({
      reviewer,
      action: `DECIDE_${safeDecision}`,
      caseRecord: preflightCase
    });

    const executeDecision = () => this.persistDecision({
      firestore,
      caseRef,
      safeCaseId,
      safeTicketId,
      safeEvidenceHash,
      actor,
      safeReason,
      safeDecision
    });

    if (safeDecision === REVIEW_DECISIONS.CONFIRMED_FRAUD) {
      return this.runOutsideActiveTrip(
        preflightCase.driverId,
        'CONFIRM_PERMANENT_IDENTITY_FRAUD_BLOCK',
        executeDecision
      );
    }
    return executeDecision();
  }

  async persistDecision({
    firestore,
    caseRef,
    safeCaseId,
    safeTicketId,
    safeEvidenceHash,
    actor,
    safeReason,
    safeDecision
  }) {
    const now = this.nowDate();
    const nowIso = now.toISOString();
    const preflight = await caseRef.get();
    const preflightRecord = preflight.exists ? (preflight.data() || {}) : {};
    if (preflight.exists) this.assertRecordScope(preflightRecord);
    const enforcementRef = firestore.collection(this.collections.enforcement).doc(
      preflightRecord.driverId || 'missing-driver'
    );
    const retryRef = firestore.collection(this.collections.retryAuthorizations).doc(safeCaseId);

    return firestore.runTransaction(async (transaction) => {
      const [caseSnapshot, enforcementSnapshot, retrySnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(enforcementRef),
        transaction.get(retryRef)
      ]);
      if (!caseSnapshot.exists) {
        throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
      }
      const current = caseSnapshot.data() || {};
      this.assertRecordScope(current);
      if (enforcementSnapshot.exists) this.assertRecordScope(enforcementSnapshot.data() || {});
      if (retrySnapshot.exists) this.assertRecordScope(retrySnapshot.data() || {});
      this.assertTicketLinked(current, safeTicketId);
      this.assertEvidenceHash(current, safeEvidenceHash);

      const existingResolution = current.resolution || {};
      if (
        [safeDecision, CASE_STATUSES.CLOSED].includes(current.status) &&
        existingResolution.decision === safeDecision &&
        existingResolution.ticketId === safeTicketId &&
        existingResolution.evidenceBindingHash === safeEvidenceHash &&
        existingResolution.reason === safeReason
      ) {
        return {
          case: current,
          enforcement: enforcementSnapshot.exists ? enforcementSnapshot.data() : null,
          retryAuthorization: retrySnapshot.exists ? retrySnapshot.data() : null,
          idempotentReplay: true
        };
      }

      if (current.status !== CASE_STATUSES.UNDER_REVIEW) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_NOT_UNDER_REVIEW',
          'Uma unica divergencia nao pode gerar decisao automatica; o caso deve estar em analise'
        );
      }

      const revision = Number(current.revision || 0) + 1;
      const resolution = {
        decision: safeDecision,
        explicitAdminDecision: true,
        reviewer: actor,
        reason: safeReason,
        ticketId: safeTicketId,
        evidenceBindingHash: safeEvidenceHash,
        decidedAt: nowIso
      };
      const nextCase = {
        ...current,
        status: safeDecision,
        revision,
        resolution,
        updatedAt: nowIso
      };
      const auditAction = safeDecision === REVIEW_DECISIONS.CONFIRMED_FRAUD
        ? 'PERMANENT_FRAUD_BLOCK_CONFIRMED'
        : 'FALSE_POSITIVE_RETRY_AUTHORIZED';
      const auditRef = firestore.collection(this.collections.audit).doc(
        this.auditIdFor(safeCaseId, revision, auditAction)
      );

      let enforcement = enforcementSnapshot.exists
        ? (enforcementSnapshot.data() || {})
        : null;
      let retryAuthorization = retrySnapshot.exists
        ? (retrySnapshot.data() || {})
        : null;

      if (safeDecision === REVIEW_DECISIONS.CONFIRMED_FRAUD) {
        const previousEnforcement = enforcement || {};
        const projection = this.buildPermanentBlockProjection({
          caseRecord: current,
          ticketId: safeTicketId,
          reviewer: actor,
          reason: safeReason,
          decidedAt: nowIso
        });
        const corroboratingCaseIds = Array.isArray(previousEnforcement.corroboratingCaseIds)
          ? previousEnforcement.corroboratingCaseIds
          : [];
        enforcement = {
          ...this.persistenceEnvelope(current),
          schemaVersion: 1,
          driverId: current.driverId,
          status: 'PERMANENTLY_BLOCKED',
          active: true,
          permanent: true,
          reasonCode: 'CONFIRMED_IDENTITY_FRAUD',
          revision: Number(previousEnforcement.revision || 0) + 1,
          primaryCaseId: previousEnforcement.primaryCaseId || safeCaseId,
          corroboratingCaseIds: [...new Set([...corroboratingCaseIds, safeCaseId])],
          latestCaseId: safeCaseId,
          ticketId: safeTicketId,
          evidenceBindingHash: safeEvidenceHash,
          decidedBy: actor,
          decisionReason: safeReason,
          decidedAt: previousEnforcement.decidedAt || nowIso,
          updatedAt: nowIso,
          retryAllowed: false,
          identityApproved: false,
          activeTripPolicy: 'APPLY_ONLY_OUTSIDE_ACTIVE_TRIP',
          mirrorProjection: projection
        };
        transaction.set(enforcementRef, enforcement, { merge: false });
      } else {
        const previousEnforcement = enforcement || {};
        enforcement = {
          ...this.persistenceEnvelope(current),
          schemaVersion: 1,
          driverId: current.driverId,
          status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
          active: true,
          permanent: false,
          reasonCode: 'FALSE_POSITIVE_REVIEW',
          revision: Number(previousEnforcement.revision || 0) + 1,
          caseId: safeCaseId,
          latestCaseId: safeCaseId,
          ticketId: safeTicketId,
          evidenceBindingHash: safeEvidenceHash,
          retryAllowed: true,
          retryAttempts: 1,
          identityApproved: false,
          decidedBy: actor,
          decisionReason: safeReason,
          decidedAt: previousEnforcement.decidedAt || nowIso,
          updatedAt: nowIso
        };
        retryAuthorization = {
          ...this.persistenceEnvelope(current),
          schemaVersion: 1,
          authorizationId: safeCaseId,
          caseId: safeCaseId,
          driverId: current.driverId,
          ticketId: safeTicketId,
          status: 'AVAILABLE',
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 1,
          evidenceBindingHash: safeEvidenceHash,
          authorizedBy: actor,
          authorizedAt: nowIso,
          expiresAt: new Date(now.getTime() + this.retryAuthorizationTtlMs).toISOString(),
          consumedAt: null,
          resetSignal: {
            type: 'RESET_ONE_IDENTITY_VERIFICATION_ATTEMPT',
            resetAttemptBudget: true,
            clearMismatchSoftBlock: true,
            approveIdentity: false,
            alterDocumentApproval: false,
            allowedAttempts: 1
          },
          identityApproved: false
        };
        transaction.set(enforcementRef, enforcement, { merge: false });
        transaction.set(retryRef, retryAuthorization, { merge: false });
      }

      transaction.set(caseRef, nextCase, { merge: false });
      transaction.set(auditRef, this.buildAuditRecord({
        caseRecord: nextCase,
        action: auditAction,
        actor,
        reason: safeReason,
        ticketId: safeTicketId,
        revision,
        occurredAt: nowIso,
        details: {
          previousStatus: current.status,
          nextStatus: nextCase.status,
          severity: safeDecision === REVIEW_DECISIONS.CONFIRMED_FRAUD
            ? 'CRITICAL'
            : 'WARNING',
          metadata: {
            permanentBlock: safeDecision === REVIEW_DECISIONS.CONFIRMED_FRAUD,
            cleanRetryAttempts: safeDecision === REVIEW_DECISIONS.FALSE_POSITIVE ? 1 : 0,
            identityAutomaticallyApproved: false
          }
        }
      }), { merge: false });

      return {
        case: nextCase,
        enforcement,
        retryAuthorization,
        idempotentReplay: false
      };
    });
  }

  async getReviewEvidence({
    caseId,
    ticketId,
    reviewer,
    reason,
    evidenceBindingHash
  } = {}) {
    const safeCaseId = requiredString(caseId, 'caseId');
    const safeReason = requiredString(
      reason,
      'reason',
      'KYC_IDENTITY_REVIEW_REASON_REQUIRED'
    );
    const firestore = this.firestore();
    const caseRef = this.caseRef(firestore, safeCaseId);
    const snapshot = await caseRef.get();
    if (!snapshot.exists) {
      throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
    }
    const current = snapshot.data() || {};
    this.assertRecordScope(current);
    const safeTicketId = this.assertTicketLinked(current, ticketId);
    const safeEvidenceHash = this.assertEvidenceHash(current, evidenceBindingHash);
    const actor = await this.assertAuthorizedReviewer({
      reviewer,
      action: 'VIEW_REVIEW_EVIDENCE',
      caseRecord: current
    });
    const now = this.nowDate();
    const retainUntilMs = Date.parse(current.evidenceAccess?.retainUntil || '');
    if (
      current.evidenceAccess?.legalHold !== true &&
      Number.isFinite(retainUntilMs) &&
      now.getTime() >= retainUntilMs
    ) {
      throw domainError(
        'KYC_IDENTITY_REVIEW_EVIDENCE_EXPIRED',
        'A evidencia visual atingiu o prazo de retencao'
      );
    }
    const nowIso = now.toISOString();

    await firestore.runTransaction(async (transaction) => {
      const latestSnapshot = await transaction.get(caseRef);
      if (!latestSnapshot.exists) {
        throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
      }
      const latest = latestSnapshot.data() || {};
      this.assertRecordScope(latest);
      this.assertTicketLinked(latest, safeTicketId);
      this.assertEvidenceHash(latest, safeEvidenceHash);
      const revision = Number(latest.auditRevision || 0) + 1;
      const auditRef = firestore.collection(this.collections.audit).doc(
        `${safeCaseId}_evidence_access_${sha256(`${actor.uid}:${safeReason}:${nowIso}`).slice(0, 24)}`
      );
      transaction.set(caseRef, {
        auditRevision: revision,
        lastEvidenceAccessAt: nowIso,
        lastEvidenceAccessBy: actor
      }, { merge: true });
      transaction.set(auditRef, this.buildAuditRecord({
        caseRecord: latest,
        action: 'REVIEW_EVIDENCE_ACCESSED',
        actor,
        reason: safeReason,
        ticketId: safeTicketId,
        revision,
        occurredAt: nowIso,
        details: {
          previousStatus: latest.status,
          nextStatus: latest.status,
          severity: 'WARNING',
          metadata: { visualEvidenceAccessed: true }
        }
      }), { merge: false });
    });

    return {
      caseId: safeCaseId,
      driverId: current.driverId,
      ticketId: safeTicketId,
      evidenceBindingHash: safeEvidenceHash,
      evidenceBinding: current.evidenceBinding,
      accessClassification: current.evidenceAccess?.classification || 'RESTRICTED_KYC',
      publicUrlAllowed: false
    };
  }

  async closeCase({
    caseId,
    ticketId,
    reviewer,
    reason,
    evidenceBindingHash
  } = {}) {
    const safeCaseId = requiredString(caseId, 'caseId');
    const safeReason = requiredString(
      reason,
      'reason',
      'KYC_IDENTITY_REVIEW_REASON_REQUIRED'
    );
    const firestore = this.firestore();
    const caseRef = this.caseRef(firestore, safeCaseId);
    const snapshot = await caseRef.get();
    if (!snapshot.exists) {
      throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
    }
    const preflight = snapshot.data() || {};
    this.assertRecordScope(preflight);
    const safeTicketId = this.assertTicketLinked(preflight, ticketId);
    const safeEvidenceHash = this.assertEvidenceHash(preflight, evidenceBindingHash);
    const actor = await this.assertAuthorizedReviewer({
      reviewer,
      action: 'CLOSE_REVIEW_CASE',
      caseRecord: preflight
    });
    const nowIso = this.nowDate().toISOString();

    return firestore.runTransaction(async (transaction) => {
      const latestSnapshot = await transaction.get(caseRef);
      if (!latestSnapshot.exists) {
        throw domainError('KYC_IDENTITY_REVIEW_CASE_NOT_FOUND', 'Caso KYC nao encontrado');
      }
      const current = latestSnapshot.data() || {};
      this.assertRecordScope(current);
      this.assertTicketLinked(current, safeTicketId);
      this.assertEvidenceHash(current, safeEvidenceHash);
      if (current.status === CASE_STATUSES.CLOSED) {
        return { case: current, idempotentReplay: true };
      }
      if (![CASE_STATUSES.CONFIRMED_FRAUD, CASE_STATUSES.FALSE_POSITIVE].includes(current.status)) {
        throw domainError(
          'KYC_IDENTITY_REVIEW_TRANSITION_INVALID',
          'O caso so pode ser encerrado depois de uma decisao administrativa'
        );
      }
      const revision = Number(current.revision || 0) + 1;
      const next = {
        ...current,
        status: CASE_STATUSES.CLOSED,
        revision,
        closedAt: nowIso,
        closedBy: actor,
        closeReason: safeReason,
        updatedAt: nowIso
      };
      const auditRef = firestore.collection(this.collections.audit).doc(
        this.auditIdFor(safeCaseId, revision, 'CASE_CLOSED')
      );
      transaction.set(caseRef, next, { merge: false });
      transaction.set(auditRef, this.buildAuditRecord({
        caseRecord: next,
        action: 'CASE_CLOSED',
        actor,
        reason: safeReason,
        ticketId: safeTicketId,
        revision,
        occurredAt: nowIso,
        details: {
          previousStatus: current.status,
          nextStatus: CASE_STATUSES.CLOSED
        }
      }), { merge: false });
      return { case: next, idempotentReplay: false };
    });
  }
}

function createScopedKycIdentityReviewCaseService(persistenceContext, options = {}) {
  if (!persistenceContext || typeof persistenceContext !== 'object') {
    throw domainError(
      'KYC_IDENTITY_REVIEW_PERSISTENCE_CONTEXT_REQUIRED',
      'Contexto de persistencia obrigatorio para factory de revisao KYC'
    );
  }
  return new KycIdentityReviewCaseService({
    ...options,
    persistenceContext
  });
}

module.exports = {
  KycIdentityReviewCaseService,
  createScopedKycIdentityReviewCaseService,
  CASE_STATUSES,
  REVIEW_DECISIONS,
  DEFAULT_COLLECTIONS,
  normalizeEvidenceBinding,
  buildEvidenceBindingHash
};
