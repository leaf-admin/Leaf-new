const crypto = require('crypto');

const FINANCIAL_CONTEXT_VERSION = 1;
const FINANCIAL_NAMESPACES = Object.freeze({
  OPERATIONAL: 'operational',
  SANDBOX: 'sandbox'
});

const FINANCIAL_COLLECTIONS = Object.freeze({
  operational: Object.freeze({
    paymentIntents: 'payment_intents',
    ridePayments: 'ride_payments',
    paymentHoldings: 'payment_holdings',
    paymentDistributions: 'payment_distributions',
    paymentHistory: 'payment_history',
    ledgerEvents: 'financial_ledger_events',
    ledgerLines: 'financial_ledger_lines',
    driverBalances: 'driver_balances',
    reconciliationReports: 'financial_reconciliation_reports',
    receipts: 'receipts'
  }),
  sandbox: Object.freeze({
    paymentIntents: 'sandbox_payment_intents',
    ridePayments: 'sandbox_ride_payments',
    paymentHoldings: 'sandbox_payment_holdings',
    paymentDistributions: 'sandbox_payment_distributions',
    paymentHistory: 'sandbox_payment_history',
    ledgerEvents: 'sandbox_financial_ledger_events',
    ledgerLines: 'sandbox_financial_ledger_lines',
    driverBalances: 'sandbox_driver_balances',
    reconciliationReports: 'sandbox_financial_reconciliation_reports',
    receipts: 'sandbox_receipts'
  })
});

function normalizeEnvironment(value) {
  return String(value || '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
}

function parseContext(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function contextPayload(context = {}) {
  return {
    version: FINANCIAL_CONTEXT_VERSION,
    namespace: context.namespace,
    classification: context.classification,
    providerEnvironment: context.providerEnvironment,
    paymentProfileId: context.paymentProfileId || null,
    paymentProfileSource: context.paymentProfileSource || null,
    testUserSandbox: context.testUserSandbox === true
  };
}

function buildContextId(context = {}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(contextPayload(context)))
    .digest('hex');
}

function sealFinancialContext(input = {}) {
  const providerEnvironment = normalizeEnvironment(
    input.providerEnvironment || input.environment
  );
  const namespace = providerEnvironment === 'sandbox'
    ? FINANCIAL_NAMESPACES.SANDBOX
    : FINANCIAL_NAMESPACES.OPERATIONAL;
  const testUserSandbox = input.testUserSandbox === true;
  const context = contextPayload({
    namespace,
    classification: namespace === FINANCIAL_NAMESPACES.SANDBOX
      ? (testUserSandbox ? 'sandbox_test_user' : 'sandbox')
      : 'operational',
    providerEnvironment,
    paymentProfileId: String(input.paymentProfileId || input.profileId || '').trim() || null,
    paymentProfileSource: String(input.paymentProfileSource || input.source || '').trim() || null,
    testUserSandbox
  });

  return Object.freeze({
    ...context,
    contextId: buildContextId(context)
  });
}

function hasSandboxSignal(input = {}) {
  const context = parseContext(input.financialContext || input);
  return (
    String(input.financialNamespace || input.namespace || context?.namespace || '').trim().toLowerCase() === 'sandbox' ||
    String(input.providerEnvironment || input.environment || context?.providerEnvironment || '').trim().toLowerCase() === 'sandbox' ||
    input.testUserSandbox === true ||
    context?.testUserSandbox === true
  );
}

function validateFinancialContext(value, options = {}) {
  const context = parseContext(value?.financialContext || value);
  if (!context) {
    if (options.allowLegacyOperational === true && !hasSandboxSignal(value || {})) {
      return { ok: true, context: sealFinancialContext({ providerEnvironment: 'production' }), legacy: true };
    }
    return { ok: false, code: 'FINANCIAL_CONTEXT_MISSING', error: 'Contexto financeiro ausente' };
  }

  const normalized = contextPayload(context);
  if (
    Number(context.version) !== FINANCIAL_CONTEXT_VERSION ||
    !Object.values(FINANCIAL_NAMESPACES).includes(normalized.namespace) ||
    !['production', 'sandbox'].includes(normalized.providerEnvironment) ||
    (normalized.namespace === 'sandbox') !== (normalized.providerEnvironment === 'sandbox') ||
    (normalized.namespace === 'operational' && normalized.classification !== 'operational') ||
    (normalized.namespace === 'sandbox' && !['sandbox', 'sandbox_test_user'].includes(normalized.classification)) ||
    (normalized.classification === 'sandbox_test_user') !== normalized.testUserSandbox
  ) {
    return { ok: false, code: 'FINANCIAL_CONTEXT_INVALID', error: 'Contexto financeiro inválido' };
  }

  const expectedContextId = buildContextId(normalized);
  if (!context.contextId || context.contextId !== expectedContextId) {
    return { ok: false, code: 'FINANCIAL_CONTEXT_TAMPERED', error: 'Contexto financeiro foi alterado' };
  }

  return { ok: true, context: Object.freeze({ ...normalized, contextId: expectedContextId }) };
}

function resolveFinancialContext(input = {}, options = {}) {
  const explicit = parseContext(input.financialContext || input);
  if (explicit && explicit.contextId) {
    return validateFinancialContext(explicit, options);
  }

  if (hasSandboxSignal(input)) {
    return {
      ok: false,
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST',
      error: 'Contexto financeiro sandbox ausente ou não selado'
    };
  }

  if (options.allowLegacyOperational === true) {
    return { ok: true, context: sealFinancialContext({ providerEnvironment: 'production' }), legacy: true };
  }

  return validateFinancialContext(explicit, options);
}

function getFinancialCollections(value, options = {}) {
  const resolved = resolveFinancialContext(value, options);
  if (!resolved.ok) {
    const error = new Error(resolved.error);
    error.code = resolved.code;
    throw error;
  }
  return {
    context: resolved.context,
    collections: FINANCIAL_COLLECTIONS[resolved.context.namespace]
  };
}

function contextsMatch(left, right) {
  const leftResult = validateFinancialContext(left);
  const rightResult = validateFinancialContext(right);
  return Boolean(
    leftResult.ok &&
    rightResult.ok &&
    leftResult.context.contextId === rightResult.context.contextId
  );
}

module.exports = {
  FINANCIAL_CONTEXT_VERSION,
  FINANCIAL_NAMESPACES,
  FINANCIAL_COLLECTIONS,
  sealFinancialContext,
  validateFinancialContext,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  hasSandboxSignal
};
