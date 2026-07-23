const {
  evaluateDeviceVerificationTrust,
  evaluateProductionReadiness,
  resolveBiometricPolicy
} = require('../../../services/kyc-biometric-production-policy');

describe('kyc biometric production policy', () => {
  test('keeps legacy device signature allowed only outside production', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'test',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'device_signature_v1',
      isMatch: true
    }, { policy });

    expect(result.allowed).toBe(true);
    expect(policy.allowLegacyDeviceSignature).toBe(true);
  });

  test('never allows legacy device signature in production, even with a stale override', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'true'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'device_signature_v1',
      isMatch: true
    }, { policy });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('KYC_LEGACY_DEVICE_SIGNATURE_DISABLED');
    expect(policy.requireTrustedBiometricMatch).toBe(true);
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

  test('blocks mobile device embedding until the native model/runtime is homologated', () => {
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

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('KYC_MOBILE_DEVICE_EMBEDDING_DISABLED');
  });

  test('allows a trusted backend face comparison in strict biometric production', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'biometric-face-service',
      provider: 'biometric-face-service',
      isMatch: true,
      comparisonProvider: 'biometric-face-service'
    }, { policy });

    expect(result.allowed).toBe(true);
  });

  test('does not trust a client-declared AWS CompareFaces provider', () => {
    const policy = resolveBiometricPolicy({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces'
    });

    const result = evaluateDeviceVerificationTrust({
      mode: 'aws_rekognition_compare_faces',
      provider: 'aws_rekognition_compare_faces',
      comparisonProvider: 'aws_rekognition_compare_faces',
      isMatch: true
    }, { policy });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('KYC_TRUSTED_BIOMETRIC_MATCH_REQUIRED');
    expect(policy.canonicalTrustedMatchProviders).toContain('aws_rekognition_compare_faces');
    expect(policy.trustedMatchProviders).not.toContain('aws_rekognition_compare_faces');
  });

  test('accepts AWS CompareFaces readiness without the legacy face service', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_STRICT_PRODUCTION_MODE: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/mobile-liveness',
      KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID: 'external-binding',
      KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX: 'leaf-liveness',
      KYC_AWS_CREDENTIAL_SOURCE: 'static',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD: '0.95',
      KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD: '0.80',
      KYC_AWS_COST_GUARD_ENABLED: 'true',
      KYC_AWS_COST_DAILY_LIMIT_USD: '2.50',
      KYC_AWS_COST_MONTHLY_LIMIT_USD: '50.00',
      KYC_AWS_COST_TIME_ZONE: 'UTC',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      ENABLE_CNH_FACE_BIOMETRICS: 'false',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false'
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test('blocks an AWS canonical approval threshold below 0.95', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD: '0.90',
      KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD: '0.80'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD deve ser pelo menos 0.95 no fluxo AWS canônico.'
    );
  });

  test('blocks CompareFaces SDK retries because the provider has no idempotency token', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS: '2'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS=1 obrigatório para impedir cobrança duplicada sem idempotency token.'
    );
  });

  test('blocks strict biometric activation without explicit Firestore positive authority', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    expect(result.ok).toBe(false);
    expect(result.policy.strictProductionMode).toBe(false);
    expect(result.blockers).toContain(
      'KYC_STRICT_PRODUCTION_MODE=true obrigatório para usar somente Firestore como autoridade KYC positiva.'
    );
  });

  test('blocks the legacy CNH embedding shadow path in the canonical AWS profile', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/mobile-liveness',
      KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID: 'external-binding',
      KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX: 'leaf-liveness',
      KYC_AWS_CREDENTIAL_SOURCE: 'ambient',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COST_GUARD_ENABLED: 'true',
      KYC_AWS_COST_DAILY_LIMIT_USD: '2.50',
      KYC_AWS_COST_MONTHLY_LIMIT_USD: '50.00',
      KYC_AWS_COST_TIME_ZONE: 'UTC',
      ENABLE_CNH_FACE_BIOMETRICS: 'true',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'ENABLE_CNH_FACE_BIOMETRICS=false obrigatório no perfil AWS canônico para manter o embedding legado isolado.'
    );
  });

  test('blocks an idempotent retry window that can outlive the AWS liveness session', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/mobile-liveness',
      KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID: 'external-binding',
      KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX: 'leaf-liveness',
      KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_DELAY_SECONDS: '2',
      KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_WINDOW_SECONDS: '180',
      KYC_AWS_CREDENTIAL_SOURCE: 'ambient',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COST_GUARD_ENABLED: 'true',
      KYC_AWS_COST_DAILY_LIMIT_USD: '2.50',
      KYC_AWS_COST_MONTHLY_LIMIT_USD: '50.00',
      KYC_AWS_COST_TIME_ZONE: 'UTC',
      ENABLE_CNH_FACE_BIOMETRICS: 'false',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'Retry idempotente do AWS Liveness exige delay 0-30s e janela 30-150s, com delay menor que a janela.'
    );
  });

  test('blocks S3 liveness output in strict canonical biometrics', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/mobile-liveness',
      KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID: 'external-binding',
      KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX: 'leaf-liveness',
      KYC_AWS_LIVENESS_S3_BUCKET: 'leaf-liveness-output',
      KYC_AWS_CREDENTIAL_SOURCE: 'static',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD: '0.95',
      KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD: '0.80',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'KYC_AWS_LIVENESS_S3_BUCKET deve permanecer vazio no fluxo biométrico canônico.'
    );
  });

  test('requires all production biometric dependencies when enabled', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'KYC_AWS_LIVENESS_ENABLED=true obrigatório para produção biométrica.',
      'KYC_STRICT_PRODUCTION_MODE=true obrigatório para usar somente Firestore como autoridade KYC positiva.',
      'KYC_AWS_LIVENESS_ASSUME_ROLE_ARN obrigatório para emitir credenciais temporárias AWS.',
      'KYC_AWS_LIVENESS_CREDENTIALS_ENABLED=true obrigatório para o streaming Liveness no dispositivo.',
      'KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID obrigatório para o trust binding do Liveness.',
      'KYC_AWS_COST_GUARD_ENABLED=true obrigatório para limitar chamadas pagas AWS KYC.',
      'Limites diário/mensal do circuit breaker AWS KYC devem ser positivos e diário <= mensal.',
      'KYC_AWS_COST_TIME_ZONE=UTC obrigatório para o circuit breaker AWS KYC.',
      'KYC_ACTIVE_TRIP_AUTHORITY_MODE deve ser redis_noeviction; durable_fallback permanece indisponível até existir uma implementação homologada.',
      'KYC_AWS_CREDENTIAL_SOURCE deve ser static ou ambient em produção biométrica.',
      'BIOMETRIC_FACE_SERVICE_URL obrigatório para comparação biométrica.',
      'BIOMETRIC_FACE_SERVICE_API_KEY obrigatório para comparação biométrica.',
      'ENABLE_CNH_FACE_BIOMETRICS=true obrigatório para gerar embedding da CNH.',
      'MOBILE_FACE_EMBEDDING_ENABLED=false obrigatório até homologação do modelo/runtime nativo.'
    ]));
  });

  test('keeps the unimplemented durable fallback blocked in strict production readiness', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'durable_fallback'
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'KYC_ACTIVE_TRIP_AUTHORITY_MODE deve ser redis_noeviction; durable_fallback permanece indisponível até existir uma implementação homologada.'
    );
  });

  test('blocks a controlled pilot while production biometrics are disabled', () => {
    const result = evaluateProductionReadiness({
      NODE_ENV: 'production',
      LEAF_LAUNCH_PROFILE: 'pilot_controlled',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false'
    });

    expect(result).toMatchObject({
      ok: false,
      enabled: false
    });
    expect(result.blockers).toContain(
      'KYC_PRODUCTION_BIOMETRICS_ENABLED=false: produção biométrica ainda não está travada em modo estrito.'
    );
  });
});
