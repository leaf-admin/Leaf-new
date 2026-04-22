function toFiniteMoney(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function readEstimatedFareSnapshot(payload = {}) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const estimatedOperationalFee = toFiniteMoney(payload?.estimatedOperationalFee);
    const estimatedPaymentIntermediationFee = toFiniteMoney(payload?.estimatedPaymentIntermediationFee);
    const estimatedTotalFees = toFiniteMoney(payload?.estimatedTotalFees);
    const estimatedDriverNetAmount = toFiniteMoney(payload?.estimatedDriverNetAmount);

    const hasSnapshot = [
        estimatedOperationalFee,
        estimatedPaymentIntermediationFee,
        estimatedTotalFees,
        estimatedDriverNetAmount
    ].some((value) => value !== null);

    if (!hasSnapshot) {
        return null;
    }

    return {
        ...(estimatedOperationalFee !== null ? { estimatedOperationalFee } : {}),
        ...(estimatedPaymentIntermediationFee !== null ? { estimatedPaymentIntermediationFee } : {}),
        ...(estimatedTotalFees !== null ? { estimatedTotalFees } : {}),
        ...(estimatedDriverNetAmount !== null ? { estimatedDriverNetAmount } : {})
    };
}

function buildEstimatedFareSnapshot(paymentService, estimatedFare, tollFee = 0) {
    if (!paymentService || typeof paymentService.calculateFareBreakdownFromReais !== 'function') {
        return null;
    }

    const normalizedEstimatedFare = toFiniteMoney(estimatedFare);
    const normalizedTollFee = toFiniteMoney(tollFee);

    if (normalizedEstimatedFare === null || normalizedEstimatedFare < 0) {
        return null;
    }

    const breakdown = paymentService.calculateFareBreakdownFromReais(
        normalizedEstimatedFare,
        normalizedTollFee !== null && normalizedTollFee >= 0 ? normalizedTollFee : 0
    );

    return {
        estimatedOperationalFee: toFiniteMoney(breakdown?.operationalFee) ?? 0,
        estimatedPaymentIntermediationFee: toFiniteMoney(breakdown?.paymentIntermediationFee) ?? 0,
        estimatedTotalFees: toFiniteMoney(breakdown?.totalFees) ?? 0,
        estimatedDriverNetAmount: toFiniteMoney(breakdown?.driverNetAmount) ?? 0
    };
}

function resolveEstimatedFareSnapshot({
    payload = null,
    paymentService = null,
    estimatedFare = null,
    tollFee = 0
} = {}) {
    const existingSnapshot = readEstimatedFareSnapshot(payload);
    if (existingSnapshot) {
        return existingSnapshot;
    }

    return buildEstimatedFareSnapshot(paymentService, estimatedFare, tollFee);
}

module.exports = {
    buildEstimatedFareSnapshot,
    readEstimatedFareSnapshot,
    resolveEstimatedFareSnapshot,
    toFiniteMoney
};
