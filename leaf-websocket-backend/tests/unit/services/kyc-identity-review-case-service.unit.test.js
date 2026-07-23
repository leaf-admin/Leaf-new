const {
  KycIdentityReviewCaseService,
  CASE_STATUSES,
  REVIEW_DECISIONS,
  buildEvidenceBindingHash
} = require('../../../services/kyc-identity-review-case-service');

function createFakeFirestore() {
  const documents = new Map();

  const snapshotFor = (path) => ({
    exists: documents.has(path),
    data: () => documents.get(path)
  });

  const documentRef = (path) => ({
    path,
    get: jest.fn(async () => snapshotFor(path)),
    set: jest.fn(async (data, options = {}) => {
      const previous = documents.get(path) || {};
      documents.set(path, options.merge ? { ...previous, ...data } : data);
    })
  });

  const collectionRef = (path) => ({
    doc: (id) => documentRef(`${path}/${id}`)
  });

  return {
    documents,
    collection: (name) => collectionRef(name),
    runTransaction: jest.fn(async (handler) => {
      const writes = [];
      const transaction = {
        get: jest.fn(async (ref) => snapshotFor(ref.path)),
        set: jest.fn((ref, data, options = {}) => {
          writes.push({ ref, data, options });
        })
      };
      const result = await handler(transaction);
      writes.forEach(({ ref, data, options }) => {
        const previous = documents.get(ref.path) || {};
        documents.set(ref.path, options.merge ? { ...previous, ...data } : data);
      });
      return result;
    })
  };
}

function failedEvidence(overrides = {}) {
  return {
    evidenceId: 'evidence_failure_1',
    livenessSessionHash: 'session_hash_1',
    referenceSelfie: {
      bucket: 'leaf-private-kyc',
      storagePath: 'identity-review/driver_1/evidence_failure_1/selfie.jpg',
      sha256: 'selfie_sha_1',
      generation: '1710000000000',
      expiresAt: '2026-08-01T16:00:00.000Z'
    },
    approvedCnh: {
      documentId: 'cnh_submission_1',
      bucket: 'leaf-private-kyc',
      storagePath: 'driver-documents/driver_1/cnh/canonical.jpg',
      sha256: 'cnh_sha_1',
      approvalRevision: '4'
    },
    faceCompare: {
      provider: 'aws_rekognition_compare_faces',
      decision: 'reject',
      similarityScore: 0,
      threshold: 95,
      comparedAt: '2026-07-17T15:02:25.000Z'
    },
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const firestore = overrides.firestore || createFakeFirestore();
  let now = new Date('2026-07-17T16:00:00.000Z');
  const reviewerAuthorizer = overrides.reviewerAuthorizer || jest.fn(async () => true);
  const runOutsideActiveTrip = overrides.runOutsideActiveTrip || jest.fn(
    async (_driverId, _operation, work) => work()
  );
  const service = new KycIdentityReviewCaseService({
    firestoreProvider: () => firestore,
    reviewerAuthorizer,
    runOutsideActiveTrip,
    now: () => new Date(now),
    evidenceRetentionMs: 30 * 24 * 60 * 60 * 1000,
    retryAuthorizationTtlMs: 7 * 24 * 60 * 60 * 1000
  });

  return {
    service,
    firestore,
    reviewerAuthorizer,
    runOutsideActiveTrip,
    setNow(value) {
      now = new Date(value);
    }
  };
}

const reviewer = Object.freeze({
  uid: 'admin_kyc_1',
  email: 'reviewer@leaf.app.br'
});

async function openCase(harness, overrides = {}) {
  return harness.service.createOrLinkCase({
    driverId: 'driver_1',
    ticketId: 'ticket_1',
    evidenceBinding: failedEvidence(),
    requestedBy: { uid: 'driver_1', type: 'driver' },
    ...overrides
  });
}

async function startReview(harness, opened, overrides = {}) {
  return harness.service.startReview({
    caseId: opened.case.caseId,
    ticketId: 'ticket_1',
    reviewer,
    reason: 'Chamado validado e evidencias disponiveis para analise.',
    evidenceBindingHash: opened.case.evidenceBindingHash,
    ...overrides
  });
}

describe('KycIdentityReviewCaseService', () => {
  test('opens one restricted case from failed evidence without auto-blocking the driver', async () => {
    const harness = createHarness();

    const result = await openCase(harness);

    expect(result.idempotentReplay).toBe(false);
    expect(result.case).toEqual(expect.objectContaining({
      driverId: 'driver_1',
      ticketId: 'ticket_1',
      ticketIds: ['ticket_1'],
      status: CASE_STATUSES.OPEN,
      resolution: null
    }));
    expect(result.case.evidenceAccess).toEqual(expect.objectContaining({
      classification: 'RESTRICTED_KYC',
      failedAttemptsOnly: true,
      publicUrlAllowed: false,
      retainUntil: '2026-08-01T16:00:00.000Z'
    }));
    expect(harness.firestore.documents.has('driver_identity_enforcement/driver_1')).toBe(false);
    expect(harness.runOutsideActiveTrip).not.toHaveBeenCalled();
  });

  test('idempotently reuses the case and links a later support ticket to the same evidence', async () => {
    const harness = createHarness();
    const first = await openCase(harness);

    const replay = await openCase(harness);
    const linked = await openCase(harness, { ticketId: 'ticket_appeal_2' });

    expect(replay).toEqual(expect.objectContaining({
      idempotentReplay: true,
      ticketLinked: false
    }));
    expect(linked).toEqual(expect.objectContaining({
      idempotentReplay: false,
      ticketLinked: true
    }));
    expect(linked.case.caseId).toBe(first.case.caseId);
    expect(linked.case.ticketIds).toEqual(['ticket_1', 'ticket_appeal_2']);
  });

  test('refuses successful comparisons and public evidence URLs', async () => {
    const harness = createHarness();

    await expect(openCase(harness, {
      evidenceBinding: failedEvidence({
        faceCompare: {
          provider: 'aws_rekognition_compare_faces',
          decision: 'match',
          similarityScore: 99,
          threshold: 95,
          comparedAt: '2026-07-17T15:02:25.000Z'
        }
      })
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_FAILED_EVIDENCE_REQUIRED'
    });

    await expect(openCase(harness, {
      evidenceBinding: failedEvidence({
        referenceSelfie: {
          storagePath: 'https://public.example/selfie.jpg',
          sha256: 'selfie_sha_1'
        }
      })
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_PUBLIC_EVIDENCE_URL_FORBIDDEN'
    });
  });

  test('requires a support ticket, exact evidence binding and authorized reviewer', async () => {
    const unauthorized = jest.fn(async () => false);
    const harness = createHarness({ reviewerAuthorizer: unauthorized });
    const opened = await openCase(harness);

    await expect(harness.service.startReview({
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Analise solicitada pelo chamado.',
      evidenceBindingHash: opened.case.evidenceBindingHash
    })).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_ADMIN_REQUIRED' });

    const authorizedHarness = createHarness();
    const authorizedCase = await openCase(authorizedHarness);
    await expect(startReview(authorizedHarness, authorizedCase, {
      ticketId: 'ticket_not_linked'
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_TICKET_BINDING_INVALID'
    });
    await expect(startReview(authorizedHarness, authorizedCase, {
      evidenceBindingHash: 'different_pair'
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_EVIDENCE_BINDING_INVALID'
    });
    await expect(startReview(authorizedHarness, authorizedCase, {
      reason: '   '
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_REASON_REQUIRED'
    });
  });

  test('never turns one mismatch directly into confirmed fraud', async () => {
    const harness = createHarness();
    const opened = await openCase(harness);

    await expect(harness.service.decideCase({
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Comparacao visual confirmou pessoa diferente.',
      evidenceBindingHash: opened.case.evidenceBindingHash,
      decision: REVIEW_DECISIONS.CONFIRMED_FRAUD,
      explicitDecision: true,
      confirmPermanentBlock: true
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_NOT_UNDER_REVIEW'
    });

    expect(harness.firestore.documents.has('driver_identity_enforcement/driver_1')).toBe(false);
  });

  test('requires both an explicit decision and separate permanent-block confirmation', async () => {
    const harness = createHarness();
    const opened = await openCase(harness);
    await startReview(harness, opened);
    const base = {
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Selfie e CNH pertencem comprovadamente a pessoas distintas.',
      evidenceBindingHash: opened.case.evidenceBindingHash,
      decision: REVIEW_DECISIONS.CONFIRMED_FRAUD
    };

    await expect(harness.service.decideCase(base)).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_EXPLICIT_DECISION_REQUIRED'
    });
    await expect(harness.service.decideCase({
      ...base,
      explicitDecision: true
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_PERMANENT_BLOCK_CONFIRMATION_REQUIRED'
    });

    expect(harness.firestore.documents.has('driver_identity_enforcement/driver_1')).toBe(false);
  });

  test('confirms fraud only inside the active-trip safety guard and persists canonical block plus audit', async () => {
    const harness = createHarness();
    const opened = await openCase(harness);
    await startReview(harness, opened);

    const result = await harness.service.decideCase({
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Revisao lado a lado confirmou uso de documento de terceiro.',
      evidenceBindingHash: opened.case.evidenceBindingHash,
      decision: REVIEW_DECISIONS.CONFIRMED_FRAUD,
      explicitDecision: true,
      confirmPermanentBlock: true
    });

    expect(harness.runOutsideActiveTrip).toHaveBeenCalledWith(
      'driver_1',
      'CONFIRM_PERMANENT_IDENTITY_FRAUD_BLOCK',
      expect.any(Function)
    );
    expect(result.case.status).toBe(CASE_STATUSES.CONFIRMED_FRAUD);
    expect(result.enforcement).toEqual(expect.objectContaining({
      driverId: 'driver_1',
      status: 'PERMANENTLY_BLOCKED',
      active: true,
      permanent: true,
      reasonCode: 'CONFIRMED_IDENTITY_FRAUD',
      retryAllowed: false,
      identityApproved: false
    }));
    expect(result.enforcement.mirrorProjection).toEqual(expect.objectContaining({
      users: expect.objectContaining({
        accountStatus: 'blocked',
        kycBlocked: true,
        kycBlockedReason: 'confirmed_identity_fraud'
      }),
      redis: expect.objectContaining({
        status: 'OFFLINE',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK'
      }),
      geo: { removeFromEligibleDriverIndex: true }
    }));
    const audit = [...harness.firestore.documents.values()].find(
      (document) => document.action === 'PERMANENT_FRAUD_BLOCK_CONFIRMED'
    );
    expect(audit).toEqual(expect.objectContaining({
      actor: reviewer,
      ticketId: 'ticket_1',
      evidenceBindingHash: opened.case.evidenceBindingHash,
      severity: 'CRITICAL',
      immutable: true
    }));
  });

  test('fails closed when the active-trip policy window is unavailable', async () => {
    const runOutsideActiveTrip = jest.fn(async () => {
      const error = new Error('active trip index unavailable');
      error.code = 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE';
      throw error;
    });
    const harness = createHarness({ runOutsideActiveTrip });
    const opened = await openCase(harness);
    await startReview(harness, opened);

    await expect(harness.service.decideCase({
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Documento de terceiro confirmado em revisao.',
      evidenceBindingHash: opened.case.evidenceBindingHash,
      decision: REVIEW_DECISIONS.CONFIRMED_FRAUD,
      explicitDecision: true,
      confirmPermanentBlock: true
    })).rejects.toMatchObject({ code: 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE' });

    expect(harness.firestore.documents.has('driver_identity_enforcement/driver_1')).toBe(false);
  });

  test('false positive authorizes exactly one clean retry without approving identity or documents', async () => {
    const harness = createHarness();
    const opened = await openCase(harness);
    await startReview(harness, opened);
    const input = {
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Imagem degradada; divergencia nao confirmada na analise humana.',
      evidenceBindingHash: opened.case.evidenceBindingHash,
      decision: REVIEW_DECISIONS.FALSE_POSITIVE,
      explicitDecision: true
    };

    const result = await harness.service.decideCase(input);
    const replay = await harness.service.decideCase(input);

    expect(result.case.status).toBe(CASE_STATUSES.FALSE_POSITIVE);
    expect(result.enforcement).toEqual(expect.objectContaining({
      driverId: 'driver_1',
      status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
      active: true,
      permanent: false,
      caseId: opened.case.caseId,
      retryAllowed: true,
      retryAttempts: 1,
      identityApproved: false
    }));
    expect(result.retryAuthorization).toEqual(expect.objectContaining({
      driverId: 'driver_1',
      status: 'AVAILABLE',
      allowedAttempts: 1,
      remainingAttempts: 1,
      identityApproved: false,
      resetSignal: {
        type: 'RESET_ONE_IDENTITY_VERIFICATION_ATTEMPT',
        resetAttemptBudget: true,
        clearMismatchSoftBlock: true,
        approveIdentity: false,
        alterDocumentApproval: false,
        allowedAttempts: 1
      }
    }));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.retryAuthorization).toEqual(result.retryAuthorization);
    expect(replay.enforcement).toEqual(result.enforcement);
    expect(harness.firestore.documents.get('driver_identity_enforcement/driver_1'))
      .toEqual(result.enforcement);
    expect(harness.runOutsideActiveTrip).not.toHaveBeenCalled();
  });

  test('returns the bound selfie and CNH paths only to an audited authorized review', async () => {
    const harness = createHarness();
    const opened = await openCase(harness);
    await startReview(harness, opened);

    const result = await harness.service.getReviewEvidence({
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Analise visual solicitada no chamado ticket_1.',
      evidenceBindingHash: opened.case.evidenceBindingHash
    });

    expect(result).toEqual(expect.objectContaining({
      caseId: opened.case.caseId,
      driverId: 'driver_1',
      ticketId: 'ticket_1',
      accessClassification: 'RESTRICTED_KYC',
      publicUrlAllowed: false,
      evidenceBinding: expect.objectContaining({
        referenceSelfie: expect.objectContaining({
          storagePath: 'identity-review/driver_1/evidence_failure_1/selfie.jpg'
        }),
        approvedCnh: expect.objectContaining({
          documentId: 'cnh_submission_1'
        })
      })
    }));
    const audit = [...harness.firestore.documents.values()].find(
      (document) => document.action === 'REVIEW_EVIDENCE_ACCESSED'
    );
    expect(audit).toEqual(expect.objectContaining({
      actor: reviewer,
      ticketId: 'ticket_1',
      severity: 'WARNING',
      immutable: true
    }));
  });

  test('closes a decided case while preserving its fraud resolution and permanent block', async () => {
    const harness = createHarness();
    const opened = await openCase(harness);
    await startReview(harness, opened);
    await harness.service.decideCase({
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Fraude de identidade comprovada pelas evidencias vinculadas.',
      evidenceBindingHash: opened.case.evidenceBindingHash,
      decision: REVIEW_DECISIONS.CONFIRMED_FRAUD,
      explicitDecision: true,
      confirmPermanentBlock: true
    });

    const closed = await harness.service.closeCase({
      caseId: opened.case.caseId,
      ticketId: 'ticket_1',
      reviewer,
      reason: 'Tratativa administrativa concluida no chamado.',
      evidenceBindingHash: opened.case.evidenceBindingHash
    });

    expect(closed.case.status).toBe(CASE_STATUSES.CLOSED);
    expect(closed.case.resolution.decision).toBe(CASE_STATUSES.CONFIRMED_FRAUD);
    expect(harness.firestore.documents.get('driver_identity_enforcement/driver_1')).toEqual(
      expect.objectContaining({ status: 'PERMANENTLY_BLOCKED', permanent: true })
    );
  });

  test('uses a stable hash for the exact selfie/CNH evidence pair', () => {
    const first = buildEvidenceBindingHash(failedEvidence());
    const second = buildEvidenceBindingHash(failedEvidence());
    const changed = buildEvidenceBindingHash(failedEvidence({
      approvedCnh: {
        documentId: 'cnh_submission_2',
        storagePath: 'driver-documents/driver_1/cnh/other.jpg',
        sha256: 'other_cnh_sha'
      }
    }));

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });
});
