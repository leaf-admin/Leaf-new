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
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'sim']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'nao', 'não']);

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

function buildKycSection() {
  return {
    configured: presence('KYC_PRODUCTION_BIOMETRICS_ENABLED') || presence('KYC_AWS_LIVENESS_ENABLED'),
    productionBiometricsEnabled: envBool('KYC_PRODUCTION_BIOMETRICS_ENABLED', false),
    awsLivenessConfigured: envBool('KYC_AWS_LIVENESS_ENABLED', false) || envBool('AWS_LIVENESS_ENABLED', false),
    faceServiceConfigured: presence('BIOMETRIC_FACE_SERVICE_URL'),
    cnhFaceBiometricsConfigured: envBool('ENABLE_CNH_FACE_BIOMETRICS', false),
    requireTrustedBiometricMatch: envBool('KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH', false)
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

function buildRoleReadiness(health) {
  const runtimeRole = String(process.env.RUNTIME_ROLE || 'gateway').trim().toLowerCase();
  const enforceRoleReadiness =
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ||
    envBool('HEALTH_ENFORCE_ROLE_READINESS', false);
  const firebase = buildFirebaseSection();
  const push = buildPushSection();
  const kyc = buildKycSection();
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
    kycStrict: runtimeRole !== 'gateway' || (
      kyc.productionBiometricsEnabled &&
      kyc.awsLivenessConfigured &&
      kyc.faceServiceConfigured &&
      kyc.requireTrustedBiometricMatch &&
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

function buildRuntimeFlagsPayload() {
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
    kyc: buildKycSection(),
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
    const roleReadiness = buildRoleReadiness(health);

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
router.get('/health/runtime-flags', (req, res) => {
  res.status(200).json(buildRuntimeFlagsPayload());
});

router.get('/api/health/runtime-flags', (req, res) => {
  res.status(200).json(buildRuntimeFlagsPayload());
});

module.exports = router;
