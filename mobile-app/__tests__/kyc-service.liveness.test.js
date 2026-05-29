jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: (endpoint) => `https://api.test${endpoint}`
}));

const mockGetIdToken = jest.fn(async () => 'firebase-id-token');
let mockAuthState = {
  currentUser: {
    getIdToken: mockGetIdToken
  }
};

jest.mock('@react-native-firebase/auth', () => () => mockAuthState);

jest.mock('../src/services/FaceDetectionService', () => ({
  __esModule: true,
  default: {
    processImage: jest.fn(async () => ({
      success: true,
      detection: { hasFace: true },
      alignedUri: 'file://aligned.jpg'
    }))
  }
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => {}),
  getItem: jest.fn(async () => null)
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async () => ({ uri: 'file://normalized.jpg', base64: 'abc123base64' })),
  SaveFormat: { JPEG: 'jpeg' }
}));

describe('KYCService liveness handling', () => {
  let kycService;

  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('../src/services/DeviceFaceEmbeddingService');
    mockGetIdToken.mockReset();
    mockGetIdToken.mockResolvedValue('firebase-id-token');
    mockAuthState = {
      currentUser: {
        getIdToken: mockGetIdToken
      }
    };
    global.fetch = jest.fn();
    global.FormData = class MockFormData {
      constructor() {
        this.parts = [];
      }

      append(key, value) {
        this.parts.push([key, value]);
      }
    };
    kycService = require('../src/services/KYCService').default;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getPreferredLivenessMode should resolve aws when provider is fully configured', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        provider: 'aws_rekognition_face_liveness',
        config: {
          enabled: true,
          credentialsEnabled: true,
          hasAssumeRoleArn: true
        }
      })
    });

    const result = await kycService.getPreferredLivenessMode();
    expect(result.success).toBe(true);
    expect(result.mode).toBe('aws');
  });

  test('getPreferredLivenessMode should fallback local on connection failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network request failed'));

    const result = await kycService.getPreferredLivenessMode();
    expect(result.success).toBe(false);
    expect(result.mode).toBe('local');
    expect(result.error).toMatch(/Network request failed/);
  });

  test('createAwsLivenessSession should return error on API non-ok', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ error: 'AWS disabled' })
    });

    const result = await kycService.createAwsLivenessSession('driver-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('AWS disabled');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer firebase-id-token');
  });

  test('getAwsLivenessCredentials should request temporary credentials with auth', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        provider: 'aws_rekognition_face_liveness',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
          expiration: '2026-05-13T12:00:00.000Z'
        }
      })
    });

    const result = await kycService.getAwsLivenessCredentials('driver-1');
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/kyc/liveness/aws/credentials?userId=driver-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token'
        })
      })
    );
  });

  test('getAwsLivenessSessionResult should return error on timeout/fetch failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('timeout'));

    const result = await kycService.getAwsLivenessSessionResult('driver-1', 'session-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  test('processOnboarding should send device-first KYC with auth', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          approved: true,
          needsReview: false,
          mode: 'device_signature_v1'
        }
      })
    });

    const result = await kycService.processOnboarding('driver-1', 'file://cnh.jpg', 'file://selfie.jpg');
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer firebase-id-token');
    expect(JSON.parse(options.body)).toMatchObject({
      onboardingMode: 'device_signature_v1',
      driverId: 'driver-1'
    });
  });

  test('verifyDriver should support aws-session only payload', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, isMatch: true })
    });

    const result = await kycService.verifyDriver('driver-1', null, {
      awsSessionId: 'sess-123',
      livenessPassed: true,
      mode: kycService.getAwsProviderName()
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.userId).toBe('driver-1');
    expect(body.deviceKyc.awsSessionId).toBe('sess-123');
    expect(body.deviceKyc.aws.sessionId).toBe('sess-123');
    expect(options.headers.Authorization).toBe('Bearer firebase-id-token');
  });

  test('verifyDriver should return failure when backend rejects aws payload', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 412,
      statusText: 'Precondition Failed',
      json: async () => ({ error: 'Liveness obrigatório para concluir esta verificação' })
    });

    const result = await kycService.verifyDriver('driver-1', null, {
      awsSessionId: 'sess-invalid',
      livenessPassed: false,
      mode: kycService.getAwsProviderName()
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Liveness obrigatório/);
  });

  test('verifyDriver should prefer device embedding after AWS liveness', async () => {
    jest.resetModules();
    jest.doMock('../src/services/DeviceFaceEmbeddingService', () => ({
      __esModule: true,
      default: {
        generateEmbeddingPayload: jest.fn(async () => ({
          mode: 'mobile_arcface_w600k_r50_v1',
          provider: 'mobile_face_embedding',
          embeddingFormat: 'float32-l2-normalized-512',
          embedding: Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)),
          processingTime: 24
        }))
      }
    }));
    const service = require('../src/services/KYCService').default;
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMatch: true,
        mode: 'mobile_arcface_w600k_r50_v1',
        comparisonProvider: 'biometric-face-service'
      })
    });

    const result = await service.verifyDriver('driver-1', 'file://selfie.jpg', {
      awsSessionId: 'sess-123',
      livenessPassed: true,
      mode: 'mobile_arcface_w600k_r50_v1',
      serverSideFallbackOnDeviceEmbeddingUnavailable: true
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.test/api/kyc/verify-driver/device');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.deviceKyc).toMatchObject({
      mode: 'mobile_arcface_w600k_r50_v1',
      provider: 'mobile_face_embedding',
      awsSessionId: 'sess-123',
      embeddingFormat: 'float32-l2-normalized-512'
    });
    expect(body.deviceKyc.embedding).toHaveLength(512);
  });

  test('verifyDriver should fallback to server-side selfie when device embedding is unavailable after AWS', async () => {
    jest.resetModules();
    jest.doMock('../src/services/DeviceFaceEmbeddingService', () => ({
      __esModule: true,
      default: {
        generateEmbeddingPayload: jest.fn(async () => null)
      }
    }));
    const service = require('../src/services/KYCService').default;
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMatch: true,
        mode: 'server_biometric_selfie_v1',
        comparisonProvider: 'leaf_face_compare_service'
      })
    });

    const result = await service.verifyDriver('driver-1', 'file://selfie.jpg', {
      awsSessionId: 'sess-123',
      challengeId: 'challenge-1',
      requirement: 'LIVENESS_REQUIRED',
      livenessPassed: true,
      mode: 'mobile_arcface_w600k_r50_v1',
      serverSideFallbackOnDeviceEmbeddingUnavailable: true
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.test/api/kyc/verify-driver/server-side-selfie');
    expect(global.fetch.mock.calls[0][1].body.parts).toEqual(expect.arrayContaining([
      ['userId', 'driver-1'],
      ['awsSessionId', 'sess-123'],
      ['challengeId', 'challenge-1'],
      ['requirement', 'LIVENESS_REQUIRED'],
      ['currentImage', expect.objectContaining({
        uri: 'file://selfie.jpg',
        name: 'driver-selfie.jpg',
        type: 'image/jpeg'
      })]
    ]));
  });

  test('verifyDriverServerSideSelfie should send multipart selfie after AWS liveness', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMatch: true,
        mode: 'server_biometric_selfie_v1',
        comparisonProvider: 'leaf_face_compare_service'
      })
    });

    const result = await kycService.verifyDriverServerSideSelfie('driver-1', 'file://selfie.jpg', {
      awsSessionId: 'sess-123',
      challengeId: 'challenge-1',
      requirement: 'LIVENESS_REQUIRED'
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/kyc/verify-driver/server-side-selfie',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer firebase-id-token'
        })
      })
    );
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.body.parts).toEqual(expect.arrayContaining([
      ['userId', 'driver-1'],
      ['awsSessionId', 'sess-123'],
      ['challengeId', 'challenge-1'],
      ['requirement', 'LIVENESS_REQUIRED'],
      ['currentImage', expect.objectContaining({
        uri: 'file://selfie.jpg',
        name: 'driver-selfie.jpg',
        type: 'image/jpeg'
      })]
    ]));
  });
});
