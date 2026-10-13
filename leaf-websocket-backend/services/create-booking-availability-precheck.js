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

async function runCreateBookingAvailabilityPrecheckOnce({
    hasConfirmedPayment,
    pickupLocation,
    destinationLocation,
    preferences = {},
    requestedCarType,
    checkAvailability,
    logStructured = () => {},
    logContext = {},
    timeoutMs = null,
    operationLabel = 'createBooking'
}) {
    const safeOperationLabel = String(operationLabel || 'createBooking').trim() || 'createBooking';

    if (!hasConfirmedPayment) {
        return { skipped: true, reason: 'payment_not_confirmed' };
    }

    if (!pickupLocation?.lat || !pickupLocation?.lng) {
        logStructured('warn', `${safeOperationLabel}: pickup inválido no pre-check de disponibilidade`, {
            ...logContext,
            code: 'PICKUP_LOCATION_REQUIRED'
        });
        return {
            skipped: false,
            success: false,
            code: 'PICKUP_LOCATION_REQUIRED',
            hasDrivers: false
        };
    }

    if (typeof checkAvailability !== 'function') {
        logStructured('warn', `${safeOperationLabel}: checker de disponibilidade ausente`, {
            ...logContext,
            code: 'AVAILABILITY_CHECKER_MISSING'
        });
        return {
            skipped: false,
            success: false,
            code: 'AVAILABILITY_CHECKER_MISSING',
            hasDrivers: false
        };
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
            logStructured('warn', `${safeOperationLabel}: validação de disponibilidade falhou`, {
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
            logStructured('warn', `${safeOperationLabel}: sem motoristas no pre-check`, {
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
        logStructured('warn', `${safeOperationLabel}: erro no pre-check de disponibilidade`, {
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

// Falhas passageiras (tempo esgotado ou erro do checker) não dizem que falta motorista.
const TRANSIENT_PRECHECK_FAILURE_CODES = new Set(['AVAILABILITY_CHECK_FAILED', 'AVAILABILITY_CHECK_ERROR']);

/**
 * `transientRetries` repete a checagem quando ela falha por um motivo passageiro. Sem isso, uma
 * corrida já paga era recusada por uma única consulta lenta. "Sem motorista" nunca é repetido.
 */
async function performCreateBookingAvailabilityPrecheck({ transientRetries = 0, ...options } = {}) {
    const maxRetries = Number.isInteger(transientRetries) && transientRetries > 0 ? transientRetries : 0;
    let result = await runCreateBookingAvailabilityPrecheckOnce(options);
    for (
        let attempt = 0;
        attempt < maxRetries &&
        result.skipped !== true &&
        result.success !== true &&
        TRANSIENT_PRECHECK_FAILURE_CODES.has(result.code);
        attempt += 1
    ) {
        result = await runCreateBookingAvailabilityPrecheckOnce(options);
    }
    return result;
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
