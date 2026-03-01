const express = require('express');
const router = express.Router();
const wooviDriverService = require('../services/woovi-driver-service');
const { logStructured, logError } = require('../utils/logger');

// Middleware para autenticação (implementar conforme necessário)
const authenticateDriver = (req, res, next) => {
  // TODO: Implementar autenticação do motorista
  next();
};

// Criar cliente Woovi para motorista aprovado
router.post('/driver/create-client', authenticateDriver, async (req, res) => {
  try {
    const { name, email, phone, cpf, driverId } = req.body;
    
    if (!name || !email || !phone || !cpf || !driverId) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios: name, email, phone, cpf, driverId'
      });
    }

    const result = await wooviDriverService.createDriverClient({
      name,
      email,
      phone,
      cpf,
      driverId
    });

    if (result.success) {
      res.json({
        success: true,
        message: 'Cliente Woovi criado com sucesso',
        wooviClientId: result.wooviClientId,
        customer: result.customer
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logError(error, 'Erro ao criar cliente Woovi:', { service: 'woovi-driver-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Criar cobrança de ganhos para motorista
router.post('/driver/create-earnings', authenticateDriver, async (req, res) => {
  try {
    const { wooviClientId, value, description, rideId } = req.body;
    
    if (!wooviClientId || !value || !description || !rideId) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios: wooviClientId, value, description, rideId'
      });
    }

    const result = await wooviDriverService.createRideEarnings(
      wooviClientId,
      value,
      description,
      rideId
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Cobrança de ganhos criada com sucesso',
        charge: result.charge
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logError(error, 'Erro ao criar cobrança de ganhos:', { service: 'woovi-driver-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Listar cobranças de um motorista
router.get('/driver/:wooviClientId/charges', authenticateDriver, async (req, res) => {
  try {
    const { wooviClientId } = req.params;
    
    const result = await wooviDriverService.getDriverCharges(wooviClientId);

    if (result.success) {
      res.json({
        success: true,
        charges: result.charges
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logError(error, 'Erro ao listar cobranças do motorista:', { service: 'woovi-driver-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Verificar saldo de um motorista
router.get('/driver/:wooviClientId/balance', authenticateDriver, async (req, res) => {
  try {
    const { wooviClientId } = req.params;
    
    const result = await wooviDriverService.getDriverBalance(wooviClientId);

    if (result.success) {
      res.json({
        success: true,
        balance: result.balance,
        totalCharges: result.totalCharges,
        charges: result.charges
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logError(error, 'Erro ao verificar saldo do motorista:', { service: 'woovi-driver-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar dados do cliente Woovi
router.put('/driver/:wooviClientId/update', authenticateDriver, async (req, res) => {
  try {
    const { wooviClientId } = req.params;
    const updateData = req.body;
    
    const result = await wooviDriverService.updateDriverClient(wooviClientId, updateData);

    if (result.success) {
      res.json({
        success: true,
        message: 'Cliente atualizado com sucesso',
        customer: result.customer
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar cliente Woovi:', { service: 'woovi-driver-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Simular pagamento (apenas para testes)
router.post('/driver/simulate-payment', authenticateDriver, async (req, res) => {
  try {
    const { chargeId } = req.body;
    
    if (!chargeId) {
      return res.status(400).json({
        success: false,
        error: 'ID da cobrança é obrigatório'
      });
    }

    const result = await wooviDriverService.simulatePayment(chargeId);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        chargeId: result.chargeId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    logError(error, 'Erro ao simular pagamento:', { service: 'woovi-driver-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;










