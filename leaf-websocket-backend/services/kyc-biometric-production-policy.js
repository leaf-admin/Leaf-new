const AWS_LIVENESS_PROVIDER = 'aws_rekognition_face_liveness';
const AWS_COMPARE_FACES_PROVIDER = 'aws_rekognition_compare_faces';
const MIN_AWS_COMPARE_FACES_APPROVE_THRESHOLD = 0.95;
const DEFAULT_TRUSTED_MATCH_PROVIDERS = Object.freeze([
  'biometric-face-service',
  'leaf_face_compare_service'
]);
const DEFAULT_CANONICAL_TRUSTED_MATCH_PROVIDERS = Object.freeze([
  ...DEFAULT_TRUSTED_MATCH_PROVIDERS,
  AWS_COMPARE_FACES_PROVIDER
]);

function readBooleanLike(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function readList(value, fallback = []) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isProductionRuntime(env = process.env) {
  return ['production', 'prod'].includes(String(env.NODE_ENV || '').trim().toLowerCase());
}

function resolveBiometricPolicy(env = process.env) {
  const productionRuntime = isProductionRuntime(env);
  const productionBiometricsEnabled = readBooleanLike(env.KYC_PRODUCTION_BIOMETRICS_ENABLED, false);
  const strictProductionMode = readBooleanLike(env.KYC_STRICT_PRODUCTION_MODE, false);
  const strictDefault = productionBiometricsEnabled;

  return {
    productionRuntime,
    productionBiometricsEnabled,
    strictProductionMode,
    // A production runtime must never trust a client-declared identity match.
    // The rollout flag controls readiness diagnostics, not this authorization boundary.
    requireTrustedBiometricMatch: productionRuntime
      ? true
      : readBooleanLike(env.KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH, strictDefault),
    allowLegacyDeviceSignature: productionRuntime
      ? false
      : readBooleanLike(env.KYC_ALLOW_LEGACY_DEVICE_SIGNATURE, !strictDefault),
    allowAwsLivenessOnlyMatch: productionRuntime
      ? false
      : readBooleanLike(env.KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH, !strictDefault),
    allowMobileDeviceEmbedding: productionRuntime
      ? false
      : readBooleanLike(env.MOBILE_FACE_EMBEDDING_ENABLED, !strictDefault),
    trustedMatchProviders: readList(
      env.KYC_TRUSTED_BIOMETRIC_MATCH_PROVIDERS,
      DEFAULT_TRUSTED_MATCH_PROVIDERS
    ),
    // Kept separate from device payload providers: AWS CompareFaces is trusted
    // only when produced by the canonical server-side route.
    canonicalTrustedMatchProviders: readList(
      env.KYC_CANONICAL_TRUSTED_BIOMETRIC_MATCH_PROVIDERS,
      DEFAULT_CANONICAL_TRUSTED_MATCH_PROVIDERS
    )
  };
}

function getVerificationMode(payload = {}) {
  return String(payload.mode || payload.provider || '').trim();
}

function getVerificationProvider(payload = {}) {
  return String(payload.provider || payload.mode || '').trim();
}

function isAwsLivenessPayload(payload = {}) {
  const mode = getVerificationMode(payload);
  const provider = getVerificationProvider(payload);
  return mode === AWS_LIVENESS_PROVIDER || provider === AWS_LIVENESS_PROVIDER;
}

function isTrustedMatchProvider(payload = {}, trustedProviders = DEFAULT_TRUSTED_MATCH_PROVIDERS) {
  const provider = getVerificationProvider(payload);
  const mode = getVerificationMode(payload);
  const comparisonProvider = String(payload.comparisonProvider || '').trim();
  return [provider, mode, comparisonProvider].some((value) => trustedProviders.includes(value));
}

function evaluateDeviceVerificationTrust(payload = {}, options = {}) {
  const policy = options.policy || resolveBiometricPolicy(options.env || process.env);
  const embeddingVerification = options.embeddingVerification || null;
  const mode = getVerificationMode(payload);
  const isLegacySignature = mode === 'device_signature_v1';
  const isMobileDeviceEmbedding = Boolean(
    embeddingVerification ||
    mode === 'device_embedding_v1' ||
    mode.startsWith('mobile_arcface') ||
    getVerificationProvider(payload) === 'mobile_face_embedding'
  );
  const awsOnly = isAwsLivenessPayload(payload) && !embeddingVerification;
  const trustedProvider = isTrustedMatchProvider(payload, policy.trustedMatchProviders);

  if (isLegacySignature && !policy.allowLegacyDeviceSignature) {
    return {
      allowed: false,
      code: 'KYC_LEGACY_DEVICE_SIGNATURE_DISABLED',
      message: 'Assinatura facial legada do dispositivo não é permitida neste runtime.',
      policy
    };
  }

  if (awsOnly && !policy.allowAwsLivenessOnlyMatch) {
    return {
      allowed: false,
      code: 'KYC_AWS_LIVENESS_ONLY_DISABLED',
      message: 'Liveness AWS sem comparação biométrica não é suficiente neste runtime.',
      policy
    };
  }

  if (isMobileDeviceEmbedding && !policy.allowMobileDeviceEmbedding) {
    return {
      allowed: false,
      code: 'KYC_MOBILE_DEVICE_EMBEDDING_DISABLED',
      message: 'Embedding facial do dispositivo não está homologado para este runtime.',
      policy
    };
  }

  if (policy.requireTrustedBiometricMatch && !trustedProvider) {
    return {
      allowed: false,
      code: 'KYC_TRUSTED_BIOMETRIC_MATCH_REQUIRED',
      message: 'Este runtime exige comparação biométrica verificada pelo backend/microsserviço.',
      policy
    };
  }

  return {
    allowed: true,
    code: 'KYC_BIOMETRIC_TRUST_OK',
    policy
  };
}

function evaluateProductionReadiness(env = process.env) {
  const policy = resolveBiometricPolicy(env);
  const blockers = [];
  const warnings = [];
  const enabled = policy.productionBiometricsEnabled;
  const launchProfile = String(env.LEAF_LAUNCH_PROFILE || '').trim().toLowerCase();
  const runtimeRole = String(env.RUNTIME_ROLE || 'gateway').trim().toLowerCase();
  const preKycValidationProfile = [
    'geofence_validation',
    'ride_flow_validation'
  ].includes(launchProfile);
  const nonInteractiveWorker = [
    'sideeffects',
    'billing',
    'trip-location',
    'trip_location'
  ].includes(runtimeRole);

  if (!enabled) {
    const message = 'KYC_PRODUCTION_BIOMETRICS_ENABLED=false: produção biométrica ainda não está travada em modo estrito.';
    if (policy.productionRuntime && !preKycValidationProfile && !nonInteractiveWorker) {
      blockers.push(message);
    } else {
      warnings.push(message);
    }
    return {
      ok: blockers.length === 0,
      enabled,
      policy,
      blockers,
      warnings
    };
  }

  if (!readBooleanLike(env.KYC_AWS_LIVENESS_ENABLED || env.AWS_LIVENESS_ENABLED, false)) {
    blockers.push('KYC_AWS_LIVENESS_ENABLED=true obrigatório para produção biométrica.');
  }
  if (!policy.strictProductionMode) {
    blockers.push('KYC_STRICT_PRODUCTION_MODE=true obrigatório para usar somente Firestore como autoridade KYC positiva.');
  }
  if (!String(env.KYC_AWS_LIVENESS_ASSUME_ROLE_ARN || env.AWS_LIVENESS_ASSUME_ROLE_ARN || '').trim()) {
    blockers.push('KYC_AWS_LIVENESS_ASSUME_ROLE_ARN obrigatório para emitir credenciais temporárias AWS.');
  }
  if (!readBooleanLike(env.KYC_AWS_LIVENESS_CREDENTIALS_ENABLED, false)) {
    blockers.push('KYC_AWS_LIVENESS_CREDENTIALS_ENABLED=true obrigatório para o streaming Liveness no dispositivo.');
  }
  const activeTripAuthorityMode = String(
    env.KYC_ACTIVE_TRIP_AUTHORITY_MODE || ''
  ).trim().toLowerCase();
  if (activeTripAuthorityMode !== 'redis_noeviction') {
    blockers.push('KYC_ACTIVE_TRIP_AUTHORITY_MODE deve ser redis_noeviction; durable_fallback permanece indisponível até existir uma implementação homologada.');
  }
  if (String(
    env.KYC_AWS_LIVENESS_S3_BUCKET || env.AWS_LIVENESS_S3_BUCKET || ''
  ).trim()) {
    blockers.push('KYC_AWS_LIVENESS_S3_BUCKET deve permanecer vazio no fluxo biométrico canônico.');
  }
  const livenessRetryDelaySeconds = Number(
    env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_DELAY_SECONDS ?? 2
  );
  const livenessRetryWindowSeconds = Number(
    env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_WINDOW_SECONDS ?? 120
  );
  if (
    !Number.isInteger(livenessRetryDelaySeconds)
    || !Number.isInteger(livenessRetryWindowSeconds)
    || livenessRetryDelaySeconds < 0
    || livenessRetryDelaySeconds > 30
    || livenessRetryWindowSeconds < 30
    || livenessRetryWindowSeconds > 150
    || livenessRetryDelaySeconds >= livenessRetryWindowSeconds
  ) {
    blockers.push('Retry idempotente do AWS Liveness exige delay 0-30s e janela 30-150s, com delay menor que a janela.');
  }
  const costGuardEnabled = readBooleanLike(env.KYC_AWS_COST_GUARD_ENABLED, false);
  const dailyCostLimitUsd = Number(env.KYC_AWS_COST_DAILY_LIMIT_USD);
  const monthlyCostLimitUsd = Number(env.KYC_AWS_COST_MONTHLY_LIMIT_USD);
  const costOperationRetentionDays = Number(
    env.KYC_AWS_COST_OPERATION_RETENTION_DAYS ?? 35
  );
  if (!costGuardEnabled) {
    blockers.push('KYC_AWS_COST_GUARD_ENABLED=true obrigatório para limitar chamadas pagas AWS KYC.');
  }
  if (
    !Number.isFinite(dailyCostLimitUsd)
    || !Number.isFinite(monthlyCostLimitUsd)
    || dailyCostLimitUsd <= 0
    || monthlyCostLimitUsd <= 0
    || dailyCostLimitUsd > monthlyCostLimitUsd
  ) {
    blockers.push('Limites diário/mensal do circuit breaker AWS KYC devem ser positivos e diário <= mensal.');
  }
  if (String(env.KYC_AWS_COST_TIME_ZONE || '').trim().toUpperCase() !== 'UTC') {
    blockers.push('KYC_AWS_COST_TIME_ZONE=UTC obrigatório para o circuit breaker AWS KYC.');
  }
  if (
    !Number.isInteger(costOperationRetentionDays)
    || costOperationRetentionDays < 1
    || costOperationRetentionDays > 400
  ) {
    blockers.push('KYC_AWS_COST_OPERATION_RETENTION_DAYS deve estar entre 1 e 400 dias.');
  }
  if (!String(
    env.KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID
    || env.AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID
    || ''
  ).trim()) {
    blockers.push('KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID obrigatório para o trust binding do Liveness.');
  }
  const stsSessionNamePrefix = String(
    env.KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX || ''
  ).trim();
  if (stsSessionNamePrefix !== 'leaf-liveness') {
    blockers.push('KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX=leaf-liveness obrigatório para a trust policy atual.');
  }
  const awsCredentialSource = String(env.KYC_AWS_CREDENTIAL_SOURCE || '').trim().toLowerCase();
  if (!['static', 'ambient'].includes(awsCredentialSource)) {
    blockers.push('KYC_AWS_CREDENTIAL_SOURCE deve ser static ou ambient em produção biométrica.');
  }
  if (
    awsCredentialSource === 'static'
    && (
      !String(env.AWS_ACCESS_KEY_ID || '').trim()
      || !String(env.AWS_SECRET_ACCESS_KEY || '').trim()
    )
  ) {
    blockers.push('KYC_AWS_CREDENTIAL_SOURCE=static exige AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');
  }
  const faceCompareProvider = String(
    env.KYC_FACE_COMPARE_PROVIDER || 'leaf_face_compare_service'
  ).trim().toLowerCase();
  if (faceCompareProvider === AWS_COMPARE_FACES_PROVIDER) {
    const compareResultPersistenceAttempts = Number(
      env.KYC_AWS_COMPARE_RESULT_PERSIST_MAX_ATTEMPTS ?? 3
    );
    const compareSdkMaxAttempts = Number(
      env.KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS ?? 1
    );
    if (!readBooleanLike(env.KYC_AWS_COMPARE_FACES_ENABLED, false)) {
      blockers.push('KYC_AWS_COMPARE_FACES_ENABLED=true obrigatório para usar AWS CompareFaces.');
    }
    if (!policy.canonicalTrustedMatchProviders.includes(AWS_COMPARE_FACES_PROVIDER)) {
      blockers.push('AWS CompareFaces precisa estar na allowlist biométrica canônica server-side.');
    }
    if (readBooleanLike(env.ENABLE_CNH_FACE_BIOMETRICS, false)) {
      blockers.push('ENABLE_CNH_FACE_BIOMETRICS=false obrigatório no perfil AWS canônico para manter o embedding legado isolado.');
    }
    if (compareSdkMaxAttempts !== 1) {
      blockers.push('KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS=1 obrigatório para impedir cobrança duplicada sem idempotency token.');
    }
    if (
      !Number.isInteger(compareResultPersistenceAttempts)
      || compareResultPersistenceAttempts < 1
      || compareResultPersistenceAttempts > 5
    ) {
      blockers.push('KYC_AWS_COMPARE_RESULT_PERSIST_MAX_ATTEMPTS deve estar entre 1 e 5.');
    }
  } else if (['leaf_face_compare_service', 'biometric-face-service'].includes(faceCompareProvider)) {
    if (!String(env.BIOMETRIC_FACE_SERVICE_URL || '').trim()) {
      blockers.push('BIOMETRIC_FACE_SERVICE_URL obrigatório para comparação biométrica.');
    }
    if (!String(env.BIOMETRIC_FACE_SERVICE_API_KEY || '').trim()) {
      blockers.push('BIOMETRIC_FACE_SERVICE_API_KEY obrigatório para comparação biométrica.');
    }
    if (!readBooleanLike(env.ENABLE_CNH_FACE_BIOMETRICS, false)) {
      blockers.push('ENABLE_CNH_FACE_BIOMETRICS=true obrigatório para gerar embedding da CNH.');
    }
  } else {
    blockers.push(`KYC_FACE_COMPARE_PROVIDER não suportado: ${faceCompareProvider || '(vazio)'}.`);
  }
  if (readBooleanLike(env.MOBILE_FACE_EMBEDDING_ENABLED, true)) {
    blockers.push('MOBILE_FACE_EMBEDDING_ENABLED=false obrigatório até homologação do modelo/runtime nativo.');
  }
  if (readBooleanLike(env.MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK, true)) {
    warnings.push('MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK=true: permitido apenas como legado; produção deve preferir /verify-driver/server-side-selfie.');
  }
  if (!policy.requireTrustedBiometricMatch) {
    blockers.push('KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH=true obrigatório para produção biométrica.');
  }
  if (policy.allowLegacyDeviceSignature) {
    blockers.push('KYC_ALLOW_LEGACY_DEVICE_SIGNATURE=false obrigatório para produção biométrica.');
  }
  if (policy.allowAwsLivenessOnlyMatch) {
    blockers.push('KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH=false obrigatório para produção biométrica.');
  }
  if (policy.allowMobileDeviceEmbedding) {
    blockers.push('Embedding facial local/do dispositivo deve permanecer desabilitado em produção.');
  }

  const approveThreshold = faceCompareProvider === AWS_COMPARE_FACES_PROVIDER
    ? Number(env.KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD || 0.95)
    : Number(env.BIOMETRIC_FACE_APPROVE_THRESHOLD || 0.61);
  const reviewThreshold = faceCompareProvider === AWS_COMPARE_FACES_PROVIDER
    ? Number(env.KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD || 0.80)
    : Number(env.BIOMETRIC_FACE_REVIEW_THRESHOLD || 0.40);
  if (!(Number.isFinite(approveThreshold) && Number.isFinite(reviewThreshold) && reviewThreshold < approveThreshold)) {
    blockers.push('O threshold de revisão precisa ser menor que o threshold de aprovação facial.');
  }
  if (
    faceCompareProvider === AWS_COMPARE_FACES_PROVIDER
    && !(reviewThreshold >= 0 && approveThreshold <= 1)
  ) {
    blockers.push('Thresholds do AWS CompareFaces devem estar normalizados entre 0 e 1.');
  }
  if (
    faceCompareProvider === AWS_COMPARE_FACES_PROVIDER
    && Number.isFinite(approveThreshold)
    && approveThreshold < MIN_AWS_COMPARE_FACES_APPROVE_THRESHOLD
  ) {
    blockers.push('KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD deve ser pelo menos 0.95 no fluxo AWS canônico.');
  }

  return {
    ok: blockers.length === 0,
    enabled,
    policy,
    blockers,
    warnings
  };
}

module.exports = {
  AWS_COMPARE_FACES_PROVIDER,
  AWS_LIVENESS_PROVIDER,
  DEFAULT_CANONICAL_TRUSTED_MATCH_PROVIDERS,
  DEFAULT_TRUSTED_MATCH_PROVIDERS,
  evaluateDeviceVerificationTrust,
  evaluateProductionReadiness,
  isProductionRuntime,
  readBooleanLike,
  resolveBiometricPolicy
};
