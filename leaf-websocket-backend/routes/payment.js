const express = require('express');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const PaymentService = require('../services/payment-service');
const paymentRuntimeProfileService = require('../services/payment-runtime-profile-service');
const kycPolicyService = require('../services/kyc-policy-service');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const passengerDiscountBenefitService = require('../services/passenger-discount-benefit-service');
const {
  buildPaymentAvailabilityInput,
  hasPaymentEligibleDriver
} = require('../services/payment-driver-availability-guard');
const {
  DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS
} = require('../services/payment-driver-reservation-service');
const {
  validateQuoteLock,
  validateQuoteLockPayload
} = require('../services/quote-lock-service');
const { logStructured, logError } = require('../utils/logger');
const { resolveJwtSecret } = require('../utils/jwt-secret-resolver');
const { getAdminUser } = require('../utils/admin-user-cache');
const {
  isLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload
} = require('../utils/pilot-launch-flags');
const router = express.Router();

const paymentService = new PaymentService();
const PAYMENT_JWT_SECRET = resolveJwtSecret(['JWT_SECRET', 'ADMIN_JWT_SECRET'], {
  context: 'payment-routes'
});
const PAYMENT_ADMIN_ROLES = ['admin', 'super-admin', 'manager'];
const APP_PASSWORD_COLLECTION = 'auth_password_credentials';
const WITHDRAWAL_PASSWORD_FAILED_ATTEMPTS_LIMIT = Number.parseInt(
  process.env.AUTH_PASSWORD_FAILED_ATTEMPTS_LIMIT || '5',
  10
);
const WITHDRAWAL_PASSWORD_LOCKOUT_SECONDS = Number.parseInt(
  process.env.AUTH_PASSWORD_LOCKOUT_SECONDS || '900',
  10
);

function isLegacyManualPaymentDistributionEnabled() {
  return String(process.env.ENABLE_LEGACY_MANUAL_PAYMENT_DISTRIBUTION || 'false').toLowerCase() === 'true';
}

function shouldRequireQuoteLockForPayment() {
  const configured = process.env.REQUIRE_PAYMENT_QUOTE_LOCK;
  if (configured !== undefined) {
    return String(configured).toLowerCase() === 'true';
  }
  return process.env.NODE_ENV !== 'test';
}

function resolveQuoteLockFailureStatus(code) {
  if (code === 'QUOTE_LOCK_REQUIRED') return 400;
  if (code === 'QUOTE_LOCK_STORE_UNAVAILABLE') return 503;
  if (code === 'QUOTE_LOCK_NOT_FOUND_OR_EXPIRED' || code === 'QUOTE_LOCK_EXPIRED') return 409;
  if (String(code || '').includes('MISMATCH')) return 409;
  return 400;
}

function resolveAdvancePaymentFailureStatus(code) {
  const normalized = String(code || '').toUpperCase();
  if (normalized === 'PAYMENT_SESSION_CONSUMED' || normalized === 'PAYMENT_INTENT_CONFLICT') return 409;
  if (
    normalized === 'PAYMENT_PROFILE_CREDENTIALS_MISSING' ||
    normalized === 'PAYMENT_INTENT_STORE_UNAVAILABLE'
  ) {
    return 503;
  }
  if (normalized.includes('WOOVI') || normalized.includes('PROVIDER')) return 502;
  return 400;
}

function canRecoverQuoteLockFromIntentSnapshot(code) {
  return code === 'QUOTE_LOCK_NOT_FOUND_OR_EXPIRED' || code === 'QUOTE_LOCK_EXPIRED';
}

async function validateQuoteLockFromPaymentIntentSnapshot({
  rideId,
  quoteLockId,
  quoteSessionId,
  passengerId,
  amountInCents,
  grossAmountInCents,
  pickupLocation,
  destinationLocation,
  carType,
  toleranceInCents
} = {}) {
  const safeRideId = String(rideId || '').trim();
  const safeQuoteLockId = String(quoteLockId || '').trim();
  const safePassengerId = String(passengerId || '').trim();
  if (!safeRideId || !safeQuoteLockId || !safePassengerId) return null;

  const firestore = firebaseConfig.getFirestore();
  if (!firestore) return null;

  const paymentIntentId = paymentService.buildAdvancePaymentIntentId(safeRideId);
  let paymentIntentSnapshot = await firestore.collection('payment_intents').doc(paymentIntentId).get();
  let recoveredPaymentIntentId = paymentIntentId;

  if (!paymentIntentSnapshot.exists) {
    const candidates = await firestore
      .collection('payment_intents')
      .where('passengerId', '==', safePassengerId)
      .where('quoteLockId', '==', safeQuoteLockId)
      .limit(20)
      .get();
    const candidateDoc = candidates.docs
      .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
      .filter(({ data }) => data.quoteLockSnapshot)
      .sort((left, right) => {
        const leftTime = Date.parse(left.data.updatedAtIso || left.data.createdAtIso || '') || 0;
        const rightTime = Date.parse(right.data.updatedAtIso || right.data.createdAtIso || '') || 0;
        return rightTime - leftTime;
      })[0];
    if (!candidateDoc) return null;
    recoveredPaymentIntentId = candidateDoc.id;
    paymentIntentSnapshot = {
      exists: true,
      data: () => candidateDoc.data
    };
  }

  const intent = paymentIntentSnapshot.data() || {};
  const intentPassengerId = String(intent.passengerId || '').trim();
  const intentRideId = String(intent.rideId || '').trim();
  const intentQuoteLockId = String(intent.quoteLockId || intent.quoteLockSnapshot?.quoteLockId || '').trim();
  const status = String(intent.status || '').trim().toLowerCase();

  if (status === 'consumed') return null;
  if (recoveredPaymentIntentId === paymentIntentId && intentRideId && intentRideId !== safeRideId) return null;
  if (intentPassengerId && intentPassengerId !== safePassengerId) return null;
  if (intentQuoteLockId && intentQuoteLockId !== safeQuoteLockId) return null;
  if (!intent.quoteLockSnapshot) return null;

  const validation = validateQuoteLockPayload({
    quoteLock: intent.quoteLockSnapshot,
    quoteSessionId,
    passengerId,
    amountInCents,
    grossAmountInCents,
    pickupLocation,
    destinationLocation,
    carType,
    toleranceInCents,
    allowExpired: true
  });

  if (!validation.success) return validation;
  return {
    ...validation,
    recoveredFromPaymentIntentSnapshot: true,
    paymentIntentId: recoveredPaymentIntentId
  };
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function buildPaymentRequestLogContext(req, extra = {}) {
  const body = req.body || {};
  return {
    service: 'payment-routes',
    method: req.method,
    path: req.originalUrl || req.path,
    requestId: req.headers['x-request-id'] || req.headers['x-correlation-id'] || null,
    passengerId: body.passengerId || null,
    rideId: body.rideId || body.paymentSessionId || null,
    paymentSessionId: body.paymentSessionId || null,
    quoteSessionId: body.quoteSessionId || null,
    quoteLockId: body.quoteLockId || null,
    actorId: req.paymentActor?.uid || req.paymentActor?.id || null,
    actorType: req.paymentActor?.type || null,
    ...extra
  };
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function hashPhoneForPasswordLookup(phoneDigits) {
  const pepper = process.env.AUTH_PASSWORD_PHONE_HASH_PEPPER || process.env.JWT_SECRET || 'leaf-phone-hash';
  return crypto.createHmac('sha256', pepper).update(String(phoneDigits || '')).digest('hex');
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function buildActorIdentifiers(actor = {}) {
  const identifiers = new Set();
  [
    actor.uid,
    actor.id,
    actor.userId,
    actor.phoneNumber,
    actor.phone_number,
    actor.phone
  ].forEach((value) => {
    if (!value) return;
    const stringValue = String(value);
    identifiers.add(stringValue);
    const digits = normalizeDigits(stringValue);
    if (digits) identifiers.add(digits);
  });
  return identifiers;
}

function actorMatchesId(actor, candidateId) {
  if (!candidateId) return false;
  const identifiers = buildActorIdentifiers(actor);
  const candidate = String(candidateId);
  return identifiers.has(candidate) || identifiers.has(normalizeDigits(candidate));
}

function isPaymentAdmin(actor, roles = PAYMENT_ADMIN_ROLES) {
  return Boolean(actor && actor.type === 'admin' && roles.includes(actor.role));
}

async function authenticatePaymentActor(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    logStructured('warn', 'payment auth bloqueado por token ausente', buildPaymentRequestLogContext(req, {
      code: 'PAYMENT_AUTH_TOKEN_MISSING'
    }));
    return res.status(401).json({
      success: false,
      error: 'Token não fornecido',
      code: 'PAYMENT_AUTH_TOKEN_MISSING'
    });
  }

  let firebaseAuthError = null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const actor = {
      type: 'firebase',
      uid: decoded.uid,
      id: decoded.uid,
      phoneNumber: decoded.phone_number || decoded.phoneNumber || null,
      email: decoded.email || null,
      role: decoded.role || decoded.userType || decoded.user_type || 'user'
    };
    req.paymentActor = actor;
    req.user = req.user || actor;
    return next();
  } catch (firebaseError) {
    firebaseAuthError = firebaseError;
    // Admin dashboard uses its own JWT. We only fall through to that verifier here.
  }

  try {
    const decoded = jwt.verify(token, PAYMENT_JWT_SECRET);
    const userId = decoded.userId || decoded.id || decoded.sub;
    if (!userId) {
      logStructured('warn', 'payment auth bloqueado por JWT sem usuário', buildPaymentRequestLogContext(req, {
        code: 'PAYMENT_AUTH_JWT_USER_MISSING'
      }));
      return res.status(401).json({
        success: false,
        error: 'Token inválido',
        code: 'PAYMENT_AUTH_TOKEN_INVALID'
      });
    }

    const userRecord = await getAdminUser(userId, {
      source: 'payment-routes.authenticatePaymentActor',
      maxAgeMs: 15 * 1000
    });
    if (!userRecord.exists || userRecord.data?.active === false) {
      logStructured('warn', 'payment auth bloqueado por admin inexistente ou inativo', buildPaymentRequestLogContext(req, {
        code: 'PAYMENT_AUTH_ADMIN_INACTIVE',
        adminUserId: userId
      }));
      return res.status(403).json({
        success: false,
        error: 'Usuário não encontrado ou inativo',
        code: 'PAYMENT_AUTH_ADMIN_INACTIVE'
      });
    }

    const userData = userRecord.data || {};
    const actor = {
      type: 'admin',
      uid: userId,
      id: userId,
      email: decoded.email || userData.email || null,
      role: decoded.role || userData.role || 'viewer',
      permissions: decoded.permissions || userData.permissions || []
    };
    req.paymentActor = actor;
    req.user = actor;
    return next();
  } catch (jwtError) {
    logStructured('warn', 'payment auth bloqueado por token inválido', buildPaymentRequestLogContext(req, {
      code: 'PAYMENT_AUTH_TOKEN_INVALID',
      firebaseAuthCode: firebaseAuthError?.code || null,
      jwtError: jwtError?.name || null
    }));
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado',
      code: 'PAYMENT_AUTH_TOKEN_INVALID'
    });
  }
}

function requirePaymentAdmin(roles = PAYMENT_ADMIN_ROLES) {
  return (req, res, next) => {
    if (!req.paymentActor) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado'
      });
    }

    if (!isPaymentAdmin(req.paymentActor, roles)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso financeiro negado',
        required: roles,
        userRole: req.paymentActor.role || 'unknown'
      });
    }

    return next();
  };
}

function requirePassengerScope(req, res, next) {
  const passengerId = req.body?.passengerId;
  if (isPaymentAdmin(req.paymentActor) || actorMatchesId(req.paymentActor, passengerId)) {
    return next();
  }

  logStructured('warn', 'payment auth bloqueado por passageiro divergente', buildPaymentRequestLogContext(req, {
    code: 'PAYMENT_PASSENGER_SCOPE_MISMATCH',
    passengerId: passengerId || null
  }));
  return res.status(403).json({
    success: false,
    error: 'Passageiro não autorizado para esta operação',
    code: 'PAYMENT_PASSENGER_SCOPE_MISMATCH'
  });
}

function requireDriverScopeFromParam(req, res, next) {
  const driverId = req.params?.driverId;
  if (isPaymentAdmin(req.paymentActor) || actorMatchesId(req.paymentActor, driverId)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Motorista não autorizado para esta operação'
  });
}

function blockManualPaymentConfirmationInProduction(req, res, next) {
  const manualConfirmationEnabled =
    String(process.env.ENABLE_MANUAL_PAYMENT_CONFIRMATION || 'false').toLowerCase() === 'true';

  if (process.env.NODE_ENV === 'production' && !manualConfirmationEnabled) {
    return res.status(403).json({
      success: false,
      error: 'Confirmação manual de pagamento desabilitada em produção',
      code: 'MANUAL_PAYMENT_CONFIRMATION_DISABLED'
    });
  }

  return next();
}

function respondWithdrawalsDisabled(res) {
  return res.status(503).json(
    buildLaunchFeatureDisabledPayload(
      'driver_withdrawals',
      'Saque do motorista esta desativado neste perfil de lancamento'
    )
  );
}

/**
 * GET /api/payment/runtime-profiles
 * Lista perfis de roteamento de pagamento (produção/sandbox) usados pelo backend.
 */
router.get('/payment/runtime-profiles', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || 'true').toLowerCase() !== 'false';
    const result = await paymentRuntimeProfileService.listProfiles({ includeInactive });
    return res.status(result.success ? 200 : 503).json(result);
  } catch (error) {
    logError(error, 'Erro ao listar perfis de pagamento', { service: 'payment-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/payment/runtime-profiles
 * Cria/atualiza um perfil. Sandbox exige expiração e allowlist por segurança.
 */
router.post('/payment/runtime-profiles', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    const result = await paymentRuntimeProfileService.upsertProfile(req.body || {}, req.paymentActor);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logError(error, 'Erro ao salvar perfil de pagamento', { service: 'payment-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * PATCH /api/payment/runtime-profiles/:profileId/status
 * Pausa/ativa/arquiva um perfil sem rebuild do app.
 */
router.patch('/payment/runtime-profiles/:profileId/status', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    const result = await paymentRuntimeProfileService.updateProfileStatus(
      req.params.profileId,
      req.body?.status,
      req.paymentActor
    );
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logError(error, 'Erro ao atualizar status do perfil de pagamento', { service: 'payment-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/payment/runtime-profiles/resolve
 * Diagnóstico seguro: mostra qual perfil seria usado para um usuário/canary.
 */
router.post('/payment/runtime-profiles/resolve', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    const profile = await paymentRuntimeProfileService.resolveProfile({
      passengerId: req.body?.passengerId || req.body?.userId,
      userId: req.body?.userId || req.body?.passengerId,
      phone: req.body?.phone || req.body?.phoneNumber,
      phoneNumber: req.body?.phoneNumber || req.body?.phone,
      appReview: Boolean(req.body?.appReview),
      actor: req.paymentActor
    });
    return res.json({
      success: true,
      profile: {
        profileId: profile.profileId,
        name: profile.name,
        provider: profile.provider,
        environment: profile.environment,
        scope: profile.scope,
        source: profile.source,
        reason: profile.reason,
        expiresAtIso: profile.expiresAtIso || null,
        hasWooviToken: Boolean(profile.wooviConfig?.apiToken),
        baseUrlMode: String(profile.wooviConfig?.baseUrl || '').includes('sandbox') ? 'sandbox' : 'production'
      }
    });
  } catch (error) {
    logError(error, 'Erro ao resolver perfil de pagamento', { service: 'payment-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

function normalizePaymentAmountCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeMoneyReais(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string'
    ? value.replace(/[^\d,.-]/g, '').replace(',', '.')
    : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Number(parsed.toFixed(2)));
}

function resolvePaymentTollAmounts({
  quoteLockValidation = null,
  tollFee = null,
  tollFeeCents = null,
  rideDetails = null
} = {}) {
  const quoteLock = quoteLockValidation?.success ? quoteLockValidation.quoteLock : null;
  if (quoteLock) {
    const lockedCents = normalizePaymentAmountCents(quoteLock.tollFeeCents);
    if (Number.isFinite(Number(quoteLock.tollFeeCents))) {
      return {
        tollFee: Number((lockedCents / 100).toFixed(2)),
        tollFeeCents: lockedCents
      };
    }

    const lockedReais = normalizeMoneyReais(
      quoteLock.tollFee ??
        quoteLock.tollAmount ??
        quoteLock.pricingPayload?.toll_fee ??
        quoteLock.pricingPayload?.tollFee
    ) ?? 0;
    return {
      tollFee: lockedReais,
      tollFeeCents: normalizePaymentAmountCents(lockedReais * 100)
    };
  }

  if (Number.isFinite(Number(tollFeeCents))) {
    const cents = normalizePaymentAmountCents(tollFeeCents);
    return {
      tollFee: Number((cents / 100).toFixed(2)),
      tollFeeCents: cents
    };
  }

  const incomingReais = normalizeMoneyReais(
    tollFee ??
      rideDetails?.tollFee ??
      rideDetails?.tollAmount ??
      rideDetails?.pricingPayload?.toll_fee ??
      rideDetails?.pricingPayload?.tollFee
  ) ?? 0;
  return {
    tollFee: incomingReais,
    tollFeeCents: normalizePaymentAmountCents(incomingReais * 100)
  };
}

async function validatePassengerDiscountPayload({
  passengerId,
  amount,
  discountBenefit,
  grossAmountInCents,
  grossAmount,
}) {
  const amountInCents = normalizePaymentAmountCents(amount);
  const grossInCents = grossAmountInCents !== undefined && grossAmountInCents !== null
    ? normalizePaymentAmountCents(grossAmountInCents)
    : normalizePaymentAmountCents(Number(grossAmount || 0) * 100);
  const benefitId = String(
    discountBenefit?.benefitId ||
    discountBenefit?.id ||
    ''
  ).trim();
  const hasDiscountContract =
    Boolean(discountBenefit?.applied) ||
    Boolean(benefitId) ||
    (grossInCents > 0 && amountInCents > 0 && amountInCents < grossInCents);

  if (!hasDiscountContract) {
    return {
      ok: true,
      grossAmountInCents: grossInCents || amountInCents,
      payableAmountInCents: amountInCents,
      discountBenefit: null,
    };
  }

  if (!grossInCents || grossInCents < amountInCents) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        success: false,
        error: 'Contrato de desconto inválido',
        code: 'PASSENGER_DISCOUNT_GROSS_AMOUNT_INVALID',
      },
    };
  }

  const preview = await passengerDiscountBenefitService.previewDiscount({
    userId: passengerId,
    grossAmountCents: grossInCents,
    benefitId,
  });

  if (!preview.applied) {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        success: false,
        error: 'Desconto de convite indisponível para este passageiro',
        code: 'PASSENGER_DISCOUNT_NOT_AVAILABLE',
      },
    };
  }

  if (normalizePaymentAmountCents(preview.payableAmountInCents) !== amountInCents) {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        success: false,
        error: 'Valor do pagamento diverge do desconto ativo',
        code: 'PASSENGER_DISCOUNT_AMOUNT_MISMATCH',
        expectedAmountInCents: preview.payableAmountInCents,
        receivedAmountInCents: amountInCents,
      },
    };
  }

  return {
    ok: true,
    grossAmountInCents: grossInCents,
    payableAmountInCents: amountInCents,
    discountBenefit: preview,
  };
}

async function resolveWithdrawalActorPhoneDigits(actor, driverId) {
  const actorPhoneDigits = normalizeDigits(actor?.phoneNumber || actor?.phone_number || actor?.phone);
  if (actorPhoneDigits) return actorPhoneDigits;

  try {
    const authUser = await admin.auth().getUser(driverId);
    return normalizeDigits(authUser?.phoneNumber || authUser?.phone_number);
  } catch (error) {
    logStructured('warn', 'Nao foi possivel resolver telefone para validar senha de saque', {
      service: 'payment-routes',
      driverId,
      error: error.message
    });
    return '';
  }
}

async function verifyWithdrawalAppPassword({ actor, driverId, password }) {
  const appPassword = String(password || '');
  if (!appPassword) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        success: false,
        error: 'Senha do app é obrigatória para solicitar saque',
        code: 'WITHDRAWAL_PASSWORD_REQUIRED'
      }
    };
  }

  const firestore = firebaseConfig.getFirestore();
  if (!firestore) {
    return {
      ok: false,
      statusCode: 500,
      payload: {
        success: false,
        error: 'Firestore não disponível para validar senha do app',
        code: 'WITHDRAWAL_PASSWORD_UNAVAILABLE'
      }
    };
  }

  const phoneDigits = await resolveWithdrawalActorPhoneDigits(actor, driverId);
  if (!phoneDigits) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        success: false,
        error: 'Telefone do motorista não disponível para validar senha do app',
        code: 'WITHDRAWAL_PASSWORD_PHONE_REQUIRED'
      }
    };
  }

  const phoneHash = hashPhoneForPasswordLookup(phoneDigits);
  const credentialRef = firestore.collection(APP_PASSWORD_COLLECTION).doc(phoneHash);
  const credentialDoc = await credentialRef.get();
  const credential = credentialDoc.exists ? credentialDoc.data() : null;

  if (!credential?.passwordHash || !credential?.uid) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        success: false,
        error: 'Senha do app não configurada. Configure a senha antes de solicitar saque.',
        code: 'WITHDRAWAL_PASSWORD_NOT_CONFIGURED'
      }
    };
  }

  if (!actorMatchesId({ ...actor, uid: credential.uid, id: credential.uid }, driverId)) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        success: false,
        error: 'Senha do app não pertence ao motorista autenticado',
        code: 'WITHDRAWAL_PASSWORD_OWNER_MISMATCH'
      }
    };
  }

  const lockedUntil = timestampToDate(credential.lockedUntil);
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    return {
      ok: false,
      statusCode: 423,
      payload: {
        success: false,
        error: 'Conta temporariamente bloqueada por tentativas inválidas',
        code: 'WITHDRAWAL_PASSWORD_LOCKED',
        lockedUntil: lockedUntil.toISOString()
      }
    };
  }

  const passwordMatches = await bcrypt.compare(appPassword, credential.passwordHash);
  if (!passwordMatches) {
    const failedAttempts = Number(credential.failedAttempts || 0) + 1;
    const shouldLock = failedAttempts >= WITHDRAWAL_PASSWORD_FAILED_ATTEMPTS_LIMIT;
    await credentialRef.set({
      failedAttempts,
      lockedUntil: shouldLock
        ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + WITHDRAWAL_PASSWORD_LOCKOUT_SECONDS * 1000))
        : null,
      lastFailedWithdrawalPasswordAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    logStructured('warn', 'Senha do app invalida para saque', {
      service: 'payment-routes',
      driverId,
      phoneLast4: phoneDigits.slice(-4),
      failedAttempts,
      locked: shouldLock
    });

    return {
      ok: false,
      statusCode: 401,
      payload: {
        success: false,
        error: 'Senha do app inválida',
        code: shouldLock ? 'WITHDRAWAL_PASSWORD_LOCKED' : 'WITHDRAWAL_PASSWORD_INVALID'
      }
    };
  }

  await credentialRef.set({
    failedAttempts: 0,
    lockedUntil: null,
    lastWithdrawalPasswordVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logStructured('info', 'Senha do app validada para saque', {
    service: 'payment-routes',
    driverId,
    phoneLast4: phoneDigits.slice(-4)
  });

  return { ok: true };
}

/**
 * POST /api/payment/advance
 * Processa pagamento antecipado do passageiro
 */
router.post('/payment/advance', authenticatePaymentActor, requirePassengerScope, async (req, res) => {
  try {
    const {
      passengerId,
      amount,
      rideId,
      rideDetails,
      passengerName,
      passengerEmail,
      driverId,
      driverPixKey,
      driverSubaccountPixKey,
      wooviSubaccountPixKey,
      subaccountPixKey,
      tollFee,
      tollFeeCents,
      discountBenefit,
      grossAmountInCents,
      grossAmount,
      passengerPhone,
      phone,
      phoneNumber,
      paymentSessionId,
      paymentContextKey,
      quoteSessionId,
      quoteLockId,
      pickupLocation,
      destinationLocation,
      preferences,
      carType,
      vehicle,
      vehicleCategory
    } = req.body;

    // Validações básicas
    if (!passengerId || !amount || (!rideId && !paymentSessionId) || !rideDetails) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios não fornecidos',
        required: ['passengerId', 'amount', 'rideId|paymentSessionId', 'rideDetails']
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valor deve ser maior que zero'
      });
    }

    const availabilityInput = buildPaymentAvailabilityInput({
      pickupLocation,
      destinationLocation,
      preferences,
      carType,
      vehicle,
      vehicleCategory,
      rideDetails
    });

    let quoteLockValidation = null;
    let authoritativeAmountInCents = normalizePaymentAmountCents(amount);
    let authoritativeGrossAmountInCents =
      grossAmountInCents !== undefined && grossAmountInCents !== null
        ? normalizePaymentAmountCents(grossAmountInCents)
        : normalizePaymentAmountCents(Number(grossAmount || 0) * 100);
    const enforceQuoteLock =
      req.body?.enforceQuoteLock === true ||
      req.body?.requireQuoteLock === true ||
      shouldRequireQuoteLockForPayment();

    if (enforceQuoteLock || quoteLockId) {
      try {
        const redis = redisPool.getConnection();
        quoteLockValidation = await validateQuoteLock({
          redis,
          quoteLockId,
          quoteSessionId,
          passengerId,
          amountInCents: authoritativeAmountInCents,
          grossAmountInCents: authoritativeGrossAmountInCents,
          pickupLocation: availabilityInput.pickupLocation,
          destinationLocation: availabilityInput.destinationLocation,
          carType: availabilityInput.carType,
          toleranceInCents: Number.parseInt(process.env.PAYMENT_QUOTE_LOCK_TOLERANCE_CENTS || '1', 10) || 1
        });
      } catch (quoteLockError) {
        quoteLockValidation = {
          success: false,
          code: 'QUOTE_LOCK_STORE_UNAVAILABLE',
          error: quoteLockError.message
        };
      }

      if (
        !quoteLockValidation?.success &&
        canRecoverQuoteLockFromIntentSnapshot(quoteLockValidation?.code)
      ) {
        try {
          const recoveredQuoteLockValidation = await validateQuoteLockFromPaymentIntentSnapshot({
            rideId,
            quoteLockId,
            quoteSessionId,
            passengerId,
            amountInCents: authoritativeAmountInCents,
            grossAmountInCents: authoritativeGrossAmountInCents,
            pickupLocation: availabilityInput.pickupLocation,
            destinationLocation: availabilityInput.destinationLocation,
            carType: availabilityInput.carType,
            toleranceInCents: Number.parseInt(process.env.PAYMENT_QUOTE_LOCK_TOLERANCE_CENTS || '1', 10) || 1
          });

          if (recoveredQuoteLockValidation?.success) {
            quoteLockValidation = recoveredQuoteLockValidation;
            logStructured('warn', 'payment/advance recuperou quote lock expirado via payment intent snapshot', {
              service: 'payment-routes',
              passengerId,
              rideId: rideId || paymentSessionId || null,
              quoteSessionId: quoteSessionId || null,
              quoteLockId: quoteLockId || null,
              paymentIntentId: recoveredQuoteLockValidation.paymentIntentId || null,
              quoteLockExpirationBypassed: recoveredQuoteLockValidation.quoteLockExpirationBypassed === true
            });
          } else if (recoveredQuoteLockValidation) {
            quoteLockValidation = recoveredQuoteLockValidation;
          }
        } catch (recoveryError) {
          logStructured('warn', 'payment/advance falhou ao recuperar quote lock expirado via payment intent snapshot', {
            service: 'payment-routes',
            passengerId,
            rideId: rideId || paymentSessionId || null,
            quoteLockId: quoteLockId || null,
            error: recoveryError.message
          });
        }
      }

      if (!quoteLockValidation?.success) {
        const statusCode = resolveQuoteLockFailureStatus(quoteLockValidation?.code);
        logStructured(statusCode >= 500 ? 'error' : 'warn', 'payment/advance bloqueado por quote lock inválido', {
          service: 'payment-routes',
          passengerId,
          rideId: rideId || paymentSessionId || null,
          quoteSessionId: quoteSessionId || null,
          quoteLockId: quoteLockId || null,
          code: quoteLockValidation?.code || 'QUOTE_LOCK_INVALID',
          incomingAmountInCents: authoritativeAmountInCents,
          expectedAmountInCents: quoteLockValidation?.expectedAmountInCents || null
        });

        return res.status(statusCode).json({
          success: false,
          error: 'Cotação expirada ou divergente',
          message: 'Atualize a cotação antes de gerar o Pix desta corrida.',
          code: quoteLockValidation?.code || 'QUOTE_LOCK_INVALID',
          expectedAmountInCents: quoteLockValidation?.expectedAmountInCents || null,
          incomingAmountInCents: quoteLockValidation?.incomingAmountInCents || authoritativeAmountInCents
        });
      }

      authoritativeAmountInCents = quoteLockValidation.payableAmountInCents || authoritativeAmountInCents;
      authoritativeGrossAmountInCents = quoteLockValidation.grossAmountInCents || authoritativeGrossAmountInCents;
    }

    const availability = await hasPaymentEligibleDriver({
      ...availabilityInput,
      io: req.app.get('io'),
      reserveDriver: true,
      reservationTtlSeconds: DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS,
      reservationContext: {
        passengerId,
        rideId: rideId || null,
        paymentSessionId: paymentSessionId || null,
        paymentContextKey: paymentContextKey || null,
        quoteSessionId: quoteSessionId || null,
        quoteLockId: quoteLockValidation?.quoteLock?.quoteLockId || quoteLockId || null
      },
      logStructured,
      logContext: {
        service: 'payment-routes',
        passengerId,
        rideId: rideId || paymentSessionId || null,
        quoteSessionId: quoteSessionId || null
      }
    });

    if (!availability.success) {
      const statusCode = availability.code === 'PICKUP_LOCATION_REQUIRED' ? 400 : 503;
      return res.status(statusCode).json({
        success: false,
        error: statusCode === 400
          ? 'Local de embarque obrigatório para validar motoristas antes do Pix.'
          : 'Não foi possível validar motoristas disponíveis agora. Tente novamente em instantes.',
        code: availability.code || 'PAYMENT_AVAILABILITY_CHECK_FAILED'
      });
    }

    if (!availability.hasDrivers) {
      return res.status(409).json({
        success: false,
        error: 'Não há motorista disponível para essa corrida agora.',
        code: 'NO_DRIVERS_AVAILABLE',
        radiusKm: availability.radiusKm || null
      });
    }

    if (!availability.reservationId) {
      return res.status(503).json({
        success: false,
        error: 'Não foi possível reservar motorista antes do Pix. Tente novamente em instantes.',
        code: 'PAYMENT_DRIVER_RESERVATION_FAILED',
        radiusKm: availability.radiusKm || null
      });
    }

    const discountValidation = await validatePassengerDiscountPayload({
      passengerId,
      amount: authoritativeAmountInCents,
      discountBenefit,
      grossAmountInCents: authoritativeGrossAmountInCents,
      grossAmount,
    });

    if (!discountValidation.ok) {
      return res.status(discountValidation.statusCode || 400).json(discountValidation.payload);
    }

    const authoritativeTollAmounts = resolvePaymentTollAmounts({
      quoteLockValidation,
      tollFee,
      tollFeeCents,
      rideDetails
    });

    const paymentData = {
      passengerId,
      amount: authoritativeAmountInCents,
      rideId,
      paymentSessionId,
      paymentContextKey,
      quoteSessionId,
      quoteLockId: quoteLockValidation?.quoteLock?.quoteLockId || quoteLockId || null,
      quoteLockSnapshot: quoteLockValidation?.quoteLock || null,
      paymentDriverReservationId: availability.reservationId,
      paymentDriverReservationDriverId: availability.driverId || null,
      paymentDriverReservationExpiresAt: availability.reservationExpiresAt || null,
      paymentDriverReservationTtlSeconds: availability.reservationTtlSeconds || DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS,
      rideDetails,
      pickupLocation: availabilityInput.pickupLocation,
      destinationLocation: availabilityInput.destinationLocation,
      preferences: availabilityInput.preferences,
      carType: availabilityInput.carType,
      passengerName,
      passengerEmail,
      driverId,
      driverPixKey,
      driverSubaccountPixKey,
      wooviSubaccountPixKey,
      subaccountPixKey,
      tollFee: authoritativeTollAmounts.tollFee,
      tollFeeCents: authoritativeTollAmounts.tollFeeCents,
      passengerPhone: passengerPhone || phone || phoneNumber || req.paymentActor?.phoneNumber || req.paymentActor?.phone || null,
      grossAmountInCents: discountValidation.grossAmountInCents,
      payableAmountInCents: discountValidation.payableAmountInCents,
      discountBenefit: discountValidation.discountBenefit,
      actor: req.paymentActor || null
    };

    const result = await paymentService.processAdvancePayment(paymentData);

    if (result.success) {
      const chargeId =
        result.chargeId ||
        result?.charge?.id ||
        result?.charge?.identifier ||
        result?.charge?.correlationID ||
        null;
      const qrCode =
        result.qrCode ||
        result.qrCodeImage ||
        result?.charge?.qrCodeImage ||
        result?.charge?.paymentMethods?.pix?.qrCodeImage ||
        null;
      const paymentLink =
        result.paymentLink ||
        result.paymentLinkUrl ||
        result?.charge?.paymentLinkUrl ||
        result?.charge?.paymentMethods?.pix?.paymentLinkUrl ||
        null;

      res.status(200).json({
        ...result,
        chargeId,
        qrCode,
        paymentLink,
        charge: result.charge || (chargeId ? { id: chargeId, correlationID: chargeId } : undefined)
      });
    } else {
      const failureCode = result.code || 'PAYMENT_ADVANCE_FAILED';
      const statusCode = resolveAdvancePaymentFailureStatus(failureCode);
      logStructured(statusCode >= 500 ? 'error' : 'warn', 'payment/advance recusado pelo serviço de pagamento', {
        service: 'payment-routes',
        passengerId,
        rideId: paymentData.rideId || paymentData.paymentSessionId || null,
        paymentSessionId: paymentData.paymentSessionId || null,
        quoteSessionId: paymentData.quoteSessionId || null,
        quoteLockId: paymentData.quoteLockId || null,
        code: failureCode,
        provider: result.provider || 'woovi',
        providerEnvironment: result.providerEnvironment || null,
        paymentProfileId: result.paymentProfileId || null,
        paymentIntentId: result.paymentIntentId || null,
        chargeId: result.chargeId || null,
        error: result.error || null,
        providerStatus: result.details?.status || result.details?.data?.status || null
      });
      res.status(statusCode).json({
        ...result,
        code: failureCode
      });
    }

  } catch (error) {
    logError(error, '❌ Erro na rota de pagamento antecipado:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * POST /api/payment/confirm
 * Confirma pagamento e credita saldo no motorista
 */
router.post(
  '/payment/confirm',
  authenticatePaymentActor,
  requirePaymentAdmin(),
  blockManualPaymentConfirmationInProduction,
  async (req, res) => {
  try {
    const { chargeId, rideId, driverId } = req.body;

    if (!chargeId || !rideId || !driverId) {
      return res.status(400).json({
        success: false,
        error: 'chargeId, rideId e driverId são obrigatórios'
      });
    }

    const result = await paymentService.confirmPaymentAndCreditDriver(chargeId, rideId, driverId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logError(error, '❌ Erro na rota de confirmação de pagamento:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
  }
);

/**
 * POST /api/payment/refund
 * Processa reembolso quando não encontra motorista
 */
router.post('/payment/refund', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    const { rideId, bookingId, chargeId, amount, reason } = req.body;

    if ((!rideId && !bookingId && !chargeId) || !amount) {
      return res.status(400).json({
        success: false,
        error: 'rideId/bookingId ou chargeId e amount são obrigatórios'
      });
    }

    const result = await paymentService.processRideRefund({
      rideId,
      bookingId,
      chargeId,
      amount,
      reason: reason || 'No driver found',
      status: 'REFUNDED',
      metadata: {
        source: 'admin_payment_refund_route',
        actorId: req.user?.uid || req.user?.id || req.user?.email || null,
        actorRole: req.user?.role || null
      }
    });

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logError(error, '❌ Erro na rota de reembolso:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * POST /api/payment/distribute
 * Processa distribuição líquida para o motorista
 */
router.post('/payment/distribute', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    if (!isLegacyManualPaymentDistributionEnabled()) {
      return res.status(403).json({
        success: false,
        error: 'Distribuição manual desativada',
        code: 'MANUAL_PAYMENT_DISTRIBUTION_DISABLED'
      });
    }

    const { rideId, driverId, wooviClientId, totalAmount } = req.body;

    if (!rideId || !driverId || !totalAmount) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios não fornecidos',
        required: ['rideId', 'driverId', 'totalAmount']
      });
    }

    const rideData = {
      rideId,
      driverId,
      wooviClientId,
      totalAmount
    };

    const result = await paymentService.processNetDistribution(rideData);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logError(error, '❌ Erro na rota de distribuição:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * GET /api/payment/status/:chargeId
 * Verifica status de um pagamento via chargeId da Woovi
 */
router.get('/payment/status/:chargeId', authenticatePaymentActor, async (req, res) => {
  try {
    const { chargeId } = req.params;

    if (!chargeId) {
      return res.status(400).json({
        success: false,
        error: 'chargeId é obrigatório'
      });
    }

    const result = await paymentService.getPaymentStatus(chargeId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logError(error, '❌ Erro na rota de status do pagamento:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * GET /api/payment/driver-balance/:driverId
 * Obtém saldo atual do motorista
 */
router.get('/payment/driver-balance/:driverId', authenticatePaymentActor, requireDriverScopeFromParam, async (req, res) => {
  try {
    const { driverId } = req.params;
    
    if (!driverId) {
      return res.status(400).json({
        success: false,
        error: 'driverId é obrigatório'
      });
    }

    const result = await paymentService.getDriverBalance(driverId);

    if (result.success) {
      res.status(200).json({
        success: true,
        balance: result.balance,
        balanceCents: result.balanceCents,
        totalEarnings: result.totalEarnings,
        lastUpdated: result.lastUpdated,
        lastRideId: result.lastRideId,
        subscriptionPendingFeeCents: result.subscriptionPendingFeeCents || 0,
        subscriptionPendingFee: result.subscriptionPendingFee || 0,
        subscriptionPendingFeeRawCents: result.subscriptionPendingFeeRawCents || 0,
        subscriptionPendingFeeRaw: result.subscriptionPendingFeeRaw || 0,
        subscriptionStatus: result.subscriptionStatus || 'active',
        billingStatus: result.billingStatus || 'active',
        subscriptionCollectionMode: result.subscriptionCollectionMode || 'withdrawal',
        subscriptionDailyFeeCents: result.subscriptionDailyFeeCents || 0,
        subscriptionDailyFee: result.subscriptionDailyFee || 0,
        subscriptionDailyFeeNominalCents: result.subscriptionDailyFeeNominalCents || 0,
        subscriptionDailyFeeNominal: result.subscriptionDailyFeeNominal || 0,
        subscriptionDailyFeeEffectiveCents: result.subscriptionDailyFeeEffectiveCents || 0,
        subscriptionDailyFeeEffective: result.subscriptionDailyFeeEffective || 0,
        subscriptionDailyFeeSuspended: result.subscriptionDailyFeeSuspended === true,
        subscriptionDailyBillingEnabled: result.subscriptionDailyBillingEnabled === true,
        subscriptionWaveId: result.subscriptionWaveId || null,
        availableAfterSubscriptionCents: result.availableAfterSubscriptionCents || 0,
        availableAfterSubscription: result.availableAfterSubscription || 0,
        message: result.message || null
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    logError(error, '❌ Erro na rota de saldo do motorista:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * GET /api/payment/driver-balance/:driverId/transactions
 * Obtém histórico de transações do motorista
 */
router.get(
  '/payment/driver-balance/:driverId/transactions',
  authenticatePaymentActor,
  requireDriverScopeFromParam,
  async (req, res) => {
  try {
    const { driverId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    if (!driverId) {
      return res.status(400).json({
        success: false,
        error: 'driverId é obrigatório'
      });
    }

    const firestore = require('../firebase-config').getFirestore();
    
    if (!firestore) {
      return res.status(500).json({
        success: false,
        error: 'Firestore não disponível'
      });
    }

    const transactionsRef = firestore
      .collection('driver_balances')
      .doc(driverId)
      .collection('transactions')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    const snapshot = await transactionsRef.get();
    const transactions = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        type: data.type || 'credit',
        amount: data.amount || 0,
        amountInCents: data.amountInCents || 0,
        rideId: data.rideId || null,
        description: data.description || '',
        previousBalance: data.previousBalance || 0,
        newBalance: data.newBalance || 0,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      });
    });

    res.status(200).json({
      success: true,
      transactions,
      total: transactions.length
    });

  } catch (error) {
    logError(error, '❌ Erro na rota de histórico de transações:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
  }
);

/**
 * POST /api/payment/driver-balance/:driverId/withdraw
 * Solicita saque do motorista com regra de taxa:
 * - abaixo de R$500, cobra R$1,00
 */
router.post(
  '/payment/driver-balance/:driverId/withdraw',
  authenticatePaymentActor,
  requireDriverScopeFromParam,
  async (req, res) => {
  try {
    if (!isLaunchFeatureEnabled('driverWithdrawalsEnabled', false)) {
      return respondWithdrawalsDisabled(res);
    }

    const { driverId } = req.params;
    const { amount, pixKey } = req.body || {};
    const requestId = String(
      req.body?.requestId ||
      req.headers['idempotency-key'] ||
      req.headers['x-idempotency-key'] ||
      ''
    ).trim();

    if (!driverId) {
      return res.status(400).json({
        success: false,
        error: 'driverId é obrigatório'
      });
    }

    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amount deve ser um número maior que zero'
      });
    }

    if (!pixKey || String(pixKey).trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'pixKey é obrigatório'
      });
    }

    if (!requestId || requestId.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'requestId/idempotency-key é obrigatório para saque',
        code: 'WITHDRAWAL_IDEMPOTENCY_KEY_REQUIRED'
      });
    }

    const amountCents = Math.round(Number(amount) * 100);

    const passwordVerification = await verifyWithdrawalAppPassword({
      actor: req.paymentActor,
      driverId,
      password: req.body?.appPassword || req.body?.password
    });

    if (!passwordVerification.ok) {
      await paymentService.recordDriverWithdrawalDenial({
        driverId,
        amountCents,
        pixKey: String(pixKey).trim(),
        requestId,
        reason: 'password_verification_failed',
        code: passwordVerification.payload?.code || 'WITHDRAWAL_PASSWORD_FAILED',
        actorId: req.paymentActor?.id || req.paymentActor?.uid || null
      });
      return res
        .status(passwordVerification.statusCode || 403)
        .json(passwordVerification.payload);
    }

    const stepUpPolicy = await kycPolicyService.evaluateWithdrawalStepUp({
      driverId,
      amountCents
    });

    if (stepUpPolicy.requirement !== 'NONE') {
      await paymentService.recordDriverWithdrawalDenial({
        driverId,
        amountCents,
        pixKey: String(pixKey).trim(),
        requestId,
        reason: 'kyc_step_up_required',
        code: 'KYC_STEP_UP_REQUIRED',
        actorId: req.paymentActor?.id || req.paymentActor?.uid || null,
        metadata: {
          requirement: stepUpPolicy.requirement,
          riskScore: stepUpPolicy.riskScore,
          signals: stepUpPolicy.signals || []
        }
      });
      return res.status(403).json({
        success: false,
        error: 'Verificacao adicional obrigatoria antes do saque',
        code: 'KYC_STEP_UP_REQUIRED',
        kyc: {
          requirement: stepUpPolicy.requirement,
          riskScore: stepUpPolicy.riskScore,
          challengeId: stepUpPolicy.challenge?.challengeId || null,
          challengeExpiresAt: stepUpPolicy.challenge?.expiresAt || null,
          signals: stepUpPolicy.signals || [],
          verificationMaxAgeHours:
            stepUpPolicy.verificationMaxAgeHours
            || kycPolicyService.getConfig().verificationMaxAgeHours,
          verificationWindowTier: stepUpPolicy.verificationWindowTier || null
        }
      });
    }

    const result = await paymentService.requestDriverWithdrawal({
      driverId,
      amountCents,
      pixKey: String(pixKey).trim(),
      requestId
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        ...result
      });
    }

    const insufficientBalanceCodes = new Set(['WITHDRAWAL_INSUFFICIENT_BALANCE']);
    const statusCode =
      insufficientBalanceCodes.has(String(result.code || '')) ||
      String(result.error || '').toLowerCase().includes('saldo insuficiente')
        ? 400
        : 500;
    await paymentService.recordDriverWithdrawalDenial({
      driverId,
      amountCents,
      pixKey: String(pixKey).trim(),
      requestId,
      reason: insufficientBalanceCodes.has(String(result.code || '')) ? 'insufficient_balance' : 'withdrawal_request_failed',
      code: result.code || null,
      actorId: req.paymentActor?.id || req.paymentActor?.uid || null,
      metadata: {
        statusCode,
        details: result.details || null
      }
    });
    return res.status(statusCode).json({
      success: false,
      error: result.error || 'Erro ao processar saque',
      code: result.code || null,
      details: result.details || null
    });
  } catch (error) {
    logError(error, '❌ Erro na rota de saque do motorista:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
  }
);

/**
 * GET /api/payment/withdrawals/pending
 * Lista saques pendentes para processamento
 */
router.get('/payment/withdrawals/pending', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    if (!isLaunchFeatureEnabled('driverWithdrawalsEnabled', false)) {
      return respondWithdrawalsDisabled(res);
    }

    const limit = Number(req.query.limit || 50);
    const result = await paymentService.listPendingWithdrawals(limit);

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logError(error, '❌ Erro ao listar saques pendentes', { service: 'payment-routes' });
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * POST /api/payment/withdrawals/:withdrawalId/process
 * Processa saque pendente via Woovi Pix Out.
 */
router.post('/payment/withdrawals/:withdrawalId/process', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    if (!isLaunchFeatureEnabled('driverWithdrawalsEnabled', false)) {
      return respondWithdrawalsDisabled(res);
    }

    const { withdrawalId } = req.params;
    const actorId = req.body?.actorId || 'system';

    const result = await paymentService.processDriverWithdrawal(withdrawalId, actorId);
    if (result.success) {
      return res.status(200).json(result);
    }

    return res.status(400).json(result);
  } catch (error) {
    logError(error, '❌ Erro ao processar saque pendente', { service: 'payment-routes' });
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * GET /api/payment/calculate-net
 * Calcula valor líquido para uma corrida
 */
router.get('/payment/calculate-net', authenticatePaymentActor, requirePaymentAdmin(), async (req, res) => {
  try {
    const { amount } = req.query;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({
        success: false,
        error: 'amount é obrigatório e deve ser um número'
      });
    }

    const netCalculation = paymentService.calculateNetAmount(parseInt(amount));

    res.status(200).json({
      success: true,
      calculation: netCalculation
    });

  } catch (error) {
    logError(error, '❌ Erro na rota de cálculo líquido:', { service: 'payment-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

module.exports = router;
