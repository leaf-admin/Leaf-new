const {
  KycIdentityReviewWorkflowService,
  createCaseService
} = require('../../../services/kyc-identity-review-workflow-service');

const DRIVER_ID = 'driver_1';
const EVIDENCE_ID = 'evidence_1234567890';
const TICKET_ID = 'TICKET-1';
const CASE_ID = 'kyc_ir_case_1';
const RETRY_CASE_ID = `kyc_ir_${'d'.repeat(32)}`;
const RETRY_SCOPE = `manual_review_retry_${RETRY_CASE_ID}`;
const CNH_SHA = 'a'.repeat(64);
const SELFIE_SHA = 'b'.repeat(64);
const SESSION_SHA = 'c'.repeat(64);

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

  function collection(name) {
    return {
      doc(id) {
        const path = `${name}/${id}`;
        return {
          id,
          path,
          async get() {
            return snapshot(path);
          }
        };
      },
      where(field, operator, value) {
        expect(operator).toBe('==');
        return {
          async get() {
            const docs = [];
            for (const [path, data] of documents.entries()) {
              if (!path.startsWith(`${name}/`) || path.slice(name.length + 1).includes('/')) continue;
              if (data?.[field] === value) docs.push(snapshot(path));
            }
            return { docs };
          }
        };
      }
    };
  }

  async function runTransaction(callback) {
    return callback({
      async get(ref) {
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
      .resolves.toMatchObject({ allowed: true });
    await expect(underReview.service.assertCnhUploadAllowed(DRIVER_ID))
      .rejects.toMatchObject({
        code: 'KYC_IDENTITY_REVIEW_HOLD',
        caseId: CASE_ID,
        ticketId: TICKET_ID
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
