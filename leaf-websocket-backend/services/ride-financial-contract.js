const DEFAULT_POLICY = Object.freeze({
  policyId: 'runtime_tiered_percent_above_50_v1',
  operationalFeeUpTo10Cents: 79,
  operationalFee10To25Cents: 99,
  operationalFee25To50Cents: 149,
  operationalFeeAbove50Percentage: 0.03,
  threshold10Cents: 1000,
  threshold25Cents: 2500,
  threshold50Cents: 5000,
  paymentIntermediationPercentage: 0.008,
  paymentIntermediationMinimumCents: 50
});

function toCents(value) {
  const cents = Math.round(Number(value));
  return Number.isFinite(cents) ? Math.max(0, cents) : 0;
}

function clampCents(value, maxValue) {
  return Math.min(Math.max(0, toCents(value)), Math.max(0, toCents(maxValue)));
}

function resolveOperationalFee(grossFareCents, policy = DEFAULT_POLICY) {
  const grossFare = toCents(grossFareCents);

  if (grossFare <= policy.threshold10Cents) {
    return {
      feeCents: policy.operationalFeeUpTo10Cents,
      feeType: 'up_to_10'
    };
  }

  if (grossFare <= policy.threshold25Cents) {
    return {
      feeCents: policy.operationalFee10To25Cents,
      feeType: '10_to_25'
    };
  }

  if (grossFare <= policy.threshold50Cents) {
    return {
      feeCents: policy.operationalFee25To50Cents,
      feeType: '25_to_50'
    };
  }

  return {
    feeCents: Math.round(grossFare * policy.operationalFeeAbove50Percentage),
    feeType: 'above_50_percent'
  };
}

function resolvePaymentIntermediationFee(grossFareCents, policy = DEFAULT_POLICY) {
  const grossFare = toCents(grossFareCents);
  return Math.max(
    Math.round(grossFare * policy.paymentIntermediationPercentage),
    policy.paymentIntermediationMinimumCents
  );
}

function describeFinancialPolicy(policy = DEFAULT_POLICY) {
  return {
    policyId: String(policy.policyId || '').trim() || 'unidentified_financial_policy',
    currency: 'BRL',
    operationalFee: {
      upTo10Cents: toCents(policy.operationalFeeUpTo10Cents),
      from10To25Cents: toCents(policy.operationalFee10To25Cents),
      from25To50Cents: toCents(policy.operationalFee25To50Cents),
      above50Model: 'percentage',
      above50Percentage: Number(policy.operationalFeeAbove50Percentage)
    },
    paymentIntermediation: {
      percentage: Number(policy.paymentIntermediationPercentage),
      minimumCents: toCents(policy.paymentIntermediationMinimumCents)
    }
  };
}

function buildRideFinancialContract({
  passengerPaidCents = 0,
  tollFeeCents = 0,
  subscriptionRetainedFeeCents = 0,
  policy = DEFAULT_POLICY
} = {}) {
  const totalAmountCents = toCents(passengerPaidCents);
  const tollPassThroughCents = clampCents(tollFeeCents, totalAmountCents);
  const grossFareCents = Math.max(0, totalAmountCents - tollPassThroughCents);
  const operationalFee = resolveOperationalFee(grossFareCents, policy);
  const requestedOperationalFeeCents = toCents(operationalFee.feeCents);
  const leafOperationalFeeCents = clampCents(requestedOperationalFeeCents, grossFareCents);
  const remainingAfterOperationalFeeCents = Math.max(0, grossFareCents - leafOperationalFeeCents);
  const requestedPaymentIntermediationFeeCents = toCents(resolvePaymentIntermediationFee(grossFareCents, policy));
  const paymentIntermediationFeeCents = clampCents(
    requestedPaymentIntermediationFeeCents,
    remainingAfterOperationalFeeCents
  );
  const requestedSubscriptionRetainedFeeCents = toCents(subscriptionRetainedFeeCents);
  const remainingBeforeSubscriptionCents = Math.max(
    0,
    grossFareCents - leafOperationalFeeCents - paymentIntermediationFeeCents
  );
  const subscriptionRetainedCents = clampCents(
    requestedSubscriptionRetainedFeeCents,
    remainingBeforeSubscriptionCents + tollPassThroughCents
  );
  const driverNetAmountCents = Math.max(
    0,
    grossFareCents -
      leafOperationalFeeCents -
      paymentIntermediationFeeCents +
      tollPassThroughCents -
      subscriptionRetainedCents
  );
  const retainedTotalCents =
    leafOperationalFeeCents +
    paymentIntermediationFeeCents +
    subscriptionRetainedCents;
  const allocatedTotalCents = driverNetAmountCents + retainedTotalCents;

  return {
    currency: 'BRL',
    settlementModel: 'post_ride_ledger',
    passengerPaidCents: totalAmountCents,
    grossFareCents,
    tollFeeCents: tollPassThroughCents,
    driverTollPassThroughCents: tollPassThroughCents,
    leafOperationalFeeCents,
    paymentIntermediationFeeCents,
    subscriptionRetainedFeeCents: subscriptionRetainedCents,
    retainedTotalCents,
    driverNetAmountCents,
    allocatedTotalCents,
    balanced: allocatedTotalCents === totalAmountCents,
    feePolicy: {
      operationalFeeType: operationalFee.feeType,
      requestedOperationalFeeCents,
      requestedPaymentIntermediationFeeCents,
      requestedSubscriptionRetainedFeeCents,
      operationalFeeClamped: leafOperationalFeeCents !== requestedOperationalFeeCents,
      paymentIntermediationFeeClamped: paymentIntermediationFeeCents !== requestedPaymentIntermediationFeeCents,
      subscriptionRetainedFeeClamped: subscriptionRetainedCents !== requestedSubscriptionRetainedFeeCents
    }
  };
}

function resolveRequiredCents(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
    const error = new Error(`${fieldName} deve ser um inteiro não negativo em centavos`);
    error.code = 'FINANCIAL_SNAPSHOT_INVALID_AMOUNT';
    throw error;
  }
  return numeric;
}

function isTruthyFlag(value) {
  if (value === true) return true;
  return ['1', 'true', 'yes', 'sim'].includes(String(value || '').trim().toLowerCase());
}

function buildAuthoritativeFinancialSnapshot({
  passengerPaidCents,
  tollFeeCents = 0,
  operationalFeeCents,
  paymentIntermediationFeeCents,
  subscriptionRetainedFeeCents = 0,
  driverNetAmountCents
} = {}) {
  const passengerPaid = resolveRequiredCents(passengerPaidCents, 'passengerPaidCents');
  const tollPassThrough = resolveRequiredCents(tollFeeCents, 'tollFeeCents');
  const operationalFee = resolveRequiredCents(operationalFeeCents, 'operationalFeeCents');
  const paymentIntermediationFee = resolveRequiredCents(
    paymentIntermediationFeeCents,
    'paymentIntermediationFeeCents'
  );
  const subscriptionRetainedFee = resolveRequiredCents(
    subscriptionRetainedFeeCents,
    'subscriptionRetainedFeeCents'
  );
  const driverNetAmount = resolveRequiredCents(driverNetAmountCents, 'driverNetAmountCents');
  const retainedTotalCents = operationalFee + paymentIntermediationFee + subscriptionRetainedFee;
  const allocatedTotalCents = driverNetAmount + retainedTotalCents;

  if (tollPassThrough > passengerPaid || allocatedTotalCents !== passengerPaid) {
    const error = new Error('Snapshot financeiro final não fecha em centavos');
    error.code = 'FINANCIAL_SNAPSHOT_UNBALANCED';
    throw error;
  }

  return {
    version: 'ride_financial_snapshot_v1',
    currency: 'BRL',
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    passengerPaidCents: passengerPaid,
    grossFareCents: passengerPaid - tollPassThrough,
    tollFeeCents: tollPassThrough,
    driverTollPassThroughCents: tollPassThrough,
    operationalFeeCents: operationalFee,
    paymentIntermediationFeeCents: paymentIntermediationFee,
    subscriptionRetainedFeeCents: subscriptionRetainedFee,
    retainedTotalCents,
    driverNetAmountCents: driverNetAmount,
    allocatedTotalCents,
    balanced: true
  };
}

function validateAuthoritativeFinancialSnapshot(snapshot = {}, expected = {}) {
  try {
    if (!isTruthyFlag(snapshot.authoritativeSnapshot)) {
      return { valid: false, code: 'FINANCIAL_SNAPSHOT_NOT_AUTHORITATIVE' };
    }
    if (snapshot.financialSnapshotSource !== 'backend_final') {
      return { valid: false, code: 'FINANCIAL_SNAPSHOT_INVALID_SOURCE' };
    }

    const normalized = buildAuthoritativeFinancialSnapshot(snapshot);
    if (
      expected.passengerPaidCents !== undefined &&
      normalized.passengerPaidCents !== resolveRequiredCents(expected.passengerPaidCents, 'expectedPassengerPaidCents')
    ) {
      return { valid: false, code: 'FINANCIAL_SNAPSHOT_PASSENGER_AMOUNT_MISMATCH' };
    }
    if (
      expected.tollFeeCents !== undefined &&
      normalized.tollFeeCents !== resolveRequiredCents(expected.tollFeeCents, 'expectedTollFeeCents')
    ) {
      return { valid: false, code: 'FINANCIAL_SNAPSHOT_TOLL_MISMATCH' };
    }

    return { valid: true, snapshot: normalized };
  } catch (error) {
    return {
      valid: false,
      code: error.code || 'FINANCIAL_SNAPSHOT_INVALID',
      error: error.message
    };
  }
}

module.exports = {
  DEFAULT_POLICY,
  buildAuthoritativeFinancialSnapshot,
  buildRideFinancialContract,
  describeFinancialPolicy,
  resolveOperationalFee,
  resolvePaymentIntermediationFee,
  toCents,
  validateAuthoritativeFinancialSnapshot
};
