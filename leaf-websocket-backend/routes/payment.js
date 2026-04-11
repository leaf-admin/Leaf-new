const express = require('express');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const PaymentService = require('../services/payment-service');
const kycPolicyService = require('../services/kyc-policy-service');
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

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
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
    return res.status(401).json({
      success: false,
      error: 'Token não fornecido'
    });
  }

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
    // Admin dashboard uses its own JWT. We only fall through to that verifier here.
  }

  try {
    const decoded = jwt.verify(token, PAYMENT_JWT_SECRET);
    const userId = decoded.userId || decoded.id || decoded.sub;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Token inválido'
      });
    }

    const userRecord = await getAdminUser(userId, {
      source: 'payment-routes.authenticatePaymentActor',
      maxAgeMs: 15 * 1000
    });
    if (!userRecord.exists || userRecord.data?.active === false) {
      return res.status(403).json({
        success: false,
        error: 'Usuário não encontrado ou inativo'
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
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado'
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

  return res.status(403).json({
    success: false,
    error: 'Passageiro não autorizado para esta operação'
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
 * POST /api/payment/advance
 * Processa pagamento antecipado do passageiro
 */
router.post('/payment/advance', authenticatePaymentActor, requirePassengerScope, async (req, res) => {
  try {
    const { passengerId, amount, rideId, rideDetails, passengerName, passengerEmail } = req.body;

    // Validações básicas
    if (!passengerId || !amount || !rideId || !rideDetails) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios não fornecidos',
        required: ['passengerId', 'amount', 'rideId', 'rideDetails']
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valor deve ser maior que zero'
      });
    }

    const paymentData = {
      passengerId,
      amount,
      rideId,
      rideDetails,
      passengerName,
      passengerEmail
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
      res.status(400).json(result);
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
    const { chargeId, amount, reason } = req.body;

    if (!chargeId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'chargeId e amount são obrigatórios'
      });
    }

    const result = await paymentService.processRefund(chargeId, amount, reason || 'No driver found');

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
        subscriptionStatus: result.subscriptionStatus || 'active',
        billingStatus: result.billingStatus || 'active',
        subscriptionCollectionMode: result.subscriptionCollectionMode || 'withdrawal',
        subscriptionDailyFeeCents: result.subscriptionDailyFeeCents || 0,
        subscriptionDailyFee: result.subscriptionDailyFee || 0,
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

    const stepUpPolicy = await kycPolicyService.evaluateWithdrawalStepUp({
      driverId,
      amountCents
    });

    if (stepUpPolicy.requirement !== 'NONE') {
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
            kycPolicyService.getConfig().verificationMaxAgeHours
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
