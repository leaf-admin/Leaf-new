// Gerado a partir de routes/woovi.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Webhook canônico e aliases de compatibilidade

const {
  router,
  logStructured,
  logError,
  legacyWooviAliasRouteEnabled,
  verifyWooviWebhookSignature,
  auditWooviWebhookDecision,
  beginWooviWebhookIdempotency,
  completeWooviWebhookIdempotency,
  forwardToCanonicalWooviWebhook,
  handleChargeCompleted,
  handleChargeCreated,
  handleChargeExpired,
  handleTransactionReceived,
  handleRefundReceivedConfirmed,
  handleRefundReceivedRejected,
  handleRefundSentConfirmed,
  handleAccountApproved,
  handleChargeCompletedDifferentPayer,
} = require('./shared');

// Webhook principal para receber notificações da Woovi
// Documentação: https://developers.woovi.com/docs/category/exemplos
router.post('/woovi/webhook', async (req, res) => {
  // ✅ Armazenar io no req para uso nas funções de handler
  req.io = req.app.get('io');
  let idempotencyDecision = null;
  try {
    const signatureDecision = verifyWooviWebhookSignature(req);
    // ✅ Log resumido do webhook recebido
    const event = req.body.event || req.body.type || req.body.name || 'UNKNOWN';
    const charge = req.body.charge || req.body.data || {};
    const chargeId = charge.identifier || charge.id || null;
    const correlationID = charge.correlationID || charge.correlationId || null;
    const status = charge.status || 'N/A';
    const amount = charge.value || charge.amount || 0;

    if (!signatureDecision.valid) {
      await auditWooviWebhookDecision({
        decision: 'rejected',
        reason: signatureDecision.reason,
        signatureValid: false,
        signatureMethod: null,
        recommendedSignaturePresent: signatureDecision.recommendedSignaturePresent,
        deprecatedHmacPresent: signatureDecision.deprecatedHmacPresent,
        authorizationConfigured: signatureDecision.authorizationConfigured || false,
        providerVerificationRequired: signatureDecision.providerVerificationRequired || false,
        event,
        chargeId,
        correlationID,
        amount,
        status
      });

      return res.status(401).json({
        success: false,
        error: 'Webhook inválido',
        code: signatureDecision.reason || 'WEBHOOK_SIGNATURE_INVALID'
      });
    }

    idempotencyDecision = await beginWooviWebhookIdempotency({
      event,
      chargeId,
      amount
    });

    if (idempotencyDecision.duplicate) {
      await auditWooviWebhookDecision({
        decision: 'duplicate_ignored',
        signatureValid: true,
        signatureMethod: signatureDecision.method,
        providerVerificationRequired: signatureDecision.providerVerificationRequired || false,
        event,
        chargeId,
        correlationID,
        amount,
        status,
        idempotencyKey: idempotencyDecision.key
      });

      return res.status(200).json({
        success: true,
        received: true,
        duplicate: true,
        timestamp: new Date().toISOString()
      });
    }

    await auditWooviWebhookDecision({
      decision: 'accepted_for_processing',
      signatureValid: true,
      signatureMethod: signatureDecision.method,
      recommendedSignaturePresent: signatureDecision.recommendedSignaturePresent,
      deprecatedHmacPresent: signatureDecision.deprecatedHmacPresent,
      authorizationConfigured: signatureDecision.authorizationConfigured || false,
      providerVerificationRequired: signatureDecision.providerVerificationRequired || false,
      event,
      chargeId,
      correlationID,
      amount,
      status,
      idempotencyKey: idempotencyDecision.key || null
    });
    req.body._webhookSignatureMethod = signatureDecision.method;
    req.body._webhookProviderVerificationRequired = Boolean(signatureDecision.providerVerificationRequired);
    let processingResult = null;

    logStructured('info', 'Webhook recebido', {
      service: 'woovi-routes',
      event,
      chargeId,
      status,
      amount: amount ? (amount / 100).toFixed(2) : 'N/A',
      signatureValid: true,
      signatureMethod: signatureDecision.method,
      providerVerificationRequired: signatureDecision.providerVerificationRequired || false,
      timestamp: new Date().toISOString()
    });

    // ✅ Formato real da Woovi: { event: 'OPENPIX:CHARGE_COMPLETED', charge: {...}, pix: {...}, company: {...}, account: {...} }
    // ✅ Também pode vir como: { type: 'charge.completed', data: {...} }

    if (!event) {
      logStructured('warn', 'Evento não encontrado no payload', { service: 'woovi-routes', body: req.body });
      // Mesmo sem evento, tentar processar se houver charge com status COMPLETED
      if (charge && (charge.identifier || charge.id) && charge.status === 'COMPLETED') {
        logStructured('info', 'Processando sem evento, mas com charge COMPLETED', { service: 'woovi-routes', chargeId: charge.identifier || charge.id });
        processingResult = await handleChargeCompleted(req.body, req.io);
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
          processingResult = await handleChargeCompleted(req.body, req.io);
          break;

        case 'OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER': // ✅ Cobrança paga por pagador diferente
          logStructured('warn', 'Cobrança paga por pagador diferente do cliente', { service: 'woovi-routes', event });
          processingResult = await handleChargeCompletedDifferentPayer(req.body);
          break;

        case 'OPENPIX:CHARGE_CREATED': // ✅ Nova cobrança criada
        case 'CHARGE_CREATED':
        case 'charge.created':
        case 'Leaf-charge.created':
          logStructured('info', 'Nova cobrança criada', { service: 'woovi-routes', event });
          processingResult = await handleChargeCreated(req.body);
          break;

        case 'OPENPIX:CHARGE_EXPIRED': // ✅ Cobrança expirada
        case 'CHARGE_EXPIRED':
        case 'charge.expired':
        case 'Leaf-charge.expired':
          logStructured('info', 'Cobrança expirada', { service: 'woovi-routes', event });
          processingResult = await handleChargeExpired({ ...req.body, io: req.io });
          break;

        // ==================== EVENTOS DE TRANSAÇÃO ====================
        case 'OPENPIX:TRANSACTION_RECEIVED': // ✅ Transação recebida (cobrança ou QR code estático)
          logStructured('info', 'Transação recebida', { service: 'woovi-routes', event });
          processingResult = await handleTransactionReceived(req.body, req.io);
          break;

        // ==================== EVENTOS DE REEMBOLSO ====================
        case 'PIX_TRANSACTION_REFUND_RECEIVED_CONFIRMED': // ✅ Reembolso recebido e confirmado
          logStructured('info', 'Reembolso recebido e confirmado', { service: 'woovi-routes', event });
          processingResult = await handleRefundReceivedConfirmed(req.body);
          break;

        case 'PIX_TRANSACTION_REFUND_RECEIVED_REJECTED': // ✅ Reembolso recebido mas rejeitado
          logStructured('warn', 'Reembolso recebido mas rejeitado', { service: 'woovi-routes', event });
          processingResult = await handleRefundReceivedRejected(req.body);
          break;

        case 'PIX_TRANSACTION_REFUND_SENT_CONFIRMED': // ✅ Reembolso enviado e confirmado
          logStructured('info', 'Reembolso enviado e confirmado', { service: 'woovi-routes', event });
          processingResult = await handleRefundSentConfirmed(req.body);
          break;

        // ==================== EVENTOS DE CONTA BaaS ====================
        case 'ACCOUNT_REGISTER_APPROVED': // ✅ Conta BaaS aprovada
          logStructured('info', 'Conta BaaS aprovada', { service: 'woovi-routes', event });
          processingResult = await handleAccountApproved(charge || req.body);
          break;

        // ==================== EVENTOS LEGADOS (compatibilidade) ====================
        case 'REFUND_RECEIVED':
        case 'refund.received':
        case 'Leaf-refund.received':
          logStructured('info', 'Reembolso recebido (legado)', { service: 'woovi-routes', event });
          processingResult = await handleRefundReceivedConfirmed(req.body);
          break;

        default:
          logStructured('warn', 'Evento não tratado', { service: 'woovi-routes', event });
          // ✅ Fallback: Se não reconhecer o evento mas tiver charge COMPLETED, processar mesmo assim
          if (charge && charge.status === 'COMPLETED') {
            logStructured('info', 'Processando charge COMPLETED mesmo com evento desconhecido', { service: 'woovi-routes', event });
            processingResult = await handleChargeCompleted(req.body, req.io);
          }
      }
    }

    const idempotencyOutcome = processingResult?.success === false && processingResult?.status === 'REJECTED'
      ? 'rejected'
      : 'processed';
    await completeWooviWebhookIdempotency(idempotencyDecision, idempotencyOutcome, {
      result: processingResult || { handled: true },
      responseStatus: 200
    });

    // Sempre responder 200 OK para a Woovi
    res.status(200).json({
      success: true,
      received: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError(error, 'Erro no webhook', { service: 'woovi-routes' });
    await completeWooviWebhookIdempotency(idempotencyDecision, 'failed', {
      error: error.message,
      responseStatus: 500
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/webhooks/woovi', forwardToCanonicalWooviWebhook);

// ✅ Rota alternativa com hífen (habilite apenas se precisar suportar webhook legado)
if (legacyWooviAliasRouteEnabled) {
  router.post('/woovi-webhook', forwardToCanonicalWooviWebhook);
}
