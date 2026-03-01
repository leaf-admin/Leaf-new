const express = require('express');
const router = express.Router();
const driverApprovalService = require('../services/driver-approval-service');
const { logStructured, logError } = require('../utils/logger');

// Middleware para autenticação de admin
const authenticateAdmin = (req, res, next) => {
  // TODO: Implementar autenticação de admin
  next();
};

// Aprovar motorista e criar conta Woovi
router.post('/approve', authenticateAdmin, async (req, res) => {
  try {
    const { driverId, name, email, phone, cpf } = req.body;
    
    if (!driverId || !name || !email || !phone || !cpf) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios: driverId, name, email, phone, cpf'
      });
    }

    const result = await driverApprovalService.approveDriver({
      id: driverId,
      name,
      email,
      phone,
      cpf
    });

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        driverData: result.driverData,
        wooviClientId: result.wooviClientId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        details: result.details
      });
    }
  } catch (error) {
    logError(error, 'Erro ao aprovar motorista:', { service: 'driver-approval-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Processar ganhos de corrida
router.post('/process-earnings', async (req, res) => {
  try {
    const { driverId, wooviClientId, earnings, description, rideId } = req.body;
    
    if (!driverId || !wooviClientId || !earnings || !description || !rideId) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios: driverId, wooviClientId, earnings, description, rideId'
      });
    }

    const result = await driverApprovalService.processRideEarnings({
      driverId,
      wooviClientId,
      earnings,
      description,
      rideId
    });

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        chargeId: result.chargeId,
        earnings: result.earnings
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        details: result.details
      });
    }
  } catch (error) {
    logError(error, 'Erro ao processar ganhos:', { service: 'driver-approval-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Verificar conta Woovi do motorista
router.get('/check-account/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const result = await driverApprovalService.checkDriverWooviAccount(driverId);

    res.json({
      success: result.success,
      hasAccount: result.hasAccount,
      wooviClientId: result.wooviClientId,
      balance: result.balance,
      message: result.message,
      error: result.error
    });
  } catch (error) {
    logError(error, 'Erro ao verificar conta Woovi:', { service: 'driver-approval-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Criar conta Woovi para motorista existente
router.post('/create-woovi-account', async (req, res) => {
  try {
    const { driverId, name, email, phone, cpf } = req.body;
    
    if (!driverId || !name || !email || !phone || !cpf) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios: driverId, name, email, phone, cpf'
      });
    }

    const result = await driverApprovalService.createWooviAccountForExistingDriver({
      id: driverId,
      name,
      email,
      phone,
      cpf
    });

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        wooviClientId: result.wooviClientId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        details: result.details
      });
    }
  } catch (error) {
    logError(error, 'Erro ao criar conta Woovi:', { service: 'driver-approval-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;










