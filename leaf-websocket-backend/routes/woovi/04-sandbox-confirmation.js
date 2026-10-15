// Gerado a partir de routes/woovi.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Confirmação de pagamento em sandbox

const {
  router,
  authenticateJWT,
  requireRole,
  WOOVI_SANDBOX_TEST_ROLES,
  authenticateFirebaseSandboxPaymentActor,
  handleSandboxTestPaymentConfirmation,
} = require('./shared');

router.post(
  '/woovi/test-confirm-sandbox-payment',
  authenticateJWT,
  requireRole(WOOVI_SANDBOX_TEST_ROLES),
  handleSandboxTestPaymentConfirmation
);

router.post(
  '/woovi/test-confirm-sandbox-payment-app',
  authenticateFirebaseSandboxPaymentActor,
  handleSandboxTestPaymentConfirmation
);
