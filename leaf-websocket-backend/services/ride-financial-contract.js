const DEFAULT_POLICY = Object.freeze({
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

module.exports = {
  DEFAULT_POLICY,
  buildRideFinancialContract,
  resolveOperationalFee,
  resolvePaymentIntermediationFee,
  toCents
};
