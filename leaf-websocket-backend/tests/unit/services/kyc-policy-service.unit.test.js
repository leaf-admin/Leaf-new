jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const mockHasValidVerification = jest.fn();
const mockResolveActiveTripForDriver = jest.fn();
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
  hset: jest.fn().mockResolvedValue(true),
  zrem: jest.fn().mockResolvedValue(1)
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../utils/active-trip-index', () => ({
  resolveActiveTripForDriver: (...args) => mockResolveActiveTripForDriver(...args)
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getRealtimeDB: jest.fn(() => null),
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
    mockHasValidVerification.mockResolvedValue({ hasValid: true });
    mockResolveActiveTripForDriver.mockResolvedValue({ tripId: null, customerId: null });
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
        kycReverifyPendingAfterTrip: true
      })
    );
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'driver:driver-active-1',
      expect.objectContaining({
        identity_reverification_pending_after_trip: 'true'
      })
    );
    expect(mockRedis.zrem).not.toHaveBeenCalled();
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
