const express = require('express');
const router = express.Router();
const DriverApprovalService = require('../services/driver-approval-service');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');
const { logStructured, logError } = require('../utils/logger');
const driverApprovalService = new DriverApprovalService();

const DRIVER_APPROVAL_ADMIN_ROLES = ['admin', 'super-admin', 'manager', 'development'];
const ADMIN_ROUTE_MIDDLEWARE = [authenticateJWT, requireRole(DRIVER_APPROVAL_ADMIN_ROLES)];

function getDriverApprovalFailureStatus(errorCode) {
  if (errorCode === 'CANONICAL_DRIVER_EVIDENCE_REQUIRED') {
    return 409;
  }

  if (errorCode === 'CANONICAL_DRIVER_EVIDENCE_CHECK_FAILED') {
    return 503;
  }

  return 400;
}

// Aprovar motorista e criar conta Woovi
router.post('/approve', ...ADMIN_ROUTE_MIDDLEWARE, async (req, res) => {
  try {
    const {
      driverId,
      name,
      email,
      phone,
      cpf,
      pixKey,
      driverPixKey,
      subaccountPixKey,
      wooviSubaccountPixKey,
      approvalReason,
      reviewReason,
      reason,
      provenance,
      source,
      evidence,
      evidenceRefs,
      documents,
      documentRefs
    } = req.body;
    
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
      cpf,
      pixKey: pixKey || driverPixKey || subaccountPixKey || wooviSubaccountPixKey,
      driverPixKey,
      subaccountPixKey,
      wooviSubaccountPixKey,
      approvalAudit: {
        actorId: req.user?.id || req.user?.uid || req.user?.email || 'unknown_admin',
        actorRole: req.user?.role || 'admin',
        reason: approvalReason || reviewReason || reason,
        provenance: provenance || source || 'driver_approval_dashboard',
        evidence: evidence || evidenceRefs || documents || documentRefs
      }
    });

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        driverData: result.driverData,
        wooviClientId: result.wooviClientId
      });
    } else {
      res.status(getDriverApprovalFailureStatus(result.error)).json({
        success: false,
        error: result.error,
        details: result.details,
        activationStatus: result.activationStatus || null
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
router.post('/process-earnings', ...ADMIN_ROUTE_MIDDLEWARE, async (req, res) => {
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
router.get('/check-account/:driverId', ...ADMIN_ROUTE_MIDDLEWARE, async (req, res) => {
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
router.post('/create-woovi-account', ...ADMIN_ROUTE_MIDDLEWARE, async (req, res) => {
  try {
    const { driverId, name, email, phone, cpf, pixKey, driverPixKey, subaccountPixKey, wooviSubaccountPixKey } = req.body;
    
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
      cpf,
      pixKey: pixKey || driverPixKey || subaccountPixKey || wooviSubaccountPixKey,
      driverPixKey,
      subaccountPixKey,
      wooviSubaccountPixKey
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





