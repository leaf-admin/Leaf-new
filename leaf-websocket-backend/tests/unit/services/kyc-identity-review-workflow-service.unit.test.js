jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn()
}));
jest.mock('../../../utils/admin-user-cache', () => ({
  getAdminUser: jest.fn()
}));
jest.mock('../../../services/canonical-driver-document-approval-service', () => ({}));
jest.mock('../../../services/driver-identity-trust-service', () => ({}));
jest.mock('../../../services/kyc-failed-biometric-evidence-service', () => ({}));
jest.mock('../../../services/support-ticket-service', () => ({}));

const {
  KycIdentityReviewWorkflowService,
  createCaseService,
  createScopedKycIdentityReviewWorkflowService
} = require('../../../services/kyc-identity-review-workflow-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const {
  buildScopedPersistenceEnvelope
} = require('../../../services/sandbox-persistence-context');

const DRIVER_ID = 'driver_1';
const EVIDENCE_ID = 'evidence_1234567890';
const TICKET_ID = 'TICKET-1';
const CASE_ID = 'kyc_ir_case_1';
const RETRY_CASE_ID = `kyc_ir_${'d'.repeat(32)}`;
const RETRY_SCOPE = `manual_review_retry_${RETRY_CASE_ID}`;
const CNH_SHA = 'a'.repeat(64);
const SELFIE_SHA = 'b'.repeat(64);
const SESSION_SHA = 'c'.repeat(64);

function sandboxContext() {
  return sealFinancialContext({
    providerEnvironment: 'sandbox',
    paymentProfileId: 'qa-test-users-sandbox-durable',
    paymentProfileSource: 'firestore',
    testUserSandbox: true
  });
}

function createFirestore(initialDocuments = {}) {
  const documents = new Map(Object.entries(initialDocuments));

  function snapshot(path) {
    const value = documents.get(path);
    return {
      id: path.split('/').pop(),
      exists: value != null,
      data: () => value
    };
  }

  function querySnapshot(name, field, value, limitValue = null) {
    const docs = [];
    for (const [path, data] of documents.entries()) {
      if (!path.startsWith(`${name}/`) || path.slice(name.length + 1).includes('/')) continue;
      if (data?.[field] === value) docs.push(snapshot(path));
    }
    return { docs: limitValue == null ? docs : docs.slice(0, limitValue) };
  }

  function collection(name) {
    return {
      doc(id) {
        const path = `${name}/${id}`;
        return {
          id,
          path,
          async get() {
            return snapshot(path);
          },
          collection(childName) {
            return collection(`${path}/${childName}`);
          }
        };
      },
      where(field, operator, value) {
        expect(operator).toBe('==');
        const query = {
          __query: true,
          name,
          field,
          value,
          limitValue: null,
          limit(limitValue) {
            return { ...query, limitValue };
          },
          async get() {
            return querySnapshot(name, field, value, this.limitValue);
          }
        };
        return query;
      }
    };
  }

  async function runTransaction(callback) {
    return callback({
      async get(ref) {
        if (ref?.__query) {
          return querySnapshot(ref.name, ref.field, ref.value, ref.limitValue);
        }
        return snapshot(ref.path);
      },
      set(ref, payload, options = {}) {
        const current = documents.get(ref.path) || {};
        documents.set(ref.path, options.merge ? { ...current, ...payload } : payload);
      }
    });
  }

  return { collection, documents, runTransaction };
}

function evidenceRecord(overrides = {}) {
  return {
    evidenceId: EVIDENCE_ID,
    driverId: DRIVER_ID,
    state: 'available',
    objectPath: `restricted/kyc-failed-biometric-evidence/v1/${EVIDENCE_ID}.jpg`,
    storageGeneration: '123',
    contentType: 'image/jpeg',
    byteLength: 1200,
    referenceImageSha256: SELFIE_SHA,
    cnhSubmissionId: 'submission_1',
    cnhDocumentSha256: CNH_SHA,
    livenessSessionSha256: SESSION_SHA,
    compareProvider: 'aws_rekognition_compare_faces',
    decision: 'reject',
    similarityScore: 0.22,
    threshold: 0.95,
    ticketId: TICKET_ID,
    caseId: CASE_ID,
    reviewOutcome: null,
    permanentBlockRecommended: false,
    createdAt: new Date('2026-07-17T12:00:00.000Z'),
    expiresAt: new Date('2026-08-16T12:00:00.000Z'),
    ...overrides
  };
}

function canonicalCnh(overrides = {}) {
  return {
    driverId: DRIVER_ID,
    documentType: 'cnh',
    submissionId: 'submission_1',
    filePath: `driver-activation/${DRIVER_ID}/cnh/submission_1.pdf`,
    documentSha256: CNH_SHA,
    storageGeneration: '456',
    status: 'approved',
    analysisStatus: 'approved',
    approvalSource: 'dashboard_manual_review',
    reviewedAt: '2026-07-16T12:00:00.000Z',
    reviewedBy: 'admin_1',
    ...overrides
  };
}

function ticketRecord(overrides = {}) {
  return {
    id: TICKET_ID,
    userId: DRIVER_ID,
    userType: 'driver',
    subject: 'Revisao de identidade',
    category: 'account',
    priority: 'N2',
    status: 'open',
    financialNamespace: 'operational',
    metadata: {
      driverId: DRIVER_ID,
      kycEvidenceId: EVIDENCE_ID,
      source: 'kyc_identity_mismatch_appeal'
    },
    createdAt: '2026-07-17T12:05:00.000Z',
    updatedAt: '2026-07-17T12:05:00.000Z',
    ...overrides
  };
}

function caseRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    caseId: CASE_ID,
    driverId: DRIVER_ID,
    ticketId: TICKET_ID,
    ticketIds: [TICKET_ID],
    status: 'OPEN',
    revision: 1,
    evidenceBindingHash: 'binding-hash',
    evidenceBinding: {
      evidenceId: EVIDENCE_ID,
      livenessSessionHash: SESSION_SHA,
      referenceSelfie: {
        storagePath: `restricted/private/${EVIDENCE_ID}.jpg`,
        sha256: SELFIE_SHA,
        generation: '123'
      },
      approvedCnh: {
        documentId: 'submission_1',
        storagePath: `driver-activation/${DRIVER_ID}/cnh/submission_1.pdf`,
        sha256: CNH_SHA
      },
      faceCompare: {
        provider: 'aws_rekognition_compare_faces',
        decision: 'reject',
        similarityScore: 0.22,
        threshold: 0.95,
        comparedAt: '2026-07-17T12:00:00.000Z'
      }
    },
    evidenceAccess: {
      classification: 'RESTRICTED_KYC',
      retainUntil: '2026-08-16T12:00:00.000Z'
    },
    createdAt: '2026-07-17T12:05:00.000Z',
    updatedAt: '2026-07-17T12:05:00.000Z',
    ...overrides
  };
}

function createHarness({ firestoreDocuments = {}, evidence = evidenceRecord(), reviewCase = caseRecord() } = {}) {
  const firestore = createFirestore({
    [`kyc_identity_review_cases/${CASE_ID}`]: reviewCase,
    ...firestoreDocuments
  });
  const identityTrustService = {
    assertVerificationOutsideActiveTrip: jest.fn().mockResolvedValue({ allowed: true })
  };
  const evidenceService = {
    captureRejectedComparisonEvidence: jest.fn().mockResolvedValue(evidence),
    getMetadata: jest.fn().mockResolvedValue(evidence),
    linkTicket: jest.fn().mockResolvedValue({ ...evidence, ticketId: TICKET_ID, caseId: CASE_ID }),
    createReadAccess: jest.fn().mockResolvedValue({
      evidenceId: EVIDENCE_ID,
      signedUrl: 'https://signed.example/evidence',
      expiresAt: '2026-07-17T12:08:00.000Z',
      contentType: 'image/jpeg'
    })
  };
  const canonicalApprovalService = {
    requireApprovedCnh: jest.fn().mockResolvedValue(canonicalCnh())
  };
  const supportTicketService = {
    getTicket: jest.fn().mockResolvedValue(ticketRecord())
  };
  const caseService = {
    caseIdFor: jest.fn().mockReturnValue(CASE_ID),
    assertAuthorizedReviewer: jest.fn().mockResolvedValue({
      uid: 'admin_1',
      email: 'admin@leaf.app.br'
    }),
    createOrLinkCase: jest.fn().mockResolvedValue({
      case: reviewCase,
      idempotentReplay: false,
      ticketLinked: true
    }),
    getCase: jest.fn().mockResolvedValue(reviewCase),
    getReviewEvidence: jest.fn().mockResolvedValue({
      caseId: CASE_ID,
      driverId: DRIVER_ID,
      ticketId: TICKET_ID,
      evidenceBindingHash: 'binding-hash',
      evidenceBinding: reviewCase?.evidenceBinding || caseRecord().evidenceBinding,
      publicUrlAllowed: false
    })
  };
  const service = new KycIdentityReviewWorkflowService({
    firestoreProvider: () => firestore,
    identityTrustService,
    evidenceService,
    canonicalApprovalService,
    supportTicketService,
    caseServiceFactory: () => caseService
  });

  return {
    service,
    firestore,
    identityTrustService,
    evidenceService,
    canonicalApprovalService,
    supportTicketService,
    caseService
  };
}

const reviewerContext = {
  id: 'admin_1',
  email: 'admin@leaf.app.br',
  role: 'admin'
};

describe('kyc-identity-review-workflow-service', () => {
  describe('createCaseService', () => {
    it('autoriza somente revisor ativo com role, UID e email coincidentes', async () => {
      const adminUserProvider = jest.fn().mockResolvedValue({
        exists: true,
        data: {
          active: true,
          role: 'admin',
          email: 'ADMIN@leaf.app.br'
        }
      });
      const identityTrustService = {
        assertVerificationOutsideActiveTrip: jest.fn().mockResolvedValue({ allowed: true })
      };
      const callback = jest.fn().mockResolvedValue('ok');
      const service = createCaseService({
        reviewerContext,
        firestoreProvider: () => ({ runTransaction: jest.fn() }),
        adminUserProvider,
        identityTrustService
      });

      await expect(service.assertAuthorizedReviewer({
        reviewer: { uid: 'admin_1', email: 'admin@leaf.app.br' },
        action: 'VIEW_REVIEW_EVIDENCE',
        caseRecord: { caseId: CASE_ID }
      })).resolves.toEqual({ uid: 'admin_1', email: 'admin@leaf.app.br' });
      await expect(service.runOutsideActiveTrip(DRIVER_ID, 'DECIDE', callback)).resolves.toBe('ok');

      expect(adminUserProvider).toHaveBeenCalledWith('admin_1', expect.any(Object));
      expect(identityTrustService.assertVerificationOutsideActiveTrip).toHaveBeenCalledWith(DRIVER_ID);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['role sem privilegio', { ...reviewerContext, role: 'support' }, 'support', 'admin@leaf.app.br'],
      ['email divergente', reviewerContext, 'admin', 'other@leaf.app.br'],
      ['admin inativo', reviewerContext, 'admin', 'admin@leaf.app.br', false]
    ])('falha fechado para %s', async (_label, context, role, email, active = true) => {
      const service = createCaseService({
        reviewerContext: context,
        firestoreProvider: () => ({ runTransaction: jest.fn() }),
        adminUserProvider: jest.fn().mockResolvedValue({
          exists: true,
          data: { active, role, email }
        }),
        identityTrustService: {
          assertVerificationOutsideActiveTrip: jest.fn()
        }
      });

      await expect(service.assertAuthorizedReviewer({
        reviewer: { uid: 'admin_1', email: 'admin@leaf.app.br' },
        action: 'VIEW_REVIEW_EVIDENCE',
        caseRecord: {}
      })).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_ADMIN_REQUIRED' });
    });

    it('nao executa callback quando o guard aponta corrida ativa', async () => {
      const activeTripError = Object.assign(new Error('corrida ativa'), {
        code: 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP'
      });
      const callback = jest.fn();
      const service = createCaseService({
        reviewerContext,
        firestoreProvider: () => ({ runTransaction: jest.fn() }),
        adminUserProvider: jest.fn(),
        identityTrustService: {
          assertVerificationOutsideActiveTrip: jest.fn().mockRejectedValue(activeTripError)
        }
      });

      await expect(service.runOutsideActiveTrip(DRIVER_ID, 'DECIDE', callback))
        .rejects.toBe(activeTripError);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('scoped persistence', () => {
    const scopedDependencies = () => ({
      identityTrustService: {
        assertVerificationOutsideActiveTrip: jest.fn(),
        claimVerificationWindow: jest.fn(),
        releaseVerificationWindow: jest.fn(),
        readState: jest.fn()
      },
      evidenceService: {
        getMetadata: jest.fn(),
        captureRejectedComparisonEvidence: jest.fn()
      }
    });

    it('binds the workflow factory to sandbox resources and emits the sealed envelope', () => {
      const context = sandboxContext();
      const firestore = createFirestore();
      const service = createScopedKycIdentityReviewWorkflowService(context, {
        firestoreProvider: () => firestore,
        ...scopedDependencies()
      });

      expect(service).toMatchObject({
        caseCollection: 'sandbox_kyc_identity_review_cases',
        enforcementCollection: 'sandbox_driver_identity_enforcement',
        retryAuthorizationCollection: 'sandbox_kyc_identity_retry_authorizations',
        auditCollection: 'sandbox_kyc_identity_review_audit',
        identityTrustCollection: 'sandbox_driver_identity_trust',
        failedEvidenceCollection: 'sandbox_kyc_failed_biometric_evidence'
      });
      expect(service.persistenceEnvelope()).toMatchObject({
        financialContext: context,
        financialNamespace: 'sandbox',
        financialContextId: context.contextId,
        providerEnvironment: 'sandbox',
        paymentProfileId: 'qa-test-users-sandbox-durable',
        testUserSandbox: true
      });
      expect(() => createScopedKycIdentityReviewWorkflowService(null, {
        ...scopedDependencies()
      })).toThrow(expect.objectContaining({
        code: 'KYC_IDENTITY_REVIEW_PERSISTENCE_CONTEXT_REQUIRED'
      }));
      expect(() => createScopedKycIdentityReviewWorkflowService(context, {
        firestoreProvider: () => firestore,
        caseCollection: 'kyc_identity_review_cases',
        ...scopedDependencies()
      })).toThrow(expect.objectContaining({ code: 'KYC_PERSISTENCE_RESOURCE_MISMATCH' }));
    });

    it('fails closed on context-less direct reads from sandbox collections', async () => {
      const context = sandboxContext();
      const firestore = createFirestore({
        [`sandbox_driver_identity_enforcement/${DRIVER_ID}`]: {
          driverId: DRIVER_ID,
          active: true,
          status: 'ORPHAN_IDENTITY_HOLD'
        },
        [`sandbox_kyc_identity_review_cases/${CASE_ID}`]: caseRecord()
      });
      const service = createScopedKycIdentityReviewWorkflowService(context, {
        firestoreProvider: () => firestore,
        ...scopedDependencies()
      });

      await expect(service.getEnforcement(DRIVER_ID)).rejects.toMatchObject({
        code: 'SANDBOX_RECORD_CONTEXT_INVALID'
      });
      await expect(service.listCaseRecordsForDriver(DRIVER_ID)).rejects.toMatchObject({
        code: 'SANDBOX_RECORD_CONTEXT_INVALID'
      });
    });
  });

  it('captura somente depois do guard de corrida e nao devolve paths privados', async () => {
    const harness = createHarness({ firestoreDocuments: {} });
    const referenceImageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const comparison = { reference: { submissionId: 'submission_1' } };

    const result = await harness.service.captureFailure({
      driverId: DRIVER_ID,
      referenceImageBuffer,
      liveness: { livenessPassed: true },
      comparison
    });

    expect(harness.identityTrustService.assertVerificationOutsideActiveTrip).toHaveBeenCalledWith(DRIVER_ID);
    expect(harness.evidenceService.captureRejectedComparisonEvidence).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      referenceImageBuffer,
      liveness: { livenessPassed: true },
      comparison,
      cnh: comparison.reference
    });
    expect(JSON.stringify(result)).not.toContain('objectPath');
    expect(JSON.stringify(result)).not.toContain('storageGeneration');
  });

  it('abre caso somente com ticket, evidencia e CNH canonica do mesmo motorista', async () => {
    const unlinkedEvidence = evidenceRecord({ ticketId: null, caseId: null });
    const harness = createHarness({ evidence: unlinkedEvidence });

    const result = await harness.service.openCaseFromTicket({
      driverId: DRIVER_ID,
      evidenceId: EVIDENCE_ID,
      ticketId: TICKET_ID,
      requestedBy: { uid: DRIVER_ID, type: 'driver' }
    });

    expect(harness.caseService.createOrLinkCase).toHaveBeenCalledWith(expect.objectContaining({
      driverId: DRIVER_ID,
      ticketId: TICKET_ID,
      evidenceBinding: expect.objectContaining({
        evidenceId: EVIDENCE_ID,
        livenessSessionHash: SESSION_SHA,
        referenceSelfie: expect.objectContaining({ sha256: SELFIE_SHA }),
        approvedCnh: expect.objectContaining({
          documentId: 'submission_1',
          sha256: CNH_SHA
        })
      })
    }));
    expect(harness.evidenceService.linkTicket).toHaveBeenCalledWith(EVIDENCE_ID, {
      ticketId: TICKET_ID,
      caseId: CASE_ID,
      actorId: DRIVER_ID
    });
    expect(result.case.caseId).toBe(CASE_ID);
    expect(JSON.stringify(result)).not.toContain('restricted/');
    expect(JSON.stringify(result)).not.toContain('driver-activation/');
  });

  it('reconcilia ticket pendente somente com revisor KYC autorizado e auditavel', async () => {
    const unlinkedEvidence = evidenceRecord({ ticketId: null, caseId: null });
    const harness = createHarness({ evidence: unlinkedEvidence });

    const result = await harness.service.openCaseFromTicket({
      driverId: DRIVER_ID,
      evidenceId: EVIDENCE_ID,
      ticketId: TICKET_ID,
      requestedBy: { uid: DRIVER_ID, type: 'driver' },
      reconciledBy: reviewerContext
    });

    expect(harness.caseService.assertAuthorizedReviewer).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RECONCILE_IDENTITY_REVIEW_CASE',
      caseRecord: expect.objectContaining({
        driverId: DRIVER_ID,
        ticketId: TICKET_ID,
        evidenceId: EVIDENCE_ID
      })
    }));
    expect(harness.caseService.createOrLinkCase).toHaveBeenCalledWith(expect.objectContaining({
      requestedBy: {
        uid: 'admin_1',
        email: 'admin@leaf.app.br',
        type: 'admin_reconciliation'
      }
    }));
    expect(harness.evidenceService.linkTicket).toHaveBeenCalledWith(EVIDENCE_ID, {
      ticketId: TICKET_ID,
      caseId: CASE_ID,
      actorId: 'admin_1'
    });
    expect(result.case.caseId).toBe(CASE_ID);
  });

  it('recusa ticket sandbox ou sem binding explicito ao motorista/evidencia', async () => {
    const sandbox = createHarness();
    sandbox.supportTicketService.getTicket.mockResolvedValue(ticketRecord({
      financialNamespace: 'sandbox'
    }));
    await expect(sandbox.service.openCaseFromTicket({
      driverId: DRIVER_ID,
      evidenceId: EVIDENCE_ID,
      ticketId: TICKET_ID,
      requestedBy: { uid: DRIVER_ID }
    })).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_SANDBOX_TICKET_FORBIDDEN' });

    const wrongBinding = createHarness();
    wrongBinding.supportTicketService.getTicket.mockResolvedValue(ticketRecord({
      metadata: { driverId: 'other_driver', kycEvidenceId: EVIDENCE_ID }
    }));
    await expect(wrongBinding.service.openCaseFromTicket({
      driverId: DRIVER_ID,
      evidenceId: EVIDENCE_ID,
      ticketId: TICKET_ID,
      requestedBy: { uid: DRIVER_ID }
    })).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_TICKET_BINDING_INVALID' });
  });

  it('recusa caso se a CNH aprovada atual divergir da usada no CompareFaces', async () => {
    const harness = createHarness();
    harness.canonicalApprovalService.requireApprovedCnh.mockResolvedValue(canonicalCnh({
      documentSha256: 'd'.repeat(64)
    }));

    await expect(harness.service.openCaseFromTicket({
      driverId: DRIVER_ID,
      evidenceId: EVIDENCE_ID,
      ticketId: TICKET_ID,
      requestedBy: { uid: DRIVER_ID }
    })).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_CNH_BINDING_MISMATCH' });
    expect(harness.caseService.createOrLinkCase).not.toHaveBeenCalled();
  });

  it('recusa caseId divergente no ticket antes de criar qualquer caso', async () => {
    const harness = createHarness();
    harness.supportTicketService.getTicket.mockResolvedValue(ticketRecord({
      metadata: {
        driverId: DRIVER_ID,
        kycEvidenceId: EVIDENCE_ID,
        kycReviewCaseId: 'kyc_ir_outro_caso'
      }
    }));

    await expect(harness.service.openCaseFromTicket({
      driverId: DRIVER_ID,
      evidenceId: EVIDENCE_ID,
      ticketId: TICKET_ID,
      requestedBy: { uid: DRIVER_ID }
    })).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_CASE_BINDING_INVALID' });
    expect(harness.caseService.createOrLinkCase).not.toHaveBeenCalled();
  });

  it('bloqueia qualquer KYC no enforcement permanente e somente a troca de CNH durante hold', async () => {
    const permanentlyBlocked = createHarness({
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: true,
          status: 'PERMANENTLY_BLOCKED',
          latestCaseId: CASE_ID,
          ticketId: TICKET_ID
        }
      }
    });
    await expect(permanentlyBlocked.service.assertKycOperationAllowed(DRIVER_ID))
      .rejects.toMatchObject({ code: 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK' });

    const underReview = createHarness({
      reviewCase: caseRecord({ status: 'UNDER_REVIEW' })
    });
    await expect(underReview.service.assertKycOperationAllowed(DRIVER_ID))
      .resolves.toMatchObject({
        allowed: true,
        identityReviewHold: true,
        holdCaseId: CASE_ID,
        holdEvidenceId: EVIDENCE_ID,
        reviewAvailable: true
      });
    await expect(underReview.service.assertCnhUploadAllowed(DRIVER_ID))
      .rejects.toMatchObject({
        code: 'KYC_IDENTITY_REVIEW_HOLD',
        caseId: CASE_ID,
        ticketId: TICKET_ID
      });
  });

  it('recovers a traceable review from the canonical mismatch when the enforcement mirror is absent', async () => {
    const harness = createHarness({ reviewCase: null });
    harness.identityTrustService.readState = jest.fn().mockResolvedValue({
      driverId: DRIVER_ID,
      status: 'revoked',
      revocationReason: 'canonical_face_compare_failed',
      lastFailure: {
        reviewEvidenceId: EVIDENCE_ID,
        recordedAt: '2026-07-17T12:00:00.000Z'
      }
    });

    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID))
      .resolves.toMatchObject({
        identityReviewHold: true,
        holdCaseId: null,
        holdEvidenceId: EVIDENCE_ID,
        reviewAvailable: true
      });
  });

  it('never exposes canonical failure or retry evidence as reviewer-facing evidence', async () => {
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: false,
          status: 'IDENTITY_MISMATCH_HOLD',
          failureEvidenceId: 'canonical-failure-evidence',
          resultEvidenceId: 'retry-result-evidence'
        }
      }
    });

    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID))
      .resolves.toMatchObject({
        identityReviewHold: true,
        holdEvidenceId: null,
        reviewAvailable: false
      });
  });

  it('valida, reclama e consome uma unica autorizacao duravel de retry limpo', async () => {
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: false,
          status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
          caseId: RETRY_CASE_ID
        },
        [`kyc_identity_retry_authorizations/${RETRY_CASE_ID}`]: {
          authorizationId: RETRY_CASE_ID,
          caseId: RETRY_CASE_ID,
          driverId: DRIVER_ID,
          status: 'AVAILABLE',
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 1,
          expiresAt: '2099-01-01T00:00:00.000Z',
          identityApproved: false
        }
      }
    });

    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID)).resolves.toMatchObject({
      identityReviewHold: false,
      cleanRetryAuthorized: true,
      cnhReplacementHold: true
    });

    const claim = await harness.service.claimCleanRetryAuthorization(DRIVER_ID, RETRY_SCOPE);
    expect(claim).toMatchObject({ driverId: DRIVER_ID, caseId: RETRY_CASE_ID });
    expect(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${RETRY_CASE_ID}`
    )).toMatchObject({ status: 'CLAIMED', remainingAttempts: 0 });
    expect(JSON.stringify(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${RETRY_CASE_ID}`
    ))).not.toContain(claim.claimToken);

    await expect(harness.service.claimCleanRetryAuthorization(DRIVER_ID, RETRY_SCOPE))
      .rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_RETRY_NOT_AVAILABLE' });

    await harness.service.consumeCleanRetryAuthorization(claim, 'aws-session-123');
    const consumed = harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${RETRY_CASE_ID}`
    );
    expect(consumed).toMatchObject({ status: 'CONSUMED', remainingAttempts: 0 });
    expect(consumed.consumedSessionIdHash).toHaveLength(64);
    expect(JSON.stringify(consumed)).not.toContain('aws-session-123');
  });

  it('retoma a sessao persistida de um claim e repete o consume sem ampliar o TTL', async () => {
    const expiresAt = '2099-01-01T00:00:00.000Z';
    const sessionId = 'aws-session-persisted-retry';
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: false,
          status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
          caseId: RETRY_CASE_ID
        },
        [`kyc_identity_retry_authorizations/${RETRY_CASE_ID}`]: {
          authorizationId: RETRY_CASE_ID,
          caseId: RETRY_CASE_ID,
          driverId: DRIVER_ID,
          status: 'AVAILABLE',
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 1,
          expiresAt,
          identityApproved: false
        }
      }
    });

    await harness.service.claimCleanRetryAuthorization(DRIVER_ID, RETRY_SCOPE);
    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID))
      .resolves.toMatchObject({
        identityReviewHold: true,
        cleanRetryAuthorized: false,
        retrySessionResumeCandidate: true
      });

    await expect(harness.service.resumeCleanRetryAuthorization(
      DRIVER_ID,
      RETRY_SCOPE,
      sessionId
    )).resolves.toMatchObject({
      status: 'CONSUMED',
      idempotentReplay: false
    });
    const consumed = harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${RETRY_CASE_ID}`
    );
    expect(consumed).toMatchObject({
      status: 'CONSUMED',
      remainingAttempts: 0,
      expiresAt,
      claimTokenHash: null
    });
    expect(consumed.consumedSessionIdHash).toHaveLength(64);
    expect(JSON.stringify(consumed)).not.toContain(sessionId);

    const persistedAfterConsume = JSON.parse(JSON.stringify(consumed));
    await expect(harness.service.resumeCleanRetryAuthorization(
      DRIVER_ID,
      RETRY_SCOPE,
      sessionId
    )).resolves.toMatchObject({
      status: 'CONSUMED',
      idempotentReplay: true
    });
    expect(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${RETRY_CASE_ID}`
    )).toEqual(persistedAfterConsume);
    await expect(harness.service.resumeCleanRetryAuthorization(
      DRIVER_ID,
      RETRY_SCOPE,
      'aws-session-unrelated'
    )).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_RETRY_SESSION_BINDING_INVALID'
    });
  });

  it.each([
    ['expired CLAIMED authorization', {
      status: 'CLAIMED',
      claimTokenHash: 'a'.repeat(64),
      expiresAt: '2020-01-01T00:00:00.000Z'
    }],
    ['terminal authorization', {
      status: 'REJECTED',
      consumedSessionIdHash: 'b'.repeat(64),
      expiresAt: '2099-01-01T00:00:00.000Z'
    }],
    ['CLAIMED authorization without its original claim binding', {
      status: 'CLAIMED',
      claimTokenHash: null,
      expiresAt: '2099-01-01T00:00:00.000Z'
    }]
  ])('refuses resume for %s', async (_label, authorizationOverrides) => {
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: false,
          status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
          caseId: RETRY_CASE_ID
        },
        [`kyc_identity_retry_authorizations/${RETRY_CASE_ID}`]: {
          authorizationId: RETRY_CASE_ID,
          caseId: RETRY_CASE_ID,
          driverId: DRIVER_ID,
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 0,
          identityApproved: false,
          ...authorizationOverrides
        }
      }
    });

    await expect(harness.service.resumeCleanRetryAuthorization(
      DRIVER_ID,
      RETRY_SCOPE,
      'aws-session-persisted-retry'
    )).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_RETRY_RESUME_NOT_AVAILABLE'
    });
  });

  it('refuses resume for another driver or authorization scope', async () => {
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: false,
          status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
          caseId: RETRY_CASE_ID
        },
        [`kyc_identity_retry_authorizations/${RETRY_CASE_ID}`]: {
          authorizationId: RETRY_CASE_ID,
          caseId: RETRY_CASE_ID,
          driverId: DRIVER_ID,
          status: 'CLAIMED',
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 0,
          claimTokenHash: 'a'.repeat(64),
          expiresAt: '2099-01-01T00:00:00.000Z',
          identityApproved: false
        }
      }
    });

    await expect(harness.service.resumeCleanRetryAuthorization(
      'driver_2',
      RETRY_SCOPE,
      'aws-session-persisted-retry'
    )).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID'
    });
    await expect(harness.service.resumeCleanRetryAuthorization(
      DRIVER_ID,
      `manual_review_retry_kyc_ir_${'e'.repeat(32)}`,
      'aws-session-persisted-retry'
    )).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID'
    });
  });

  it('libera o credito duravel somente quando nenhum dispatch de sessao ocorreu', async () => {
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: false,
          status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
          caseId: RETRY_CASE_ID
        },
        [`kyc_identity_retry_authorizations/${RETRY_CASE_ID}`]: {
          authorizationId: RETRY_CASE_ID,
          caseId: RETRY_CASE_ID,
          driverId: DRIVER_ID,
          status: 'AVAILABLE',
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 1,
          expiresAt: '2099-01-01T00:00:00.000Z',
          identityApproved: false
        }
      }
    });

    const claim = await harness.service.claimCleanRetryAuthorization(DRIVER_ID, RETRY_SCOPE);
    await expect(harness.service.releaseCleanRetryAuthorization(claim, {
      reason: 'provider_not_dispatched'
    })).resolves.toMatchObject({ released: true, caseId: RETRY_CASE_ID });
    expect(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${RETRY_CASE_ID}`
    )).toMatchObject({
      status: 'AVAILABLE',
      remainingAttempts: 1,
      lastReleaseReason: 'provider_not_dispatched'
    });
  });

  it('recusa o claim se um bloqueio permanente vencer a corrida entre o gate e a AWS', async () => {
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: true,
          status: 'PERMANENTLY_BLOCKED',
          latestCaseId: RETRY_CASE_ID,
          caseId: RETRY_CASE_ID
        },
        [`kyc_identity_retry_authorizations/${RETRY_CASE_ID}`]: {
          authorizationId: RETRY_CASE_ID,
          caseId: RETRY_CASE_ID,
          driverId: DRIVER_ID,
          status: 'AVAILABLE',
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 1,
          expiresAt: '2099-01-01T00:00:00.000Z',
          identityApproved: false
        }
      }
    });

    await expect(harness.service.claimCleanRetryAuthorization(DRIVER_ID, RETRY_SCOPE))
      .rejects.toMatchObject({ code: 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK' });
    expect(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${RETRY_CASE_ID}`
    )).toMatchObject({ status: 'AVAILABLE', remainingAttempts: 1 });
  });

  it('mantem hold e bloqueia troca de CNH quando o retry duravel expirou', async () => {
    const harness = createHarness({
      reviewCase: null,
      firestoreDocuments: {
        [`driver_identity_enforcement/${DRIVER_ID}`]: {
          active: true,
          permanent: false,
          status: 'FALSE_POSITIVE_RETRY_AUTHORIZED',
          caseId: RETRY_CASE_ID
        },
        [`kyc_identity_retry_authorizations/${RETRY_CASE_ID}`]: {
          caseId: RETRY_CASE_ID,
          driverId: DRIVER_ID,
          status: 'AVAILABLE',
          purpose: 'FALSE_POSITIVE_ONE_CLEAN_IDENTITY_RETRY',
          allowedAttempts: 1,
          remainingAttempts: 1,
          expiresAt: '2020-01-01T00:00:00.000Z',
          identityApproved: false
        }
      }
    });

    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID)).resolves.toMatchObject({
      identityReviewHold: true,
      cleanRetryAuthorized: false,
      cnhReplacementHold: true
    });
    await expect(harness.service.assertCnhUploadAllowed(DRIVER_ID))
      .rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_HOLD' });
  });

  it('lista casos para revisor autorizado sem expor paths de Storage', async () => {
    const harness = createHarness();
    const cases = await harness.service.listCasesForDriver(DRIVER_ID, { reviewerContext });

    expect(harness.caseService.assertAuthorizedReviewer).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LIST_IDENTITY_REVIEW_CASES'
    }));
    expect(cases).toHaveLength(1);
    expect(JSON.stringify(cases)).not.toContain('storagePath');
    expect(JSON.stringify(cases)).not.toContain('restricted/private');
  });

  it('audita contexto antes de conceder URL curta pela evidence service', async () => {
    const harness = createHarness();

    const context = await harness.service.getReviewContext({
      driverId: DRIVER_ID,
      caseId: CASE_ID,
      ticketId: TICKET_ID,
      reviewerContext,
      reason: 'Analise do chamado de divergencia facial'
    });
    expect(harness.caseService.getReviewEvidence).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      ticketId: TICKET_ID,
      reason: 'Analise do chamado de divergencia facial',
      evidenceBindingHash: 'binding-hash'
    }));
    expect(JSON.stringify(context)).not.toContain('signedUrl');
    expect(JSON.stringify(context)).not.toContain('storagePath');
    expect(context.publicUrlAllowed).toBe(false);

    const access = await harness.service.grantEvidenceReadAccess({
      driverId: DRIVER_ID,
      caseId: CASE_ID,
      ticketId: TICKET_ID,
      reviewerContext,
      reason: 'Comparacao visual para concluir chamado',
      ttlSeconds: 120
    });
    expect(harness.caseService.getReviewEvidence).toHaveBeenCalledTimes(2);
    expect(harness.evidenceService.createReadAccess).toHaveBeenCalledWith(EVIDENCE_ID, {
      actorId: 'admin_1',
      ticketId: TICKET_ID,
      reason: 'Comparacao visual para concluir chamado',
      ttlSeconds: 120
    });
    expect(access).toEqual({
      evidenceId: EVIDENCE_ID,
      signedUrl: 'https://signed.example/evidence',
      expiresAt: '2026-07-17T12:08:00.000Z',
      contentType: 'image/jpeg'
    });
  });
});

describe('kyc-identity-review-workflow-service orphan hold recovery', () => {
  const REVOKED_AT = '2026-07-17T12:00:00.000Z';
  const FAILURE_EVIDENCE_ID = 'canonical_failure_evidence_1';
  const STATE_REVISION = 7;
  const CNH_SUBMISSION_ID = 'cnh_submission_canonical_1';
  const CNH_DOCUMENT_SHA256 = 'e'.repeat(64);
  const AWS_SESSION_ID = 'aws-session-orphan-recovery-1';

  function trustState(overrides = {}) {
    return {
      schemaVersion: 1,
      driverId: DRIVER_ID,
      stateRevision: STATE_REVISION,
      status: 'revoked',
      revocationReason: 'canonical_face_compare_failed',
      revokedAt: REVOKED_AT,
      lastFailure: {
        decision: 'reject',
        similarityScore: 0,
        recordedAt: REVOKED_AT
      },
      updatedAt: REVOKED_AT,
      ...overrides
    };
  }

  function canonicalFailureEvidence(overrides = {}) {
    return {
      schemaVersion: 1,
      evidenceId: FAILURE_EVIDENCE_ID,
      driverId: DRIVER_ID,
      terminalOutcome: 'face_compare_failed',
      referenceImageSha256: 'f'.repeat(64),
      recordedAt: REVOKED_AT,
      ...overrides
    };
  }

  function createOrphanHarness({
    trust = trustState(),
    failureEvidence = canonicalFailureEvidence(),
    extraDocuments = {},
    canonicalCnh = {
      submissionId: CNH_SUBMISSION_ID,
      documentSha256: CNH_DOCUMENT_SHA256,
      status: 'approved'
    },
    verificationWindowClaim = { acquired: true, key: 'window-key', token: 'window-token' },
    persistenceContext = null
  } = {}) {
    const scopedEnvelope = persistenceContext
      ? buildScopedPersistenceEnvelope(persistenceContext)
      : null;
    const scopeRecord = (record) => (record && scopedEnvelope
      ? { ...record, ...scopedEnvelope }
      : record);
    const collections = persistenceContext
      ? {
        trust: 'sandbox_driver_identity_trust',
        cases: 'sandbox_kyc_identity_review_cases',
        enforcement: 'sandbox_driver_identity_enforcement',
        retries: 'sandbox_kyc_identity_retry_authorizations',
        audit: 'sandbox_kyc_identity_review_audit',
        failedEvidence: 'sandbox_kyc_failed_biometric_evidence'
      }
      : {
        trust: 'driver_identity_trust',
        cases: 'kyc_identity_review_cases',
        enforcement: 'driver_identity_enforcement',
        retries: 'kyc_identity_retry_authorizations',
        audit: 'kyc_identity_review_audit',
        failedEvidence: 'kyc_failed_biometric_evidence'
      };
    const initialDocuments = {
      ...(trust ? { [`${collections.trust}/${DRIVER_ID}`]: scopeRecord(trust) } : {}),
      ...(failureEvidence ? {
        [`${collections.trust}/${DRIVER_ID}/evidence/${FAILURE_EVIDENCE_ID}`]:
          scopeRecord(failureEvidence)
      } : {}),
      ...extraDocuments
    };
    const firestore = createFirestore(initialDocuments);
    const canonicalApprovalService = {
      requireApprovedCnh: jest.fn().mockResolvedValue(canonicalCnh)
    };
    const identityTrustService = {
      assertVerificationOutsideActiveTrip: jest.fn().mockResolvedValue({ allowed: true }),
      claimVerificationWindow: jest.fn().mockImplementation(async () => verificationWindowClaim),
      releaseVerificationWindow: jest.fn().mockResolvedValue(true),
      readState: jest.fn().mockImplementation(async () => (
        firestore.documents.get(`${collections.trust}/${DRIVER_ID}`) || null
      ))
    };
    const evidenceService = {
      getMetadata: jest.fn(),
      captureRejectedComparisonEvidence: jest.fn()
    };
    const caseService = {
      assertAuthorizedReviewer: jest.fn().mockResolvedValue({
        uid: 'admin_1',
        email: 'admin@leaf.app.br'
      })
    };
    let now = new Date('2026-07-17T12:10:00.000Z');
    const service = new KycIdentityReviewWorkflowService({
      firestoreProvider: () => firestore,
      identityTrustService,
      evidenceService,
      canonicalApprovalService,
      caseServiceFactory: () => caseService,
      now: () => new Date(now),
      orphanRecoveryTtlMs: 30 * 60 * 1000,
      ...(persistenceContext ? { persistenceContext } : {})
    });

    return {
      service,
      firestore,
      identityTrustService,
      evidenceService,
      canonicalApprovalService,
      caseService,
      collections,
      scopedEnvelope,
      scopeRecord,
      setNow(value) {
        now = new Date(value);
      }
    };
  }

  async function authorize(harness, overrides = {}) {
    return harness.service.authorizeOrphanHoldRecovery({
      driverId: DRIVER_ID,
      failureEvidenceId: FAILURE_EVIDENCE_ID,
      expectedStateRevision: STATE_REVISION,
      expectedRevokedAt: REVOKED_AT,
      reviewerContext,
      reason: 'Recuperacao operacional de hold legado sem artefatos de revisao.',
      ...overrides
    });
  }

  test('projects only the exact reviewer-authorized orphan recovery binding', async () => {
    const harness = createOrphanHarness();

    await expect(harness.service.getOrphanHoldRecoveryCandidate(
      DRIVER_ID,
      { reviewerContext }
    )).resolves.toEqual({
      available: true,
      status: 'ready',
      failureEvidenceId: FAILURE_EVIDENCE_ID,
      expectedStateRevision: STATE_REVISION,
      expectedRevokedAt: REVOKED_AT
    });

    expect(harness.caseService.assertAuthorizedReviewer).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_ORPHAN_IDENTITY_HOLD_RECOVERY'
      })
    );
    expect(harness.identityTrustService.readState).toHaveBeenCalledWith(
      DRIVER_ID,
      { bypassCache: true }
    );
  });

  test.each([
    [
      'caso de revisao existente',
      { extraDocuments: { 'kyc_identity_review_cases/existing': { driverId: DRIVER_ID } } }
    ],
    [
      'evidencia privada existente',
      { extraDocuments: { 'kyc_failed_biometric_evidence/existing': { driverId: DRIVER_ID } } }
    ],
    [
      'enforcement existente',
      { extraDocuments: { [`driver_identity_enforcement/${DRIVER_ID}`]: { active: true } } }
    ]
  ])('does not offer recovery when %s', async (_label, options) => {
    const harness = createOrphanHarness(options);

    await expect(harness.service.getOrphanHoldRecoveryCandidate(
      DRIVER_ID,
      { reviewerContext }
    )).resolves.toBeNull();
  });

  test('scopes every direct recovery write and preserves the envelope through updates', async () => {
    const context = sandboxContext();
    const harness = createOrphanHarness({ persistenceContext: context });
    const authorized = await authorize(harness);
    const claim = await harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    );
    await harness.service.releaseCleanRetryAuthorization(claim, {
      reason: 'sandbox_session_setup_failed'
    });
    const secondClaim = await harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    );
    await harness.service.consumeCleanRetryAuthorization(secondClaim, AWS_SESSION_ID);
    await harness.service.finalizeCleanRetryAuthorization({
      driverId: DRIVER_ID,
      attemptScope: authorized.attemptScope,
      sessionId: AWS_SESSION_ID,
      outcome: 'ABORTED',
      reason: 'Usuario encerrou a sessao sandbox antes da conclusao.'
    });
    await harness.service.clearResolvedMismatchHold(DRIVER_ID);

    const writtenRecords = [...harness.firestore.documents.entries()]
      .filter(([path]) => [
        `${harness.collections.retries}/`,
        `${harness.collections.enforcement}/`,
        `${harness.collections.audit}/`
      ].some((prefix) => path.startsWith(prefix)))
      .map(([, record]) => record);
    expect(writtenRecords.length).toBeGreaterThanOrEqual(4);
    for (const record of writtenRecords) {
      expect(record).toMatchObject(harness.scopedEnvelope);
    }

    const compensatedHarness = createOrphanHarness({ persistenceContext: context });
    const compensatedAuthorization = await authorize(compensatedHarness);
    await compensatedHarness.service.abortOrphanHoldRecoverySetup({
      driverId: DRIVER_ID,
      recoveryId: compensatedAuthorization.recoveryId,
      reason: 'Falha ao persistir challenge sandbox depois da autorizacao.'
    });
    for (const [path, record] of compensatedHarness.firestore.documents.entries()) {
      if (
        path.startsWith(`${compensatedHarness.collections.retries}/`)
        || path.startsWith(`${compensatedHarness.collections.enforcement}/`)
        || path.startsWith(`${compensatedHarness.collections.audit}/`)
      ) {
        expect(record).toMatchObject(compensatedHarness.scopedEnvelope);
      }
    }
  });

  test('fails closed before mutation when a direct sandbox transaction read loses scope', async () => {
    const context = sandboxContext();
    const trustHarness = createOrphanHarness({ persistenceContext: context });
    trustHarness.firestore.documents.set(
      `${trustHarness.collections.trust}/${DRIVER_ID}`,
      trustState()
    );

    await expect(authorize(trustHarness)).rejects.toMatchObject({
      code: 'SANDBOX_RECORD_CONTEXT_INVALID'
    });
    expect([...trustHarness.firestore.documents.keys()].some(
      (path) => path.startsWith(`${trustHarness.collections.retries}/`)
    )).toBe(false);

    const authorizationHarness = createOrphanHarness({ persistenceContext: context });
    const authorized = await authorize(authorizationHarness);
    const authorizationPath =
      `${authorizationHarness.collections.retries}/${authorized.recoveryId}`;
    const unscopedAuthorization = {
      ...authorizationHarness.firestore.documents.get(authorizationPath)
    };
    delete unscopedAuthorization.financialContext;
    delete unscopedAuthorization.financialNamespace;
    delete unscopedAuthorization.financialContextId;
    delete unscopedAuthorization.providerEnvironment;
    delete unscopedAuthorization.paymentProfileId;
    delete unscopedAuthorization.testUserSandbox;
    authorizationHarness.firestore.documents.set(authorizationPath, unscopedAuthorization);

    await expect(authorizationHarness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    )).rejects.toMatchObject({ code: 'SANDBOX_RECORD_CONTEXT_INVALID' });
    expect(authorizationHarness.firestore.documents.get(authorizationPath)).toMatchObject({
      status: 'AVAILABLE',
      remainingAttempts: 1
    });
  });

  test('authorizes one TTL-bound retry without mutating trust and keeps CNH replacement held', async () => {
    const harness = createOrphanHarness();
    const originalTrust = structuredClone(
      harness.firestore.documents.get(`driver_identity_trust/${DRIVER_ID}`)
    );
    const originalFailure = structuredClone(harness.firestore.documents.get(
      `driver_identity_trust/${DRIVER_ID}/evidence/${FAILURE_EVIDENCE_ID}`
    ));

    const result = await authorize(harness);
    const authorization = harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${result.recoveryId}`
    );

    expect(result).toEqual(expect.objectContaining({
      attemptScope: `orphan_hold_retry_${result.recoveryId}`,
      enforcementStatus: 'ORPHAN_HOLD_RETRY_AUTHORIZED',
      idempotentReplay: false
    }));
    expect(result.authorization).toEqual(expect.objectContaining({
      status: 'AVAILABLE',
      allowedAttempts: 1,
      remainingAttempts: 1,
      identityApproved: false,
      expiresAt: '2026-07-17T12:40:00.000Z'
    }));
    expect(JSON.stringify(result)).not.toContain(CNH_DOCUMENT_SHA256);
    expect(JSON.stringify(result)).not.toContain('failureEvidenceBindingHash');
    expect(authorization).toEqual(expect.objectContaining({
      purpose: 'ORPHAN_HOLD_ONE_CLEAN_IDENTITY_RETRY',
      sourceTrust: expect.objectContaining({
        stateRevision: STATE_REVISION,
        failureEvidenceId: FAILURE_EVIDENCE_ID
      }),
      sourceCnh: {
        submissionId: CNH_SUBMISSION_ID,
        documentSha256: CNH_DOCUMENT_SHA256
      }
    }));
    expect(harness.firestore.documents.get(`driver_identity_trust/${DRIVER_ID}`))
      .toEqual(originalTrust);
    expect(harness.firestore.documents.get(
      `driver_identity_trust/${DRIVER_ID}/evidence/${FAILURE_EVIDENCE_ID}`
    )).toEqual(originalFailure);
    expect(harness.identityTrustService.claimVerificationWindow).toHaveBeenCalledWith(
      DRIVER_ID,
      { scope: 'orphan_hold_recovery_authorization' }
    );
    expect(harness.identityTrustService.releaseVerificationWindow).toHaveBeenCalledTimes(1);

    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID)).resolves.toMatchObject({
      identityReviewHold: false,
      cleanRetryAuthorized: true,
      sessionBoundRetryAuthorized: false,
      cnhReplacementHold: true,
      retryAuthorizationKind: 'orphan_hold'
    });
    await expect(harness.service.assertCnhUploadAllowed(DRIVER_ID))
      .rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_HOLD' });
  });

  test.each([
    ['trust ausente', { trust: null }, 'KYC_ORPHAN_HOLD_RECOVERY_TRUST_NOT_FOUND'],
    [
      'trust nao revogado',
      { trust: trustState({ status: 'active' }) },
      'KYC_ORPHAN_HOLD_RECOVERY_TRUST_CONFLICT'
    ],
    [
      'razao divergente',
      { trust: trustState({ revocationReason: 'identity_reverification_failed' }) },
      'KYC_ORPHAN_HOLD_RECOVERY_TRUST_CONFLICT'
    ],
    [
      'evidencia canonica ausente',
      { failureEvidence: null },
      'KYC_ORPHAN_HOLD_RECOVERY_FAILURE_EVIDENCE_NOT_FOUND'
    ],
    [
      'caso normal existente',
      { extraDocuments: { [`kyc_identity_review_cases/existing_case`]: { driverId: DRIVER_ID } } },
      'KYC_ORPHAN_HOLD_RECOVERY_CASE_EXISTS'
    ],
    [
      'evidencia privada existente',
      { extraDocuments: { [`kyc_failed_biometric_evidence/existing`]: { driverId: DRIVER_ID } } },
      'KYC_ORPHAN_HOLD_RECOVERY_PRIVATE_EVIDENCE_EXISTS'
    ],
    [
      'enforcement existente',
      { extraDocuments: { [`driver_identity_enforcement/${DRIVER_ID}`]: { active: true } } },
      'KYC_ORPHAN_HOLD_RECOVERY_ENFORCEMENT_EXISTS'
    ]
  ])('fails closed when %s', async (_label, options, expectedCode) => {
    const harness = createOrphanHarness(options);
    await expect(authorize(harness)).rejects.toMatchObject({ code: expectedCode });
    expect([...harness.firestore.documents.keys()].some(
      (key) => key.startsWith('kyc_identity_retry_authorizations/')
    )).toBe(false);
  });

  test('fails closed when the atomic active-trip window cannot be acquired', async () => {
    const harness = createOrphanHarness({
      verificationWindowClaim: { acquired: false, busy: true }
    });

    await expect(authorize(harness)).rejects.toMatchObject({
      code: 'KYC_VERIFICATION_IN_PROGRESS'
    });
    expect(harness.canonicalApprovalService.requireApprovedCnh).not.toHaveBeenCalled();
    expect([...harness.firestore.documents.keys()].some(
      (key) => key.startsWith('kyc_identity_retry_authorizations/')
    )).toBe(false);
  });

  test('requires an approved canonical CNH binding before creating any recovery credit', async () => {
    const harness = createOrphanHarness({
      canonicalCnh: {
        submissionId: CNH_SUBMISSION_ID,
        documentSha256: 'not-a-sha256',
        status: 'approved'
      }
    });

    await expect(authorize(harness)).rejects.toMatchObject({
      code: 'KYC_ORPHAN_HOLD_RECOVERY_CNH_BINDING_INVALID'
    });
    expect([...harness.firestore.documents.keys()].some(
      (key) => key.startsWith('kyc_identity_retry_authorizations/')
    )).toBe(false);
  });

  test('claims once, revalidates CNH, consumes once, and only the bound session crosses the hold', async () => {
    const harness = createOrphanHarness();
    const authorized = await authorize(harness);
    const claim = await harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    );

    expect(claim).toEqual(expect.objectContaining({
      recoveryId: authorized.recoveryId,
      authorizationId: authorized.recoveryId,
      kind: 'orphan_hold'
    }));
    await expect(harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    )).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_RETRY_NOT_AVAILABLE' });

    await harness.service.consumeCleanRetryAuthorization(claim, AWS_SESSION_ID);
    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID)).resolves.toMatchObject({
      identityReviewHold: true,
      sessionBoundRetryAuthorized: false,
      cnhReplacementHold: true
    });
    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID, {
      attemptScope: authorized.attemptScope,
      awsSessionId: 'another-session'
    })).resolves.toMatchObject({
      identityReviewHold: true,
      sessionBoundRetryAuthorized: false
    });
    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID, {
      attemptScope: authorized.attemptScope,
      awsSessionId: AWS_SESSION_ID
    })).resolves.toMatchObject({
      identityReviewHold: false,
      cleanRetryAuthorized: false,
      sessionBoundRetryAuthorized: true,
      cnhReplacementHold: true
    });
  });

  test('refuses claim when the canonical CNH changed after authorization', async () => {
    const harness = createOrphanHarness();
    const authorized = await authorize(harness);
    harness.canonicalApprovalService.requireApprovedCnh.mockResolvedValueOnce({
      submissionId: 'new_cnh_submission',
      documentSha256: 'a'.repeat(64),
      status: 'approved'
    });

    await expect(harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    )).rejects.toMatchObject({
      code: 'KYC_ORPHAN_HOLD_RECOVERY_CNH_BINDING_CONFLICT'
    });
    expect(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${authorized.recoveryId}`
    )).toMatchObject({ status: 'AVAILABLE', remainingAttempts: 1 });
  });

  test('refuses claim when the original canonical failure evidence changed', async () => {
    const harness = createOrphanHarness();
    const authorized = await authorize(harness);
    harness.firestore.documents.set(
      `driver_identity_trust/${DRIVER_ID}/evidence/${FAILURE_EVIDENCE_ID}`,
      canonicalFailureEvidence({ terminalOutcome: 'approved' })
    );

    await expect(harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    )).rejects.toMatchObject({
      code: 'KYC_ORPHAN_HOLD_RECOVERY_FAILURE_EVIDENCE_CONFLICT'
    });
    expect(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${authorized.recoveryId}`
    )).toMatchObject({ status: 'AVAILABLE', remainingAttempts: 1 });
  });

  test('finalizes canonical success idempotently and preserves the original failed evidence', async () => {
    const harness = createOrphanHarness();
    const authorized = await authorize(harness);
    const claim = await harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    );
    await harness.service.consumeCleanRetryAuthorization(claim, AWS_SESSION_ID);
    const approvedEvidenceId = 'approved_canonical_evidence_2';
    harness.firestore.documents.set(`driver_identity_trust/${DRIVER_ID}`, {
      schemaVersion: 1,
      driverId: DRIVER_ID,
      stateRevision: STATE_REVISION + 1,
      status: 'active',
      revokedAt: null,
      revocationReason: null,
      lastEvidenceId: approvedEvidenceId
    });
    harness.firestore.documents.set(
      `driver_identity_trust/${DRIVER_ID}/evidence/${approvedEvidenceId}`,
      {
        schemaVersion: 1,
        evidenceId: approvedEvidenceId,
        driverId: DRIVER_ID,
        status: 'approved'
      }
    );

    const result = await harness.service.finalizeCleanRetryAuthorization({
      driverId: DRIVER_ID,
      attemptScope: authorized.attemptScope,
      sessionId: AWS_SESSION_ID,
      outcome: 'SUCCEEDED',
      resultEvidenceId: approvedEvidenceId,
      reason: 'Comparacao canonica aprovada para a sessao vinculada.'
    });
    const replay = await harness.service.finalizeCleanRetryAuthorization({
      driverId: DRIVER_ID,
      attemptScope: authorized.attemptScope,
      sessionId: AWS_SESSION_ID,
      outcome: 'SUCCEEDED',
      resultEvidenceId: approvedEvidenceId,
      reason: 'Comparacao canonica aprovada para a sessao vinculada.'
    });

    expect(result).toMatchObject({
      authorization: { status: 'SUCCEEDED', identityApproved: true },
      enforcement: { active: false, status: 'RESOLVED_BY_CANONICAL_MATCH' },
      idempotentReplay: false
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(harness.firestore.documents.get(
      `driver_identity_trust/${DRIVER_ID}/evidence/${FAILURE_EVIDENCE_ID}`
    )).toEqual(canonicalFailureEvidence());
    await expect(authorize(harness)).rejects.toMatchObject({
      code: 'KYC_ORPHAN_HOLD_RECOVERY_TRUST_CONFLICT'
    });
    expect(harness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${authorized.recoveryId}`
    )).toMatchObject({ status: 'SUCCEEDED', remainingAttempts: 0 });
  });

  test('finalizes rejection and abort as terminal hard holds without reopening credit', async () => {
    const rejectedHarness = createOrphanHarness();
    const rejectedAuthorization = await authorize(rejectedHarness);
    const rejectedClaim = await rejectedHarness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      rejectedAuthorization.attemptScope
    );
    await rejectedHarness.service.consumeCleanRetryAuthorization(rejectedClaim, AWS_SESSION_ID);
    const rejectedEvidenceId = 'canonical_failure_evidence_2';
    rejectedHarness.firestore.documents.set(`driver_identity_trust/${DRIVER_ID}`, trustState({
      stateRevision: STATE_REVISION + 1,
      revocationReason: 'identity_reverification_failed',
      revokedAt: '2026-07-17T12:20:00.000Z',
      lastFailure: { recordedAt: '2026-07-17T12:20:00.000Z' }
    }));
    rejectedHarness.firestore.documents.set(
      `driver_identity_trust/${DRIVER_ID}/evidence/${rejectedEvidenceId}`,
      {
        evidenceId: rejectedEvidenceId,
        driverId: DRIVER_ID,
        terminalOutcome: 'face_compare_failed',
        recordedAt: '2026-07-17T12:20:00.000Z'
      }
    );

    await expect(rejectedHarness.service.finalizeCleanRetryAuthorization({
      driverId: DRIVER_ID,
      attemptScope: rejectedAuthorization.attemptScope,
      sessionId: AWS_SESSION_ID,
      outcome: 'REJECTED',
      reason: 'Rejeicao sem evidencia nao pode encerrar a autorizacao.'
    })).rejects.toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_RETRY_REJECTION_EVIDENCE_REQUIRED'
    });

    await expect(rejectedHarness.service.finalizeCleanRetryAuthorization({
      driverId: DRIVER_ID,
      attemptScope: rejectedAuthorization.attemptScope,
      sessionId: AWS_SESSION_ID,
      outcome: 'REJECTED',
      resultEvidenceId: rejectedEvidenceId,
      reason: 'Nova comparacao canonica rejeitada para a sessao vinculada.'
    })).resolves.toMatchObject({
      authorization: { status: 'REJECTED', identityApproved: false },
      enforcement: { active: true, status: 'IDENTITY_MISMATCH_HOLD' }
    });
    await expect(rejectedHarness.service.finalizeCleanRetryAuthorization({
      driverId: DRIVER_ID,
      attemptScope: rejectedAuthorization.attemptScope,
      sessionId: AWS_SESSION_ID,
      outcome: 'ABORTED',
      reason: 'Tentativa de trocar o resultado terminal.'
    })).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_RETRY_OUTCOME_CONFLICT' });

    const abortedHarness = createOrphanHarness();
    const abortedAuthorization = await authorize(abortedHarness);
    const abortedClaim = await abortedHarness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      abortedAuthorization.attemptScope
    );
    await abortedHarness.service.consumeCleanRetryAuthorization(abortedClaim, AWS_SESSION_ID);
    await expect(abortedHarness.service.finalizeCleanRetryAuthorization({
      driverId: DRIVER_ID,
      attemptScope: abortedAuthorization.attemptScope,
      sessionId: AWS_SESSION_ID,
      outcome: 'ABORTED',
      reason: 'Usuario encerrou a sessao antes da conclusao.'
    })).resolves.toMatchObject({
      authorization: { status: 'ABORTED', remainingAttempts: 0 },
      enforcement: { active: true, status: 'ORPHAN_IDENTITY_HOLD' }
    });
    const abortedAuthorizeReplay = await authorize(abortedHarness);
    expect(abortedAuthorizeReplay).toMatchObject({
      idempotentReplay: true,
      authorization: { status: 'ABORTED', remainingAttempts: 0 }
    });
  });

  test('compensates setup failure only before claim and never returns the credit', async () => {
    const harness = createOrphanHarness();
    const authorized = await authorize(harness);

    const aborted = await harness.service.abortOrphanHoldRecoverySetup({
      driverId: DRIVER_ID,
      recoveryId: authorized.recoveryId,
      reason: 'Falha ao persistir o challenge duravel depois da autorizacao.'
    });
    const replay = await harness.service.abortOrphanHoldRecoverySetup({
      driverId: DRIVER_ID,
      recoveryId: authorized.recoveryId,
      reason: 'Falha ao persistir o challenge duravel depois da autorizacao.'
    });

    expect(aborted).toMatchObject({
      authorization: { status: 'ABORTED_SETUP', remainingAttempts: 0 },
      enforcement: { active: true, status: 'ORPHAN_IDENTITY_HOLD' },
      idempotentReplay: false
    });
    expect(replay.idempotentReplay).toBe(true);
    await expect(harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      authorized.attemptScope
    )).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID' });
    const authorizeReplay = await authorize(harness);
    expect(authorizeReplay).toMatchObject({
      idempotentReplay: true,
      authorization: { status: 'ABORTED_SETUP', remainingAttempts: 0 }
    });

    const claimedHarness = createOrphanHarness();
    const claimedAuthorization = await authorize(claimedHarness);
    await claimedHarness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      claimedAuthorization.attemptScope
    );
    await expect(claimedHarness.service.abortOrphanHoldRecoverySetup({
      driverId: DRIVER_ID,
      recoveryId: claimedAuthorization.recoveryId,
      reason: 'Falha tardia depois que a autorizacao ja havia sido reclamada.'
    })).rejects.toMatchObject({
      code: 'KYC_ORPHAN_HOLD_RECOVERY_ALREADY_DISPATCHED'
    });
    expect(claimedHarness.firestore.documents.get(
      `kyc_identity_retry_authorizations/${claimedAuthorization.recoveryId}`
    )).toMatchObject({ status: 'CLAIMED', remainingAttempts: 0 });
  });

  test('does not refresh or reopen an expired idempotent authorization', async () => {
    const harness = createOrphanHarness();
    const first = await authorize(harness);
    harness.setNow('2026-07-17T13:00:00.000Z');

    const replay = await authorize(harness);
    expect(replay).toMatchObject({
      recoveryId: first.recoveryId,
      idempotentReplay: true,
      authorization: {
        status: 'AVAILABLE',
        remainingAttempts: 1,
        expiresAt: '2026-07-17T12:40:00.000Z'
      }
    });
    await expect(harness.service.assertKycOperationAllowed(DRIVER_ID)).resolves.toMatchObject({
      identityReviewHold: true,
      cleanRetryAuthorized: false,
      cnhReplacementHold: true
    });
    await expect(harness.service.claimCleanRetryAuthorization(
      DRIVER_ID,
      first.attemptScope
    )).rejects.toMatchObject({ code: 'KYC_IDENTITY_REVIEW_RETRY_NOT_AVAILABLE' });
  });
});
