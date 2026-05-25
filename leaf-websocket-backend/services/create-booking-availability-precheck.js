'use strict';

function resolveHasDrivers(availability) {
    if (!availability || typeof availability !== 'object') {
        return false;
    }

    if (Array.isArray(availability.drivers)) {
        return availability.drivers.length > 0;
    }

    if (typeof availability.hasDrivers === 'boolean') {
        return availability.hasDrivers;
    }

    return false;
}

async function performCreateBookingAvailabilityPrecheck({
    hasConfirmedPayment,
    pickupLocation,
    destinationLocation,
    preferences = {},
    requestedCarType,
    checkAvailability,
    logStructured = () => {},
    logContext = {},
    timeoutMs = null
}) {
    if (!hasConfirmedPayment) {
        return { skipped: true, reason: 'payment_not_confirmed' };
    }

    if (!pickupLocation?.lat || !pickupLocation?.lng) {
        return { skipped: true, reason: 'pickup_location_invalid' };
    }

    if (typeof checkAvailability !== 'function') {
        return { skipped: true, reason: 'checker_missing' };
    }

    try {
        const availabilityPromise = checkAvailability(pickupLocation, {
            destinationLocation,
            preferences,
            carType: requestedCarType
        });
        const availability = Number.isFinite(timeoutMs) && timeoutMs > 0
            ? await Promise.race([
                availabilityPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('availability_check_timeout')), timeoutMs))
            ])
            : await availabilityPromise;

        if (!availability?.success) {
            logStructured('warn', 'createBooking: validação de disponibilidade falhou', {
                ...logContext,
                code: 'AVAILABILITY_CHECK_FAILED'
            });
            return {
                skipped: false,
                success: false,
                code: 'AVAILABILITY_CHECK_FAILED',
                hasDrivers: false
            };
        }

        const hasDrivers = resolveHasDrivers(availability);
        if (!hasDrivers) {
            logStructured('warn', 'createBooking: sem motoristas no pre-check', {
                ...logContext,
                code: 'NO_DRIVERS_AVAILABLE'
            });
        }

        return {
            skipped: false,
            success: true,
            code: hasDrivers ? 'DRIVERS_AVAILABLE' : 'NO_DRIVERS_AVAILABLE',
            hasDrivers
        };
    } catch (error) {
        logStructured('warn', 'createBooking: erro no pre-check de disponibilidade', {
            ...logContext,
            error: error.message
        });
        return {
            skipped: false,
            success: false,
            code: 'AVAILABILITY_CHECK_ERROR',
            hasDrivers: false,
            error: error.message
        };
    }
}

function scheduleCreateBookingAvailabilityPrecheck(options) {
    const scheduler = typeof setImmediate === 'function'
        ? setImmediate
        : (callback) => setTimeout(callback, 0);

    scheduler(() => {
        performCreateBookingAvailabilityPrecheck(options).catch((error) => {
            const logStructured = options?.logStructured;
            if (typeof logStructured === 'function') {
                logStructured('warn', 'createBooking: erro inesperado no agendamento do pre-check', {
                    ...(options?.logContext || {}),
                    error: error.message
                });
            }
        });
    });
}

module.exports = {
    performCreateBookingAvailabilityPrecheck,
    scheduleCreateBookingAvailabilityPrecheck
};
