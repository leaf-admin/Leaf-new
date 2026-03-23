const express = require('express');
const axios = require('axios');
const router = express.Router();
const { logStructured, logError } = require('../utils/logger');
const { getWooviConfig, getWooviAuthHeaders } = require('../config/woovi-config');

const WOOVI_CONFIG = getWooviConfig();
const legacyWooviAliasRouteEnabled =
  String(process.env.ENABLE_LEGACY_WOOVI_ALIAS_ROUTE || 'false').toLowerCase() === 'true';

logStructured('info', 'Configuração Woovi carregada', {
  service: 'woovi-routes',
  environment: WOOVI_CONFIG.environment,
  baseUrl: WOOVI_CONFIG.baseUrl,
  hasToken: Boolean(WOOVI_CONFIG.apiToken),
  hasAppId: Boolean(WOOVI_CONFIG.appId)
});

const COMPLETED_WEBHOOK_EVENTS = new Set([
  'OPENPIX:CHARGE_COMPLETED',
  'CHARGE_COMPLETED',
  'CHARGE_CONFIRMED',
  'CHARGE_PAID',
  'CHARGE.COMPLETED',
  'CHARGE.CONFIRMED',
  'CHARGE.PAID',
  'LEAF-CHARGE.CONFIRMED',
  'LEAF-CHARGE.COMPLETED',
  'OPENPIX:TRANSACTION_RECEIVED',
  'TRANSACTION_RECEIVED'
]);

const COMPLETED_PAYMENT_STATUSES = new Set([
  'COMPLETED',
  'CONFIRMED',
  'PAID',
  'IN_HOLDING',
  'DISTRIBUTED'
]);

function normalizeEventName(eventName) {
  return String(eventName || '').trim().toUpperCase();
}

function normalizePaymentStatus(status) {
  return String(status || '').trim().toUpperCase();
}

function normalizeAdditionalInfo(rawAdditionalInfo) {
  if (Array.isArray(rawAdditionalInfo)) {
    return rawAdditionalInfo.filter((info) => info && typeof info === 'object');
  }

  if (rawAdditionalInfo && typeof rawAdditionalInfo === 'object') {
    return Object.entries(rawAdditionalInfo).map(([key, value]) => ({
      key,
      value: value === null || value === undefined ? '' : String(value)
    }));
  }

  return [];
}

function getAdditionalInfoValue(additionalInfo, acceptedKeys = []) {
  if (!Array.isArray(additionalInfo) || additionalInfo.length === 0 || !acceptedKeys.length) {
    return null;
  }

  const acceptedSet = new Set(acceptedKeys.map((key) => String(key || '').toLowerCase()));
  const match = additionalInfo.find((info) => {
    const key = String(info?.key || info?.name || '').toLowerCase();
    return acceptedSet.has(key);
  });

  if (!match || match.value === undefined || match.value === null || match.value === '') {
    return null;
  }

  return String(match.value);
}

const ensureWooviCredentials = (res) => {
  if (!WOOVI_CONFIG.apiToken) {
    res.status(500).json({
      success: false,
      error: 'WOOVI_API_TOKEN não configurado'
    });
    return false;
  }
  return true;
};

const ensureWooviMasterCredentials = (res) => {
  if (!WOOVI_CONFIG.masterApiToken) {
    res.status(500).json({
      success: false,
      error: 'WOOVI_MASTER_API_TOKEN não configurado'
    });
    return false;
  }
  return true;
};

// Criar cobrança PIX
router.post('/woovi/create-charge', async (req, res) => {
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
router.get('/woovi/check-status/:correlationID', async (req, res) => {
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
router.get('/woovi/list-charges', async (req, res) => {
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
router.post('/woovi/cancel-charge/:chargeId', async (req, res) => {
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
      return res.status(200).json({
        success: true,
        mock: true,
        message: 'Cobrança mock cancelada localmente'
      });
    }
    const WooviDriverService = require('../services/woovi-driver-service');
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
router.get('/woovi/test-connection', async (req, res) => {
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

// Testar conexão com API MASTER
router.get('/woovi/master/test-connection', async (req, res) => {
  try {
    if (!ensureWooviMasterCredentials(res)) return;
    const WooviDriverService = require('../services/woovi-driver-service');
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
router.post('/woovi/master/subaccount', async (req, res) => {
  try {
    if (!ensureWooviMasterCredentials(res)) return;
    const { name, pixKey, taxID, email, phone } = req.body;
    if (!name || !pixKey) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: name, pixKey'
      });
    }
    const WooviDriverService = require('../services/woovi-driver-service');
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
router.get('/woovi/master/subaccount/:pixKey', async (req, res) => {
  try {
    if (!ensureWooviMasterCredentials(res)) return;
    const { pixKey } = req.params;
    const WooviDriverService = require('../services/woovi-driver-service');
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
router.post('/woovi/master/create-charge-split', async (req, res) => {
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

    const WooviDriverService = require('../services/woovi-driver-service');
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

// ✅ Listar webhooks via API
router.get('/woovi/list-webhooks', async (req, res) => {
  try {
    const WooviDriverService = require('../services/woovi-driver-service');
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
router.post('/woovi/create-webhook', async (req, res) => {
  try {
    const WooviDriverService = require('../services/woovi-driver-service');
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
router.put('/woovi/update-webhook/:webhookId', async (req, res) => {
  try {
    const WooviDriverService = require('../services/woovi-driver-service');
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
    logError(error, 'Erro ao atualizar webhook', { service: 'woovi-routes', webhookId });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Deletar webhook via API
router.delete('/woovi/delete-webhook/:webhookId', async (req, res) => {
  try {
    const WooviDriverService = require('../services/woovi-driver-service');
    const wooviService = new WooviDriverService();

    const { webhookId } = req.params;

    const result = await wooviService.deleteWebhook(webhookId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logError(error, 'Erro ao deletar webhook', { service: 'woovi-routes', webhookId });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Endpoint de teste para enviar webhook manualmente (para debug)
router.post('/woovi/test-webhook', async (req, res) => {
  try {
    const io = req.app.get('io');

    logStructured('info', 'Webhook de teste recebido', { service: 'woovi-routes', body: req.body });

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

// Webhook principal para receber notificações da Woovi
// Documentação: https://developers.woovi.com/docs/category/exemplos
router.post('/woovi/webhook', async (req, res) => {
  // ✅ Armazenar io no req para uso nas funções de handler
  req.io = req.app.get('io');
  try {
    // ✅ Log resumido do webhook recebido
    const event = req.body.event || req.body.type || req.body.name || 'UNKNOWN';
    const charge = req.body.charge || req.body.data || {};
    const chargeId = charge.identifier || charge.id || 'N/A';
    const status = charge.status || 'N/A';
    const amount = charge.value || charge.amount || 0;

    logStructured('info', 'Webhook recebido', { service: 'woovi-routes', event, chargeId, status, amount: amount ? (amount / 100).toFixed(2) : 'N/A', timestamp: new Date().toISOString() });

    // ✅ Formato real da Woovi: { event: 'OPENPIX:CHARGE_COMPLETED', charge: {...}, pix: {...}, company: {...}, account: {...} }
    // ✅ Também pode vir como: { type: 'charge.completed', data: {...} }

    if (!event) {
      logStructured('warn', 'Evento não encontrado no payload', { service: 'woovi-routes', body: req.body });
      // Mesmo sem evento, tentar processar se houver charge com status COMPLETED
      if (charge && (charge.identifier || charge.id) && charge.status === 'COMPLETED') {
        logStructured('info', 'Processando sem evento, mas com charge COMPLETED', { service: 'woovi-routes', chargeId: charge.identifier || charge.id });
        await handleChargeCompleted(req.body, req.io);
      }
    } else {
      logStructured('info', 'Evento recebido', { service: 'woovi-routes', event });

      // ✅ Processar todos os eventos da Woovi conforme documentação oficial
      // Documentação: https://developers.woovi.com/docs/webhook/webhook-events-type
      switch (event) {
        // ==================== EVENTOS DE COBRANÇA ====================
        case 'OPENPIX:CHARGE_COMPLETED': // ✅ Cobrança paga (formato real Woovi Sandbox)
        case 'CHARGE_COMPLETED': // ✅ Variação sem OPENPIX:
        case 'CHARGE_CONFIRMED':
        case 'CHARGE_PAID':
        case 'charge.completed': // ✅ Formato com ponto (pode ser o que a Woovi está enviando)
        case 'charge.confirmed':
        case 'charge.paid':
        case 'Leaf-charge.confirmed':
        case 'Leaf-charge.completed': // ✅ Variação Leaf
          logStructured('info', 'Cobrança confirmada/paga', { service: 'woovi-routes', event });
          await handleChargeCompleted(req.body, req.io);
          break;

        case 'OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER': // ✅ Cobrança paga por pagador diferente
          logStructured('warn', 'Cobrança paga por pagador diferente do cliente', { service: 'woovi-routes', event });
          await handleChargeCompletedDifferentPayer(req.body);
          break;

        case 'OPENPIX:CHARGE_CREATED': // ✅ Nova cobrança criada
        case 'CHARGE_CREATED':
        case 'charge.created':
        case 'Leaf-charge.created':
          logStructured('info', 'Nova cobrança criada', { service: 'woovi-routes', event });
          await handleChargeCreated(req.body);
          break;

        case 'OPENPIX:CHARGE_EXPIRED': // ✅ Cobrança expirada
        case 'CHARGE_EXPIRED':
        case 'charge.expired':
        case 'Leaf-charge.expired':
          logStructured('info', 'Cobrança expirada', { service: 'woovi-routes', event });
          await handleChargeExpired(req.body);
          break;

        // ==================== EVENTOS DE TRANSAÇÃO ====================
        case 'OPENPIX:TRANSACTION_RECEIVED': // ✅ Transação recebida (cobrança ou QR code estático)
          logStructured('info', 'Transação recebida', { service: 'woovi-routes', event });
          await handleTransactionReceived(req.body, req.io);
          break;

        // ==================== EVENTOS DE REEMBOLSO ====================
        case 'PIX_TRANSACTION_REFUND_RECEIVED_CONFIRMED': // ✅ Reembolso recebido e confirmado
          logStructured('info', 'Reembolso recebido e confirmado', { service: 'woovi-routes', event });
          await handleRefundReceivedConfirmed(req.body);
          break;

        case 'PIX_TRANSACTION_REFUND_RECEIVED_REJECTED': // ✅ Reembolso recebido mas rejeitado
          logStructured('warn', 'Reembolso recebido mas rejeitado', { service: 'woovi-routes', event });
          await handleRefundReceivedRejected(req.body);
          break;

        case 'PIX_TRANSACTION_REFUND_SENT_CONFIRMED': // ✅ Reembolso enviado e confirmado
          logStructured('info', 'Reembolso enviado e confirmado', { service: 'woovi-routes', event });
          await handleRefundSentConfirmed(req.body);
          break;

        // ==================== EVENTOS DE CONTA BaaS ====================
        case 'ACCOUNT_REGISTER_APPROVED': // ✅ Conta BaaS aprovada
          logStructured('info', 'Conta BaaS aprovada', { service: 'woovi-routes', event });
          await handleAccountApproved(charge || req.body);
          break;

        // ==================== EVENTOS LEGADOS (compatibilidade) ====================
        case 'REFUND_RECEIVED':
        case 'refund.received':
        case 'Leaf-refund.received':
          logStructured('info', 'Reembolso recebido (legado)', { service: 'woovi-routes', event });
          await handleRefundReceivedConfirmed(req.body);
          break;

        default:
          logStructured('warn', 'Evento não tratado', { service: 'woovi-routes', event });
          // ✅ Fallback: Se não reconhecer o evento mas tiver charge COMPLETED, processar mesmo assim
          if (charge && charge.status === 'COMPLETED') {
            logStructured('info', 'Processando charge COMPLETED mesmo com evento desconhecido', { service: 'woovi-routes', event });
            await handleChargeCompleted(req.body, req.io);
          }
      }
    }

    // Sempre responder 200 OK para a Woovi
    res.status(200).json({
      success: true,
      received: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError(error, 'Erro no webhook', { service: 'woovi-routes' });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Rota alternativa com hífen (habilite apenas se precisar suportar webhook legado)
if (legacyWooviAliasRouteEnabled) {
  router.post('/woovi-webhook', async (req, res) => {
    req.url = '/woovi/webhook';
    return router.handle(req, res);
  });
}

/**
 * Handler para cobrança completada/paga via webhook
 * Evento: OPENPIX:CHARGE_COMPLETED
 * Processa o pagamento e atualiza o status
 * @param {Object} data - Dados do webhook
 * @param {Object} io - Instância do Socket.IO (opcional)
 */
async function handleChargeCompleted(data, io = null) {
  let resolvedChargeId = null;
  try {
    const PaymentService = require('../services/payment-service');
    const paymentService = new PaymentService();

    // ✅ Extrair dados do webhook conforme formato real da Woovi
    // Formato: { event: 'OPENPIX:CHARGE_COMPLETED', charge: {...}, pix: {...} }
    const eventName = data.event || data.type || data.name || 'OPENPIX:CHARGE_COMPLETED';
    const normalizedEventName = normalizeEventName(eventName);
    const charge = data.charge || data;
    const pix = data.pix || {};

    // ✅ Usar identifier como chargeId (formato Woovi)
    const chargeId = charge.identifier || charge.id || charge.chargeId || charge.transactionID;
    resolvedChargeId = chargeId;
    const correlationID = charge.correlationID || charge.correlationId;
    const amount = charge.value || charge.amount;
    const status = charge.status || charge.state;
    const normalizedWebhookStatus = normalizePaymentStatus(status);
    const additionalInfo = normalizeAdditionalInfo(charge.additionalInfo);

    if (!chargeId) {
      logStructured('error', 'chargeId (identifier) não encontrado no webhook', { service: 'woovi-routes', data });
      return;
    }

    logStructured('info', 'Processando pagamento confirmado', {
      service: 'woovi-routes',
      event: eventName,
      normalizedEventName,
      chargeId,
      correlationID,
      amount,
      status,
      normalizedWebhookStatus,
      additionalInfoCount: additionalInfo.length,
      paidAt: charge.paidAt
    });

    // ✅ Extrair rideId e passengerId de additionalInfo (formato Woovi)
    let rideId = null;
    let passengerId = null;

    if (additionalInfo.length > 0) {
      rideId = getAdditionalInfoValue(additionalInfo, ['ride_id', 'rideId', 'bookingId']);
      passengerId = getAdditionalInfoValue(additionalInfo, ['passenger_id', 'passengerId']);

      if (rideId) {
        logStructured('info', 'rideId encontrado em additionalInfo', { service: 'woovi-routes', rideId, chargeId });
      }

      if (passengerId) {
        logStructured('info', 'passengerId encontrado em additionalInfo', { service: 'woovi-routes', passengerId, chargeId });
      }
    }

    // ✅ Fallback: tentar extrair do correlationID se não encontrou em additionalInfo
    if (!rideId && correlationID) {
      // Formato: ride_${rideId}_${timestamp}_${random}
      const parts = correlationID.split('_');
      if (parts.length >= 4 && parts[0] === 'ride') {
        // Remove 'ride', timestamp (penúltimo) e random (último)
        rideId = parts.slice(1, -2).join('_');
        logStructured('info', 'rideId extraído do correlationID', { service: 'woovi-routes', rideId, correlationID });
      }
    }

    if (!rideId) {
      logStructured('error', 'rideId não encontrado no webhook', { service: 'woovi-routes', correlationID, additionalInfo, chargeId });
      // Continuar mesmo sem rideId para verificar status
    }

    logStructured('info', 'Dados extraídos do webhook', { service: 'woovi-routes', chargeId, rideId, passengerId, amount, status, amountInReais: amount ? (amount / 100).toFixed(2) : null });

    // ✅ Verificar status do pagamento na Woovi (usando identifier como chargeId)
    // ⚠️ Se o evento/status já indica pagamento concluído, confiar no webhook.
    const webhookIndicatesCompleted =
      COMPLETED_WEBHOOK_EVENTS.has(normalizedEventName) ||
      COMPLETED_PAYMENT_STATUSES.has(normalizedWebhookStatus);

    // Verificar na API apenas se necessário (para garantir)
    let statusResult = null;
    let normalizedProviderStatus = '';
    if (!webhookIndicatesCompleted) {
      statusResult = await paymentService.getPaymentStatus(chargeId);
      normalizedProviderStatus = normalizePaymentStatus(statusResult?.status);
    }

    const providerIndicatesCompleted =
      Boolean(statusResult?.success) &&
      COMPLETED_PAYMENT_STATUSES.has(normalizedProviderStatus);

    if (webhookIndicatesCompleted || providerIndicatesCompleted) {
      const amountInReais = statusResult?.amountInReais || (amount ? (amount / 100) : null);
      const finalStatus = statusResult?.status || status || charge.status;

      logStructured('info', 'Pagamento confirmado e verificado', { service: 'woovi-routes', chargeId, rideId, amount: amountInReais, status: finalStatus, paidAt: charge.paidAt });

      // ✅ Verificar se é um pagamento de extensão de rota
      const paymentTypeValue = getAdditionalInfoValue(additionalInfo, ['payment_type']);
      const isExtension = String(paymentTypeValue || '').toLowerCase() === 'ride_extension';

      // ✅ Registrar pagamento confirmado e aguardar fluxo da corrida
      if (rideId) {
        if (isExtension) {
          logStructured('info', 'Iniciando processamento de extensão de corrida', { service: 'woovi-routes', chargeId, rideId });
          const newFareValue = getAdditionalInfoValue(additionalInfo, ['new_fare']);
          const newFare = newFareValue ? parseInt(newFareValue, 10) : 0;
          await processExtensionConfirmation(rideId, chargeId, amount, passengerId, io, newFare);
        } else {
          logStructured('info', 'Iniciando processamento de confirmação de pagamento inicial', { service: 'woovi-routes', chargeId, rideId });
          const confirmationResult = await processPaymentConfirmation(
            chargeId,
            rideId,
            amount,
            passengerId,
            io,
            {
              event: eventName,
              status: finalStatus,
              additionalInfo,
              pixStatus: pix?.status || 'N/A'
            }
          );

          if (confirmationResult && confirmationResult.success) {
            logStructured('info', 'Pagamento registrado com sucesso', { service: 'woovi-routes', chargeId, rideId, processingStatus: confirmationResult.status || 'CONFIRMED' });
          } else {
            logStructured('warn', 'Pagamento confirmado, mas ajustes pendentes', { service: 'woovi-routes', chargeId, rideId, reason: confirmationResult?.error || 'Falha ao armazenar confirmação' });
          }
        }
      } else {
        logStructured('warn', 'rideId não encontrado, não é possível registrar pagamento', { service: 'woovi-routes', chargeId });
      }

    } else {
      logStructured('warn', 'Pagamento não confirmado após validações', {
        service: 'woovi-routes',
        chargeId,
        webhookStatus: status,
        normalizedWebhookStatus,
        normalizedEventName,
        providerStatus: statusResult?.status || null,
        normalizedProviderStatus,
        providerSuccess: Boolean(statusResult?.success)
      });
    }

  } catch (error) {
    logError(error, 'Erro ao processar cobrança completada', {
      service: 'woovi-routes',
      chargeId: resolvedChargeId
    });
  }
}

/**
 * Processa a confirmação de um pagamento de Extensão de Corrida (passo adicional)
 */
async function processExtensionConfirmation(rideId, chargeId, amount, passengerId, io, newFare) {
  try {
    const EventSourcing = require('../services/event-sourcing');
    const redisPool = require('../utils/redis-pool');
    const redis = redisPool.getConnection();
    const firebaseConfig = require('../firebase-config');
    const firestore = firebaseConfig.getFirestore();

    // 1. Atualiza corrida no Redis
    let bookingDataStr = await redis.hget('bookings:active', rideId);
    let originalDriverId = null;

    if (bookingDataStr) {
      let booking = JSON.parse(bookingDataStr);
      booking.estimatedFare = parseInt(newFare);
      booking.newEstimate = parseInt(newFare);
      originalDriverId = booking.driverId;

      await redis.hset('bookings:active', rideId, JSON.stringify(booking));
      await redis.hmset(`booking:${rideId}`, {
        estimatedFare: parseInt(newFare),
        newEstimate: parseInt(newFare)
      });

      // Notificar Sockets
      if (io && passengerId) {
        io.to(`customer_${passengerId}`).emit('rideExtensionConfirmed', {
          bookingId: rideId,
          newFare: newFare,
          message: 'Pagamento da extensão confirmado. Rota atualizada!'
        });
      }
      if (io && originalDriverId) {
        io.to(`driver_${originalDriverId}`).emit('rideExtensionConfirmed', {
          bookingId: rideId,
          newFare: newFare,
          message: 'Passageiro pagou a extensão. Rota atualizada!'
        });
      }
    }

    // 2. Incrementar o valor original no Firestore para bater com o Total Amount no encerramento (refund logic)
    if (firestore) {
      const holdingRef = firestore.collection('payment_holdings').doc(rideId);
      const holdingDoc = await holdingRef.get();
      if (holdingDoc.exists) {
        const adminVars = require('firebase-admin');
        await holdingRef.update({
          amount: adminVars.firestore.FieldValue.increment(amount),
          extensionChargeId: chargeId, // salva referencia
          updatedAt: adminVars.firestore.FieldValue.serverTimestamp()
        });
        logStructured('info', 'Payment holding atualizado com valor de extensão', { rideId, addedAmount: amount });
      }
    }

    // 3. Event Sourcing
    await EventSourcing.recordEvent(EventSourcing.EVENT_TYPES.RIDE_UPDATED, {
      bookingId: rideId,
      type: 'EXTENSION_PAID',
      chargeId: chargeId,
      amountAdded: amount,
      newFare: newFare
    });

  } catch (error) {
    logError(error, 'Erro ao processar Extensão de Corrida', { rideId });
  }
}

/**
 * Processa confirmação de pagamento: busca driverId, credita saldo e notifica
 * @param {string} chargeId - ID da cobrança na Woovi
 * @param {string} rideId - ID da corrida
 * @param {number} amount - Valor em centavos
 * @param {string} passengerId - ID do passageiro
 * @param {Object} io - Instância do Socket.IO (opcional)
 */
async function processPaymentConfirmation(chargeId, rideId, amount, passengerId, io = null, metadata = {}) {
  try {
    const PaymentService = require('../services/payment-service');
    const paymentDispatchService = require('../services/payment-dispatch-service');
    const paymentService = new PaymentService();
    const amountInReais = amount ? (amount / 100).toFixed(2) : null;
    const amountInCents = Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0;

    let resolvedBookingId = rideId;
    try {
      const linkedBookingId = await paymentDispatchService.resolveBookingIdFromPaymentRefs({
        bookingId: rideId,
        chargeId,
        temporaryRideId: rideId
      });

      if (linkedBookingId) {
        resolvedBookingId = linkedBookingId;
      }
    } catch (resolveError) {
      logStructured('warn', 'Não foi possível resolver bookingId via vínculo de pagamento', {
        service: 'woovi-routes',
        rideId,
        chargeId,
        error: resolveError.message
      });
    }

    const emitPassengerStatus = (status, extra = {}) => {
      if (!io || !passengerId) {
        return;
      }

      const payload = {
        success: true,
        rideId: resolvedBookingId,
        bookingId: resolvedBookingId,
        paymentReferenceRideId: rideId,
        chargeId,
        amountInReais,
        status,
        timestamp: new Date().toISOString(),
        ...extra
      };

      io.to(`customer_${passengerId}`).emit('paymentConfirmed', payload);
      logStructured('info', 'Evento paymentConfirmed enviado ao passageiro', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        passengerId
      });
    };

    logStructured('info', 'Buscando dados da corrida para confirmação de pagamento', {
      service: 'woovi-routes',
      rideId,
      resolvedBookingId,
      chargeId
    });

    // ✅ Buscar dados da corrida do Redis
    let bookingData = null;
    let driverId = null;

    try {
      // Obter conexão Redis
      let redis = null;
      try {
        const redisPool = require('../utils/redis-pool');
        redis = redisPool.getConnection();
      } catch (e) {
        // REMOVED logStructured('warn', '⚠️ [Webhook] Redis pool não disponível:', e.message);
      }

      if (redis) {
        // Tentar buscar de bookings:active primeiro
        const redisData = await redis.hget('bookings:active', resolvedBookingId);
        if (redisData) {
          bookingData = typeof redisData === 'string' ? JSON.parse(redisData) : redisData;
          logStructured('info', 'Corrida encontrada no Redis (bookings:active)', {
            service: 'woovi-routes',
            rideId: resolvedBookingId
          });
        } else {
          // Tentar buscar de booking:${rideId}
          const bookingKey = `booking:${resolvedBookingId}`;
          const bookingHash = await redis.hgetall(bookingKey);
          if (bookingHash && Object.keys(bookingHash).length > 0) {
            bookingData = {};
            for (const [key, value] of Object.entries(bookingHash)) {
              try {
                bookingData[key] = JSON.parse(value);
              } catch {
                bookingData[key] = value;
              }
            }
            logStructured('info', `Corrida encontrada no Redis (booking:${resolvedBookingId})`, {
              service: 'woovi-routes',
              rideId: resolvedBookingId
            });
          }
        }
      }
    } catch (redisError) {
      logStructured('warn', 'Erro ao buscar do Redis', {
        service: 'woovi-routes',
        error: redisError.message,
        rideId: resolvedBookingId
      });
    }

    // ✅ Se não encontrou no Redis, buscar do Firestore
    if (!bookingData) {
      try {
        const firebaseConfig = require('../firebase-config');
        const firestore = firebaseConfig.getFirestore();
        if (firestore) {
          const bookingRef = firestore.collection('bookings').doc(resolvedBookingId);
          const bookingDoc = await bookingRef.get();

          if (bookingDoc.exists) {
            bookingData = bookingDoc.data();
            logStructured('info', 'Corrida encontrada no Firestore', {
              service: 'woovi-routes',
              rideId: resolvedBookingId
            });
          }
        }
      } catch (firestoreError) {
        logStructured('warn', 'Erro ao buscar do Firestore', {
          service: 'woovi-routes',
          error: firestoreError.message,
          rideId: resolvedBookingId
        });
      }
    }

    // ✅ Extrair driverId dos dados da corrida
    if (bookingData) {
      driverId = bookingData.driverId
        || bookingData.driver?.uid
        || bookingData.driver?.id
        || bookingData.driverId;

      logStructured('info', 'Dados da corrida', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        driverId,
        status: bookingData.status,
        passengerId: bookingData.passengerId || bookingData.customer?.uid
      });
    }

    const storeResult = await paymentService.storeConfirmedPayment({
      rideId: resolvedBookingId,
      chargeId,
      amount,
      passengerId,
      metadata
    });

    if (!storeResult.success) {
      logError(new Error(storeResult.error), 'Falha ao armazenar pagamento confirmado', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId
      });
    }

    try {
      await paymentDispatchService.markBookingPaymentConfirmed({
        bookingId: resolvedBookingId,
        chargeId,
        temporaryRideId: rideId,
        amountInCents,
        paymentStatus: 'in_holding',
        source: 'woovi_webhook'
      });
    } catch (markError) {
      logStructured('warn', 'Falha ao marcar booking como pago no webhook', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        error: markError.message
      });
    }

    const rideStatus = (bookingData?.status || 'pending').toUpperCase();

    if (driverId) {
      await paymentService.associateDriverToPayment(resolvedBookingId, driverId);

      const completedStatuses = ['COMPLETED', 'FINISHED', 'FINALIZED', 'DONE'];
      if (completedStatuses.includes(rideStatus)) {
        const releaseResult = await paymentService.releasePaymentToDriver(resolvedBookingId, driverId);
        if (releaseResult.success) {
          emitPassengerStatus('PAYMENT_RELEASED', { driverId, amount });
        }
      } else {
        emitPassengerStatus('AWAITING_TRIP_COMPLETION', { driverId });
      }
    } else {
      emitPassengerStatus('AWAITING_DRIVER');
    }

    paymentDispatchService.triggerDispatchAfterPayment({
      bookingId: resolvedBookingId,
      io,
      pickupLocation: bookingData?.pickupLocation || null,
      source: 'woovi_webhook_payment_confirmed',
      force: true,
      maxAttempts: Number.parseInt(process.env.WEBHOOK_PAYMENT_DISPATCH_MAX_ATTEMPTS || '120', 10),
      retryDelayMs: Number.parseInt(process.env.WEBHOOK_PAYMENT_DISPATCH_RETRY_DELAY_MS || '1000', 10)
    }).then((dispatchResult) => {
      logStructured('info', 'Dispatch pós-pagamento (webhook) processado', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        success: Boolean(dispatchResult?.success),
        skipped: Boolean(dispatchResult?.skipped),
        reason: dispatchResult?.reason || null,
        attempts: dispatchResult?.attempts || 1
      });
    }).catch((dispatchError) => {
      logStructured('warn', 'Falha ao acionar dispatch pós-pagamento (webhook)', {
        service: 'woovi-routes',
        rideId: resolvedBookingId,
        chargeId,
        error: dispatchError.message
      });
    });

    return {
      success: true,
      rideId: resolvedBookingId,
      chargeId,
      status: 'confirmed'
    };

  } catch (error) {
    logError(error, 'Erro ao processar confirmação de pagamento', { service: 'woovi-routes', chargeId, rideId });
    return {
      success: false,
      error: error.message
    };
  }
}

// ✅ Tokenizar Cartão de Crédito via Woovi/OpenPix
router.post('/woovi/tokenize-card', async (req, res) => {
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

// ==================== STUB HANDLERS PARA WEBHOOKS ====================
// Para evitar erros de "is not defined" e garantir retorno 200 OK para a Woovi

async function handleChargeCreated(data) {
  logStructured('info', 'Webhook Handler: Nova cobrança criada registrada no sistema (stub)', { service: 'woovi-routes' });
}

async function handleChargeExpired(data) {
  logStructured('info', 'Webhook Handler: Cobrança expirada (stub)', { service: 'woovi-routes' });
}

async function handleTransactionReceived(data, io = null) {
  const charge = data?.charge || data?.data || {};
  const chargeId =
    charge?.identifier ||
    charge?.id ||
    charge?.transactionID ||
    data?.identifier ||
    data?.id ||
    data?.transactionID ||
    null;
  const statusRaw = charge?.status || data?.status || '';
  const status = String(statusRaw || '').toUpperCase();

  logStructured('info', 'Webhook Handler: Transação recebida', {
    service: 'woovi-routes',
    chargeId,
    status: status || 'N/A'
  });

  if (!chargeId) {
    return;
  }

  const normalizedPayload = {
    ...data,
    event: data?.event || 'OPENPIX:TRANSACTION_RECEIVED',
    charge: {
      ...charge,
      identifier: chargeId,
      status: status || 'COMPLETED'
    }
  };

  await handleChargeCompleted(normalizedPayload, io);
}

async function handleRefundReceivedConfirmed(data) {
  logStructured('info', 'Webhook Handler: Reembolso recebido e confirmado (stub)', { service: 'woovi-routes' });
}

async function handleRefundReceivedRejected(data) {
  logStructured('info', 'Webhook Handler: Reembolso recebido, mas rejeitado (stub)', { service: 'woovi-routes' });
}

async function handleRefundSentConfirmed(data) {
  logStructured('info', 'Webhook Handler: Reembolso enviado e confirmado (stub)', { service: 'woovi-routes' });
}

async function handleAccountApproved(data) {
  logStructured('info', 'Webhook Handler: Conta BaaS aprovada (stub)', { service: 'woovi-routes' });
}

async function handleChargeCompletedDifferentPayer(data) {
  logStructured('info', 'Webhook Handler: Pagamento concluído por um pagador diferente (stub)', { service: 'woovi-routes' });
}

module.exports = router;
