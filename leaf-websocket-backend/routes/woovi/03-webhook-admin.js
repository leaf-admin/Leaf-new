// Gerado a partir de routes/woovi.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Administração de webhooks no provedor

const {
  router,
  logStructured,
  logError,
  authenticateJWT,
  requireRole,
  WOOVI_ADMIN_ROLES,
  validateSandboxTestWebhookPayload,
  isProductionRuntime,
  handleChargeCompleted,
} = require('./shared');

// ✅ Listar webhooks via API
router.get('/woovi/list-webhooks', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();

    const result = await wooviService.listWebhooks();

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logError(error, 'Erro ao listar webhooks', { service: 'woovi-routes' });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Criar webhook via API
router.post('/woovi/create-webhook', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();

    const { name, url, authorization, isActive, event } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL do webhook é obrigatória'
      });
    }

    const result = await wooviService.createWebhook({
      name: name || 'Leaf App Webhook',
      url,
      authorization,
      isActive,
      event
    });

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logError(error, 'Erro ao criar webhook', { service: 'woovi-routes' });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Atualizar webhook via API
router.put('/woovi/update-webhook/:webhookId', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();

    const { webhookId } = req.params;
    const { name, url, authorization, isActive } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL do webhook é obrigatória'
      });
    }

    const result = await wooviService.updateWebhook(webhookId, {
      name: name || 'Leaf App Webhook',
      url,
      authorization,
      isActive
    });

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar webhook', { service: 'woovi-routes', webhookId: req.params.webhookId });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Deletar webhook via API
router.delete('/woovi/delete-webhook/:webhookId', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    const WooviDriverService = require('../../services/woovi-driver-service');
    const wooviService = new WooviDriverService();

    const { webhookId } = req.params;

    const result = await wooviService.deleteWebhook(webhookId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logError(error, 'Erro ao deletar webhook', { service: 'woovi-routes', webhookId: req.params.webhookId });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Endpoint de teste para enviar webhook manualmente (para debug)
router.post('/woovi/test-webhook', authenticateJWT, requireRole(WOOVI_ADMIN_ROLES), async (req, res) => {
  try {
    const testWebhookEnabled =
      String(process.env.ENABLE_WOOVI_TEST_WEBHOOK || 'false').toLowerCase() === 'true';
    const sandboxValidation = isProductionRuntime() && !testWebhookEnabled
      ? await validateSandboxTestWebhookPayload(req.body)
      : { allowed: true, reason: testWebhookEnabled ? 'EXPLICIT_TEST_WEBHOOK_ENABLED' : 'NON_PRODUCTION_RUNTIME' };

    if (isProductionRuntime() && !testWebhookEnabled && !sandboxValidation.allowed) {
      logStructured('warn', 'Webhook de teste recusado por guard sandbox', {
        service: 'woovi-routes',
        reason: sandboxValidation.reason,
        chargeId: sandboxValidation.chargeId || null,
        rideId: sandboxValidation.rideId || null
      });
      return res.status(404).json({
        success: false,
        error: 'Webhook de teste desabilitado em produção',
        code: sandboxValidation.reason || 'WOOVI_TEST_WEBHOOK_DISABLED'
      });
    }

    const io = req.app.get('io');

    logStructured('info', 'Webhook de teste recebido', {
      service: 'woovi-routes',
      mode: sandboxValidation.reason,
      body: req.body
    });

    // ✅ Processar como se fosse um webhook real
    await handleChargeCompleted(req.body, io);

    res.status(200).json({
      success: true,
      message: 'Webhook de teste processado com sucesso'
    });
  } catch (error) {
    logError(error, 'Erro ao processar webhook de teste', { service: 'woovi-routes' });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
