/**
 * 🏥 Health Check Routes
 * 
 * Rotas para health checks do sistema
 */

const express = require('express');
const router = express.Router();
const healthCheckService = require('../services/health-check-service');
const { logStructured, logError } = require('../utils/logger');
const { getPilotLaunchFlags } = require('../utils/pilot-launch-flags');
const { getPublicPilotAccessSnapshot } = require('../services/pilot-access-control-service');
const redisCriticalAuthorityService = require('../services/redis-critical-authority-service');
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'sim']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'nao', 'não']);
const MIN_AWS_COMPARE_FACES_APPROVE_THRESHOLD = 0.95;

function envBool(name, fallback = false) {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue === '') {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalized)) return true;
  if (FALSY_VALUES.has(normalized)) return false;
  return fallback;
}

function classifyWooviBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('sandbox')) return 'sandbox';
  if (normalized.includes('api.woovi.com')) return 'production';
  return 'custom';
}

function presence(envVar) {
  const raw = String(process.env[envVar] || '').trim();
  return raw.length > 0;
}

function buildFirebaseSection() {
  const databaseUrlConfigured = presence('FIREBASE_DATABASE_URL');
  const serviceAccountConfigured =
    presence('FIREBASE_SERVICE_ACCOUNT_JSON') ||
    presence('GOOGLE_APPLICATION_CREDENTIALS_JSON') ||
    presence('GOOGLE_APPLICATION_CREDENTIALS');
  return {
    configured: databaseUrlConfigured || serviceAccountConfigured,
    serviceAccountConfigured,
    databaseUrlConfigured
  };
}

function buildPushSection() {
  const firebaseAdminConfigured =
    presence('FIREBASE_SERVICE_ACCOUNT_JSON') ||
    presence('GOOGLE_APPLICATION_CREDENTIALS_JSON') ||
    presence('GOOGLE_APPLICATION_CREDENTIALS');
  const legacyFcmServerKeyConfigured = presence('FCM_SERVER_KEY');
  const demandNotificationServiceEnabled = envBool('ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE', false);

  return {
    configured: firebaseAdminConfigured || legacyFcmServerKeyConfigured || demandNotificationServiceEnabled,
    provider: firebaseAdminConfigured ? 'firebase-admin' : legacyFcmServerKeyConfigured ? 'legacy-fcm-server-key' : null,
    fcmConfigured: firebaseAdminConfigured || legacyFcmServerKeyConfigured,
    demandNotificationServiceEnabled,
    allowPublicDirectFcmSend: envBool('ALLOW_PUBLIC_DIRECT_FCM_SEND', false)
  };
}

function publicRedisAuthorityAttestation(attestation) {
  if (!attestation) return null;
  return {
    ready: attestation.ready === true,
    status: attestation.status || 'unknown',
    quarantined: attestation.quarantined === true,
    checkedAt: attestation.checkedAt || null,
    blockers: Array.isArray(attestation.blockers) ? attestation.blockers : [],
    configuration: attestation.configuration || null,
    dataset: attestation.dataset || null,
    redis: attestation.redis || null,
    memory: attestation.memory || null,
    streams: attestation.streams || null,
    cache: attestation.cache || null
  };
}

async function collectRedisAuthorityAttestation() {
  const authorityMode = String(
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE || ''
  ).trim().toLowerCase();
  if (authorityMode !== 'redis_noeviction') return null;
  return redisCriticalAuthorityService.attest();
}

function isRedisAuthorityAttestationReady(attestation) {
  const criticalPercent = attestation?.configuration?.thresholds?.criticalPercent;
  const memoryUsagePercent = attestation?.memory?.usagePercent;
  return attestation?.ready === true
    && attestation?.quarantined === false
    && attestation?.configuration?.enabled === true
    && attestation?.configuration?.quarantineEnabled === true
    && attestation?.configuration?.generationConfigured === true
    && attestation?.configuration?.generationKeyValid === true
    && attestation?.configuration?.thresholdPolicyMatches === true
    && attestation?.dataset?.markerPresent === true
    && attestation?.dataset?.generationMatches === true
    && attestation?.dataset?.markerPersistent === true
    && attestation?.redis?.maxmemoryPolicy === 'noeviction'
    && attestation?.redis?.appendonly === 'yes'
    && attestation?.redis?.appendfsync === 'everysec'
    && attestation?.redis?.aofEnabled === 1
    && attestation?.redis?.aofLastWriteStatus === 'ok'
    && attestation?.redis?.evictedKeys === 0
    && Number.isFinite(criticalPercent)
    && criticalPercent === 85
    && Number.isFinite(memoryUsagePercent)
    && memoryUsagePercent < criticalPercent
    && attestation?.memory?.maxmemoryMatchesApproved === true
    && (
      attestation?.configuration?.tripLocationStreamEnabled !== true
      || (
        attestation?.streams?.tripLocation?.consumerGroupPresent === true
        && attestation?.streams?.tripLocation?.consumerActive === true
      )
    );
}

function buildAcceptRideAuthoritySection(redisAuthorityAttestation = null) {
  const mode = String(
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE || ''
  ).trim().toLowerCase();
  const valid = mode === '' || mode === 'redis_noeviction';
  const required = mode === 'redis_noeviction';

  return {
    valid,
    required,
    mode: mode || null,
    ready: valid && required && isRedisAuthorityAttestationReady(redisAuthorityAttestation),
    attestation: required
      ? publicRedisAuthorityAttestation(redisAuthorityAttestation)
      : null
  };
}

function buildKycStrictReadinessRequirement() {
  const launchProfile = getPilotLaunchFlags().launchProfile;
  const triggers = {
    pilotControlledProfile:
      launchProfile === 'pilot_controlled'
      || envBool('LEAF_PILOT_CONTROLLED', false),
    productionBiometrics: envBool('KYC_PRODUCTION_BIOMETRICS_ENABLED', false),
    strictProductionMode: envBool('KYC_STRICT_PRODUCTION_MODE', false),
    awsLiveness: envBool('KYC_AWS_LIVENESS_ENABLED', false)
      || envBool('AWS_LIVENESS_ENABLED', false),
    awsLivenessCredentials: envBool('KYC_AWS_LIVENESS_CREDENTIALS_ENABLED', false),
    awsCompareFaces: envBool('KYC_AWS_COMPARE_FACES_ENABLED', false),
    adaptiveCadence: envBool('KYC_TRUST_CADENCE_ENABLED', false),
    onlineGate: envBool('DAILY_KYC_ONLINE_GATE_ENABLED', false)
  };

  return {
    required: Object.values(triggers).some(Boolean),
    triggers
  };
}

function buildKycSection(redisAuthorityAttestation = null) {
  const adaptiveCadenceEnabled = envBool('KYC_TRUST_CADENCE_ENABLED', false);
  const trustPolicyVersion = String(
    process.env.KYC_TRUST_POLICY_VERSION || (
      adaptiveCadenceEnabled
        ? 'driver_identity_recurring_v2'
        : 'driver_identity_recurring_v1'
    )
  ).trim();
  const newMaxAgeHours = Number(process.env.KYC_TRUST_T0_MAX_AGE_HOURS || 24);
  const observedMaxAgeHours = Number(process.env.KYC_TRUST_T1_MAX_AGE_HOURS || 72);
  const trustedMaxAgeHours = Number(process.env.KYC_TRUST_T2_MAX_AGE_HOURS || 168);
  const randomAuditPercent = Number(process.env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT || 10);
  const observedMinDistinctSuccessDays = Number(
    process.env.KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS || 7
  );
  const trustedMinAgeDays = Number(process.env.KYC_TRUST_T2_MIN_AGE_DAYS || 30);
  const trustedMinSuccessCount = Number(process.env.KYC_TRUST_T2_MIN_SUCCESS_COUNT || 14);
  const trustedMinDistinctSuccessDays = Number(
    process.env.KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS || 14
  );
  const trustPromotionRequirementsValid =
    Number.isInteger(observedMinDistinctSuccessDays)
    && observedMinDistinctSuccessDays >= 2
    && observedMinDistinctSuccessDays <= 30
    && Number.isInteger(trustedMinAgeDays)
    && trustedMinAgeDays >= 7
    && trustedMinAgeDays <= 365
    && Number.isInteger(trustedMinSuccessCount)
    && trustedMinSuccessCount >= 2
    && trustedMinSuccessCount <= 365
    && Number.isInteger(trustedMinDistinctSuccessDays)
    && trustedMinDistinctSuccessDays >= observedMinDistinctSuccessDays
    && trustedMinDistinctSuccessDays <= trustedMinSuccessCount;
  const approvedAdaptiveCadencePolicyValid = !adaptiveCadenceEnabled || (
    trustPolicyVersion === 'driver_identity_recurring_v2'
    && randomAuditPercent === 10
    && newMaxAgeHours === 24
    && observedMaxAgeHours === 72
    && trustedMaxAgeHours === 168
    && observedMinDistinctSuccessDays === 7
    && trustedMinAgeDays === 30
    && trustedMinSuccessCount === 14
    && trustedMinDistinctSuccessDays === 14
    && trustPromotionRequirementsValid
  );
  const faceCompareProvider = String(
    process.env.KYC_FACE_COMPARE_PROVIDER || 'leaf_face_compare_service'
  ).trim().toLowerCase();
  const awsCompareFacesConfigured = faceCompareProvider === 'aws_rekognition_compare_faces'
    && envBool('KYC_AWS_COMPARE_FACES_ENABLED', false);
  const awsCompareApproveThreshold = Number(
    process.env.KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD ?? MIN_AWS_COMPARE_FACES_APPROVE_THRESHOLD
  );
  const awsCompareReviewThreshold = Number(
    process.env.KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD ?? 0.80
  );
  const awsCompareApproveThresholdValid = faceCompareProvider !== 'aws_rekognition_compare_faces'
    || (
      Number.isFinite(awsCompareApproveThreshold)
      && awsCompareApproveThreshold >= MIN_AWS_COMPARE_FACES_APPROVE_THRESHOLD
      && awsCompareApproveThreshold <= 1
    );
  const awsCompareThresholdsValid = faceCompareProvider !== 'aws_rekognition_compare_faces'
    || (
      awsCompareApproveThresholdValid
      && Number.isFinite(awsCompareReviewThreshold)
      && awsCompareReviewThreshold >= 0
      && awsCompareReviewThreshold < awsCompareApproveThreshold
    );
  const faceServiceConfigured = presence('BIOMETRIC_FACE_SERVICE_URL');
  const awsCredentialSource = String(process.env.KYC_AWS_CREDENTIAL_SOURCE || '')
    .trim()
    .toLowerCase();
  const awsBaseCredentialsConfigured = awsCredentialSource === 'ambient' || (
    awsCredentialSource === 'static'
    && presence('AWS_ACCESS_KEY_ID')
    && presence('AWS_SECRET_ACCESS_KEY')
  );
  const canonicalReferenceImageMode = presence('KYC_AWS_LIVENESS_S3_BUCKET')
    || presence('AWS_LIVENESS_S3_BUCKET')
    ? 's3_unsupported'
    : 'inline_bytes';
  const acceptRideAuthority = buildAcceptRideAuthoritySection(redisAuthorityAttestation);
  const activeTripAuthorityMode = acceptRideAuthority.mode;
  const activeTripAuthorityReady = acceptRideAuthority.ready;
  const strictReadiness = buildKycStrictReadinessRequirement();
  const awsCostDailyLimitUsd = Number(process.env.KYC_AWS_COST_DAILY_LIMIT_USD);
  const awsCostMonthlyLimitUsd = Number(process.env.KYC_AWS_COST_MONTHLY_LIMIT_USD);
  const awsCostLimitsValid = Number.isFinite(awsCostDailyLimitUsd)
    && Number.isFinite(awsCostMonthlyLimitUsd)
    && awsCostDailyLimitUsd > 0
    && awsCostMonthlyLimitUsd > 0
    && awsCostDailyLimitUsd <= awsCostMonthlyLimitUsd;
  const awsCostOperationRetentionDays = Number(
    process.env.KYC_AWS_COST_OPERATION_RETENTION_DAYS ?? 35
  );
  const awsCostRetentionValid = Number.isInteger(awsCostOperationRetentionDays)
    && awsCostOperationRetentionDays >= 1
    && awsCostOperationRetentionDays <= 400;
  const awsCompareResultPersistenceAttempts = Number(
    process.env.KYC_AWS_COMPARE_RESULT_PERSIST_MAX_ATTEMPTS ?? 3
  );
  const awsCompareResultPersistenceValid = Number.isInteger(awsCompareResultPersistenceAttempts)
    && awsCompareResultPersistenceAttempts >= 1
    && awsCompareResultPersistenceAttempts <= 5;
  const awsLivenessRetryDelaySeconds = Number(
    process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_DELAY_SECONDS ?? 2
  );
  const awsLivenessRetryWindowSeconds = Number(
    process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_WINDOW_SECONDS ?? 120
  );
  const awsLivenessIdempotentRetryValid = Number.isInteger(awsLivenessRetryDelaySeconds)
    && Number.isInteger(awsLivenessRetryWindowSeconds)
    && awsLivenessRetryDelaySeconds >= 0
    && awsLivenessRetryDelaySeconds <= 30
    && awsLivenessRetryWindowSeconds >= 30
    && awsLivenessRetryWindowSeconds <= 150
    && awsLivenessRetryDelaySeconds < awsLivenessRetryWindowSeconds;
  return {
    configured:
      presence('KYC_PRODUCTION_BIOMETRICS_ENABLED')
      || presence('KYC_STRICT_PRODUCTION_MODE')
      || presence('KYC_AWS_LIVENESS_ENABLED')
      || presence('KYC_TRUST_CADENCE_ENABLED'),
    productionBiometricsEnabled: envBool('KYC_PRODUCTION_BIOMETRICS_ENABLED', false),
    strictProductionMode: envBool('KYC_STRICT_PRODUCTION_MODE', false),
    awsLivenessConfigured: envBool('KYC_AWS_LIVENESS_ENABLED', false) || envBool('AWS_LIVENESS_ENABLED', false),
    awsLivenessCredentialsEnabled: envBool('KYC_AWS_LIVENESS_CREDENTIALS_ENABLED', false),
    awsLivenessIdempotentRetryValid,
    awsLivenessRetryDelaySeconds,
    awsLivenessRetryWindowSeconds,
    awsAssumeRoleConfigured: presence('KYC_AWS_LIVENESS_ASSUME_ROLE_ARN')
      || presence('AWS_LIVENESS_ASSUME_ROLE_ARN'),
    awsAssumeRoleExternalIdConfigured: presence('KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID')
      || presence('AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID'),
    awsStsSessionNamePrefixConfigured:
      String(process.env.KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX || '').trim() === 'leaf-liveness',
    awsCredentialSource,
    awsBaseCredentialsConfigured,
    faceCompareProvider,
    faceServiceConfigured,
    awsCompareFacesConfigured,
    awsCompareApproveThreshold,
    awsCompareReviewThreshold,
    awsCompareApproveThresholdValid,
    awsCompareThresholdsValid,
    awsCostGuardEnabled: envBool('KYC_AWS_COST_GUARD_ENABLED', false),
    awsCostLimitsValid,
    awsCostRetentionValid,
    awsCostOperationRetentionDays,
    awsCompareResultPersistenceValid,
    awsCostTimeZoneUtc:
      String(process.env.KYC_AWS_COST_TIME_ZONE || '').trim().toUpperCase() === 'UTC',
    canonicalFaceCompareConfigured: awsCompareFacesConfigured || (
      ['leaf_face_compare_service', 'biometric-face-service'].includes(faceCompareProvider)
      && faceServiceConfigured
    ),
    cnhFaceBiometricsConfigured: envBool('ENABLE_CNH_FACE_BIOMETRICS', false),
    legacyCnhEmbeddingDisabled: !envBool('ENABLE_CNH_FACE_BIOMETRICS', false),
    requireTrustedBiometricMatch: envBool('KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH', false),
    onlineGateEnabled: envBool('DAILY_KYC_ONLINE_GATE_ENABLED', false),
    adaptiveCadenceEnabled,
    activeTripIndexEnabled: envBool('ENABLE_ACTIVE_TRIP_INDEX', true),
    strictReadinessRequired: strictReadiness.required,
    strictReadinessTriggers: strictReadiness.triggers,
    activeTripAuthorityMode,
    activeTripAuthorityReady,
    activeTripAuthorityAttestation: acceptRideAuthority.attestation,
    trustPolicyVersion,
    cadenceHours: {
      new: newMaxAgeHours,
      observed: observedMaxAgeHours,
      trusted: trustedMaxAgeHours
    },
    trustPromotionRequirements: {
      observedMinDistinctSuccessDays,
      trustedMinAgeDays,
      trustedMinSuccessCount,
      trustedMinDistinctSuccessDays
    },
    trustPromotionRequirementsValid,
    approvedAdaptiveCadencePolicyValid,
    trustedRandomAuditPercent: Number.isFinite(randomAuditPercent)
      ? Math.min(100, Math.max(0, randomAuditPercent))
      : 10,
    trustedRandomAuditPercentValid:
      Number.isFinite(randomAuditPercent)
      && randomAuditPercent > 0
      && randomAuditPercent <= 100,
    verificationDuringActiveRide: false,
    canonicalReferenceImageCompare: true,
    canonicalReferenceImageMode
  };
}

function buildMapsSection() {
  const keyConfigured = presence('GOOGLE_MAPS_API_KEY');
  const clientDirectGoogleFallbackAllowed =
    envBool('EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK', false) ||
    envBool('ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK', false);
  return {
    configured: keyConfigured,
    keyConfigured,
    clientDirectGoogleFallbackAllowed,
    backendOnly: keyConfigured && !clientDirectGoogleFallbackAllowed,
    placesCacheEnabled: envBool('ENABLE_PLACES_CACHE', true),
    receiptMapImagesConfigured: keyConfigured || presence('GEO_KEY')
  };
}

function buildSocketSection() {
  return {
    configured: presence('REDIS_HOST') || presence('REDIS_URL'),
    redisAdapterEnabled: envBool('ENABLE_SOCKETIO_REDIS_ADAPTER', false),
    redisAdapterRequired: envBool('REQUIRE_SOCKETIO_REDIS_ADAPTER', false)
  };
}

async function buildRoleReadiness(health) {
  const runtimeRole = String(process.env.RUNTIME_ROLE || 'gateway').trim().toLowerCase();
  const enforceRoleReadiness =
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ||
    envBool('HEALTH_ENFORCE_ROLE_READINESS', false);
  const firebase = buildFirebaseSection();
  const push = buildPushSection();
  const redisAuthorityAttestation = await collectRedisAuthorityAttestation();
  const acceptRideAuthority = buildAcceptRideAuthoritySection(redisAuthorityAttestation);
  const kyc = buildKycSection(redisAuthorityAttestation);
  const maps = buildMapsSection();
  const socket = buildSocketSection();
  const pilotAccess = getPublicPilotAccessSnapshot();
  const paymentRole = ['gateway', 'billing', 'payment', 'payments'].includes(runtimeRole);
  const realtimeRole = ['gateway', 'realtime', 'socket', 'sideeffects', 'worker', 'workers'].includes(runtimeRole);
  const dependencies = {
    quickHealth: health?.status === 'healthy',
    redisConfigured: !realtimeRole || socket.configured,
    firebaseConfigured: !realtimeRole || firebase.configured,
    paymentProviderConfigured: !paymentRole || (
      presence('WOOVI_API_TOKEN') &&
      presence('WOOVI_BASE_URL') &&
      presence('LEAF_PIX_KEY')
    ),
    mapsConfigured: runtimeRole !== 'gateway' || maps.backendOnly,
    fcmConfigured: runtimeRole !== 'gateway' || push.fcmConfigured,
    redisAcceptAuthority: runtimeRole !== 'gateway'
      || (
        acceptRideAuthority.valid
        && (
          (!acceptRideAuthority.required && !kyc.strictReadinessRequired)
          || acceptRideAuthority.ready
        )
      ),
    kycStrict: runtimeRole !== 'gateway' || !kyc.strictReadinessRequired || (
      kyc.productionBiometricsEnabled &&
      kyc.strictProductionMode &&
      kyc.awsLivenessConfigured &&
      kyc.awsLivenessCredentialsEnabled &&
      kyc.awsLivenessIdempotentRetryValid &&
      kyc.awsAssumeRoleConfigured &&
      kyc.awsAssumeRoleExternalIdConfigured &&
      kyc.awsStsSessionNamePrefixConfigured &&
      kyc.awsBaseCredentialsConfigured &&
      kyc.canonicalFaceCompareConfigured &&
      kyc.awsCompareThresholdsValid &&
      kyc.awsCostGuardEnabled &&
      kyc.awsCostLimitsValid &&
      kyc.awsCostRetentionValid &&
      kyc.awsCompareResultPersistenceValid &&
      kyc.awsCostTimeZoneUtc &&
      (kyc.faceCompareProvider !== 'aws_rekognition_compare_faces' || kyc.legacyCnhEmbeddingDisabled) &&
      kyc.requireTrustedBiometricMatch &&
      kyc.onlineGateEnabled &&
      kyc.adaptiveCadenceEnabled &&
      kyc.activeTripIndexEnabled &&
      kyc.trustPromotionRequirementsValid &&
      kyc.approvedAdaptiveCadencePolicyValid &&
      kyc.trustedRandomAuditPercentValid &&
      kyc.canonicalReferenceImageMode === 'inline_bytes' &&
      !envBool('MOBILE_FACE_EMBEDDING_ENABLED', true)
    ),
    pilotPassengerCohortConfigured: !pilotAccess.pilotControlled || pilotAccess.passengerCohortConfigured,
    pilotDriverCohortConfigured: !pilotAccess.pilotControlled || pilotAccess.driverCohortConfigured
  };

  if (pilotAccess.pilotControlled) {
    const geofenceService = require('../services/geofence-service');
    dependencies.geofenceAvailable = geofenceService.getOperationalStatus().available;
  }

  const failedDependencies = Object.entries(dependencies)
    .filter(([, ready]) => ready !== true)
    .map(([name]) => name);

  return {
    runtimeRole,
    enforced: enforceRoleReadiness,
    ready: health?.status === 'healthy' && (!enforceRoleReadiness || failedDependencies.length === 0),
    dependencies,
    failedDependencies
  };
}

async function buildRuntimeFlagsPayload() {
  const appReview = envBool('APP_REVIEW', false);
  const wooviEnvironment = String(process.env.WOOVI_ENVIRONMENT || '').trim().toLowerCase();
  const wooviBaseUrl = String(process.env.WOOVI_BASE_URL || '').trim();
  const wooviBaseUrlMode = classifyWooviBaseUrl(wooviBaseUrl);

  const requirePaymentBeforeBooking = envBool('REQUIRE_PAYMENT_BEFORE_BOOKING', true);
  const verifyPaymentBeforeBooking = envBool('VERIFY_PAYMENT_BEFORE_BOOKING', true);
  const requirePaymentChargeRefBeforeBooking = envBool('REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING', true);
  const mockPaymentForTests = envBool('MOCK_PAYMENT_FOR_TESTS', false);
  const allowReviewMockPaymentOnCreateBooking = appReview && envBool('ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING', false);
  const paymentBypassOnWooviFailure = appReview || envBool('PAYMENT_BYPASS_ON_WOOVI_FAILURE', false);
  const paymentForceBypass = appReview || envBool('PAYMENT_FORCE_BYPASS', false);
  const authTestOtpBypassEnabled = envBool('AUTH_TEST_OTP_BYPASS_ENABLED', false);
  const authReviewOtpBypassEnabled = appReview && envBool('AUTH_REVIEW_OTP_BYPASS_ENABLED', false);

  const blockers = [];
  if (wooviEnvironment !== 'sandbox') blockers.push('WOOVI_ENVIRONMENT != sandbox');
  if (wooviBaseUrlMode !== 'sandbox') blockers.push('WOOVI_BASE_URL não aponta para sandbox');
  if (!requirePaymentBeforeBooking) blockers.push('REQUIRE_PAYMENT_BEFORE_BOOKING=false');
  if (!verifyPaymentBeforeBooking) blockers.push('VERIFY_PAYMENT_BEFORE_BOOKING=false');
  if (!requirePaymentChargeRefBeforeBooking) blockers.push('REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING=false');
  if (appReview) blockers.push('APP_REVIEW=true');
  if (mockPaymentForTests) blockers.push('MOCK_PAYMENT_FOR_TESTS=true');
  if (allowReviewMockPaymentOnCreateBooking) blockers.push('ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING=true');
  if (paymentBypassOnWooviFailure) blockers.push('PAYMENT_BYPASS_ON_WOOVI_FAILURE=true');
  if (paymentForceBypass) blockers.push('PAYMENT_FORCE_BYPASS=true');
  if (authTestOtpBypassEnabled) blockers.push('AUTH_TEST_OTP_BYPASS_ENABLED=true');
  if (authReviewOtpBypassEnabled) blockers.push('AUTH_REVIEW_OTP_BYPASS_ENABLED=true');

  const redisAuthorityAttestation = await collectRedisAuthorityAttestation();
  const acceptRideAuthority = buildAcceptRideAuthoritySection(redisAuthorityAttestation);
  const kyc = buildKycSection(redisAuthorityAttestation);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    runtime: {
      nodeEnv: String(process.env.NODE_ENV || '').trim().toLowerCase() || 'unknown',
      appEnv: String(process.env.APP_ENV || '').trim().toLowerCase() || null,
      leafEnv: String(process.env.LEAF_ENV || '').trim().toLowerCase() || null,
      runtimeRole: String(process.env.RUNTIME_ROLE || 'gateway').trim().toLowerCase(),
      appVersion: String(process.env.APP_VERSION || '').trim() || null
    },
    woovi: {
      environment: wooviEnvironment || 'unknown',
      baseUrlConfigured: Boolean(wooviBaseUrl),
      baseUrlMode: wooviBaseUrlMode
    },
    firebase: buildFirebaseSection(),
    push: buildPushSection(),
    acceptRideAuthority,
    kyc,
    maps: buildMapsSection(),
    pricing: {
      demandPressureMode: String(process.env.PRICING_DEMAND_PRESSURE_MODE || 'dry_run')
        .trim()
        .toLowerCase(),
      trafficPricing: 'traffic_aware_time_component',
      heatmapSource: 'leaf_internal_supply_demand',
      driverTrafficLayerEnabled: envBool('ENABLE_DRIVER_TRAFFIC_LAYER', true)
    },
    socket: buildSocketSection(),
    guards: {
      appReview,
      requirePaymentBeforeBooking,
      verifyPaymentBeforeBooking,
      requirePaymentChargeRefBeforeBooking,
      mockPaymentForTests,
      allowReviewMockPaymentOnCreateBooking,
      paymentBypassOnWooviFailure,
      paymentForceBypass,
      authTestOtpBypassEnabled,
      authReviewOtpBypassEnabled
    },
    launch: getPilotLaunchFlags(),
    realSandbox: {
      ready: blockers.length === 0,
      blockers
    }
  };
}

/**
 * GET /health
 * Health check completo (todos os componentes)
 */
async function fullHealthHandler(req, res) {
  try {
    // Obter io do contexto global
    const io = global.io || null;
    const health = await healthCheckService.runAllChecks(io);
    
    // Retornar status HTTP apropriado
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'warning' ? 200 : 
                      health.status === 'degraded' ? 503 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    logError(error, 'Erro ao executar health checks', {
      service: 'health-routes',
      operation: 'full-check'
    });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Erro ao verificar saúde do sistema'
    });
  }
}

router.get('/health', fullHealthHandler);
router.get('/api/health', fullHealthHandler);

/**
 * GET /health/quick
 * Health check rápido (apenas críticos)
 */
router.get('/health/quick', async (req, res) => {
  try {
    const health = await healthCheckService.quickCheck();
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logError(error, 'Erro ao executar health check rápido', {
      service: 'health-routes',
      operation: 'quick-check'
    });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Erro ao verificar saúde do sistema'
    });
  }
});

/**
 * GET /health/readiness
 * Readiness probe (Kubernetes/Docker)
 */
router.get('/health/readiness', async (req, res) => {
  try {
    const health = await healthCheckService.quickCheck();
    const roleReadiness = await buildRoleReadiness(health);

    if (roleReadiness.ready) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        ...roleReadiness
      });
    } else {
      res.status(503).json({
        status: 'not-ready',
        timestamp: new Date().toISOString(),
        reason: 'Critical services or runtime-role dependencies are not ready',
        ...roleReadiness
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not-ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * GET /health/liveness
 * Liveness probe (Kubernetes/Docker)
 */
router.get('/health/liveness', (req, res) => {
  // Liveness é sempre OK se o processo está rodando
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /health/runtime-flags
 * Diagnóstico seguro de flags de runtime para execução de testes real-sandbox.
 */
router.get('/health/runtime-flags', async (req, res) => {
  res.status(200).json(await buildRuntimeFlagsPayload());
});

router.get('/api/health/runtime-flags', async (req, res) => {
  res.status(200).json(await buildRuntimeFlagsPayload());
});

module.exports = router;
