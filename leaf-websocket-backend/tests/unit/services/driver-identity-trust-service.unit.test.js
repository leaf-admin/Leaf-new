const crypto = require('crypto');

const mockClaimIdentityVerificationWindow = jest.fn();
const mockRenewIdentityVerificationWindow = jest.fn();
const mockReleaseIdentityVerificationWindow = jest.fn();

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

const defaultRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1)
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => defaultRedis)
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/active-trip-index', () => ({
  IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS: 25 * 60,
  resolveActiveTripForDriver: jest.fn(async () => ({ tripId: null, customerId: null })),
  claimIdentityVerificationWindow: (...args) => mockClaimIdentityVerificationWindow(...args),
  renewIdentityVerificationWindow: (...args) => mockRenewIdentityVerificationWindow(...args),
  releaseIdentityVerificationWindow: (...args) => mockReleaseIdentityVerificationWindow(...args)
}));

jest.mock('../../../services/IntegratedKYCService', () => jest.fn(() => ({
  hasValidVerification: jest.fn(async () => ({ hasValid: false }))
})));

jest.mock('../../../services/kyc-policy-service', () => ({
  requireApprovedKyc: jest.fn(async () => ({ allowed: true })),
  getOrCreateStepUpChallenge: jest.fn(async ({ driverId, requirement, source, metadata }) => ({
    challengeId: 'challenge-1',
    driverId,
    requirement,
    source,
    metadata
  }))
}));

jest.mock('../../../services/driver-activation-state-service', () => ({
  resolveDriverActivationState: jest.fn(async () => ({
    state: 'ACTIVE',
    canAttemptOnline: true,
    canGoOnline: true,
    requiresLiveness: false
  }))
}));

jest.mock('../../../services/kyc-biometric-production-policy', () => ({
  resolveBiometricPolicy: jest.fn(() => ({ productionBiometricsEnabled: true }))
}));

const {
  DriverIdentityTrustService,
  TRUST_TIERS
} = require('../../../services/driver-identity-trust-service');

function createRedis() {
  const values = new Map();
  return {
    values,
    get: jest.fn(async (key) => values.get(key) || null),
    set: jest.fn(async (key, value, ...args) => {
      if (args.includes('NX') && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key) => (values.delete(key) ? 1 : 0)),
    hset: jest.fn(async () => 1)
  };
}

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
    }),
    collection: (name) => collectionRef(`${path}/${name}`)
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

function createHarness(overrides = {}) {
  let now = new Date('2026-07-01T15:00:00.000Z');
  const redis = overrides.redis || createRedis();
  const firestore = overrides.firestore || createFakeFirestore();
  const activeTripResolver = overrides.activeTripResolver || jest.fn(async () => ({
    tripId: null,
    customerId: null
  }));
  const activationService = overrides.activationService || {
    resolveDriverActivationState: jest.fn(async () => ({
      state: 'ACTIVE',
      canAttemptOnline: true,
      canGoOnline: true,
      requiresLiveness: false
    }))
  };
  const kycPolicy = overrides.kycPolicyService || {
    requireApprovedKyc: jest.fn(async () => ({ allowed: true })),
    getStepUpChallenge: jest.fn(async () => null),
    getOrCreateStepUpChallenge: jest.fn(async (input) => ({
      challengeId: 'challenge-1',
      ...input,
      status: 'pending'
    }))
  };
  const randomInt = overrides.randomInt || jest.fn(() => 9999);
  const realtimeReader = overrides.realtimeReader || jest.fn(async (path) => {
    if (path.endsWith('/documents/cnh')) {
      return {
        status: 'approved',
        analysisStatus: 'approved',
        lastSubmissionId: 'cnh-submission-1'
      };
    }
    return null;
  });
  const env = {
    DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
    KYC_TRUST_CADENCE_ENABLED: 'true',
    KYC_TRUST_POLICY_VERSION: 'driver_identity_recurring_v1',
    KYC_TRUST_T0_MAX_AGE_HOURS: '24',
    KYC_TRUST_T1_MAX_AGE_HOURS: '72',
    KYC_TRUST_T2_MAX_AGE_HOURS: '168',
    KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS: '7',
    KYC_TRUST_T2_MIN_AGE_DAYS: '30',
    KYC_TRUST_T2_MIN_SUCCESS_COUNT: '14',
    KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '5',
    KYC_TRUST_RANDOM_AUDIT_TIME_ZONE: 'America/Sao_Paulo',
    ...overrides.env
  };

  const service = new DriverIdentityTrustService({
    env,
    redis,
    firestoreProvider: () => firestore,
    realtimeReader,
    activeTripResolver,
    activationService,
    kycPolicyService: kycPolicy,
    integratedKycService: overrides.integratedKycService || {
      hasValidVerification: jest.fn(async () => ({ hasValid: false }))
    },
    resolveBiometricPolicy: overrides.resolveBiometricPolicy || (() => ({
      productionBiometricsEnabled: true,
      trustedMatchProviders: ['leaf_face_compare_service']
    })),
    now: () => new Date(now),
    randomInt,
    logger: jest.fn()
  });

  return {
    service,
    redis,
    firestore,
    activeTripResolver,
    activationService,
    kycPolicy,
    randomInt,
    realtimeReader,
    setNow(value) {
      now = new Date(value);
    }
  };
}

function canonicalEvidence(driverId, sessionId, verifiedAt, overrides = {}) {
  return {
    driverId,
    sourcePath: 'server_side_aws_reference_compare',
    awsSessionId: sessionId,
    livenessProvider: 'aws_rekognition_face_liveness',
    livenessStatus: 'SUCCEEDED',
    livenessPassed: true,
    livenessConfidence: 98,
    livenessThreshold: 80,
    referenceImageSha256: crypto
      .createHash('sha256')
      .update(`reference-${sessionId}`)
      .digest('hex'),
    isMatch: true,
    needsReview: false,
    similarityScore: 0.94,
    threshold: 0.61,
    reviewThreshold: 0.4,
    decision: 'approve',
    provider: 'leaf_face_compare_service',
    comparisonProvider: 'leaf_face_compare_service',
    embeddingDimension: 512,
    reference: {
      source: 'cnh_face_embedding',
      model: 'sface-v1',
      createdAt: '2026-06-01T12:00:00.000Z',
      submissionId: 'cnh-submission-1'
    },
    currentModel: 'sface-v1',
    verifiedAt,
    challengeId: null,
    requirement: null,
    ...overrides
  };
}

describe('driver-identity-trust-service', () => {
  beforeEach(() => {
    mockClaimIdentityVerificationWindow.mockReset().mockResolvedValue({
      acquired: true,
      reused: false,
      busy: false,
      activeTripId: null,
      key: 'kyc:identity-verification-window:driver-default',
      token: 'window-token',
      ttlSeconds: 25 * 60
    });
    mockRenewIdentityVerificationWindow.mockReset().mockResolvedValue(true);
    mockReleaseIdentityVerificationWindow.mockReset().mockResolvedValue(true);
  });

  test('defers every identity gate before touching KYC when a backend-indexed trip is active', async () => {
    const harness = createHarness({
      activeTripResolver: jest.fn(async () => ({
        tripId: 'trip-active-1',
        customerId: 'customer-1'
      }))
    });

    const result = await harness.service.evaluateOnlineGate('driver-active');

    expect(result).toEqual(expect.objectContaining({
      allowed: true,
      deferred: true,
      continuityOnly: true,
      code: 'KYC_DEFERRED_ACTIVE_TRIP',
      activeTripId: 'trip-active-1'
    }));
    expect(harness.activationService.resolveDriverActivationState).not.toHaveBeenCalled();
    expect(harness.kycPolicy.requireApprovedKyc).not.toHaveBeenCalled();
    expect(harness.kycPolicy.getOrCreateStepUpChallenge).not.toHaveBeenCalled();
    expect(harness.redis.hset).not.toHaveBeenCalled();
  });

  test('defers the online gate when a trip starts between the first read and the atomic claim', async () => {
    mockClaimIdentityVerificationWindow.mockResolvedValueOnce({
      acquired: false,
      activeTripId: 'trip-race-online',
      key: 'kyc:identity-verification-window:driver-race-online',
      token: 'window-token'
    });
    const harness = createHarness();

    const result = await harness.service.evaluateOnlineGate('driver-race-online');

    expect(result).toEqual(expect.objectContaining({
      allowed: true,
      deferred: true,
      continuityOnly: true,
      code: 'KYC_DEFERRED_ACTIVE_TRIP',
      activeTripId: 'trip-race-online'
    }));
    expect(harness.kycPolicy.getOrCreateStepUpChallenge).not.toHaveBeenCalled();
    expect(harness.redis.hset).not.toHaveBeenCalled();
  });

  test('does not let ACTIVE activation state bypass missing canonical evidence', async () => {
    const harness = createHarness();

    const result = await harness.service.evaluateOnlineGate('driver-new');

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('kycRequired');
    expect(result.reasonCode).toBe('KYC_CANONICAL_EVIDENCE_MISSING');
    expect(result.challenge).toEqual(expect.objectContaining({
      challengeId: 'challenge-1',
      requirement: 'LIVENESS_REQUIRED'
    }));
    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver-new',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'kycRequired'
      })
    );
    expect(harness.redis.hset.mock.invocationCallOrder[0])
      .toBeLessThan(mockReleaseIdentityVerificationWindow.mock.invocationCallOrder[0]);
  });

  test('seals dispatch before releasing the KYC window when durable challenge persistence fails', async () => {
    const kycPolicyService = {
      requireApprovedKyc: jest.fn(async () => ({ allowed: true })),
      getStepUpChallenge: jest.fn(async () => null),
      getOrCreateStepUpChallenge: jest.fn(async () => {
        const error = new Error('Firestore unavailable');
        error.code = 'KYC_CHALLENGE_DURABLE_STORE_UNAVAILABLE';
        throw error;
      })
    };
    const harness = createHarness({ kycPolicyService });

    const result = await harness.service.evaluateOnlineGate('driver-durable-failure');

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      code: 'KYC_CHECK_FAILED',
      dispatchBlockPersisted: true
    }));
    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver-durable-failure',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'KYC_CHECK_FAILED'
      })
    );
    expect(harness.redis.hset.mock.invocationCallOrder[0])
      .toBeLessThan(mockReleaseIdentityVerificationWindow.mock.invocationCallOrder[0]);
  });

  test('retains the KYC window when the fail-closed dispatch seal cannot be persisted', async () => {
    const redis = createRedis();
    redis.hset.mockRejectedValue(new Error('Redis write failed'));
    const kycPolicyService = {
      requireApprovedKyc: jest.fn(async () => ({ allowed: true })),
      getStepUpChallenge: jest.fn(async () => null),
      getOrCreateStepUpChallenge: jest.fn(async () => {
        const error = new Error('Firestore unavailable');
        error.code = 'KYC_CHALLENGE_DURABLE_STORE_UNAVAILABLE';
        throw error;
      })
    };
    const harness = createHarness({ redis, kycPolicyService });

    const result = await harness.service.evaluateOnlineGate('driver-seal-failure');

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      code: 'KYC_CHECK_FAILED',
      dispatchBlockPersisted: false
    }));
    expect(mockReleaseIdentityVerificationWindow).not.toHaveBeenCalled();
  });

  test('never converts an explicit online denial into fail-open when its dispatch seal fails', async () => {
    const redis = createRedis();
    redis.hset.mockRejectedValue(new Error('Redis write failed'));
    const activationService = {
      resolveDriverActivationState: jest.fn(async () => ({
        state: 'KYC_PENDING',
        canAttemptOnline: false,
        canGoOnline: false,
        requiresLiveness: true,
        blockingReason: 'Cadastro pendente.'
      }))
    };
    const harness = createHarness({
      redis,
      activationService,
      env: { KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false' }
    });

    const result = await harness.service.evaluateOnlineGate('driver-explicit-deny');

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      code: 'kycRequired',
      reason: 'Cadastro pendente.',
      dispatchBlockPersisted: false,
      retryRequired: true
    }));
    expect(mockReleaseIdentityVerificationWindow).not.toHaveBeenCalled();
  });

  test('returns an existing online challenge before sampling a different flow source', async () => {
    const pendingChallenge = {
      challengeId: 'kyc_ch_pending_online',
      driverId: 'driver-pending-online',
      requirement: 'LIVENESS_REQUIRED',
      source: 'driver_online',
      status: 'pending'
    };
    const kycPolicyService = {
      requireApprovedKyc: jest.fn(async () => ({ allowed: true })),
      getStepUpChallenge: jest.fn(async () => pendingChallenge),
      getOrCreateStepUpChallenge: jest.fn()
    };
    const harness = createHarness({ kycPolicyService });

    const result = await harness.service.evaluateOnlineGate('driver-pending-online');

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: 'KYC_ONLINE_CHALLENGE_PENDING',
      challenge: pendingChallenge
    }));
    expect(kycPolicyService.getOrCreateStepUpChallenge).not.toHaveBeenCalled();
    expect(harness.randomInt).not.toHaveBeenCalled();
  });

  test('promotes canonical evidence from 24h to 72h and then to weekly', async () => {
    const harness = createHarness();
    const driverId = 'driver-progression';
    const firstStageDays = [1, 2, 3, 4, 5, 6, 7];

    let result = null;
    for (const day of firstStageDays) {
      const verifiedAt = `2026-07-${String(day).padStart(2, '0')}T15:00:00.000Z`;
      harness.setNow(verifiedAt);
      result = await harness.service.recordCanonicalSuccess(
        driverId,
        canonicalEvidence(driverId, `session-${day}`, verifiedAt)
      );
    }

    expect(result.state.trustTier).toBe(TRUST_TIERS.OBSERVED);
    expect(result.state.successCount).toBe(7);
    expect(result.state.distinctSuccessDays).toBe(7);
    expect(Date.parse(result.state.nextVerificationAt) - Date.parse(result.state.lastVerifiedAt))
      .toBe(72 * 60 * 60 * 1000);

    const remainingDays = [10, 13, 16, 19, 22, 25, 31];
    for (const day of remainingDays) {
      const verifiedAt = `2026-07-${String(day).padStart(2, '0')}T15:00:00.000Z`;
      harness.setNow(verifiedAt);
      result = await harness.service.recordCanonicalSuccess(
        driverId,
        canonicalEvidence(driverId, `session-${day}`, verifiedAt)
      );
    }

    expect(result.state.trustTier).toBe(TRUST_TIERS.TRUSTED);
    expect(result.state.successCount).toBe(14);
    expect(result.state.distinctSuccessDays).toBe(14);
    expect(Date.parse(result.state.nextVerificationAt) - Date.parse(result.state.lastVerifiedAt))
      .toBe(168 * 60 * 60 * 1000);
  });

  test('records an AWS session once even when the canonical callback is replayed', async () => {
    const harness = createHarness();
    const driverId = 'driver-idempotent';
    const verifiedAt = '2026-07-01T15:00:00.000Z';
    const evidence = canonicalEvidence(driverId, 'session-idempotent', verifiedAt);

    const first = await harness.service.recordCanonicalSuccess(driverId, evidence);
    const replay = await harness.service.recordCanonicalSuccess(driverId, evidence);

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.state.successCount).toBe(1);
    expect(replay.state.distinctSuccessDays).toBe(1);
  });

  test('binds AWS CompareFaces evidence to the exact approved CNH path and crop', async () => {
    const driverId = 'driver-aws-binding-v2';
    const documentPath = `driver-activation/${driverId}/cnh/current.pdf`;
    const pathHash = crypto.createHash('sha256').update(documentPath).digest('hex');
    const harness = createHarness({
      realtimeReader: jest.fn(async () => ({
        status: 'approved',
        analysisStatus: 'approved',
        lastSubmissionId: 'cnh-submission-1',
        filePath: documentPath
      })),
      resolveBiometricPolicy: () => ({
        productionBiometricsEnabled: true,
        trustedMatchProviders: ['leaf_face_compare_service'],
        canonicalTrustedMatchProviders: [
          'leaf_face_compare_service',
          'aws_rekognition_compare_faces'
        ]
      })
    });
    const reference = {
      bindingVersion: 2,
      source: 'approved_cnh_pdf_crop_v1',
      documentType: 'cnh',
      model: 'aws_rekognition_compare_faces_managed',
      submissionId: 'cnh-submission-1',
      documentPathSha256: pathHash,
      imageSha256: 'a'.repeat(64),
      cropVersion: 'cnh_digital_photo_crop_v1',
      createdAt: '2026-07-01T12:00:00.000Z'
    };
    const evidence = canonicalEvidence(
      driverId,
      'session-aws-binding-v2',
      '2026-07-01T15:00:00.000Z',
      {
        provider: 'aws_rekognition_compare_faces',
        comparisonProvider: 'aws_rekognition_compare_faces',
        similarityScore: 0.97,
        threshold: 0.95,
        reviewThreshold: 0.80,
        embeddingDimension: null,
        currentModel: 'aws_rekognition_compare_faces_managed',
        reference
      }
    );

    const result = await harness.service.recordCanonicalSuccess(driverId, evidence);

    expect(result.idempotentReplay).toBe(false);
    expect(result.state.referenceFingerprint).toBe(
      harness.service.buildReferenceFingerprint(evidence)
    );
    await expect(harness.service.recordCanonicalSuccess(driverId, {
      ...evidence,
      awsSessionId: 'session-aws-binding-tampered',
      reference: {
        ...reference,
        documentPathSha256: 'b'.repeat(64)
      }
    })).rejects.toMatchObject({
      code: 'KYC_CANONICAL_CNH_REFERENCE_BINDING_INVALID'
    });
  });

  test('restores reconciliation only from complete hash-verified canonical evidence', async () => {
    const harness = createHarness();
    const driverId = 'driver-restore-canonical';
    const sessionId = 'session-restore-canonical';
    const challengeId = 'idrev_restore_canonical';
    const recorded = await harness.service.recordCanonicalSuccess(
      driverId,
      canonicalEvidence(driverId, sessionId, '2026-07-01T15:00:00.000Z', {
        challengeId,
        requirement: 'IDENTITY_REVERIFICATION'
      })
    );
    const storedEvidence = harness.firestore.documents.get(
      `driver_identity_trust/${driverId}/evidence/${recorded.evidenceId}`
    );

    expect(harness.service.restoreApprovedIdentityVerification(
      driverId,
      recorded.evidenceId,
      storedEvidence,
      { challengeId, requirement: 'IDENTITY_REVERIFICATION' }
    )).toEqual(expect.objectContaining({
      userId: driverId,
      isMatch: true,
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION'
    }));
    expect(harness.service.restoreApprovedIdentityVerification(
      driverId,
      recorded.evidenceId,
      {
        ...storedEvidence,
        liveness: {
          ...storedEvidence.liveness,
          confidence: storedEvidence.liveness.threshold - 1
        }
      },
      { challengeId, requirement: 'IDENTITY_REVERIFICATION' }
    )).toBeNull();
    expect(harness.service.restoreApprovedIdentityVerification(
      driverId,
      recorded.evidenceId,
      {
        evidenceId: recorded.evidenceId,
        driverId,
        status: 'approved',
        challengeId,
        requirement: 'IDENTITY_REVERIFICATION'
      },
      { challengeId, requirement: 'IDENTITY_REVERIFICATION' }
    )).toBeNull();
  });

  test('rejects a replay when any canonical evidence field diverges', async () => {
    const harness = createHarness();
    const driverId = 'driver-replay-conflict';
    const verifiedAt = '2026-07-01T15:00:00.000Z';
    const evidence = canonicalEvidence(driverId, 'session-conflict', verifiedAt);

    await harness.service.recordCanonicalSuccess(driverId, evidence);

    await expect(harness.service.recordCanonicalSuccess(driverId, {
      ...evidence,
      similarityScore: 0.99
    })).rejects.toMatchObject({
      code: 'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT'
    });
  });

  test('resolves a step-up challenge atomically with canonical trust evidence', async () => {
    const harness = createHarness();
    const driverId = 'driver-challenge-atomic';
    const challengeId = 'kyc_ch_atomic';
    harness.firestore.documents.set(`kyc_stepup_challenges/${challengeId}`, {
      challengeId,
      driverId,
      requirement: 'LIVENESS_REQUIRED',
      source: 'driver_online_random_audit',
      status: 'pending',
      expiresAt: '2026-07-01T15:20:00.000Z'
    });

    const result = await harness.service.recordCanonicalSuccess(
      driverId,
      canonicalEvidence(driverId, 'session-atomic', '2026-07-01T15:00:00.000Z', {
        challengeId,
        challengeSource: 'driver_online_random_audit',
        requirement: 'LIVENESS_REQUIRED',
        randomAuditDay: '2026-07-01',
        resolveStepUpChallenge: true
      })
    );

    expect(result.idempotentReplay).toBe(false);
    expect(harness.firestore.documents.get(`kyc_stepup_challenges/${challengeId}`))
      .toEqual(expect.objectContaining({
        status: 'resolved',
        resolution: expect.objectContaining({ evidenceId: result.evidenceId })
      }));
    expect(harness.firestore.documents.get(`driver_identity_trust/${driverId}`))
      .toEqual(expect.objectContaining({
        status: 'active',
        stateRevision: 1,
        lastRandomAuditSatisfiedDay: '2026-07-01'
      }));
  });

  test('rejects canonical promotion when the embedding is not from the currently approved CNH', async () => {
    const harness = createHarness({
      realtimeReader: jest.fn(async () => ({
        status: 'approved',
        lastSubmissionId: 'new-cnh-submission'
      }))
    });

    await expect(harness.service.recordCanonicalSuccess(
      'driver-stale-cnh',
      canonicalEvidence('driver-stale-cnh', 'session-stale-cnh', '2026-07-01T15:00:00.000Z')
    )).rejects.toMatchObject({
      code: 'KYC_CANONICAL_CNH_SUBMISSION_MISMATCH'
    });
  });

  test('rejects an internally inconsistent provider approval', async () => {
    const harness = createHarness();

    await expect(harness.service.recordCanonicalSuccess(
      'driver-inconsistent-score',
      canonicalEvidence(
        'driver-inconsistent-score',
        'session-inconsistent-score',
        '2026-07-01T15:00:00.000Z',
        { similarityScore: 0.4, threshold: 0.61 }
      )
    )).rejects.toMatchObject({
      code: 'KYC_CANONICAL_FACE_MATCH_INVALID'
    });
  });

  test('revokes existing canonical trust after a provider-backed face mismatch', async () => {
    const harness = createHarness();
    const driverId = 'driver-revoked';
    await harness.service.recordCanonicalSuccess(
      driverId,
      canonicalEvidence(driverId, 'session-before-failure', '2026-07-01T15:00:00.000Z')
    );

    const result = await harness.service.recordCanonicalFailure(driverId, {
      awsSessionId: 'session-mismatch-failure',
      reason: 'identity_reverification_failed',
      decision: 'reject',
      similarityScore: 0.2
    });

    expect(result.state).toEqual(expect.objectContaining({
      status: 'revoked',
      trustTier: TRUST_TIERS.NEW,
      stateRevision: 2,
      revocationReason: 'identity_reverification_failed'
    }));
    expect(result.idempotentReplay).toBe(false);
    expect(harness.firestore.documents.get(
      `driver_identity_trust/${driverId}/evidence/${result.evidenceId}`
    )).toEqual(expect.objectContaining({
      terminalOutcome: 'face_compare_failed',
      decision: 'reject'
    }));

    const replay = await harness.service.recordCanonicalFailure(driverId, {
      awsSessionId: 'session-mismatch-failure',
      reason: 'identity_reverification_failed',
      decision: 'reject',
      similarityScore: 0.2
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.state.stateRevision).toBe(2);
    await expect(harness.service.evaluateAdaptiveCadence(driverId)).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'KYC_CANONICAL_EVIDENCE_REVOKED'
      })
    );
  });

  test('restores only a session-bound canonical rejection for crash reconciliation', async () => {
    const harness = createHarness();
    const driverId = 'driver-rejected-reconciliation';
    const sessionId = 'session-rejected-reconciliation';
    const challengeId = 'idrev_rejected_reconciliation';
    const result = await harness.service.recordCanonicalFailure(driverId, {
      awsSessionId: sessionId,
      sourcePath: 'server_side_aws_reference_compare',
      reason: 'identity_reverification_failed',
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      decision: 'reject',
      similarityScore: 0.2,
      referenceImageSha256: 'a'.repeat(64)
    });
    const storedEvidence = harness.firestore.documents.get(
      `driver_identity_trust/${driverId}/evidence/${result.evidenceId}`
    );

    expect(harness.service.restoreRejectedIdentityVerification(
      driverId,
      result.evidenceId,
      storedEvidence,
      { challengeId, requirement: 'IDENTITY_REVERIFICATION' }
    )).toEqual(expect.objectContaining({
      success: false,
      userId: driverId,
      isMatch: false,
      evidenceId: result.evidenceId,
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION'
    }));
    expect(harness.service.restoreRejectedIdentityVerification(
      driverId,
      result.evidenceId,
      storedEvidence,
      { challengeId: 'idrev_other', requirement: 'IDENTITY_REVERIFICATION' }
    )).toBeNull();
    expect(harness.service.restoreRejectedIdentityVerification(
      driverId,
      result.evidenceId,
      { ...storedEvidence, referenceImageSha256: null },
      { challengeId, requirement: 'IDENTITY_REVERIFICATION' }
    )).toBeNull();
  });

  test('does not revoke Redis trust when a failure replays an already successful AWS session', async () => {
    const harness = createHarness();
    const driverId = 'driver-success-replay';
    const sessionId = 'session-success-replay';
    const success = await harness.service.recordCanonicalSuccess(
      driverId,
      canonicalEvidence(driverId, sessionId, '2026-07-01T15:00:00.000Z')
    );
    const compatibilityKey = `kyc_verification:${driverId}`;
    const compatibilityBefore = harness.redis.values.get(compatibilityKey);
    harness.redis.del.mockClear();

    const replay = await harness.service.recordCanonicalFailure(driverId, {
      awsSessionId: sessionId,
      reason: 'canonical_face_compare_failed'
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.state.status).toBe('active');
    expect(replay.state.stateRevision).toBe(success.state.stateRevision);
    expect(harness.redis.values.get(compatibilityKey)).toBe(compatibilityBefore);
    expect(harness.redis.del).not.toHaveBeenCalledWith(compatibilityKey);
  });

  test('accepts only canonical compatibility cache while adaptive cadence is disabled', async () => {
    const harness = createHarness({
      env: { KYC_TRUST_CADENCE_ENABLED: 'false' }
    });
    const driverId = 'driver-canonical-fallback';
    harness.redis.values.set(`kyc_verification:${driverId}`, JSON.stringify({
      success: true,
      isMatch: true,
      timestamp: Date.parse('2026-07-01T14:30:00.000Z'),
      mode: 'server_biometric_selfie_v1'
    }));

    const legacyResult = await harness.service.evaluateOnlineGate(driverId);
    expect(legacyResult).toEqual(expect.objectContaining({
      allowed: false,
      code: 'kycRequired'
    }));

    harness.redis.values.set(`kyc_verification:${driverId}`, JSON.stringify({
      success: true,
      isMatch: true,
      timestamp: Date.parse('2026-07-01T14:30:00.000Z'),
      mode: 'canonical_identity_trust_v1',
      evidenceId: 'evidence-canonical',
      policyVersion: 'driver_identity_recurring_v1'
    }));

    const canonicalResult = await harness.service.evaluateOnlineGate(driverId);
    expect(canonicalResult).toEqual(expect.objectContaining({
      allowed: true,
      code: 'kycValid'
    }));
  });

  test('samples a weekly driver only once per active day and reuses the decision', async () => {
    const randomInt = jest.fn(() => 0);
    const harness = createHarness({ randomInt });
    const driverId = 'driver-random-audit';
    harness.firestore.documents.set(`driver_identity_trust/${driverId}`, {
      schemaVersion: 1,
      policyVersion: 'driver_identity_recurring_v1',
      driverId,
      status: 'active',
      trustTier: TRUST_TIERS.TRUSTED,
      successCount: 20,
      distinctSuccessDays: 20,
      firstVerifiedAt: '2026-05-01T15:00:00.000Z',
      lastVerifiedAt: '2026-07-10T15:00:00.000Z',
      nextVerificationAt: '2026-07-17T15:00:00.000Z',
      lastSuccessDay: '2026-07-10',
      lastRandomAuditSatisfiedDay: null
    });
    harness.setNow('2026-07-13T15:00:00.000Z');

    const first = await harness.service.evaluateAdaptiveCadence(driverId);
    const second = await harness.service.evaluateAdaptiveCadence(driverId);

    expect(first).toEqual(expect.objectContaining({
      allowed: false,
      code: 'KYC_TRUST_RANDOM_AUDIT_REQUIRED',
      tier: TRUST_TIERS.TRUSTED
    }));
    expect(second.code).toBe('KYC_TRUST_RANDOM_AUDIT_REQUIRED');
    expect(randomInt).toHaveBeenCalledTimes(1);
    expect(harness.redis.set).toHaveBeenCalledWith(
      expect.stringContaining(`driver-random-audit:${first.today}`),
      expect.any(String),
      'EX',
      expect.any(Number),
      'NX'
    );
  });

  test('never samples a random audit before the weekly trust tier', async () => {
    const randomInt = jest.fn(() => 0);
    const harness = createHarness({
      randomInt,
      env: { KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '100' }
    });
    const driverId = 'driver-observed-no-random';
    harness.firestore.documents.set(`driver_identity_trust/${driverId}`, {
      schemaVersion: 1,
      stateRevision: 1,
      policyVersion: 'driver_identity_recurring_v1',
      driverId,
      status: 'active',
      trustTier: TRUST_TIERS.OBSERVED,
      successCount: 8,
      distinctSuccessDays: 8,
      firstVerifiedAt: '2026-06-01T15:00:00.000Z',
      lastVerifiedAt: '2026-07-12T15:00:00.000Z',
      nextVerificationAt: '2026-07-15T15:00:00.000Z',
      lastSuccessDay: '2026-07-12',
      lastRandomAuditSatisfiedDay: null
    });
    harness.setNow('2026-07-13T15:00:00.000Z');

    const result = await harness.service.evaluateAdaptiveCadence(driverId);

    expect(result).toEqual(expect.objectContaining({
      allowed: true,
      tier: TRUST_TIERS.OBSERVED,
      code: 'KYC_TRUST_VALID'
    }));
    expect(randomInt).not.toHaveBeenCalled();
  });

  test('keeps one persisted random decision under concurrent heartbeats', async () => {
    const randomInt = jest.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(9999);
    const harness = createHarness({ randomInt });

    const [first, second] = await Promise.all([
      harness.service.sampleRandomAuditOncePerDay('driver-concurrent-audit', '2026-07-13'),
      harness.service.sampleRandomAuditOncePerDay('driver-concurrent-audit', '2026-07-13')
    ]);

    expect(first.selected).toBe(true);
    expect(second.selected).toBe(true);
    expect(harness.redis.values.size).toBe(1);
  });

  test('fails closed when a weekly random-audit decision cannot be persisted', async () => {
    const redisError = new Error('redis unavailable');
    const harness = createHarness({
      redis: {
        get: jest.fn(async () => { throw redisError; }),
        set: jest.fn(async () => { throw redisError; }),
        del: jest.fn(async () => 0)
      }
    });

    await expect(harness.service.sampleRandomAuditOncePerDay(
      'driver-audit-store-down',
      '2026-07-13'
    )).rejects.toMatchObject({
      code: 'KYC_RANDOM_AUDIT_STORE_UNAVAILABLE'
    });
  });

  test('never claims a canonical verification session during an active trip', async () => {
    const harness = createHarness({
      activeTripResolver: jest.fn(async () => ({ tripId: 'trip-active' }))
    });

    await expect(harness.service.claimCanonicalSession(
      'driver-active-claim',
      'session-active-claim'
    )).rejects.toMatchObject({
      code: 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
      activeTripId: 'trip-active'
    });
    expect(harness.redis.set).not.toHaveBeenCalled();
  });

  test('retains the outside-ride window and returns durable evidence for reconciliation', async () => {
    const harness = createHarness();
    const driverId = 'driver-reconcile';
    const sessionId = 'session-reconcile';
    const sessionHash = crypto.createHash('sha256')
      .update(`${driverId}:${sessionId}`)
      .digest('hex');
    const existingEvidence = {
      evidenceId: sessionHash,
      driverId,
      sourcePath: 'server_side_aws_reference_compare',
      status: 'approved',
      challengeId: 'idrev_reconcile',
      requirement: 'IDENTITY_REVERIFICATION'
    };
    harness.firestore.documents.set(
      `driver_identity_trust/${driverId}/evidence/${sessionHash}`,
      existingEvidence
    );

    const claim = await harness.service.claimCanonicalSession(driverId, sessionId);

    expect(claim).toEqual(expect.objectContaining({
      acquired: true,
      consumed: true,
      sessionHash,
      existingEvidence,
      verificationWindowClaim: expect.objectContaining({ acquired: true })
    }));
    expect(mockReleaseIdentityVerificationWindow).not.toHaveBeenCalled();
  });

  test('serializes concurrent reconciliation claims for the same consumed session', async () => {
    const harness = createHarness();
    const driverId = 'driver-reconcile-mutex';
    const sessionId = 'session-reconcile-mutex';
    const sessionHash = crypto.createHash('sha256')
      .update(`${driverId}:${sessionId}`)
      .digest('hex');
    harness.firestore.documents.set(
      `driver_identity_trust/${driverId}/evidence/${sessionHash}`,
      {
        evidenceId: sessionHash,
        driverId,
        status: 'approved'
      }
    );

    const first = await harness.service.claimCanonicalSession(driverId, sessionId);
    const second = await harness.service.claimCanonicalSession(driverId, sessionId);

    expect(first).toEqual(expect.objectContaining({
      acquired: true,
      consumed: true,
      busy: false
    }));
    expect(second).toEqual(expect.objectContaining({
      acquired: false,
      consumed: true,
      busy: true
    }));
    expect(first.key).toBe(second.key);
  });

  test('renews the canonical session and driver window together with token checks', async () => {
    const redis = createRedis();
    redis.eval = jest.fn().mockResolvedValue(1);
    const harness = createHarness({ redis });
    const claim = {
      acquired: true,
      key: 'kyc:identity-trust:session-claim:driver-1:session-1',
      token: 'session-token',
      verificationWindowClaim: {
        key: 'kyc:identity-verification-window:driver-1',
        token: 'window-token'
      }
    };

    await expect(harness.service.renewCanonicalSessionClaim(claim)).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("expire", KEYS[2]'),
      2,
      claim.key,
      claim.verificationWindowClaim.key,
      claim.token,
      claim.verificationWindowClaim.token,
      expect.any(String),
      expect.any(String)
    );
  });

  test('a random audit completed today is not requested again', async () => {
    const randomInt = jest.fn(() => 0);
    const harness = createHarness({ randomInt });
    const driverId = 'driver-random-satisfied';
    harness.setNow('2026-07-13T15:00:00.000Z');
    harness.firestore.documents.set(`driver_identity_trust/${driverId}`, {
      schemaVersion: 1,
      policyVersion: 'driver_identity_recurring_v1',
      driverId,
      status: 'active',
      trustTier: TRUST_TIERS.TRUSTED,
      successCount: 20,
      distinctSuccessDays: 20,
      firstVerifiedAt: '2026-05-01T15:00:00.000Z',
      lastVerifiedAt: '2026-07-12T15:00:00.000Z',
      nextVerificationAt: '2026-07-19T15:00:00.000Z',
      lastSuccessDay: '2026-07-12',
      lastRandomAuditSatisfiedDay: '2026-07-13'
    });

    const result = await harness.service.evaluateAdaptiveCadence(driverId);

    expect(result.allowed).toBe(true);
    expect(result.code).toBe('KYC_TRUST_VALID');
    expect(randomInt).not.toHaveBeenCalled();
  });

  test('caps weekly validity and random audit percentage in configuration', () => {
    const harness = createHarness({
      env: {
        KYC_TRUST_T2_MAX_AGE_HOURS: '720',
        KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '250'
      }
    });

    expect(harness.service.getConfig()).toEqual(expect.objectContaining({
      trustedMaxAgeHours: 168,
      randomAuditPercent: 100
    }));
  });
});
