// Gerado a partir de routes/woovi.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Conta master: conexão, subcontas e cobrança com split

const {
  router,
  logError,
  authenticateJWT,
  requireRole,
  WOOVI_CONFIG,
  WOOVI_ADMIN_ROLES,
  ensureWooviMasterCredentials,
} = require('./shared');

// Testar conexão com API MASTER
router.get('/woovi/master/test-connection', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviMasterCredentials(res)) return;
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();
    const result = await wooviService.testMasterConnection();
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Conexão com API MASTER validada',
        environment: WOOVI_CONFIG.environment,
        data: result
      });
    }
    return res.status(400).json(result);
  } catch (error) {
    logError(error, 'Erro ao testar conexão master', { service: 'woovi-routes' });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Criar subconta via API MASTER
router.post('/woovi/master/subaccount', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviMasterCredentials(res)) return;
    const { name, pixKey, taxID, email, phone } = req.body;
    if (!name || !pixKey) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: name, pixKey'
      });
    }
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();
    const result = await wooviService.createSubaccount({ name, pixKey, taxID, email, phone });
    if (result.success) {
      return res.status(200).json(result);
    }
    return res.status(400).json(result);
  } catch (error) {
    logError(error, 'Erro ao criar subconta master', { service: 'woovi-routes' });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Consultar subconta via API MASTER
router.get('/woovi/master/subaccount/:pixKey', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviMasterCredentials(res)) return;
    const { pixKey } = req.params;
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();
    const result = await wooviService.getSubaccountDetails(pixKey);
    if (result.success) {
      return res.status(200).json(result);
    }
    return res.status(400).json(result);
  } catch (error) {
    logError(error, 'Erro ao consultar subconta master', { service: 'woovi-routes' });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Criar cobrança com split via API MASTER
router.post('/woovi/master/create-charge-split', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviMasterCredentials(res)) return;
    const { value, amount, correlationID, comment, customer, splits, additionalInfo, expiresIn } = req.body;
    const valueCents = Number.isFinite(Number(value))
      ? Math.round(Number(value))
      : (Number.isFinite(Number(amount)) ? Math.round(Number(amount) * 100) : NaN);

    if (!Number.isFinite(valueCents) || valueCents <= 0) {
      return res.status(400).json({
        success: false,
        error: 'value (centavos) ou amount (reais) deve ser número maior que zero'
      });
    }
    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Campo splits é obrigatório (array)'
      });
    }

    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();
    const result = await wooviService.createChargeWithSplit({
      value: valueCents,
      correlationID,
      comment,
      customer,
      splits,
      additionalInfo,
      expiresIn
    });
    if (result.success) {
      return res.status(200).json(result);
    }
    return res.status(400).json(result);
  } catch (error) {
    logError(error, 'Erro ao criar charge split master', { service: 'woovi-routes' });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
