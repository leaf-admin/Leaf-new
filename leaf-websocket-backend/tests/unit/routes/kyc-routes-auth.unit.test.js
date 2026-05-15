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
  recordVerificationSuccess: jest.fn(async () => ({ success: true })),
  resolveStepUpChallenge: jest.fn(async () => ({ success: true }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const kycRoutes = require('../../../routes/kyc-routes');

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
    expect(mockVerifyIdToken).toHaveBeenCalledWith('firebase-token');
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

  it('issues AWS liveness credentials only for the authenticated user', async () => {
    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.credentials.accessKeyId).toBe('access-key');
    expect(mockIssueTemporaryCredentials).toHaveBeenCalledWith({ userId: 'driver-1' });
  });
});
