const AWS_LIVENESS_PROVIDER = 'aws_rekognition_face_liveness';
const DEFAULT_TRUSTED_MATCH_PROVIDERS = Object.freeze([
  'mobile_face_embedding',
  'biometric-face-service',
  'leaf_face_compare_service'
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
  const strictDefault = productionBiometricsEnabled;

  return {
    productionRuntime,
    productionBiometricsEnabled,
    requireTrustedBiometricMatch: readBooleanLike(
      env.KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH,
      strictDefault
    ),
    allowLegacyDeviceSignature: readBooleanLike(
      env.KYC_ALLOW_LEGACY_DEVICE_SIGNATURE,
      !strictDefault
    ),
    allowAwsLivenessOnlyMatch: readBooleanLike(
      env.KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH,
      !strictDefault
    ),
    trustedMatchProviders: readList(
      env.KYC_TRUSTED_BIOMETRIC_MATCH_PROVIDERS,
      DEFAULT_TRUSTED_MATCH_PROVIDERS
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
  const awsOnly = isAwsLivenessPayload(payload) && !embeddingVerification;
  const trustedProvider = Boolean(embeddingVerification)
    || isTrustedMatchProvider(payload, policy.trustedMatchProviders);

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

  if (!enabled) {
    warnings.push('KYC_PRODUCTION_BIOMETRICS_ENABLED=false: produção biométrica ainda não está travada em modo estrito.');
    return {
      ok: true,
      enabled,
      policy,
      blockers,
      warnings
    };
  }

  if (!readBooleanLike(env.KYC_AWS_LIVENESS_ENABLED || env.AWS_LIVENESS_ENABLED, false)) {
    blockers.push('KYC_AWS_LIVENESS_ENABLED=true obrigatório para produção biométrica.');
  }
  if (!String(env.KYC_AWS_LIVENESS_ASSUME_ROLE_ARN || env.AWS_LIVENESS_ASSUME_ROLE_ARN || '').trim()) {
    blockers.push('KYC_AWS_LIVENESS_ASSUME_ROLE_ARN obrigatório para emitir credenciais temporárias AWS.');
  }
  if (!String(env.BIOMETRIC_FACE_SERVICE_URL || '').trim()) {
    blockers.push('BIOMETRIC_FACE_SERVICE_URL obrigatório para comparação biométrica.');
  }
  if (!String(env.BIOMETRIC_FACE_SERVICE_API_KEY || '').trim()) {
    blockers.push('BIOMETRIC_FACE_SERVICE_API_KEY obrigatório para comparação biométrica.');
  }
  if (!readBooleanLike(env.ENABLE_CNH_FACE_BIOMETRICS, false)) {
    blockers.push('ENABLE_CNH_FACE_BIOMETRICS=true obrigatório para gerar embedding da CNH.');
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

  const approveThreshold = Number(env.BIOMETRIC_FACE_APPROVE_THRESHOLD || 0.61);
  const reviewThreshold = Number(env.BIOMETRIC_FACE_REVIEW_THRESHOLD || 0.40);
  if (!(Number.isFinite(approveThreshold) && Number.isFinite(reviewThreshold) && reviewThreshold < approveThreshold)) {
    blockers.push('BIOMETRIC_FACE_REVIEW_THRESHOLD precisa ser menor que BIOMETRIC_FACE_APPROVE_THRESHOLD.');
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
  AWS_LIVENESS_PROVIDER,
  DEFAULT_TRUSTED_MATCH_PROVIDERS,
  evaluateDeviceVerificationTrust,
  evaluateProductionReadiness,
  isProductionRuntime,
  readBooleanLike,
  resolveBiometricPolicy
};
