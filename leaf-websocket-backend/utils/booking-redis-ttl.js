/**
 * Safety TTL for Redis booking hashes.
 *
 * Every write to `booking:{id}` caps the key lifetime with EXPIRE ... NX, so hashes
 * recreated by late writers (payment links, dispatch traces, cost telemetry) cannot
 * live forever. NX keeps any shorter TTL already set (e.g. the terminal-state TTL from
 * RideStateManager). No ride lives this long, so active rides are unaffected.
 */
const DEFAULT_BOOKING_SAFETY_TTL_SECONDS = 7 * 24 * 60 * 60;

function resolveBookingSafetyTtlSeconds() {
    const parsed = Number.parseInt(process.env.RIDE_BOOKING_SAFETY_TTL_SECONDS || '', 10);
    return Number.isInteger(parsed) && parsed >= 24 * 60 * 60 ? parsed : DEFAULT_BOOKING_SAFETY_TTL_SECONDS;
}

/**
 * @param {object} target ioredis client, pipeline or multi
 * @param {string} bookingKey full key, e.g. `booking:abc`
 */
function applyBookingSafetyTtl(target, bookingKey) {
    if (!target || typeof target.expire !== 'function' || !bookingKey) {
        return undefined;
    }
    return target.expire(bookingKey, resolveBookingSafetyTtlSeconds(), 'NX');
}

module.exports = {
    DEFAULT_BOOKING_SAFETY_TTL_SECONDS,
    applyBookingSafetyTtl,
    resolveBookingSafetyTtlSeconds
};
