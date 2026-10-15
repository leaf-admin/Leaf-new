// Gerado a partir de services/payment-service.js (divisão mecânica, sem mudança de regra).
// Dependências e helpers de módulo usados pela PaymentService e por suas partes.

const WooviDriverService = require('../woovi-driver-service');
const { sortDriverWithdrawals, toDriverWithdrawalView } = require('../driver-withdrawal-view');
const firebaseConfig = require('../../firebase-config');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { getWooviConfig } = require('../../config/woovi-config');
const circuitBreakerService = require('../circuit-breaker-service');
const subscriptionStateService = require('../subscription-state-service');
const FinancialLedgerService = require('../financial-ledger-service');
const {
  FINANCIAL_COLLECTIONS,
  sealFinancialContext,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch
} = require('../financial-runtime-context');
const {
  buildRideFinancialContract,
  validateAuthoritativeFinancialSnapshot
} = require('../ride-financial-contract');
const paymentRuntimeProfileService = require('../payment-runtime-profile-service');
const { logStructured, logError } = require('../../utils/logger');
const traceContext = require('../../utils/trace-context');
const redisPool = require('../../utils/redis-pool');
const {
  evaluateRideFlowValidationPaymentProfile
} = require('../ride-flow-validation-guard');
const {
  assertStoredRecordMatchesScope,
  resolveRidePersistenceScope
} = require('../sandbox-persistence-context');

function resolveBookingCompatibilityCollection(input = {}) {
  const persistenceScope = resolveRidePersistenceScope(input);
  return {
    persistenceScope,
    collectionName: persistenceScope.collections.bookings
  };
}

function isRefundedPaymentStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return normalized === 'REFUNDED' ||
    normalized === 'REFUNDED_FULL' ||
    normalized === 'REFUNDED_PARTIAL';
}

function isCapturedPaymentStatus(status) {
  return ['PAID', 'CONFIRMED', 'LEDGER_PENDING', 'IN_HOLDING'].includes(
    String(status || '').trim().toUpperCase()
  );
}

module.exports = {
  WooviDriverService,
  sortDriverWithdrawals,
  toDriverWithdrawalView,
  firebaseConfig,
  admin,
  crypto,
  getWooviConfig,
  circuitBreakerService,
  subscriptionStateService,
  FinancialLedgerService,
  FINANCIAL_COLLECTIONS,
  sealFinancialContext,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  buildRideFinancialContract,
  validateAuthoritativeFinancialSnapshot,
  paymentRuntimeProfileService,
  logStructured,
  logError,
  traceContext,
  redisPool,
  evaluateRideFlowValidationPaymentProfile,
  assertStoredRecordMatchesScope,
  resolveRidePersistenceScope,
  resolveBookingCompatibilityCollection,
  isRefundedPaymentStatus,
  isCapturedPaymentStatus,
};
