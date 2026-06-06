const {
  evaluateDeviceVerificationTrust,
  evaluateProductionReadiness,
  resolveBiometricPolicy
} = require('../../../services/kyc-biometric-production-policy');

describe('kyc biometric production policy', () => {
  test('keeps legacy device signature allowed outside strict biometric production', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'device_signature_v1',
      isMatch: true
    }, { policy });

    expect(result.allowed).toBe(true);
    expect(policy.allowLegacyDeviceSignature).toBe(true);
  });

  test('blocks legacy device signature in strict biometric production', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'device_signature_v1',
      isMatch: true
    }, { policy });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('KYC_LEGACY_DEVICE_SIGNATURE_DISABLED');
  });

  test('uses ENABLE_STRICT_BIOMETRIC_KYC as the primary runtime feature flag', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      ENABLE_STRICT_BIOMETRIC_KYC: 'true',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false'
    });

    expect(policy.productionBiometricsEnabled).toBe(true);
    expect(policy.strictBiometricFeatureFlag).toMatchObject({
      key: 'ENABLE_STRICT_BIOMETRIC_KYC',
      source: 'feature_flag',
      value: true
    });
  });

  test('keeps KYC_PRODUCTION_BIOMETRICS_ENABLED as a legacy alias', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    expect(policy.productionBiometricsEnabled).toBe(true);
    expect(policy.strictBiometricFeatureFlag).toMatchObject({
      legacyKey: 'KYC_PRODUCTION_BIOMETRICS_ENABLED',
      source: 'legacy_flag',
      value: true
    });
  });

  test('blocks AWS liveness only as identity match in strict biometric production', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'aws_rekognition_face_liveness',
      provider: 'aws_rekognition_face_liveness',
      isMatch: true,
      awsLivenessPassed: true
    }, { policy });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('KYC_AWS_LIVENESS_ONLY_DISABLED');
  });

  test('allows trusted mobile embedding comparison in strict biometric production', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'mobile_arcface_w600k_r50_v1',
      provider: 'mobile_face_embedding',
      isMatch: true,
      comparisonProvider: 'biometric-face-service'
    }, {
      policy,
      embeddingVerification: { success: true }
    });

    expect(result.allowed).toBe(true);
  });

  test('requires all production biometric dependencies when enabled', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'KYC_AWS_LIVENESS_ENABLED=true obrigatório para produção biométrica.',
      'KYC_AWS_LIVENESS_ASSUME_ROLE_ARN obrigatório para emitir credenciais temporárias AWS.',
      'BIOMETRIC_FACE_SERVICE_URL obrigatório para comparação biométrica.',
      'BIOMETRIC_FACE_SERVICE_API_KEY obrigatório para comparação biométrica.',
      'ENABLE_CNH_FACE_BIOMETRICS=true obrigatório para gerar embedding da CNH.'
    ]));
  });
});
