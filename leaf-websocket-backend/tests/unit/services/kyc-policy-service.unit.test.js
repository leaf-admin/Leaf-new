jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const mockHasValidVerification = jest.fn();
const mockResolveActiveTripForDriver = jest.fn();
const mockClaimIdentityPolicyMutationWindow = jest.fn();
const mockReleaseIdentityPolicyMutationWindow = jest.fn();
const mockRealtimeValues = {};
const mockRealtimeSnapshot = (value) => ({
  exists: () => value !== undefined && value !== null,
  val: () => value ?? null
});
const mockRealtimeRef = jest.fn((path) => ({
  once: jest.fn(async () => mockRealtimeSnapshot(mockRealtimeValues[path])),
  transaction: jest.fn(async (updater) => {
    const currentValue = mockRealtimeValues[path] ?? null;
    const nextValue = updater(currentValue);
    if (nextValue === undefined) {
      return {
        committed: false,
        snapshot: mockRealtimeSnapshot(currentValue)
      };
    }
    mockRealtimeValues[path] = nextValue;
    return {
      committed: true,
      snapshot: mockRealtimeSnapshot(nextValue)
    };
  })
}));
const mockRealtimeDatabase = { ref: mockRealtimeRef };
const KYC_WINDOW_ENV_KEYS = [
  'KYC_WITHDRAW_VERIFICATION_MAX_AGE_HOURS',
  'KYC_WITHDRAW_LOW_RISK_VERIFICATION_MAX_AGE_HOURS',
  'KYC_WITHDRAW_MEDIUM_RISK_VERIFICATION_MAX_AGE_HOURS',
  'KYC_WITHDRAW_HIGH_RISK_VERIFICATION_MAX_AGE_HOURS'
];

jest.mock('../../../services/IntegratedKYCService', () => {
  return jest.fn().mockImplementation(() => ({
    initialized: true,
    initialize: jest.fn().mockResolvedValue(true),
    hasValidVerification: mockHasValidVerification,
    invalidateVerificationCache: jest.fn().mockResolvedValue(true)
  }));
});

const redisMulti = {
  set: jest.fn(),
  del: jest.fn(),
  exec: jest.fn().mockResolvedValue(true)
};

const mockRedis = {
  multi: jest.fn(() => redisMulti),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  eval: jest.fn().mockResolvedValue(1),
  hset: jest.fn().mockResolvedValue(true),
  zrem: jest.fn().mockResolvedValue(1)
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../utils/active-trip-index', () => ({
  resolveActiveTripForDriver: (...args) => mockResolveActiveTripForDriver(...args),
  claimIdentityPolicyMutationWindow: (...args) => mockClaimIdentityPolicyMutationWindow(...args),
  releaseIdentityPolicyMutationWindow: (...args) => mockReleaseIdentityPolicyMutationWindow(...args)
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getRealtimeDB: jest.fn(() => mockRealtimeDatabase),
  getFromRealtimeDB: jest.fn(() => null),
  updateRealtimeDB: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../services/kyc-driver-status-service', () => ({
  blockDriver: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../services/KYCNotificationService', () => {
  return jest.fn().mockImplementation(() => ({
    sendCustomNotification: jest.fn().mockResolvedValue({ success: true })
  }));
});

jest.mock('../../../services/support-ticket-service', () => ({
  createTicket: jest.fn().mockResolvedValue({
    ticket: {
      id: 'TICKET-LIVENESS-1'
    }
  })
}));

const approvedKycState = () => ({
  usersDoc: { kycStatus: 'approved' },
  driversDoc: {},
  realtimeUser: {}
});

describe('kyc-policy-service', () => {
  let service;

  beforeEach(() => {
    KYC_WINDOW_ENV_KEYS.forEach((key) => {
      delete process.env[key];
    });
    jest.resetModules();
    service = require('../../../services/kyc-policy-service');
    jest.clearAllMocks();
    Object.keys(mockRealtimeValues).forEach((key) => delete mockRealtimeValues[key]);
    mockHasValidVerification.mockResolvedValue({ hasValid: true });
    mockResolveActiveTripForDriver.mockResolvedValue({ tripId: null, customerId: null });
    mockClaimIdentityPolicyMutationWindow.mockReset().mockResolvedValue({
      acquired: true,
      activeTripId: null,
      key: 'kyc:identity-policy-mutation:driver-test',
      token: 'policy-window-token'
    });
    mockReleaseIdentityPolicyMutationWindow.mockReset().mockResolvedValue(true);
  });

  test('isPhotoMismatchReport should return true for mismatch keywords', () => {
    const result = service.isPhotoMismatchReport({
      selectedOptions: ['Motorista diferente da foto'],
      comment: ''
    });
    expect(result).toBe(true);
  });

  test('isPhotoMismatchReport should return false for neutral feedback', () => {
    const result = service.isPhotoMismatchReport({
      selectedOptions: ['Direcao segura'],
      comment: 'Tudo ok'
    });
    expect(result).toBe(false);
  });

  test('isLivenessSatisfied should accept aws payload', () => {
    const result = service.isLivenessSatisfied({
      provider: 'aws_rekognition_face_liveness',
      livenessPassed: true,
      aws: {
        sessionId: 'session-1',
        passed: true
      }
    });
    expect(result).toBe(true);
  });

  test('a pending review in any durable store wins over an approved replica', async () => {
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue({
      usersDoc: { kycStatus: 'pending_review', kycBlocked: false },
      driversDoc: { kycStatus: 'approved', kycBlocked: false },
      realtimeUser: { kycStatus: 'approved', kycBlocked: false },
      redisDriver: { kyc_status: 'approved', kyc_blocked: 'false' }
    });

    await expect(service.requireApprovedKyc('driver-mixed-review')).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'KYC_NOT_APPROVED',
        status: 'pending_review'
      })
    );
  });

  test('a Redis KYC block wins over approved durable replicas', async () => {
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue({
      usersDoc: { kycStatus: 'approved', kycBlocked: false },
      driversDoc: { kycStatus: 'approved', kycBlocked: false },
      realtimeUser: { kycStatus: 'approved', kycBlocked: false },
      redisDriver: { kyc_status: 'blocked', kyc_blocked: 'true' }
    });

    await expect(service.requireApprovedKyc('driver-redis-mixed-block')).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'KYC_BLOCKED',
        status: 'blocked'
      })
    );
  });

  test('evaluateWithdrawalStepUp should return NONE for low risk', async () => {
    jest.spyOn(service, 'collectWithdrawalSignals').mockResolvedValue({
      withdrawals24hCount: 0,
      withdrawals24hCents: 0,
      burstCount: 0,
      signals: []
    });
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue(approvedKycState());

    const result = await service.evaluateWithdrawalStepUp({
      driverId: 'driver-low-risk',
      amountCents: 1200
    });

    expect(result.requirement).toBe('NONE');
    expect(result.riskScore).toBe(0);
    expect(result.verificationWindowTier).toBe('low');
    expect(result.verificationMaxAgeHours).toBe(168);
    expect(result.challenge).toBeNull();
    expect(mockHasValidVerification).toHaveBeenCalledWith('driver-low-risk', 168);
  });

  test('evaluateWithdrawalStepUp should use medium KYC window and avoid AWS liveness for medium stale risk', async () => {
    jest.spyOn(service, 'collectWithdrawalSignals').mockResolvedValue({
      withdrawals24hCount: 0,
      withdrawals24hCents: 0,
      burstCount: 0,
      signals: []
    });
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue(approvedKycState());
    jest.spyOn(service, 'createStepUpChallenge').mockResolvedValue({
      challengeId: 'kyc_ch_medium',
      requirement: 'VERIFY_REQUIRED'
    });
    mockHasValidVerification.mockResolvedValue({ hasValid: false, reason: 'stale' });

    const result = await service.evaluateWithdrawalStepUp({
      driverId: 'driver-medium-risk',
      amountCents: 50000
    });

    expect(mockHasValidVerification).toHaveBeenCalledWith('driver-medium-risk', 72);
    expect(result.verificationWindowTier).toBe('medium');
    expect(result.verificationMaxAgeHours).toBe(72);
    expect(result.preKycRiskScore).toBe(15);
    expect(result.riskScore).toBe(41);
    expect(result.requirement).toBe('VERIFY_REQUIRED');
  });

  test('evaluateWithdrawalStepUp should use high KYC window for high amount risk', async () => {
    jest.spyOn(service, 'collectWithdrawalSignals').mockResolvedValue({
      withdrawals24hCount: 0,
      withdrawals24hCents: 0,
      burstCount: 0,
      signals: []
    });
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue(approvedKycState());

    const result = await service.evaluateWithdrawalStepUp({
      driverId: 'driver-high-risk',
      amountCents: 120000
    });

    expect(mockHasValidVerification).toHaveBeenCalledWith('driver-high-risk', 24);
    expect(result.verificationWindowTier).toBe('high');
    expect(result.verificationMaxAgeHours).toBe(24);
    expect(result.preKycRiskScore).toBe(37);
  });

  test('evaluateWithdrawalStepUp should require liveness when driver is flagged for reverify', async () => {
    jest.spyOn(service, 'collectWithdrawalSignals').mockResolvedValue({
      withdrawals24hCount: 1,
      withdrawals24hCents: 45000,
      burstCount: 1,
      signals: []
    });
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue({
      usersDoc: {
        kycStatus: 'approved',
        kycReverifyRequired: true,
        kycReverifyReason: 'pending_reverify'
      },
      driversDoc: {},
      realtimeUser: {}
    });
    jest.spyOn(service, 'createStepUpChallenge').mockResolvedValue({
      challengeId: 'kyc_ch_1',
      requirement: 'LIVENESS_REQUIRED'
    });
    mockHasValidVerification.mockResolvedValue({ hasValid: false, reason: 'stale' });

    const result = await service.evaluateWithdrawalStepUp({
      driverId: 'driver-flagged',
      amountCents: 20000
    });

    expect(result.requirement).toBe('LIVENESS_REQUIRED');
    expect(result.riskScore).toBeGreaterThanOrEqual(100);
    expect(result.challenge).toEqual({
      challengeId: 'kyc_ch_1',
      requirement: 'LIVENESS_REQUIRED'
    });
    expect(result.signals.some((item) => item.code === 'REVERIFY_REQUIRED')).toBe(true);
  });

  test('evaluateWithdrawalStepUp should block withdrawal when KYC is not approved', async () => {
    jest.spyOn(service, 'collectWithdrawalSignals').mockResolvedValue({
      withdrawals24hCount: 0,
      withdrawals24hCents: 0,
      burstCount: 0,
      signals: []
    });
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue({
      usersDoc: { kycStatus: 'pending_review' },
      driversDoc: {},
      realtimeUser: {}
    });

    const result = await service.evaluateWithdrawalStepUp({
      driverId: 'driver-pending-review',
      amountCents: 1200
    });

    expect(result.requirement).toBe('KYC_APPROVAL_REQUIRED');
    expect(result.riskScore).toBe(100);
    expect(result.challenge).toBeNull();
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KYC_NOT_APPROVED'
        })
      ])
    );
    expect(mockHasValidVerification).not.toHaveBeenCalled();
  });

  test('getOrCreateStepUpChallenge reuses the active pending challenge for single-flight', async () => {
    const existing = {
      challengeId: 'kyc_ch_existing',
      driverId: 'driver-single-flight',
      requirement: 'LIVENESS_REQUIRED',
      source: 'driver_online_random_audit',
      metadata: { randomAuditDay: '2026-07-13' },
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    jest.spyOn(service, 'getStepUpChallenge').mockResolvedValue(existing);
    const createSpy = jest.spyOn(service, 'createStepUpChallenge');

    const result = await service.getOrCreateStepUpChallenge({
      driverId: 'driver-single-flight',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: 'driver_online_random_audit',
      signals: []
    });

    expect(result).toEqual({
      ...existing,
      metadata: {
        randomAuditDay: '2026-07-13',
        challengeSource: 'driver_online_random_audit'
      }
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('getOrCreateStepUpChallenge preserves source-less legacy callers without cross-flow reuse', async () => {
    const existing = {
      challengeId: 'kyc_ch_legacy',
      driverId: 'driver-legacy',
      requirement: 'VERIFY_REQUIRED',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    jest.spyOn(service, 'getStepUpChallenge').mockResolvedValue(existing);
    const createSpy = jest.spyOn(service, 'createStepUpChallenge');

    const result = await service.getOrCreateStepUpChallenge({
      driverId: 'driver-legacy',
      requirement: 'VERIFY_REQUIRED',
      score: 41,
      signals: []
    });

    expect(result).toEqual({
      ...existing,
      source: 'legacy',
      metadata: { challengeSource: 'legacy' }
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('getOrCreateStepUpChallenge rejects reuse across sources for the same requirement', async () => {
    jest.spyOn(service, 'getStepUpChallenge').mockResolvedValue({
      challengeId: 'kyc_ch_withdrawal',
      driverId: 'driver-source-conflict',
      requirement: 'LIVENESS_REQUIRED',
      source: 'withdrawal',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const createSpy = jest.spyOn(service, 'createStepUpChallenge');

    await expect(service.getOrCreateStepUpChallenge({
      driverId: 'driver-source-conflict',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: 'driver_online_random_audit',
      signals: []
    })).rejects.toEqual(expect.objectContaining({
      code: 'KYC_CHALLENGE_SOURCE_CONFLICT',
      activeChallengeId: 'kyc_ch_withdrawal',
      activeSource: 'withdrawal',
      requestedSource: 'driver_online_random_audit',
      requirement: 'LIVENESS_REQUIRED'
    }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('requires durable Firestore persistence for canonical online challenges', async () => {
    await expect(service.createStepUpChallenge({
      driverId: 'driver-durable-challenge',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: 'driver_online_random_audit',
      signals: [],
      metadata: {
        canonicalEvidenceRequired: true,
        randomAuditDay: '2026-07-13'
      }
    })).rejects.toMatchObject({
      code: 'KYC_CHALLENGE_DURABLE_STORE_UNAVAILABLE'
    });

    expect(mockRedis.del).toHaveBeenCalledWith(expect.stringMatching(/^kyc:stepup:challenge:/));
    expect(mockRedis.del).toHaveBeenCalledWith('kyc:stepup:active:driver-durable-challenge');
  });

  test('getOrCreateStepUpChallenge coalesces concurrent requests into one challenge', async () => {
    jest.spyOn(service, 'getStepUpChallenge').mockResolvedValue(null);
    const created = {
      challengeId: 'kyc_ch_concurrent',
      driverId: 'driver-concurrent',
      requirement: 'LIVENESS_REQUIRED',
      status: 'pending'
    };
    const createSpy = jest.spyOn(service, 'createStepUpChallenge').mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return created;
    });
    const input = {
      driverId: 'driver-concurrent',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: 'driver_online_random_audit',
      signals: []
    };

    const [first, second] = await Promise.all([
      service.getOrCreateStepUpChallenge(input),
      service.getOrCreateStepUpChallenge(input)
    ]);

    expect(first).toBe(created);
    expect(second).toBe(created);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'kyc:stepup:create-lock:driver-concurrent',
      expect.any(String),
      'EX',
      5,
      'NX'
    );
  });

  test('getOrCreateStepUpChallenge does not coalesce different sources in memory', async () => {
    const distributedSpy = jest
      .spyOn(service, 'getOrCreateStepUpChallengeDistributed')
      .mockImplementation(async (input) => ({
        challengeId: `kyc_ch_${input.source}`,
        driverId: input.driverId,
        requirement: input.requirement,
        source: input.source,
        metadata: input.metadata,
        status: 'pending'
      }));

    const commonInput = {
      driverId: 'driver-multiple-flows',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      signals: []
    };
    const [onlineChallenge, auditChallenge] = await Promise.all([
      service.getOrCreateStepUpChallenge({
        ...commonInput,
        source: 'driver_online'
      }),
      service.getOrCreateStepUpChallenge({
        ...commonInput,
        source: 'driver_online_random_audit'
      })
    ]);

    expect(distributedSpy).toHaveBeenCalledTimes(2);
    expect(onlineChallenge.source).toBe('driver_online');
    expect(auditChallenge.source).toBe('driver_online_random_audit');
  });

  test('createStepUpChallenge persists normalized source in payload and metadata', async () => {
    const result = await service.createStepUpChallenge({
      driverId: 'driver-source-persistence',
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: ' driver_online ',
      metadata: { reason: 'online_step_up' },
      signals: []
    });

    expect(result).toEqual(expect.objectContaining({
      source: 'driver_online',
      metadata: {
        reason: 'online_step_up',
        challengeSource: 'driver_online'
      }
    }));
    const serializedChallenge = redisMulti.set.mock.calls
      .map((call) => call[1])
      .find((value) => typeof value === 'string' && value.includes(result.challengeId));
    expect(JSON.parse(serializedChallenge)).toEqual(expect.objectContaining({
      source: 'driver_online',
      metadata: {
        reason: 'online_step_up',
        challengeSource: 'driver_online'
      }
    }));
  });

  test('getStepUpChallenge rejects an expired Redis challenge', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      challengeId: 'kyc_ch_expired',
      driverId: 'driver-expired',
      requirement: 'LIVENESS_REQUIRED',
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    }));

    await expect(service.getStepUpChallenge('kyc_ch_expired', 'driver-expired'))
      .resolves.toBeNull();
  });

  test('resolveStepUpChallenge cannot downgrade a backend liveness requirement', async () => {
    jest.spyOn(service, 'getStepUpChallenge').mockResolvedValue({
      challengeId: 'kyc_ch_liveness',
      driverId: 'driver-no-downgrade',
      requirement: 'LIVENESS_REQUIRED',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    jest.spyOn(service, 'isLivenessSatisfied').mockReturnValue(false);

    const result = await service.resolveStepUpChallenge({
      challengeId: 'kyc_ch_liveness',
      driverId: 'driver-no-downgrade',
      requirement: 'VERIFY_REQUIRED',
      verificationPayload: { isMatch: true }
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_LIVENESS_REQUIRED'
    }));
    expect(redisMulti.del).not.toHaveBeenCalled();
  });

  test('markDriverForPhotoMismatch soft-blocks dispatch eligibility and asks for subtle reverify', async () => {
    const firebaseConfig = require('../../../firebase-config');

    const result = await service.markDriverForPhotoMismatch({
      driverId: 'driver-kyc-blocked',
      tripId: 'trip_1',
      reporterId: 'customer_1',
      payload: {
        selectedOptions: ['Motorista diferente da foto'],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        driverId: 'driver-kyc-blocked',
        reverifyRequired: true,
        softBlocked: true,
        reason: 'Por segurança, precisamos validar sua identidade.',
      }),
    );
    expect(firebaseConfig.updateRealtimeDB).toHaveBeenCalledWith(
      'users/driver-kyc-blocked',
      expect.objectContaining({
        kycReverifyRequired: true,
        kycBlocked: false,
        kycStatus: 'pending_reverify',
      }),
    );
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'driver:driver-kyc-blocked',
      expect.objectContaining({
        kyc_blocked: 'false',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'KYC_REVERIFY_REQUIRED',
      }),
    );
    expect(mockRedis.zrem).toHaveBeenCalledWith(
      'driver_locations_eligible',
      'driver-kyc-blocked',
    );
  });

  test('defers photo-mismatch revalidation while the driver has an active trip', async () => {
    const firebaseConfig = require('../../../firebase-config');
    mockResolveActiveTripForDriver.mockResolvedValueOnce({
      tripId: 'trip-active-1',
      customerId: 'passenger-1'
    });

    const result = await service.markDriverForPhotoMismatch({
      driverId: 'driver-active-1',
      tripId: 'trip-active-1',
      reporterId: 'passenger-1',
      payload: {
        selectedOptions: ['Motorista diferente da foto']
      }
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      deferred: true,
      reverifyRequired: false,
      activeTripId: 'trip-active-1'
    }));
    expect(firebaseConfig.updateRealtimeDB).toHaveBeenCalledWith(
      'users/driver-active-1',
      expect.objectContaining({
        kycReverifyPendingAfterTrip: true,
        kycRecheckPendingAfterTrip: true
      })
    );
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'driver:driver-active-1',
      expect.objectContaining({
        identity_reverification_pending_after_trip: 'true',
        kyc_recheck_pending_after_trip: 'true',
        kycRecheckPendingAfterTrip: 'true',
        kycReverifyPendingAfterTrip: 'true'
      })
    );
    expect(mockRedis.zrem).not.toHaveBeenCalled();
  });

  test('defers photo-mismatch revalidation when the active-trip index is unavailable', async () => {
    mockResolveActiveTripForDriver.mockRejectedValueOnce(new Error('active-trip index unavailable'));

    const result = await service.markDriverForPhotoMismatch({
      driverId: 'driver-active-index-unavailable',
      tripId: 'trip-reported-active',
      reporterId: 'passenger-2',
      payload: {
        selectedOptions: ['Motorista diferente da foto']
      }
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      deferred: true,
      reverifyRequired: false,
      activeTripId: 'trip-reported-active',
      code: 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE'
    }));
    expect(mockRedis.zrem).not.toHaveBeenCalled();
  });

  test('defers photo-mismatch revalidation when a trip wins the race before the policy mutation', async () => {
    mockClaimIdentityPolicyMutationWindow.mockResolvedValueOnce({
      acquired: false,
      activeTripId: 'trip-race-winner',
      key: 'kyc:identity-policy-mutation:driver-race',
      token: 'policy-window-token'
    });

    const result = await service.markDriverForPhotoMismatch({
      driverId: 'driver-race',
      tripId: 'trip-reported',
      reporterId: 'passenger-3',
      payload: { selectedOptions: ['Motorista diferente da foto'] }
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      deferred: true,
      reverifyRequired: false,
      activeTripId: 'trip-race-winner'
    }));
    expect(mockRedis.zrem).not.toHaveBeenCalled();
  });

  test('does not overwrite identity state outside the lock when another policy mutation owns it', async () => {
    const firebaseConfig = require('../../../firebase-config');
    mockClaimIdentityPolicyMutationWindow.mockResolvedValueOnce({
      acquired: false,
      busy: true,
      activeTripId: null,
      key: 'kyc:identity-policy-mutation:driver-policy-busy',
      token: 'policy-window-token'
    });

    const result = await service.markDriverForPhotoMismatch({
      driverId: 'driver-policy-busy',
      payload: { selectedOptions: ['Motorista diferente da foto'] }
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      retryable: true,
      code: 'KYC_POLICY_MUTATION_IN_PROGRESS'
    }));
    expect(firebaseConfig.updateRealtimeDB).not.toHaveBeenCalled();
    expect(mockRedis.hset).not.toHaveBeenCalled();
  });

  test('keeps deferred identity revalidation deferred when the active-trip index is unavailable', async () => {
    mockResolveActiveTripForDriver.mockRejectedValueOnce(new Error('active-trip index unavailable'));
    const applySpy = jest.spyOn(service, 'applyIdentityReverificationGate');

    const result = await service.applyDeferredIdentityReverificationIfSafe(
      'driver-active-index-unknown',
      { tripId: 'trip-unknown' }
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      applied: false,
      deferred: true,
      code: 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE'
    }));
    expect(applySpy).not.toHaveBeenCalled();
  });

  test('keeps post-trip revalidation deferred when a new trip starts before the gate mutation', async () => {
    mockRealtimeValues['users/driver-race-closeout/identityReverification'] = {
      status: 'deferred_until_trip_end',
      challengeId: 'idrev_driver-race-closeout',
      tripId: 'trip-finished'
    };
    mockClaimIdentityPolicyMutationWindow.mockResolvedValueOnce({
      acquired: false,
      activeTripId: 'trip-new',
      key: 'kyc:identity-policy-mutation:driver-race-closeout',
      token: 'policy-window-token'
    });
    const applySpy = jest.spyOn(service, 'applyIdentityReverificationGate');

    const result = await service.applyDeferredIdentityReverificationIfSafe(
      'driver-race-closeout',
      { tripId: 'trip-finished' }
    );

    expect(result).toEqual(expect.objectContaining({
      applied: false,
      deferred: true,
      activeTripId: 'trip-new'
    }));
    expect(applySpy).not.toHaveBeenCalled();
  });

  test('fails closed and keeps the retry when deferred RTDB state is unavailable', async () => {
    const firebaseConfig = require('../../../firebase-config');
    firebaseConfig.getRealtimeDB.mockReturnValueOnce(null);

    const result = await service.applyDeferredIdentityReverificationIfSafe('driver-rtdb-down');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      applied: false,
      deferred: true,
      code: 'KYC_REVERIFY_STATE_UNAVAILABLE'
    }));
  });

  test('applies a deferred gate under the policy lock and clears every retry marker', async () => {
    mockRealtimeValues['users/driver-deferred/identityReverification'] = {
      status: 'deferred_until_trip_end',
      challengeId: 'idrev_driver-deferred',
      reporterType: 'passenger',
      tripId: 'trip-finished'
    };

    const result = await service.applyDeferredIdentityReverificationIfSafe('driver-deferred');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      reverifyRequired: true,
      challengeId: 'idrev_driver-deferred'
    }));
    expect(mockClaimIdentityPolicyMutationWindow).toHaveBeenCalled();
    expect(mockReleaseIdentityPolicyMutationWindow).toHaveBeenCalled();
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'driver:driver-deferred',
      expect.objectContaining({
        identity_reverification_pending_after_trip: 'false',
        kyc_recheck_pending_after_trip: 'false',
        kycRecheckPendingAfterTrip: 'false',
        kycReverifyPendingAfterTrip: 'false'
      })
    );
  });

  test('does not acknowledge a report when critical RTDB state cannot be persisted', async () => {
    const firebaseConfig = require('../../../firebase-config');
    firebaseConfig.updateRealtimeDB.mockResolvedValueOnce(false);

    await expect(service.markDriverForPhotoMismatch({
      driverId: 'driver-persist-failure',
      payload: { selectedOptions: ['Motorista diferente da foto'] }
    })).rejects.toMatchObject({ code: 'KYC_REVERIFY_STATE_PERSIST_FAILED' });
  });

  test('freshness-only verification success never clears a revalidation gate', async () => {
    await service.recordVerificationSuccess('driver-freshness-only', {
      clearReverify: false
    });

    expect(mockRedis.hset).toHaveBeenCalledWith(
      'driver:driver-freshness-only',
      expect.objectContaining({ kyc_last_verification: expect.any(String) })
    );
    const redisPayload = mockRedis.hset.mock.calls.find(
      ([key]) => key === 'driver:driver-freshness-only'
    )[1];
    expect(redisPayload).not.toHaveProperty('kyc_reverify_required');
    expect(redisPayload).not.toHaveProperty('kyc_status');
    expect(redisPayload).not.toHaveProperty('kyc_blocked');
  });

  test('a matching identity challenge can clear its own gate atomically', async () => {
    mockRealtimeValues['users/driver-current'] = {
      identityReverification: {
        challengeId: 'idrev_current',
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'requested',
        notificationSentAt: new Date(Date.now() - 10_000).toISOString(),
        metrics: {}
      },
      kycReverifyRequired: true,
      kycStatus: 'pending_reverify'
    };

    const result = await service.recordIdentityReverificationResult('driver-current', {
      challengeId: 'idrev_current',
      requirement: 'IDENTITY_REVERIFICATION',
      isMatch: true,
      needsReview: false,
      similarityScore: 96,
      decision: 'approve'
    });

    expect(result).toEqual(expect.objectContaining({
      recorded: true,
      status: 'passed'
    }));
    expect(mockRealtimeValues['users/driver-current']).toEqual(expect.objectContaining({
      kycReverifyRequired: false,
      kycRecheckPendingAfterTrip: false,
      kycStatus: 'approved'
    }));
  });

  test('replays an approved identity result after a partial Redis persistence failure', async () => {
    mockRealtimeValues['users/driver-reconcile'] = {
      identityReverification: {
        challengeId: 'idrev_reconcile',
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'requested',
        metrics: {}
      },
      kycReverifyRequired: true,
      kycStatus: 'pending_reverify'
    };
    mockRedis.eval
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const verificationResult = {
      challengeId: 'idrev_reconcile',
      requirement: 'IDENTITY_REVERIFICATION',
      isMatch: true,
      needsReview: false,
      similarityScore: 96,
      decision: 'approve'
    };

    const partial = await service.recordIdentityReverificationResult(
      'driver-reconcile',
      verificationResult
    );
    const reconciled = await service.recordIdentityReverificationResult(
      'driver-reconcile',
      verificationResult
    );

    expect(partial).toEqual(expect.objectContaining({
      recorded: false,
      code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
    }));
    expect(reconciled).toEqual(expect.objectContaining({
      recorded: true,
      status: 'passed'
    }));
    expect(mockRealtimeValues['users/driver-reconcile']).toEqual(expect.objectContaining({
      kycReverifyRequired: false,
      kycStatus: 'approved'
    }));
    expect(mockRedis.eval).toHaveBeenCalledTimes(4);
  });

  test('does not let an older approved identity result clear a later RTDB rejection', async () => {
    const laterRejectedState = {
      identityReverification: {
        challengeId: 'idrev_before_rejection',
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'passed',
        validationCompletedAt: '2026-07-13T20:00:00.000Z',
        metrics: {}
      },
      approved: false,
      status: 'rejected',
      kycStatus: 'rejected',
      kycBlocked: true,
      rejectionReasons: ['document_review_failed'],
      rejectedAt: '2026-07-13T20:05:00.000Z'
    };
    mockRealtimeValues['users/driver-later-rejected'] = laterRejectedState;

    const result = await service.recordIdentityReverificationResult(
      'driver-later-rejected',
      {
        challengeId: 'idrev_before_rejection',
        requirement: 'IDENTITY_REVERIFICATION',
        isMatch: true,
        needsReview: false,
        similarityScore: 96,
        decision: 'approve',
        reconciliationOnly: true
      }
    );

    expect(result).toEqual(expect.objectContaining({
      recorded: false,
      code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
    }));
    expect(mockRealtimeValues['users/driver-later-rejected']).toEqual(laterRejectedState);
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  test('does not let an older approved identity result bypass a later pending review', async () => {
    const laterReviewState = {
      identityReverification: {
        challengeId: 'idrev_before_review',
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'passed',
        validationCompletedAt: '2026-07-13T20:00:00.000Z',
        metrics: {}
      },
      kycStatus: 'pending_review',
      kycBlocked: false,
      reviewReason: 'document_manual_review',
      reviewRequestedAt: '2026-07-13T20:05:00.000Z'
    };
    mockRealtimeValues['users/driver-later-review'] = laterReviewState;

    const result = await service.recordIdentityReverificationResult(
      'driver-later-review',
      {
        challengeId: 'idrev_before_review',
        requirement: 'IDENTITY_REVERIFICATION',
        isMatch: true,
        needsReview: false,
        similarityScore: 96,
        decision: 'approve',
        reconciliationOnly: true
      }
    );

    expect(result).toEqual(expect.objectContaining({
      recorded: false,
      code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
    }));
    expect(mockRealtimeValues['users/driver-later-review']).toEqual(laterReviewState);
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  test('does not overwrite a later Firestore block while reconciling an approved result', async () => {
    const driverId = 'driver-firestore-blocked';
    const challengeId = 'idrev_before_firestore_block';
    mockRealtimeValues[`users/${driverId}`] = {
      identityReverification: {
        challengeId,
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'passed',
        metrics: {}
      },
      kycStatus: 'approved',
      kycBlocked: false
    };
    const documents = new Map([
      [`users/${driverId}`, {
        identityReverification: { challengeId, status: 'passed' },
        kycStatus: 'blocked',
        kycBlocked: true,
        kycBlockedReason: 'admin_review'
      }],
      [`drivers/${driverId}`, {
        identityReverification: { challengeId, status: 'passed' },
        kycStatus: 'blocked',
        kycBlocked: true,
        kycBlockedReason: 'admin_review'
      }]
    ]);
    const refFor = (path) => ({ path });
    const firestore = {
      collection: (name) => ({ doc: (id) => refFor(`${name}/${id}`) }),
      runTransaction: jest.fn(async (handler) => handler({
        get: jest.fn(async (ref) => ({
          exists: documents.has(ref.path),
          data: () => documents.get(ref.path)
        })),
        set: jest.fn((ref, data) => documents.set(ref.path, data))
      }))
    };
    const firebaseConfig = require('../../../firebase-config');
    firebaseConfig.getFirestore
      .mockReturnValueOnce(firestore)
      .mockReturnValueOnce(firestore);
    const admin = require('firebase-admin');
    const originalFirestoreApi = admin.firestore;
    admin.firestore = {
      FieldValue: {
        delete: jest.fn(() => ({ delete: true })),
        serverTimestamp: jest.fn(() => ({ serverTimestamp: true }))
      }
    };

    let result = null;
    try {
      result = await service.recordIdentityReverificationResult(driverId, {
        challengeId,
        requirement: 'IDENTITY_REVERIFICATION',
        isMatch: true,
        needsReview: false,
        similarityScore: 96,
        decision: 'approve',
        reconciliationOnly: true
      });
    } finally {
      admin.firestore = originalFirestoreApi;
    }

    expect(result).toEqual(expect.objectContaining({
      recorded: false,
      code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
    }));
    expect(documents.get(`users/${driverId}`)).toEqual(expect.objectContaining({
      kycStatus: 'blocked',
      kycBlocked: true,
      kycBlockedReason: 'admin_review'
    }));
    expect(documents.get(`drivers/${driverId}`)).toEqual(expect.objectContaining({
      kycStatus: 'blocked',
      kycBlocked: true,
      kycBlockedReason: 'admin_review'
    }));
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  test('does not overwrite a later Redis block while reconciling an approved result', async () => {
    const driverId = 'driver-redis-blocked';
    const challengeId = 'idrev_before_redis_block';
    mockRealtimeValues[`users/${driverId}`] = {
      identityReverification: {
        challengeId,
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'passed',
        metrics: {}
      },
      kycStatus: 'approved',
      kycBlocked: false
    };
    mockRedis.eval.mockResolvedValueOnce(-1);

    const result = await service.recordIdentityReverificationResult(driverId, {
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      isMatch: true,
      needsReview: false,
      similarityScore: 96,
      decision: 'approve',
      reconciliationOnly: true
    });

    expect(result).toEqual(expect.objectContaining({
      recorded: false,
      code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
    }));
    expect(mockRedis.eval.mock.calls[0][0]).toContain('kyc_status == "pending_reverify"');
    expect(mockRedis.eval.mock.calls[0][0]).toContain('not kyc_status_owned');
    expect(mockRedis.eval.mock.calls[0][0]).toContain('not identity_status_owned');
    expect(mockRedis.eval.mock.calls[0][0]).toContain('not account_status_safe');
    expect(mockRedis.eval.mock.calls[0].slice(1, 4)).toEqual([
      1,
      `driver:${driverId}`,
      challengeId
    ]);
  });

  test('an old identity result cannot clear or block a newer challenge', async () => {
    const newerState = {
      identityReverification: {
        challengeId: 'idrev_newer',
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'requested',
        metrics: {}
      },
      kycReverifyRequired: true,
      kycStatus: 'pending_reverify'
    };
    mockRealtimeValues['users/driver-newer'] = newerState;

    const result = await service.recordIdentityReverificationResult('driver-newer', {
      challengeId: 'idrev_old',
      requirement: 'IDENTITY_REVERIFICATION',
      isMatch: false,
      similarityScore: 10,
      decision: 'reject'
    });

    expect(result).toEqual(expect.objectContaining({
      recorded: false,
      stale: true,
      code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
    }));
    expect(mockRealtimeValues['users/driver-newer']).toEqual(newerState);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  test('an old identity start cannot change metrics of a newer challenge', async () => {
    const newerState = {
      identityReverification: {
        challengeId: 'idrev_newer_start',
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'requested',
        metrics: {}
      },
      kycReverifyRequired: true
    };
    mockRealtimeValues['users/driver-newer-start'] = newerState;

    const result = await service.recordIdentityReverificationStarted('driver-newer-start', {
      challengeId: 'idrev_old_start',
      requirement: 'IDENTITY_REVERIFICATION'
    });

    expect(result).toEqual(expect.objectContaining({
      recorded: false,
      stale: true
    }));
    expect(mockRealtimeValues['users/driver-newer-start']).toEqual(newerState);
  });

  test('markDriverForLivenessAttemptsExhausted opens support ticket and soft-blocks dispatch', async () => {
    const supportTicketService = require('../../../services/support-ticket-service');
    const firebaseConfig = require('../../../firebase-config');

    const result = await service.markDriverForLivenessAttemptsExhausted({
      driverId: 'driver-liveness-exhausted',
      challengeId: 'kyc_ch_1',
      attemptState: {
        failed: 2,
        maxAttempts: 2
      }
    });

    expect(supportTicketService.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: 'driver-liveness-exhausted',
        userType: 'driver',
        category: 'kyc',
        priority: 'N2'
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        softBlocked: true,
        supportTicketId: 'TICKET-LIVENESS-1',
        reasonCode: 'aws_liveness_attempts_exhausted'
      })
    );
    expect(firebaseConfig.updateRealtimeDB).toHaveBeenCalledWith(
      'users/driver-liveness-exhausted',
      expect.objectContaining({
        kycReverifyRequired: true,
        kycReverifySource: 'aws_liveness_attempts_exhausted',
        kycStatus: 'pending_reverify'
      })
    );
  });
});
