const ACTIVE_TRIP_TTL_SECONDS = 6 * 60 * 60; // 6 horas
const IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS = 25 * 60;
const IDENTITY_POLICY_MUTATION_TTL_SECONDS = 5 * 60;

function activeTripKey(driverId) {
    return `active_trip_by_driver:${driverId}`;
}

function activeTripCustomerKey(driverId) {
    return `active_trip_customer_by_driver:${driverId}`;
}

function identityVerificationKey(driverId) {
    return `kyc:identity-verification-window:${driverId}`;
}

function identityPolicyMutationKey(driverId) {
    return `kyc:identity-policy-mutation:${driverId}`;
}

function activeStepUpChallengeKey(driverId) {
    return `kyc:stepup:active:${driverId}`;
}

function eligibleDriverGeoKey() {
    return process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
}

function requireAtomicRedis(redis) {
    if (!redis || typeof redis.eval !== 'function') {
        const error = new Error('Redis atomico indisponivel para exclusao entre corrida e KYC');
        error.code = 'ACTIVE_TRIP_ATOMIC_GUARD_UNAVAILABLE';
        throw error;
    }
}

async function setActiveTripForDriver(redis, driverId, bookingId, customerId = null) {
    if (!redis || !driverId || !bookingId) {
        return false;
    }
    requireAtomicRedis(redis);

    const result = await redis.eval(
        'local currentTrip = redis.call("get", KEYS[1]) or redis.call("hget", KEYS[3], "activeTripId"); local verification = redis.call("get", KEYS[4]); local policyMutation = redis.call("get", KEYS[5]); local activeStepUpChallenge = redis.call("get", KEYS[6]); if (verification or policyMutation) and (not currentTrip or currentTrip ~= ARGV[1]) then return 0 end; if activeStepUpChallenge and (not currentTrip or currentTrip ~= ARGV[1]) then return -2 end; local reverifyRequired = string.lower(tostring(redis.call("hget", KEYS[3], "kyc_reverify_required") or "false")); if (reverifyRequired == "true" or reverifyRequired == "1") and (not currentTrip or currentTrip ~= ARGV[1]) then return -1 end; redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[3]); if ARGV[2] ~= "" then redis.call("set", KEYS[2], ARGV[2], "EX", ARGV[3]); end; redis.call("hset", KEYS[3], "activeTripId", ARGV[1], "activeTripUpdatedAt", ARGV[4]); return 1',
        6,
        activeTripKey(driverId),
        activeTripCustomerKey(driverId),
        `driver:${driverId}`,
        identityVerificationKey(driverId),
        identityPolicyMutationKey(driverId),
        activeStepUpChallengeKey(driverId),
        String(bookingId),
        customerId ? String(customerId) : '',
        String(ACTIVE_TRIP_TTL_SECONDS),
        new Date().toISOString()
    );
    if (Number(result) !== 1) {
        if (Number(result) === -2) {
            const error = new Error('Desafio de identidade pendente; corrida nao pode iniciar agora');
            error.code = 'KYC_CHALLENGE_ACTIVE';
            throw error;
        }
        if (Number(result) === -1) {
            const error = new Error('Revalidacao de identidade pendente; corrida nao pode iniciar agora');
            error.code = 'KYC_REVERIFICATION_REQUIRED';
            throw error;
        }
        const error = new Error('Validacao de identidade em andamento; corrida nao pode iniciar agora');
        error.code = 'KYC_VERIFICATION_IN_PROGRESS';
        throw error;
    }
    return true;
}

async function claimIdentityVerificationWindow(
    redis,
    driverId,
    token,
    ttlSeconds = IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS
) {
    if (!redis || !driverId || !token) {
        const error = new Error('Binding invalido para janela de verificacao de identidade');
        error.code = 'KYC_VERIFICATION_WINDOW_BINDING_INVALID';
        throw error;
    }
    requireAtomicRedis(redis);

    const result = await redis.eval(
        'local trip = redis.call("get", KEYS[1]) or redis.call("hget", KEYS[3], "activeTripId"); if trip then return {0, trip} end; local current = redis.call("get", KEYS[2]); if current and current ~= ARGV[1] then return {-1, ""} end; if current == ARGV[1] then redis.call("expire", KEYS[2], ARGV[2]); return {2, ""} end; redis.call("set", KEYS[2], ARGV[1], "EX", ARGV[2]); return {1, ""}',
        3,
        activeTripKey(driverId),
        identityVerificationKey(driverId),
        `driver:${driverId}`,
        String(token),
        String(ttlSeconds)
    );
    const status = Number(Array.isArray(result) ? result[0] : result);
    const activeTripId = Array.isArray(result) ? (result[1] || null) : null;
    return {
        acquired: status === 1 || status === 2,
        reused: status === 2,
        busy: status === -1,
        activeTripId: status === 0 ? activeTripId : null,
        key: identityVerificationKey(driverId),
        token: String(token),
        ttlSeconds
    };
}

async function claimIdentityPolicyMutationWindow(
    redis,
    driverId,
    token,
    ttlSeconds = IDENTITY_POLICY_MUTATION_TTL_SECONDS
) {
    if (!redis || !driverId || !token) {
        const error = new Error('Binding invalido para mutacao de politica de identidade');
        error.code = 'KYC_POLICY_MUTATION_BINDING_INVALID';
        throw error;
    }
    requireAtomicRedis(redis);

    const result = await redis.eval(
        'local trip = redis.call("get", KEYS[1]) or redis.call("hget", KEYS[3], "activeTripId"); if trip then return {0, trip} end; local current = redis.call("get", KEYS[2]); if current and current ~= ARGV[1] then return {-1, ""} end; if current == ARGV[1] then redis.call("expire", KEYS[2], ARGV[2]); return {2, ""} end; redis.call("set", KEYS[2], ARGV[1], "EX", ARGV[2]); return {1, ""}',
        3,
        activeTripKey(driverId),
        identityPolicyMutationKey(driverId),
        `driver:${driverId}`,
        String(token),
        String(ttlSeconds)
    );
    const status = Number(Array.isArray(result) ? result[0] : result);
    const activeTripId = Array.isArray(result) ? (result[1] || null) : null;
    return {
        acquired: status === 1 || status === 2,
        reused: status === 2,
        busy: status === -1,
        activeTripId: status === 0 ? activeTripId : null,
        key: identityPolicyMutationKey(driverId),
        token: String(token),
        ttlSeconds
    };
}

async function releaseIdentityVerificationWindow(redis, claim = {}) {
    if (!redis || !claim.key || !claim.token) return false;
    requireAtomicRedis(redis);
    const result = await redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        claim.key,
        String(claim.token)
    );
    return Number(result) === 1;
}

async function renewIdentityVerificationWindow(
    redis,
    claim = {},
    ttlSeconds = claim.ttlSeconds || IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS
) {
    if (!redis || !claim.key || !claim.token) return false;
    requireAtomicRedis(redis);
    const result = await redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end',
        1,
        claim.key,
        String(claim.token),
        String(ttlSeconds)
    );
    return Number(result) === 1;
}

async function releaseIdentityPolicyMutationWindow(redis, claim = {}) {
    return releaseIdentityVerificationWindow(redis, claim);
}

async function renewIdentityPolicyMutationWindow(
    redis,
    claim = {},
    ttlSeconds = claim.ttlSeconds || IDENTITY_POLICY_MUTATION_TTL_SECONDS
) {
    return renewIdentityVerificationWindow(redis, claim, ttlSeconds);
}

async function clearActiveTripForDriver(redis, driverId, expectedBookingId = null) {
    if (!redis || !driverId) {
        return false;
    }
    requireAtomicRedis(redis);

    const result = await redis.eval(
        [
            'local current = redis.call("get", KEYS[1]) or redis.call("hget", KEYS[3], "activeTripId")',
            'local expectedTripAbsent = ARGV[1] ~= "" and not current',
            'if ARGV[1] ~= "" and current and tostring(current) ~= tostring(ARGV[1]) then return 0 end',
            'redis.call("del", KEYS[1])',
            'redis.call("del", KEYS[2])',
            'redis.call("hdel", KEYS[3], "activeTripId", "activeTripUpdatedAt")',
            'local deferredOffline = string.lower(tostring(redis.call("hget", KEYS[3], "vehicleOfflinePendingAfterTrip") or "false"))',
            'if deferredOffline == "true" then',
            'redis.call("hset", KEYS[3], "status", "OFFLINE", "isOnline", "false", "dispatchEligible", "false")',
            'redis.call("hdel", KEYS[3], "vehicleOfflinePendingAfterTrip", "vehicleOfflineDeferredReason")',
            'redis.call("zrem", KEYS[4], ARGV[2])',
            'redis.call("zrem", KEYS[5], ARGV[2])',
            'redis.call("srem", KEYS[6], ARGV[2])',
            'end',
            'if expectedTripAbsent then return 2 end',
            'return 1'
        ].join('; '),
        6,
        activeTripKey(driverId),
        activeTripCustomerKey(driverId),
        `driver:${driverId}`,
        eligibleDriverGeoKey(),
        'driver_locations',
        'online_drivers',
        expectedBookingId ? String(expectedBookingId) : '',
        String(driverId)
    );
    const status = Number(result);
    return status === 1 || status === 2;
}

async function resolveActiveTripForDriver(redis, driverId) {
    if (!redis || !driverId) {
        return { tripId: null, customerId: null };
    }

    const [indexedTripId, customerId, hashedTripId] = await Promise.all([
        redis.get(activeTripKey(driverId)),
        redis.get(activeTripCustomerKey(driverId)),
        redis.hget(`driver:${driverId}`, 'activeTripId')
    ]);

    return {
        tripId: indexedTripId || hashedTripId || null,
        customerId: customerId || null
    };
}

module.exports = {
    ACTIVE_TRIP_TTL_SECONDS,
    IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
    IDENTITY_POLICY_MUTATION_TTL_SECONDS,
    activeTripKey,
    activeTripCustomerKey,
    identityVerificationKey,
    identityPolicyMutationKey,
    activeStepUpChallengeKey,
    setActiveTripForDriver,
    clearActiveTripForDriver,
    resolveActiveTripForDriver,
    claimIdentityVerificationWindow,
    renewIdentityVerificationWindow,
    releaseIdentityVerificationWindow,
    claimIdentityPolicyMutationWindow,
    renewIdentityPolicyMutationWindow,
    releaseIdentityPolicyMutationWindow
};
