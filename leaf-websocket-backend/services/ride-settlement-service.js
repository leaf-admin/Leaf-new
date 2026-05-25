const {
  calculateExecutedFareSettlement,
  parseMoneyValue,
  resolveContractualFare,
  resolvePrepaidAmount,
  resolveRideLegs,
  resolveOperationalContinuation,
  roundMoney
} = require('./ride-lifecycle-service');

function normalizeUpper(value, fallback) {
  const normalized = String(value || fallback || '').trim().toUpperCase();
  return normalized || String(fallback || '').trim().toUpperCase();
}

function buildPendingPaymentDistribution({ manualReview = false, message = null } = {}) {
  if (manualReview) {
    return {
      status: 'UNDER_REVIEW',
      message: message || 'Liquidação financeira em revisão manual'
    };
  }

  return {
    status: 'PENDING',
    message: message || 'Processamento assíncrono em andamento'
  };
}

function buildEarlyEndedReviewContext({
  actorId,
  actorType = 'system',
  reviewCategory = 'TECHNICAL_FAILURE',
  reason = 'MANUAL_REVIEW_REQUIRED',
  note = '',
  triggeredAt = new Date().toISOString()
} = {}) {
  return {
    reviewStatus: 'PENDING_MANUAL_REVIEW',
    actorId: String(actorId || '').trim() || null,
    actorType: normalizeUpper(actorType, 'SYSTEM'),
    reviewCategory: normalizeUpper(reviewCategory, 'TECHNICAL_FAILURE'),
    reason: normalizeUpper(reason, 'MANUAL_REVIEW_REQUIRED'),
    note: String(note || '').trim(),
    triggeredAt
  };
}

function buildEarlyEndedReviewSettlement(bookingHash = {}, options = {}) {
  const reviewContext = buildEarlyEndedReviewContext(options);
  const settlement = calculateExecutedFareSettlement(bookingHash, {
    ...options,
    settlementType: 'EARLY_ENDED_REVIEW',
    minChargeRatio: options.minChargeRatio ?? 0
  });

  return {
    ...settlement,
    reviewRequired: true,
    reviewStatus: reviewContext.reviewStatus,
    reviewCategory: reviewContext.reviewCategory,
    reviewReason: reviewContext.reason,
    reviewNote: reviewContext.note,
    finalizationMode: 'MANUAL_REVIEW_REQUIRED'
  };
}

function buildInterruptedOperationalEndedSettlement(bookingHash = {}, options = {}) {
  const continuation =
    options.operationalContinuation ||
    resolveOperationalContinuation(bookingHash) ||
    {};
  const rideLegs = Array.isArray(options.rideLegs)
    ? options.rideLegs
    : resolveRideLegs(bookingHash);
  const originalFare = roundMoney(resolveContractualFare(bookingHash));
  const prepaidAmount = roundMoney(Math.max(resolvePrepaidAmount(bookingHash), originalFare));
  const executedFare = roundMoney(
    parseMoneyValue(
      options.finalFare ??
        continuation.executedFare ??
        rideLegs[rideLegs.length - 1]?.grossAmount ??
        0,
      0
    )
  );
  const executedDistanceKm = roundMoney(
    parseMoneyValue(
      options.distanceKm ??
        rideLegs[rideLegs.length - 1]?.distanceKm ??
        bookingHash.distance ??
        0,
      0
    )
  );
  const executedDurationSecs = Math.round(
    parseMoneyValue(
      options.durationSecs ??
        rideLegs[rideLegs.length - 1]?.durationSecs ??
        bookingHash.duration ??
        0,
      0
    )
  );
  const tollFee = roundMoney(parseMoneyValue(bookingHash.tollFee || 0, 0));
  const estimatedRefund = roundMoney(
    parseMoneyValue(
      continuation.estimatedRefund,
      Math.max(0, prepaidAmount - executedFare)
    )
  );
  const remainingReservedAmount = roundMoney(
    parseMoneyValue(
      continuation.remainingReservedAmount,
      Math.max(0, prepaidAmount - executedFare)
    )
  );

  return {
    settlementType: 'INTERRUPTED_OPERATIONAL_ENDED',
    originalFare,
    prepaidAmount,
    executedFare,
    tollFee,
    estimatedRefund,
    remainingReservedAmount,
    executedDistanceKm,
    executedDurationSecs,
    rideLegCount: rideLegs.length,
    rideLegSettlements: rideLegs
  };
}

function buildAuthoritativeCompletionArtifacts({
  bookingHash = {},
  bookingId,
  status,
  completedAt = new Date().toISOString(),
  completionType = 'COMPLETED',
  completionReason = 'COMPLETED',
  endLocation = null,
  finalFare,
  distance,
  duration,
  settlement = null,
  rideLegs = null,
  operationalContinuation = null,
  reviewContext = null,
  paymentDistribution = null,
  driverId = null,
  customerId = null,
  traceId = null,
  correlationId = null
} = {}) {
  const normalizedSettlement = settlement || null;
  const normalizedFinalFare = roundMoney(
    parseMoneyValue(
      finalFare ?? normalizedSettlement?.executedFare ?? bookingHash.finalFare ?? 0,
      0
    )
  );
  const normalizedDistance = roundMoney(
    parseMoneyValue(
      distance ?? normalizedSettlement?.executedDistanceKm ?? bookingHash.distance ?? 0,
      0
    )
  );
  const normalizedDuration = Math.round(
    parseMoneyValue(
      duration ?? normalizedSettlement?.executedDurationSecs ?? bookingHash.duration ?? 0,
      0
    )
  );
  const normalizedTollFee = roundMoney(parseMoneyValue(bookingHash.tollFee || 0, 0));
  const distribution =
    paymentDistribution ||
    buildPendingPaymentDistribution({
      manualReview: completionType === 'EARLY_ENDED_REVIEW'
    });

  const baseFields = {
    driverId,
    customerId,
    completedAt,
    endLocation,
    finalFare: normalizedFinalFare,
    tollFee: normalizedTollFee,
    distance: normalizedDistance,
    duration: normalizedDuration,
    completionType,
    completionReason,
    paymentDistribution: distribution
  };

  const stateMetadata = {
    ...baseFields,
    ...(normalizedSettlement ? { settlement: normalizedSettlement } : {}),
    ...(Array.isArray(rideLegs) ? { rideLegs } : {}),
    ...(operationalContinuation ? { operationalContinuation } : {}),
    ...(reviewContext ? { reviewContext } : {})
  };

  const bookingPatch = {
    status: status || completionType,
    ...baseFields,
    ...(normalizedSettlement ? { settlement: normalizedSettlement } : {}),
    ...(Array.isArray(rideLegs) ? { rideLegs } : {}),
    ...(operationalContinuation ? { operationalContinuation } : {}),
    ...(reviewContext ? { reviewContext } : {}),
    financialSnapshotSource: 'backend_final'
  };

  if (completionType === 'EARLY_ENDED_BY_RIDER' && normalizedSettlement) {
    bookingPatch.earlyEndSettlement = normalizedSettlement;
    stateMetadata.earlyEndSettlement = normalizedSettlement;
  }

  if (completionType === 'EARLY_ENDED_REVIEW' && normalizedSettlement) {
    bookingPatch.reviewSettlement = normalizedSettlement;
    bookingPatch.reviewStatus = reviewContext?.reviewStatus || 'PENDING_MANUAL_REVIEW';
    bookingPatch.reviewReason = reviewContext?.reason || completionReason;
    stateMetadata.reviewSettlement = normalizedSettlement;
    stateMetadata.reviewStatus = bookingPatch.reviewStatus;
  }

  const eventData = {
    bookingId,
    ...baseFields,
    ...(normalizedSettlement ? { settlement: normalizedSettlement } : {}),
    ...(Array.isArray(rideLegs) ? { rideLegSettlements: rideLegs } : {}),
    ...(operationalContinuation ? { operationalContinuation } : {}),
    ...(reviewContext ? { reviewContext } : {}),
    traceId,
    correlationId
  };

  const resultData = {
    bookingId,
    ...baseFields,
    ...(normalizedSettlement ? { settlement: normalizedSettlement } : {}),
    ...(Array.isArray(rideLegs) ? { rideLegs } : {}),
    ...(operationalContinuation ? { interruption: operationalContinuation } : {}),
    ...(reviewContext ? { reviewContext } : {})
  };

  return {
    paymentDistribution: distribution,
    stateMetadata,
    bookingPatch,
    eventData,
    resultData
  };
}

module.exports = {
  buildPendingPaymentDistribution,
  buildEarlyEndedReviewContext,
  buildEarlyEndedReviewSettlement,
  buildInterruptedOperationalEndedSettlement,
  buildAuthoritativeCompletionArtifacts
};
