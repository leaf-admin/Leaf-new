const PAID_PAYMENT_STATUSES = new Set([
  'approved',
  'completed',
  'confirmed',
  'credited',
  'distributed',
  'in_holding',
  'paid',
  'settled'
]);

const AUTHORITATIVE_PAYMENT_RECORD_SOURCES = new Set([
  'provider_verification',
  'sandbox_provider_verification',
  'woovi_provider_verification',
  'woovi_webhook',
  'woovi_extension_webhook',
  'socket_confirmpayment_provider_verified',
  'createbooking_paid_immediate'
]);

const NON_AUTHORITATIVE_PAYMENT_STATUS_SOURCES = new Set([
  'booking_cache',
  'payment_holding_doc',
  'payment_holding_query',
  'payment_holding_retry',
  'payment_status_cache',
  'ride_payments_query',
  'socket_confirmPayment',
  'socket_mock_payment'
]);

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function isProductionRuntime() {
  return [
    process.env.NODE_ENV,
    process.env.APP_ENV,
    process.env.LEAF_ENV,
    process.env.ENVIRONMENT
  ].some((value) => ['production', 'prod'].includes(String(value || '').trim().toLowerCase()));
}

function normalizePaymentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isPaidPaymentStatus(value) {
  return PAID_PAYMENT_STATUSES.has(normalizePaymentStatus(value));
}

function normalizePaymentAmountCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 1000 ? Math.round(numeric * 100) : Math.round(numeric);
}

function collectPaymentReferences(...values) {
  return Array.from(new Set(
    values
      .flat()
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
}

function isSocketMockPaymentAllowed(data = {}) {
  const requestedMockPayment =
    data?.mockPayment === true ||
    data?.__mockPayment === true ||
    boolEnv('MOCK_PAYMENT_FOR_TESTS', false);

  if (!requestedMockPayment) {
    return false;
  }

  if (boolEnv('APP_REVIEW', false)) {
    return true;
  }

  if (boolEnv('MOCK_PAYMENT_FOR_TESTS', false)) {
    return !isProductionRuntime();
  }

  if (boolEnv('ALLOW_SOCKET_MOCK_PAYMENT_CONFIRMATION', false)) {
    return !isProductionRuntime();
  }

  return false;
}

function shouldRequireProviderPaymentConfirmation() {
  return isProductionRuntime() || boolEnv('SOCKET_CONFIRM_PAYMENT_REQUIRE_PROVIDER', false);
}

function recordMatchesAnyReference(record = {}, references = []) {
  if (!references.length) {
    return false;
  }
  const candidates = collectPaymentReferences(
    record.chargeId,
    record.paymentId,
    record.paymentIntentId,
    record.extensionChargeId,
    record.correlationID,
    record.metadata?.chargeId,
    record.metadata?.paymentId,
    record.metadata?.paymentIntentId,
    record.metadata?.correlationID
  );
  return candidates.some((candidate) => references.includes(candidate));
}

function amountMatchesExpected(record = {}, expectedAmountInCents = 0) {
  if (!expectedAmountInCents) {
    return true;
  }
  const recordAmount = normalizePaymentAmountCents(
    record.amountInCents ??
    record.amount ??
    record.metadata?.amountInCents ??
    record.metadata?.amount
  );
  return recordAmount > 0 && recordAmount === expectedAmountInCents;
}

function isAuthoritativePaymentRecord(record = {}, { references = [], expectedAmountInCents = 0 } = {}) {
  const source = normalizePaymentStatus(record.source || record.metadata?.source);
  return (
    isPaidPaymentStatus(record.status || record.paymentStatus) &&
    AUTHORITATIVE_PAYMENT_RECORD_SOURCES.has(source) &&
    recordMatchesAnyReference(record, references) &&
    amountMatchesExpected(record, expectedAmountInCents)
  );
}

function isAuthoritativeProviderStatus(status = {}, expectedAmountInCents = 0) {
  const source = normalizePaymentStatus(status.source);
  if (!status?.success || !isPaidPaymentStatus(status.status)) {
    return false;
  }
  if (NON_AUTHORITATIVE_PAYMENT_STATUS_SOURCES.has(source)) {
    return false;
  }
  if (source && source !== 'woovi_provider' && !AUTHORITATIVE_PAYMENT_RECORD_SOURCES.has(source)) {
    return false;
  }
  if (!amountMatchesExpected(status, expectedAmountInCents)) {
    return false;
  }
  return source === 'woovi_provider' || Boolean(status.providerEnvironment || status.paymentProfileId);
}

async function getFirestoreDocData(firestore, collectionName, docId) {
  if (!firestore || !collectionName || !docId) {
    return null;
  }
  const doc = await firestore.collection(collectionName).doc(docId).get();
  return doc?.exists ? doc.data() : null;
}

async function queryFirstDocData(firestore, collectionName, field, value) {
  if (!firestore || !collectionName || !field || !value) {
    return null;
  }
  const collection = firestore.collection(collectionName);
  if (typeof collection?.where !== 'function') {
    return null;
  }
  const query = collection.where(field, '==', value).limit(1);
  const snapshot = await query.get();
  if (!snapshot || snapshot.empty) {
    return null;
  }
  return snapshot.docs?.[0]?.data?.() || null;
}

async function resolveAuthoritativePaymentConfirmation({
  paymentService,
  firestore,
  bookingId,
  references = [],
  expectedAmountInCents = 0
} = {}) {
  const safeReferences = collectPaymentReferences(references);
  if (!safeReferences.length) {
    return {
      success: false,
      code: 'PAYMENT_PROVIDER_REFERENCE_REQUIRED',
      message: 'Referência de pagamento ausente para confirmação provider-backed.'
    };
  }

  const localRecords = [];
  const localDocIds = collectPaymentReferences(bookingId, safeReferences);
  for (const docId of localDocIds) {
    localRecords.push(await getFirestoreDocData(firestore, 'payment_holdings', docId));
    localRecords.push(await getFirestoreDocData(firestore, 'ride_payments', docId));
  }

  for (const reference of safeReferences) {
    localRecords.push(await queryFirstDocData(firestore, 'payment_holdings', 'paymentId', reference));
    localRecords.push(await queryFirstDocData(firestore, 'payment_holdings', 'chargeId', reference));
    localRecords.push(await queryFirstDocData(firestore, 'ride_payments', 'chargeId', reference));
  }

  const authoritativeLocalRecord = localRecords.find((record) =>
    record && isAuthoritativePaymentRecord(record, {
      references: safeReferences,
      expectedAmountInCents
    })
  );
  if (authoritativeLocalRecord) {
    return {
      success: true,
      source: authoritativeLocalRecord.source || authoritativeLocalRecord.metadata?.source || 'authoritative_local_record',
      record: authoritativeLocalRecord
    };
  }

  if (paymentService && typeof paymentService.getPaymentStatus === 'function') {
    for (const reference of safeReferences) {
      const providerStatus = await paymentService.getPaymentStatus(reference);
      if (isAuthoritativeProviderStatus(providerStatus, expectedAmountInCents)) {
        return {
          success: true,
          source: providerStatus.source || 'woovi_provider',
          record: providerStatus
        };
      }
    }
  }

  return {
    success: false,
    code: 'PAYMENT_NOT_PROVIDER_CONFIRMED',
    message: 'Pagamento ainda não possui confirmação autoritativa do provedor.'
  };
}

module.exports = {
  AUTHORITATIVE_PAYMENT_RECORD_SOURCES,
  NON_AUTHORITATIVE_PAYMENT_STATUS_SOURCES,
  PAID_PAYMENT_STATUSES,
  amountMatchesExpected,
  collectPaymentReferences,
  isAuthoritativePaymentRecord,
  isAuthoritativeProviderStatus,
  isPaidPaymentStatus,
  isProductionRuntime,
  isSocketMockPaymentAllowed,
  normalizePaymentAmountCents,
  normalizePaymentStatus,
  resolveAuthoritativePaymentConfirmation,
  shouldRequireProviderPaymentConfirmation
};
