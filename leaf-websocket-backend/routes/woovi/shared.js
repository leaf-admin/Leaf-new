// Gerado a partir de routes/woovi.js (divisão mecânica, sem mudança de regra).
// Tudo o que não é registro de rota, na ordem original: dependências, router,
// configuração, helpers e handlers.

const express = require('express');

const axios = require('axios');

const crypto = require('crypto');

const admin = require('firebase-admin');

const router = express.Router();

const { logStructured, logError } = require('../../utils/logger');

const { getWooviConfig, getWooviAuthHeaders } = require('../../config/woovi-config');

const { getDefaultWooviWebhookPublicKey } = require('../../config/woovi-webhook-public-key');

const { authenticateJWT, requireRole } = require('../../middleware/jwt-auth');

const {
  FINANCIAL_COLLECTIONS,
  resolveFinancialContext,
  getFinancialCollections,
  hasSandboxSignal
} = require('../../services/financial-runtime-context');

const {
  resolveRidePersistenceScope
} = require('../../services/sandbox-persistence-context');

const WOOVI_CONFIG = getWooviConfig();

const WOOVI_ADMIN_ROLES = ['admin', 'super-admin', 'manager'];

const WOOVI_SANDBOX_TEST_ROLES = [...WOOVI_ADMIN_ROLES, 'development'];

const WOOVI_SANDBOX_TEST_PAYMENT_URL =
  process.env.WOOVI_SANDBOX_TEST_PAYMENT_URL || 'https://api.woovi.com/openpix/testing';

const legacyWooviAliasRouteEnabled =
  String(process.env.ENABLE_LEGACY_WOOVI_ALIAS_ROUTE || 'false').toLowerCase() === 'true';

logStructured('info', 'Configuração Woovi carregada', {
  service: 'woovi-routes',
  environment: WOOVI_CONFIG.environment,
  baseUrl: WOOVI_CONFIG.baseUrl,
  hasToken: Boolean(WOOVI_CONFIG.apiToken),
  hasAppId: Boolean(WOOVI_CONFIG.appId)
});

const COMPLETED_WEBHOOK_EVENTS = new Set([
  'OPENPIX:CHARGE_COMPLETED',
  'CHARGE_COMPLETED',
  'CHARGE_CONFIRMED',
  'CHARGE_PAID',
  'CHARGE.COMPLETED',
  'CHARGE.CONFIRMED',
  'CHARGE.PAID',
  'LEAF-CHARGE.CONFIRMED',
  'LEAF-CHARGE.COMPLETED',
  'OPENPIX:TRANSACTION_RECEIVED',
  'TRANSACTION_RECEIVED'
]);

const COMPLETED_PAYMENT_STATUSES = new Set([
  'COMPLETED',
  'CONFIRMED',
  'PAID',
  'IN_HOLDING',
  'DISTRIBUTED'
]);

function normalizeEventName(eventName) {
  return String(eventName || '').trim().toUpperCase();
}

function normalizePaymentStatus(status) {
  return String(status || '').trim().toUpperCase();
}

function readBooleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function parseTimestampMs(value) {
  const ms = new Date(value || '').getTime();
  return Number.isFinite(ms) ? ms : null;
}

function resolveWebhookStaleProcessingMs() {
  return Math.max(
    1000,
    Number.parseInt(process.env.WOOVI_WEBHOOK_STALE_PROCESSING_MS || '300000', 10)
  );
}

function isRetryableWebhookEvent(existing = {}) {
  const status = String(existing.status || '').trim().toLowerCase();
  if (status === 'failed') {
    return true;
  }

  if (!['received', 'processing'].includes(status)) {
    return false;
  }

  const updatedAtMs = parseTimestampMs(existing.updatedAtIso || existing.createdAtIso);
  if (!updatedAtMs) {
    return false;
  }

  return Date.now() - updatedAtMs >= resolveWebhookStaleProcessingMs();
}

function normalizeBearerToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  return token.replace(/^bearer\s+/i, '').trim();
}

function canSandboxTestPaymentActorConfirm(actor = null, passengerId = '') {
  const safePassengerId = String(passengerId || '').trim();
  if (!actor || !safePassengerId) {
    return false;
  }

  if (WOOVI_SANDBOX_TEST_ROLES.includes(String(actor.role || '').trim())) {
    return true;
  }

  const identifiers = new Set();
  [
    actor.uid,
    actor.id,
    actor.userId,
    actor.sub,
    actor.phoneNumber,
    actor.phone_number,
    actor.phone,
    actor.email
  ].forEach((value) => {
    const normalized = String(value || '').trim();
    if (normalized) identifiers.add(normalized);
  });

  return identifiers.has(safePassengerId);
}

async function authenticateFirebaseSandboxPaymentActor(req, res, next) {
  const token = normalizeBearerToken(req.headers.authorization || '');
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token não fornecido',
      code: 'SANDBOX_PAYMENT_AUTH_TOKEN_MISSING'
    });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const actor = {
      type: 'firebase',
      uid: decoded.uid,
      id: decoded.uid,
      userId: decoded.uid,
      sub: decoded.sub || decoded.uid,
      phoneNumber: decoded.phone_number || decoded.phoneNumber || null,
      email: decoded.email || null,
      role: decoded.role || decoded.userType || decoded.user_type || 'user'
    };
    req.sandboxPaymentActor = actor;
    req.user = req.user || actor;
    return next();
  } catch (error) {
    logStructured('warn', 'Confirmação sandbox bloqueada por token Firebase inválido', {
      service: 'woovi-routes',
      operation: 'sandbox_payment_app_auth',
      code: error?.code || null
    });
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado',
      code: 'SANDBOX_PAYMENT_AUTH_TOKEN_INVALID'
    });
  }
}

function extractWebhookChargePayload(data = {}) {
  const charge = data?.charge || data?.data || {};
  const additionalInfo = Array.isArray(charge.additionalInfo)
    ? charge.additionalInfo
    : (Array.isArray(data.additionalInfo) ? data.additionalInfo : []);
  const chargeId = String(
    charge.identifier ||
    charge.id ||
    charge.chargeId ||
    charge.transactionID ||
    data.identifier ||
    data.chargeId ||
    data.transactionID ||
    ''
  ).trim();
  const rideId = String(
    getAdditionalInfoValue(additionalInfo, ['ride_id', 'rideId']) ||
    data.rideId ||
    charge.correlationID ||
    ''
  ).trim();
  const passengerId = String(
    getAdditionalInfoValue(additionalInfo, ['passenger_id', 'passengerId']) ||
    data.passengerId ||
    ''
  ).trim();
  const paymentIntentId = String(
    getAdditionalInfoValue(additionalInfo, ['payment_intent_id', 'paymentIntentId']) ||
    data.paymentIntentId ||
    ''
  ).trim();
  const amountInCents = Number.isFinite(Number(charge.value || data.value || data.amount))
    ? Math.round(Number(charge.value || data.value || data.amount))
    : 0;

  return {
    charge,
    additionalInfo,
    chargeId,
    rideId,
    passengerId,
    paymentIntentId,
    amountInCents
  };
}

async function validateSandboxTestWebhookPayload(data = {}) {
  const payload = extractWebhookChargePayload(data);
  if (!payload.chargeId || !payload.rideId || !payload.passengerId || !payload.paymentIntentId || payload.amountInCents <= 0) {
    return {
      allowed: false,
      reason: 'SANDBOX_TEST_WEBHOOK_PAYLOAD_INCOMPLETE'
    };
  }

  try {
    const firestore = require('../../firebase-config').getFirestore();
    if (!firestore) {
      return {
        allowed: false,
        reason: 'SANDBOX_TEST_WEBHOOK_FIRESTORE_UNAVAILABLE'
      };
    }

    const intentDoc = await firestore
      .collection(FINANCIAL_COLLECTIONS.sandbox.paymentIntents)
      .doc(payload.paymentIntentId)
      .get();
    if (!intentDoc.exists) {
      return {
        allowed: false,
        reason: 'SANDBOX_TEST_WEBHOOK_INTENT_NOT_FOUND'
      };
    }

    const intent = intentDoc.data() || {};
    const contextResult = resolveFinancialContext(intent);
    if (!contextResult.ok || contextResult.context.namespace !== 'sandbox') {
      return { allowed: false, reason: contextResult.code || 'SANDBOX_FINANCIAL_CONTEXT_INVALID' };
    }
    const providerEnvironment = String(intent.providerEnvironment || '').trim().toLowerCase();
    const status = String(intent.status || '').trim().toLowerCase();
    const intentChargeId = String(intent.chargeId || intent.paymentId || '').trim();
    const intentRideId = String(intent.rideId || '').trim();
    const intentPassengerId = String(intent.passengerId || '').trim();
    const expectedAmount = Math.round(Number(intent.payableAmountInCents || intent.amountCents || intent.amount || 0));
    const maxAgeMs = Math.max(
      60 * 1000,
      Number.parseInt(process.env.WOOVI_SANDBOX_TEST_WEBHOOK_MAX_AGE_SECONDS || '86400', 10) * 1000
    );
    const freshness = evaluateSandboxPaymentIntentFreshness(intent, {
      maxAgeMs
    });

    if (providerEnvironment !== 'sandbox') {
      return { allowed: false, reason: 'SANDBOX_TEST_WEBHOOK_NOT_SANDBOX' };
    }
    if (status !== 'charge_created') {
      return { allowed: false, reason: 'SANDBOX_TEST_WEBHOOK_INVALID_INTENT_STATUS' };
    }
    if (intentChargeId !== payload.chargeId) {
      return { allowed: false, reason: 'SANDBOX_TEST_WEBHOOK_CHARGE_MISMATCH' };
    }
    if (intentRideId !== payload.rideId) {
      return { allowed: false, reason: 'SANDBOX_TEST_WEBHOOK_RIDE_MISMATCH' };
    }
    if (intentPassengerId !== payload.passengerId) {
      return { allowed: false, reason: 'SANDBOX_TEST_WEBHOOK_PASSENGER_MISMATCH' };
    }
    if (expectedAmount <= 0 || expectedAmount !== payload.amountInCents) {
      return {
        allowed: false,
        reason: 'SANDBOX_TEST_WEBHOOK_AMOUNT_MISMATCH',
        expectedAmountInCents: expectedAmount
      };
    }
    if (!freshness.fresh) {
      return { allowed: false, reason: 'SANDBOX_TEST_WEBHOOK_INTENT_EXPIRED' };
    }

    return {
      allowed: true,
      reason: 'SANDBOX_TEST_WEBHOOK_INTENT_VALIDATED',
      paymentIntentId: payload.paymentIntentId,
      chargeId: payload.chargeId,
      rideId: payload.rideId,
      passengerId: payload.passengerId,
      amountInCents: payload.amountInCents,
      financialContext: contextResult.context
    };
  } catch (error) {
    return {
      allowed: false,
      reason: 'SANDBOX_TEST_WEBHOOK_VALIDATION_FAILED',
      error: error.message
    };
  }
}

function parsePaymentIntentTimestampMs(value) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (value && typeof value.toDate === 'function') {
    const timestampDate = value.toDate();
    return timestampDate instanceof Date ? timestampDate.getTime() : Number.NaN;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  return Date.parse(String(value || '').trim());
}

function evaluateSandboxPaymentIntentFreshness(
  intent = {},
  { nowMs = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}
) {
  const createdAtMs = parsePaymentIntentTimestampMs(
    intent.chargeCreatedAtIso || intent.createdAtIso || intent.updatedAtIso || intent.chargeCreatedAt
  );
  if (!Number.isFinite(createdAtMs) || nowMs < createdAtMs) {
    return { fresh: false, reason: 'SANDBOX_PAYMENT_INTENT_CREATED_AT_INVALID' };
  }

  const expirationCandidates = [
    intent.chargeExpiresAtIso,
    intent.paymentExpiresAtIso,
    intent.paymentDriverReservationExpiresAt
  ]
    .map(parsePaymentIntentTimestampMs)
    .filter(Number.isFinite);

  if (expirationCandidates.length === 0) {
    return { fresh: false, reason: 'SANDBOX_PAYMENT_INTENT_EXPIRY_MISSING' };
  }

  const configuredMaxAgeMs = Number.isFinite(Number(maxAgeMs))
    ? Math.max(60 * 1000, Number(maxAgeMs))
    : 60 * 60 * 1000;
  const expiresAtMs = Math.min(
    ...expirationCandidates,
    createdAtMs + configuredMaxAgeMs
  );

  if (nowMs >= expiresAtMs) {
    return {
      fresh: false,
      reason: 'SANDBOX_PAYMENT_INTENT_EXPIRED',
      expiresAtMs
    };
  }

  return {
    fresh: true,
    reason: 'SANDBOX_PAYMENT_INTENT_ACTIVE',
    expiresAtMs
  };
}

async function resolveSandboxTestWebhookPayload({ passengerId, paymentIntentId } = {}) {
  const safePassengerId = String(passengerId || '').trim();
  const safePaymentIntentId = String(paymentIntentId || '').trim();
  if (!safePassengerId) {
    return { found: false, reason: 'SANDBOX_PAYMENT_PASSENGER_REQUIRED' };
  }
  if (!safePaymentIntentId) {
    return { found: false, reason: 'SANDBOX_PAYMENT_INTENT_ID_REQUIRED' };
  }

  const firestore = require('../../firebase-config').getFirestore();
  if (!firestore) {
    return { found: false, reason: 'SANDBOX_PAYMENT_FIRESTORE_UNAVAILABLE' };
  }

  const snapshot = await firestore
    .collection(FINANCIAL_COLLECTIONS.sandbox.paymentIntents)
    .doc(safePaymentIntentId)
    .get();
  if (!snapshot.exists) {
    return { found: false, reason: 'SANDBOX_PAYMENT_INTENT_NOT_FOUND' };
  }
  const intent = { id: snapshot.id, ...(snapshot.data() || {}) };
  const contextResult = resolveFinancialContext(intent);
  if (!contextResult.ok || contextResult.context.namespace !== 'sandbox') {
    return { found: false, reason: contextResult.code || 'SANDBOX_FINANCIAL_CONTEXT_INVALID' };
  }

  const maxAgeMs = Math.max(
    60 * 1000,
    Number.parseInt(process.env.WOOVI_SANDBOX_TEST_CONFIRM_MAX_AGE_SECONDS || '3600', 10) * 1000
  );
  if (
    String(intent.passengerId || '').trim() !== safePassengerId ||
    String(intent.providerEnvironment || '').trim().toLowerCase() !== 'sandbox'
  ) {
    return { found: false, reason: 'SANDBOX_PAYMENT_INTENT_NOT_FOUND' };
  }

  if (String(intent.status || '').trim().toLowerCase() !== 'charge_created') {
    return { found: false, reason: 'SANDBOX_PAYMENT_INTENT_STATUS_INVALID' };
  }

  const chargeId = String(intent.chargeId || intent.paymentId || '').trim();
  const rideId = String(intent.rideId || '').trim();
  if (!chargeId || !rideId) {
    return { found: false, reason: 'SANDBOX_PAYMENT_INTENT_INCOMPLETE' };
  }

  const freshness = evaluateSandboxPaymentIntentFreshness(intent, { maxAgeMs });
  if (!freshness.fresh) {
    return { found: false, reason: freshness.reason };
  }

  const amountInCents = Math.round(
    Number(intent.payableAmountInCents || intent.amountCents || intent.amount || 0)
  );
  if (amountInCents <= 0) {
    return { found: false, reason: 'SANDBOX_PAYMENT_AMOUNT_INVALID' };
  }

  const resolvedIntentId = String(intent.paymentIntentId || intent.id || '').trim();
  const paidAt = new Date().toISOString();
  return {
    found: true,
    paymentIntentId: resolvedIntentId,
    chargeId,
    rideId,
    passengerId: safePassengerId,
    amountInCents,
    financialContext: contextResult.context,
    payload: {
      event: 'OPENPIX:CHARGE_COMPLETED',
      charge: {
        identifier: chargeId,
        transactionID: chargeId,
        correlationID: String(intent.correlationID || '').trim(),
        status: 'COMPLETED',
        value: amountInCents,
        paidAt,
        additionalInfo: [
          { key: 'passenger_id', value: safePassengerId },
          { key: 'ride_id', value: rideId },
          { key: 'payment_type', value: 'advance_payment' },
          { key: 'payment_intent_id', value: resolvedIntentId },
          { key: 'financial_namespace', value: contextResult.context.namespace },
          { key: 'financial_context_id', value: contextResult.context.contextId },
          { key: 'service', value: 'ride_sharing' }
        ]
      },
      pix: { status: 'COMPLETED' },
      account: { environment: 'TESTING' }
    }
  };
}

function hasSandboxPaymentConfirmationSignal(metadata = {}) {
  const additionalInfo = normalizeAdditionalInfo(metadata.additionalInfo);
  const providerEnvironment = String(
    metadata.providerEnvironment ||
    getAdditionalInfoValue(additionalInfo, ['provider_environment', 'providerEnvironment']) ||
    ''
  ).trim().toLowerCase();
  const financialNamespace = String(
    metadata.financialNamespace ||
    getAdditionalInfoValue(additionalInfo, ['financial_namespace', 'financialNamespace']) ||
    ''
  ).trim().toLowerCase();

  return Boolean(
    metadata.providerConfirmation ||
    metadata.source === 'sandbox_provider_verification' ||
    providerEnvironment === 'sandbox' ||
    financialNamespace === 'sandbox' ||
    hasSandboxSignal(metadata)
  );
}

function getPaymentIntentIdFromConfirmationMetadata(metadata = {}) {
  const additionalInfo = normalizeAdditionalInfo(metadata.additionalInfo);
  return String(
    metadata.paymentIntentId ||
    getAdditionalInfoValue(additionalInfo, ['payment_intent_id', 'paymentIntentId']) ||
    ''
  ).trim();
}

async function resolveSandboxPaymentIntentAsBooking({
  chargeId,
  rideId,
  passengerId,
  amountInCents,
  paymentIntentId = null
}) {
  const safeChargeId = String(chargeId || '').trim();
  const safeRideId = String(rideId || '').trim();
  const safePassengerId = String(passengerId || '').trim();
  const safeAmountInCents = Math.round(Number(amountInCents || 0));
  const safePaymentIntentId = String(paymentIntentId || '').trim();

  if (!safeChargeId || !safeRideId || !safePassengerId || safeAmountInCents <= 0) {
    return null;
  }

  try {
    const firestore = require('../../firebase-config').getFirestore();
    if (!firestore) return null;

    let intent = null;
    let resolvedPaymentIntentId = safePaymentIntentId;
    if (safePaymentIntentId) {
      const intentDoc = await firestore
        .collection(FINANCIAL_COLLECTIONS.sandbox.paymentIntents)
        .doc(safePaymentIntentId)
        .get();
      if (!intentDoc.exists) return null;
      intent = intentDoc.data() || {};
    } else {
      const snapshot = await firestore
        .collection(FINANCIAL_COLLECTIONS.sandbox.paymentIntents)
        .where('chargeId', '==', safeChargeId)
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      intent = snapshot.docs[0].data() || {};
      resolvedPaymentIntentId = snapshot.docs[0].id;
    }

    let persistenceScope;
    try {
      persistenceScope = resolveRidePersistenceScope(intent);
    } catch (_contextError) {
      return null;
    }
    if (persistenceScope.namespace !== 'sandbox') return null;
    const financialContext = persistenceScope.financialContext;
    const providerEnvironment = String(intent.providerEnvironment || '').trim().toLowerCase();
    const status = String(intent.status || '').trim().toLowerCase();
    const intentPaymentIntentId = String(intent.paymentIntentId || resolvedPaymentIntentId || '').trim();
    const intentRideId = String(intent.rideId || '').trim();
    const intentPassengerId = String(intent.passengerId || '').trim();
    const expectedAmount = Math.round(Number(intent.payableAmountInCents || intent.amountCents || intent.amount || 0));

    if (
      providerEnvironment !== 'sandbox' ||
      status !== 'charge_created' ||
      (safePaymentIntentId && intentPaymentIntentId !== safePaymentIntentId) ||
      intentRideId !== safeRideId ||
      intentPassengerId !== safePassengerId ||
      String(intent.chargeId || intent.paymentId || '').trim() !== safeChargeId ||
      expectedAmount !== safeAmountInCents
    ) {
      return null;
    }

    return {
      rideId: safeRideId,
      passengerId: safePassengerId,
      paymentAmountInCents: expectedAmount,
      amountInCents: expectedAmount,
      estimatedFareCents: expectedAmount,
      status: 'payment_intent_only',
      paymentIntentId: intentPaymentIntentId,
      paymentChargeId: safeChargeId,
      providerEnvironment,
      financialContext,
      financialNamespace: financialContext.namespace,
      financialContextId: financialContext.contextId,
      testUserSandbox: financialContext.testUserSandbox === true,
      source: 'sandbox_payment_intent'
    };
  } catch (error) {
    logStructured('warn', 'Falha ao resolver payment_intent sandbox como booking', {
      service: 'woovi-routes',
      chargeId: safeChargeId,
      rideId: safeRideId,
      error: error.message
    });
    return null;
  }
}

function getConfiguredWebhookAuthorizationValues() {
  const candidates = [
    process.env.WOOVI_WEBHOOK_AUTHORIZATION,
    process.env.OPENPIX_WEBHOOK_AUTHORIZATION,
    process.env.WOOVI_WEBHOOK_AUTH_TOKEN,
    process.env.OPENPIX_WEBHOOK_AUTH_TOKEN
  ];

  return candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function getWebhookAuthorizationCandidates(req) {
  return [
    req.get('authorization'),
    req.get('x-webhook-authorization'),
    req.get('x-woovi-authorization')
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function sanitizeProviderBody(body) {
  if (!body || typeof body !== 'object') {
    return body || null;
  }

  const redacted = JSON.parse(JSON.stringify(body));
  const sensitiveKeys = new Set([
    'authorization',
    'authorizationappid',
    'appid',
    'appId',
    'apiToken',
    'token',
    'secret',
    'clientSecret'
  ]);

  const redactObject = (value) => {
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach((key) => {
      if (sensitiveKeys.has(key) || sensitiveKeys.has(String(key).toLowerCase())) {
        value[key] = '[redacted]';
        return;
      }
      redactObject(value[key]);
    });
  };

  redactObject(redacted);
  return redacted;
}

function getWooviSandboxTestPaymentUrl() {
  return String(process.env.WOOVI_SANDBOX_TEST_PAYMENT_URL || WOOVI_SANDBOX_TEST_PAYMENT_URL).trim();
}

function firstConfiguredValue(entries = []) {
  for (const entry of entries) {
    const value = String(entry?.value || '').trim();
    if (value) {
      return {
        value,
        source: entry.source || 'unknown'
      };
    }
  }
  return { value: '', source: 'missing' };
}

function resolveWooviSandboxTestAuthorization(sandboxConfig = {}) {
  return firstConfiguredValue([
    { source: 'WOOVI_SANDBOX_TEST_APP_ID', value: process.env.WOOVI_SANDBOX_TEST_APP_ID },
    {
      source: 'WOOVI_SANDBOX_TEST_AUTHORIZATION_APP_ID',
      value: process.env.WOOVI_SANDBOX_TEST_AUTHORIZATION_APP_ID
    },
    {
      source: 'OPENPIX_SANDBOX_TEST_APP_ID',
      value: process.env.OPENPIX_SANDBOX_TEST_APP_ID
    },
    {
      source: 'OPENPIX_SANDBOX_TEST_AUTHORIZATION_APP_ID',
      value: process.env.OPENPIX_SANDBOX_TEST_AUTHORIZATION_APP_ID
    },
    {
      source: 'woovi_sandbox_config.authorizationAppId',
      value: sandboxConfig.authorizationAppId
    },
    {
      source: 'woovi_sandbox_config.apiToken',
      value: sandboxConfig.apiToken
    }
  ]);
}

async function requestWooviSandboxTestPayment({ transactionID, chargeId, paymentIntentId } = {}) {
  const resolvedTransactionID = String(transactionID || chargeId || '').trim();
  if (!resolvedTransactionID) {
    return {
      success: false,
      code: 'WOOVI_SANDBOX_TEST_TRANSACTION_ID_REQUIRED',
      error: 'transactionID da cobrança sandbox é obrigatório'
    };
  }

  const sandboxConfig = getWooviConfig({ environment: 'sandbox' });
  const authorization = resolveWooviSandboxTestAuthorization(sandboxConfig);
  if (!authorization.value) {
    return {
      success: false,
      code: 'WOOVI_SANDBOX_AUTHORIZATION_MISSING',
      error: 'Authorization AppID sandbox da Woovi não configurado',
      authorizationSource: authorization.source
    };
  }

  const endpointUrl = getWooviSandboxTestPaymentUrl();
  try {
    const response = await axios.get(endpointUrl, {
      headers: {
        ...getWooviAuthHeaders(sandboxConfig),
        Authorization: authorization.value
      },
      params: {
        transactionID: resolvedTransactionID
      },
      timeout: Math.max(
        5000,
        Number.parseInt(process.env.WOOVI_SANDBOX_TEST_PAYMENT_TIMEOUT_MS || '20000', 10) || 20000
      ),
      validateStatus: (status) => status >= 200 && status < 500
    });

    const status = Number(response.status || 0);
    const providerBody = sanitizeProviderBody(response.data);
    const endpointHost = (() => {
      try {
        return new URL(endpointUrl).host;
      } catch (_error) {
        return endpointUrl;
      }
    })();

    if (status < 200 || status >= 300) {
      logStructured('warn', 'Woovi recusou confirmação sandbox oficial', {
        service: 'woovi-routes',
        operation: 'woovi_sandbox_testing_payment',
        chargeId: chargeId || resolvedTransactionID,
        paymentIntentId: paymentIntentId || null,
        transactionID: resolvedTransactionID,
        status,
        endpointHost,
        authorizationSource: authorization.source,
        providerBody
      });
      return {
        success: false,
        code: 'WOOVI_SANDBOX_TEST_PAYMENT_REJECTED',
        status,
        transactionID: resolvedTransactionID,
        endpointHost,
        authorizationSource: authorization.source,
        providerBody
      };
    }

    logStructured('info', 'Woovi confirmou pagamento sandbox pelo endpoint oficial', {
      service: 'woovi-routes',
      operation: 'woovi_sandbox_testing_payment',
      chargeId: chargeId || resolvedTransactionID,
      paymentIntentId: paymentIntentId || null,
      transactionID: resolvedTransactionID,
      status,
      endpointHost,
      authorizationSource: authorization.source
    });

    return {
      success: true,
      status,
      transactionID: resolvedTransactionID,
      endpointHost,
      authorizationSource: authorization.source,
      providerBody
    };
  } catch (error) {
    logError(error, 'Erro ao chamar endpoint oficial de pagamento sandbox Woovi', {
      service: 'woovi-routes',
      operation: 'woovi_sandbox_testing_payment',
      chargeId: chargeId || resolvedTransactionID,
      paymentIntentId: paymentIntentId || null,
      transactionID: resolvedTransactionID
    });
    return {
      success: false,
      code: 'WOOVI_SANDBOX_TEST_PAYMENT_REQUEST_FAILED',
      error: error.message,
      transactionID: resolvedTransactionID
    };
  }
}

function verifyWebhookAuthorization(req) {
  const configuredTokens = getConfiguredWebhookAuthorizationValues();
  if (configuredTokens.length === 0) {
    return {
      valid: true,
      configured: false
    };
  }

  const requestCandidates = getWebhookAuthorizationCandidates(req);
  if (requestCandidates.length === 0) {
    return {
      valid: false,
      configured: true,
      reason: 'WEBHOOK_AUTHORIZATION_MISSING'
    };
  }

  const normalizedExpected = configuredTokens.map(normalizeBearerToken);
  const matches = requestCandidates.some((candidate) => {
    const normalizedCandidate = normalizeBearerToken(candidate);
    return normalizedExpected.some(
      (expected) =>
        safeEqualString(candidate, expected) ||
        safeEqualString(candidate, `Bearer ${expected}`) ||
        safeEqualString(normalizedCandidate, expected)
    );
  });

  return {
    valid: matches,
    configured: true,
    reason: matches ? null : 'WEBHOOK_AUTHORIZATION_INVALID'
  };
}

function isProductionRuntime() {
  if (readBooleanEnv('WOOVI_WEBHOOK_REQUIRE_SIGNATURE', false)) {
    return true;
  }

  return [
    process.env.NODE_ENV,
    process.env.APP_ENV,
    process.env.LEAF_ENV,
    process.env.ENVIRONMENT
  ].some((value) => ['production', 'prod'].includes(String(value || '').toLowerCase()));
}

function isWooviSandboxRuntime() {
  return (
    String(process.env.WOOVI_ENVIRONMENT || '').toLowerCase() === 'sandbox' ||
    /sandbox/i.test(String(process.env.WOOVI_BASE_URL || ''))
  );
}

function getWebhookRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody;
  }

  return Buffer.from(JSON.stringify(req.body || {}));
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getSignatureCandidates(signatureHeader) {
  const raw = String(signatureHeader || '').trim();
  if (!raw) return [];

  const candidates = new Set([raw]);
  raw.split(',').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    candidates.add(trimmed);
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex !== -1) {
      candidates.add(trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, ''));
    }
  });

  if (raw.startsWith('sha256=')) {
    candidates.add(raw.slice('sha256='.length));
  }

  return [...candidates].filter(Boolean);
}

function verifyHmacSignature({ rawBody, signatureHeader, secret }) {
  if (!secret || !signatureHeader) return false;

  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBase64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

  return getSignatureCandidates(signatureHeader).some((candidate) => (
    safeEqualString(candidate, expectedHex) ||
    safeEqualString(candidate, `sha256=${expectedHex}`) ||
    safeEqualString(candidate, expectedBase64)
  ));
}

function normalizePemKey(publicKey) {
  const normalized = String(publicKey || '').replace(/\\n/g, '\n').trim();
  if (!normalized) return '';
  if (normalized.includes('BEGIN PUBLIC KEY')) return normalized;

  const chunks = normalized.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${chunks.join('\n')}\n-----END PUBLIC KEY-----`;
}

function decodeSignatureCandidate(candidate) {
  const value = String(candidate || '').trim();
  if (!value) return null;

  if (/^[a-f0-9]+$/i.test(value) && value.length % 2 === 0) {
    return Buffer.from(value, 'hex');
  }

  try {
    return Buffer.from(value, 'base64');
  } catch {
    return null;
  }
}

function verifyPublicKeySignature({ rawBody, signatureHeader, publicKey }) {
  const formattedPublicKey = normalizePemKey(publicKey);
  if (!formattedPublicKey || !signatureHeader) return false;

  const configuredAlgorithm = process.env.WOOVI_WEBHOOK_PUBLIC_KEY_ALGORITHM || 'RSA-SHA256';
  const cryptoAlgorithm = String(configuredAlgorithm).toLowerCase() === 'ed25519'
    ? null
    : configuredAlgorithm;

  return getSignatureCandidates(signatureHeader).some((candidate) => {
    const signature = decodeSignatureCandidate(candidate);
    if (!signature || signature.length === 0) return false;

    try {
      return crypto.verify(cryptoAlgorithm, rawBody, formattedPublicKey, signature);
    } catch {
      return false;
    }
  });
}

function verifyWooviWebhookSignature(req) {
  const rawBody = getWebhookRawBody(req);
  const recommendedSignature = req.get('x-webhook-signature');
  const deprecatedHmacSignature = req.get('x-openpix-signature');
  const authDecision = verifyWebhookAuthorization(req);
  const isProdRuntime = isProductionRuntime();
  const isSandboxRuntime = isWooviSandboxRuntime();
  const explicitPublicKey =
    process.env.WOOVI_WEBHOOK_PUBLIC_KEY ||
    process.env.OPENPIX_WEBHOOK_PUBLIC_KEY ||
    '';
  const publicKey = explicitPublicKey || (isProdRuntime && !isSandboxRuntime
    ? getDefaultWooviWebhookPublicKey()
    : '');
  const recommendedHmacSecret =
    process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET ||
    process.env.OPENPIX_WEBHOOK_SIGNATURE_SECRET ||
    '';
  const deprecatedHmacSecret =
    process.env.WOOVI_WEBHOOK_HMAC_SECRET ||
    process.env.OPENPIX_WEBHOOK_HMAC_SECRET ||
    '';
  const verifiersConfigured = Boolean(publicKey || recommendedHmacSecret || deprecatedHmacSecret);
  const signaturePresent = Boolean(recommendedSignature || deprecatedHmacSignature);
  const webhookRequireSignature = readBooleanEnv('WOOVI_WEBHOOK_REQUIRE_SIGNATURE', verifiersConfigured);
  const strictSignatureRuntime = isProdRuntime && !isSandboxRuntime;
  const allowUnsignedWebhook = readBooleanEnv(
    'WOOVI_WEBHOOK_ALLOW_UNSIGNED',
    !verifiersConfigured
  );
  const providerVerificationRequired = readBooleanEnv(
    'WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED',
    true
  );
  const providerVerificationIdentityAccepted =
    authDecision.configured ||
    !isProdRuntime ||
    isSandboxRuntime;
  const authorizationBackedProviderVerification =
    !verifiersConfigured &&
    providerVerificationIdentityAccepted &&
    authDecision.valid &&
    allowUnsignedWebhook &&
    providerVerificationRequired &&
    !webhookRequireSignature;
  const signatureRequired =
    webhookRequireSignature ||
    (strictSignatureRuntime && !authorizationBackedProviderVerification);

  if (!authDecision.valid) {
    return {
      valid: false,
      method: null,
      reason: authDecision.reason || 'WEBHOOK_AUTHORIZATION_INVALID',
      recommendedSignaturePresent: Boolean(recommendedSignature),
      deprecatedHmacPresent: Boolean(deprecatedHmacSignature),
      authorizationConfigured: authDecision.configured,
      providerVerificationRequired
    };
  }

  if (
    recommendedSignature &&
    publicKey &&
    verifyPublicKeySignature({ rawBody, signatureHeader: recommendedSignature, publicKey })
  ) {
    return {
      valid: true,
      method: 'x-webhook-signature/public-key',
      recommendedSignaturePresent: true,
      deprecatedHmacPresent: Boolean(deprecatedHmacSignature),
      authorizationConfigured: authDecision.configured,
      providerVerificationRequired: false
    };
  }

  if (
    recommendedSignature &&
    recommendedHmacSecret &&
    verifyHmacSignature({ rawBody, signatureHeader: recommendedSignature, secret: recommendedHmacSecret })
  ) {
    return {
      valid: true,
      method: 'x-webhook-signature/hmac-sha256',
      recommendedSignaturePresent: true,
      deprecatedHmacPresent: Boolean(deprecatedHmacSignature),
      authorizationConfigured: authDecision.configured,
      providerVerificationRequired: false
    };
  }

  if (
    deprecatedHmacSignature &&
    deprecatedHmacSecret &&
    verifyHmacSignature({ rawBody, signatureHeader: deprecatedHmacSignature, secret: deprecatedHmacSecret })
  ) {
    return {
      valid: true,
      method: 'x-openpix-signature/hmac-sha256',
      recommendedSignaturePresent: Boolean(recommendedSignature),
      deprecatedHmacPresent: true,
      authorizationConfigured: authDecision.configured,
      providerVerificationRequired: false
    };
  }

  const allowProviderVerifiedWithoutVerifier =
    !verifiersConfigured &&
    authorizationBackedProviderVerification &&
    !signatureRequired;

  if (allowProviderVerifiedWithoutVerifier) {
    return {
      valid: true,
      method: isProdRuntime || isSandboxRuntime
        ? 'unsigned_provider_verification'
        : 'unsigned_non_production',
      recommendedSignaturePresent: false,
      deprecatedHmacPresent: false,
      authorizationConfigured: authDecision.configured,
      providerVerificationRequired: true
    };
  }

  let reason = 'WEBHOOK_SIGNATURE_INVALID';
  if (!verifiersConfigured) {
    if (!authDecision.configured && isProdRuntime && !isSandboxRuntime) {
      reason = 'WEBHOOK_AUTHORIZATION_NOT_CONFIGURED';
    } else if (signatureRequired && isProdRuntime) {
      reason = 'WEBHOOK_SIGNATURE_VERIFIER_NOT_CONFIGURED';
    } else if (signatureRequired) {
      reason = 'WEBHOOK_SIGNATURE_REQUIRED';
    } else if (!allowUnsignedWebhook) {
      reason = 'WEBHOOK_UNSIGNED_DISABLED';
    } else if (!providerVerificationRequired) {
      reason = 'WEBHOOK_PROVIDER_VERIFICATION_DISABLED';
    } else if (signaturePresent) {
      reason = 'WEBHOOK_SIGNATURE_VERIFIER_NOT_CONFIGURED';
    } else {
      reason = 'WEBHOOK_SIGNATURE_MISSING';
    }
  } else if (!signaturePresent) {
    reason = 'WEBHOOK_SIGNATURE_MISSING';
  }

  return {
    valid: false,
    method: null,
    reason,
    recommendedSignaturePresent: Boolean(recommendedSignature),
    deprecatedHmacPresent: Boolean(deprecatedHmacSignature),
    authorizationConfigured: authDecision.configured,
    providerVerificationRequired
  };
}

async function auditWooviWebhookDecision(payload) {
  const auditPayload = {
    service: 'woovi-routes',
    auditedAt: new Date().toISOString(),
    ...payload
  };

  logStructured(payload.decision === 'rejected' ? 'warn' : 'info', 'Auditoria webhook Woovi', auditPayload);

  try {
    const redisPool = require('../../utils/redis-pool');
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const fields = [];
    Object.entries(auditPayload).forEach(([key, value]) => {
      fields.push(key, typeof value === 'string' ? value : JSON.stringify(value ?? null));
    });
    await redis.xadd('audit:woovi:webhooks', 'MAXLEN', '~', 10000, '*', ...fields);
  } catch (auditError) {
    logStructured('warn', 'Falha ao persistir auditoria de webhook Woovi no Redis', {
      service: 'woovi-routes',
      error: auditError.message,
      decision: payload.decision || null,
      chargeId: payload.chargeId || null
    });
  }
}

async function beginWooviWebhookIdempotency({ event, chargeId, amount }) {
  if (!chargeId) {
    return { duplicate: false, key: null };
  }

  const key = [
    'woovi:webhook:idempotency',
    String(chargeId),
    normalizeEventName(event),
    String(Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0)
  ].join(':');

  try {
    const firebaseConfig = require('../../firebase-config');
    const admin = require('firebase-admin');
    const firestore = firebaseConfig.getFirestore();

    if (firestore) {
      const docId = crypto.createHash('sha256').update(key).digest('hex');
      const eventRef = firestore.collection('woovi_webhook_events').doc(docId);
      const durableClaim = await firestore.runTransaction(async (transaction) => {
        const eventDoc = await transaction.get(eventRef);
        if (eventDoc.exists) {
          const existing = eventDoc.data() || {};
          if (isRetryableWebhookEvent(existing)) {
            const nowIso = new Date().toISOString();
            transaction.set(eventRef, {
              status: 'processing',
              retryOfStatus: existing.status || null,
              attempts: Number(existing.attempts || 1) + 1,
              lastRetryAt: admin.firestore.FieldValue.serverTimestamp(),
              lastRetryAtIso: nowIso,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAtIso: nowIso
            }, { merge: true });

            return {
              duplicate: false,
              retry: true,
              source: 'firestore',
              docId,
              existing
            };
          }

          return {
            duplicate: true,
            source: 'firestore',
            docId,
            existing
          };
        }

        transaction.set(eventRef, {
          idempotencyKey: key,
          event: normalizeEventName(event),
          chargeId: String(chargeId),
          amount: Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0,
          status: 'processing',
          attempts: 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAtIso: new Date().toISOString(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtIso: new Date().toISOString()
        });

        return {
          duplicate: false,
          retry: false,
          source: 'firestore',
          docId
        };
      });

      if (durableClaim.duplicate) {
        return {
          duplicate: true,
          key,
          source: durableClaim.source,
          durableEventId: durableClaim.docId
        };
      }

      try {
        const redisPool = require('../../utils/redis-pool');
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        const ttlSeconds = Number.parseInt(process.env.WOOVI_WEBHOOK_IDEMPOTENCY_TTL_SECONDS || '172800', 10);
        await redis.set(key, new Date().toISOString(), 'NX', 'EX', ttlSeconds);
      } catch (redisCacheError) {
        logStructured('debug', 'Falha ao gravar cache Redis de webhook já persistido', {
          service: 'woovi-routes',
          chargeId,
          event,
          error: redisCacheError.message
        });
      }

      return {
        duplicate: false,
        retry: Boolean(durableClaim.retry),
        key,
        source: durableClaim.source,
        durableEventId: durableClaim.docId
      };
    }
  } catch (durableIdempotencyError) {
    logStructured('warn', 'Falha ao aplicar idempotência durável do webhook Woovi; usando fallback Redis', {
      service: 'woovi-routes',
      chargeId,
      event,
      error: durableIdempotencyError.message
    });
  }

  try {
    const redisPool = require('../../utils/redis-pool');
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const ttlSeconds = Number.parseInt(process.env.WOOVI_WEBHOOK_IDEMPOTENCY_TTL_SECONDS || '172800', 10);
    const result = await redis.set(key, JSON.stringify({
      status: 'processing',
      startedAt: new Date().toISOString()
    }), 'NX', 'EX', ttlSeconds);
    return {
      duplicate: result !== 'OK',
      key,
      source: 'redis'
    };
  } catch (idempotencyError) {
    logStructured('warn', 'Falha ao aplicar idempotência do webhook Woovi; seguindo com processamento', {
      service: 'woovi-routes',
      chargeId,
      event,
      error: idempotencyError.message
    });
    return { duplicate: false, key: null, error: idempotencyError.message };
  }
}

async function completeWooviWebhookIdempotency(decision = {}, outcome = 'processed', metadata = {}) {
  if (!decision?.key && !decision?.durableEventId) {
    return { updated: false, skipped: true, reason: 'IDEMPOTENCY_KEY_MISSING' };
  }

  const normalizedOutcome = ['processed', 'failed', 'rejected'].includes(String(outcome || '').toLowerCase())
    ? String(outcome).toLowerCase()
    : 'processed';
  const nowIso = new Date().toISOString();

  if (decision?.durableEventId) {
    try {
      const firebaseConfig = require('../../firebase-config');
      const admin = require('firebase-admin');
      const firestore = firebaseConfig.getFirestore();
      if (firestore) {
        const eventRef = firestore.collection('woovi_webhook_events').doc(decision.durableEventId);
        const timestampField = normalizedOutcome === 'processed'
          ? 'processedAt'
          : normalizedOutcome === 'rejected'
            ? 'rejectedAt'
            : 'failedAt';
        const timestampIsoField = `${timestampField}Iso`;
        await eventRef.set({
          status: normalizedOutcome,
          outcome: normalizedOutcome,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtIso: nowIso,
          [timestampField]: admin.firestore.FieldValue.serverTimestamp(),
          [timestampIsoField]: nowIso,
          result: metadata?.result || null,
          error: metadata?.error || null,
          responseStatus: metadata?.responseStatus || null
        }, { merge: true });
      }
    } catch (durableUpdateError) {
      logStructured('warn', 'Falha ao atualizar status durável do webhook Woovi', {
        service: 'woovi-routes',
        idempotencyKey: decision.key || null,
        durableEventId: decision.durableEventId,
        outcome: normalizedOutcome,
        error: durableUpdateError.message
      });
    }
  }

  if (decision?.key) {
    try {
      const redisPool = require('../../utils/redis-pool');
      await redisPool.ensureConnection();
      const redis = redisPool.getConnection();
      if (normalizedOutcome === 'failed' && typeof redis.del === 'function') {
        await redis.del(decision.key);
      } else {
        const ttlSeconds = Number.parseInt(process.env.WOOVI_WEBHOOK_IDEMPOTENCY_TTL_SECONDS || '172800', 10);
        await redis.set(decision.key, JSON.stringify({
          status: normalizedOutcome,
          completedAt: nowIso
        }), 'XX', 'EX', ttlSeconds);
      }
    } catch (redisUpdateError) {
      logStructured('debug', 'Falha ao atualizar cache Redis de idempotência Woovi', {
        service: 'woovi-routes',
        idempotencyKey: decision.key,
        outcome: normalizedOutcome,
        error: redisUpdateError.message
      });
    }
  }

  return {
    updated: true,
    outcome: normalizedOutcome
  };
}

function parseAmountCandidateToCents(value, keyHint = '') {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const hint = String(keyHint || '').toLowerCase();
  if (hint.includes('cent') || hint.includes('incent')) {
    return Math.round(numeric);
  }

  return Math.round(numeric * 100);
}

function extractExpectedBookingAmountInCents(bookingData = {}) {
  const candidates = [
    ['paymentAmountInCents', bookingData.paymentAmountInCents],
    ['amountInCents', bookingData.amountInCents],
    ['fareInCents', bookingData.fareInCents],
    ['totalAmountInCents', bookingData.totalAmountInCents],
    ['estimatedFareCents', bookingData.estimatedFareCents],
    ['paymentAmount', bookingData.paymentAmount],
    ['totalAmount', bookingData.totalAmount],
    ['estimatedFare', bookingData.estimatedFare],
    ['fare', bookingData.fare],
    ['price', bookingData.price],
    ['pricingPayload.final_price', bookingData.pricingPayload?.final_price]
  ];

  for (const [key, value] of candidates) {
    const parsed = parseAmountCandidateToCents(value, key);
    if (parsed) return parsed;
  }

  return null;
}

function validateWebhookAmountAgainstBooking({ bookingData, amountInCents, rideId, chargeId }) {
  const strictValidation =
    isProductionRuntime() ||
    String(process.env.WOOVI_STRICT_WEBHOOK_AMOUNT_VALIDATION || 'true').toLowerCase() === 'true';

  if (!bookingData) {
    return strictValidation
      ? { ok: false, code: 'BOOKING_NOT_FOUND_FOR_PAYMENT', expectedAmountInCents: null }
      : { ok: true, code: 'BOOKING_NOT_FOUND_ALLOWED_IN_NON_PROD', expectedAmountInCents: null };
  }

  const expectedAmountInCents = extractExpectedBookingAmountInCents(bookingData);
  if (!expectedAmountInCents) {
    return strictValidation
      ? { ok: false, code: 'EXPECTED_AMOUNT_NOT_FOUND', expectedAmountInCents: null }
      : { ok: true, code: 'EXPECTED_AMOUNT_MISSING_ALLOWED_IN_NON_PROD', expectedAmountInCents: null };
  }

  const difference = Math.abs(Number(amountInCents || 0) - expectedAmountInCents);
  if (difference > 1) {
    return {
      ok: false,
      code: 'PAYMENT_AMOUNT_MISMATCH',
      expectedAmountInCents,
      receivedAmountInCents: amountInCents,
      difference,
      rideId,
      chargeId
    };
  }

  return {
    ok: true,
    code: 'PAYMENT_AMOUNT_MATCH',
    expectedAmountInCents,
    receivedAmountInCents: amountInCents,
    difference
  };
}

function normalizeAdditionalInfo(rawAdditionalInfo) {
  if (Array.isArray(rawAdditionalInfo)) {
    return rawAdditionalInfo.filter((info) => info && typeof info === 'object');
  }

  if (rawAdditionalInfo && typeof rawAdditionalInfo === 'object') {
    return Object.entries(rawAdditionalInfo).map(([key, value]) => ({
      key,
      value: value === null || value === undefined ? '' : String(value)
    }));
  }

  return [];
}

function getAdditionalInfoValue(additionalInfo, acceptedKeys = []) {
  if (!Array.isArray(additionalInfo) || additionalInfo.length === 0 || !acceptedKeys.length) {
    return null;
  }

  const acceptedSet = new Set(acceptedKeys.map((key) => String(key || '').toLowerCase()));
  const match = additionalInfo.find((info) => {
    const key = String(info?.key || info?.name || '').toLowerCase();
    return acceptedSet.has(key);
  });

  if (!match || match.value === undefined || match.value === null || match.value === '') {
    return null;
  }

  return String(match.value);
}

const ensureWooviCredentials = (res) => {
  if (!WOOVI_CONFIG.apiToken) {
    res.status(500).json({
      success: false,
      error: 'WOOVI_API_TOKEN não configurado'
    });
    return false;
  }
  return true;
};

const ensureWooviMasterCredentials = (res) => {
  if (!WOOVI_CONFIG.masterApiToken) {
    res.status(500).json({
      success: false,
      error: 'WOOVI_MASTER_API_TOKEN não configurado'
    });
    return false;
  }
  return true;
};

async function handleSandboxTestPaymentConfirmation(req, res) {
  try {
    const resolved = await resolveSandboxTestWebhookPayload(req.body || {});
    if (!resolved.found) {
      const conflictReasons = new Set([
        'SANDBOX_PAYMENT_INTENT_STATUS_INVALID',
        'SANDBOX_PAYMENT_INTENT_INCOMPLETE',
        'SANDBOX_PAYMENT_INTENT_CREATED_AT_INVALID',
        'SANDBOX_PAYMENT_INTENT_EXPIRY_MISSING',
        'SANDBOX_PAYMENT_INTENT_EXPIRED'
      ]);
      const status = resolved.reason === 'SANDBOX_PAYMENT_INTENT_ID_REQUIRED'
        ? 400
        : (conflictReasons.has(resolved.reason) ? 409 : 404);
      return res.status(status).json({
        success: false,
        code: resolved.reason
      });
    }

    if (
      req.sandboxPaymentActor &&
      !canSandboxTestPaymentActorConfirm(req.sandboxPaymentActor, resolved.passengerId)
    ) {
      logStructured('warn', 'Confirmação sandbox recusada por passageiro divergente', {
        service: 'woovi-routes',
        actorId: req.sandboxPaymentActor.uid || req.sandboxPaymentActor.id || null,
        passengerId: resolved.passengerId,
        chargeId: resolved.chargeId,
        paymentIntentId: resolved.paymentIntentId
      });
      return res.status(403).json({
        success: false,
        code: 'SANDBOX_PAYMENT_PASSENGER_SCOPE_MISMATCH',
        error: 'Passageiro não autorizado para confirmar esta cobrança sandbox'
      });
    }

    const validation = await validateSandboxTestWebhookPayload(resolved.payload);
    if (!validation.allowed) {
      return res.status(409).json({
        success: false,
        code: validation.reason
      });
    }

    const providerConfirmation = await requestWooviSandboxTestPayment({
      transactionID: resolved.chargeId,
      chargeId: resolved.chargeId,
      paymentIntentId: resolved.paymentIntentId
    });
    if (!providerConfirmation.success) {
      return res.status(502).json({
        success: false,
        code: providerConfirmation.code || 'WOOVI_SANDBOX_TEST_PAYMENT_FAILED',
        error: providerConfirmation.error || 'Woovi não confirmou a cobrança sandbox',
        chargeId: resolved.chargeId,
        paymentIntentId: resolved.paymentIntentId,
        status: providerConfirmation.status || null,
        endpointHost: providerConfirmation.endpointHost || null,
        providerBody: providerConfirmation.providerBody || null
      });
    }

    const io = req.app.get('io');
    const payload = {
      ...resolved.payload,
      _sandboxProviderConfirmation: {
        source: 'woovi_openpix_testing',
        transactionID: providerConfirmation.transactionID,
        status: providerConfirmation.status,
        endpointHost: providerConfirmation.endpointHost,
        confirmedAt: new Date().toISOString()
      }
    };
    const result = await handleChargeCompleted(payload, io);
    logStructured('info', 'Pagamento sandbox de teste confirmado pela Woovi', {
      service: 'woovi-routes',
      actorId: req.user?.id || req.sandboxPaymentActor?.uid || null,
      actorRole: req.user?.role || req.sandboxPaymentActor?.role || null,
      passengerId: resolved.passengerId,
      rideId: resolved.rideId,
      chargeId: resolved.chargeId,
      paymentIntentId: resolved.paymentIntentId,
      providerStatus: providerConfirmation.status,
      providerEndpointHost: providerConfirmation.endpointHost
    });

    return res.status(200).json({
      success: true,
      mode: 'woovi_sandbox_testing_confirmed',
      rideId: resolved.rideId,
      chargeId: resolved.chargeId,
      paymentIntentId: resolved.paymentIntentId,
      amountInCents: resolved.amountInCents,
      providerEnvironment: resolved.financialContext.providerEnvironment,
      financialNamespace: resolved.financialContext.namespace,
      financialContextId: resolved.financialContext.contextId,
      financialContext: resolved.financialContext,
      providerConfirmation: {
        status: providerConfirmation.status,
        transactionID: providerConfirmation.transactionID,
        endpointHost: providerConfirmation.endpointHost
      },
      result
    });
  } catch (error) {
    logError(error, 'Erro ao confirmar pagamento sandbox de teste', {
      service: 'woovi-routes',
      actorId: req.user?.id || req.sandboxPaymentActor?.uid || null
    });
    return res.status(500).json({
      success: false,
      error: 'Não foi possível confirmar o pagamento sandbox'
    });
  }
}

// Compatibilidade com o endpoint configurado no provedor (a aplicação é montada em /api).
// O encaminhamento preserva o handler canônico, incluindo assinatura e idempotência.
const forwardToCanonicalWooviWebhook = (req, res) => {
  req.url = '/woovi/webhook';
  return router.handle(req, res);
};

/**
 * Handler para cobrança completada/paga via webhook
 * Evento: OPENPIX:CHARGE_COMPLETED
 * Processa o pagamento e atualiza o status
 * @param {Object} data - Dados do webhook
 * @param {Object} io - Instância do Socket.IO (opcional)
 */
async function handleChargeCompleted(data, io = null) {
  let resolvedChargeId = null;
  try {
    const PaymentService = require('../../services/payment-service');
    const paymentService = new PaymentService();

    // ✅ Extrair dados do webhook conforme formato real da Woovi
    // Formato: { event: 'OPENPIX:CHARGE_COMPLETED', charge: {...}, pix: {...} }
    const eventName = data.event || data.type || data.name || 'OPENPIX:CHARGE_COMPLETED';
    const normalizedEventName = normalizeEventName(eventName);
    const charge = data.charge || data;
    const pix = data.pix || {};

    // ✅ Usar identifier como chargeId (formato Woovi)
    const chargeId = charge.identifier || charge.id || charge.chargeId || charge.transactionID;
    resolvedChargeId = chargeId;
    const correlationID = charge.correlationID || charge.correlationId;
    const amount = charge.value || charge.amount;
    const status = charge.status || charge.state;
    const normalizedWebhookStatus = normalizePaymentStatus(status);
    const additionalInfo = normalizeAdditionalInfo(charge.additionalInfo);
    const sandboxProviderConfirmation = data?._sandboxProviderConfirmation || null;

    if (!chargeId) {
      logStructured('error', 'chargeId (identifier) não encontrado no webhook', { service: 'woovi-routes', data });
      return;
    }

    logStructured('info', 'Processando pagamento confirmado', {
      service: 'woovi-routes',
      event: eventName,
      normalizedEventName,
      chargeId,
      correlationID,
      amount,
      status,
      normalizedWebhookStatus,
      additionalInfoCount: additionalInfo.length,
      paidAt: charge.paidAt
    });

    // ✅ Extrair rideId e passengerId de additionalInfo (formato Woovi)
    let rideId = null;
    let passengerId = null;

    if (additionalInfo.length > 0) {
      rideId = getAdditionalInfoValue(additionalInfo, ['ride_id', 'rideId', 'bookingId']);
      passengerId = getAdditionalInfoValue(additionalInfo, ['passenger_id', 'passengerId']);

      if (rideId) {
        logStructured('info', 'rideId encontrado em additionalInfo', { service: 'woovi-routes', rideId, chargeId });
      }

      if (passengerId) {
        logStructured('info', 'passengerId encontrado em additionalInfo', { service: 'woovi-routes', passengerId, chargeId });
      }
    }

    // ✅ Fallback: tentar extrair do correlationID se não encontrou em additionalInfo
    if (!rideId && correlationID) {
      // Formato: ride_${rideId}_${timestamp}_${random}
      const parts = correlationID.split('_');
      if (parts.length >= 4 && parts[0] === 'ride') {
        // Remove 'ride', timestamp (penúltimo) e random (último)
        rideId = parts.slice(1, -2).join('_');
        logStructured('info', 'rideId extraído do correlationID', { service: 'woovi-routes', rideId, correlationID });
      }
    }

    if (!rideId) {
      logStructured('error', 'rideId não encontrado no webhook', { service: 'woovi-routes', correlationID, additionalInfo, chargeId });
      // Continuar mesmo sem rideId para verificar status
    }

    logStructured('info', 'Dados extraídos do webhook', { service: 'woovi-routes', chargeId, rideId, passengerId, amount, status, amountInReais: amount ? (amount / 100).toFixed(2) : null });

    // ✅ Verificar status do pagamento na Woovi (usando identifier como chargeId)
    const webhookIndicatesCompleted =
      COMPLETED_WEBHOOK_EVENTS.has(normalizedEventName) ||
      COMPLETED_PAYMENT_STATUSES.has(normalizedWebhookStatus);
    const signatureMethod = String(data?._webhookSignatureMethod || '').trim();
    const providerVerificationRequired = Boolean(data?._webhookProviderVerificationRequired);
    const forceProviderConfirmation =
      providerVerificationRequired &&
      signatureMethod === 'unsigned_provider_verification';

    // Em modo sem assinatura, sempre confirmar no provedor antes de efetivar.
    let statusResult = null;
    let normalizedProviderStatus = '';
    if (forceProviderConfirmation) {
      const WooviDriverService = require('../../services/woovi-driver-service');
      const wooviService = new WooviDriverService();
      statusResult = await wooviService.getChargeStatus(chargeId);
      if (statusResult?.success && statusResult?.charge?.paidAt && !charge?.paidAt) {
        charge.paidAt = statusResult.charge.paidAt;
      }
    } else if (!webhookIndicatesCompleted) {
      statusResult = await paymentService.getPaymentStatus(chargeId);
      normalizedProviderStatus = normalizePaymentStatus(statusResult?.status);
    }
    if (forceProviderConfirmation) {
      normalizedProviderStatus = normalizePaymentStatus(statusResult?.status);
    }

    const providerIndicatesCompleted =
      Boolean(statusResult?.success) &&
      COMPLETED_PAYMENT_STATUSES.has(normalizedProviderStatus);
    const shouldProcessPayment = forceProviderConfirmation
      ? providerIndicatesCompleted
      : (webhookIndicatesCompleted || providerIndicatesCompleted);
    const providerAmountInCents = Number.isFinite(Number(statusResult?.amount))
      ? Math.round(Number(statusResult.amount))
      : null;
    const webhookAmountInCents = Number.isFinite(Number(amount))
      ? Math.round(Number(amount))
      : 0;
    const resolvedAmountInCents = (providerAmountInCents && providerAmountInCents > 0)
      ? providerAmountInCents
      : webhookAmountInCents;

    if (shouldProcessPayment) {
      const amountInReais = resolvedAmountInCents ? (resolvedAmountInCents / 100) : null;
      const finalStatus = statusResult?.status || status || charge.status;

      logStructured('info', 'Pagamento confirmado e verificado', {
        service: 'woovi-routes',
        chargeId,
        rideId,
        amount: amountInReais,
        status: finalStatus,
        paidAt: charge.paidAt,
        providerConfirmationEnforced: forceProviderConfirmation
      });

      // ✅ Verificar se é um pagamento de extensão de rota
      const paymentTypeValue = getAdditionalInfoValue(additionalInfo, ['payment_type']);
      const isExtension = String(paymentTypeValue || '').toLowerCase() === 'ride_extension';

      // ✅ Registrar pagamento confirmado e aguardar fluxo da corrida
      if (rideId) {
        if (isExtension) {
          logStructured('info', 'Iniciando processamento de extensão de corrida', { service: 'woovi-routes', chargeId, rideId });
          const newFareValue = getAdditionalInfoValue(additionalInfo, ['new_fare']);
          const newFare = newFareValue ? parseInt(newFareValue, 10) : 0;
          await processExtensionConfirmation(rideId, chargeId, resolvedAmountInCents, passengerId, io, newFare);
        } else {
          logStructured('info', 'Iniciando processamento de confirmação de pagamento inicial', { service: 'woovi-routes', chargeId, rideId });
          const confirmationResult = await processPaymentConfirmation(
            chargeId,
            rideId,
            resolvedAmountInCents,
            passengerId,
            io,
            {
              event: eventName,
              status: finalStatus,
              additionalInfo,
              pixStatus: pix?.status || 'N/A',
              paidAt: charge?.paidAt || null,
              source: sandboxProviderConfirmation ? 'sandbox_provider_verification' : 'woovi_webhook',
              providerEnvironment: sandboxProviderConfirmation ? 'sandbox' : null,
              providerConfirmation: sandboxProviderConfirmation,
              signatureMethod: data?._webhookSignatureMethod || null,
              providerConfirmationEnforced: forceProviderConfirmation,
              correlationID
            }
          );

          if (confirmationResult && confirmationResult.success) {
            logStructured('info', 'Pagamento registrado com sucesso', { service: 'woovi-routes', chargeId, rideId, processingStatus: confirmationResult.status || 'CONFIRMED' });
          } else {
            logStructured('warn', 'Pagamento confirmado, mas ajustes pendentes', { service: 'woovi-routes', chargeId, rideId, reason: confirmationResult?.error || 'Falha ao armazenar confirmação' });
          }
        }
      } else {
        logStructured('warn', 'rideId não encontrado, não é possível registrar pagamento', { service: 'woovi-routes', chargeId });
      }

    } else {
      logStructured('warn', 'Pagamento não confirmado após validações', {
        service: 'woovi-routes',
        chargeId,
        providerConfirmationEnforced: forceProviderConfirmation,
        webhookStatus: status,
        normalizedWebhookStatus,
        normalizedEventName,
        providerStatus: statusResult?.status || null,
        normalizedProviderStatus,
        providerSuccess: Boolean(statusResult?.success)
      });
    }

  } catch (error) {
    logError(error, 'Erro ao processar cobrança completada', {
      service: 'woovi-routes',
      chargeId: resolvedChargeId
    });
  }
}

/**
 * Processa a confirmação de um pagamento de Extensão de Corrida (passo adicional)
 */
async function processExtensionConfirmation(rideId, chargeId, amount, passengerId, io, newFare) {
  try {
    const eventSourcing = require('../../services/event-sourcing');
    const redisPool = require('../../utils/redis-pool');
    const { applyConfirmedRideExtension } = require('../../services/ride-lifecycle-service');
    const firebaseConfig = require('../../firebase-config');
    const firestore = firebaseConfig.getFirestore();
    const adminVars = require('firebase-admin');
    const PaymentService = require('../../services/payment-service');
    const paymentService = new PaymentService();

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();

    const extensionResult = await applyConfirmedRideExtension({
      redis,
      bookingId: rideId,
      chargeId,
      amountInCents: amount,
      io,
      source: 'woovi_extension_webhook'
    });

    if (firestore) {
      const storedPayment = await paymentService.getStoredPayment(rideId);
      if (!storedPayment) {
        throw new Error('Pagamento canônico não encontrado para extensão');
      }
      const contextResult = resolveFinancialContext(storedPayment, { allowLegacyOperational: true });
      if (!contextResult.ok) {
        throw new Error(`${contextResult.code}: ${contextResult.error}`);
      }
      const { collections } = getFinancialCollections(contextResult.context);
      const holdingRef = firestore.collection(collections.paymentHoldings).doc(rideId);
      await holdingRef.set({
        amount: adminVars.firestore.FieldValue.increment(amount),
        extensionChargeId: chargeId,
        updatedAt: adminVars.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const ridePaymentRef = firestore.collection(collections.ridePayments).doc(rideId);
      await ridePaymentRef.set({
        amount: adminVars.firestore.FieldValue.increment(amount),
        extensionChargeId: chargeId,
        lastExtensionPaidAt: adminVars.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logStructured('info', 'Pagamentos agregados atualizados com valor de extensão', {
        service: 'woovi-routes',
        rideId,
        addedAmount: amount
      });
    }

    await eventSourcing.recordEvent(eventSourcing.EVENT_TYPES.RIDE_UPDATED, {
      bookingId: rideId,
      type: 'EXTENSION_PAID',
      chargeId: chargeId,
      amountAdded: amount,
      newFare: newFare,
      status: extensionResult?.success && !extensionResult?.skipped ? 'CONFIRMED' : 'PENDING_MANUAL_CHECK'
    });

  } catch (error) {
    logError(error, 'Erro ao processar Extensão de Corrida', { rideId });
  }
}

/**
 * Processa confirmação de pagamento antecipado: materializa holding e notifica.
 * O motorista só recebe crédito no ledger após ride.completed via billing-worker.
 * @param {string} chargeId - ID da cobrança na Woovi
 * @param {string} rideId - ID da corrida
 * @param {number} amount - Valor em centavos
 * @param {string} passengerId - ID do passageiro
 * @param {Object} io - Instância do Socket.IO (opcional)
 */
async function processPaymentConfirmation(chargeId, rideId, amount, passengerId, io = null, metadata = {}) {
  try {
    const PaymentService = require('../../services/payment-service');
    const paymentDispatchService = require('../../services/payment-dispatch-service');
    const redisPool = require('../../utils/redis-pool');
    const { applyConfirmedRideExtension } = require('../../services/ride-lifecycle-service');
    const paymentService = new PaymentService();
    const amountInReais = amount ? (amount / 100).toFixed(2) : null;
    const amountInCents = Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0;
    const sandboxConfirmation = hasSandboxPaymentConfirmationSignal(metadata);

    let resolvedBookingId = rideId;
    let bookingData = null;
    let financialScopeEnvelope = {};

    if (sandboxConfirmation) {
      bookingData = await resolveSandboxPaymentIntentAsBooking({
        chargeId,
        rideId,
        passengerId,
        amountInCents,
        paymentIntentId: getPaymentIntentIdFromConfirmationMetadata(metadata)
      });

      if (!bookingData) {
        logStructured('warn', 'Confirmação sandbox rejeitada antes de consultar booking operacional', {
          service: 'woovi-routes',
          rideId,
          chargeId,
          code: 'SANDBOX_PAYMENT_INTENT_MISMATCH'
        });
        return {
          success: false,
          error: 'SANDBOX_PAYMENT_INTENT_MISMATCH',
          status: 'REJECTED'
        };
      }

      resolvedBookingId = bookingData.rideId;
      financialScopeEnvelope = {
        financialContext: bookingData.financialContext,
        financialNamespace: bookingData.financialNamespace,
        financialContextId: bookingData.financialContextId,
        providerEnvironment: bookingData.providerEnvironment,
        testUserSandbox: bookingData.testUserSandbox === true
      };
    } else {
      try {
        const linkedBookingId = await paymentDispatchService.resolveBookingIdFromPaymentRefs({
          bookingId: rideId,
          chargeId,
          temporaryRideId: rideId
        });

        if (linkedBookingId) {
          resolvedBookingId = linkedBookingId;
        }
      } catch (resolveError) {
        logStructured('warn', 'Não foi possível resolver bookingId via vínculo de pagamento', {
          service: 'woovi-routes',
          rideId,
          chargeId,
          error: resolveError.message
        });
      }
    }

    const emitPassengerStatus = (status, extra = {}) => {
      if (!io || !passengerId) {
        return;
      }

      const payload = {
        success: true,
        rideId: resolvedBookingId,
        bookingId: resolvedBookingId,
        paymentReferenceRideId: rideId,
        chargeId,
        amountInReais,
        status,
        timestamp: new Date().toISOString(),
        ...extra
      };

      io.to(`customer_${passengerId}`).emit('paymentConfirmed', payload);
      logStructured('info', 'Evento paymentConfirmed enviado ao passageiro', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        passengerId
      });
    };

    logStructured('info', 'Buscando dados da corrida para confirmação de pagamento', {
      service: 'woovi-routes',
      rideId,
      resolvedBookingId,
      chargeId
    });

    // ✅ Buscar dados da corrida do Redis
    let driverId = null;

    if (!sandboxConfirmation) {
      try {
        // Obter conexão Redis
        let redis = null;
        try {
          const redisPool = require('../../utils/redis-pool');
          redis = redisPool.getConnection();
        } catch (e) {
          // REMOVED logStructured('warn', '⚠️ [Webhook] Redis pool não disponível:', e.message);
        }

        if (redis) {
          // Tentar buscar de bookings:active primeiro
          const redisData = await redis.hget('bookings:active', resolvedBookingId);
          if (redisData) {
            bookingData = typeof redisData === 'string' ? JSON.parse(redisData) : redisData;
            logStructured('info', 'Corrida encontrada no Redis (bookings:active)', {
              service: 'woovi-routes',
              rideId: resolvedBookingId
            });
          } else {
            // Tentar buscar de booking:${rideId}
            const bookingKey = `booking:${resolvedBookingId}`;
            const bookingHash = await redis.hgetall(bookingKey);
            if (bookingHash && Object.keys(bookingHash).length > 0) {
              bookingData = {};
              for (const [key, value] of Object.entries(bookingHash)) {
                try {
                  bookingData[key] = JSON.parse(value);
                } catch {
                  bookingData[key] = value;
                }
              }
              logStructured('info', `Corrida encontrada no Redis (booking:${resolvedBookingId})`, {
                service: 'woovi-routes',
                rideId: resolvedBookingId
              });
            }
          }
        }
      } catch (redisError) {
        logStructured('warn', 'Erro ao buscar do Redis', {
          service: 'woovi-routes',
          error: redisError.message,
          rideId: resolvedBookingId
        });
      }
    }

    // ✅ Se não encontrou no Redis, buscar do Firestore
    if (!sandboxConfirmation && !bookingData) {
      try {
        const firebaseConfig = require('../../firebase-config');
        const firestore = firebaseConfig.getFirestore();
        if (firestore) {
          const bookingRef = firestore.collection('bookings').doc(resolvedBookingId);
          const bookingDoc = await bookingRef.get();

          if (bookingDoc.exists) {
            bookingData = bookingDoc.data();
            logStructured('info', 'Corrida encontrada no Firestore', {
              service: 'woovi-routes',
              rideId: resolvedBookingId
            });
          }
        }
      } catch (firestoreError) {
        logStructured('warn', 'Erro ao buscar do Firestore', {
          service: 'woovi-routes',
          error: firestoreError.message,
          rideId: resolvedBookingId
        });
      }
    }

    if (sandboxConfirmation) {
      logStructured('info', 'Payment intent sandbox validada antes de qualquer booking operacional', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        paymentIntentId: bookingData.paymentIntentId
      });
    }

    // ✅ Extrair driverId dos dados da corrida
    if (bookingData) {
      driverId = bookingData.driverId
        || bookingData.driver?.uid
        || bookingData.driver?.id
        || bookingData.driverId;

      logStructured('info', 'Dados da corrida', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        driverId,
        status: bookingData.status,
        passengerId: bookingData.passengerId || bookingData.customer?.uid
      });
    }

    const amountValidation = validateWebhookAmountAgainstBooking({
      bookingData,
      amountInCents,
      rideId: resolvedBookingId,
      chargeId
    });

    await auditWooviWebhookDecision({
      decision: amountValidation.ok ? 'payment_amount_validated' : 'payment_rejected',
      reason: amountValidation.code,
      signatureValid: true,
      signatureMethod: metadata?.signatureMethod || metadata?.webhookSignatureMethod || null,
      chargeId,
      correlationID: metadata?.correlationID || null,
      rideId: resolvedBookingId,
      amount: amountInCents,
      expectedAmountInCents: amountValidation.expectedAmountInCents || null,
      status: metadata?.status || null
    });

    if (!amountValidation.ok) {
      logStructured('warn', 'Pagamento rejeitado por validação antifraude do webhook', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        reason: amountValidation.code,
        expectedAmountInCents: amountValidation.expectedAmountInCents || null,
        receivedAmountInCents: amountInCents
      });
      return {
        success: false,
        error: amountValidation.code,
        status: 'REJECTED'
      };
    }

    const storeResult = await paymentService.storeConfirmedPayment({
      rideId: resolvedBookingId,
      chargeId,
      amount,
      passengerId,
      ...financialScopeEnvelope,
      metadata: {
        ...metadata,
        ...financialScopeEnvelope
      }
    });

	    if (!storeResult.success) {
	      logError(new Error(storeResult.error), 'Falha ao armazenar pagamento confirmado', {
	        service: 'woovi-routes',
	        rideId: resolvedBookingId,
	        chargeId
	      });
	    }

	    if (!storeResult.success || storeResult.ledgerPosted !== true) {
	      const ledgerError =
	        storeResult.ledgerError ||
	        storeResult.error ||
	        'PAYMENT_LEDGER_NOT_POSTED';

	      logStructured('error', 'Pagamento confirmado sem ledger postado; dispatch bloqueado', {
	        service: 'woovi-routes',
	        rideId: resolvedBookingId,
	        chargeId,
	        ledgerStatus: storeResult.ledgerStatus || 'pending_retry',
	        ledgerError
	      });

	      try {
	        await paymentService.savePaymentHolding(resolvedBookingId, {
	          status: 'ledger_pending',
	          amount: amountInCents,
	          paymentMethod: 'pix',
	          paymentId: chargeId,
	          chargeId,
	          passengerId: passengerId || null,
	          paidAt: metadata?.paidAt || new Date().toISOString(),
	          confirmedAt: new Date().toISOString(),
	          temporaryRideId: rideId || null,
	          source: 'woovi_webhook_ledger_pending',
	          ledgerStatus: storeResult.ledgerStatus || 'pending_retry',
	          ledgerError,
	          dispatchBlockedReason: 'PAYMENT_LEDGER_PENDING',
	          ...financialScopeEnvelope
	        });
	      } catch (holdingError) {
	        logStructured('warn', 'Falha ao registrar payment holding ledger_pending', {
	          service: 'woovi-routes',
	          rideId: resolvedBookingId,
	          chargeId,
	          error: holdingError.message
	        });
	      }

	      try {
	        await paymentDispatchService.markBookingPaymentConfirmed({
	          bookingId: resolvedBookingId,
	          chargeId,
	          temporaryRideId: rideId,
	          amountInCents,
	          paymentStatus: 'ledger_pending',
	          source: 'woovi_webhook_ledger_pending',
	          ...financialScopeEnvelope
	        });
	      } catch (markError) {
	        logStructured('warn', 'Falha ao marcar booking como ledger_pending no webhook', {
	          service: 'woovi-routes',
	          rideId: resolvedBookingId,
	          chargeId,
	          error: markError.message
	        });
	      }

	      emitPassengerStatus('PAYMENT_LEDGER_PENDING', {
	        ledgerStatus: storeResult.ledgerStatus || 'pending_retry'
	      });

	      return {
	        success: false,
	        rideId: resolvedBookingId,
	        chargeId,
	        status: 'LEDGER_PENDING',
	        error: 'PAYMENT_LEDGER_PENDING',
	        ledgerStatus: storeResult.ledgerStatus || 'pending_retry',
	        ledgerError
	      };
	    }

	    try {
	      await paymentService.savePaymentHolding(resolvedBookingId, {
        status: 'in_holding',
        amount: amountInCents,
        paymentMethod: 'pix',
        paymentId: chargeId,
        chargeId,
        passengerId: passengerId || null,
        paidAt: metadata?.paidAt || new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        temporaryRideId: rideId || null,
        source: 'woovi_webhook',
        ...financialScopeEnvelope
      });
    } catch (holdingError) {
      logStructured('warn', 'Falha ao materializar payment holding após webhook confirmado', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        error: holdingError.message
      });
    }

    try {
      await paymentDispatchService.markBookingPaymentConfirmed({
        bookingId: resolvedBookingId,
        chargeId,
        temporaryRideId: rideId,
        amountInCents,
        paymentStatus: 'in_holding',
        source: 'woovi_webhook',
        ...financialScopeEnvelope
      });
    } catch (markError) {
      logStructured('warn', 'Falha ao marcar booking como pago no webhook', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        error: markError.message
      });
    }

    try {
      await redisPool.ensureConnection();
      const redis = redisPool.getConnection();
      const extensionResult = await applyConfirmedRideExtension({
        redis,
        bookingId: resolvedBookingId,
        chargeId,
        amountInCents,
        io,
        source: 'woovi_webhook',
        ...financialScopeEnvelope
      });

      if (extensionResult?.success && !extensionResult?.skipped) {
        logStructured('info', 'Extensão confirmada automaticamente após webhook de pagamento', {
          service: 'woovi-routes',
          rideId: resolvedBookingId,
          chargeId
        });
      }
    } catch (extensionError) {
      logStructured('warn', 'Falha ao aplicar extensão confirmada após webhook', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        error: extensionError.message
      });
    }

    const rideStatus = (bookingData?.status || 'pending').toUpperCase();

    if (driverId) {
      await paymentService.associateDriverToPayment(
        resolvedBookingId,
        driverId,
        financialScopeEnvelope
      );

      const completedStatuses = ['COMPLETED', 'FINISHED', 'FINALIZED', 'DONE'];
      if (completedStatuses.includes(rideStatus)) {
        emitPassengerStatus('AWAITING_LEDGER_SETTLEMENT', { driverId, amount });
      } else {
        emitPassengerStatus('AWAITING_TRIP_COMPLETION', { driverId });
      }
    } else {
      emitPassengerStatus('AWAITING_DRIVER');
    }

    paymentDispatchService.triggerDispatchAfterPayment({
      bookingId: resolvedBookingId,
      io,
      pickupLocation: bookingData?.pickupLocation || null,
      source: 'woovi_webhook_payment_confirmed',
      force: true,
      ...financialScopeEnvelope,
      maxAttempts: Number.parseInt(process.env.WEBHOOK_PAYMENT_DISPATCH_MAX_ATTEMPTS || '120', 10),
      retryDelayMs: Number.parseInt(process.env.WEBHOOK_PAYMENT_DISPATCH_RETRY_DELAY_MS || '1000', 10)
    }).then((dispatchResult) => {
      logStructured('info', 'Dispatch pós-pagamento (webhook) processado', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        success: Boolean(dispatchResult?.success),
        skipped: Boolean(dispatchResult?.skipped),
        reason: dispatchResult?.reason || null,
        attempts: dispatchResult?.attempts || 1
      });
    }).catch((dispatchError) => {
      logStructured('warn', 'Falha ao acionar dispatch pós-pagamento (webhook)', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        error: dispatchError.message
      });
    });

    return {
      success: true,
      rideId: resolvedBookingId,
      chargeId,
      status: 'confirmed',
      ...financialScopeEnvelope
    };

  } catch (error) {
    logError(error, 'Erro ao processar confirmação de pagamento', { service: 'woovi-routes', chargeId, rideId });
    return {
      success: false,
      error: error.message
    };
  }
}

// ==================== STUB HANDLERS PARA WEBHOOKS ====================
// Para evitar erros de "is not defined" e garantir retorno 200 OK para a Woovi

async function handleChargeCreated(data) {
  logStructured('info', 'Webhook Handler: Nova cobrança criada registrada no sistema (stub)', { service: 'woovi-routes' });
}

async function handleChargeExpired(data) {
  const paymentDispatchService = require('../../services/payment-dispatch-service');
  const redisPool = require('../../utils/redis-pool');
  const { expirePendingRideExtension } = require('../../services/ride-lifecycle-service');

  const charge = data?.charge || data?.data || {};
  const chargeId =
    charge?.identifier ||
    charge?.id ||
    charge?.transactionID ||
    data?.identifier ||
    data?.id ||
    data?.transactionID ||
    null;

  if (!chargeId) {
    logStructured('warn', 'Webhook Handler: Cobrança expirada sem chargeId', {
      service: 'woovi-routes'
    });
    return;
  }

  let resolvedBookingId = null;
  try {
    resolvedBookingId = await paymentDispatchService.resolveBookingIdFromPaymentRefs({
      bookingId: data?.rideId || data?.bookingId || null,
      chargeId,
      temporaryRideId: data?.rideId || data?.correlationID || null
    });
  } catch (resolveError) {
    logStructured('warn', 'Webhook Handler: não foi possível resolver booking da cobrança expirada', {
      service: 'woovi-routes',
      chargeId,
      error: resolveError.message
    });
  }

  if (!resolvedBookingId) {
    logStructured('warn', 'Webhook Handler: cobrança expirada sem booking vinculado', {
      service: 'woovi-routes',
      chargeId
    });
    return;
  }

  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const result = await expirePendingRideExtension({
    redis,
    bookingId: resolvedBookingId,
    chargeId,
    io: data?.io || null,
    source: 'woovi_charge_expired_webhook',
    reason: 'PAYMENT_TIMEOUT'
  });

  logStructured('info', 'Webhook Handler: cobrança expirada processada', {
    service: 'woovi-routes',
    chargeId,
    bookingId: resolvedBookingId,
    skipped: Boolean(result?.skipped),
    reason: result?.reason || null
  });
}

async function handleTransactionReceived(data, io = null) {
  const charge = data?.charge || data?.data || {};
  const chargeId =
    charge?.identifier ||
    charge?.id ||
    charge?.transactionID ||
    data?.identifier ||
    data?.id ||
    data?.transactionID ||
    null;
  const statusRaw = charge?.status || data?.status || '';
  const status = String(statusRaw || '').toUpperCase();

  logStructured('info', 'Webhook Handler: Transação recebida', {
    service: 'woovi-routes',
    chargeId,
    status: status || 'N/A'
  });

  if (!chargeId) {
    return;
  }

  const normalizedPayload = {
    ...data,
    event: data?.event || 'OPENPIX:TRANSACTION_RECEIVED',
    charge: {
      ...charge,
      identifier: chargeId,
      status: status || 'COMPLETED'
    }
  };

  await handleChargeCompleted(normalizedPayload, io);
}

async function handleRefundReceivedConfirmed(data) {
  logStructured('info', 'Webhook Handler: Reembolso recebido e confirmado (stub)', { service: 'woovi-routes' });
}

async function handleRefundReceivedRejected(data) {
  logStructured('info', 'Webhook Handler: Reembolso recebido, mas rejeitado (stub)', { service: 'woovi-routes' });
}

async function handleRefundSentConfirmed(data) {
  logStructured('info', 'Webhook Handler: Reembolso enviado e confirmado (stub)', { service: 'woovi-routes' });
}

async function handleAccountApproved(data) {
  logStructured('info', 'Webhook Handler: Conta BaaS aprovada (stub)', { service: 'woovi-routes' });
}

async function handleChargeCompletedDifferentPayer(data) {
  logStructured('info', 'Webhook Handler: Pagamento concluído por um pagador diferente (stub)', { service: 'woovi-routes' });
}

module.exports = {
  express,
  axios,
  crypto,
  admin,
  router,
  logStructured,
  logError,
  getWooviConfig,
  getWooviAuthHeaders,
  getDefaultWooviWebhookPublicKey,
  authenticateJWT,
  requireRole,
  FINANCIAL_COLLECTIONS,
  resolveFinancialContext,
  getFinancialCollections,
  hasSandboxSignal,
  resolveRidePersistenceScope,
  WOOVI_CONFIG,
  WOOVI_ADMIN_ROLES,
  WOOVI_SANDBOX_TEST_ROLES,
  WOOVI_SANDBOX_TEST_PAYMENT_URL,
  legacyWooviAliasRouteEnabled,
  COMPLETED_WEBHOOK_EVENTS,
  COMPLETED_PAYMENT_STATUSES,
  normalizeEventName,
  normalizePaymentStatus,
  readBooleanEnv,
  parseTimestampMs,
  resolveWebhookStaleProcessingMs,
  isRetryableWebhookEvent,
  normalizeBearerToken,
  canSandboxTestPaymentActorConfirm,
  authenticateFirebaseSandboxPaymentActor,
  extractWebhookChargePayload,
  validateSandboxTestWebhookPayload,
  parsePaymentIntentTimestampMs,
  evaluateSandboxPaymentIntentFreshness,
  resolveSandboxTestWebhookPayload,
  hasSandboxPaymentConfirmationSignal,
  getPaymentIntentIdFromConfirmationMetadata,
  resolveSandboxPaymentIntentAsBooking,
  getConfiguredWebhookAuthorizationValues,
  getWebhookAuthorizationCandidates,
  sanitizeProviderBody,
  getWooviSandboxTestPaymentUrl,
  firstConfiguredValue,
  resolveWooviSandboxTestAuthorization,
  requestWooviSandboxTestPayment,
  verifyWebhookAuthorization,
  isProductionRuntime,
  isWooviSandboxRuntime,
  getWebhookRawBody,
  safeEqualString,
  getSignatureCandidates,
  verifyHmacSignature,
  normalizePemKey,
  decodeSignatureCandidate,
  verifyPublicKeySignature,
  verifyWooviWebhookSignature,
  auditWooviWebhookDecision,
  beginWooviWebhookIdempotency,
  completeWooviWebhookIdempotency,
  parseAmountCandidateToCents,
  extractExpectedBookingAmountInCents,
  validateWebhookAmountAgainstBooking,
  normalizeAdditionalInfo,
  getAdditionalInfoValue,
  ensureWooviCredentials,
  ensureWooviMasterCredentials,
  handleSandboxTestPaymentConfirmation,
  forwardToCanonicalWooviWebhook,
  handleChargeCompleted,
  processExtensionConfirmation,
  processPaymentConfirmation,
  handleChargeCreated,
  handleChargeExpired,
  handleTransactionReceived,
  handleRefundReceivedConfirmed,
  handleRefundReceivedRejected,
  handleRefundSentConfirmed,
  handleAccountApproved,
  handleChargeCompletedDifferentPayer,
};
