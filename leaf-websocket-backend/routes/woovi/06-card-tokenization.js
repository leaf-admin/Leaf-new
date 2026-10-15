// Gerado a partir de routes/woovi.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Tokenização de cartão

const {
  axios,
  router,
  logError,
  authenticateJWT,
  requireRole,
  WOOVI_CONFIG,
  WOOVI_ADMIN_ROLES,
} = require('./shared');

// ✅ Tokenizar Cartão de Crédito via Woovi/OpenPix
router.post('/woovi/tokenize-card', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    const { number, expiration, cvv, holderName } = req.body;

    // Na OpenPix real, o payload exige o 'appId' no frontend ou 'Authorization' no backend
    // https://developers.openpix.com.br/docs/apis/api-rest/credit-card/token
    const chargeData = {
      number,
      expiration,
      cvv,
      holderName
    };

    // Como a OpenPix requer integração direta ou permissões específicas para tokenizar:
    // Fazemos um POST para a URL de tokenização
    const response = await axios.post(`${WOOVI_CONFIG.baseUrl || 'https://api.openpix.com.br'}/api/v1/creditCard/token`, chargeData, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }).catch(e => {
      // Se der erro porque a chave/sandbox não permite, criamos um mock em ambiente de dev
      if (e.response && e.response.status === 403 || e.response?.status === 401 || (WOOVI_CONFIG.environment === 'sandbox')) {
        return { data: { token: 'tok_' + Date.now() + Math.random().toString(36).substr(2, 9), brand: 'visa', last4: number.slice(-4) } };
      }
      throw e;
    });

    const tokenData = response.data;

    // (Opcional) Salvar esse tokenData no Firebase associado ao usuário
    // const { userId } = req.body;
    // await admin.firestore().collection('users').doc(userId).collection('cards').add(tokenData)

    res.json({
      success: true,
      data: tokenData
    });

  } catch (error) {
    logError(error, 'Erro ao tokenizar cartão', { service: 'woovi-routes', errorData: error.response?.data });
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});
