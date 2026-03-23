const ACTIVE_TRIP_TTL_SECONDS = 6 * 60 * 60; // 6 horas

function activeTripKey(driverId) {
    return `active_trip_by_driver:${driverId}`;
}

function activeTripCustomerKey(driverId) {
    return `active_trip_customer_by_driver:${driverId}`;
}

async function setActiveTripForDriver(redis, driverId, bookingId, customerId = null) {
    if (!redis || !driverId || !bookingId) {
        return false;
    }

    const tx = redis.multi();
    tx.set(activeTripKey(driverId), String(bookingId), 'EX', ACTIVE_TRIP_TTL_SECONDS);
    if (customerId) {
        tx.set(activeTripCustomerKey(driverId), String(customerId), 'EX', ACTIVE_TRIP_TTL_SECONDS);
    }
    tx.hset(`driver:${driverId}`, {
        activeTripId: String(bookingId),
        activeTripUpdatedAt: new Date().toISOString()
    });
    await tx.exec();
    return true;
}

async function clearActiveTripForDriver(redis, driverId, expectedBookingId = null) {
    if (!redis || !driverId) {
        return false;
    }

    if (expectedBookingId) {
        const currentBookingId = await redis.get(activeTripKey(driverId));
        if (currentBookingId && String(currentBookingId) !== String(expectedBookingId)) {
            return false;
        }
    }

    const tx = redis.multi();
    tx.del(activeTripKey(driverId));
    tx.del(activeTripCustomerKey(driverId));
    tx.hdel(`driver:${driverId}`, 'activeTripId', 'activeTripUpdatedAt');
    await tx.exec();
    return true;
}

async function resolveActiveTripForDriver(redis, driverId) {
    if (!redis || !driverId) {
        return { tripId: null, customerId: null };
    }

    const [tripId, customerId] = await Promise.all([
        redis.get(activeTripKey(driverId)),
        redis.get(activeTripCustomerKey(driverId))
    ]);

    return {
        tripId: tripId || null,
        customerId: customerId || null
    };
}

module.exports = {
    ACTIVE_TRIP_TTL_SECONDS,
    setActiveTripForDriver,
    clearActiveTripForDriver,
    resolveActiveTripForDriver
};
