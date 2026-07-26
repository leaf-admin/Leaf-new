jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockEvaluateProductionReadiness = jest.fn();
const mockCreateSession = jest.fn();
const mockGetSessionResult = jest.fn();
const mockAbandonSession = jest.fn();
const mockIssueTemporaryCredentials = jest.fn();
const mockGetAttemptState = jest.fn();
const mockGetSessionMetadata = jest.fn();
const mockRecoverCommittedSession = jest.fn();
const mockRecoverExpiredSessionMetadata = jest.fn();
const mockAssertBoundSessionMetadata = jest.fn();
const mockGrantReferenceImageRecoveryAttempt = jest.fn();
const mockRecordCanonicalSuccess = jest.fn();
const mockRecordCanonicalFailure = jest.fn();
const mockLinkReviewEvidenceToCanonicalFailure = jest.fn();
const mockCaptureRejectedComparisonEvidence = jest.fn();
const mockDeleteFailedBiometricEvidence = jest.fn();
const mockAssertVerificationOutsideActiveTrip = jest.fn();
const mockClaimCanonicalSession = jest.fn();
const mockReleaseCanonicalSessionClaim = jest.fn();
const mockRenewCanonicalSessionClaim = jest.fn();
const mockRestoreApprovedIdentityVerification = jest.fn();
const mockRestoreRejectedIdentityVerification = jest.fn();
const mockClaimVerificationWindow = jest.fn();
const mockReleaseVerificationWindow = jest.fn();
const mockGetFromRealtimeDB = jest.fn();
const mockGetFirestore = jest.fn();
const mockAssertKycOperationAllowed = jest.fn();
const mockClaimCleanRetryAuthorization = jest.fn();
const mockConsumeCleanRetryAuthorization = jest.fn();
const mockResumeCleanRetryAuthorization = jest.fn();
const mockReleaseCleanRetryAuthorization = jest.fn();
const mockFinalizeCleanRetryAuthorization = jest.fn();
let mockRuntimeNamespace = 'operational';
const mockKycPolicyService = {
  requireApprovedKyc: jest.fn(async () => ({ allowed: true, code: 'KYC_APPROVED' })),
  requiresFirstAccessLiveness: jest.fn(async () => ({ required: false })),
  getStepUpChallenge: jest.fn(async () => null),
  isLivenessSatisfied: jest.fn(() => true),
  recordIdentityReverificationStarted: jest.fn(async () => ({ success: true, recorded: true })),
  recordIdentityReverificationResult: jest.fn(async () => ({ success: true, recorded: true })),
  reconcileRejectedIdentityReverificationMirror: jest.fn(
    async () => ({ success: true, recorded: true, rtdbOnly: true })
  ),
  recordVerificationSuccess: jest.fn(async () => ({ success: true })),
  resolveStepUpChallenge: jest.fn(async () => ({ success: true })),
  markDriverForLivenessAttemptsExhausted: jest.fn(async () => ({ success: true, softBlocked: true }))
};

const mockKycServiceInstance = {
  initialized: true,
  preprocessProfileImage: jest.fn(),
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
  getFirestore: (...args) => mockGetFirestore(...args),
  getFromRealtimeDB: (...args) => mockGetFromRealtimeDB(...args)
}));

jest.mock('../../../services/IntegratedKYCService', () => jest.fn(() => mockKycServiceInstance));

jest.mock('../../../services/kyc-biometric-production-policy', () => ({
  evaluateProductionReadiness: (...args) => mockEvaluateProductionReadiness(...args)
}));

jest.mock('../../../services/aws-face-liveness-service', () => jest.fn(() => ({
  getProviderName: jest.fn(() => 'aws_rekognition_face_liveness'),
  getConfigSummary: jest.fn(() => ({
    enabled: true,
    credentialsEnabled: true,
    hasAssumeRoleArn: true,
    region: 'us-east-1',
    confidenceThreshold: 80,
    challengeType: 'FaceMovementAndLightChallenge',
    estimatedUnitCostUsd: 0.015,
    maxAttemptsPerWindow: 5
  })),
  createSession: (...args) => mockCreateSession(...args),
  getAttemptState: (...args) => mockGetAttemptState(...args),
  getSessionResult: (...args) => mockGetSessionResult(...args),
  abandonSession: (...args) => mockAbandonSession(...args),
  getSessionMetadata: (...args) => mockGetSessionMetadata(...args),
  recoverCommittedSession: (...args) => mockRecoverCommittedSession(...args),
  recoverExpiredSessionMetadata: (...args) => mockRecoverExpiredSessionMetadata(...args),
  assertBoundSessionMetadata: (...args) => mockAssertBoundSessionMetadata(...args),
  grantReferenceImageRecoveryAttempt: (...args) => mockGrantReferenceImageRecoveryAttempt(...args),
  issueTemporaryCredentials: (...args) => mockIssueTemporaryCredentials(...args),
  toDevicePayload: jest.fn((awsResult, payload) => ({
    ...payload,
    aws: awsResult,
    awsLivenessPassed: awsResult?.livenessPassed === true
  }))
})));

jest.mock('../../../services/kyc-policy-service', () => mockKycPolicyService);

jest.mock('../../../services/driver-identity-trust-service', () => ({
  recordCanonicalSuccess: (...args) => mockRecordCanonicalSuccess(...args),
  recordCanonicalFailure: (...args) => mockRecordCanonicalFailure(...args),
  linkReviewEvidenceToCanonicalFailure: (...args) => mockLinkReviewEvidenceToCanonicalFailure(...args),
  assertVerificationOutsideActiveTrip: (...args) => mockAssertVerificationOutsideActiveTrip(...args),
  claimCanonicalSession: (...args) => mockClaimCanonicalSession(...args),
  releaseCanonicalSessionClaim: (...args) => mockReleaseCanonicalSessionClaim(...args),
  renewCanonicalSessionClaim: (...args) => mockRenewCanonicalSessionClaim(...args),
  restoreApprovedIdentityVerification: (...args) => mockRestoreApprovedIdentityVerification(...args),
  restoreRejectedIdentityVerification: (...args) => mockRestoreRejectedIdentityVerification(...args),
  claimVerificationWindow: (...args) => mockClaimVerificationWindow(...args),
  releaseVerificationWindow: (...args) => mockReleaseVerificationWindow(...args)
}));

jest.mock('../../../services/kyc-identity-review-workflow-service', () => ({
  assertKycOperationAllowed: (...args) => mockAssertKycOperationAllowed(...args),
  claimCleanRetryAuthorization: (...args) => mockClaimCleanRetryAuthorization(...args),
  consumeCleanRetryAuthorization: (...args) => mockConsumeCleanRetryAuthorization(...args),
  resumeCleanRetryAuthorization: (...args) => mockResumeCleanRetryAuthorization(...args),
  releaseCleanRetryAuthorization: (...args) => mockReleaseCleanRetryAuthorization(...args),
  finalizeCleanRetryAuthorization: (...args) => mockFinalizeCleanRetryAuthorization(...args),
  clearResolvedMismatchHold: jest.fn(async () => ({ cleared: true }))
}));

jest.mock('../../../services/kyc-runtime-scope-service', () => ({
  resolveKycRuntimeForUser: jest.fn(async () => ({
    namespace: mockRuntimeNamespace,
    scope: {
      namespace: mockRuntimeNamespace,
      financialContextId: `ctx_${mockRuntimeNamespace}_test`,
      collections: {
        driverIdentityEnforcement: 'driver_identity_enforcement'
      }
    },
    trustService: {
      recordCanonicalSuccess: (...args) => mockRecordCanonicalSuccess(...args),
      recordCanonicalFailure: (...args) => mockRecordCanonicalFailure(...args),
      linkReviewEvidenceToCanonicalFailure: (...args) => mockLinkReviewEvidenceToCanonicalFailure(...args),
      assertVerificationOutsideActiveTrip: (...args) => mockAssertVerificationOutsideActiveTrip(...args),
      claimCanonicalSession: (...args) => mockClaimCanonicalSession(...args),
      releaseCanonicalSessionClaim: (...args) => mockReleaseCanonicalSessionClaim(...args),
      renewCanonicalSessionClaim: (...args) => mockRenewCanonicalSessionClaim(...args),
      restoreApprovedIdentityVerification: (...args) => mockRestoreApprovedIdentityVerification(...args),
      restoreRejectedIdentityVerification: (...args) => mockRestoreRejectedIdentityVerification(...args),
      readCanonicalCompatibilityVerification: jest.fn(async () => ({
        hasValid: false,
        reason: 'Nova evidencia canonica necessaria.'
      })),
      claimVerificationWindow: (...args) => mockClaimVerificationWindow(...args),
      releaseVerificationWindow: (...args) => mockReleaseVerificationWindow(...args)
    },
    evidenceService: {
      captureRejectedComparisonEvidence: (...args) =>
        mockCaptureRejectedComparisonEvidence(...args),
      deleteEvidence: (...args) => mockDeleteFailedBiometricEvidence(...args)
    },
    workflowService: {
      assertKycOperationAllowed: (...args) => mockAssertKycOperationAllowed(...args),
      claimCleanRetryAuthorization: (...args) => mockClaimCleanRetryAuthorization(...args),
      consumeCleanRetryAuthorization: (...args) => mockConsumeCleanRetryAuthorization(...args),
      resumeCleanRetryAuthorization: (...args) => mockResumeCleanRetryAuthorization(...args),
      releaseCleanRetryAuthorization: (...args) => mockReleaseCleanRetryAuthorization(...args),
      finalizeCleanRetryAuthorization: (...args) => mockFinalizeCleanRetryAuthorization(...args),
      clearResolvedMismatchHold: jest.fn(async () => ({ cleared: true }))
    },
    policyService: mockKycPolicyService
  }))
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

const CANONICAL_COMPARE_PRIVATE_RESPONSE_FIELDS = [
  'userId',
  'similarity',
  'similarityScore',
  'confidence',
  'threshold',
  'reviewThreshold',
  'processingTime',
  'mode',
  'decision',
  'embeddingDimension',
  'comparisonProvider',
  'provider',
  'model',
  'currentModel'
];

const LIVENESS_SESSION_PRIVATE_RESPONSE_FIELDS = [
  'attempt',
  'attemptScope',
  'attemptState',
  'attemptsExhausted',
  'softBlocked',
  'started',
  'failed',
  'passed',
  'maxAttempts',
  'effectiveMax',
  'recoveryAllowanceTotal',
  'recoveryAllowanceRemaining',
  'confidence',
  'confidenceNormalized',
  'confidenceThreshold',
  'estimatedUnitCostUsd',
  'estimatedCostUsd',
  'processingTime',
  'model',
  'providerRequestId',
  'requestId',
  'referenceImageBuffer',
  'referenceImageBoundingBox',
  'referenceImageSha256',
  'referenceImageAvailable',
  'referenceImageFaceDetected',
  'referenceImageArtifactStatus',
  'referenceImageReadAttempts',
  'sessionMetadata',
  'costGuardOperationId',
  'verificationWindowToken',
  'persistenceNamespace',
  'financialContextId',
  'auditImagesCount',
  'challenge',
  'userId',
  'requirement',
  'challengeId'
];

function expectCanonicalComparePublicProjection(payload) {
  for (const field of CANONICAL_COMPARE_PRIVATE_RESPONSE_FIELDS) {
    expect(payload).not.toHaveProperty(field);
  }
}

function expectLivenessSessionPublicProjection(payload) {
  for (const field of LIVENESS_SESSION_PRIVATE_RESPONSE_FIELDS) {
    expect(payload).not.toHaveProperty(field);
  }
  expect(JSON.stringify(payload)).not.toMatch(
    /recoveryAllowance|referenceImage|sessionMetadata|costGuardOperation|verificationWindow|financialContext|persistenceNamespace|providerRequestId|clientRequestToken/i
  );
}

function expectReferenceImageRecoveryPublicProjection(payload) {
  expect(Object.keys(payload).sort()).toEqual([
    'code',
    'error',
    'retryable',
    'success'
  ]);
  expect(payload).not.toHaveProperty('attemptState');
  expect(JSON.stringify(payload)).not.toMatch(
    /attemptState|recoveryAllowance|attemptScope|maxAttempts|effectiveMax|softBlocked/i
  );
}

describe('kyc routes auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntimeNamespace = 'operational';
    mockVerifyIdToken.mockResolvedValue({ uid: 'driver-1', phone_number: '+5521123456789' });
    mockGetFirestore.mockReset().mockReturnValue(null);
    mockGetFromRealtimeDB.mockResolvedValue(null);
    mockEvaluateProductionReadiness.mockReturnValue({
      ok: true,
      enabled: true,
      policy: {
        productionRuntime: true,
        productionBiometricsEnabled: true,
        strictProductionMode: true
      },
      blockers: [],
      warnings: []
    });
    mockAssertKycOperationAllowed.mockResolvedValue({
      allowed: true,
      identityReviewHold: false,
      cnhReplacementHold: false,
      cleanRetryAuthorized: false
    });
    mockClaimCleanRetryAuthorization.mockResolvedValue(null);
    mockConsumeCleanRetryAuthorization.mockResolvedValue({ consumed: true });
    mockResumeCleanRetryAuthorization.mockResolvedValue({
      status: 'CONSUMED',
      idempotentReplay: false
    });
    mockReleaseCleanRetryAuthorization.mockResolvedValue({ released: true });
    mockFinalizeCleanRetryAuthorization.mockResolvedValue(null);
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
    mockKycPolicyService.reconcileRejectedIdentityReverificationMirror
      .mockReset()
      .mockResolvedValue({ success: true, recorded: true, rtdbOnly: true });
    mockKycPolicyService.recordVerificationSuccess
      .mockReset()
      .mockResolvedValue({ success: true });
    mockCreateSession.mockResolvedValue({
      success: true,
      provider: 'internal-provider-id-should-not-leak',
      sessionId: 'session-1',
      region: 'us-east-1',
      challengeType: 'FaceMovementChallenge',
      expiresAt: '2026-07-13T12:20:00.000Z',
      status: 'CREATED',
      confidenceThreshold: 80,
      attempt: 1,
      maxAttempts: 5,
      estimatedUnitCostUsd: 0.015,
      providerRequestId: 'provider-request-secret',
      sessionMetadata: { costGuardOperationId: 'cost-operation-secret' }
    });
    mockGetAttemptState.mockResolvedValue(null);
    mockRecoverCommittedSession.mockResolvedValue(null);
    mockRecoverExpiredSessionMetadata.mockResolvedValue(null);
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
      challengeType: 'FaceMovementChallenge',
      createdAt: '2026-07-13T12:00:00.000Z',
      expiresAt: '2026-07-13T12:20:00.000Z',
      verificationWindowToken: 'verification-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
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
    mockLinkReviewEvidenceToCanonicalFailure.mockResolvedValue({ success: true });
    mockCaptureRejectedComparisonEvidence
      .mockReset()
      .mockResolvedValue({ evidenceId: 'private-review-evidence-1' });
    mockDeleteFailedBiometricEvidence
      .mockReset()
      .mockResolvedValue({ evidenceId: 'private-review-evidence-1', deleted: true });
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
        mode: challengeId
          ? 'canonical_identity_reconciliation_v1'
          : 'canonical_first_access_reconciliation_v1',
        requirement,
        challengeId
      };
    });
    mockRestoreRejectedIdentityVerification.mockReset().mockReturnValue(null);
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
    expect(response.body).toEqual({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      config: {
        enabled: true,
        credentialsEnabled: true,
        hasAssumeRoleArn: true
      }
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /threshold|budget|cost|attempt|estimated|region|bucket/i
    );
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
    expect(response.body).toEqual({
      success: true,
      ready: true,
      code: 'KYC_BIOMETRICS_READY'
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /policy|threshold|provider|budget|cost|attempt|config|blocker|warning/i
    );
  });

  it('returns only a safe aggregate code when biometric readiness is blocked', async () => {
    mockEvaluateProductionReadiness.mockReturnValueOnce({
      ok: false,
      enabled: true,
      policy: {
        productionRuntime: true,
        productionBiometricsEnabled: true,
        strictProductionMode: true
      },
      blockers: ['approveThreshold=0.42; dailyBudgetUsd=100'],
      warnings: ['internal provider warning']
    });

    const response = await request(createApp())
      .get('/api/kyc/biometrics/readiness')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      ready: false,
      code: 'KYC_BIOMETRICS_NOT_READY'
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /threshold|provider|budget|policy|blocker|warning|0\.42|100/i
    );
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
      holdCaseId: 'kyc_case_1',
      reviewAvailable: true
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer valid-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(423);
    expect(response.body).toEqual({
      success: false,
      error: 'Sua identidade esta sendo analisada. Avisaremos quando houver uma atualizacao.',
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      reviewAvailable: true,
      reviewCaseId: 'kyc_case_1'
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('does not claim a review is in progress when a hold has no traceable case', async () => {
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: true,
      holdCaseId: 'case_internal_orphan',
      holdEvidenceId: 'evidence_internal_orphan',
      reviewAvailable: false
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer valid-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(423);
    expect(response.body).toEqual({
      success: false,
      error: 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
      code: 'KYC_IDENTITY_RECOVERY_REQUIRED',
      reviewAvailable: false
    });
    expect(response.body).not.toHaveProperty('reviewCaseId');
    expect(response.body).not.toHaveProperty('evidenceId');
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
    expect(response.body).toEqual({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      region: 'us-east-1',
      sessionId: 'session-1',
      challengeType: 'FaceMovementChallenge',
      expiresAt: '2026-07-13T12:20:00.000Z',
      status: 'CREATED'
    });
    expectLivenessSessionPublicProjection(response.body);
    expect(mockCreateSession).toHaveBeenCalledWith({
      userId: 'driver-1',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      verificationWindowToken: 'verification-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
  });

  it('resumes a completed first-access liveness session without another paid dispatch', async () => {
    const sessionId = 'aws-session-first-access-succeeded';
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 1,
      lastSessionId: sessionId,
      lastStatus: 'SUCCEEDED'
    });
    mockGetSessionMetadata.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      challengeType: 'FaceMovementChallenge',
      createdAt: '2026-07-21T12:00:00.000Z',
      completedAt: '2026-07-21T12:01:00.000Z',
      expiresAt: '2099-07-21T12:03:00.000Z',
      status: 'SUCCEEDED',
      livenessPassed: true,
      verificationWindowToken: 'first-access-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      region: 'us-east-1',
      sessionId,
      challengeType: 'FaceMovementChallenge',
      expiresAt: '2099-07-21T12:03:00.000Z',
      status: 'SUCCEEDED',
      completed: true,
      livenessPassed: true
    });
    expectLivenessSessionPublicProjection(response.body);
    expect(mockClaimVerificationWindow).toHaveBeenCalledWith('driver-1', {
      token: 'first-access-window-token',
      scope: 'aws_liveness_session_resume'
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('starts a new first-access session only after the previous one is terminally failed', async () => {
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 1,
      failed: 1,
      lastSessionId: 'aws-session-first-access-failed',
      lastStatus: 'FAILED'
    });
    mockGetSessionMetadata.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      completedAt: '2026-07-21T12:01:00.000Z',
      expiresAt: '2099-07-21T12:03:00.000Z',
      status: 'FAILED',
      livenessPassed: false,
      verificationWindowToken: 'failed-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(201);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('starts the remaining attempt only after retained metadata canonically proves expiry', async () => {
    const expiredSessionId = 'aws-session-first-access-expired';
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 1,
      failed: 0,
      maxAttempts: 2,
      lastSessionId: expiredSessionId,
      lastStatus: null
    });
    mockGetSessionMetadata.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      createdAt: '2026-07-21T12:00:00.000Z',
      expiresAt: '2026-07-21T12:03:00.000Z',
      verificationWindowToken: 'expired-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw Object.assign(new Error('canonical session expired'), {
        code: 'AWS_LIVENESS_SESSION_EXPIRED'
      });
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(201);
    expect(mockAssertBoundSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'driver-1',
        attemptScope: 'first_access',
        expiresAt: '2026-07-21T12:03:00.000Z'
      }),
      expect.objectContaining({
        userId: 'driver-1',
        expectedRequirement: 'LIVENESS_REQUIRED'
      })
    );
    expect(mockRecoverCommittedSession).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('restores a missing expired metadata proof only after canonical cost-guard attestation', async () => {
    const expiredSessionId = 'aws-session-expired-proof-restored';
    const expiredMetadata = {
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      createdAt: '2026-07-21T12:00:00.000Z',
      expiresAt: '2026-07-21T12:03:00.000Z',
      verificationWindowToken: 'expired-restored-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    };
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 1,
      failed: 0,
      maxAttempts: 2,
      lastSessionId: expiredSessionId,
      lastStatus: null
    });
    mockGetSessionMetadata.mockResolvedValueOnce(null);
    mockRecoverCommittedSession.mockResolvedValueOnce(null);
    mockRecoverExpiredSessionMetadata.mockResolvedValueOnce({
      sessionId: expiredSessionId,
      sessionMetadata: expiredMetadata,
      expired: true
    });
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw Object.assign(new Error('canonical session expired'), {
        code: 'AWS_LIVENESS_SESSION_EXPIRED'
      });
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(201);
    expect(mockRecoverExpiredSessionMetadata).toHaveBeenCalledWith({
      userId: 'driver-1',
      sessionId: expiredSessionId,
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
    expect(mockReleaseVerificationWindow).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a paid first-access session cannot be recovered', async () => {
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 1,
      lastSessionId: 'aws-session-first-access-lost',
      lastStatus: null
    });
    mockGetSessionMetadata.mockResolvedValueOnce(null);
    mockRecoverCommittedSession.mockResolvedValueOnce(null);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_IDENTITY_RETRY_RESUME_SESSION_NOT_FOUND');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('never exposes internal attempt reservations or recovery bindings in session errors', async () => {
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    const retryAt = new Date(Date.now() + 90_000).toISOString();
    const exhausted = Object.assign(new Error('attempts exhausted'), {
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      retryAt,
      retryAfterSeconds: 90,
      attemptState: {
        userId: 'driver-1',
        attemptScope: 'first_access',
        started: 5,
        failed: 5,
        passed: 0,
        maxAttempts: 5,
        effectiveMax: 5,
        attemptsExhausted: true,
        softBlocked: false,
        retryAt,
        retryAfterSeconds: 90,
        recoveryAllowanceTotal: 0,
        recoveryAllowanceRemaining: 0,
        estimatedCostUsd: 0.075,
        attemptReservations: [{
          token: 'secret-operation-token',
          sessionId: 'secret-session-id',
          recoveryMetadata: {
            verificationWindowToken: 'secret-window-token',
            financialContextId: 'secret-financial-context'
          }
        }]
      }
    });
    mockCreateSession.mockRejectedValueOnce(exhausted);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      retryable: true,
      retryAt,
      retryAfterSeconds: 90
    }));
    expect(response.body).not.toHaveProperty('supportTicketId');
    expect(response.body).not.toHaveProperty('attemptState');
    expect(mockKycPolicyService.markDriverForLivenessAttemptsExhausted).not.toHaveBeenCalled();
    expectLivenessSessionPublicProjection(response.body);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('secret-operation-token');
    expect(serialized).not.toContain('secret-session-id');
    expect(serialized).not.toContain('secret-window-token');
    expect(serialized).not.toContain('secret-financial-context');
    expect(serialized).not.toContain('attemptReservations');
    expect(serialized).not.toContain('recoveryMetadata');
  });

  it('turns the durable per-account daily cap into an automatic retry window', async () => {
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
    const retryAt = new Date(Date.now() + 300_000).toISOString();
    mockCreateSession.mockRejectedValueOnce(Object.assign(
      new Error('daily account cap exhausted'),
      {
        code: 'KYC_AWS_USER_DAILY_SESSION_LIMIT_EXHAUSTED',
        retryAt
      }
    ));

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({ userId: 'driver-1', requirement: 'LIVENESS_REQUIRED' });

    expect(response.status).toBe(429);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      retryable: true,
      retryAt,
      retryAfterSeconds: expect.any(Number)
    }));
    expect(response.body).not.toHaveProperty('supportTicketId');
    expect(mockKycPolicyService.markDriverForLivenessAttemptsExhausted).not.toHaveBeenCalled();
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

  it('resumes the same persisted session after a crash between create and consume', async () => {
    const retryScope = `manual_review_retry_kyc_ir_${'1'.repeat(32)}`;
    const sessionId = 'aws-session-persisted-before-consume';
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: true,
      cleanRetryAuthorized: false,
      retrySessionResumeCandidate: true,
      retryAuthorizationId: `kyc_ir_${'1'.repeat(32)}`
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_resume_claimed',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'validating',
      attemptScope: retryScope
    });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      started: 1,
      maxAttempts: 1,
      estimatedUnitCostUsd: 0.015,
      lastSessionId: sessionId,
      lastStatus: null
    });
    mockGetSessionMetadata.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: 'idrev_resume_claimed',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      challengeType: 'FaceMovementAndLightChallenge',
      createdAt: '2026-07-21T12:00:00.000Z',
      expiresAt: '2099-07-21T12:03:00.000Z',
      verificationWindowToken: 'persisted-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
    mockResumeCleanRetryAuthorization.mockResolvedValueOnce({
      status: 'CONSUMED',
      idempotentReplay: false
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_resume_claimed',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      region: 'us-east-1',
      sessionId,
      challengeType: 'FaceMovementAndLightChallenge',
      expiresAt: '2099-07-21T12:03:00.000Z',
      status: 'CREATED'
    });
    expectLivenessSessionPublicProjection(response.body);
    expect(mockGetAttemptState).toHaveBeenCalledWith({
      userId: 'driver-1',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
    expect(mockAssertBoundSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'driver-1',
        challengeId: 'idrev_resume_claimed',
        attemptScope: retryScope
      }),
      {
        userId: 'driver-1',
        expectedChallengeId: 'idrev_resume_claimed',
        expectedRequirement: 'IDENTITY_REVERIFICATION',
        expectedPersistenceNamespace: 'operational',
        expectedFinancialContextId: 'ctx_operational_test'
      }
    );
    expect(mockClaimVerificationWindow).toHaveBeenCalledWith('driver-1', {
      token: 'persisted-window-token',
      scope: 'aws_liveness_session_resume'
    });
    expect(mockResumeCleanRetryAuthorization).toHaveBeenCalledWith(
      'driver-1',
      retryScope,
      sessionId
    );
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockClaimCleanRetryAuthorization).not.toHaveBeenCalled();
    expect(mockKycPolicyService.recordIdentityReverificationStarted).not.toHaveBeenCalled();
  });

  it('rebuilds missing metadata for the committed paid session without creating another session', async () => {
    const retryScope = `manual_review_retry_kyc_ir_${'9'.repeat(32)}`;
    const sessionId = 'aws-session-committed-without-metadata';
    const recoveredMetadata = {
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: 'idrev_recover_metadata',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      challengeType: 'FaceMovementChallenge',
      createdAt: '2026-07-21T12:00:00.000Z',
      expiresAt: '2099-07-21T12:03:00.000Z',
      verificationWindowToken: 'recovered-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    };
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: true,
      cleanRetryAuthorized: false,
      retrySessionResumeCandidate: true,
      retryAuthorizationId: `kyc_ir_${'9'.repeat(32)}`
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_recover_metadata',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'validating',
      attemptScope: retryScope
    });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      started: 1,
      maxAttempts: 2,
      estimatedUnitCostUsd: 0.015,
      lastSessionId: sessionId,
      lastStatus: null
    });
    mockGetSessionMetadata.mockResolvedValueOnce(null);
    mockClaimVerificationWindow.mockResolvedValueOnce({
      acquired: true,
      token: 'recovered-window-token',
      key: 'recovered-window-key'
    });
    mockRecoverCommittedSession.mockResolvedValueOnce({
      sessionId,
      sessionMetadata: recoveredMetadata
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_recover_metadata',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      region: 'us-east-1',
      sessionId,
      challengeType: 'FaceMovementChallenge',
      expiresAt: '2099-07-21T12:03:00.000Z',
      status: 'CREATED'
    });
    expectLivenessSessionPublicProjection(response.body);
    expect(mockRecoverCommittedSession).toHaveBeenCalledWith({
      userId: 'driver-1',
      challengeId: 'idrev_recover_metadata',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      verificationWindowToken: 'recovered-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
    expect(mockClaimVerificationWindow).toHaveBeenCalledTimes(1);
    expect(mockResumeCleanRetryAuthorization).toHaveBeenCalledWith(
      'driver-1',
      retryScope,
      sessionId
    );
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns the same session after consume when the original 201 response was lost', async () => {
    const retryScope = `orphan_hold_retry_kyc_or_${'2'.repeat(32)}`;
    const sessionId = 'aws-session-consumed-before-response';
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: true,
      cleanRetryAuthorized: false,
      retrySessionResumeCandidate: true,
      retryAuthorizationId: `kyc_or_${'2'.repeat(32)}`
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_resume_consumed',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'validating',
      attemptScope: retryScope
    });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      started: 1,
      maxAttempts: 1,
      estimatedUnitCostUsd: 0.015,
      lastSessionId: sessionId,
      lastStatus: null
    });
    mockGetSessionMetadata.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: 'idrev_resume_consumed',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      challengeType: 'FaceMovementAndLightChallenge',
      createdAt: '2026-07-21T12:00:00.000Z',
      expiresAt: '2099-07-21T12:03:00.000Z',
      verificationWindowToken: 'consumed-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
    mockResumeCleanRetryAuthorization.mockResolvedValueOnce({
      status: 'CONSUMED',
      idempotentReplay: true
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_resume_consumed',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(sessionId);
    expectLivenessSessionPublicProjection(response.body);
    expect(mockResumeCleanRetryAuthorization).toHaveBeenCalledWith(
      'driver-1',
      retryScope,
      sessionId
    );
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockConsumeCleanRetryAuthorization).not.toHaveBeenCalled();
  });

  it.each([
    [
      'terminal',
      { completedAt: '2026-07-21T12:01:00.000Z', lastStatus: 'SUCCEEDED' },
      null,
      'KYC_IDENTITY_RETRY_RESUME_SESSION_TERMINAL'
    ],
    [
      'abandoned',
      { status: 'ABANDONED', abandonedAt: '2026-07-21T12:01:00.000Z' },
      null,
      'KYC_IDENTITY_RETRY_RESUME_SESSION_TERMINAL'
    ],
    [
      'expired',
      {},
      'AWS_LIVENESS_SESSION_EXPIRED',
      'AWS_LIVENESS_SESSION_EXPIRED'
    ],
    [
      'wrong persistence namespace',
      {},
      'AWS_LIVENESS_SESSION_PERSISTENCE_SCOPE_MISMATCH',
      'AWS_LIVENESS_SESSION_PERSISTENCE_SCOPE_MISMATCH'
    ],
    [
      'wrong financial context',
      {},
      'AWS_LIVENESS_SESSION_FINANCIAL_CONTEXT_MISMATCH',
      'AWS_LIVENESS_SESSION_FINANCIAL_CONTEXT_MISMATCH'
    ],
    [
      'other driver',
      { userId: 'driver-other' },
      null,
      'KYC_IDENTITY_RETRY_RESUME_BINDING_INVALID'
    ],
    [
      'other challenge',
      { challengeId: 'idrev_other_challenge' },
      null,
      'KYC_IDENTITY_RETRY_RESUME_CHALLENGE_INVALID'
    ],
    [
      'other retry scope',
      { attemptScope: `manual_review_retry_kyc_ir_${'4'.repeat(32)}` },
      null,
      'KYC_IDENTITY_RETRY_RESUME_BINDING_INVALID'
    ]
  ])('does not resume or dispatch a %s persisted retry session', async (
    _label,
    metadataOverrides,
    boundMetadataErrorCode,
    expectedCode
  ) => {
    const retryScope = `manual_review_retry_kyc_ir_${'3'.repeat(32)}`;
    const sessionId = 'aws-session-not-resumable';
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: true,
      retrySessionResumeCandidate: true,
      retryAuthorizationId: `kyc_ir_${'3'.repeat(32)}`
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_resume_adversarial',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'validating',
      attemptScope: retryScope
    });
    mockGetAttemptState.mockResolvedValueOnce({
      userId: 'driver-1',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      started: 1,
      maxAttempts: 1,
      lastSessionId: sessionId,
      lastStatus: null
    });
    mockGetSessionMetadata.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId: 'idrev_resume_adversarial',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope,
      createdAt: '2026-07-21T12:00:00.000Z',
      expiresAt: '2099-07-21T12:03:00.000Z',
      verificationWindowToken: 'adversarial-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test',
      ...metadataOverrides
    });
    if (boundMetadataErrorCode) {
      mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
        throw Object.assign(new Error('bound metadata rejected'), {
          code: boundMetadataErrorCode
        });
      });
    }

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_resume_adversarial',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(expectedCode);
    expect(mockResumeCleanRetryAuthorization).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockClaimVerificationWindow).not.toHaveBeenCalled();
  });

  it('does not bypass an available one-shot retry when the challenge loses its attempt scope', async () => {
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: false,
      cleanRetryAuthorized: true,
      retryAuthorizationId: `kyc_ir_${'f'.repeat(32)}`
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_retry_without_scope',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested'
    });

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_retry_without_scope',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('KYC_IDENTITY_RETRY_BINDING_REQUIRED');
    expect(mockClaimVerificationWindow).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rebinds a stale activation request to the canonical authorized retry before AWS dispatch', async () => {
    const recoveryId = `kyc_or_${'c'.repeat(32)}`;
    const retryScope = `orphan_hold_retry_${recoveryId}`;
    const claim = {
      driverId: 'driver-1',
      recoveryId,
      authorizationId: recoveryId,
      attemptScope: retryScope,
      claimToken: 'opaque-canonical-rebind-token'
    };
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: false,
      cleanRetryAuthorized: true,
      retrySessionResumeCandidate: false,
      retryAuthorizationId: recoveryId,
      retryAuthorizationKind: 'orphan_hold'
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_orphan_canonical',
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
        challengeId: 'idrev_stale_client',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockKycPolicyService.recordIdentityReverificationStarted).toHaveBeenCalledWith(
      'driver-1',
      {
        challengeId: 'idrev_orphan_canonical',
        requirement: 'IDENTITY_REVERIFICATION'
      }
    );
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'idrev_orphan_canonical',
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope: retryScope
    }));
    expect(mockConsumeCleanRetryAuthorization).toHaveBeenCalledWith(claim, 'session-1');
  });

  it('does not dispatch AWS when a retry scope has no durable authorization claim', async () => {
    const retryScope = `manual_review_retry_kyc_ir_${'e'.repeat(32)}`;
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_retry_claim_missing',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryScope
    });
    mockClaimCleanRetryAuthorization.mockResolvedValueOnce(null);

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_retry_claim_missing',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('KYC_IDENTITY_RETRY_AUTHORIZATION_REQUIRED');
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockReleaseVerificationWindow).toHaveBeenCalled();
  });

  it('claims and consumes exactly one orphan-hold recovery session', async () => {
    const retryScope = `orphan_hold_retry_kyc_or_${'d'.repeat(32)}`;
    const claim = {
      driverId: 'driver-1',
      recoveryId: `kyc_or_${'d'.repeat(32)}`,
      authorizationId: `kyc_or_${'d'.repeat(32)}`,
      attemptScope: retryScope,
      claimToken: 'opaque-orphan-claim-token'
    };
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_orphan_retry',
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
        challengeId: 'idrev_orphan_retry',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(201);
    expect(mockClaimCleanRetryAuthorization).toHaveBeenCalledWith('driver-1', retryScope);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      attemptScope: retryScope
    }));
    expect(mockConsumeCleanRetryAuthorization).toHaveBeenCalledWith(claim, 'session-1');
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

    expect(response.status).toBe(500);
    expect(mockReleaseCleanRetryAuthorization).not.toHaveBeenCalled();
    expect(mockConsumeCleanRetryAuthorization).not.toHaveBeenCalled();
  });

  it('does not create a paid identity session when a newer challenge wins after precheck', async () => {
    const recoveryId = `kyc_or_${'f'.repeat(32)}`;
    const retryScope = `orphan_hold_retry_${recoveryId}`;
    const claim = {
      driverId: 'driver-1',
      recoveryId,
      authorizationId: recoveryId,
      attemptScope: retryScope,
      claimToken: 'opaque-stale-challenge-token'
    };
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: false,
      cleanRetryAuthorized: true,
      retrySessionResumeCandidate: false,
      retryAuthorizationId: recoveryId,
      retryAuthorizationKind: 'orphan_hold'
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_old',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryScope
    });
    mockClaimCleanRetryAuthorization.mockResolvedValueOnce(claim);
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

    expect(response.body.code).toBe('KYC_IDENTITY_REVERIFY_CHALLENGE_STALE');
    expect(response.status).toBe(409);
    expect(mockClaimCleanRetryAuthorization).toHaveBeenCalledWith(
      'driver-1',
      retryScope
    );
    expect(mockReleaseCleanRetryAuthorization).toHaveBeenCalledWith(claim, {
      reason: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
    });
    expect(mockConsumeCleanRetryAuthorization).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockReleaseVerificationWindow).toHaveBeenCalled();
  });

  it('releases the claimed retry when identity start persistence is unavailable before AWS', async () => {
    const recoveryId = `kyc_or_${'a'.repeat(32)}`;
    const retryScope = `orphan_hold_retry_${recoveryId}`;
    const claim = {
      driverId: 'driver-1',
      recoveryId,
      authorizationId: recoveryId,
      attemptScope: retryScope,
      claimToken: 'opaque-start-failure-token'
    };
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: false,
      cleanRetryAuthorized: true,
      retrySessionResumeCandidate: false,
      retryAuthorizationId: recoveryId,
      retryAuthorizationKind: 'orphan_hold'
    });
    mockGetFromRealtimeDB.mockResolvedValueOnce({
      challengeId: 'idrev_retry_start_unavailable',
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryScope
    });
    mockClaimCleanRetryAuthorization.mockResolvedValueOnce(claim);
    mockKycPolicyService.recordIdentityReverificationStarted.mockRejectedValueOnce(
      Object.assign(new Error('RTDB transaction unavailable'), {
        code: 'KYC_REVERIFY_STATE_UNAVAILABLE'
      })
    );

    const response = await request(createApp())
      .post('/api/kyc/liveness/aws/session')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        userId: 'driver-1',
        challengeId: 'idrev_stale_client_value',
        requirement: 'IDENTITY_REVERIFICATION'
      });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('KYC_REVERIFY_STATE_UNAVAILABLE');
    expect(mockClaimCleanRetryAuthorization).toHaveBeenCalledWith(
      'driver-1',
      retryScope
    );
    expect(mockReleaseCleanRetryAuthorization).toHaveBeenCalledWith(claim, {
      reason: 'KYC_REVERIFY_STATE_UNAVAILABLE'
    });
    expect(mockConsumeCleanRetryAuthorization).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockReleaseVerificationWindow).toHaveBeenCalled();
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
    expect(mockFinalizeCleanRetryAuthorization).toHaveBeenCalledWith({
      driverId: 'driver-1',
      attemptScope: 'first_access',
      sessionId: 'session-1',
      outcome: 'ABORTED',
      reason: 'user_abandoned_liveness_session'
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
      verificationWindowToken: 'verification-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
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
      {
        userId: 'driver-1',
        expectedPersistenceNamespace: 'operational',
        expectedFinancialContextId: 'ctx_operational_test'
      }
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
    const error = new Error('internal session owner uid=driver-other arn=secret-role');
    error.code = 'AWS_LIVENESS_SESSION_USER_MISMATCH';
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw error;
    });

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/credentials?userId=driver-1&sessionId=session-other')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: 'Não foi possível usar esta sessão de validação.',
      code: 'AWS_LIVENESS_SESSION_USER_MISMATCH',
      retryable: false
    });
    expect(JSON.stringify(response.body)).not.toMatch(/driver-other|secret-role|internal session owner/i);
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
      provider: 'internal-provider-id-should-not-leak',
      sessionId: 'session-1',
      completed: false,
      status: 'IN_PROGRESS',
      confidence: 72,
      confidenceThreshold: 80,
      attemptState: { maxAttempts: 2, recoveryAllowanceRemaining: 1 },
      referenceImageAvailable: false,
      sessionMetadata: { costGuardOperationId: 'secret-operation' },
      providerRequestId: 'secret-provider-request-id'
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
    expect(response.body).toEqual({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      region: 'us-east-1',
      sessionId: 'session-1',
      challengeType: 'FaceMovementChallenge',
      expiresAt: '2026-07-13T12:20:00.000Z',
      status: 'IN_PROGRESS',
      completed: false
    });
    expectLivenessSessionPublicProjection(response.body);
  });

  it('returns a temporary rate limit without mutating identity when polling exhausts attempts', async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString();
    mockGetSessionResult.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-rate-limited',
      completed: true,
      status: 'FAILED',
      livenessPassed: false,
      attemptState: {
        attemptsExhausted: true,
        softBlocked: false,
        retryAt,
        retryAfterSeconds: 120
      }
    });

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/session/session-rate-limited?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.body).toEqual({
      success: false,
      error: 'Aguarde um pouco antes de iniciar uma nova validação.',
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      retryable: true,
      retryAt,
      retryAfterSeconds: 120
    });
    expect(mockKycPolicyService.markDriverForLivenessAttemptsExhausted).not.toHaveBeenCalled();
    expect(mockReleaseVerificationWindow).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SUCCEEDED', true],
    ['FAILED', false]
  ])('returns only a safe terminal boolean for a completed %s liveness session', async (
    terminalStatus,
    livenessPassed
  ) => {
    mockGetSessionResult.mockResolvedValueOnce({
      success: true,
      provider: 'internal-provider-id-should-not-leak',
      region: 'internal-region',
      sessionId: 'session-1',
      status: terminalStatus,
      completed: true,
      livenessPassed,
      confidence: 99.7,
      confidenceNormalized: 0.997,
      confidenceThreshold: 80,
      processingTime: 421,
      challenge: { version: '2.0', preference: 'internal-provider-preference' },
      referenceImageSha256: 'a'.repeat(64),
      referenceImageBoundingBox: { width: 0.4 },
      attemptState: {
        maxAttempts: 2,
        estimatedCostUsd: 0.015,
        recoveryAllowanceRemaining: 1
      },
      sessionMetadata: {
        costGuardOperationId: 'secret-operation-id',
        verificationWindowToken: 'secret-window-token'
      },
      providerRequestId: 'secret-provider-request-id',
      model: 'internal-provider-model'
    });

    const response = await request(createApp())
      .get('/api/kyc/liveness/aws/session/session-1?userId=driver-1')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      region: 'us-east-1',
      sessionId: 'session-1',
      challengeType: 'FaceMovementChallenge',
      expiresAt: '2026-07-13T12:20:00.000Z',
      status: terminalStatus,
      completed: true,
      livenessPassed
    });
    expectLivenessSessionPublicProjection(response.body);
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

  it('never executes the legacy device verification persistence path for a sandbox user', async () => {
    mockRuntimeNamespace = 'sandbox';

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
  });

  it('never executes the multipart legacy verification persistence path for a sandbox user', async () => {
    mockRuntimeNamespace = 'sandbox';

    const response = await request(createApp())
      .post('/api/kyc/verify-driver')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .attach('currentImage', Buffer.from('legacy-selfie'), {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg'
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_SANDBOX_LEGACY_ROUTE_DISABLED');
    expect(mockKycServiceInstance.verifyDriver).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'reads a legacy face encoding',
      method: 'get',
      path: '/api/kyc/encoding/driver-1',
      assertNotCalled: () => expect(mockKycServiceInstance.getFaceEncoding).not.toHaveBeenCalled()
    },
    {
      label: 'deletes a legacy face encoding',
      method: 'delete',
      path: '/api/kyc/encoding/driver-1',
      assertNotCalled: () => expect(mockKycServiceInstance.deleteFaceEncoding).not.toHaveBeenCalled()
    },
    {
      label: 'invalidates the operational verification cache',
      method: 'post',
      path: '/api/kyc/invalidate-cache/driver-1',
      assertNotCalled: () => expect(mockKycServiceInstance.invalidateVerificationCache).not.toHaveBeenCalled()
    },
    {
      label: 'reads the operational device anchor',
      method: 'get',
      path: '/api/kyc/device-anchor/driver-1',
      assertNotCalled: () => expect(mockGetFromRealtimeDB).not.toHaveBeenCalled()
    },
    {
      label: 'reads operational KYC statistics',
      method: 'get',
      path: '/api/kyc/stats',
      assertNotCalled: () => expect(mockKycServiceInstance.getStats).not.toHaveBeenCalled()
    },
    {
      label: 'reads operational KYC health statistics',
      method: 'get',
      path: '/api/kyc/health',
      assertNotCalled: () => expect(mockKycServiceInstance.healthCheck).not.toHaveBeenCalled()
    }
  ])('does not touch operational state when a sandbox user $label', async ({ method, path, assertNotCalled }) => {
    mockRuntimeNamespace = 'sandbox';

    const response = await request(createApp())
      [method](path)
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_SANDBOX_LEGACY_ROUTE_DISABLED');
    assertNotCalled();
  });

  it('does not persist a legacy profile encoding for a sandbox user', async () => {
    mockRuntimeNamespace = 'sandbox';

    const response = await request(createApp())
      .post('/api/kyc/upload-profile')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .attach('image', Buffer.from('legacy-profile'), {
        filename: 'profile.jpg',
        contentType: 'image/jpeg'
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_SANDBOX_LEGACY_ROUTE_DISABLED');
    expect(mockKycServiceInstance.preprocessProfileImage).not.toHaveBeenCalled();
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

  it('rejects canonical face compare when the paid session belongs to another persistence scope', async () => {
    const error = new Error('scope mismatch');
    error.code = 'AWS_LIVENESS_SESSION_PERSISTENCE_SCOPE_MISMATCH';
    mockAssertBoundSessionMetadata.mockImplementationOnce(() => {
      throw error;
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-other-scope')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Erro interno do servidor');
    expect(mockClaimCanonicalSession).not.toHaveBeenCalled();
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
    expect(mockRecordCanonicalFailure).not.toHaveBeenCalled();
  });

  it('does not let an unconsumed or unrelated session cross an available retry hold', async () => {
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: false,
      cleanRetryAuthorized: true,
      sessionBoundRetryAuthorized: false,
      retryAuthorizationId: `kyc_or_${'a'.repeat(32)}`,
      retryAuthorizationKind: 'orphan_hold'
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-not-consumed-by-retry')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('KYC_IDENTITY_RETRY_SESSION_BINDING_REQUIRED');
    expect(mockClaimCanonicalSession).not.toHaveBeenCalled();
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
    expect(mockRecordCanonicalFailure).not.toHaveBeenCalled();
  });

  it('fails closed before any operational biometric read when sandbox has no AWS face provider', async () => {
    mockRuntimeNamespace = 'sandbox';
    const providerSelection = jest.spyOn(kycRoutes, 'usesAwsCanonicalFaceCompare')
      .mockReturnValue(false);

    try {
      const response = await request(createApp())
        .post('/api/kyc/verify-driver/server-side-selfie')
        .set('Authorization', 'Bearer firebase-token')
        .field('userId', 'driver-1')
        .field('awsSessionId', 'session-sandbox-1')
        .field('requirement', 'LIVENESS_REQUIRED')
        .attach('currentImage', Buffer.from('sandbox-selfie'), {
          filename: 'selfie.jpg',
          contentType: 'image/jpeg'
        });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        success: false,
        error: 'A validacao de identidade esta temporariamente indisponivel. Tente novamente em alguns minutos.',
        code: 'KYC_CANONICAL_FACE_PROVIDER_UNAVAILABLE'
      });
      expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
      expect(mockGetFromRealtimeDB).not.toHaveBeenCalled();
      expect(mockGetSessionMetadata).not.toHaveBeenCalled();
      expect(mockGetSessionResult).not.toHaveBeenCalled();
      expect(mockClaimCanonicalSession).not.toHaveBeenCalled();
    } finally {
      providerSelection.mockRestore();
    }
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
    expect(response.body).toEqual({
      success: true,
      isMatch: true,
      needsReview: false,
      requirement: 'LIVENESS_REQUIRED',
      challengeId: null
    });
    expectCanonicalComparePublicProjection(response.body);
    expect(mockGetSessionResult).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'driver-1',
      requireBoundMetadata: true,
      expectedChallengeId: null,
      expectedRequirement: 'LIVENESS_REQUIRED',
      includeReferenceImage: true
    });
    expect(mockAssertKycOperationAllowed).toHaveBeenCalledWith('driver-1', {
      attemptScope: 'first_access',
      awsSessionId: 'session-1'
    });
    expect(mockFinalizeCleanRetryAuthorization).toHaveBeenCalledWith({
      driverId: 'driver-1',
      attemptScope: 'first_access',
      sessionId: 'session-1',
      outcome: 'SUCCEEDED',
      resultEvidenceId: 'evidence-1',
      reason: 'canonical_identity_match'
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
    expect(mockCaptureRejectedComparisonEvidence).not.toHaveBeenCalled();
    expect(mockLinkReviewEvidenceToCanonicalFailure).not.toHaveBeenCalled();
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
        expect(response.body).toEqual({
          success: false,
          code: expectedCode,
          retryable: true,
          error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.'
        });
        expectReferenceImageRecoveryPublicProjection(response.body);
        expect(mockGrantReferenceImageRecoveryAttempt).toHaveBeenCalledWith({
          userId: 'driver-1',
          sessionId: 'session-1',
          requirement: 'LIVENESS_REQUIRED',
          attemptScope: 'first_access',
          persistenceNamespace: 'operational',
          financialContextId: 'ctx_operational_test'
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
      expect(response.body).toEqual({
        success: false,
        code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
        retryable: false,
        error: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.'
      });
      expectReferenceImageRecoveryPublicProjection(response.body);
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
      expect(response.body).toEqual({
        success: true,
        isMatch: true,
        needsReview: false,
        requirement: 'LIVENESS_REQUIRED',
        challengeId: null
      });
      expectCanonicalComparePublicProjection(response.body);
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

  it.each([
    {
      title: 'grants a technical retry when CompareFaces cannot detect the bound liveness image',
      canRetry: true,
      expectedStatus: 422,
      expectedCode: 'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED',
      expectedError: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.'
    },
    {
      title: 'keeps CompareFaces recovery fail-closed when technical retry credits are exhausted',
      canRetry: false,
      expectedStatus: 503,
      expectedCode: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
      expectedError: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.'
    }
  ])('$title', async ({ canRetry, expectedStatus, expectedCode, expectedError }) => {
    mockGrantReferenceImageRecoveryAttempt.mockResolvedValueOnce({
      status: canRetry ? 'applied' : 'recovery_limit_reached',
      granted: canRetry,
      canRetry,
      attemptState: {
        attemptScope: 'first_access',
        effectiveMax: 3,
        recoveryAllowanceRemaining: canRetry ? 1 : 0,
        attemptsExhausted: !canRetry,
        softBlocked: false
      }
    });
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

      expect(response.status).toBe(expectedStatus);
      expect(response.body).toEqual({
        success: false,
        error: expectedError,
        code: expectedCode,
        retryable: canRetry
      });
      expectReferenceImageRecoveryPublicProjection(response.body);
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
    expectCanonicalComparePublicProjection(response.body);
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).toHaveBeenCalledWith(
      'driver-1',
      Buffer.from('aws-reference-image'),
      expect.any(Object)
    );
  });

  it('projects a canonical evidence conflict without internal persistence details', async () => {
    mockRecordCanonicalSuccess.mockRejectedValueOnce(Object.assign(
      new Error('firestore hash mismatch for users/driver-1 and internal evidence path'),
      { code: 'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT' }
    ));

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-canonical-conflict')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      retryable: false,
      code: 'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT',
      error: 'Não foi possível confirmar esta validação com segurança.'
    });
    expect(response.body).not.toHaveProperty('userId');
    expect(JSON.stringify(response.body)).not.toMatch(/firestore|driver-1|internal evidence path/i);
  });

  it('projects unavailable canonical state without its internal store message', async () => {
    mockAssertKycOperationAllowed.mockRejectedValueOnce(Object.assign(
      new Error('firestore driver_identity_trust collection unavailable in project-internal'),
      { code: 'KYC_TRUST_STORE_UNAVAILABLE' }
    ));

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-state-unavailable')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      retryable: true,
      code: 'KYC_TRUST_STORE_UNAVAILABLE',
      error: 'A validação está temporariamente indisponível. Tente novamente em alguns minutos.'
    });
    expect(response.body).not.toHaveProperty('userId');
    expect(JSON.stringify(response.body)).not.toMatch(/firestore|driver_identity_trust|project-internal/i);
  });

  it('does not expose biometric scores when the canonical compare service fails', async () => {
    mockKycServiceInstance.verifyDriverServerSideSelfie.mockResolvedValueOnce({
      success: false,
      code: 'BIOMETRIC_FACE_SERVICE_NOT_CONFIGURED',
      error: 'provider URL and API key are missing',
      similarityScore: 0.41,
      confidence: 0.41,
      threshold: 0.95,
      reviewThreshold: 0.8,
      provider: 'internal-provider',
      model: 'internal-model-v1',
      embeddingDimension: 512,
      processingTime: 180
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-compare-unavailable')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      code: 'BIOMETRIC_FACE_SERVICE_NOT_CONFIGURED',
      error: 'Não foi possível concluir a validação agora.',
      requirement: 'LIVENESS_REQUIRED',
      challengeId: null
    });
    expectCanonicalComparePublicProjection(response.body);
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

  it('reconciles a retry session from canonical metadata when the mobile context is stale', async () => {
    const challengeId = 'idrev_rejected_reconciliation';
    const attemptScope = 'orphan_hold_retry_kyc_or_recovery_1';
    const sessionHash = 'a'.repeat(64);
    const reviewEvidenceId = 'private-review-evidence-reconciled';
    const canonicalRecordedAt = '2026-07-26T01:46:05.509Z';
    const existingEvidence = {
      schemaVersion: 1,
      evidenceId: sessionHash,
      driverId: 'driver-1',
      sourcePath: 'server_side_aws_reference_compare',
      terminalOutcome: 'face_compare_failed',
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      recordedAt: canonicalRecordedAt,
      reviewEvidenceId
    };
    mockGetSessionMetadata.mockResolvedValueOnce({
      userId: 'driver-1',
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope,
      verificationWindowToken: 'verification-window-token'
    });
    mockAssertKycOperationAllowed.mockResolvedValueOnce({
      allowed: true,
      identityReviewHold: false,
      retryAuthorizationId: 'kyc_or_recovery_1',
      sessionBoundRetryAuthorized: true
    });
    mockClaimCanonicalSession.mockResolvedValueOnce({
      acquired: true,
      consumed: true,
      sessionHash,
      key: 'claim-key',
      token: 'claim-token',
      existingEvidence,
      verificationWindowClaim: {
        acquired: true,
        key: 'verification-window-key',
        token: 'verification-window-token'
      }
    });
    mockRestoreRejectedIdentityVerification.mockReturnValueOnce({
      success: false,
      userId: 'driver-1',
      isMatch: false,
      needsReview: false,
      similarityScore: 0.2,
      confidence: 0.2,
      decision: 'reject',
      requirement: 'IDENTITY_REVERIFICATION',
      challengeId,
      evidenceId: sessionHash,
      reviewEvidenceId
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-rejected-reconciliation')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'KYC_CHALLENGE_NOT_PASSED',
      isMatch: false,
      reviewAvailable: true,
      idempotentReconciliation: true
    }));
    expect(mockAssertKycOperationAllowed).toHaveBeenCalledWith('driver-1', {
      attemptScope,
      awsSessionId: 'session-rejected-reconciliation'
    });
    expectCanonicalComparePublicProjection(response.body);
    expect(response.body.evidenceId).toBe(reviewEvidenceId);
    expect(response.body.evidenceId).not.toBe(sessionHash);
    expect(mockRestoreRejectedIdentityVerification).toHaveBeenCalledWith(
      'driver-1',
      sessionHash,
      existingEvidence,
      { challengeId, requirement: 'IDENTITY_REVERIFICATION' }
    );
    expect(mockFinalizeCleanRetryAuthorization).toHaveBeenCalledWith({
      driverId: 'driver-1',
      attemptScope,
      sessionId: 'session-rejected-reconciliation',
      outcome: 'REJECTED',
      resultEvidenceId: sessionHash,
      reason: 'canonical_face_compare_rejection_reconciliation'
    });
    expect(
      mockKycPolicyService.reconcileRejectedIdentityReverificationMirror
    ).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({
        isMatch: false,
        challengeId,
        attemptScope,
        canonicalRecordedAt
      })
    );
    expect(mockKycPolicyService.recordIdentityReverificationResult).not.toHaveBeenCalled();
    expect(mockFinalizeCleanRetryAuthorization.mock.invocationCallOrder[0]).toBeLessThan(
      mockKycPolicyService
        .reconcileRejectedIdentityReverificationMirror
        .mock.invocationCallOrder[0]
    );
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockRecordCanonicalFailure).not.toHaveBeenCalled();
    expect(mockCaptureRejectedComparisonEvidence).not.toHaveBeenCalled();
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
    expectCanonicalComparePublicProjection(response.body);
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

  it('reconciles approved durable first-access evidence without calling AWS again', async () => {
    const sessionHash = 'canonical-first-access-session-hash';
    mockKycPolicyService.requiresFirstAccessLiveness.mockResolvedValueOnce({ required: true });
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
        challengeId: null,
        challengeSource: 'first_access',
        requirement: 'LIVENESS_REQUIRED',
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
      .field('awsSessionId', 'session-first-access-reconcile')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      isMatch: true,
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      idempotentReconciliation: true
    }));
    expectCanonicalComparePublicProjection(response.body);
    expect(mockRestoreApprovedIdentityVerification).toHaveBeenCalledWith(
      'driver-1',
      sessionHash,
      expect.objectContaining({
        status: 'approved',
        challengeSource: 'first_access'
      }),
      { challengeId: null, requirement: 'LIVENESS_REQUIRED' }
    );
    expect(mockKycPolicyService.recordIdentityReverificationResult).not.toHaveBeenCalled();
    expect(mockKycPolicyService.recordVerificationSuccess).toHaveBeenCalledWith(
      'driver-1',
      {
        source: 'canonical_first_access_reconciliation',
        markFirstAccess: true,
        clearReverify: false
      }
    );
    expect(mockFinalizeCleanRetryAuthorization).toHaveBeenCalledWith({
      driverId: 'driver-1',
      attemptScope: null,
      sessionId: 'session-first-access-reconcile',
      outcome: 'SUCCEEDED',
      resultEvidenceId: sessionHash,
      reason: 'canonical_first_access_reconciliation'
    });
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
    expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
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
    expect(response.body).toEqual({
      success: false,
      retryable: true,
      code: 'KYC_VERIFICATION_LEASE_LOST',
      error: 'Não foi possível confirmar esta validação. Tente novamente em alguns instantes.'
    });
    expect(response.body).not.toHaveProperty('userId');
    expect(JSON.stringify(response.body)).not.toMatch(/trava|expirou.*fora de corrida/i);
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).not.toHaveBeenCalled();
    expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
  });

  it('retains rejected selfie evidence before retry finalization and replays without paid calls', async () => {
    const challengeId = 'idrev_finalize_failure';
    const canonicalFailureId = 'b'.repeat(64);
    const reviewEvidenceId = 'private-review-evidence-finalize-failure';
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
    mockRecordCanonicalFailure.mockResolvedValueOnce({
      success: true,
      evidenceId: canonicalFailureId,
      idempotentReplay: false
    });
    mockCaptureRejectedComparisonEvidence.mockResolvedValueOnce({
      evidenceId: reviewEvidenceId
    });
    mockFinalizeCleanRetryAuthorization.mockRejectedValueOnce(Object.assign(
      new Error('Retry authorization store unavailable'),
      { code: 'KYC_RETRY_FINALIZATION_STORE_UNAVAILABLE' }
    ));
    mockAssertKycOperationAllowed
      .mockResolvedValueOnce({
        allowed: true,
        identityReviewHold: false,
        cnhReplacementHold: false,
        cleanRetryAuthorized: false
      })
      .mockResolvedValueOnce({
        allowed: true,
        identityReviewHold: true,
        holdCaseId: null,
        holdEvidenceId: reviewEvidenceId,
        reviewAvailable: true
      });

    const firstResponse = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-finalize-failure')
      .field('challengeId', challengeId)
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(firstResponse.status).toBe(500);
    expect(firstResponse.body).toEqual({
      success: false,
      error: 'Erro interno do servidor',
      code: 'KYC_RETRY_FINALIZATION_STORE_UNAVAILABLE'
    });
    expect(firstResponse.body).not.toHaveProperty('evidenceId');
    expect(mockCaptureRejectedComparisonEvidence).toHaveBeenCalledTimes(1);
    expect(mockLinkReviewEvidenceToCanonicalFailure).toHaveBeenCalledWith(
      'driver-1',
      {
        failureEvidenceId: canonicalFailureId,
        reviewEvidenceId
      }
    );
    expect(mockCaptureRejectedComparisonEvidence.mock.invocationCallOrder[0])
      .toBeLessThan(mockFinalizeCleanRetryAuthorization.mock.invocationCallOrder[0]);
    expect(mockLinkReviewEvidenceToCanonicalFailure.mock.invocationCallOrder[0])
      .toBeLessThan(mockFinalizeCleanRetryAuthorization.mock.invocationCallOrder[0]);
    expect(mockDeleteFailedBiometricEvidence).not.toHaveBeenCalled();

    const retryResponse = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-finalize-failure')
      .field('challengeId', challengeId)
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(retryResponse.status).toBe(423);
    expect(retryResponse.body).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      reviewAvailable: true,
      evidenceId: reviewEvidenceId
    }));
    expect(retryResponse.body.evidenceId).not.toBe(canonicalFailureId);
    expectCanonicalComparePublicProjection(retryResponse.body);
    expect(mockGetSessionResult).toHaveBeenCalledTimes(1);
    expect(mockKycServiceInstance.verifyDriverServerSideSelfie).toHaveBeenCalledTimes(1);
    expect(mockRecordCanonicalFailure).toHaveBeenCalledTimes(1);
    expect(mockCaptureRejectedComparisonEvidence).toHaveBeenCalledTimes(1);
    expect(mockLinkReviewEvidenceToCanonicalFailure).toHaveBeenCalledTimes(1);
    expect(mockClaimCanonicalSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).not.toHaveBeenCalled();
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
    expect(response.body).toEqual({
      success: false,
      error: 'Não foi possível concluir a validação agora',
      code: 'KYC_CHALLENGE_NOT_PASSED',
      isMatch: false,
      reviewAvailable: true,
      evidenceId: 'private-review-evidence-1'
    });
    expectCanonicalComparePublicProjection(response.body);
    expect(response.body).not.toHaveProperty('userId');
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
    expect(mockFinalizeCleanRetryAuthorization).toHaveBeenCalledWith({
      driverId: 'driver-1',
      attemptScope: 'first_access',
      sessionId: 'session-reverify-failed',
      outcome: 'REJECTED',
      resultEvidenceId: null,
      reason: 'canonical_face_compare_rejected'
    });
    expect(mockFinalizeCleanRetryAuthorization.mock.invocationCallOrder[0])
      .toBeLessThan(mockGetFirestore.mock.invocationCallOrder[0]);
    expect(mockKycPolicyService.recordVerificationSuccess).not.toHaveBeenCalled();
  });

  it('keeps the terminal retry enforcement instead of overwriting its binding with a generic hold', async () => {
    const challengeId = 'idrev_terminal_retry_binding';
    const attemptScope = `orphan_hold_retry_kyc_or_${'a'.repeat(32)}`;
    mockGetSessionMetadata.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-1',
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      attemptScope,
      challengeType: 'FaceMovementChallenge',
      createdAt: '2026-07-13T12:00:00.000Z',
      expiresAt: '2026-07-13T12:20:00.000Z',
      verificationWindowToken: 'verification-window-token',
      persistenceNamespace: 'operational',
      financialContextId: 'ctx_operational_test'
    });
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
    mockRecordCanonicalFailure.mockResolvedValueOnce({
      success: true,
      evidenceId: 'c'.repeat(64),
      idempotentReplay: false
    });
    mockFinalizeCleanRetryAuthorization.mockResolvedValueOnce({
      authorization: { status: 'REJECTED', remainingAttempts: 0 },
      enforcement: {
        active: true,
        status: 'IDENTITY_MISMATCH_HOLD',
        recoveryId: attemptScope.replace('orphan_hold_retry_', '')
      }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-terminal-retry-binding')
      .field('challengeId', challengeId)
      .field('requirement', 'IDENTITY_REVERIFICATION');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('KYC_CHALLENGE_NOT_PASSED');
    expect(mockFinalizeCleanRetryAuthorization).toHaveBeenCalledWith({
      driverId: 'driver-1',
      attemptScope,
      sessionId: 'session-terminal-retry-binding',
      outcome: 'REJECTED',
      resultEvidenceId: 'c'.repeat(64),
      reason: 'canonical_face_compare_rejected'
    });
    expect(mockGetFirestore).not.toHaveBeenCalled();
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

  it('rate-limits an exhausted server-side liveness result without creating an identity hold', async () => {
    const retryAt = new Date(Date.now() + 75_000).toISOString();
    mockGetSessionResult.mockResolvedValueOnce({
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'session-exhausted',
      completed: true,
      status: 'FAILED',
      confidence: 20,
      confidenceThreshold: 80,
      livenessPassed: false,
      attemptScope: 'first_access',
      attemptState: {
        attemptsExhausted: true,
        softBlocked: false,
        retryAt,
        retryAfterSeconds: 75
      }
    });

    const response = await request(createApp())
      .post('/api/kyc/verify-driver/server-side-selfie')
      .set('Authorization', 'Bearer firebase-token')
      .field('userId', 'driver-1')
      .field('awsSessionId', 'session-exhausted')
      .field('requirement', 'LIVENESS_REQUIRED');

    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.body).toEqual({
      success: false,
      error: 'Aguarde um pouco antes de iniciar uma nova validação.',
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      retryable: true,
      retryAt,
      retryAfterSeconds: 75
    });
    expect(mockKycPolicyService.markDriverForLivenessAttemptsExhausted).not.toHaveBeenCalled();
    expect(mockRecordCanonicalSuccess).not.toHaveBeenCalled();
    expect(mockRecordCanonicalFailure).not.toHaveBeenCalled();
  });
});
