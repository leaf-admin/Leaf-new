const OFFER_RESERVATION_TTL_SECONDS = Math.max(
    1,
    Number.parseInt(process.env.OFFER_RESERVATION_TTL_SECONDS || '12', 10) || 12
);

function getOfferReservationKey(bookingId, driverId) {
    return `offer_reservation:${bookingId}:${driverId}`;
}

function getOfferReservationIndexKey(bookingId) {
    return `offer_reservation_index:${bookingId}`;
}

function buildOfferReservationPayload(bookingId, driverId, metadata = {}) {
    const now = new Date().toISOString();
    return JSON.stringify({
        bookingId,
        driverId,
        reservedAt: now,
        ...metadata
    });
}

async function reserveOffer(redis, bookingId, driverId, options = {}) {
    if (!redis || !bookingId || !driverId) return null;

    const ttlSeconds = Math.max(
        1,
        Number.parseInt(options.ttlSeconds || OFFER_RESERVATION_TTL_SECONDS, 10) || OFFER_RESERVATION_TTL_SECONDS
    );
    const reservationKey = getOfferReservationKey(bookingId, driverId);
    const indexKey = getOfferReservationIndexKey(bookingId);
    const payload = buildOfferReservationPayload(bookingId, driverId, options.metadata || {});

    const pipeline = redis.multi();
    pipeline.set(reservationKey, payload, 'EX', ttlSeconds);
    pipeline.sadd(indexKey, driverId);
    pipeline.expire(indexKey, ttlSeconds);
    await pipeline.exec();

    return {
        bookingId,
        driverId,
        ttlSeconds
    };
}

async function loadOfferReservation(redis, bookingId, driverId) {
    if (!redis || !bookingId || !driverId) return null;

    const raw = await redis.get(getOfferReservationKey(bookingId, driverId));
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (_error) {
        return null;
    }
}

async function hasOfferReservation(redis, bookingId, driverId) {
    if (!redis || !bookingId || !driverId) return false;
    return Boolean(await redis.exists(getOfferReservationKey(bookingId, driverId)));
}

async function clearOfferReservation(redis, bookingId, driverId) {
    if (!redis || !bookingId || !driverId) return;

    const pipeline = redis.multi();
    pipeline.del(getOfferReservationKey(bookingId, driverId));
    pipeline.srem(getOfferReservationIndexKey(bookingId), driverId);
    await pipeline.exec();
}

async function clearOfferReservationsForBooking(redis, bookingId, options = {}) {
    if (!redis || !bookingId) return;

    const preserveDriverId = options?.preserveDriverId
        ? String(options.preserveDriverId)
        : null;
    const indexKey = getOfferReservationIndexKey(bookingId);
    const driverIds = await redis.smembers(indexKey);

    if (!Array.isArray(driverIds) || driverIds.length === 0) {
        await redis.del(indexKey).catch(() => null);
        return;
    }

    const pipeline = redis.multi();
    for (const driverId of driverIds) {
        if (preserveDriverId && String(driverId) === preserveDriverId) {
            continue;
        }
        pipeline.del(getOfferReservationKey(bookingId, driverId));
        pipeline.srem(indexKey, driverId);
    }

    if (!preserveDriverId) {
        pipeline.del(indexKey);
    }

    await pipeline.exec();
}

module.exports = {
    OFFER_RESERVATION_TTL_SECONDS,
    getOfferReservationKey,
    getOfferReservationIndexKey,
    reserveOffer,
    loadOfferReservation,
    hasOfferReservation,
    clearOfferReservation,
    clearOfferReservationsForBooking
};
