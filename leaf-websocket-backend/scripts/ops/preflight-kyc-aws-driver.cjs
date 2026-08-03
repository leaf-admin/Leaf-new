#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const EXPECTED_LIVENESS_PROVIDER = 'aws_rekognition_face_liveness';
const EXPECTED_COMPARE_PROVIDER = 'aws_rekognition_compare_faces';
const EXPECTED_LIVENESS_SESSION_TTL_SECONDS = 180;
const DEFAULT_TIMEOUT_MS = 10_000;

class PreflightBlockerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PreflightBlockerError';
    this.code = code;
    this.details = details;
  }
}

function blocker(code, message, details = {}) {
  return new PreflightBlockerError(code, message, details);
}

function requiredString(value, code, message) {
  const normalized = String(value || '').trim();
  if (!normalized) throw blocker(code, message);
  return normalized;
}

function normalizeBaseUrl(value) {
  const raw = requiredString(
    value,
    'KYC_PREFLIGHT_BASE_URL_REQUIRED',
    'KYC_PREFLIGHT_BASE_URL e obrigatoria; o preflight nao possui default de producao'
  );
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw blocker('KYC_PREFLIGHT_BASE_URL_INVALID', 'KYC_PREFLIGHT_BASE_URL deve ser uma URL http(s) valida');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw blocker('KYC_PREFLIGHT_BASE_URL_INVALID', 'KYC_PREFLIGHT_BASE_URL deve usar http ou https');
  }
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLoopback) {
    throw blocker(
      'KYC_PREFLIGHT_BASE_URL_INSECURE',
      'KYC_PREFLIGHT_BASE_URL deve usar https fora de localhost'
    );
  }
  if (
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname && parsed.pathname !== '/')
  ) {
    throw blocker(
      'KYC_PREFLIGHT_BASE_URL_INVALID',
      'KYC_PREFLIGHT_BASE_URL deve conter apenas a origem, sem credenciais, path, query ou fragmento'
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function readPositiveInteger(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const raw = String(value).trim();
  const parsed = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 60_000) {
    throw blocker(
      'KYC_PREFLIGHT_TIMEOUT_INVALID',
      `${name} deve ser inteiro entre 1 e 60000`
    );
  }
  return parsed;
}

function readPreflightConfig(env = process.env) {
  return {
    baseUrl: normalizeBaseUrl(env.KYC_PREFLIGHT_BASE_URL),
    firebaseIdToken: requiredString(
      env.KYC_PREFLIGHT_FIREBASE_ID_TOKEN,
      'KYC_PREFLIGHT_FIREBASE_ID_TOKEN_REQUIRED',
      'KYC_PREFLIGHT_FIREBASE_ID_TOKEN e obrigatorio'
    ),
    driverStatusToken: requiredString(
      env.KYC_PREFLIGHT_DRIVER_STATUS_TOKEN,
      'KYC_PREFLIGHT_DRIVER_STATUS_TOKEN_REQUIRED',
      'KYC_PREFLIGHT_DRIVER_STATUS_TOKEN e obrigatorio para a consulta read-only de status'
    ),
    driverId: requiredString(
      env.KYC_PREFLIGHT_DRIVER_ID,
      'KYC_PREFLIGHT_DRIVER_ID_REQUIRED',
      'KYC_PREFLIGHT_DRIVER_ID e obrigatorio e deve identificar exatamente um motorista QA'
    ),
    timeoutMs: readPositiveInteger(
      env.KYC_PREFLIGHT_HTTP_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      'KYC_PREFLIGHT_HTTP_TIMEOUT_MS'
    )
  };
}

function buildUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function getJson({ fetchImpl, baseUrl, path, headers = {}, timeoutMs }) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(buildUrl(baseUrl, path), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...headers
      },
      redirect: 'error',
      signal: abortController.signal
    });
  } catch (error) {
    const timeoutCode = error?.name === 'AbortError'
      ? 'KYC_PREFLIGHT_HTTP_TIMEOUT'
      : 'KYC_PREFLIGHT_HTTP_UNAVAILABLE';
    clearTimeout(timeout);
    throw blocker(timeoutCode, `GET ${path} falhou`, { path });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError' || abortController.signal.aborted) {
      throw blocker('KYC_PREFLIGHT_HTTP_TIMEOUT', `GET ${path} excedeu o timeout`, { path });
    }
    throw blocker(
      'KYC_PREFLIGHT_HTTP_JSON_INVALID',
      `GET ${path} nao retornou JSON valido`,
      { path, httpStatus: response.status }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw blocker(
      'KYC_PREFLIGHT_HTTP_STATUS_BLOCKED',
      `GET ${path} retornou HTTP ${response.status}`,
      { path, httpStatus: response.status, remoteCode: payload?.code || null }
    );
  }
  return payload;
}

function assertExact(value, expected, code, message, details = {}) {
  if (value !== expected) throw blocker(code, message, details);
}

function assertExactPublicKeys(value, expectedKeys, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw blocker(code, message);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw blocker(code, message, { unexpectedFields: actual.filter((key) => !expected.includes(key)) });
  }
}

function validateProvider(payload) {
  assertExact(payload?.success, true, 'KYC_PROVIDER_NOT_READY', 'Provider de liveness nao confirmou success=true');
  assertExact(
    payload?.provider,
    EXPECTED_LIVENESS_PROVIDER,
    'KYC_PROVIDER_NOT_AWS_LIVENESS',
    'Provider ativo nao e AWS Rekognition Face Liveness'
  );
  assertExactPublicKeys(
    payload,
    ['success', 'provider', 'config'],
    'KYC_PROVIDER_PUBLIC_CONTRACT_UNSAFE',
    'Provider de liveness retornou campos fora do contrato publico minimo'
  );
  const config = payload?.config || {};
  assertExactPublicKeys(
    config,
    ['enabled', 'credentialsEnabled', 'hasAssumeRoleArn'],
    'KYC_PROVIDER_PUBLIC_CONTRACT_UNSAFE',
    'Provider de liveness expos configuracao interna no contrato publico'
  );
  const valid = config.enabled === true
    && config.credentialsEnabled === true
    && config.hasAssumeRoleArn === true;
  if (!valid) {
    throw blocker(
      'KYC_PROVIDER_CONFIG_BLOCKED',
      'Provider AWS Liveness nao confirmou habilitacao e credenciais temporarias'
    );
  }
  return {
    provider: payload.provider,
    enabled: true,
    credentialsEnabled: true,
    assumeRoleConfigured: true
  };
}

function validateBiometricReadiness(payload) {
  assertExactPublicKeys(
    payload,
    ['success', 'ready', 'code'],
    'KYC_BIOMETRIC_READINESS_PUBLIC_CONTRACT_UNSAFE',
    'Readiness biometrica retornou detalhes internos fora do contrato publico'
  );
  if (
    payload?.success !== true
    || payload?.ready !== true
    || payload?.code !== 'KYC_BIOMETRICS_READY'
  ) {
    throw blocker(
      'KYC_BIOMETRIC_READINESS_BLOCKED',
      'Readiness biometrica nao confirmou o perfil interno aprovado'
    );
  }
  return {
    ready: true,
    code: payload.code
  };
}

function validateInternalBiometricRuntime(snapshot) {
  const readiness = snapshot?.readiness || {};
  const liveness = snapshot?.liveness || {};
  const compare = snapshot?.compare || {};
  const valid = snapshot?.readOnly === true
    && readiness.ok === true
    && readiness.enabled === true
    && Array.isArray(readiness.blockers)
    && readiness.blockers.length === 0
    && readiness.policy?.productionRuntime === true
    && readiness.policy?.productionBiometricsEnabled === true
    && readiness.policy?.strictProductionMode === true
    && readiness.policy?.requireTrustedBiometricMatch === true
    && readiness.policy?.allowLegacyDeviceSignature === false
    && readiness.policy?.allowAwsLivenessOnlyMatch === false
    && readiness.policy?.allowMobileDeviceEmbedding === false
    && liveness.enabled === true
    && liveness.provider === EXPECTED_LIVENESS_PROVIDER
    && liveness.region === 'us-east-1'
    && liveness.credentialsEnabled === true
    && liveness.hasAssumeRoleArn === true
    && liveness.hasOutputBucket === false
    && Number(liveness.sessionTtlSeconds) === EXPECTED_LIVENESS_SESSION_TTL_SECONDS
    && Number.isFinite(Number(liveness.attemptWindowSeconds))
    && Number(liveness.attemptWindowSeconds) >= EXPECTED_LIVENESS_SESSION_TTL_SECONDS
    && Number(liveness.sessionBindingTtlSeconds) >= Number(liveness.attemptWindowSeconds)
    && liveness.costGuard?.enabled === true
    && liveness.costGuard?.limitScope === 'per_driver_daily'
    && Number(liveness.costGuard?.perUserDailySessionLimit) === 20
    && liveness.costGuard?.globalDailyLimitEnabled === false
    && liveness.costGuard?.globalMonthlyLimitEnabled === false
    && compare.enabled === true
    && compare.provider === EXPECTED_COMPARE_PROVIDER
    && compare.region === 'us-east-1'
    && Number(compare.sdkMaxAttempts) === 1
    && compare.costGuard?.enabled === true
    && Number.isFinite(Number(compare.approveThreshold))
    && Number(compare.approveThreshold) >= 0.95
    && Number.isFinite(Number(compare.reviewThreshold))
    && Number(compare.reviewThreshold) < Number(compare.approveThreshold);
  if (!valid) {
    throw blocker(
      'KYC_INTERNAL_BIOMETRIC_RUNTIME_BLOCKED',
      'Runtime local nao confirmou a configuracao biometrica aprovada'
    );
  }
  return {
    ready: true,
    checkedLocally: true
  };
}

function validateRuntimeFlags(payload) {
  const kyc = payload?.kyc || {};
  if (
    payload?.success !== true
    || payload?.runtime?.nodeEnv !== 'production'
    || kyc.productionBiometricsEnabled !== true
    || kyc.strictProductionMode !== true
    || kyc.onlineGateEnabled !== true
    || kyc.adaptiveCadenceEnabled !== true
    || kyc.activeTripAuthorityMode !== 'redis_noeviction'
    || kyc.activeTripAuthorityReady !== true
    || kyc.verificationDuringActiveRide !== false
  ) {
    throw blocker(
      'KYC_RUNTIME_FLAGS_BLOCKED',
      'Runtime nao confirma KYC estrito, gate/cadencia ativos e autoridade Redis pronta fora de corrida'
    );
  }
  return {
    nodeEnv: 'production',
    onlineGateEnabled: true,
    adaptiveCadenceEnabled: true,
    activeTripAuthorityMode: 'redis_noeviction',
    activeTripAuthorityReady: true,
    verificationDuringActiveRide: false
  };
}

function validateDriverOffline(payload, driverId) {
  const details = payload?.details || {};
  const offline = payload?.driverId === driverId
    && payload?.online === false
    && payload?.connected === false
    && payload?.authenticated === false
    && payload?.inDriverRoom === false
    && payload?.canReceiveRequests === false
    && String(payload?.status || '').trim().toLowerCase() === 'offline'
    && details.isOnlineInRedis === false
    && details.isEligibleInGeo === false
    && details.canReceiveRequestsByRedis === false
    && details.canReceiveRequestsBySocket === false;
  if (!offline) {
    throw blocker(
      'KYC_QA_DRIVER_NOT_OFFLINE',
      'Motorista QA precisa estar totalmente offline, desconectado e fora dos indices geo antes do KYC'
    );
  }
  return {
    offline: true,
    connected: false,
    inDriverRoom: false,
    inDriverGeo: false,
    dispatchEligibleNow: false
  };
}

function validateNoActiveRide(snapshot) {
  if (!snapshot || snapshot.readOnly !== true || snapshot.authority !== 'redis_noeviction') {
    throw blocker(
      'KYC_ACTIVE_RIDE_QUERY_UNAVAILABLE',
      'Consulta read-only da autoridade de corrida ativa nao retornou prova valida'
    );
  }
  if (snapshot.indexTripId || snapshot.hashTripId) {
    throw blocker(
      'KYC_QA_DRIVER_HAS_ACTIVE_RIDE',
      'Autoridade Redis ainda contem corrida ativa ou marcador residual para o motorista QA'
    );
  }
  return {
    hasActiveRide: false,
    canonicalIndexEmpty: true,
    driverHashMarkerEmpty: true,
    authority: snapshot.authority
  };
}

function validateCanonicalCnh(document) {
  const valid = document
    && document.status === 'approved'
    && document.analysisStatus === 'approved'
    && document.approvalSource === 'dashboard_manual_review'
    && document.documentType === 'cnh'
    && typeof document.submissionId === 'string'
    && document.submissionId.trim()
    && typeof document.documentSha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(document.documentSha256)
    && typeof document.storageGeneration === 'string'
    && /^\d+$/.test(document.storageGeneration)
    && typeof document.reviewedBy === 'string'
    && document.reviewedBy.trim()
    && Number.isFinite(Date.parse(document.reviewedAt));
  if (!valid) {
    throw blocker(
      'KYC_CANONICAL_CNH_NOT_APPROVED',
      'CNH canonica nao possui binding integro, analise aprovada e aprovacao documental registrada'
    );
  }
  return {
    approved: true,
    documentType: 'cnh',
    approvalSource: document.approvalSource,
    bindingVersion: Number(document.bindingVersion || 0) || null,
    reviewedAt: document.reviewedAt
  };
}

function validateBudget(snapshot) {
  if (
    !snapshot
    || snapshot.readOnly !== true
    || snapshot.enabled !== true
    || snapshot.timeZone !== 'UTC'
    || snapshot.available !== true
    || !Number.isFinite(snapshot.bundleEstimatedCostUsd)
    || snapshot.bundleEstimatedCostUsd <= 0
    || snapshot.limitScope !== 'per_driver_daily'
    || snapshot.perUserDailySessionLimit !== 20
    || !Number.isFinite(snapshot.operationCount)
    || snapshot.operationCount < 0
    || !Number.isFinite(snapshot.remainingSessions)
    || snapshot.remainingSessions < 1
  ) {
    throw blocker(
      'KYC_AWS_BUDGET_UNAVAILABLE',
      'Cost guard nao comprova sessao disponivel no limite diario por motorista'
    );
  }
  return {
    available: true,
    timeZone: 'UTC',
    limitScope: 'per_driver_daily',
    bundleEstimatedCostUsd: snapshot.bundleEstimatedCostUsd,
    perUserDailySessionLimit: snapshot.perUserDailySessionLimit,
    operationCount: snapshot.operationCount,
    remainingSessions: snapshot.remainingSessions,
    estimatedSpentUsd: snapshot.estimatedSpentUsd
  };
}

function normalizeBlocker(error, check) {
  if (error instanceof PreflightBlockerError) {
    return {
      check,
      code: error.code,
      message: error.message,
      ...error.details
    };
  }
  const externalCode = String(error?.code || '').trim();
  if (/^(?:KYC|AWS|REDIS)_[A-Z0-9_]+$/.test(externalCode)) {
    return {
      check,
      code: externalCode,
      message: String(error?.message || `${check} bloqueado`).trim()
    };
  }
  return {
    check,
    code: 'KYC_PREFLIGHT_QUERY_FAILED',
    message: `${check} falhou sem prova read-only suficiente`
  };
}

async function runCheck({ name, query, validate }) {
  try {
    const value = await query();
    return { name, ok: true, evidence: validate(value) };
  } catch (error) {
    return { name, ok: false, blocker: normalizeBlocker(error, name) };
  }
}

async function runKycAwsPreflight(config, dependencies) {
  const decoded = await dependencies.verifyIdToken(config.firebaseIdToken).catch(() => {
    throw blocker('KYC_PREFLIGHT_FIREBASE_TOKEN_INVALID', 'Token Firebase do motorista QA e invalido ou expirou');
  });
  if (String(decoded?.uid || '').trim() !== config.driverId) {
    throw blocker(
      'KYC_PREFLIGHT_DRIVER_TOKEN_MISMATCH',
      'UID do token Firebase nao corresponde a KYC_PREFLIGHT_DRIVER_ID'
    );
  }

  const authHeaders = { authorization: `Bearer ${config.firebaseIdToken}` };
  const checks = await Promise.all([
    runCheck({
      name: 'provider',
      query: () => getJson({
        fetchImpl: dependencies.fetchImpl,
        baseUrl: config.baseUrl,
        path: '/api/kyc/liveness/provider',
        headers: authHeaders,
        timeoutMs: config.timeoutMs
      }),
      validate: validateProvider
    }),
    runCheck({
      name: 'biometricReadiness',
      query: () => getJson({
        fetchImpl: dependencies.fetchImpl,
        baseUrl: config.baseUrl,
        path: '/api/kyc/biometrics/readiness',
        headers: authHeaders,
        timeoutMs: config.timeoutMs
      }),
      validate: validateBiometricReadiness
    }),
    runCheck({
      name: 'internalBiometricRuntime',
      query: () => dependencies.queryInternalBiometricRuntime(),
      validate: validateInternalBiometricRuntime
    }),
    runCheck({
      name: 'runtimeFlags',
      query: () => getJson({
        fetchImpl: dependencies.fetchImpl,
        baseUrl: config.baseUrl,
        path: '/health/runtime-flags',
        timeoutMs: config.timeoutMs
      }),
      validate: validateRuntimeFlags
    }),
    runCheck({
      name: 'driverOffline',
      query: () => getJson({
        fetchImpl: dependencies.fetchImpl,
        baseUrl: config.baseUrl,
        path: `/api/driver-status/${encodeURIComponent(config.driverId)}`,
        headers: { 'x-driver-status-token': config.driverStatusToken },
        timeoutMs: config.timeoutMs
      }),
      validate: (payload) => validateDriverOffline(payload, config.driverId)
    }),
    runCheck({
      name: 'noActiveRide',
      query: () => dependencies.queryActiveRide(config.driverId),
      validate: validateNoActiveRide
    }),
    runCheck({
      name: 'canonicalCnh',
      query: () => dependencies.queryCanonicalCnh(config.driverId),
      validate: validateCanonicalCnh
    }),
    runCheck({
      name: 'awsBudget',
      query: () => dependencies.queryAwsBudget(config.driverId),
      validate: validateBudget
    })
  ]);

  const failedChecks = checks.filter((check) => !check.ok);
  return {
    status: failedChecks.length === 0 ? 'ready' : 'blocked',
    mode: 'read-only-fail-closed',
    paidAwsCalls: 0,
    firestoreReadsExpected: 3,
    driverIdHash: crypto.createHash('sha256').update(config.driverId).digest('hex'),
    baseUrl: config.baseUrl,
    checks: Object.fromEntries(
      checks
        .filter((check) => check.ok)
        .map((check) => [check.name, check.evidence])
    ),
    blockers: failedChecks.map((check) => check.blocker)
  };
}

function microsToUsd(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) / 1_000_000 : null;
}

async function loadRuntimeDependencies() {
  let redisPool = null;
  try {
    const admin = require('firebase-admin');
    const firebaseConfig = require('../../firebase-config');
    redisPool = require('../../utils/redis-pool');
    const canonicalDocumentService = require('../../services/canonical-driver-document-approval-service');
    const costGuard = require('../../services/aws-kyc-cost-guard-service');
    const AwsFaceLivenessService = require('../../services/aws-face-liveness-service');
    const CanonicalAwsFaceCompareService = require('../../services/canonical-aws-face-compare-service');
    const { evaluateProductionReadiness } = require('../../services/kyc-biometric-production-policy');

    const app = firebaseConfig.initializeFirebase();
    if (!app) {
      throw blocker('KYC_PREFLIGHT_FIREBASE_ADMIN_UNAVAILABLE', 'Firebase Admin indisponivel para consultas read-only');
    }
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      throw blocker('KYC_PREFLIGHT_FIRESTORE_UNAVAILABLE', 'Firestore indisponivel para consultas read-only');
    }
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const livenessService = new AwsFaceLivenessService();
    const faceCompareService = new CanonicalAwsFaceCompareService();

    return {
      fetchImpl: globalThis.fetch,
      verifyIdToken: (token) => admin.auth().verifyIdToken(token),
      queryCanonicalCnh: (driverId) => canonicalDocumentService.requireApprovedCnh(driverId),
      queryInternalBiometricRuntime: async () => ({
        readOnly: true,
        readiness: evaluateProductionReadiness(process.env),
        liveness: livenessService.getConfigSummary(),
        compare: faceCompareService.getConfigSummary()
      }),
      async queryActiveRide(driverId) {
        const [indexTripId, driverState] = await Promise.all([
          redis.get(`active_trip_by_driver:${driverId}`),
          redis.hgetall(`driver:${driverId}`)
        ]);
        return {
          readOnly: true,
          authority: String(process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE || '').trim().toLowerCase(),
          indexTripId: String(indexTripId || '').trim() || null,
          hashTripId: String(driverState?.activeTripId || '').trim() || null,
          hashLeaseUntilMs: String(driverState?.activeTripLeaseUntilMs || '').trim() || null
        };
      },
      async queryAwsBudget(driverId) {
        const config = costGuard.getConfigSummary();
        const usage = await costGuard.getPerUserDailyUsage(driverId);
        const bundleCostMicros = Number(costGuard.getBundleCostMicros());
        return {
          readOnly: true,
          enabled: config.enabled === true,
          timeZone: config.timeZone,
          limitScope: config.limitScope,
          available: usage.remainingSessions > 0,
          bundleEstimatedCostUsd: microsToUsd(bundleCostMicros),
          perUserDailySessionLimit: usage.perUserDailySessionLimit,
          operationCount: usage.operationCount,
          remainingSessions: usage.remainingSessions,
          estimatedSpentUsd: usage.estimatedSpentUsd
        };
      },
      close: () => redisPool.shutdown({ timeoutMs: 2_000 })
    };
  } catch (error) {
    await redisPool?.shutdown?.({ timeoutMs: 2_000 }).catch(() => null);
    throw error;
  }
}

async function main() {
  let dependencies = null;
  try {
    const config = readPreflightConfig(process.env);
    dependencies = await loadRuntimeDependencies();
    const report = await runKycAwsPreflight(config, dependencies);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'ready' ? 0 : 2;
  } catch (error) {
    const normalized = normalizeBlocker(error, 'preflight');
    process.stdout.write(`${JSON.stringify({
      status: 'blocked',
      mode: 'read-only-fail-closed',
      paidAwsCalls: 0,
      blockers: [normalized]
    }, null, 2)}\n`);
    process.exitCode = 2;
  } finally {
    await dependencies?.close?.().catch(() => null);
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  EXPECTED_LIVENESS_PROVIDER,
  EXPECTED_COMPARE_PROVIDER,
  PreflightBlockerError,
  readPreflightConfig,
  runKycAwsPreflight,
  validateProvider,
  validateBiometricReadiness,
  validateInternalBiometricRuntime,
  validateRuntimeFlags,
  validateDriverOffline,
  validateNoActiveRide,
  validateCanonicalCnh,
  validateBudget
};
