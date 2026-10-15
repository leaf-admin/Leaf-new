// Gerado a partir de routes/woovi.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Cobranças: criar, consultar, listar, cancelar e testar conexão

const {
  axios,
  router,
  logError,
  getWooviAuthHeaders,
  authenticateJWT,
  requireRole,
  WOOVI_CONFIG,
  WOOVI_ADMIN_ROLES,
  ensureWooviCredentials,
} = require('./shared');

// Criar cobrança PIX
router.post('/woovi/create-charge', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviCredentials(res)) return;
    const { value, amount, description, correlationID } = req.body;
    const amountInReais = Number(value ?? amount);
    if (!Number.isFinite(amountInReais) || amountInReais <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Campo value (ou amount) deve ser número maior que zero'
      });
    }

    const chargeData = {
      value: Math.round(amountInReais * 100), // Converter para centavos
      correlationID: correlationID || `leaf_${Date.now()}`,
      comment: description || 'Pagamento Leaf App',
      expiresIn: 3600, // 1 hora
      additionalInfo: [
        {
          key: 'app',
          value: 'leaf'
        },
        {
          key: 'environment',
          value: 'sandbox'
        }
      ]
    };

    const response = await axios.post(`${WOOVI_CONFIG.baseUrl}/charge`, chargeData, {
      headers: getWooviAuthHeaders(WOOVI_CONFIG),
      timeout: 10000
    });

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logError(error, 'Erro ao criar cobrança', { service: 'woovi-routes', errorData: error.response?.data });

    // Fallback Mock was here. Removed to enforce real Sandbox testing.

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Verificar status da cobrança
router.get('/woovi/check-status/:correlationID', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviCredentials(res)) return;
    const { correlationID } = req.params;

    const response = await axios.get(`${WOOVI_CONFIG.baseUrl}/charge/${correlationID}`, {
      headers: getWooviAuthHeaders(WOOVI_CONFIG),
      timeout: 10000
    });

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logError(error, 'Erro ao verificar status', { service: 'woovi-routes', correlationID, errorData: error.response?.data });

    // Fallback Mock was here. Removed to enforce real Sandbox testing.

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Listar cobranças
router.get('/woovi/list-charges', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  const page = req.query.page || 1;
  const limit = req.query.limit || 10;
  try {
    if (!ensureWooviCredentials(res)) return;

    const response = await axios.get(`${WOOVI_CONFIG.baseUrl}/charge`, {
      headers: getWooviAuthHeaders(WOOVI_CONFIG),
      params: { page, limit },
      timeout: 10000
    });

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logError(error, 'Erro ao listar cobranças', { service: 'woovi-routes', page, limit, errorData: error.response?.data });
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Cancelar cobrança
router.post('/woovi/cancel-charge/:chargeId', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviCredentials(res)) return;
    const { chargeId } = req.params;
    if (!chargeId) {
      return res.status(400).json({
        success: false,
        error: 'chargeId é obrigatório'
      });
    }
    if (String(chargeId).startsWith('mock_review_')) {
      if (String(process.env.APP_REVIEW || 'false').toLowerCase() !== 'true') {
        return res.status(400).json({
          success: false,
          error: 'Cobrança mock permitida apenas em APP_REVIEW=true'
        });
      }

      return res.status(200).json({
        success: true,
        mock: true,
        message: 'Cobrança mock cancelada localmente'
      });
    }
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();
    const result = await wooviService.cancelCharge(chargeId);
    if (result.success) {
      return res.status(200).json(result);
    }
    return res.status(400).json(result);
  } catch (error) {
    logError(error, 'Erro ao cancelar cobrança', { service: 'woovi-routes' });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Testar conexão
router.get('/woovi/test-connection', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    if (!ensureWooviCredentials(res)) return;
    // Usa endpoint de listagem de cobranças como health-check de autenticação.
    const response = await axios.get(`${WOOVI_CONFIG.baseUrl}/charge`, {
      headers: getWooviAuthHeaders(WOOVI_CONFIG),
      params: { page: 1, limit: 1 },
      timeout: 10000
    });

    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return res.status(502).json({
        success: false,
        error: 'Resposta inválida da API Woovi (não JSON)',
        details: {
          baseUrl: WOOVI_CONFIG.baseUrl,
          contentType
        }
      });
    }

    res.json({
      success: true,
      message: 'Conexão com Woovi estabelecida com sucesso',
      environment: WOOVI_CONFIG.environment,
      data: {
        baseUrl: WOOVI_CONFIG.baseUrl,
        requestStatus: response.status,
        hasChargesArray: Array.isArray(response.data?.charges),
        rawKeys: Object.keys(response.data || {})
      }
    });

  } catch (error) {
    logError(error, 'Erro na conexão', { service: 'woovi-routes', errorData: error.response?.data });
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});
