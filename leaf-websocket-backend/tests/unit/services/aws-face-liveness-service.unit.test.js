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

    AwsFaceLivenessService = require('../../../services/aws-face-liveness-service');
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
});
