const express = require('express');
const PaymentService = require('../services/payment-service');
const { logStructured, logError } = require('../utils/logger');
const router = express.Router();

const paymentService = new PaymentService();

/**
 * POST /api/payment/advance
 * Processa pagamento antecipado do passageiro
 */
router.post('/payment/advance', async (req, res) => {
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
      res.status(200).json(result);
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
router.post('/payment/confirm', async (req, res) => {
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
});

/**
 * POST /api/payment/refund
 * Processa reembolso quando não encontra motorista
 */
router.post('/payment/refund', async (req, res) => {
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
router.post('/payment/distribute', async (req, res) => {
  try {
    const { rideId, driverId, wooviClientId, totalAmount } = req.body;

    if (!rideId || !driverId || !wooviClientId || !totalAmount) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios não fornecidos',
        required: ['rideId', 'driverId', 'wooviClientId', 'totalAmount']
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
router.get('/payment/status/:chargeId', async (req, res) => {
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
router.get('/payment/driver-balance/:driverId', async (req, res) => {
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
        totalEarnings: result.totalEarnings,
        lastUpdated: result.lastUpdated,
        lastRideId: result.lastRideId,
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
router.get('/payment/driver-balance/:driverId/transactions', async (req, res) => {
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
});

/**
 * POST /api/payment/driver-balance/:driverId/withdraw
 * Solicita saque do motorista com regra de taxa:
 * - abaixo de R$500, cobra R$1,00
 */
router.post('/payment/driver-balance/:driverId/withdraw', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { amount, pixKey } = req.body || {};

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

    const amountCents = Math.round(Number(amount) * 100);
    const result = await paymentService.requestDriverWithdrawal({
      driverId,
      amountCents,
      pixKey: String(pixKey).trim()
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        ...result
      });
    }

    const statusCode = String(result.error || '').toLowerCase().includes('saldo insuficiente') ? 400 : 500;
    return res.status(statusCode).json({
      success: false,
      error: result.error || 'Erro ao processar saque'
    });
  } catch (error) {
    logError(error, '❌ Erro na rota de saque do motorista:', { service: 'payment-routes' });
    res.status(500).json({
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
router.get('/payment/calculate-net', async (req, res) => {
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









