#!/usr/bin/env node
/**
 * Runtime config validator for soft release.
 * - Confirma separação sandbox/prod para Woovi
 * - Valida presença das variáveis críticas de pagamento/pix
 * - Exibe alertas de CORS e OTEL
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const {
  evaluateProductionReadiness
} = require('../../services/kyc-biometric-production-policy');
const {
  getDefaultWooviWebhookPublicKey
} = require('../../config/woovi-webhook-public-key');
const {
  DEFAULT_POLICY: DEFAULT_RIDE_FINANCIAL_POLICY,
  describeFinancialPolicy
} = require('../../services/ride-financial-contract');
const {
  getDriverSearchMaxRadiusKm,
  getOperationsPolicyRadiusKm,
  getPaymentAvailabilityRadiusKm
} = require('../../utils/dispatch-config');
const { resolveLaunchProfile } = require('../../utils/pilot-launch-flags');
const { parseAllowlist } = require('../../services/pilot-access-control-service');

const REQUIRED_BASE = [
  'NODE_ENV'
];

const REQUIRED_PAYMENT_PROVIDER = [
  'WOOVI_ENVIRONMENT',
  'WOOVI_BASE_URL',
  'WOOVI_API_TOKEN'
];

const REQUIRED_PROD_PAYMENT_PROVIDER = [
  'LEAF_PIX_KEY'
];

const OPTIONAL_RECOMMENDED = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'CORS_ORIGIN',
  'ALLOW_PRIVATE_CORS',
  'ALLOW_NGROK_CORS',
  'REQUIRE_SOCKETIO_REDIS_ADAPTER'
];

const WEBHOOK_VERIFIER_KEYS = [
  'WOOVI_WEBHOOK_PUBLIC_KEY',
  'OPENPIX_WEBHOOK_PUBLIC_KEY',
  'WOOVI_WEBHOOK_SIGNATURE_SECRET',
  'OPENPIX_WEBHOOK_SIGNATURE_SECRET',
  'WOOVI_WEBHOOK_HMAC_SECRET',
  'OPENPIX_WEBHOOK_HMAC_SECRET'
];

const WEBHOOK_AUTHORIZATION_KEYS = [
  'WOOVI_WEBHOOK_AUTHORIZATION',
  'OPENPIX_WEBHOOK_AUTHORIZATION',
  'WOOVI_WEBHOOK_AUTH_TOKEN',
  'OPENPIX_WEBHOOK_AUTH_TOKEN'
];

const PAYMENT_BYPASS_FLAGS = [
  'PAYMENT_BYPASS_ON_WOOVI_FAILURE',
  'PAYMENT_FORCE_BYPASS',
  'FORCE_PAYMENT_BYPASS',
  'EXPO_PUBLIC_FORCE_PAYMENT_BYPASS',
  'EXPO_PUBLIC_BYPASS_PAYMENTS'
];

const LEGACY_RUNTIME_FLAGS = [
  'ENABLE_LEGACY_RUNTIME_ENDPOINTS',
  'ENABLE_LEGACY_SOCKET_BRIDGE',
  'ENABLE_LEGACY_SOCKET_NOTIFICATIONS',
  'ENABLE_LEGACY_NO_DRIVERS_FOUND_EVENT',
  'ENABLE_LEGACY_UPDATE_DRIVER_LOCATION_EVENT',
  'ENABLE_LEGACY_DRIVER_BAAS_FALLBACK'
];

const CORE_RIDE_PAYMENT_GUARD_FLAGS = [
  {
    key: 'REQUIRE_PAYMENT_QUOTE_LOCK',
    expected: true,
    fallback: true,
    blocker: 'REQUIRE_PAYMENT_QUOTE_LOCK=false bloqueado em produção'
  },
  {
    key: 'REQUIRE_PAYMENT_BEFORE_BOOKING',
    expected: true,
    fallback: true,
    blocker: 'REQUIRE_PAYMENT_BEFORE_BOOKING=false bloqueado em produção'
  },
  {
    key: 'VERIFY_PAYMENT_BEFORE_BOOKING',
    expected: true,
    fallback: true,
    blocker: 'VERIFY_PAYMENT_BEFORE_BOOKING=false bloqueado em produção'
  },
  {
    key: 'REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING',
    expected: true,
    fallback: true,
    blocker: 'REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING=false bloqueado em produção'
  },
  {
    key: 'CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK',
    expected: false,
    fallback: false,
    blocker: 'CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK=true bloqueado em produção'
  },
  {
    key: 'ENFORCE_PAYMENT_FARE_LOCK',
    expected: true,
    fallback: true,
    blocker: 'ENFORCE_PAYMENT_FARE_LOCK=false bloqueado em produção'
  },
  {
    key: 'REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH',
    expected: true,
    fallback: true,
    blocker: 'REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH=false bloqueado em produção'
  }
];

const PAYMENT_PROVIDER_ROLES = new Set([
  'gateway',
  'billing',
  'payment',
  'payments'
]);
const APPROVED_DRIVER_SEARCH_RADIUS_KM = 5;

function presence(value) {
  const raw = String(value || '').trim();
  if (!raw) return '(empty)';
  return 'present';
}

function checkRequired(keys) {
  const missing = [];
  for (const key of keys) {
    if (!String(process.env[key] || '').trim()) {
      missing.push(key);
    }
  }
  return missing;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function readBooleanLike(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function booleanDiagnostic(name, fallback = false) {
  const raw = process.env[name];
  const configured = raw != null && String(raw).trim() !== '';

  return {
    value: readBooleanLike(raw, fallback),
    source: configured ? 'env' : 'default'
  };
}

function requiresPaymentProviderConfig(runtimeRole) {
  if (boolEnv('RUNTIME_REQUIRES_PAYMENT_CONFIG', false)) {
    return true;
  }
  return PAYMENT_PROVIDER_ROLES.has(String(runtimeRole || '').trim().toLowerCase());
}

function resolveFinancialPolicyApproval() {
  const activePolicy = describeFinancialPolicy(DEFAULT_RIDE_FINANCIAL_POLICY);
  const approvedPolicyId = String(process.env.LEAF_APPROVED_FINANCIAL_POLICY_ID || '').trim();
  const approvalReference = String(process.env.LEAF_FINANCIAL_POLICY_APPROVAL_REF || '').trim();
  const approvalActor = String(process.env.LEAF_FINANCIAL_POLICY_APPROVAL_ACTOR || '').trim();

  return {
    activePolicy,
    approvedPolicyId: approvedPolicyId || '(empty)',
    approvalReferenceConfigured: presence(approvalReference),
    approvalActorConfigured: presence(approvalActor),
    approved:
      approvedPolicyId === activePolicy.policyId &&
      Boolean(approvalReference)
  };
}

function numberMatches(value, expected) {
  return Math.abs(Number(value) - Number(expected)) < 0.000001;
}

function collectGeofenceRings(value) {
  if (!value) return [];
  if (value.type === 'FeatureCollection') {
    return (value.features || []).flatMap((feature) => collectGeofenceRings(feature));
  }
  if (value.type === 'Feature') return collectGeofenceRings(value.geometry);
  if (value.type === 'Polygon') return value.coordinates?.[0] ? [value.coordinates[0]] : [];
  if (value.type === 'MultiPolygon') {
    return (value.coordinates || []).map((polygon) => polygon?.[0]).filter(Boolean);
  }
  if (!Array.isArray(value) || value.length === 0) return [];
  if (Array.isArray(value[0]) && Number.isFinite(Number(value[0][0]))) return [value];
  return value;
}

function resolveGeofenceRegionDiagnostic() {
  const raw = String(process.env.GEOFENCE_REGION || '').trim();
  const configuredFile = String(process.env.GEOFENCE_REGION_FILE || '').trim();
  const defaultFile = path.resolve(__dirname, '../../config/geofence.json');
  const filePath = configuredFile
    ? path.resolve(__dirname, '../..', configuredFile)
    : defaultFile;

  try {
    const parsed = raw
      ? JSON.parse(raw)
      : (fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null);
    if (!parsed) {
      return { configured: false, valid: false, polygons: 0, points: 0, source: 'none' };
    }

    const rings = collectGeofenceRings(parsed);
    const valid = rings.length > 0 && rings.every((ring) => {
      if (!Array.isArray(ring) || ring.length < 3) return false;
      return ring.every((point) => {
        const lng = Array.isArray(point) ? Number(point[0]) : Number(point?.lng);
        const lat = Array.isArray(point) ? Number(point[1]) : Number(point?.lat);
        return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
      });
    });
    const metadata = parsed.metadata || parsed.features?.[0]?.properties || parsed.properties || {};
    return {
      configured: true,
      valid,
      polygons: rings.length,
      points: rings.reduce((total, ring) => total + ring.length, 0),
      source: raw ? 'env' : 'file',
      file: raw ? null : path.relative(path.resolve(__dirname, '../..'), filePath),
      version: metadata.policyId || metadata.version || null,
      updatedAt: metadata.generatedAt || metadata.updatedAt || null
    };
  } catch (_error) {
    return {
      configured: Boolean(raw || configuredFile),
      valid: false,
      polygons: 0,
      points: 0,
      source: raw ? 'env' : (configuredFile ? 'file' : 'none')
    };
  }
}

function resolveLaunchControlDiagnostic() {
  const launchProfile = resolveLaunchProfile();
  const geofenceValidation = launchProfile === 'geofence_validation';
  const rideFlowValidation = launchProfile === 'ride_flow_validation';
  const pilotControlled = ['pilot_controlled', 'geofence_validation', 'ride_flow_validation'].includes(launchProfile) || boolEnv('LEAF_PILOT_CONTROLLED', false);
  const passengerCohortSize = parseAllowlist(
    process.env.PILOT_ALLOWED_PASSENGER_IDS || process.env.LEAF_PILOT_ALLOWED_PASSENGER_IDS
  ).size;
  const driverCohortSize = parseAllowlist(
    process.env.PILOT_ALLOWED_DRIVER_IDS || process.env.LEAF_PILOT_ALLOWED_DRIVER_IDS
  ).size;

  return {
    launchProfile,
    pilotControlled,
    geofenceValidation,
    rideFlowValidation,
    broadLaunchApproved: boolEnv('LEAF_BROAD_LAUNCH_APPROVED', false),
    passengerCohortSize,
    driverCohortSize,
    acceptNewPix: booleanDiagnostic('LEAF_ACCEPT_NEW_PIX', true),
    acceptNewBookings: booleanDiagnostic('LEAF_ACCEPT_NEW_BOOKINGS', true),
    geofenceFailClosed: booleanDiagnostic('GEOFENCE_FAIL_CLOSED', true),
    geofenceRegion: resolveGeofenceRegionDiagnostic(),
    runtimePolicyVersionConfigured: presence(process.env.LEAF_RUNTIME_POLICY_VERSION)
  };
}

function resolveDriverSearchRadiusPolicy() {
  const dispatchMaxRadiusKm = getDriverSearchMaxRadiusKm();
  const paymentAvailabilityRadiusKm = getPaymentAvailabilityRadiusKm();
  const operationsPolicyRadiusKm = getOperationsPolicyRadiusKm();

  return {
    approvedRadiusKm: APPROVED_DRIVER_SEARCH_RADIUS_KM,
    dispatchMaxRadiusKm,
    paymentAvailabilityRadiusKm,
    operationsPolicyRadiusKm,
    ok:
      numberMatches(dispatchMaxRadiusKm, APPROVED_DRIVER_SEARCH_RADIUS_KM) &&
      numberMatches(paymentAvailabilityRadiusKm, APPROVED_DRIVER_SEARCH_RADIUS_KM) &&
      numberMatches(operationsPolicyRadiusKm, APPROVED_DRIVER_SEARCH_RADIUS_KM)
  };
}

function resolveEnvPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

function loadRuntimeEnv() {
  const loadedFiles = [];
  const backendRoot = path.resolve(__dirname, '..', '..');
  const explicitEnvFile = resolveEnvPath(process.env.ENV_FILE);

  const safeLoad = (filePath, override = false) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }
    dotenv.config({ path: filePath, override });
    loadedFiles.push(filePath);
  };

  if (explicitEnvFile) {
    safeLoad(explicitEnvFile, true);
    return loadedFiles;
  }

  // Alinhado ao server.js: por padrão valida o mesmo .env carregado na inicialização.
  safeLoad(path.join(backendRoot, '.env'), false);
  safeLoad(path.join(backendRoot, `.env.${String(process.env.NODE_ENV || 'production').toLowerCase()}`), false);
  return loadedFiles;
}

function resolveFirebaseDatabaseUrl({ allowDefault = false } = {}) {
  return String(
    process.env.FIREBASE_DATABASE_URL ||
      (allowDefault ? 'https://leaf-reactnative-default-rtdb.firebaseio.com' : '')
  ).trim();
}

function resolveFirebaseCredentialPath({ allowLocalDefault = false } = {}) {
  const backendRoot = path.resolve(__dirname, '..', '..');
  const configuredPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  const candidates = [
    configuredPath,
    ...(allowLocalDefault
      ? [
          path.join(backendRoot, 'firebase-credentials.json'),
          path.join(backendRoot, 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json')
        ]
      : [])
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(resolveEnvPath(candidate))) || '';
}

function hasFirebaseServiceAccountConfigured({ allowLocalDefault = false } = {}) {
  return Boolean(
    String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim() ||
      String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '').trim() ||
      resolveFirebaseCredentialPath({ allowLocalDefault })
  );
}

function hasLegacyFcmServerKeyConfigured() {
  return Boolean(String(process.env.FCM_SERVER_KEY || '').trim());
}

function hasApnsPrivateKeyConfigured() {
  return Boolean(
    String(process.env.LEAF_APNS_PRIVATE_KEY || '').trim() ||
      String(process.env.LEAF_APNS_PRIVATE_KEY_PATH || '').trim()
  );
}

function main() {
  const envFilesLoaded = loadRuntimeEnv();
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const wooviEnv = String(process.env.WOOVI_ENVIRONMENT || '').toLowerCase();
  const baseUrl = String(process.env.WOOVI_BASE_URL || '');
  const wooviBaseUrlIsSandbox = /sandbox/i.test(baseUrl);
  const runtimeRole = String(process.env.RUNTIME_ROLE || 'gateway').trim().toLowerCase();
  const allowLocalFirebaseDefaults = !process.env.ENV_FILE;
  const firebaseDatabaseUrl = resolveFirebaseDatabaseUrl({
    allowDefault: allowLocalFirebaseDefaults
  });
  const firebaseServiceAccountConfigured = hasFirebaseServiceAccountConfigured({
    allowLocalDefault: allowLocalFirebaseDefaults
  });
  const legacyFcmServerKeyConfigured = hasLegacyFcmServerKeyConfigured();
  const fcmConfigured = firebaseServiceAccountConfigured || legacyFcmServerKeyConfigured;
  const apnsLiveActivityConfigured = Boolean(
    String(process.env.LEAF_APNS_KEY_ID || '').trim() &&
      String(process.env.LEAF_APNS_TEAM_ID || '').trim() &&
      hasApnsPrivateKeyConfigured()
  );
  const paymentProviderConfigRequired = requiresPaymentProviderConfig(runtimeRole);
  const paymentProviderSandboxRuntime =
    paymentProviderConfigRequired && (wooviEnv === 'sandbox' || wooviBaseUrlIsSandbox);
  const financialPolicyApproval = resolveFinancialPolicyApproval();
  const driverSearchRadiusPolicy = resolveDriverSearchRadiusPolicy();
  const launchControlDiagnostic = resolveLaunchControlDiagnostic();

  const missingCommon = checkRequired([
    ...REQUIRED_BASE,
    ...(paymentProviderConfigRequired ? REQUIRED_PAYMENT_PROVIDER : [])
  ]);
  const missingProd = nodeEnv === 'production' && paymentProviderConfigRequired
    ? checkRequired(REQUIRED_PROD_PAYMENT_PROVIDER)
    : [];
  const warnings = [];
  const blockers = [];
  const hasDefaultWooviWebhookPublicKey =
    nodeEnv === 'production' &&
    !paymentProviderSandboxRuntime &&
    Boolean(getDefaultWooviWebhookPublicKey());
  const webhookVerifierKeysPresent = WEBHOOK_VERIFIER_KEYS.filter((key) => String(process.env[key] || '').trim());
  const effectiveWebhookVerifierKeysPresent = hasDefaultWooviWebhookPublicKey
    ? [...webhookVerifierKeysPresent, 'WOOVI_WEBHOOK_PUBLIC_KEY(default)']
    : webhookVerifierKeysPresent;
  const hasWebhookVerifier = effectiveWebhookVerifierKeysPresent.length > 0;
  const explicitWebhookPublicKey = process.env.WOOVI_WEBHOOK_PUBLIC_KEY || process.env.OPENPIX_WEBHOOK_PUBLIC_KEY;
  const webhookAuthorizationKeysPresent = WEBHOOK_AUTHORIZATION_KEYS.filter((key) => String(process.env[key] || '').trim());
  const hasWebhookAuthorization = webhookAuthorizationKeysPresent.length > 0;
  const webhookRequireSignature = booleanDiagnostic(
    'WOOVI_WEBHOOK_REQUIRE_SIGNATURE',
    hasWebhookVerifier
  );
  const webhookAllowUnsigned = booleanDiagnostic(
    'WOOVI_WEBHOOK_ALLOW_UNSIGNED',
    !hasWebhookVerifier
  );
  const webhookProviderVerificationRequired = booleanDiagnostic(
    'WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED',
    true
  );
  const paymentBypassDiagnostics = PAYMENT_BYPASS_FLAGS.reduce((acc, key) => {
    acc[key] = booleanDiagnostic(key, false);
    return acc;
  }, {});
  const biometricReadiness = evaluateProductionReadiness(process.env);
  const legacyRuntimeDiagnostics = LEGACY_RUNTIME_FLAGS.reduce((acc, key) => {
    acc[key] = booleanDiagnostic(key, false);
    return acc;
  }, {});
  const coreRidePaymentGuardDiagnostics = CORE_RIDE_PAYMENT_GUARD_FLAGS.reduce((acc, guard) => {
    acc[guard.key] = {
      ...booleanDiagnostic(guard.key, guard.fallback),
      expected: guard.expected
    };
    return acc;
  }, {});
  const socketRedisAdapterDiagnostic = booleanDiagnostic('ENABLE_SOCKETIO_REDIS_ADAPTER', true);
  const socketRedisAdapterRequiredDiagnostic = booleanDiagnostic(
    'REQUIRE_SOCKETIO_REDIS_ADAPTER',
    nodeEnv === 'production' && runtimeRole === 'gateway'
  );
  const authOtpDiagnostics = {
    customOtpRouteMounted: true,
    productionNonBypassMode:
      nodeEnv === 'production'
        ? 'fail_closed_without_real_provider'
        : 'redis_simulated_delivery',
    debugOtp: booleanDiagnostic('DEBUG_OTP', false),
    testBypass: booleanDiagnostic('AUTH_TEST_OTP_BYPASS_ENABLED', false),
    reviewBypass: booleanDiagnostic('AUTH_REVIEW_OTP_BYPASS_ENABLED', false)
  };
  const webhookProviderVerificationFallback =
    !hasWebhookVerifier &&
    (hasWebhookAuthorization || paymentProviderSandboxRuntime) &&
    !webhookRequireSignature.value &&
    webhookAllowUnsigned.value &&
    webhookProviderVerificationRequired.value;

  if (paymentProviderConfigRequired && wooviEnv === 'sandbox' && /api\.woovi\.com/i.test(baseUrl) && !/sandbox/i.test(baseUrl)) {
    warnings.push('WOOVI_ENVIRONMENT=sandbox com base URL de produção detectada');
  }

  if (paymentProviderConfigRequired && wooviEnv === 'production' && /sandbox/i.test(baseUrl)) {
    warnings.push('WOOVI_ENVIRONMENT=production com base URL sandbox detectada');
  }

  if (nodeEnv === 'production' && paymentProviderConfigRequired && wooviEnv !== 'production') {
    warnings.push('NODE_ENV=production está usando WOOVI_ENVIRONMENT diferente de production');
  }

  if (nodeEnv === 'production') {
    const geofenceRadiusKm = Number.parseFloat(process.env.GEOFENCE_RADIUS_KM || '');
    const corsOrigin = String(process.env.CORS_ORIGIN || '').trim();

    if (boolEnv('APP_REVIEW')) {
      blockers.push('APP_REVIEW=true não pode ir para produção pública normal');
    }
    if (!launchControlDiagnostic.pilotControlled && !launchControlDiagnostic.broadLaunchApproved) {
      blockers.push('Produção exige perfil pilot_controlled ou LEAF_BROAD_LAUNCH_APPROVED=true após o GO formal');
    }
    if (launchControlDiagnostic.pilotControlled) {
      if (launchControlDiagnostic.passengerCohortSize < 1) {
        blockers.push('PILOT_ALLOWED_PASSENGER_IDS deve conter o cohort autorizado do piloto');
      }
      if (launchControlDiagnostic.driverCohortSize < 1) {
        blockers.push('PILOT_ALLOWED_DRIVER_IDS deve conter o cohort autorizado do piloto');
      }
      if (!launchControlDiagnostic.geofenceFailClosed.value) {
        blockers.push('GEOFENCE_FAIL_CLOSED=false bloqueado no perfil piloto');
      }
      if (!launchControlDiagnostic.geofenceRegion.valid) {
        blockers.push('GEOFENCE_REGION ausente ou inválido: o piloto exige polígono operacional aprovado');
      }
      if (launchControlDiagnostic.runtimePolicyVersionConfigured === '(empty)') {
        blockers.push('LEAF_RUNTIME_POLICY_VERSION obrigatório no perfil piloto');
      }
    }
    if (launchControlDiagnostic.geofenceValidation) {
      if (launchControlDiagnostic.acceptNewPix.value) {
        blockers.push('LEAF_ACCEPT_NEW_PIX=true bloqueado no perfil geofence_validation');
      }
      if (launchControlDiagnostic.acceptNewBookings.value) {
        blockers.push('LEAF_ACCEPT_NEW_BOOKINGS=true bloqueado no perfil geofence_validation');
      }
    }
    if (launchControlDiagnostic.rideFlowValidation) {
      if (!boolEnv('LEAF_RIDE_FLOW_VALIDATION_ACK', false)) {
        blockers.push('LEAF_RIDE_FLOW_VALIDATION_ACK=true obrigatório no perfil ride_flow_validation');
      }
      if (launchControlDiagnostic.passengerCohortSize !== 1) {
        blockers.push('ride_flow_validation exige exatamente 1 passageiro na allowlist');
      }
      if (launchControlDiagnostic.driverCohortSize !== 1) {
        blockers.push('ride_flow_validation exige exatamente 1 motorista na allowlist');
      }
      if (!launchControlDiagnostic.acceptNewPix.value) {
        blockers.push('LEAF_ACCEPT_NEW_PIX=true obrigatório no perfil ride_flow_validation');
      }
      if (!launchControlDiagnostic.acceptNewBookings.value) {
        blockers.push('LEAF_ACCEPT_NEW_BOOKINGS=true obrigatório no perfil ride_flow_validation');
      }
    }
    if (boolEnv('BYPASS_GEOFENCE')) {
      blockers.push('BYPASS_GEOFENCE=true bloqueado em produção');
    }
    if (Number.isFinite(geofenceRadiusKm) && geofenceRadiusKm >= 100) {
      blockers.push(`GEOFENCE_RADIUS_KM=${geofenceRadiusKm} abre demais a operação em produção`);
    }
    if (
      paymentProviderConfigRequired &&
      !hasWebhookVerifier &&
      !hasWebhookAuthorization &&
      !paymentProviderSandboxRuntime
    ) {
      blockers.push('Webhook Woovi/OpenPix em produção exige Authorization configurado no webhook (WOOVI_WEBHOOK_AUTHORIZATION/WOOVI_WEBHOOK_AUTH_TOKEN) ou verificação por assinatura pública quando disponível');
    }
    if (
      paymentProviderSandboxRuntime &&
      !hasWebhookVerifier &&
      webhookRequireSignature.value
    ) {
      blockers.push('WOOVI_WEBHOOK_REQUIRE_SIGNATURE=false obrigatório no sandbox sem verificador');
    }
    if (
      paymentProviderSandboxRuntime &&
      !hasWebhookVerifier &&
      !webhookAllowUnsigned.value
    ) {
      blockers.push('WOOVI_WEBHOOK_ALLOW_UNSIGNED=true obrigatório no sandbox sem verificador');
    }
    if (
      paymentProviderSandboxRuntime &&
      !hasWebhookVerifier &&
      !webhookProviderVerificationRequired.value
    ) {
      blockers.push('WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=true obrigatório no sandbox sem verificador');
    }
    if (
      paymentProviderConfigRequired &&
      !paymentProviderSandboxRuntime &&
      hasWebhookVerifier &&
      !webhookRequireSignature.value
    ) {
      blockers.push('WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true obrigatório em produção');
    }
    if (
      paymentProviderConfigRequired &&
      !paymentProviderSandboxRuntime &&
      hasWebhookVerifier &&
      webhookAllowUnsigned.value
    ) {
      blockers.push('WOOVI_WEBHOOK_ALLOW_UNSIGNED=false obrigatório em produção');
    }
    if (
      paymentProviderConfigRequired &&
      !paymentProviderSandboxRuntime &&
      !hasWebhookVerifier &&
      hasWebhookAuthorization &&
      !webhookProviderVerificationFallback
    ) {
      blockers.push('Webhook Woovi sem assinatura local em produção exige WOOVI_WEBHOOK_REQUIRE_SIGNATURE=false, WOOVI_WEBHOOK_ALLOW_UNSIGNED=true e WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=true');
    }
    if (paymentProviderConfigRequired && !webhookProviderVerificationRequired.value) {
      warnings.push('WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=false remove conferência complementar no provedor');
    }
    if (boolEnv('ENABLE_MANUAL_PAYMENT_CONFIRMATION')) {
      blockers.push('ENABLE_MANUAL_PAYMENT_CONFIRMATION=true bloqueado em produção');
    }
    if (boolEnv('ENABLE_LEGACY_MANUAL_PAYMENT_DISTRIBUTION')) {
      blockers.push('ENABLE_LEGACY_MANUAL_PAYMENT_DISTRIBUTION=true bloqueado em produção');
    }
    if (boolEnv('ENABLE_DASHBOARD_MOCK_ENDPOINTS')) {
      blockers.push('ENABLE_DASHBOARD_MOCK_ENDPOINTS=true bloqueado em produção');
    }
    if (runtimeRole === 'gateway' && !socketRedisAdapterDiagnostic.value) {
      blockers.push('ENABLE_SOCKETIO_REDIS_ADAPTER=false bloqueado em produção para runtime gateway');
    }
    if (runtimeRole === 'gateway' && !socketRedisAdapterRequiredDiagnostic.value) {
      warnings.push('REQUIRE_SOCKETIO_REDIS_ADAPTER=false reduz garantia de escala horizontal do websocket');
    }
    for (const key of PAYMENT_BYPASS_FLAGS) {
      if (paymentBypassDiagnostics[key].value) {
        blockers.push(`${key}=true bloqueado em produção`);
      }
    }
    for (const key of LEGACY_RUNTIME_FLAGS) {
      if (legacyRuntimeDiagnostics[key].value) {
        blockers.push(`${key}=true bloqueado em produção`);
      }
    }
    for (const guard of CORE_RIDE_PAYMENT_GUARD_FLAGS) {
      if (coreRidePaymentGuardDiagnostics[guard.key].value !== guard.expected) {
        blockers.push(guard.blocker);
      }
    }
    if (boolEnv('MOCK_PAYMENT_FOR_TESTS')) {
      blockers.push('MOCK_PAYMENT_FOR_TESTS=true bloqueado em produção');
    }
    if (!driverSearchRadiusPolicy.ok) {
      blockers.push(
        `Raio de busca de motorista deve permanecer em ${APPROVED_DRIVER_SEARCH_RADIUS_KM}km geográficos em produção (dispatch=${driverSearchRadiusPolicy.dispatchMaxRadiusKm}, payment=${driverSearchRadiusPolicy.paymentAvailabilityRadiusKm}, operations=${driverSearchRadiusPolicy.operationsPolicyRadiusKm})`
      );
    }
    if (
      paymentProviderConfigRequired &&
      !financialPolicyApproval.approved
    ) {
      blockers.push(
        `Política financeira ativa sem aprovação explícita: defina LEAF_APPROVED_FINANCIAL_POLICY_ID=${financialPolicyApproval.activePolicy.policyId} e LEAF_FINANCIAL_POLICY_APPROVAL_REF antes de produção`
      );
    }
    if (authOtpDiagnostics.debugOtp.value) {
      blockers.push('DEBUG_OTP=true bloqueado em produção');
    }
    if (boolEnv('AUTH_TEST_OTP_BYPASS_ENABLED')) {
      blockers.push('AUTH_TEST_OTP_BYPASS_ENABLED=true bloqueado em produção');
    }
    if (boolEnv('AUTH_REVIEW_OTP_BYPASS_ENABLED') && !boolEnv('APP_REVIEW')) {
      blockers.push('AUTH_REVIEW_OTP_BYPASS_ENABLED=true sem APP_REVIEW não é permitido');
    }
    if (boolEnv('ALLOW_LOCAL_CORS')) {
      blockers.push('CORS local/expo habilitado bloqueado em produção');
    }
    if (boolEnv('ALLOW_NGROK_CORS') || boolEnv('ALLOW_PRIVATE_CORS')) {
      blockers.push('CORS privado/ngrok habilitado bloqueado em produção');
    }
    if (corsOrigin === '*' || /localhost|127\.0\.0\.1|ngrok|trycloudflare/i.test(corsOrigin)) {
      blockers.push(`CORS_ORIGIN inseguro para produção: ${corsOrigin || '(vazio)'}`);
    }

    if (!firebaseDatabaseUrl) {
      warnings.push('FIREBASE_DATABASE_URL ausente: Realtime Database pode falhar em produção');
    }
    if (!firebaseServiceAccountConfigured) {
      warnings.push('Credenciais Firebase ausentes (FIREBASE_SERVICE_ACCOUNT_JSON ou GOOGLE_APPLICATION_CREDENTIALS): admin SDK pode falhar');
    }
    if (!String(process.env.GOOGLE_MAPS_API_KEY || '').trim()) {
      warnings.push('GOOGLE_MAPS_API_KEY ausente: Places/receipt mapas podem falhar em produção');
    }
    if (
      boolEnv('EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK') ||
      boolEnv('ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK')
    ) {
      blockers.push('EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK=true bloqueado em produção: client-side Google fallback expõe chave de API');
    }

    blockers.push(...biometricReadiness.blockers);
    warnings.push(...biometricReadiness.warnings);

    if (boolEnv('PROMOTIONS_ENABLE_LEGACY_RTDB_MIRROR')) {
      warnings.push('PROMOTIONS_ENABLE_LEGACY_RTDB_MIRROR=true mantém dual-write legado em produção');
    }
    if (boolEnv('REFERRAL_PROGRAMS_ENABLE_LEGACY_RTDB_MIRROR')) {
      warnings.push('REFERRAL_PROGRAMS_ENABLE_LEGACY_RTDB_MIRROR=true mantém dual-write legado em produção');
    }
    if (boolEnv('ENABLE_LEGACY_PROFILE_RTDB_MIRROR')) {
      warnings.push('ENABLE_LEGACY_PROFILE_RTDB_MIRROR=true mantém espelho de perfil no RTDB em produção');
    }
  }

  const report = {
    ok: missingCommon.length === 0 && missingProd.length === 0 && blockers.length === 0,
    envFilesLoaded,
    nodeEnv,
    wooviEnv,
    baseUrl,
    summary: {
      missingCommon,
      missingProd,
      blockers,
      warnings
    },
    sensitivePresence: {
      WOOVI_API_TOKEN: presence(process.env.WOOVI_API_TOKEN),
      WOOVI_WEBHOOK_PUBLIC_KEY: explicitWebhookPublicKey
        ? presence(explicitWebhookPublicKey)
        : (hasDefaultWooviWebhookPublicKey ? 'default-public' : '(empty)'),
      WOOVI_WEBHOOK_SIGNATURE_SECRET: presence(process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET || process.env.OPENPIX_WEBHOOK_SIGNATURE_SECRET),
      WOOVI_WEBHOOK_HMAC_SECRET: presence(process.env.WOOVI_WEBHOOK_HMAC_SECRET || process.env.OPENPIX_WEBHOOK_HMAC_SECRET),
      WOOVI_WEBHOOK_AUTHORIZATION: presence(
        process.env.WOOVI_WEBHOOK_AUTHORIZATION ||
        process.env.OPENPIX_WEBHOOK_AUTHORIZATION ||
        process.env.WOOVI_WEBHOOK_AUTH_TOKEN ||
        process.env.OPENPIX_WEBHOOK_AUTH_TOKEN
      ),
      LEAF_PIX_KEY: presence(process.env.LEAF_PIX_KEY)
    },
    diagnostics: {
      biometricReadiness,
      webhookSignature: {
        verifierKeysPresent: effectiveWebhookVerifierKeysPresent,
        hasVerifier: hasWebhookVerifier,
        authorizationKeysPresent: webhookAuthorizationKeysPresent,
        hasAuthorization: hasWebhookAuthorization,
        providerVerificationFallback: webhookProviderVerificationFallback,
        requireSignature: {
          ...webhookRequireSignature,
          expected: hasWebhookVerifier && !paymentProviderSandboxRuntime
        },
        allowUnsigned: {
          ...webhookAllowUnsigned,
          expected: !hasWebhookVerifier
        },
        providerVerificationRequired: {
          ...webhookProviderVerificationRequired,
          expected: true
        }
      },
      paymentBypass: paymentBypassDiagnostics,
      coreRidePaymentGuards: coreRidePaymentGuardDiagnostics,
      driverSearchRadiusPolicy,
      legacyRuntime: legacyRuntimeDiagnostics,
      firebase: {
        databaseUrlConfigured: presence(firebaseDatabaseUrl),
        serviceAccountConfigured: firebaseServiceAccountConfigured,
        configured: Boolean(firebaseDatabaseUrl) || firebaseServiceAccountConfigured
      },
      maps: {
        keyConfigured: Boolean(String(process.env.GOOGLE_MAPS_API_KEY || '').trim()),
        clientDirectGoogleFallbackAllowed:
          boolEnv('EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK', false) ||
          boolEnv('ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK', false),
        placesCacheEnabled: booleanDiagnostic('ENABLE_PLACES_CACHE', true),
        receiptMapImagesConfigured: Boolean(
          String(process.env.GOOGLE_MAPS_API_KEY || process.env.GEO_KEY || '').trim()
        )
      },
      push: {
        fcmConfigured,
        provider: firebaseServiceAccountConfigured
          ? 'firebase-admin'
          : legacyFcmServerKeyConfigured
            ? 'legacy-fcm-server-key'
            : null,
        allowPublicDirectFcmSend: booleanDiagnostic('ALLOW_PUBLIC_DIRECT_FCM_SEND', false),
        demandNotificationServiceEnabled: booleanDiagnostic('ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE', false),
        liveActivity: {
          apnsConfigured: apnsLiveActivityConfigured,
          keyIdConfigured: Boolean(String(process.env.LEAF_APNS_KEY_ID || '').trim()),
          teamIdConfigured: Boolean(String(process.env.LEAF_APNS_TEAM_ID || '').trim()),
          privateKeyConfigured: hasApnsPrivateKeyConfigured(),
          bundleId: presence(process.env.LEAF_APNS_BUNDLE_ID),
          environment: String(process.env.LEAF_APNS_ENV || process.env.NODE_ENV || '').trim().toLowerCase() || 'development'
        }
      },
      runtime: {
        runtimeRole,
        paymentProviderConfigRequired,
        socketRedisAdapter: {
          ...socketRedisAdapterDiagnostic,
          expected: true
        },
        requireSocketRedisAdapter: {
          ...socketRedisAdapterRequiredDiagnostic,
          expected: nodeEnv === 'production' && runtimeRole === 'gateway'
        }
      },
      launchControl: launchControlDiagnostic,
      financialPolicy: financialPolicyApproval,
      authOtp: {
        ...authOtpDiagnostics
      }
    },
    optionalRecommended: OPTIONAL_RECOMMENDED.filter((k) => !String(process.env[k] || '').trim())
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

main();
