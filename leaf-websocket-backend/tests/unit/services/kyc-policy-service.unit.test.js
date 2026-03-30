jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const mockHasValidVerification = jest.fn();

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

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getRealtimeDB: jest.fn(() => null),
  getFromRealtimeDB: jest.fn(() => null),
  updateRealtimeDB: jest.fn(() => true)
}));

jest.mock('../../../services/kyc-driver-status-service', () => ({
  blockDriver: jest.fn().mockResolvedValue({ success: true })
}));

describe('kyc-policy-service', () => {
  let service;

  beforeEach(() => {
    jest.resetModules();
    service = require('../../../services/kyc-policy-service');
    jest.clearAllMocks();
    mockHasValidVerification.mockResolvedValue({ hasValid: true });
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
    jest.spyOn(service, 'getDriverKycState').mockResolvedValue({
      usersDoc: {},
      driversDoc: {},
      realtimeUser: {}
    });

    const result = await service.evaluateWithdrawalStepUp({
      driverId: 'driver-low-risk',
      amountCents: 1200
    });

    expect(result.requirement).toBe('NONE');
    expect(result.riskScore).toBe(0);
    expect(result.challenge).toBeNull();
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
});
