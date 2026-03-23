const RideStateManager = require('./ride-state-manager');
const paymentDispatchService = require('./payment-dispatch-service');
const {
    clearActiveTripForDriver,
    resolveActiveTripForDriver
} = require('../utils/active-trip-index');
const { logStructured } = require('../utils/logger');

function parsePickupLocation(rawValue) {
    if (!rawValue) return null;

    if (typeof rawValue === 'object') {
        const lat = Number(rawValue.lat);
        const lng = Number(rawValue.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { ...rawValue, lat, lng };
        }
        return null;
    }

    if (typeof rawValue !== 'string') return null;

    try {
        const parsed = JSON.parse(rawValue);
        const lat = Number(parsed?.lat);
        const lng = Number(parsed?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { ...parsed, lat, lng };
        }
    } catch (_) {
        return null;
    }

    return null;
}

function normalizeBoolean(value) {
    if (value === true || value === 'true' || value === '1' || value === 1) {
        return true;
    }
    return false;
}

function parseTimestamp(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1000000000000 ? value : value * 1000;
    }

    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && value.trim() !== '') {
            return numeric > 1000000000000 ? numeric : numeric * 1000;
        }

        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }

    return null;
}

function isAcceptedBooking(bookingData) {
    if (!bookingData || typeof bookingData !== 'object') {
        return false;
    }

    const state = String(bookingData.state || '').toUpperCase();
    const status = String(bookingData.status || '').toUpperCase();

    return state === RideStateManager.STATES.ACCEPTED || status === RideStateManager.STATES.ACCEPTED;
}

function hasTripStarted(bookingData) {
    if (!bookingData || typeof bookingData !== 'object') {
        return false;
    }

    const state = String(bookingData.state || '').toUpperCase();
    const status = String(bookingData.status || '').toUpperCase();

    if (state === RideStateManager.STATES.IN_PROGRESS || status === RideStateManager.STATES.IN_PROGRESS) {
        return true;
    }

    return Boolean(
        bookingData.startedAt ||
        bookingData.startLocation ||
        bookingData.inProgressAt ||
        bookingData.tripStartedAt
    );
}

async function resolveAcceptedBookingCandidatesForDriver(redis, driverId, options = {}) {
    const scanLimit = Math.max(1, Number.parseInt(options.scanLimit || '250', 10));
    if (!redis || !driverId) {
        return {
            bookingIds: [],
            driverData: null
        };
    }

    const candidateIds = new Set();
    const resolved = await resolveActiveTripForDriver(redis, driverId);
    if (resolved?.tripId) {
        candidateIds.add(String(resolved.tripId));
    }

    const driverData = await redis.hgetall(`driver:${driverId}`);
    if (driverData?.activeTripId) {
        candidateIds.add(String(driverData.activeTripId));
    }

    if (candidateIds.size > 0) {
        return {
            bookingIds: Array.from(candidateIds),
            driverData: driverData || null
        };
    }

    const activeBookingIds = await redis.hkeys('bookings:active');
    for (const bookingId of activeBookingIds.slice(0, scanLimit)) {
        const bookingData = await redis.hgetall(`booking:${bookingId}`);
        if (!bookingData || Object.keys(bookingData).length === 0) {
            continue;
        }

        const assignedDriverId = String(bookingData.driverId || '');
        if (assignedDriverId !== String(driverId)) {
            continue;
        }

        if (!isAcceptedBooking(bookingData) || hasTripStarted(bookingData)) {
            continue;
        }

        candidateIds.add(String(bookingId));
    }

    return {
        bookingIds: Array.from(candidateIds),
        driverData: driverData || null
    };
}

async function recoverAcceptedBooking({
    redis,
    io,
    bookingId,
    expectedDriverId = null,
    reason = 'driver_disconnected',
    source = 'accepted_ride_recovery',
    recoveryMetadata = {},
    pickupFallback = null,
    emitPassengerEvent = true,
    forceDispatch = true,
    maxDispatchAttempts = 30,
    dispatchRetryDelayMs = 700
}) {
    if (!redis || !bookingId) {
        return {
            recovered: false,
            skipped: true,
            reason: 'MISSING_INPUT'
        };
    }

    const normalizedBookingId = String(bookingId);
    const bookingKey = `booking:${normalizedBookingId}`;
    const initialBookingData = await redis.hgetall(bookingKey);

    if (!initialBookingData || Object.keys(initialBookingData).length === 0) {
        return {
            recovered: false,
            skipped: true,
            reason: 'BOOKING_NOT_FOUND',
            bookingId: normalizedBookingId
        };
    }

    const initialDriverId = String(initialBookingData.driverId || '');
    if (expectedDriverId && initialDriverId && initialDriverId !== String(expectedDriverId)) {
        return {
            recovered: false,
            skipped: true,
            reason: 'EXPECTED_DRIVER_MISMATCH',
            bookingId: normalizedBookingId,
            driverId: initialDriverId
        };
    }

    if (!isAcceptedBooking(initialBookingData) || hasTripStarted(initialBookingData)) {
        return {
            recovered: false,
            skipped: true,
            reason: 'BOOKING_NOT_ACCEPTED_OR_ALREADY_STARTED',
            bookingId: normalizedBookingId
        };
    }

    const recoveryLockKey = `booking_recovery_lock:${normalizedBookingId}`;
    const lockOwner = String(expectedDriverId || initialDriverId || source || 'system');
    const lockAcquired = await redis.set(recoveryLockKey, lockOwner, 'NX', 'EX', 45);
    if (!lockAcquired) {
        return {
            recovered: false,
            skipped: true,
            reason: 'RECOVERY_ALREADY_IN_PROGRESS',
            bookingId: normalizedBookingId
        };
    }

    const latestBookingData = await redis.hgetall(bookingKey);
    if (!latestBookingData || Object.keys(latestBookingData).length === 0) {
        return {
            recovered: false,
            skipped: true,
            reason: 'BOOKING_NOT_FOUND_AFTER_LOCK',
            bookingId: normalizedBookingId
        };
    }

    const latestDriverId = String(latestBookingData.driverId || '');
    if (expectedDriverId && latestDriverId && latestDriverId !== String(expectedDriverId)) {
        return {
            recovered: false,
            skipped: true,
            reason: 'EXPECTED_DRIVER_MISMATCH_AFTER_LOCK',
            bookingId: normalizedBookingId,
            driverId: latestDriverId
        };
    }

    if (!isAcceptedBooking(latestBookingData) || hasTripStarted(latestBookingData)) {
        return {
            recovered: false,
            skipped: true,
            reason: 'STATE_CHANGED_BEFORE_RECOVERY',
            bookingId: normalizedBookingId
        };
    }

    const previousDriverId = latestDriverId || String(expectedDriverId || '');
    const passengerId = latestBookingData.customerId || null;
    const nowIso = new Date().toISOString();

    if (previousDriverId) {
        try {
            await clearActiveTripForDriver(redis, previousDriverId, normalizedBookingId);
        } catch (clearActiveTripError) {
            logStructured('warn', 'Falha ao limpar active_trip_by_driver durante recovery', {
                service: 'accepted-ride-recovery',
                bookingId: normalizedBookingId,
                driverId: previousDriverId,
                source,
                error: clearActiveTripError.message
            });
        }

        try {
            await redis.del(`driver_lock:${previousDriverId}`);
        } catch (driverLockError) {
            logStructured('warn', 'Falha ao remover driver_lock durante recovery', {
                service: 'accepted-ride-recovery',
                bookingId: normalizedBookingId,
                driverId: previousDriverId,
                source,
                error: driverLockError.message
            });
        }
    }

    await redis.hdel('bookings:active', normalizedBookingId);

    try {
        await RideStateManager.updateBookingState(
            redis,
            normalizedBookingId,
            RideStateManager.STATES.SEARCHING,
            {
                recoveryReason: reason,
                recoveryPreviousDriverId: previousDriverId,
                recoveryTriggeredAt: nowIso,
                recoverySource: source,
                ...recoveryMetadata
            }
        );
    } catch (stateError) {
        const currentStateAfterError = await RideStateManager.getBookingState(redis, normalizedBookingId);
        if (currentStateAfterError !== RideStateManager.STATES.SEARCHING) {
            throw stateError;
        }
    }

    await redis.hset(bookingKey, {
        status: 'SEARCHING',
        driverId: '',
        notifiedDriverId: '',
        updatedAt: nowIso,
        recoveryReason: reason,
        recoveryPreviousDriverId: previousDriverId,
        recoveryTriggeredAt: nowIso,
        recoverySource: source,
        ...recoveryMetadata
    });

    if (emitPassengerEvent && passengerId && io) {
        io.to(`customer_${passengerId}`).emit('driverSearchResumed', {
            bookingId: normalizedBookingId,
            reason,
            message: 'Motorista indisponível. Procurando outro motorista...'
        });
    }

    const pickupLocation =
        parsePickupLocation(latestBookingData.pickupLocation) ||
        parsePickupLocation(pickupFallback);

    const dispatchResult = await paymentDispatchService.triggerDispatchAfterPayment({
        bookingId: normalizedBookingId,
        io,
        pickupLocation,
        source,
        force: forceDispatch,
        maxAttempts: maxDispatchAttempts,
        retryDelayMs: dispatchRetryDelayMs
    });

    logStructured('info', 'Corrida ACCEPTED recuperada para SEARCHING', {
        service: 'accepted-ride-recovery',
        bookingId: normalizedBookingId,
        previousDriverId,
        passengerId,
        reason,
        source,
        dispatchSuccess: Boolean(dispatchResult?.success),
        dispatchSkipped: Boolean(dispatchResult?.skipped),
        dispatchReason: dispatchResult?.reason || null
    });

    return {
        recovered: true,
        skipped: false,
        bookingId: normalizedBookingId,
        previousDriverId,
        passengerId,
        reason,
        source,
        dispatchResult
    };
}

module.exports = {
    parsePickupLocation,
    normalizeBoolean,
    parseTimestamp,
    isAcceptedBooking,
    hasTripStarted,
    resolveAcceptedBookingCandidatesForDriver,
    recoverAcceptedBooking
};
