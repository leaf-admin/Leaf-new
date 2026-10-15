// Rotas Woovi/OpenPix (cobranças, subcontas, webhooks e confirmação de pagamento). O código
// fica em routes/woovi/: shared.js com dependências, helpers e handlers, e um arquivo por
// grupo de rotas. A ordem dos require abaixo é a ordem de registro no Express.
const {
  router,
  normalizeEventName,
  normalizePaymentStatus,
  isRetryableWebhookEvent,
  canSandboxTestPaymentActorConfirm,
  extractWebhookChargePayload,
  validateSandboxTestWebhookPayload,
  evaluateSandboxPaymentIntentFreshness,
  resolveSandboxTestWebhookPayload,
  hasSandboxPaymentConfirmationSignal,
  resolveSandboxPaymentIntentAsBooking,
  requestWooviSandboxTestPayment,
  verifyWooviWebhookSignature,
  beginWooviWebhookIdempotency,
  completeWooviWebhookIdempotency,
  extractExpectedBookingAmountInCents,
  validateWebhookAmountAgainstBooking,
  processPaymentConfirmation,
} = require('./woovi/shared');

require('./woovi/01-charges');
require('./woovi/02-master-subaccounts');
require('./woovi/03-webhook-admin');
require('./woovi/04-sandbox-confirmation');
require('./woovi/05-webhook');
require('./woovi/06-card-tokenization');

router.__private = {
  verifyWooviWebhookSignature,
  beginWooviWebhookIdempotency,
  completeWooviWebhookIdempotency,
  extractExpectedBookingAmountInCents,
  validateWebhookAmountAgainstBooking,
  validateSandboxTestWebhookPayload,
  evaluateSandboxPaymentIntentFreshness,
  canSandboxTestPaymentActorConfirm,
  resolveSandboxTestWebhookPayload,
  requestWooviSandboxTestPayment,
  extractWebhookChargePayload,
  resolveSandboxPaymentIntentAsBooking,
  hasSandboxPaymentConfirmationSignal,
  processPaymentConfirmation,
  isRetryableWebhookEvent,
  normalizeEventName,
  normalizePaymentStatus
};

module.exports = router;
