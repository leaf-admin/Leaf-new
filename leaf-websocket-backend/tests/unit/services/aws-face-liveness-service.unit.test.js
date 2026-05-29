jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const mockGet = jest.fn();
const mockSet = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    get: mockGet,
    set: mockSet
  }))
}));

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: jest.fn(() => ({
    send: mockSend
  })),
  CreateFaceLivenessSessionCommand: jest.fn((input) => ({ input })),
  GetFaceLivenessSessionResultsCommand: jest.fn((input) => ({ input }))
}));

describe('aws-face-liveness-service', () => {
  let AwsFaceLivenessService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.KYC_AWS_LIVENESS_ENABLED = 'true';
    process.env.AWS_REGION = 'us-east-1';
    process.env.KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD = '0.015';

    AwsFaceLivenessService = require('../../../services/aws-face-liveness-service');
  });

  afterEach(() => {
    delete process.env.KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD;
    delete process.env.KYC_AWS_LIVENESS_WITHDRAWAL_MAX_ATTEMPTS_PER_WINDOW;
  });

  test('should create liveness session and persist metadata', async () => {
    mockSend.mockResolvedValueOnce({ SessionId: 'session-123' });

    const service = new AwsFaceLivenessService();
    const result = await service.createSession({ userId: 'driver-1' });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('session-123');
    expect(mockSet).toHaveBeenCalled();
  });

  test('should parse result and set liveness pass based on threshold', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify({ userId: 'driver-2' }));
    mockSend.mockResolvedValueOnce({
      Status: 'SUCCEEDED',
      Confidence: 97.3,
      ReferenceImage: {},
      AuditImages: [{}, {}]
    });

    const service = new AwsFaceLivenessService();
    const result = await service.getSessionResult({
      sessionId: 'session-abc',
      userId: 'driver-2'
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.livenessPassed).toBe(true);
    expect(result.auditImagesCount).toBe(2);
  });

  test('should expose configurable estimated unit cost in config summary', () => {
    const service = new AwsFaceLivenessService();

    expect(service.getConfigSummary()).toEqual(
      expect.objectContaining({
        estimatedUnitCostUsd: 0.015,
        maxAttemptsPerWindow: 2,
        withdrawalMaxAttemptsPerWindow: 2,
        attemptWindowSeconds: 86400,
        sdkMaxAttempts: 2
      })
    );
  });

  test('should isolate liveness attempt budgets by backend attempt scope', () => {
    process.env.KYC_AWS_LIVENESS_WITHDRAWAL_MAX_ATTEMPTS_PER_WINDOW = '3';
    const service = new AwsFaceLivenessService();

    expect(service.buildAttemptRedisKey({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    })).toBe('kyc:aws:liveness:attempts:driver-1:driver_online');
    expect(service.buildAttemptRedisKey({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'withdrawal'
    })).toBe('kyc:aws:liveness:attempts:driver-1:withdrawal');
    expect(service.getMaxAttemptsForScope('driver_online')).toBe(2);
    expect(service.getMaxAttemptsForScope('withdrawal')).toBe(3);
  });

  test('should allow withdrawal liveness when driver-online budget is exhausted', async () => {
    mockGet.mockImplementation(async (key) => {
      if (String(key).endsWith(':driver_online')) {
        return JSON.stringify({
          userId: 'driver-1',
          requirement: 'LIVENESS_REQUIRED',
          attemptScope: 'driver_online',
          started: 2,
          failed: 2,
          softBlocked: true
        });
      }
      return null;
    });
    mockSend.mockResolvedValueOnce({ SessionId: 'withdrawal-session-1' });

    const service = new AwsFaceLivenessService();
    const result = await service.createSession({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'withdrawal'
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('withdrawal-session-1');
    expect(result.attemptScope).toBe('withdrawal');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('should block new liveness session when attempt budget is exhausted', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify({
      userId: 'driver-exhausted',
      requirement: 'LIVENESS_REQUIRED',
      started: 2,
      failed: 2,
      softBlocked: true,
      exhaustedAt: '2026-05-28T00:00:00.000Z'
    }));

    const service = new AwsFaceLivenessService();

    await expect(
      service.createSession({ userId: 'driver-exhausted', requirement: 'LIVENESS_REQUIRED' })
    ).rejects.toMatchObject({
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED'
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should mark failed liveness result as soft-blocked on final attempt', async () => {
    mockGet
      .mockResolvedValueOnce(JSON.stringify({
        userId: 'driver-final',
        requirement: 'LIVENESS_REQUIRED'
      }))
      .mockResolvedValueOnce(JSON.stringify({
        userId: 'driver-final',
        requirement: 'LIVENESS_REQUIRED',
        started: 2,
        failed: 1,
        softBlocked: false
      }));
    mockSend.mockResolvedValueOnce({
      Status: 'FAILED',
      Confidence: 20
    });

    const service = new AwsFaceLivenessService();
    const result = await service.getSessionResult({
      sessionId: 'session-final',
      userId: 'driver-final'
    });

    expect(result.completed).toBe(true);
    expect(result.livenessPassed).toBe(false);
    expect(result.attemptState).toEqual(
      expect.objectContaining({
        failed: 2,
        softBlocked: true,
        justExhausted: true,
        maxAttempts: 2
      })
    );
  });
});
