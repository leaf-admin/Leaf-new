const ACTIVE_TRIP_TTL_SECONDS = 24 * 60 * 60; // lease de 24 horas, renovado por sinal backend-confirmado
const ACTIVE_TRIP_RENEWAL_WRITE_THRESHOLD_SECONDS = 12 * 60 * 60;
const IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS = 25 * 60;
const IDENTITY_POLICY_MUTATION_TTL_SECONDS = 5 * 60;
const ACTIVE_TRIP_LEASE_UNTIL_FIELD = 'activeTripLeaseUntilMs';

// KEYS[1] = índice com TTL; KEYS[3] = hash do motorista. O hash só pode
// funcionar como fallback enquanto carregar um lease explícito ainda válido.
const RESOLVE_ACTIVE_TRIP_LUA = `
local redisTime = redis.call("time")
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)
local currentTrip = redis.call("get", KEYS[1])
if not currentTrip then
    local hashedTrip = redis.call("hget", KEYS[3], "activeTripId")
    local hashedLeaseUntilMs = tonumber(redis.call("hget", KEYS[3], "${ACTIVE_TRIP_LEASE_UNTIL_FIELD}") or "0")
    if hashedTrip and hashedLeaseUntilMs > nowMs then
        currentTrip = hashedTrip
    elseif hashedTrip then
        redis.call("hdel", KEYS[3], "activeTripId", "activeTripUpdatedAt", "${ACTIVE_TRIP_LEASE_UNTIL_FIELD}")
    end
end
`;

const ACTIVE_BOOKING_STATUSES = new Set([
    'ACCEPTED',
    'ARRIVED',
    'SEARCHING',
    'STARTED',
    'IN_PROGRESS',
    'REASSIGNED_IN_PROGRESS'
]);

function isBackendConfirmedActiveBooking(bookingData, driverId, expectedBookingId) {
    if (!bookingData || typeof bookingData !== 'object') return false;
    if (String(bookingData.driverId || '') !== String(driverId)) return false;
    const bookingId = bookingData.bookingId || bookingData.id || null;
    if (bookingId && String(bookingId) !== String(expectedBookingId)) return false;
    const status = String(bookingData.status || '').toUpperCase();
    const state = String(bookingData.state || '').toUpperCase();
    return ACTIVE_BOOKING_STATUSES.has(status) || ACTIVE_BOOKING_STATUSES.has(state);
}

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
        `${RESOLVE_ACTIVE_TRIP_LUA}
        local verification = redis.call("get", KEYS[4])
        local policyMutation = redis.call("get", KEYS[5])
        local activeStepUpChallenge = redis.call("get", KEYS[6])
        if currentTrip and currentTrip ~= ARGV[1] then return -3 end
        if (verification or policyMutation) and (not currentTrip or currentTrip ~= ARGV[1]) then return 0 end
        if activeStepUpChallenge and (not currentTrip or currentTrip ~= ARGV[1]) then return -2 end
        local reverifyRequired = string.lower(tostring(redis.call("hget", KEYS[3], "kyc_reverify_required") or "false"))
        local identityDeferred = string.lower(tostring(redis.call("hget", KEYS[3], "identity_reverification_pending_after_trip") or redis.call("hget", KEYS[3], "identityReverificationPendingAfterTrip") or "false"))
        local kycDeferred = string.lower(tostring(redis.call("hget", KEYS[3], "kyc_recheck_pending_after_trip") or redis.call("hget", KEYS[3], "kycRecheckPendingAfterTrip") or "false"))
        if (reverifyRequired == "true" or reverifyRequired == "1" or identityDeferred == "true" or identityDeferred == "1" or kycDeferred == "true" or kycDeferred == "1") and (not currentTrip or currentTrip ~= ARGV[1]) then return -1 end
        local leaseUntilMs = nowMs + (tonumber(ARGV[3]) * 1000)
        redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[3])
        if ARGV[2] ~= "" then redis.call("set", KEYS[2], ARGV[2], "EX", ARGV[3]) end
        redis.call("hset", KEYS[3], "activeTripId", ARGV[1], "activeTripUpdatedAt", ARGV[4], "${ACTIVE_TRIP_LEASE_UNTIL_FIELD}", tostring(leaseUntilMs))
        return 1`,
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
        if (Number(result) === -3) {
            const error = new Error('Motorista ja possui outra corrida ativa');
            error.code = 'ACTIVE_TRIP_CONFLICT';
            throw error;
        }
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

async function renewActiveTripForDriver(
    redis,
    driverId,
    expectedBookingId,
    options = {}
) {
    if (!redis || !driverId || !expectedBookingId) {
        const error = new Error('Binding invalido para renovacao do lease de corrida ativa');
        error.code = 'ACTIVE_TRIP_LEASE_BINDING_INVALID';
        throw error;
    }
    requireAtomicRedis(redis);

    const ttlSeconds = options.ttlSeconds ?? ACTIVE_TRIP_TTL_SECONDS;
    const normalizedTtlSeconds = Number.parseInt(String(ttlSeconds), 10);
    if (!Number.isInteger(normalizedTtlSeconds) || normalizedTtlSeconds <= 0) {
        const error = new Error('TTL invalido para renovacao do lease de corrida ativa');
        error.code = 'ACTIVE_TRIP_LEASE_TTL_INVALID';
        throw error;
    }

    const bookingData = options.bookingData
        || await redis.hgetall(`booking:${expectedBookingId}`);
    if (!isBackendConfirmedActiveBooking(bookingData, driverId, expectedBookingId)) {
        return false;
    }

    // Todo retorno positivo vem de um CAS Redis. O script evita regravar o AOF
    // enquanto índice e hash ainda têm mais de metade do lease, mas nunca usa
    // cache process-local como prova de ownership.
    const result = await redis.eval(
        `${RESOLVE_ACTIVE_TRIP_LUA}
        local expectedTrip = ARGV[1]
        local indexedTrip = redis.call("get", KEYS[1])
        local hashedTrip = redis.call("hget", KEYS[3], "activeTripId")
        local hashedLeaseUntilMs = tonumber(redis.call("hget", KEYS[3], "${ACTIVE_TRIP_LEASE_UNTIL_FIELD}") or "0")
        if indexedTrip and tostring(indexedTrip) ~= expectedTrip then return -1 end
        if hashedTrip and hashedLeaseUntilMs > nowMs and tostring(hashedTrip) ~= expectedTrip then return -1 end
        if not currentTrip then return 0 end
        if tostring(currentTrip) ~= expectedTrip then return -1 end
        local bookingDriverId = redis.call("hget", KEYS[4], "driverId")
        if not bookingDriverId or tostring(bookingDriverId) ~= ARGV[2] then return -2 end
        local bookingStatus = string.upper(tostring(redis.call("hget", KEYS[4], "status") or ""))
        local bookingState = string.upper(tostring(redis.call("hget", KEYS[4], "state") or ""))
        local active = bookingStatus == "ACCEPTED" or bookingStatus == "ARRIVED" or bookingStatus == "SEARCHING" or bookingStatus == "STARTED" or bookingStatus == "IN_PROGRESS" or bookingStatus == "REASSIGNED_IN_PROGRESS" or bookingState == "ACCEPTED" or bookingState == "ARRIVED" or bookingState == "SEARCHING" or bookingState == "STARTED" or bookingState == "IN_PROGRESS" or bookingState == "REASSIGNED_IN_PROGRESS"
        if not active then return -3 end
        local remainingIndexTtl = redis.call("ttl", KEYS[1])
        local remainingHashLeaseMs = hashedLeaseUntilMs - nowMs
        if indexedTrip and tostring(indexedTrip) == expectedTrip and hashedTrip and tostring(hashedTrip) == expectedTrip and remainingIndexTtl > tonumber(ARGV[5]) and remainingHashLeaseMs > (tonumber(ARGV[5]) * 1000) then return 2 end
        local customerId = redis.call("hget", KEYS[4], "customerId") or redis.call("hget", KEYS[4], "customer")
        local leaseUntilMs = nowMs + (tonumber(ARGV[3]) * 1000)
        redis.call("set", KEYS[1], expectedTrip, "EX", ARGV[3])
        if customerId and tostring(customerId) ~= "" then redis.call("set", KEYS[2], customerId, "EX", ARGV[3]) elseif redis.call("exists", KEYS[2]) == 1 then redis.call("expire", KEYS[2], ARGV[3]) end
        redis.call("hset", KEYS[3], "activeTripId", expectedTrip, "activeTripUpdatedAt", ARGV[4], "${ACTIVE_TRIP_LEASE_UNTIL_FIELD}", tostring(leaseUntilMs))
        return 1`,
        4,
        activeTripKey(driverId),
        activeTripCustomerKey(driverId),
        `driver:${driverId}`,
        `booking:${expectedBookingId}`,
        String(expectedBookingId),
        String(driverId),
        String(normalizedTtlSeconds),
        new Date().toISOString(),
        String(ACTIVE_TRIP_RENEWAL_WRITE_THRESHOLD_SECONDS)
    );

    return Number(result) === 1 || Number(result) === 2;
}

async function claimIdentityVerificationWindow(
    redis,
    driverId,
    token,
    ttlSeconds = IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
    options = {}
) {
    if (!redis || !driverId || !token) {
        const error = new Error('Binding invalido para janela de verificacao de identidade');
        error.code = 'KYC_VERIFICATION_WINDOW_BINDING_INVALID';
        throw error;
    }
    requireAtomicRedis(redis);

    const existingOnly = options.existingOnly === true;
    const requiredDatasetGeneration = String(
        options.requiredDatasetGeneration || ''
    ).trim();
    const datasetGenerationKey = String(
        options.datasetGenerationKey || 'leaf:runtime:critical-dataset:generation'
    ).trim();
    const result = await redis.eval(
        `${RESOLVE_ACTIVE_TRIP_LUA}
        if currentTrip then return {0, currentTrip} end
        if redis.call("get", KEYS[4]) then return {-2, ""} end
        local current = redis.call("get", KEYS[2])
        if current and current ~= ARGV[1] then return {-1, ""} end
        if current == ARGV[1] then redis.call("expire", KEYS[2], ARGV[2]); return {2, ""} end
        if ARGV[3] == "1" then return {-3, ""} end
        if ARGV[4] ~= "" then
            local observedGeneration = redis.call("get", KEYS[5])
            local generationTtl = redis.call("ttl", KEYS[5])
            if observedGeneration ~= ARGV[4] or generationTtl ~= -1 then return {-4, ""} end
        end
        redis.call("set", KEYS[2], ARGV[1], "EX", ARGV[2])
        return {1, ""}`,
        5,
        activeTripKey(driverId),
        identityVerificationKey(driverId),
        `driver:${driverId}`,
        identityPolicyMutationKey(driverId),
        datasetGenerationKey,
        String(token),
        String(ttlSeconds),
        existingOnly ? '1' : '0',
        requiredDatasetGeneration
    );
    const status = Number(Array.isArray(result) ? result[0] : result);
    const activeTripId = Array.isArray(result) ? (result[1] || null) : null;
    if (status === -4) {
        const error = new Error('Autoridade Redis mudou durante a reserva KYC');
        error.code = 'REDIS_CRITICAL_AUTHORITY_NOT_READY';
        error.statusCode = 503;
        error.retryable = true;
        throw error;
    }
    return {
        acquired: status === 1 || status === 2,
        reused: status === 2,
        busy: status === -1 || status === -2,
        missing: status === -3,
        policyMutationBusy: status === -2,
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
    ttlSeconds = IDENTITY_POLICY_MUTATION_TTL_SECONDS,
    options = {}
) {
    if (!redis || !driverId || !token) {
        const error = new Error('Binding invalido para mutacao de politica de identidade');
        error.code = 'KYC_POLICY_MUTATION_BINDING_INVALID';
        throw error;
    }
    requireAtomicRedis(redis);

    const requiredDatasetGeneration = String(
        options.requiredDatasetGeneration || ''
    ).trim();
    const datasetGenerationKey = String(
        options.datasetGenerationKey || 'leaf:runtime:critical-dataset:generation'
    ).trim();

    const result = await redis.eval(
        `${RESOLVE_ACTIVE_TRIP_LUA}
        if currentTrip then return {0, currentTrip} end
        if redis.call("get", KEYS[4]) then return {-2, ""} end
        local current = redis.call("get", KEYS[2])
        if current and current ~= ARGV[1] then return {-1, ""} end
        if current == ARGV[1] then redis.call("expire", KEYS[2], ARGV[2]); return {2, ""} end
        if ARGV[3] ~= "" then
            local observedGeneration = redis.call("get", KEYS[5])
            local generationTtl = redis.call("ttl", KEYS[5])
            if observedGeneration ~= ARGV[3] or generationTtl ~= -1 then return {-3, ""} end
        end
        redis.call("set", KEYS[2], ARGV[1], "EX", ARGV[2])
        return {1, ""}`,
        5,
        activeTripKey(driverId),
        identityPolicyMutationKey(driverId),
        `driver:${driverId}`,
        identityVerificationKey(driverId),
        datasetGenerationKey,
        String(token),
        String(ttlSeconds),
        requiredDatasetGeneration
    );
    const status = Number(Array.isArray(result) ? result[0] : result);
    const activeTripId = Array.isArray(result) ? (result[1] || null) : null;
    if (status === -3) {
        const error = new Error('Autoridade Redis mudou durante a mutacao KYC');
        error.code = 'REDIS_CRITICAL_AUTHORITY_NOT_READY';
        error.statusCode = 503;
        error.retryable = true;
        throw error;
    }
    return {
        acquired: status === 1 || status === 2,
        reused: status === 2,
        busy: status === -1 || status === -2,
        verificationBusy: status === -2,
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
        `${RESOLVE_ACTIVE_TRIP_LUA}
        if ARGV[1] ~= "" and not currentTrip then return 2 end
        if ARGV[1] ~= "" and tostring(currentTrip) ~= tostring(ARGV[1]) then return 0 end
        redis.call("del", KEYS[1])
        redis.call("del", KEYS[2])
        redis.call("hdel", KEYS[3], "activeTripId", "activeTripUpdatedAt", "${ACTIVE_TRIP_LEASE_UNTIL_FIELD}")
        return 1`,
        3,
        activeTripKey(driverId),
        activeTripCustomerKey(driverId),
        `driver:${driverId}`,
        expectedBookingId ? String(expectedBookingId) : ''
    );
    const status = Number(result);
    return status === 1 || status === 2;
}

async function resolveActiveTripForDriver(redis, driverId) {
    if (!redis || !driverId) {
        return { tripId: null, customerId: null };
    }

    requireAtomicRedis(redis);
    const resolved = await redis.eval(
        `${RESOLVE_ACTIVE_TRIP_LUA}
        if not currentTrip then return {"", ""} end
        return {currentTrip, redis.call("get", KEYS[2]) or ""}`,
        3,
        activeTripKey(driverId),
        activeTripCustomerKey(driverId),
        `driver:${driverId}`
    );
    const tripId = Array.isArray(resolved) ? resolved[0] : resolved;
    if (!tripId) {
        return { tripId: null, customerId: null };
    }
    const customerId = Array.isArray(resolved) ? resolved[1] : null;

    return {
        tripId: String(tripId),
        customerId: customerId || null
    };
}

module.exports = {
    ACTIVE_TRIP_TTL_SECONDS,
    ACTIVE_TRIP_RENEWAL_WRITE_THRESHOLD_SECONDS,
    ACTIVE_TRIP_LEASE_UNTIL_FIELD,
    IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
    IDENTITY_POLICY_MUTATION_TTL_SECONDS,
    activeTripKey,
    activeTripCustomerKey,
    identityVerificationKey,
    identityPolicyMutationKey,
    activeStepUpChallengeKey,
    setActiveTripForDriver,
    renewActiveTripForDriver,
    clearActiveTripForDriver,
    resolveActiveTripForDriver,
    claimIdentityVerificationWindow,
    renewIdentityVerificationWindow,
    releaseIdentityVerificationWindow,
    claimIdentityPolicyMutationWindow,
    renewIdentityPolicyMutationWindow,
    releaseIdentityPolicyMutationWindow
};
