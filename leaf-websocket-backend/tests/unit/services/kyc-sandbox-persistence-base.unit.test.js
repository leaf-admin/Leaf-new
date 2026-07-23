jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getStorage: jest.fn(() => null),
  getFromRealtimeDB: jest.fn(async () => null)
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => null)
}));

jest.mock('../../../services/audit-service', () => ({
  logEvent: jest.fn(async () => ({ success: true }))
}));

jest.mock('../../../services/kyc-policy-service', () => ({}));

jest.mock('../../../services/driver-activation-state-service', () => ({}));

jest.mock('../../../services/kyc-biometric-production-policy', () => ({
  resolveBiometricPolicy: jest.fn(() => ({
    canonicalTrustedMatchProviders: ['aws_rekognition_compare_faces']
  }))
}));

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const {
  PERSISTENCE_COLLECTIONS,
  KYC_PERSISTENCE_RESOURCES,
  createExplicitSandboxAccessScope,
  buildScopedPersistenceEnvelope
} = require('../../../services/sandbox-persistence-context');
const {
  KycFailedBiometricEvidenceService,
  createScopedKycFailedBiometricEvidenceService
} = require('../../../services/kyc-failed-biometric-evidence-service');
const {
  createScopedKycIdentityReviewCaseService
} = require('../../../services/kyc-identity-review-case-service');
const {
  createScopedDriverIdentityTrustService
} = require('../../../services/driver-identity-trust-service');

function sandboxContext() {
  return sealFinancialContext({
    providerEnvironment: 'sandbox',
    paymentProfileId: 'qa-test-users-sandbox-durable',
    paymentProfileSource: 'firestore',
    testUserSandbox: true
  });
}

function operationalContext() {
  return sealFinancialContext({
    providerEnvironment: 'production',
    paymentProfileId: 'production-default',
    paymentProfileSource: 'env',
    testUserSandbox: false
  });
}

describe('KYC sandbox persistence base', () => {
  it('declares isolated KYC collections, Storage and Redis resources', () => {
    expect(PERSISTENCE_COLLECTIONS.operational).toMatchObject({
      kycFailedBiometricEvidence: 'kyc_failed_biometric_evidence',
      kycIdentityReviewCases: 'kyc_identity_review_cases',
      driverIdentityEnforcement: 'driver_identity_enforcement',
      kycIdentityRetryAuthorizations: 'kyc_identity_retry_authorizations',
      kycIdentityReviewAudit: 'kyc_identity_review_audit',
      driverIdentityTrust: 'driver_identity_trust',
      kycStepUpChallenges: 'kyc_stepup_challenges'
    });
    expect(PERSISTENCE_COLLECTIONS.sandbox).toMatchObject({
      kycFailedBiometricEvidence: 'sandbox_kyc_failed_biometric_evidence',
      kycIdentityReviewCases: 'sandbox_kyc_identity_review_cases',
      driverIdentityEnforcement: 'sandbox_driver_identity_enforcement',
      kycIdentityRetryAuthorizations: 'sandbox_kyc_identity_retry_authorizations',
      kycIdentityReviewAudit: 'sandbox_kyc_identity_review_audit',
      driverIdentityTrust: 'sandbox_driver_identity_trust',
      kycStepUpChallenges: 'sandbox_kyc_stepup_challenges'
    });
    expect(KYC_PERSISTENCE_RESOURCES.sandbox).toEqual(expect.objectContaining({
      failedBiometricEvidenceStoragePrefix:
        'restricted/sandbox/kyc-failed-biometric-evidence/v1',
      identityTrustStateCachePrefix: 'sandbox:kyc:identity-trust:state:',
      identityTrustCompatibilityVerificationPrefix: 'sandbox:kyc_verification:',
      identityTrustDriverHashPrefix: 'sandbox:driver:'
    }));
  });

  it('binds every scoped KYC service to sandbox-only resources', () => {
    const context = sandboxContext();
    const evidence = createScopedKycFailedBiometricEvidenceService(context);
    const review = createScopedKycIdentityReviewCaseService(context);
    const trust = createScopedDriverIdentityTrustService(context, { redis: null });

    expect(evidence.collectionName).toBe('sandbox_kyc_failed_biometric_evidence');
    expect(evidence.storagePrefix).toBe(
      'restricted/sandbox/kyc-failed-biometric-evidence/v1'
    );
    expect(review.collections).toEqual({
      cases: 'sandbox_kyc_identity_review_cases',
      enforcement: 'sandbox_driver_identity_enforcement',
      retryAuthorizations: 'sandbox_kyc_identity_retry_authorizations',
      audit: 'sandbox_kyc_identity_review_audit'
    });
    expect(trust.stateCollection).toBe('sandbox_driver_identity_trust');
    expect(trust.stepUpChallengeCollection).toBe('sandbox_kyc_stepup_challenges');
    expect(trust.buildStateCacheKey('driver-1')).toBe(
      'sandbox:kyc:identity-trust:state:driver-1'
    );
    expect(trust.buildCompatibilityVerificationKey('driver-1')).toBe(
      'sandbox:kyc_verification:driver-1'
    );
    expect(trust.buildDriverHashKey('driver-1')).toBe('sandbox:driver:driver-1');
  });

  it('emits the sealed financial envelope and rejects records from another scope', () => {
    const context = sandboxContext();
    const services = [
      createScopedKycFailedBiometricEvidenceService(context),
      createScopedKycIdentityReviewCaseService(context),
      createScopedDriverIdentityTrustService(context, { redis: null })
    ];

    for (const service of services) {
      expect(service.persistenceEnvelope()).toMatchObject({
        financialContext: context,
        financialNamespace: 'sandbox',
        financialContextId: context.contextId,
        providerEnvironment: 'sandbox',
        paymentProfileId: 'qa-test-users-sandbox-durable',
        testUserSandbox: true
      });
      expect(() => service.assertRecordScope({ driverId: 'driver-1' })).toThrow(
        expect.objectContaining({ code: 'SANDBOX_RECORD_CONTEXT_INVALID' })
      );
      expect(() => service.assertRecordScope({
        driverId: 'driver-1',
        financialContext: operationalContext()
      })).toThrow(expect.objectContaining({ code: 'SANDBOX_RECORD_CONTEXT_INVALID' }));
    }
  });

  it('denies operational resource overrides under a sandbox context', () => {
    expect(() => new KycFailedBiometricEvidenceService({
      persistenceContext: sandboxContext(),
      collectionName: 'kyc_failed_biometric_evidence'
    })).toThrow(expect.objectContaining({ code: 'KYC_PERSISTENCE_RESOURCE_MISMATCH' }));
  });

  it('keeps explicit sandbox access read-scoped and refuses context-less writes', () => {
    const accessScope = createExplicitSandboxAccessScope({
      authorized: true,
      source: 'kyc_support_dashboard'
    });
    expect(() => buildScopedPersistenceEnvelope(accessScope)).toThrow(
      expect.objectContaining({ code: 'SANDBOX_PERSISTENCE_CONTEXT_REQUIRED' })
    );

    const context = sandboxContext();
    expect(buildScopedPersistenceEnvelope(accessScope, {
      record: { financialContext: context }
    })).toMatchObject({
      financialNamespace: 'sandbox',
      financialContextId: context.contextId
    });
  });
});
