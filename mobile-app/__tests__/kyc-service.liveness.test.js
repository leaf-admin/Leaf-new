jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: (endpoint) => `https://api.test${endpoint}`
}));

const mockGetIdToken = jest.fn(async () => 'firebase-id-token');
const mockAsyncStorageGetItem = jest.fn(async () => null);
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
  getItem: (...args) => mockAsyncStorageGetItem(...args)
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
    mockAsyncStorageGetItem.mockReset();
    mockAsyncStorageGetItem.mockResolvedValue(null);
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

  test('does not use a persisted QA token without an explicit simulator E2E runtime', async () => {
    mockAuthState = { currentUser: null };
    mockAsyncStorageGetItem.mockImplementation(async key => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return 'stale-qa-token';
      return null;
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, provider: 'aws_rekognition_face_liveness' }),
    });

    await kycService.getLivenessProvider();

    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
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
      json: async () => ({
        error: 'AWS disabled',
        code: 'KYC_CANONICAL_APPROVED_CNH_REQUIRED',
      })
    });

    const result = await kycService.createAwsLivenessSession('driver-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('AWS disabled');
    expect(result.code).toBe('KYC_CANONICAL_APPROVED_CNH_REQUIRED');
    expect(result.status).toBe(503);
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

    const result = await kycService.getAwsLivenessCredentials('driver-1', 'session-1');
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/kyc/liveness/aws/credentials?userId=driver-1&sessionId=session-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token'
        })
      })
    );
  });

  test('getAwsLivenessCredentials should fail locally when the bound session is missing', async () => {
    const result = await kycService.getAwsLivenessCredentials('driver-1');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_AWS_LIVENESS_SESSION_REQUIRED',
      status: 400,
    }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('getAwsLivenessSessionResult should return error on timeout/fetch failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('timeout'));

    const result = await kycService.getAwsLivenessSessionResult('driver-1', 'session-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  test('abandonAwsLivenessSession should preserve resume-required status and code', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({
        error: 'A validação já foi concluída.',
        code: 'KYC_AWS_LIVENESS_RESUME_REQUIRED',
      }),
    });

    const result = await kycService.abandonAwsLivenessSession(
      'driver-1',
      'session-completed'
    );

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_AWS_LIVENESS_RESUME_REQUIRED',
      status: 409,
    }));
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/kyc/liveness/aws/session/session-completed/abandon',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ userId: 'driver-1' }),
      })
    );
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

  test('verifyDriver should bypass the device endpoint when canonical server-side compare is preferred', async () => {
    jest.resetModules();
    const generateEmbeddingPayload = jest.fn(async () => ({
      mode: 'mobile_arcface_w600k_r50_v1',
      provider: 'mobile_face_embedding',
      embedding: Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0))
    }));
    jest.doMock('../src/services/DeviceFaceEmbeddingService', () => ({
      __esModule: true,
      default: { generateEmbeddingPayload }
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
      requirement: 'IDENTITY_REVERIFICATION',
      livenessPassed: true,
      preferServerSideSelfieVerification: true
    });

    expect(result.success).toBe(true);
    expect(generateEmbeddingPayload).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://api.test/api/kyc/verify-driver/server-side-selfie'
    );
    expect(global.fetch.mock.calls[0][0]).not.toContain('/verify-driver/device');
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

  test('verifyDriverServerSideSelfie should complete canonical compare without a second selfie', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMatch: true,
        mode: 'server_aws_compare_faces_v1',
        comparisonProvider: 'aws_rekognition_compare_faces'
      })
    });

    const result = await kycService.verifyDriverServerSideSelfie('driver-1', null, {
      awsSessionId: 'sess-123',
      challengeId: 'challenge-1',
      requirement: 'LIVENESS_REQUIRED'
    });

    expect(result.success).toBe(true);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.body.parts).toEqual(expect.arrayContaining([
      ['userId', 'driver-1'],
      ['awsSessionId', 'sess-123'],
      ['challengeId', 'challenge-1'],
      ['requirement', 'LIVENESS_REQUIRED']
    ]));
    expect(options.body.parts).not.toEqual(expect.arrayContaining([
      ['currentImage', expect.anything()]
    ]));
  });

  test('verifyDriverServerSideSelfie preserves only safe review references on identity mismatch', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({
        success: false,
        code: 'KYC_CHALLENGE_NOT_PASSED',
        error: 'Identity mismatch',
        evidenceId: 'evidence_01HZX9',
        reviewCaseId: 'case_01HZX9',
        challengeId: 'challenge_01HZX9',
        requirement: 'identity_reverification',
        reviewAvailable: true,
        similarityScore: 0.12,
        referenceImageUrl: 'https://storage.example/private-selfie.jpg',
        sourceImageHash: 'sensitive-hash',
      }),
    });

    const result = await kycService.verifyDriverServerSideSelfie('driver-1', null, {
      awsSessionId: 'sess-mismatch',
    });

    expect(result).toEqual({
      success: false,
      error: 'Identity mismatch',
      code: 'KYC_CHALLENGE_NOT_PASSED',
      status: 403,
      retryAt: null,
      evidenceId: 'evidence_01HZX9',
      reviewCaseId: 'case_01HZX9',
      challengeId: 'challenge_01HZX9',
      requirement: 'IDENTITY_REVERIFICATION',
      reviewAvailable: true,
    });
    expect(result).not.toHaveProperty('similarityScore');
    expect(result).not.toHaveProperty('referenceImageUrl');
    expect(result).not.toHaveProperty('sourceImageHash');
  });

  test('verifyDriverServerSideSelfie drops unsafe review references', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({
        code: 'KYC_CHALLENGE_NOT_PASSED',
        error: 'Identity mismatch',
        evidenceId: 'https://storage.example/selfie.jpg',
        reviewCaseId: '../another-driver-case',
        challengeId: 'valid-challenge_1',
        requirement: 'identity reverification',
        reviewAvailable: true,
      }),
    });

    const result = await kycService.verifyDriverServerSideSelfie('driver-1', null, {
      awsSessionId: 'sess-mismatch',
    });

    expect(result).toEqual(expect.objectContaining({
      challengeId: 'valid-challenge_1',
      reviewAvailable: true,
    }));
    expect(result).not.toHaveProperty('evidenceId');
    expect(result).not.toHaveProperty('reviewCaseId');
    expect(result).not.toHaveProperty('requirement');
  });

  test.each([
    [
      'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
      422,
      'Unprocessable Entity',
      'Não conseguimos identificar a foto na CNH aprovada.'
    ],
    [
      'AWS_COMPARE_FACES_INVALID_PARAMETER',
      500,
      'Internal Server Error',
      'Erro interno do servidor'
    ]
  ])(
    'verifyDriverServerSideSelfie treats expected backend rejection %s as a warning',
    async (code, status, statusText, errorMessage) => {
      const Logger = require('../src/utils/Logger').default;
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status,
        statusText,
        json: async () => ({
          success: false,
          code,
          error: errorMessage
        })
      });

      const result = await kycService.verifyDriverServerSideSelfie('driver-1', null, {
        awsSessionId: 'sess-invalid-cnh'
      });

      expect(result).toEqual(expect.objectContaining({
        success: false,
        code,
        status
      }));
      expect(Logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('verificação de identidade'),
        expect.objectContaining({
          code,
          status
        })
      );
      expect(Logger.error).not.toHaveBeenCalled();
    }
  );

  test('verifyDriverServerSideSelfie keeps unexpected server failures observable', async () => {
    const Logger = require('../src/utils/Logger').default;
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({
        success: false,
        code: 'KYC_SERVER_SIDE_VERIFICATION_ERROR',
        error: 'Erro interno do servidor'
      })
    });

    const result = await kycService.verifyDriverServerSideSelfie('driver-1', null, {
      awsSessionId: 'sess-server-error'
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_SERVER_SIDE_VERIFICATION_ERROR',
      status: 500
    }));
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Erro inesperado'),
      expect.objectContaining({
        code: 'KYC_SERVER_SIDE_VERIFICATION_ERROR',
        status: 500
      })
    );
  });
});
