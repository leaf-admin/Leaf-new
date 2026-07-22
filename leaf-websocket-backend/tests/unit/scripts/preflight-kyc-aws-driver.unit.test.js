const {
  validateProvider,
  validateBiometricReadiness,
  validateInternalBiometricRuntime
} = require('../../../scripts/ops/preflight-kyc-aws-driver.cjs');

describe('KYC AWS preflight public projections', () => {
  test('accepts the minimum liveness provider contract', () => {
    expect(validateProvider({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      config: {
        enabled: true,
        credentialsEnabled: true,
        hasAssumeRoleArn: true
      }
    })).toEqual({
      provider: 'aws_rekognition_face_liveness',
      enabled: true,
      credentialsEnabled: true,
      assumeRoleConfigured: true
    });
  });

  test.each([
    ['confidenceThreshold', 80],
    ['maxAttemptsPerWindow', 2],
    ['estimatedUnitCostUsd', 0.015],
    ['costGuard', { enabled: true }]
  ])('blocks provider responses that expose %s', (field, value) => {
    expect(() => validateProvider({
      success: true,
      provider: 'aws_rekognition_face_liveness',
      config: {
        enabled: true,
        credentialsEnabled: true,
        hasAssumeRoleArn: true,
        [field]: value
      }
    })).toThrow(expect.objectContaining({
      code: 'KYC_PROVIDER_PUBLIC_CONTRACT_UNSAFE'
    }));
  });

  test('accepts aggregate biometric readiness without internal policy details', () => {
    expect(validateBiometricReadiness({
      success: true,
      ready: true,
      code: 'KYC_BIOMETRICS_READY'
    })).toEqual({
      ready: true,
      code: 'KYC_BIOMETRICS_READY'
    });
  });

  test.each([
    ['policy', { strictProductionMode: true }],
    ['awsLiveness', { provider: 'aws_rekognition_face_liveness' }],
    ['awsFaceCompare', { approveThreshold: 0.95 }],
    ['blockers', []]
  ])('blocks readiness responses that expose %s', (field, value) => {
    expect(() => validateBiometricReadiness({
      success: true,
      ready: true,
      code: 'KYC_BIOMETRICS_READY',
      [field]: value
    })).toThrow(expect.objectContaining({
      code: 'KYC_BIOMETRIC_READINESS_PUBLIC_CONTRACT_UNSAFE'
    }));
  });

  test('validates sensitive provider policy locally but returns only safe evidence', () => {
    const result = validateInternalBiometricRuntime({
      readOnly: true,
      readiness: {
        ok: true,
        enabled: true,
        blockers: [],
        policy: {
          productionRuntime: true,
          productionBiometricsEnabled: true,
          strictProductionMode: true,
          requireTrustedBiometricMatch: true,
          allowLegacyDeviceSignature: false,
          allowAwsLivenessOnlyMatch: false,
          allowMobileDeviceEmbedding: false
        }
      },
      liveness: {
        enabled: true,
        provider: 'aws_rekognition_face_liveness',
        region: 'us-east-1',
        credentialsEnabled: true,
        hasAssumeRoleArn: true,
        hasOutputBucket: false,
        sessionTtlSeconds: 180,
        sessionBindingTtlSeconds: 86400,
        attemptWindowSeconds: 86400,
        costGuard: {
          enabled: true,
          dailyLimitConfigured: true,
          monthlyLimitConfigured: true
        }
      },
      compare: {
        enabled: true,
        provider: 'aws_rekognition_compare_faces',
        region: 'us-east-1',
        sdkMaxAttempts: 1,
        approveThreshold: 0.95,
        reviewThreshold: 0.8,
        costGuard: { enabled: true }
      }
    });

    expect(result).toEqual({ ready: true, checkedLocally: true });
    expect(JSON.stringify(result)).not.toMatch(/threshold|provider|budget|cost|limit/i);
  });

  test('fails closed when the internal compare threshold is not approved', () => {
    expect(() => validateInternalBiometricRuntime({
      readOnly: true,
      readiness: {
        ok: true,
        enabled: true,
        blockers: [],
        policy: {
          productionRuntime: true,
          productionBiometricsEnabled: true,
          strictProductionMode: true,
          requireTrustedBiometricMatch: true,
          allowLegacyDeviceSignature: false,
          allowAwsLivenessOnlyMatch: false,
          allowMobileDeviceEmbedding: false
        }
      },
      liveness: {
        enabled: true,
        provider: 'aws_rekognition_face_liveness',
        region: 'us-east-1',
        credentialsEnabled: true,
        hasAssumeRoleArn: true,
        hasOutputBucket: false,
        sessionTtlSeconds: 180,
        sessionBindingTtlSeconds: 86400,
        attemptWindowSeconds: 86400,
        costGuard: {
          enabled: true,
          dailyLimitConfigured: true,
          monthlyLimitConfigured: true
        }
      },
      compare: {
        enabled: true,
        provider: 'aws_rekognition_compare_faces',
        region: 'us-east-1',
        sdkMaxAttempts: 1,
        approveThreshold: 0.9,
        reviewThreshold: 0.8,
        costGuard: { enabled: true }
      }
    })).toThrow(expect.objectContaining({
      code: 'KYC_INTERNAL_BIOMETRIC_RUNTIME_BLOCKED'
    }));
  });

  test('fails closed when liveness TTL or durable binding retention diverges from the approved contract', () => {
    const buildSnapshot = (livenessOverrides) => ({
      readOnly: true,
      readiness: {
        ok: true,
        enabled: true,
        blockers: [],
        policy: {
          productionRuntime: true,
          productionBiometricsEnabled: true,
          strictProductionMode: true,
          requireTrustedBiometricMatch: true,
          allowLegacyDeviceSignature: false,
          allowAwsLivenessOnlyMatch: false,
          allowMobileDeviceEmbedding: false
        }
      },
      liveness: {
        enabled: true,
        provider: 'aws_rekognition_face_liveness',
        region: 'us-east-1',
        credentialsEnabled: true,
        hasAssumeRoleArn: true,
        hasOutputBucket: false,
        sessionTtlSeconds: 180,
        sessionBindingTtlSeconds: 86400,
        attemptWindowSeconds: 86400,
        costGuard: {
          enabled: true,
          dailyLimitConfigured: true,
          monthlyLimitConfigured: true
        },
        ...livenessOverrides
      },
      compare: {
        enabled: true,
        provider: 'aws_rekognition_compare_faces',
        region: 'us-east-1',
        sdkMaxAttempts: 1,
        approveThreshold: 0.95,
        reviewThreshold: 0.8,
        costGuard: { enabled: true }
      }
    });

    expect(() => validateInternalBiometricRuntime(buildSnapshot({
      sessionTtlSeconds: 1200
    }))).toThrow(expect.objectContaining({
      code: 'KYC_INTERNAL_BIOMETRIC_RUNTIME_BLOCKED'
    }));
    expect(() => validateInternalBiometricRuntime(buildSnapshot({
      sessionBindingTtlSeconds: 180
    }))).toThrow(expect.objectContaining({
      code: 'KYC_INTERNAL_BIOMETRIC_RUNTIME_BLOCKED'
    }));
  });

  test('fails closed when the internal CompareFaces client can retry a paid call', () => {
    expect(() => validateInternalBiometricRuntime({
      readOnly: true,
      readiness: {
        ok: true,
        enabled: true,
        blockers: [],
        policy: {
          productionRuntime: true,
          productionBiometricsEnabled: true,
          strictProductionMode: true,
          requireTrustedBiometricMatch: true,
          allowLegacyDeviceSignature: false,
          allowAwsLivenessOnlyMatch: false,
          allowMobileDeviceEmbedding: false
        }
      },
      liveness: {
        enabled: true,
        provider: 'aws_rekognition_face_liveness',
        region: 'us-east-1',
        credentialsEnabled: true,
        hasAssumeRoleArn: true,
        hasOutputBucket: false,
        sessionTtlSeconds: 180,
        sessionBindingTtlSeconds: 86400,
        attemptWindowSeconds: 86400,
        costGuard: {
          enabled: true,
          dailyLimitConfigured: true,
          monthlyLimitConfigured: true
        }
      },
      compare: {
        enabled: true,
        provider: 'aws_rekognition_compare_faces',
        region: 'us-east-1',
        sdkMaxAttempts: 2,
        approveThreshold: 0.95,
        reviewThreshold: 0.8,
        costGuard: { enabled: true }
      }
    })).toThrow(expect.objectContaining({
      code: 'KYC_INTERNAL_BIOMETRIC_RUNTIME_BLOCKED'
    }));
  });
});
