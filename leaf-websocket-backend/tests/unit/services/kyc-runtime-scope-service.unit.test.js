jest.mock('../../../services/kyc-identity-review-workflow-service', () => ({
  openCaseFromTicket: jest.fn(),
  KycIdentityReviewWorkflowService: class MockWorkflow {}
}));

jest.mock('../../../services/driver-identity-trust-service', () => ({
  evaluateOnlineGate: jest.fn(),
  createScopedDriverIdentityTrustService: jest.fn()
}));

jest.mock('../../../services/kyc-failed-biometric-evidence-service', () => ({
  captureRejectedComparisonEvidence: jest.fn(),
  createScopedKycFailedBiometricEvidenceService: jest.fn()
}));

jest.mock('../../../services/kyc-policy-service', () => ({
  requireApprovedKyc: jest.fn(),
  getStepUpChallenge: jest.fn(),
  getOrCreateStepUpChallenge: jest.fn(),
  createStepUpChallenge: jest.fn(),
  resolveStepUpChallenge: jest.fn(),
  applyIdentityReverificationGate: jest.fn(),
  markDriverForLivenessAttemptsExhausted: jest.fn(),
  recordIdentityReverificationStarted: jest.fn(),
  recordIdentityReverificationResult: jest.fn(),
  recordVerificationSuccess: jest.fn()
}));

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const { resolveKycPersistenceScope } = require('../../../services/sandbox-persistence-context');
const {
  KycRuntimeScopeService,
  createSandboxPolicyGuard
} = require('../../../services/kyc-runtime-scope-service');

function context(environment = 'production') {
  return sealFinancialContext({
    providerEnvironment: environment,
    paymentProfileId: environment === 'sandbox'
      ? 'qa-test-users-sandbox-durable'
      : 'production-default',
    paymentProfileSource: 'firestore',
    testUserSandbox: environment === 'sandbox'
  });
}

function scopeFor(financialContext) {
  return resolveKycPersistenceScope(financialContext, { allowLegacyOperational: false });
}

function operationalServices() {
  return {
    workflow: {
      openCaseFromTicket: jest.fn(),
      resumeExistingCaseRequest: jest.fn(),
      assertKycOperationAllowed: jest.fn(),
      claimCleanRetryAuthorization: jest.fn(),
      consumeCleanRetryAuthorization: jest.fn(),
      resumeCleanRetryAuthorization: jest.fn(),
      releaseCleanRetryAuthorization: jest.fn(),
      finalizeCleanRetryAuthorization: jest.fn(),
      clearResolvedMismatchHold: jest.fn()
    },
    trust: {
      evaluateOnlineGate: jest.fn(),
      assertVerificationOutsideActiveTrip: jest.fn(),
      claimVerificationWindow: jest.fn(),
      renewVerificationWindow: jest.fn(),
      releaseVerificationWindow: jest.fn(),
      claimCanonicalSession: jest.fn(),
      renewCanonicalSessionClaim: jest.fn(),
      releaseCanonicalSessionClaim: jest.fn(),
      readCanonicalCompatibilityVerification: jest.fn(),
      recordCanonicalSuccess: jest.fn(),
      recordCanonicalFailure: jest.fn(),
      linkReviewEvidenceToCanonicalFailure: jest.fn(),
      restoreApprovedIdentityVerification: jest.fn(),
      restoreRejectedIdentityVerification: jest.fn()
    },
    evidence: { captureRejectedComparisonEvidence: jest.fn() },
    policy: {
      requireApprovedKyc: jest.fn(),
      getStepUpChallenge: jest.fn(),
      getOrCreateStepUpChallenge: jest.fn(),
      createStepUpChallenge: jest.fn(),
      resolveStepUpChallenge: jest.fn(),
      applyIdentityReverificationGate: jest.fn(),
      markDriverForLivenessAttemptsExhausted: jest.fn(),
      recordIdentityReverificationStarted: jest.fn(),
      recordIdentityReverificationResult: jest.fn(),
      recordVerificationSuccess: jest.fn()
    }
  };
}

function scopedServices(scope, gateResult = { allowed: false, code: 'kycRequired' }) {
  return {
    workflow: {
      persistenceScope: scope,
      ...operationalServices().workflow
    },
    trust: {
      persistenceScope: scope,
      ...operationalServices().trust,
      evaluateOnlineGate: jest.fn(async () => gateResult)
    },
    evidence: {
      persistenceScope: scope,
      captureRejectedComparisonEvidence: jest.fn()
    },
    policy: operationalServices().policy
  };
}

function createSandboxHarness({ gateResult } = {}) {
  const financialContext = context('sandbox');
  const scope = scopeFor(financialContext);
  const scoped = scopedServices(scope, gateResult);
  const createScopedEvidence = jest.fn(() => scoped.evidence);
  const createScopedTrust = jest.fn(() => scoped.trust);
  const createScopedWorkflow = jest.fn(() => scoped.workflow);
  const createSandboxPolicy = jest.fn(() => scoped.policy);
  const resolveUserScope = jest.fn(async () => scope);
  const service = new KycRuntimeScopeService({
    resolveUserScope,
    ...Object.fromEntries(
      Object.entries(operationalServices()).map(([key, value]) => [
        `operational${key[0].toUpperCase()}${key.slice(1)}`,
        value
      ])
    ),
    createScopedEvidence,
    createScopedTrust,
    createScopedWorkflow,
    createSandboxPolicy
  });
  return {
    service,
    financialContext,
    scope,
    scoped,
    resolveUserScope,
    createScopedEvidence,
    createScopedTrust,
    createScopedWorkflow,
    createSandboxPolicy
  };
}

function createPolicyPersistenceHarness() {
  const documents = new Map();
  const values = new Map();
  const docRef = (collectionName, id) => {
    const path = `${collectionName}/${id}`;
    return {
      id,
      async get() {
        return {
          id,
          exists: documents.has(path),
          data: () => documents.get(path)
        };
      },
      async create(value) {
        if (documents.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
        documents.set(path, value);
      },
      async set(value, options = {}) {
        documents.set(path, options.merge
          ? { ...(documents.get(path) || {}), ...value }
          : value);
      },
      async delete() {
        documents.delete(path);
      }
    };
  };
  const firestore = {
    documents,
    collection: jest.fn((collectionName) => ({
      doc: (id) => docRef(collectionName, id)
    })),
    runTransaction: jest.fn(async (callback) => callback({
      get: (ref) => ref.get(),
      set: (ref, value, options) => ref.set(value, options)
    }))
  };
  const redis = {
    values,
    get: jest.fn(async (key) => values.get(key) || null),
    set: jest.fn(async (key, value, ...args) => {
      if (args.includes('NX') && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys) => {
      keys.forEach((key) => values.delete(key));
      return keys.length;
    }),
    hset: jest.fn(async (key, fields) => {
      values.set(key, { ...(values.get(key) || {}), ...fields });
      return 1;
    }),
    eval: jest.fn(async (_script, _keyCount, key, token) => {
      if (values.get(key) !== token) return 0;
      values.delete(key);
      return 1;
    }),
    multi: jest.fn(() => {
      const operations = [];
      return {
        set(...args) {
          operations.push(['set', args]);
          return this;
        },
        del(...args) {
          operations.push(['del', args]);
          return this;
        },
        async exec() {
          for (const [operation, args] of operations) {
            await redis[operation](...args);
          }
          return operations.map(() => [null, 'OK']);
        }
      };
    })
  };
  return { firestore, redis, documents, values };
}

describe('kyc-runtime-scope-service', () => {
  it('returns the existing operational singletons after authoritative user classification', async () => {
    const financialContext = context('production');
    const scope = scopeFor(financialContext);
    const operational = operationalServices();
    const createScopedEvidence = jest.fn();
    const service = new KycRuntimeScopeService({
      resolveUserScope: jest.fn(async () => scope),
      operationalWorkflow: operational.workflow,
      operationalTrust: operational.trust,
      operationalEvidence: operational.evidence,
      operationalPolicy: operational.policy,
      createScopedEvidence
    });

    const result = await service.resolveForUser({ userId: 'driver-operational' });

    expect(result).toMatchObject({
      userId: 'driver-operational',
      namespace: 'operational',
      persistenceContext: financialContext,
      workflow: operational.workflow,
      trust: operational.trust,
      evidence: operational.evidence,
      policy: operational.policy,
      workflowService: operational.workflow,
      trustService: operational.trust,
      evidenceService: operational.evidence,
      policyService: operational.policy,
      capabilities: {
        scopedPersistence: false,
        policyMutations: true
      }
    });
    expect(createScopedEvidence).not.toHaveBeenCalled();
  });

  it('builds workflow, trust and evidence with the exact authoritative sandbox context', async () => {
    const harness = createSandboxHarness();

    const result = await harness.service.resolveForUser({
      userId: 'driver-sandbox',
      actor: { uid: 'driver-sandbox', role: 'driver' }
    });

    expect(harness.resolveUserScope).toHaveBeenCalledWith({
      userId: 'driver-sandbox',
      phone: null,
      actor: { uid: 'driver-sandbox', role: 'driver' },
      appReview: false
    });
    expect(harness.createScopedEvidence).toHaveBeenCalledWith(harness.financialContext);
    expect(harness.createScopedTrust).toHaveBeenCalledWith(
      harness.financialContext,
      expect.objectContaining({ kycPolicyService: expect.any(Object) })
    );
    expect(harness.createScopedWorkflow).toHaveBeenCalledWith({
      persistenceContext: harness.financialContext,
      identityTrustService: harness.scoped.trust,
      evidenceService: harness.scoped.evidence
    });
    expect(result).toMatchObject({
      namespace: 'sandbox',
      workflow: harness.scoped.workflow,
      evidence: harness.scoped.evidence,
      policy: harness.scoped.policy,
      workflowService: harness.scoped.workflow,
      evidenceService: harness.scoped.evidence,
      policyService: harness.scoped.policy,
      capabilities: {
        scopedPersistence: true,
        policyMutations: false
      }
    });
    expect(result.trust.persistenceScope.financialContextId)
      .toBe(harness.financialContext.contextId);
  });

  it('converts a sandbox trust fail-open result into a hard denial', async () => {
    const harness = createSandboxHarness({
      gateResult: { allowed: true, code: 'kycCheckFailedOpen' }
    });
    const runtime = await harness.service.resolveForUser({ userId: 'driver-sandbox' });

    await expect(runtime.trust.evaluateOnlineGate('driver-sandbox')).resolves.toMatchObject({
      allowed: false,
      retryRequired: true,
      code: 'KYC_SANDBOX_POLICY_SCOPE_UNAVAILABLE'
    });
  });

  it('reclassifies the user on every request while reusing only the matching scoped bundle', async () => {
    const harness = createSandboxHarness();

    const first = await harness.service.resolveForUser({ userId: 'driver-sandbox' });
    const second = await harness.service.resolveForUser({ userId: 'driver-sandbox' });

    expect(harness.resolveUserScope).toHaveBeenCalledTimes(2);
    expect(harness.createScopedEvidence).toHaveBeenCalledTimes(1);
    expect(harness.createScopedTrust).toHaveBeenCalledTimes(1);
    expect(harness.createScopedWorkflow).toHaveBeenCalledTimes(1);
    expect(second.workflow).toBe(first.workflow);
  });

  it('fails closed when the payment runtime cannot classify the user', async () => {
    const failure = Object.assign(new Error('classification unavailable'), {
      code: 'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE'
    });
    const service = new KycRuntimeScopeService({
      resolveUserScope: jest.fn(async () => { throw failure; }),
      ...Object.fromEntries(
        Object.entries(operationalServices()).map(([key, value]) => [
          `operational${key[0].toUpperCase()}${key.slice(1)}`,
          value
        ])
      )
    });

    await expect(service.resolveForUser({ userId: 'driver-unknown' })).rejects.toBe(failure);
  });

  it('rejects any sandbox factory that returns an operational service', async () => {
    const harness = createSandboxHarness();
    harness.createScopedTrust.mockReturnValue({
      persistenceScope: scopeFor(context('production')),
      evaluateOnlineGate: jest.fn()
    });

    await expect(harness.service.resolveForUser({ userId: 'driver-sandbox' }))
      .rejects.toMatchObject({ code: 'KYC_RUNTIME_SERVICE_SCOPE_MISMATCH' });
  });

  it('rejects a caller context that diverges from the authoritative sandbox profile', async () => {
    const harness = createSandboxHarness();

    await expect(harness.service.resolveForUser({
      userId: 'driver-sandbox',
      expectedPersistenceContext: context('production')
    })).rejects.toMatchObject({ code: 'KYC_RUNTIME_SCOPE_MISMATCH' });
    expect(harness.createScopedEvidence).not.toHaveBeenCalled();
  });

  it('persists and resolves step-up challenges only in sandbox Firestore and Redis', async () => {
    const persistence = createPolicyPersistenceHarness();
    const financialContext = context('sandbox');
    const scope = scopeFor(financialContext);
    const policy = {
      requireApprovedKyc: jest.fn(async () => ({ allowed: true })),
      getConfig: jest.fn(() => ({ challengeTtlSeconds: 900 })),
      isLivenessSatisfied: jest.fn((payload) => payload.aws?.passed === true)
    };
    const supportTicketService = {
      createTicket: jest.fn(async () => ({
        ticket: { id: 'TICKET-SANDBOX-LIVENESS-1' }
      }))
    };
    const generatedChallengeIds = ['kyc_ch_sandbox_1', 'idrev_exhausted_sandbox_1'];
    const adapter = createSandboxPolicyGuard(policy, {
      scope,
      firestoreProvider: () => persistence.firestore,
      redis: persistence.redis,
      supportTicketService,
      now: () => new Date('2026-07-21T18:00:00.000Z'),
      challengeIdGenerator: () => generatedChallengeIds.shift()
    });

    await expect(adapter.requireApprovedKyc('driver-sandbox')).resolves.toEqual({ allowed: true });
    const created = await adapter.getOrCreateStepUpChallenge({
      driverId: 'driver-sandbox',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: 'driver_online',
      metadata: { canonicalEvidenceRequired: true }
    });
    expect(created).toMatchObject({
      challengeId: 'kyc_ch_sandbox_1',
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      status: 'pending'
    });
    expect(persistence.documents.has(
      'sandbox_kyc_stepup_challenges/kyc_ch_sandbox_1'
    )).toBe(true);
    expect(persistence.values.get(
      'sandbox:kyc:stepup:active:driver-sandbox'
    )).toBe('kyc_ch_sandbox_1');
    expect([...persistence.documents.keys()].some((key) => (
      key.startsWith('kyc_stepup_challenges/')
    ))).toBe(false);
    expect([...persistence.values.keys()].some((key) => (
      key.startsWith('kyc:stepup:')
    ))).toBe(false);

    const replay = await adapter.getOrCreateStepUpChallenge({
      driverId: 'driver-sandbox',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: 'driver_online'
    });
    expect(replay.challengeId).toBe(created.challengeId);

    await expect(adapter.resolveStepUpChallenge({
      challengeId: created.challengeId,
      driverId: 'driver-sandbox',
      verificationPayload: {}
    })).resolves.toMatchObject({ success: false, code: 'KYC_LIVENESS_REQUIRED' });
    await expect(adapter.resolveStepUpChallenge({
      challengeId: created.challengeId,
      driverId: 'driver-sandbox',
      verificationPayload: { aws: { passed: true }, provider: 'aws' }
    })).resolves.toMatchObject({
      success: true,
      challengeId: created.challengeId,
      requirement: 'LIVENESS_REQUIRED'
    });
    expect(persistence.documents.get(
      'sandbox_kyc_stepup_challenges/kyc_ch_sandbox_1'
    )).toMatchObject({ status: 'resolved', financialNamespace: 'sandbox' });
    expect(persistence.values.has(
      'sandbox:kyc:stepup:active:driver-sandbox'
    )).toBe(false);

    const attemptScope = 'orphan_hold_retry_kyc_or_0123456789abcdef0123456789abcdef';
    const identityGate = await adapter.applyIdentityReverificationGate({
      driverId: 'driver-sandbox',
      reporterId: 'admin-1',
      reporterType: 'admin',
      challengeId: 'idrev_sandbox_1',
      supportTicketId: 'ticket-sandbox-1',
      payload: {
        reasonCode: 'kyc_orphan_hold_retry_authorized',
        publicReason: 'Uma nova validacao de identidade foi autorizada pelo suporte.',
        attemptScope
      }
    });
    expect(identityGate).toMatchObject({
      success: true,
      challengeId: 'idrev_sandbox_1',
      requirement: 'IDENTITY_REVERIFICATION',
      scoped: true
    });
    expect(persistence.documents.get(
      'sandbox_kyc_stepup_challenges/idrev_sandbox_1'
    )).toMatchObject({
      driverId: 'driver-sandbox',
      requirement: 'IDENTITY_REVERIFICATION',
      metadata: {
        reasonCode: 'kyc_orphan_hold_retry_authorized',
        attemptScope
      },
      financialNamespace: 'sandbox'
    });
    expect(persistence.values.get('sandbox:driver:driver-sandbox')).toMatchObject({
      identity_reverification_challenge_id: 'idrev_sandbox_1',
      identity_reverification_attempt_scope: attemptScope,
      dispatchEligible: 'false'
    });

    await expect(adapter.applyIdentityReverificationGate({
      driverId: 'driver-sandbox',
      challengeId: 'idrev_sandbox_1',
      payload: {
        reasonCode: 'kyc_orphan_hold_retry_authorized',
        publicReason: 'Uma nova validacao de identidade foi autorizada pelo suporte.',
        attemptScope
      }
    })).resolves.toMatchObject({ success: true, challengeId: 'idrev_sandbox_1' });
    expect([...persistence.documents.keys()].filter((key) => (
      key === 'sandbox_kyc_stepup_challenges/idrev_sandbox_1'
    ))).toHaveLength(1);

    await expect(adapter.recordIdentityReverificationStarted('driver-sandbox', {
      challengeId: 'idrev_sandbox_1',
      requirement: 'IDENTITY_REVERIFICATION'
    })).resolves.toMatchObject({ success: true, recorded: true, scoped: true });
    expect(persistence.documents.get(
      'sandbox_kyc_stepup_challenges/idrev_sandbox_1'
    )).toMatchObject({
      metadata: {
        lastIdentityEvent: { name: 'validation_started' }
      }
    });

    const exhausted = await adapter.markDriverForLivenessAttemptsExhausted({
      driverId: 'driver-exhausted-sandbox',
      challengeId: 'kyc_ch_original_liveness',
      attemptState: {
        failed: 2,
        maxAttempts: 2,
        attemptScope: 'orphan_hold_retry_kyc_or_abcdefabcdefabcdefabcdefabcdefab'
      },
      metadata: { source: 'kyc_route' }
    });
    expect(supportTicketService.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: 'driver-exhausted-sandbox',
        userType: 'driver',
        category: 'kyc',
        priority: 'N2',
        persistenceContext: scope,
        metadata: expect.objectContaining({
          reasonCode: 'aws_liveness_attempts_exhausted',
          challengeId: 'kyc_ch_original_liveness',
          source: 'kyc_route'
        })
      })
    );
    expect(exhausted).toMatchObject({
      success: true,
      softBlocked: true,
      supportTicketId: 'TICKET-SANDBOX-LIVENESS-1',
      challengeId: 'idrev_exhausted_sandbox_1',
      reasonCode: 'aws_liveness_attempts_exhausted',
      scoped: true
    });
    expect(persistence.documents.get(
      'sandbox_kyc_stepup_challenges/idrev_exhausted_sandbox_1'
    )).toMatchObject({
      driverId: 'driver-exhausted-sandbox',
      requirement: 'IDENTITY_REVERIFICATION',
      financialNamespace: 'sandbox',
      metadata: expect.objectContaining({
        supportTicketId: 'TICKET-SANDBOX-LIVENESS-1',
        reasonCode: 'aws_liveness_attempts_exhausted'
      })
    });
    expect(persistence.values.get('sandbox:driver:driver-exhausted-sandbox')).toMatchObject({
      identity_reverification_challenge_id: 'idrev_exhausted_sandbox_1',
      dispatchEligible: 'false'
    });
    expect([...persistence.documents.keys()].some((key) => (
      key.startsWith('support_tickets/')
      || key.startsWith('kyc_stepup_challenges/')
    ))).toBe(false);
    expect([...persistence.values.keys()].some((key) => (
      key.startsWith('driver:') || key.startsWith('kyc:stepup:')
    ))).toBe(false);

    const exhaustedReplay = await adapter.markDriverForLivenessAttemptsExhausted({
      driverId: 'driver-exhausted-sandbox',
      challengeId: 'kyc_ch_original_liveness',
      attemptState: {
        failed: 2,
        maxAttempts: 2,
        attemptScope: 'orphan_hold_retry_kyc_or_abcdefabcdefabcdefabcdefabcdefab'
      },
      metadata: { source: 'kyc_route' }
    });
    expect(exhaustedReplay).toMatchObject({
      challengeId: 'idrev_exhausted_sandbox_1',
      supportTicketId: 'TICKET-SANDBOX-LIVENESS-1',
      softBlocked: true
    });
    expect(supportTicketService.createTicket).toHaveBeenCalledTimes(1);
    await expect(adapter.markDriverForLivenessAttemptsExhausted({
      driverId: 'driver-exhausted-sandbox',
      challengeId: 'kyc_ch_different_liveness',
      attemptState: {
        failed: 2,
        maxAttempts: 2,
        attemptScope: 'orphan_hold_retry_kyc_or_abcdefabcdefabcdefabcdefabcdefab'
      }
    })).rejects.toMatchObject({ code: 'KYC_CHALLENGE_BINDING_CONFLICT' });
    expect(supportTicketService.createTicket).toHaveBeenCalledTimes(1);
  });

  it('keeps the sandbox identity gate closed when support ticket persistence fails', async () => {
    const persistence = createPolicyPersistenceHarness();
    const financialContext = context('sandbox');
    const scope = scopeFor(financialContext);
    const supportFailure = Object.assign(new Error('support unavailable'), {
      code: 'SUPPORT_STORE_UNAVAILABLE'
    });
    const adapter = createSandboxPolicyGuard({
      requireApprovedKyc: jest.fn(async () => ({ allowed: true })),
      getConfig: jest.fn(() => ({ challengeTtlSeconds: 900 }))
    }, {
      scope,
      firestoreProvider: () => persistence.firestore,
      redis: persistence.redis,
      supportTicketService: {
        createTicket: jest.fn(async () => { throw supportFailure; })
      },
      now: () => new Date('2026-07-21T18:00:00.000Z'),
      challengeIdGenerator: () => 'idrev_support_failure_1'
    });

    await expect(adapter.markDriverForLivenessAttemptsExhausted({
      driverId: 'driver-support-failure',
      challengeId: 'kyc_ch_failed_support'
    })).rejects.toBe(supportFailure);
    expect(persistence.documents.get(
      'sandbox_kyc_stepup_challenges/idrev_support_failure_1'
    )).toMatchObject({
      driverId: 'driver-support-failure',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'pending',
      financialNamespace: 'sandbox'
    });
    expect(persistence.values.get('sandbox:driver:driver-support-failure')).toMatchObject({
      kyc_reverify_required: 'true',
      dispatchEligible: 'false'
    });
  });
});
