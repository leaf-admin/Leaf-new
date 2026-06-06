jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockCreateSession = jest.fn();
const mockGetSessionResult = jest.fn();
const mockIssueTemporaryCredentials = jest.fn();

const mockKycServiceInstance = {
  initialized: true,
  acceptDeviceVerification: jest.fn(),
  verifyDriverServerSideSelfie: jest.fn(),
  getFaceEncoding: jest.fn(),
  deleteFaceEncoding: jest.fn(),
  getStats: jest.fn(),
  healthCheck: jest.fn(),
  hasValidVerification: jest.fn(),
  invalidateVerificationCache: jest.fn()
};

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken
  }))
}));

jest.mock('../../../firebase-config', () => ({
  initializeFirebase: jest.fn(),
  getFromRealtimeDB: jest.fn()
}));

jest.mock('../../../services/IntegratedKYCService', () => jest.fn(() => mockKycServiceInstance));

jest.mock('../../../services/aws-face-liveness-service', () => jest.fn(() => ({
  getProviderName: jest.fn(() => 'aws_rekognition_face_liveness'),
  getConfigSummary: jest.fn(() => ({
    enabled: true,
    credentialsEnabled: true,
    hasAssumeRoleArn: true
  })),
  createSession: (...args) => mockCreateSession(...args),
  getSessionResult: (...args) => mockGetSessionResult(...args),
  issueTemporaryCredentials: (...args) => mockIssueTemporaryCredentials(...args),
  toDevicePayload: jest.fn((awsResult, payload) => ({
    ...payload,
    aws: awsResult,
    awsLivenessPassed: awsResult?.livenessPassed === true
  }))
})));

jest.mock('../../../services/kyc-policy-service', () => ({
  requiresFirstAccessLiveness: jest.fn(async () => ({ required: false })),
  getStepUpChallenge: jest.fn(async () => null),
  isLivenessSatisfied: jest.fn(() => true),
  recordIdentityReverificationStarted: jest.fn(async () => ({ success: true })),
  recordVerificationSuccess: jest.fn(async () => ({ success: true })),
  resolveStepUpChallenge: jest.fn(async () => ({ success: true })),
  markDriverForLivenessAttemptsExhausted: jest.fn(async () => ({ success: true, softBlocked: true }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const kycRoutes = require('../../../routes/kyc-routes');
const mockKycPolicyService = require('../../../services/kyc-policy-service');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/kyc', kycRoutes.getRouter());
  return app;
}

describe('kyc routes auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'driver-1', phone_number: '+5521123456789' });
    mockCreateSession.mockResolvedValue({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-1',
      region: 'us-east-1'
    });
    mockGetSessionResult.mockResolvedValue({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-1',
      completed: true,
      livenessPassed: true
    });
    mockIssueTemporaryCredentials.mockResolvedValue({
      provider: 'aws_rekognition_face_liveness',
      region: 'us-east-1',
      source: 'sts',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        sessionToken: 'session-token',
        expiration: '2026-05-13T12:00:00.000Z'
      }
    });
    mockKycServiceInstance.verifyDriverServerSideSelfie.mockResolvedValue({
      success: true,
      userId: 'driver-1',
      isMatch: true,
      similarityScore: 0.94,
      confidence: 0.94,
      threshold: 0.9,
      reviewThreshold: 0.78,
      decision: 'approve',
      processingTime: 220,
      mode: 'server_biometric_selfie_v1',
      provider: 'leaf_face_compare_service',
      comparisonProvider: 'leaf_face_compare_service',
      embeddingDimension: 512
    });
  });

  it('rejects liveness provider without Firebase auth', async () => {
    const response = await request(createApp()).get('/api/kyc/liveness/provider');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('returns liveness provider for authenticated users', async () => {
    const response = await request(createApp())
      .get('/api/kyc/liveness/provider')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.provider).toBe('aws_rekognition_face_liveness');
    expect(response.body.biometricRuntime).toMatchObject({
      enabled: false,
      ready: false,
      preferredLivenessMode: 'local'
    });
    expect(mockVerifyIdToken).toHaveBeenCalledWith('firebase-token');
  });

  it('rejects KYC stats without Firebase auth', async () => {
    const response = await request(createApp()).get('/api/kyc/stats');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(mockKycServiceInstance.getStats).not.toHaveBeenCalled();
  });

  it('returns biometric readiness for authenticated users', async () => {
    const response = await request(createApp())
      .get('/api/kyc/biometrics/readiness')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toHaveProperty('policy');
    expect(response.body).toHaveProperty('awsLiveness');
    expect(response.body.biometricRuntime).toMatchObject({
      enabled: false,
      ready: false,
      preferredLivenessMode: 'local'
    });
  });

  it('rejects AWS session creation for another user id', async () => {
    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-2' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('creates first-access AWS session with its own attempt scope', async () => {
    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        requirement: 'LIVENESS_REQUIRED'
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockCreateSession).toHaveBeenCalledWith({
      userId: 'driver-1',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access'
    });
  });

  it('derives withdrawal AWS session attempt scope from backend challenge source', async () => {
    mockKycPolicyService.getStepUpChallenge.mockResolvedValueOnce({
      challengeId: 'kyc_ch_withdrawal',
      driverId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      source: 'withdrawal'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'kyc_ch_withdrawal',
        requirement: 'VERIFY_REQUIRED'
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockKycPolicyService.getStepUpChallenge).toHaveBeenCalledWith('kyc_ch_withdrawal', 'driver-1');
    expect(mockCreateSession).toHaveBeenCalledWith({
      userId: 'driver-1',
      challengeId: 'kyc_ch_withdrawal',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'withdrawal'
    });
  });

  it('issues AWS liveness credentials only for the authenticated user', async () => {
    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.credentials.accessKeyId).toBe('access-key');
    expect(mockIssueTemporaryCredentials).toHaveBeenCalledWith({ userId: 'driver-1' });
  });

  it('verifies a post-AWS selfie server-side for the authenticated driver', async () => {
    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-1')
      .field('requirement', 'LIVENESS_REQUIRED')
      .attach('currentImage', Buffer.from('fake-image'), {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.mode).toBe('server_biometric_selfie_v1');
    expect(response.body.isMatch).toBe(true);
    expect(mockGetSessionResult).toHaveBeenCalledWith({ sessionId: 'session-1', userId: 'driver-1' });
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).toHaveBeenCalledWith(
      'driver-1',
      expect.any(Buffer),
      expect.objectContaining({
        recoverBlocked: true,
        filename: 'selfie.jpg',
        contentType: 'image/jpeg'
      })
    );
  });

  it('rejects post-AWS server-side selfie when liveness is not satisfied', async () => {
    mockKycPolicyService.isLivenessSatisfied.mockReturnValueOnce(false);

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-1')
      .attach('currentImage', Buffer.from('fake-image'), {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg'
      });

    expect(response.status).toBe(412);
    expect(response.body.code).toBe('KYC_LIVENESS_REQUIRED');
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
  });
});
