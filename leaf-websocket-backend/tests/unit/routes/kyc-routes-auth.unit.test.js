jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockCreateSession = jest.fn();
const mockGetSessionResult = jest.fn();
const mockAbandonSession = jest.fn();
const mockIssueTemporaryCredentials = jest.fn();
const mockGetSessionMetadata = jest.fn();
const mockAssertBoundSessionMetadata = jest.fn();
const mockGrantReferenceImageRecoveryAttempt = jest.fn();
const mockRecordCanonicalSuccess = jest.fn();
const mockRecordCanonicalFailure = jest.fn();
const mockAssertVerificationOutsideActiveTrip = jest.fn();
const mockClaimCanonicalSession = jest.fn();
const mockReleaseCanonicalSessionClaim = jest.fn();
const mockRenewCanonicalSessionClaim = jest.fn();
const mockRestoreApprovedIdentityVerification = jest.fn();
const mockClaimVerificationWindow = jest.fn();
const mockReleaseVerificationWindow = jest.fn();
const mockGetFromRealtimeDB = jest.fn();
const mockAssertKycOperationAllowed = jest.fn();
const mockClaimCleanRetryAuthorization = jest.fn();
const mockConsumeCleanRetryAuthorization = jest.fn();
const mockReleaseCleanRetryAuthorization = jest.fn();
const mockRequireApprovedCnh = jest.fn();

const mockKycServiceInstance = {
  initialized: true,
  acceptDeviceVerification: jest.fn(),
  verifyDriver: jest.fn(),
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
  getFromRealtimeDB: (...args) => mockGetFromRealtimeDB(...args)
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
  abandonSession: (...args) => mockAbandonSession(...args),
  getSessionMetadata: (...args) => mockGetSessionMetadata(...args),
  assertBoundSessionMetadata: (...args) => mockAssertBoundSessionMetadata(...args),
  grantReferenceImageRecoveryAttempt: (...args) => mockGrantReferenceImageRecoveryAttempt(...args),
  issueTemporaryCredentials: (...args) => mockIssueTemporaryCredentials(...args),
  toDevicePayload: jest.fn((awsResult, payload) => ({
    ...payload,
    aws: awsResult,
    awsLivenessPassed: awsResult?.livenessPassed === true
  }))
})));

jest.mock('../../../services/kyc-policy-service', () => ({
  requireApprovedKyc: jest.fn(async () => ({ allowed: true, code: 'KYC_APPROVED' })),
  requiresFirstAccessLiveness: jest.fn(async () => ({ required: false })),
  getStepUpChallenge: jest.fn(async () => null),
  isLivenessSatisfied: jest.fn(() => true),
  recordIdentityReverificationStarted: jest.fn(async () => ({ success: true, recorded: true })),
  recordIdentityReverificationResult: jest.fn(async () => ({ success: true, recorded: true })),
  recordVerificationSuccess: jest.fn(async () => ({ success: true })),
  resolveStepUpChallenge: jest.fn(async () => ({ success: true })),
  markDriverForLivenessAttemptsExhausted: jest.fn(async () => ({ success: true, softBlocked: true }))
}));

jest.mock('../../../services/driver-identity-trust-service', () => ({
  recordCanonicalSuccess: (...args) => mockRecordCanonicalSuccess(...args),
  recordCanonicalFailure: (...args) => mockRecordCanonicalFailure(...args),
  assertVerificationOutsideActiveTrip: (...args) => mockAssertVerificationOutsideActiveTrip(...args),
  claimCanonicalSession: (...args) => mockClaimCanonicalSession(...args),
  releaseCanonicalSessionClaim: (...args) => mockReleaseCanonicalSessionClaim(...args),
  renewCanonicalSessionClaim: (...args) => mockRenewCanonicalSessionClaim(...args),
  restoreApprovedIdentityVerification: (...args) => mockRestoreApprovedIdentityVerification(...args),
  claimVerificationWindow: (...args) => mockClaimVerificationWindow(...args),
  releaseVerificationWindow: (...args) => mockReleaseVerificationWindow(...args)
}));

jest.mock('../../../services/canonical-driver-document-approval-service', () => ({
  requireApprovedCnh: (...args) => mockRequireApprovedCnh(...args)
}));

jest.mock('../../../services/kyc-identity-review-workflow-service', () => ({
  assertKycOperationAllowed: (...args) => mockAssertKycOperationAllowed(...args),
  claimCleanRetryAuthorization: (...args) => mockClaimCleanRetryAuthorization(...args),
  consumeCleanRetryAuthorization: (...args) => mockConsumeCleanRetryAuthorization(...args),
  releaseCleanRetryAuthorization: (...args) => mockReleaseCleanRetryAuthorization(...args),
  clearResolvedMismatchHold: jest.fn(async () => ({ cleared: true }))
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
    mockGetFromRealtimeDB.mockResolvedValue(null);
    mockAssertKycOperationAllowed.mockResolvedValue({
      allowed: true,
      identityReviewHold: false,
      cnhReplacementHold: false,
      cleanRetryAuthorized: false
    });
    mockClaimCleanRetryAuthorization.mockResolvedValue(null);
    mockConsumeCleanRetryAuthorization.mockResolvedValue({ consumed: true });
    mockReleaseCleanRetryAuthorization.mockResolvedValue({ released: true });
    mockRequireApprovedCnh.mockResolvedValue({
      driverId: 'driver-1',
      documentType: 'cnh',
      status: 'approved',
      analysisStatus: 'approved',
      submissionId: 'cnh-submission-1',
      documentPath: 'driver-activation/driver-1/cnh/cnh-submission-1.pdf',
      documentSha256: 'a'.repeat(64),
      storageGeneration: '1700000000000001',
      approvalSource: 'dashboard_manual_review',
      reviewedBy: 'admin-1',
      reviewedAt: '2026-07-13T11:00:00.000Z',
      createdAt: '2026-07-13T10:00:00.000Z'
    });
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValue({ required: false });
    mockKycPolicyService.requireApprovedKyc.mockReset().mockResolvedValue({
      allowed: true,
      code: 'KYC_APPROVED'
    });
    mockKycPolicyService.recordIdentityReverificationStarted
      .mockReset()
      .mockResolvedValue({ success: true, recorded: true });
    mockKycPolicyService.recordIdentityReverificationResult
      .mockReset()
      .mockResolvedValue({ success: true, recorded: true });
    mockKycPolicyService.recordVerificationSuccess
      .mockReset()
      .mockResolvedValue({ success: true });
    mockCreateSession.mockResolvedValue({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-1',
      region: 'us-east-1'
    });
    mockGetSessionResult.mockResolvedValue({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-1',
      completed: true,
      status: 'SUCCEEDED',
      confidence: 98,
      confidenceThreshold: 80,
      livenessPassed: true,
      referenceImageBuffer: Buffer.from('aws-reference-image'),
      referenceImageBoundingBox: {
        width: 0.42,
        height: 0.58,
        left: 0.29,
        top: 0.18
      },
      sessionMetadata: {
        costGuardOperationId: 'cost-operation-session-1'
      }
    });
    mockAbandonSession.mockResolvedValue({
      success: true,
      abandoned: true,
      alreadyAbandoned: false,
      sessionId: 'session-1',
      providerStatus: 'IN_PROGRESS'
    });
    mockGetSessionMetadata.mockResolvedValue({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      createdAt: '2026-07-13T12:00:00.000Z',
      expiresAt: '2026-07-13T12:20:00.000Z',
      verificationWindowToken: 'verification-window-token'
    });
    mockAssertBoundSessionMetadata.mockImplementation((metadata) => metadata);
    mockGrantReferenceImageRecoveryAttempt.mockReset().mockResolvedValue({
      status: 'applied',
      granted: true,
      canRetry: true,
      attemptState: {
        started: 2,
        passed: 2,
        failed: 0,
        maxAttempts: 2,
        effectiveMax: 3,
        recoveryAllowanceRemaining: 1,
        attemptsExhausted: false,
        softBlocked: false
      }
    });
    mockRecordCanonicalSuccess.mockResolvedValue({ success: true, evidenceId: 'evidence-1' });
    mockRecordCanonicalFailure.mockResolvedValue({ success: true });
    mockAssertVerificationOutsideActiveTrip.mockReset().mockResolvedValue({ allowed: true });
    mockClaimCanonicalSession.mockReset().mockResolvedValue({
      acquired: true,
      consumed: false,
      key: 'claim-key',
      token: 'claim-token',
      verificationWindowClaim: {
        acquired: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });
    mockReleaseCanonicalSessionClaim.mockReset().mockResolvedValue(undefined);
    mockRenewCanonicalSessionClaim.mockReset().mockResolvedValue(true);
    mockRestoreApprovedIdentityVerification.mockReset().mockImplementation((
      userId,
      sessionHash,
      evidence,
      { challengeId, requirement } = {}
    ) => {
      if (
        evidence?.driverId !== userId
        || evidence?.evidenceId !== sessionHash
        || evidence?.challengeId !== challengeId
        || evidence?.requirement !== requirement
        || evidence?.status !== 'approved'
      ) {
        return null;
      }
      return {
        success: true,
        userId,
        isMatch: true,
        needsReview: false,
        similarityScore: Number(evidence.faceMatch?.score || 0),
        confidence: Number(evidence.faceMatch?.score || 0),
        threshold: Number(evidence.faceMatch?.threshold || 0),
        reviewThreshold: Number(evidence.faceMatch?.reviewThreshold || 0),
        decision: evidence.faceMatch?.decision || null,
        mode: 'canonical_identity_reconciliation_v1',
        requirement,
        challengeId
      };
    });
    mockClaimVerificationWindow.mockReset().mockResolvedValue({
      acquired: true,
      token: 'verification-window-token',
      key: 'verification-window-key'
    });
    mockReleaseVerificationWindow.mockResolvedValue(true);
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

  it('does not create a paid AWS session while an identity review hold is active', async () => {
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: true,
      holdCaseId: 'kyc_case_1'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer valid-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(423);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      reviewCaseId: 'kyc_case_1'
    }));
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('does not create a paid AWS session for a permanently blocked identity', async () => {
    mockAssertKycOperationAllowed.mockRejectedValueOnce(Object.assign(
      new Error('permanent block'),
      { code: 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK' }
    ));

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer valid-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(423);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK',
      error: 'Esta conta nao pode usar o modo motorista.'
    }));
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('creates first-access AWS session with its own attempt scope', async () => {
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
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
      attemptScope: 'first_access',
      verificationWindowToken: 'verification-window-token'
    });
  });

  it('rejects a client-declared liveness requirement when the backend has no pending gate', async () => {
    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        requirement: 'LIVENESS_REQUIRED'
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_LIVENESS_NOT_REQUIRED');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('accepts identity reverification only when its backend challenge is active', async () => {
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_valid',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_valid',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(201);
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'driver-1',
      challengeId: 'idrev_valid',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: 'identity_reverification'
    }));
  });

  it('claims and consumes the durable one-shot authorization around a manual review retry', async () => {
    const retryScope = `manual_review_retry_kyc_ir_${'a'.repeat(32)}`;
    const claim = {
      driverId: 'driver-1',
      caseId: `kyc_ir_${'a'.repeat(32)}`,
      attemptScope: retryScope,
      claimToken: 'opaque-claim-token'
    };
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_review_retry',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryScope
    });
    mockClaimCleanRetryAuthorization.mockResolvedValueOnce(claim);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_review_retry',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(201);
    expect(mockClaimCleanRetryAuthorization).toHaveBeenCalledWith('driver-1', retryScope);
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      attemptScope: retryScope
    }));
    expect(mockConsumeCleanRetryAuthorization).toHaveBeenCalledWith(claim, 'session-1');
    expect(mockReleaseCleanRetryAuthorization).not.toHaveBeenCalled();
  });

  it('reopens the durable retry only when AWS confirms no provider dispatch occurred', async () => {
    const retryScope = `manual_review_retry_kyc_ir_${'b'.repeat(32)}`;
    const claim = {
      driverId: 'driver-1',
      caseId: `kyc_ir_${'b'.repeat(32)}`,
      attemptScope: retryScope,
      claimToken: 'opaque-claim-token'
    };
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_review_retry',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryScope
    });
    mockClaimCleanRetryAuthorization.mockResolvedValueOnce(claim);
    mockCreateSession.mockRejectedValueOnce(Object.assign(
      new Error('provider not dispatched'),
      { code: 'AWS_LIVENESS_CLIENT_NOT_READY', providerDispatched: false }
    ));

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_review_retry',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(500);
    expect(mockReleaseCleanRetryAuthorization).toHaveBeenCalledWith(claim, {
      reason: 'AWS_LIVENESS_CLIENT_NOT_READY'
    });
    expect(mockConsumeCleanRetryAuthorization).not.toHaveBeenCalled();
  });

  it('keeps the durable retry closed when AWS dispatch outcome is ambiguous', async () => {
    const retryScope = `manual_review_retry_kyc_ir_${'c'.repeat(32)}`;
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_review_retry',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryScope
    });
    mockClaimCleanRetryAuthorization.mockResolvedValueOnce({
      driverId: 'driver-1',
      caseId: `kyc_ir_${'c'.repeat(32)}`,
      attemptScope: retryScope,
      claimToken: 'opaque-claim-token'
    });
    mockCreateSession.mockRejectedValueOnce(Object.assign(
      new Error('dispatch outcome unknown'),
      { code: 'KYC_AWS_LIVENESS_DISPATCH_OUTCOME_UNKNOWN', providerDispatched: true }
    ));

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_review_retry',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(503);
    expect(mockReleaseCleanRetryAuthorization).not.toHaveBeenCalled();
    expect(mockConsumeCleanRetryAuthorization).not.toHaveBeenCalled();
  });

  it('does not create a paid identity session when a newer challenge wins after precheck', async () => {
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_old',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested'
    });
    mockKycPolicyService.recordIdentityReverificationStarted.mockResolvedValueOnce({
      success: true,
      recorded: false,
      stale: true,
      code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_old',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_IDENTITY_REVERIFY_CHALLENGE_STALE');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a forged identity reverification challenge before any paid call', async () => {
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_real',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_forged',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('KYC_IDENTITY_REVERIFICATION_NOT_ACTIVE');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('does not create a paid liveness session while the driver has an active trip', async () => {
    const error = new Error('Validacao adiada ate o fim da corrida');
    error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    mockClaimVerificationWindow.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        requirement: 'LIVENESS_REQUIRED'
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('abandons only the authenticated users bound AWS liveness session outside a trip', async () => {
    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session/session-1/abandon')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      abandoned: true,
      sessionId: 'session-1'
    });
    expect(mockAssertVerificationOutsideActiveTrip).toHaveBeenCalledWith('driver-1');
    expect(mockAbandonSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'driver-1'
    });
  });

  it('returns the same success contract when AWS liveness was already abandoned', async () => {
    mockAbandonSession.mockResolvedValueOnce({
      success: true,
      abandoned: true,
      alreadyAbandoned: true,
      sessionId: 'session-1',
      providerStatus: 'IN_PROGRESS'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session/session-1/abandon')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      abandoned: true,
      sessionId: 'session-1'
    });
  });

  it('does not let an authenticated user abandon another users session', async () => {
    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session/session-other/abandon')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-2' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(mockAssertVerificationOutsideActiveTrip).not.toHaveBeenCalled();
    expect(mockAbandonSession).not.toHaveBeenCalled();
  });

  it('does not abandon AWS liveness while the driver has an active trip', async () => {
    const error = new Error('Validacao adiada ate o fim da corrida');
    error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
    mockAssertVerificationOutsideActiveTrip.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session/session-1/abandon')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP');
    expect(mockAbandonSession).not.toHaveBeenCalled();
  });

  it('requires a completed successful AWS session to resume face compare instead of abandoning', async () => {
    const error = new Error('A validacao concluida precisa seguir para comparacao facial');
    error.code = 'KYC_AWS_LIVENESS_RESUME_REQUIRED';
    error.result = {
      completed: true,
      livenessPassed: true,
      sessionId: 'session-1'
    };
    mockAbandonSession.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session/session-1/abandon')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_AWS_LIVENESS_RESUME_REQUIRED',
      completed: true,
      livenessPassed: true,
      sessionId: 'session-1'
    }));
  });

  it('fails closed when the AWS provider is transiently unavailable during abandon', async () => {
    const error = new Error('AWS temporariamente indisponivel');
    error.name = 'ServiceUnavailableException';
    mockAbandonSession.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session/session-1/abandon')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1' });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ServiceUnavailableException');
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
      attemptScope: 'withdrawal',
      verificationWindowToken: 'verification-window-token'
    });
  });

  it('issues AWS liveness credentials only for the authenticated user', async () => {
    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1&sessionId=session-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.credentials.accessKeyId).toBe('access-key');
    expect(mockGetSessionMetadata).toHaveBeenCalledWith('session-1');
    expect(mockAssertBoundSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'driver-1' }),
      { userId: 'driver-1' }
    );
    expect(mockIssueTemporaryCredentials).toHaveBeenCalledWith({
      userId: 'driver-1',
      sessionId: 'session-1'
    });
  });

  it('does not issue AWS liveness credentials without a bound session', async () => {
    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED');
    expect(mockGetSessionMetadata).not.toHaveBeenCalled();
    expect(mockIssueTemporaryCredentials).not.toHaveBeenCalled();
  });

  it('does not issue AWS liveness credentials for a session owned by another user', async () => {
    const error = new Error('Sessao AWS nao pertence ao usuario informado');
    error.code = 'AWS_LIVENESS_SESSION_USER_MISMATCH';
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw error;
    });

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1&sessionId=session-other')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AWS_LIVENESS_SESSION_USER_MISMATCH');
    expect(mockIssueTemporaryCredentials).not.toHaveBeenCalled();
  });

  it('does not issue AWS liveness credentials during an active trip', async () => {
    const error = new Error('Validacao adiada ate o fim da corrida');
    error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
    mockAssertVerificationOutsideActiveTrip.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1&sessionId=session-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP');
    expect(mockIssueTemporaryCredentials).not.toHaveBeenCalled();
  });

  it('rejects credentials for an abandoned AWS liveness session', async () => {
    const error = new Error('Sessao AWS liveness encerrada pelo usuario');
    error.code = 'AWS_LIVENESS_SESSION_ABANDONED';
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw error;
    });

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1&sessionId=session-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('AWS_LIVENESS_SESSION_ABANDONED');
    expect(mockIssueTemporaryCredentials).not.toHaveBeenCalled();
  });

  it('polls AWS liveness only with strict server-side session binding', async () => {
    mockGetSessionResult.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-1',
      completed: false,
      status: 'IN_PROGRESS'
    });

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/session/session-1?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(mockGetSessionResult).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'driver-1',
      requireBoundMetadata: true
    });
    expect(response.body).not.toHaveProperty('referenceImageBuffer');
  });

  it('does not poll a liveness verification after an active trip has started', async () => {
    const error = new Error('Validacao adiada ate o fim da corrida');
    error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
    mockClaimVerificationWindow.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/session/session-1?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP');
    expect(mockGetSessionResult).not.toHaveBeenCalled();
  });

  it('rejects polling for an abandoned AWS liveness session', async () => {
    const error = new Error('Sessao AWS liveness encerrada pelo usuario');
    error.code = 'AWS_LIVENESS_SESSION_ABANDONED';
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw error;
    });

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/session/session-1?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('AWS_LIVENESS_SESSION_ABANDONED');
    expect(mockClaimVerificationWindow).not.toHaveBeenCalled();
    expect(mockGetSessionResult).not.toHaveBeenCalled();
  });

  it('blocks the device verification compatibility route during an active trip', async () => {
    const error = new Error('Validacao adiada ate o fim da corrida');
    error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
    mockClaimVerificationWindow.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/device')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        deviceKyc: { isMatch: true }
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP');
    expect(mockKycServiceInstance.acceptDeviceVerification).not.toHaveBeenCalled();
  });

  it('blocks the legacy verify-driver compatibility route during an active trip', async () => {
    const error = new Error('Validacao adiada ate o fim da corrida');
    error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
    mockClaimVerificationWindow.mockRejectedValueOnce(error);

    const response = await request(createApp())
      .post('/api/kyc/verify-driver')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        deviceKyc: { isMatch: true }
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP');
    expect(mockKycServiceInstance.acceptDeviceVerification).not.toHaveBeenCalled();
  });

  it('forces AWS evidence through the canonical route instead of device compatibility', async () => {
    const response = await request(createApp())
      .post('/api/kyc/verify-driver/device')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        deviceKyc: {
          isMatch: true,
          aws: { sessionId: 'session-1' }
        }
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'KYC_CANONICAL_ROUTE_REQUIRED',
      endpoint: '/api/kyc/verify-driver/server-side-selfie'
    }));
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.acceptDeviceVerification).not.toHaveBeenCalled();
  });

  it('does not let a legacy route resolve a canonical challenge', async () => {
    mockKycPolicyService.getStepUpChallenge.mockResolvedValueOnce({
      challengeId: 'kyc_ch_canonical',
      driverId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      metadata: { canonicalEvidenceRequired: true }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'kyc_ch_canonical',
        deviceKyc: { isMatch: true }
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_CANONICAL_ROUTE_REQUIRED');
    expect(mockKycPolicyService.resolveStepUpChallenge).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.acceptDeviceVerification).not.toHaveBeenCalled();
  });

  it('does not let device compatibility clear a backend revalidation when challengeId is omitted', async () => {
    mockKycPolicyService.requireApprovedKyc.mockResolvedValueOnce({
      allowed: false,
      code: 'KYC_REVERIFY_REQUIRED'
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/device')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        deviceKyc: { isMatch: true }
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_CANONICAL_ROUTE_REQUIRED');
    expect(mockKycServiceInstance.acceptDeviceVerification).not.toHaveBeenCalled();
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
  });

  it('does not let multipart compatibility clear a backend revalidation when challengeId is omitted', async () => {
    mockKycPolicyService.requireApprovedKyc.mockResolvedValueOnce({
      allowed: false,
      code: 'KYC_REVERIFY_REQUIRED'
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .attach('currentImage', Buffer.from('legacy-selfie'), {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg'
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_CANONICAL_ROUTE_REQUIRED');
    expect(mockKycServiceInstance.verifyDriver).not.toHaveBeenCalled();
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
  });

  it('rejects canonical face compare for an abandoned AWS liveness session', async () => {
    const error = new Error('Sessao AWS liveness encerrada pelo usuario');
    error.code = 'AWS_LIVENESS_SESSION_ABANDONED';
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw error;
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-1')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('AWS_LIVENESS_SESSION_ABANDONED');
    expect(mockClaimCanonicalSession).not.toHaveBeenCalled();
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
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
    expect(mockGetSessionResult).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'driver-1',
      requireBoundMetadata: true,
      expectedChallengeId: null,
      expectedRequirement: 'LIVENESS_REQUIRED',
      includeReferenceImage: true
    });
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).toHaveBeenCalledWith(
      'driver-1',
      Buffer.from('aws-reference-image'),
      expect.objectContaining({
        recoverBlocked: true,
        skipStatusSideEffects: true,
        writeVerificationCache: false,
        filename: 'aws-liveness-reference.jpg',
        contentType: 'image/jpeg'
      })
    );
    expect(mockRecordCanonicalSuccess).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({
        driverId: 'driver-1',
        sourcePath: 'server_side_aws_reference_compare',
        awsSessionId: 'session-1',
        livenessPassed: true,
        isMatch: true,
        decision: 'approve',
        referenceImageSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    );
    expect(mockClaimCanonicalSession).toHaveBeenCalledWith(
      'driver-1',
      'session-1',
      { verificationWindowToken: 'verification-window-token' }
    );
    expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
      expect.objectContaining({ acquired: true, key: 'claim-key' }),
      { releaseVerificationWindow: true }
    );
    expect(mockKycPolicyService.recordVerificationSuccess).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({ clearReverify: false })
    );
  });

  it.each([
    [null, null, 'KYC_AWS_REFERENCE_IMAGE_REQUIRED']
  ])(
    'grants one controlled retry and skips comparison for an incomplete AWS reference (%s)',
    async (referenceImageBuffer, referenceImageBoundingBox, expectedCode) => {
      mockGetSessionResult.mockResolvedValueOnce({
        provider: 'aws_rekognition_face_liveness',
        sessionId: 'session-1',
        completed: true,
        status: 'SUCCEEDED',
        confidence: 98,
        confidenceThreshold: 80,
        livenessPassed: true,
        attemptScope: 'first_access',
        referenceImageBuffer,
        referenceImageBoundingBox,
        sessionMetadata: {
          costGuardOperationId: 'cost-operation-session-1'
        }
      });
      const verifyCanonical = jest.spyOn(kycRoutes, 'verifyCanonicalFaceMatch');

      try {
        const response = await request(createApp())
          .post('/api/kyc/verify-driver/server-side-selfie')
          .set('Authorization', 'Bearer firebase-token')
          .field('userId', 'driver-1')
          .field('awsSessionId', 'session-1')
          .field('requirement', 'LIVENESS_REQUIRED');

        expect(response.status).toBe(422);
        expect(response.body).toEqual(expect.objectContaining({
          success: false,
          code: expectedCode,
          retryable: true,
          error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.',
          attemptState: expect.objectContaining({
            effectiveMax: 3,
            recoveryAllowanceRemaining: 1
          })
        }));
        expect(mockGrantReferenceImageRecoveryAttempt).toHaveBeenCalledWith({
          userId: 'driver-1',
          sessionId: 'session-1',
          requirement: 'LIVENESS_REQUIRED',
          attemptScope: 'first_access'
        });
        expect(verifyCanonical).not.toHaveBeenCalled();
        expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
        expect(mockRecordCanonicalFailure).not.toHaveBeenCalled();
        expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
          expect.objectContaining({ acquired: true }),
          { releaseVerificationWindow: true }
        );
      } finally {
        verifyCanonical.mockRestore();
      }
    }
  );

  it('reports provider unavailability without blaming the user when recovery credits are exhausted', async () => {
    mockGetSessionResult.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-1',
      completed: true,
      status: 'SUCCEEDED',
      confidence: 98,
      confidenceThreshold: 80,
      livenessPassed: true,
      attemptScope: 'first_access',
      referenceImageBuffer: null,
      referenceImageBoundingBox: null
    });
    mockGrantReferenceImageRecoveryAttempt.mockResolvedValueOnce({
      status: 'recovery_limit_reached',
      granted: false,
      canRetry: false,
      attemptState: {
        started: 3,
        passed: 3,
        failed: 0,
        maxAttempts: 2,
        effectiveMax: 3,
        recoveryAllowanceRemaining: 0,
        attemptsExhausted: true,
        softBlocked: false
      }
    });
    const verifyCanonical = jest.spyOn(kycRoutes, 'verifyCanonicalFaceMatch');

    try {
      const response = await request(createApp())
        .post('/api/kyc/verify-driver/server-side-selfie')
        .set('Authorization', 'Bearer firebase-token')
        .field('userId', 'driver-1')
        .field('awsSessionId', 'session-1')
        .field('requirement', 'LIVENESS_REQUIRED');

      expect(response.status).toBe(503);
      expect(response.body).toEqual(expect.objectContaining({
        success: false,
        code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
        retryable: false,
        attemptState: expect.objectContaining({ attemptsExhausted: true })
      }));
      expect(verifyCanonical).not.toHaveBeenCalled();
    } finally {
      verifyCanonical.mockRestore();
    }
  });

  it('uses AWS CompareFaces only in the canonical server-side route', async () => {
    const sourceImageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const reference = {
      bindingVersion: 2,
      source: 'approved_cnh_pdf_crop_v1',
      documentType: 'cnh',
      model: 'aws_rekognition_compare_faces_managed',
      submissionId: 'submission-current-1',
      documentPathSha256: 'a'.repeat(64),
      imageSha256: 'b'.repeat(64),
      cropVersion: 'cnh_digital_photo_crop_v1',
      createdAt: '2026-07-13T12:00:00.000Z'
    };
    const loadReference = jest.spyOn(kycRoutes, 'loadCanonicalApprovedCnhPortrait')
      .mockResolvedValue({ sourceImageBuffer, reference });
    const providerSelection = jest.spyOn(kycRoutes, 'usesAwsCanonicalFaceCompare')
      .mockReturnValue(true);
    const verifyAws = jest.fn().mockResolvedValue({
      success: true,
      userId: 'driver-1',
      isMatch: true,
      needsReview: false,
      similarityScore: 0.97,
      confidence: 0.97,
      threshold: 0.95,
      reviewThreshold: 0.80,
      decision: 'approve',
      processingTime: 140,
      mode: 'server_aws_compare_faces_v1',
      provider: 'aws_rekognition_compare_faces',
      comparisonProvider: 'aws_rekognition_compare_faces',
      embeddingDimension: null,
      reference,
      current: { model: 'aws_rekognition_compare_faces_managed' }
    });
    const previousCompareService = kycRoutes.awsFaceCompareService;
    kycRoutes.awsFaceCompareService = {
      ...previousCompareService,
      verifyApprovedCnhAgainstLiveness: verifyAws
    };

    try {
      const response = await request(createApp())
        .post('/api/kyc/verify-driver/server-side-selfie')
        .set('Authorization', 'Bearer firebase-token')
        .field('userId', 'driver-1')
        .field('awsSessionId', 'session-1')
        .field('requirement', 'LIVENESS_REQUIRED');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({
        mode: 'server_aws_compare_faces_v1',
        comparisonProvider: 'aws_rekognition_compare_faces',
        isMatch: true
      }));
      expect(loadReference).toHaveBeenCalledWith('driver-1');
      expect(verifyAws).toHaveBeenCalledWith(expect.objectContaining({
        driverId: 'driver-1',
        sourceImageBuffer,
        reference,
        liveness: expect.objectContaining({
          provider: 'aws_rekognition_face_liveness',
          sessionId: 'session-1',
          status: 'SUCCEEDED',
          livenessPassed: true,
          costGuardOperationId: 'cost-operation-session-1',
          referenceImageBoundingBox: {
            width: 0.42,
            height: 0.58,
            left: 0.29,
            top: 0.18
          }
        })
      }));
      expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
      expect(mockRecordCanonicalSuccess).toHaveBeenCalledWith(
        'driver-1',
        expect.objectContaining({
          comparisonProvider: 'aws_rekognition_compare_faces',
          reference
        })
      );
    } finally {
      kycRoutes.awsFaceCompareService = previousCompareService;
      loadReference.mockRestore();
      providerSelection.mockRestore();
    }
  });

  it.each([
    [
      'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
      'Não conseguimos identificar a foto na CNH aprovada. Envie uma nova versão do documento.'
    ],
    [
      'AWS_COMPARE_FACES_LIVENESS_FACE_BOUNDS_REQUIRED',
      'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.'
    ]
  ])(
    'returns a safe 422 and releases the verification window for %s',
    async (code, safeError) => {
      const sourceImageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      const loadReference = jest.spyOn(kycRoutes, 'loadCanonicalApprovedCnhPortrait')
        .mockResolvedValue({
          sourceImageBuffer,
          reference: { source: 'approved_cnh_pdf_crop_v1' }
        });
      const providerSelection = jest.spyOn(kycRoutes, 'usesAwsCanonicalFaceCompare')
        .mockReturnValue(true);
      const providerError = Object.assign(
        new Error('Falha ao executar comparacao facial AWS'),
        { code }
      );
      const previousCompareService = kycRoutes.awsFaceCompareService;
      kycRoutes.awsFaceCompareService = {
        ...previousCompareService,
        verifyApprovedCnhAgainstLiveness: jest.fn().mockRejectedValue(providerError)
      };

      try {
        const response = await request(createApp())
          .post('/api/kyc/verify-driver/server-side-selfie')
          .set('Authorization', 'Bearer firebase-token')
          .field('userId', 'driver-1')
          .field('awsSessionId', 'session-1')
          .field('requirement', 'LIVENESS_REQUIRED');

        expect(response.status).toBe(422);
        expect(response.body).toEqual({
          success: false,
          error: safeError,
          code
        });
        expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
          expect.objectContaining({ acquired: true, key: 'claim-key' }),
          { releaseVerificationWindow: true }
        );
      } finally {
        kycRoutes.awsFaceCompareService = previousCompareService;
        loadReference.mockRestore();
        providerSelection.mockRestore();
      }
    }
  );

  it('grants a technical retry when CompareFaces cannot detect the bound liveness image', async () => {
    const sourceImageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const loadReference = jest.spyOn(kycRoutes, 'loadCanonicalApprovedCnhPortrait')
      .mockResolvedValue({
        sourceImageBuffer,
        reference: { source: 'approved_cnh_pdf_crop_v1' }
      });
    const providerSelection = jest.spyOn(kycRoutes, 'usesAwsCanonicalFaceCompare')
      .mockReturnValue(true);
    const previousCompareService = kycRoutes.awsFaceCompareService;
    kycRoutes.awsFaceCompareService = {
      ...previousCompareService,
      verifyApprovedCnhAgainstLiveness: jest.fn().mockRejectedValue(Object.assign(
        new Error('Target image has no detectable face'),
        { code: 'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED' }
      ))
    };

    try {
      const response = await request(createApp())
        .post('/api/kyc/verify-driver/server-side-selfie')
        .set('Authorization', 'Bearer firebase-token')
        .field('userId', 'driver-1')
        .field('awsSessionId', 'session-1')
        .field('requirement', 'LIVENESS_REQUIRED');

      expect(response.status).toBe(422);
      expect(response.body).toEqual(expect.objectContaining({
        success: false,
        code: 'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED',
        retryable: true,
        attemptState: expect.objectContaining({ recoveryAllowanceRemaining: 1 })
      }));
      expect(mockGrantReferenceImageRecoveryAttempt).toHaveBeenCalledTimes(1);
      expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
      expect(mockRecordCanonicalFailure).not.toHaveBeenCalled();
    } finally {
      kycRoutes.awsFaceCompareService = previousCompareService;
      loadReference.mockRestore();
      providerSelection.mockRestore();
    }
  });

  it('does not require a second client selfie because AWS reference bytes are canonical', async () => {
    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-1')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(200);
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).toHaveBeenCalledWith(
      'driver-1',
      Buffer.from('aws-reference-image'),
      expect.any(Object)
    );
  });

  it('rejects a consumed AWS session before reading the provider result', async () => {
    mockClaimCanonicalSession.mockResolvedValueOnce({
      acquired: true,
      consumed: true,
      key: 'claim-key',
      token: 'claim-token',
      verificationWindowClaim: {
        acquired: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-consumed')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_AWS_SESSION_ALREADY_CONSUMED');
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
    expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
      expect.objectContaining({ consumed: true }),
      { releaseVerificationWindow: true }
    );
  });

  it('reconciles approved durable identity evidence after AWS metadata expires', async () => {
    const challengeId = 'idrev_reconcile';
    const sessionHash = 'canonical-session-hash';
    mockGetSessionMetadata.mockRejectedValueOnce(Object.assign(
      new Error('AWS session metadata expired'),
      { code: 'AWS_LIVENESS_SESSION_EXPIRED' }
    ));
    mockClaimCanonicalSession.mockResolvedValueOnce({
      acquired: true,
      consumed: true,
      sessionHash,
      key: 'claim-key',
      token: 'claim-token',
      existingEvidence: {
        evidenceId: sessionHash,
        driverId: 'driver-1',
        sourcePath: 'server_side_aws_reference_compare',
        status: 'approved',
        challengeId,
        requirement: 'IDENTITY_REVERIFICATION',
        faceMatch: {
          provider: 'leaf_face_compare_service',
          comparisonProvider: 'leaf_face_compare_service',
          decision: 'approve',
          score: 0.94,
          threshold: 0.9,
          reviewThreshold: 0.78,
          embeddingDimension: 512
        }
      },
      verificationWindowClaim: {
        acquired: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-reconcile')
      .field('challengeId', challengeId)
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      isMatch: true,
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      idempotentReconciliation: true
    }));
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
    expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
    expect(mockClaimCanonicalSession).toHaveBeenCalledWith(
      'driver-1',
      'session-reconcile',
      { verificationWindowToken: null }
    );
    expect(mockKycPolicyService.recordIdentityReverificationResult).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({
        isMatch: true,
        challengeId,
        reconciliationOnly: true
      })
    );
    expect(mockKycPolicyService.recordVerificationSuccess).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({ clearReverify: false })
    );
    expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
      expect.objectContaining({ consumed: true }),
      { releaseVerificationWindow: true }
    );
  });

  it('preserves a later block instead of replaying an older approved identity result', async () => {
    const challengeId = 'idrev_before_admin_block';
    const sessionHash = 'canonical-session-hash';
    mockClaimCanonicalSession.mockResolvedValueOnce({
      acquired: true,
      consumed: true,
      sessionHash,
      key: 'claim-key',
      token: 'claim-token',
      existingEvidence: {
        evidenceId: sessionHash,
        driverId: 'driver-1',
        sourcePath: 'server_side_aws_reference_compare',
        status: 'approved',
        challengeId,
        requirement: 'IDENTITY_REVERIFICATION',
        faceMatch: {
          decision: 'approve',
          score: 0.94,
          threshold: 0.9,
          reviewThreshold: 0.78
        }
      },
      verificationWindowClaim: {
        acquired: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });
    mockKycPolicyService.recordIdentityReverificationResult.mockResolvedValueOnce({
      success: true,
      recorded: false,
      stale: true,
      code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-before-admin-block')
      .field('challengeId', challengeId)
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK');
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
  });

  it('does not reconcile consumed identity evidence bound to another challenge', async () => {
    mockClaimCanonicalSession.mockResolvedValueOnce({
      acquired: true,
      consumed: true,
      sessionHash: 'canonical-session-hash',
      key: 'claim-key',
      token: 'claim-token',
      existingEvidence: {
        evidenceId: 'canonical-session-hash',
        driverId: 'driver-1',
        sourcePath: 'server_side_aws_reference_compare',
        status: 'approved',
        challengeId: 'idrev_other',
        requirement: 'IDENTITY_REVERIFICATION',
        faceMatch: {
          decision: 'approve',
          score: 0.94,
          threshold: 0.9,
          reviewThreshold: 0.78
        }
      },
      verificationWindowClaim: {
        acquired: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-reconcile')
      .field('challengeId', 'idrev_current')
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_AWS_SESSION_ALREADY_CONSUMED');
    expect(mockKycPolicyService.recordIdentityReverificationResult).not.toHaveBeenCalled();
    expect(mockGetSessionResult).not.toHaveBeenCalled();
  });

  it('does not run policy mutation for a concurrent consumed-session reconciliation', async () => {
    mockClaimCanonicalSession.mockResolvedValueOnce({
      acquired: false,
      consumed: true,
      busy: true,
      sessionHash: 'canonical-session-hash',
      verificationWindowClaim: {
        acquired: true,
        reused: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-reconcile')
      .field('challengeId', 'idrev_reconcile')
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_CANONICAL_SESSION_BUSY');
    expect(mockKycPolicyService.recordIdentityReverificationResult).not.toHaveBeenCalled();
    expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
      expect.objectContaining({ busy: true, consumed: true }),
      { releaseVerificationWindow: false }
    );
  });

  it('keeps strict AWS metadata mandatory for an unconsumed session', async () => {
    mockGetSessionMetadata.mockRejectedValueOnce(Object.assign(
      new Error('AWS session metadata expired'),
      { code: 'AWS_LIVENESS_SESSION_EXPIRED' }
    ));

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-unconsumed')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('AWS_LIVENESS_SESSION_EXPIRED');
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
    expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
      expect.objectContaining({ acquired: true, consumed: false }),
      { releaseVerificationWindow: true }
    );
  });

  it('does not release a shared verification window when a duplicate canonical request is busy', async () => {
    mockClaimCanonicalSession.mockResolvedValueOnce({
      acquired: false,
      consumed: false,
      busy: true,
      verificationWindowClaim: {
        acquired: true,
        reused: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-1')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_CANONICAL_SESSION_BUSY');
    expect(mockReleaseCanonicalSessionClaim).toHaveBeenCalledWith(
      expect.objectContaining({ busy: true }),
      { releaseVerificationWindow: false }
    );
  });

  it('fails closed before face compare when the canonical lease is lost', async () => {
    mockRenewCanonicalSessionClaim.mockResolvedValueOnce(false);

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-1')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_VERIFICATION_LEASE_LOST');
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
    expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
  });

  it('persists identity reverify failure and revokes canonical trust before returning 403', async () => {
    mockKycServiceInstance.verifyDriverServerSideSelfie.mockResolvedValueOnce({
      success: true,
      userId: 'driver-1',
      isMatch: false,
      needsReview: false,
      similarityScore: 0.21,
      confidence: 0.21,
      threshold: 0.9,
      reviewThreshold: 0.78,
      decision: 'reject',
      mode: 'server_biometric_selfie_v1'
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-reverify-failed')
      .field('challengeId', 'idrev_driver-1')
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'KYC_CHALLENGE_NOT_PASSED',
      isMatch: false
    }));
    expect(response.body).not.toHaveProperty('similarityScore');
    expect(response.body).not.toHaveProperty('confidence');
    expect(response.body).not.toHaveProperty('decision');
    expect(mockKycPolicyService.recordIdentityReverificationResult).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({
        isMatch: false,
        requirement: 'IDENTITY_REVERIFICATION'
      })
    );
    expect(mockRecordCanonicalFailure).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({
        awsSessionId: 'session-reverify-failed',
        reason: 'identity_reverification_failed',
        decision: 'reject'
      })
    );
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
  });

  it('does not clear a newer identity challenge with an older successful canonical session', async () => {
    mockKycPolicyService.recordIdentityReverificationResult.mockResolvedValueOnce({
      success: true,
      recorded: false,
      stale: true,
      code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-old-reverify')
      .field('challengeId', 'idrev_old')
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_IDENTITY_REVERIFY_CHALLENGE_STALE');
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
  });

  it('does not reapply status side effects when canonical persistence identifies a replay', async () => {
    mockRecordCanonicalSuccess.mockResolvedValueOnce({
      success: true,
      evidenceId: 'evidence-1',
      idempotentReplay: true
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-replayed')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_AWS_SESSION_ALREADY_CONSUMED');
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
    expect(mockKycPolicyService.resolveStepUpChallenge).not.toHaveBeenCalled();
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
