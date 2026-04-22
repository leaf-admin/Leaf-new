function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseLocationCandidate(rawValue) {
    if (!rawValue) return null;

    if (typeof rawValue === 'object') {
        const lat = toFiniteNumber(rawValue.lat);
        const lng = toFiniteNumber(rawValue.lng);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    }

    if (typeof rawValue !== 'string') {
        return null;
    }

    try {
        const parsed = JSON.parse(rawValue);
        const lat = toFiniteNumber(parsed?.lat);
        const lng = toFiniteNumber(parsed?.lng);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    } catch (_error) {
        return null;
    }
}

function parseNumericCandidate(value) {
    return toFiniteNumber(value);
}

async function resolveAcceptRidePayload(redis, bookingId, payload = {}) {
    const bookingData = redis && bookingId
        ? await redis.hgetall(`booking:${bookingId}`)
        : null;

    const pickupLocation = parseLocationCandidate(payload.pickupLocation)
        || parseLocationCandidate(bookingData?.pickupLocation)
        || parseLocationCandidate(bookingData?.pickup)
        || null;

    const destinationLocation = parseLocationCandidate(payload.destinationLocation)
        || parseLocationCandidate(bookingData?.destinationLocation)
        || parseLocationCandidate(bookingData?.drop)
        || null;

    const driverAcceptedLocation = parseLocationCandidate(payload.driverAcceptedLocation)
        || parseLocationCandidate(bookingData?.driverAcceptedLocation)
        || null;

    const estimatedFare = parseNumericCandidate(payload.estimatedFare)
        ?? parseNumericCandidate(bookingData?.estimatedFare)
        ?? parseNumericCandidate(bookingData?.estimate)
        ?? parseNumericCandidate(bookingData?.fare)
        ?? null;

    const driverDistanceToPickupKm = parseNumericCandidate(payload.driverDistanceToPickupKm)
        ?? parseNumericCandidate(bookingData?.driverDistanceToPickupKm)
        ?? null;

    const estimatedArrivalToPickupMin = parseNumericCandidate(payload.estimatedArrivalToPickupMin)
        ?? parseNumericCandidate(bookingData?.estimatedArrivalToPickupMin)
        ?? null;

    return {
        pickupLocation,
        destinationLocation,
        driverAcceptedLocation,
        estimatedFare,
        driverDistanceToPickupKm,
        estimatedArrivalToPickupMin,
        bookingData: bookingData || null
    };
}

module.exports = {
    resolveAcceptRidePayload,
    parseLocationCandidate,
    parseNumericCandidate,
    toFiniteNumber
};
