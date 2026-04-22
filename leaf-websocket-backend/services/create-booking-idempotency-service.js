function normalizeCreateBookingPaymentReference(data = {}) {
    const reference = String(
        data?.paymentId ||
        data?.paymentData?.chargeId ||
        data?.paymentData?.paymentId ||
        ''
    ).trim();

    return reference || '';
}

function normalizeCoordinate(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return '';
    return parsed.toFixed(5);
}

function buildRouteSignature(data = {}) {
    const pickupLat = normalizeCoordinate(data?.pickupLocation?.lat);
    const pickupLng = normalizeCoordinate(data?.pickupLocation?.lng);
    const destinationLat = normalizeCoordinate(data?.destinationLocation?.lat);
    const destinationLng = normalizeCoordinate(data?.destinationLocation?.lng);
    const paymentMethod = String(data?.paymentMethod || 'unknown').trim().toLowerCase();

    if (!pickupLat || !pickupLng || !destinationLat || !destinationLng) {
        return '';
    }

    return `route:${pickupLat}:${pickupLng}:${destinationLat}:${destinationLng}:${paymentMethod}`;
}

function buildCanonicalCreateBookingIdempotencyKey({
    userId,
    data = {},
    fallbackIdempotencyKey = ''
}) {
    const normalizedUserId = String(userId || '').trim() || 'anonymous';
    const paymentReference = normalizeCreateBookingPaymentReference(data);

    if (paymentReference) {
        return `${normalizedUserId}:createBooking:payment:${paymentReference}`;
    }

    const routeSignature = buildRouteSignature(data);
    if (routeSignature) {
        return `${normalizedUserId}:createBooking:${routeSignature}`;
    }

    return String(fallbackIdempotencyKey || '').trim() || `${normalizedUserId}:createBooking:unknown`;
}

module.exports = {
    normalizeCreateBookingPaymentReference,
    buildCanonicalCreateBookingIdempotencyKey,
    buildRouteSignature
};
