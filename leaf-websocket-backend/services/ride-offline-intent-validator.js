const RideStateManager = require('./ride-state-manager');

const DEFAULT_INTENT_TTL_SECONDS = 24 * 60 * 60;

const RIDE_OFFLINE_INTENT_TYPES = Object.freeze({
    ARRIVED_AT_PICKUP: 'arrived_at_pickup',
    START_TRIP: 'start_trip',
    COMPLETE_TRIP: 'complete_trip',
    CANCEL_RIDE: 'cancel_ride'
});

const EVENT_POLICY = Object.freeze({
    [RIDE_OFFLINE_INTENT_TYPES.ARRIVED_AT_PICKUP]: {
        allowedRoles: ['driver'],
        allowedStates: ['ACCEPTED']
    },
    [RIDE_OFFLINE_INTENT_TYPES.START_TRIP]: {
        allowedRoles: ['driver'],
        allowedStates: ['ARRIVED']
    },
    [RIDE_OFFLINE_INTENT_TYPES.COMPLETE_TRIP]: {
        allowedRoles: ['driver'],
        allowedStates: ['IN_PROGRESS', 'REASSIGNED_IN_PROGRESS']
    },
    [RIDE_OFFLINE_INTENT_TYPES.CANCEL_RIDE]: {
        allowedRoles: ['passenger', 'driver'],
        allowedStates: [
            'PENDING',
            'AWAITING_PAYMENT',
            'SEARCHING',
            'NOTIFIED',
            'AWAITING_RESPONSE',
            'MATCHED',
            'ACCEPTED',
            'ARRIVED'
        ]
    }
});

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeId(value) {
    if (value && typeof value === 'object') {
        return normalizeId(value.id || value.uid || value.userId || value.customerId || value.driverId);
    }
    return normalizeText(value);
}

function normalizeRole(role) {
    const normalized = normalizeText(role).toLowerCase();
    if (normalized === 'customer' || normalized === 'rider') return 'passenger';
    if (normalized === 'motorista' || normalized === 'partner') return 'driver';
    return normalized;
}

function normalizeEventType(eventType) {
    const normalized = normalizeText(eventType).toLowerCase();
    if (normalized === 'arrived' || normalized === 'driver_arrived' || normalized === 'arrive_at_pickup') {
        return RIDE_OFFLINE_INTENT_TYPES.ARRIVED_AT_PICKUP;
    }
    if (normalized === 'started' || normalized === 'start' || normalized === 'starttrip') {
        return RIDE_OFFLINE_INTENT_TYPES.START_TRIP;
    }
    if (normalized === 'completed' || normalized === 'complete' || normalized === 'finish_trip' || normalized === 'completetrip') {
        return RIDE_OFFLINE_INTENT_TYPES.COMPLETE_TRIP;
    }
    if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancel' || normalized === 'cancelride') {
        return RIDE_OFFLINE_INTENT_TYPES.CANCEL_RIDE;
    }
    return normalized;
}

function normalizeState(value) {
    return RideStateManager.normalizeStateValue
        ? RideStateManager.normalizeStateValue(value)
        : normalizeText(value).toUpperCase();
}

function hasRideOfflineIntentPayload(data = {}) {
    return Boolean(
        data?.offlineIntent === true ||
        data?.rideEventOutbox === true ||
        data?.source === 'ride_event_outbox' ||
        data?.offline === true ||
        data?.clientSequence !== undefined ||
        data?.clientCreatedAt !== undefined
    );
}

function safeJsonParse(value) {
    if (!value || typeof value !== 'string') return value || null;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return null;
    }
}

async function readBooking(redis, bookingId) {
    if (!redis || !bookingId) return null;

    if (typeof redis.hgetall === 'function') {
        const bookingHash = await redis.hgetall(`booking:${bookingId}`).catch(() => null);
        if (bookingHash && Object.keys(bookingHash).length > 0) {
            return bookingHash;
        }
    }

    if (typeof redis.hget === 'function') {
        const activeRaw = await redis.hget('bookings:active', bookingId).catch(() => null);
        const active = safeJsonParse(activeRaw);
        if (active && typeof active === 'object') {
            return active;
        }
    }

    return null;
}

function getBookingState(booking = {}) {
    return normalizeState(
        booking.status ||
        booking.state ||
        booking.bookingStatus ||
        booking.tripStatus ||
        booking.rideStatus
    );
}

function getBookingParticipantIds(booking = {}) {
    return {
        passengerId: normalizeId(
            booking.customerId ||
            booking.customer ||
            booking.passengerId ||
            booking.passenger ||
            booking.userId
        ),
        driverId: normalizeId(
            booking.driverId ||
            booking.driver ||
            booking.ownerDriverId ||
            booking.assignedDriverId ||
            booking.acceptedDriverId
        )
    };
}

function isActorInScope({ actorId, role, booking }) {
    const { passengerId, driverId } = getBookingParticipantIds(booking);
    const normalizedActorId = normalizeId(actorId);
    const normalizedRole = normalizeRole(role);

    if (!normalizedActorId) return false;
    if (normalizedRole === 'passenger') return normalizedActorId === passengerId;
    if (normalizedRole === 'driver') return normalizedActorId === driverId;
    return normalizedActorId === passengerId || normalizedActorId === driverId;
}

function sortObject(value) {
    if (Array.isArray(value)) {
        return value.map(sortObject);
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
            acc[key] = sortObject(value[key]);
            return acc;
        }, {});
}

function stableStringify(value) {
    return JSON.stringify(sortObject(value));
}

function buildIntentFingerprint(intent) {
    return stableStringify({
        bookingId: intent.bookingId,
        actorId: intent.actorId,
        role: intent.role,
        eventType: intent.eventType,
        clientSequence: intent.clientSequence,
        clientCreatedAt: intent.clientCreatedAt,
        payload: intent.payload || null
    });
}

function parseStoredIntent(raw) {
    const parsed = safeJsonParse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
}

async function getLastSequence(redis, sequenceKey) {
    if (!redis || typeof redis.hget !== 'function') return null;
    const raw = await redis.hget(sequenceKey, 'lastSequence').catch(() => null);
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

async function saveIntentRecord(redis, recordKey, record, ttlSeconds) {
    if (typeof redis.set !== 'function') {
        throw new Error('Redis SET is required for ride offline intent validation');
    }

    await redis.set(recordKey, JSON.stringify(record), 'EX', ttlSeconds);
}

async function saveLastSequence(redis, sequenceKey, intent) {
    if (typeof redis.hset !== 'function') return;
    await redis.hset(sequenceKey, {
        lastSequence: String(intent.clientSequence),
        lastIdempotencyKey: intent.idempotencyKey,
        lastEventType: intent.eventType,
        updatedAt: new Date().toISOString()
    });
}

function buildRecordKeys({ bookingId, actorId, idempotencyKey }) {
    return {
        recordKey: `ride_offline_intent:${bookingId}:${idempotencyKey}`,
        sequenceKey: `ride_offline_intent_sequence:${bookingId}:${actorId}`
    };
}

function buildFailure(code, message, details = {}) {
    return {
        accepted: false,
        code,
        message,
        ...details
    };
}

async function validateAndReserveRideOfflineIntent({
    redis,
    booking,
    bookingId,
    actorId,
    role,
    eventType,
    idempotencyKey,
    clientSequence,
    clientCreatedAt,
    payload,
    data,
    ttlSeconds = DEFAULT_INTENT_TTL_SECONDS
} = {}) {
    const source = data && typeof data === 'object' ? data : {};
    if (!hasRideOfflineIntentPayload(source) && !idempotencyKey && clientSequence === undefined && clientCreatedAt === undefined) {
        return { accepted: true, skipped: true };
    }

    const normalizedIntent = {
        bookingId: normalizeId(bookingId || source.bookingId || source.rideId),
        actorId: normalizeId(actorId || source.actorId || source.userId || source.driverId || source.customerId),
        role: normalizeRole(role || source.role || source.userType),
        eventType: normalizeEventType(eventType || source.eventType || source.action),
        idempotencyKey: normalizeText(idempotencyKey || source.idempotencyKey),
        clientSequence: Number(clientSequence ?? source.clientSequence),
        clientCreatedAt: source.clientCreatedAt || clientCreatedAt,
        payload: payload !== undefined ? payload : (source.payload || null)
    };

    if (!normalizedIntent.bookingId) {
        return buildFailure('OFFLINE_INTENT_BOOKING_REQUIRED', 'Booking obrigatoria para intencao offline.');
    }
    if (!normalizedIntent.actorId) {
        return buildFailure('OFFLINE_INTENT_ACTOR_REQUIRED', 'Ator obrigatorio para intencao offline.');
    }
    if (!normalizedIntent.idempotencyKey) {
        return buildFailure('OFFLINE_INTENT_IDEMPOTENCY_REQUIRED', 'Idempotency key obrigatoria para intencao offline.');
    }
    if (!EVENT_POLICY[normalizedIntent.eventType]) {
        return buildFailure('OFFLINE_INTENT_EVENT_UNSUPPORTED', 'Tipo de intencao offline nao suportado.', {
            eventType: normalizedIntent.eventType
        });
    }
    if (!Number.isInteger(normalizedIntent.clientSequence) || normalizedIntent.clientSequence <= 0) {
        return buildFailure('OFFLINE_INTENT_SEQUENCE_INVALID', 'Sequencia local invalida para intencao offline.');
    }

    const createdAtTime = new Date(normalizedIntent.clientCreatedAt).getTime();
    if (!Number.isFinite(createdAtTime)) {
        return buildFailure('OFFLINE_INTENT_CREATED_AT_INVALID', 'Timestamp local invalido para intencao offline.');
    }

    const { recordKey, sequenceKey } = buildRecordKeys(normalizedIntent);
    const fingerprint = buildIntentFingerprint(normalizedIntent);
    const storedRaw = typeof redis?.get === 'function'
        ? await redis.get(recordKey).catch(() => null)
        : null;
    const stored = parseStoredIntent(storedRaw);

    if (stored) {
        if (stored.fingerprint !== fingerprint) {
            return buildFailure('OFFLINE_INTENT_IDEMPOTENCY_CONFLICT', 'Idempotency key reutilizada com payload diferente.', {
                idempotencyKey: normalizedIntent.idempotencyKey
            });
        }

        if (stored.status === 'processed' && stored.result) {
            return {
                accepted: true,
                replay: true,
                cachedResult: stored.result,
                intent: normalizedIntent,
                recordKey,
                sequenceKey
            };
        }

        return buildFailure(
            stored.status === 'rejected' ? 'OFFLINE_INTENT_ALREADY_REJECTED' : 'OFFLINE_INTENT_IN_FLIGHT',
            stored.error || 'Intencao offline ja registrada para esta idempotency key.',
            {
                replay: true,
                intent: normalizedIntent,
                recordKey,
                sequenceKey
            }
        );
    }

    const bookingSnapshot = booking || await readBooking(redis, normalizedIntent.bookingId);
    if (!bookingSnapshot) {
        return buildFailure('OFFLINE_INTENT_BOOKING_NOT_FOUND', 'Corrida nao encontrada para intencao offline.');
    }

    if (!isActorInScope({
        actorId: normalizedIntent.actorId,
        role: normalizedIntent.role,
        booking: bookingSnapshot
    })) {
        return buildFailure('OFFLINE_INTENT_SCOPE_DENIED', 'Usuario nao participa desta corrida.', {
            actorId: normalizedIntent.actorId,
            role: normalizedIntent.role
        });
    }

    const policy = EVENT_POLICY[normalizedIntent.eventType];
    if (!policy.allowedRoles.includes(normalizedIntent.role)) {
        return buildFailure('OFFLINE_INTENT_ROLE_DENIED', 'Perfil nao autorizado para esta intencao offline.', {
            role: normalizedIntent.role,
            eventType: normalizedIntent.eventType
        });
    }

    const currentState = getBookingState(bookingSnapshot);
    if (RideStateManager.isTerminalStateValue(currentState)) {
        return buildFailure('OFFLINE_INTENT_TERMINAL_RIDE', 'Corrida terminal nao aceita novas intencoes offline.', {
            currentState
        });
    }

    if (!policy.allowedStates.includes(currentState)) {
        return buildFailure('OFFLINE_INTENT_STATE_DENIED', 'Estado canonico nao permite esta intencao offline.', {
            currentState,
            eventType: normalizedIntent.eventType,
            allowedStates: policy.allowedStates
        });
    }

    const lastSequence = await getLastSequence(redis, sequenceKey);
    if (lastSequence !== null && normalizedIntent.clientSequence <= lastSequence) {
        return buildFailure('OFFLINE_INTENT_OUT_OF_ORDER', 'Sequencia local antiga ou repetida para intencao offline.', {
            clientSequence: normalizedIntent.clientSequence,
            lastSequence
        });
    }

    const record = {
        status: 'accepted',
        fingerprint,
        bookingId: normalizedIntent.bookingId,
        actorId: normalizedIntent.actorId,
        role: normalizedIntent.role,
        eventType: normalizedIntent.eventType,
        idempotencyKey: normalizedIntent.idempotencyKey,
        clientSequence: normalizedIntent.clientSequence,
        clientCreatedAt: normalizedIntent.clientCreatedAt,
        currentState,
        reservedAt: new Date().toISOString()
    };

    await saveIntentRecord(redis, recordKey, record, ttlSeconds);
    await saveLastSequence(redis, sequenceKey, normalizedIntent);

    return {
        accepted: true,
        replay: false,
        intent: normalizedIntent,
        recordKey,
        sequenceKey,
        currentState
    };
}

async function markRideOfflineIntentProcessed({
    redis,
    bookingId,
    idempotencyKey,
    result,
    ttlSeconds = DEFAULT_INTENT_TTL_SECONDS
} = {}) {
    const normalizedBookingId = normalizeId(bookingId);
    const normalizedIdempotencyKey = normalizeText(idempotencyKey);
    if (!redis || !normalizedBookingId || !normalizedIdempotencyKey || typeof redis.get !== 'function') {
        return false;
    }

    const recordKey = `ride_offline_intent:${normalizedBookingId}:${normalizedIdempotencyKey}`;
    const existing = parseStoredIntent(await redis.get(recordKey).catch(() => null));
    if (!existing) return false;

    await saveIntentRecord(redis, recordKey, {
        ...existing,
        status: 'processed',
        result: result || null,
        processedAt: new Date().toISOString()
    }, ttlSeconds);

    return true;
}

async function markRideOfflineIntentRejected({
    redis,
    bookingId,
    idempotencyKey,
    error,
    code,
    ttlSeconds = DEFAULT_INTENT_TTL_SECONDS
} = {}) {
    const normalizedBookingId = normalizeId(bookingId);
    const normalizedIdempotencyKey = normalizeText(idempotencyKey);
    if (!redis || !normalizedBookingId || !normalizedIdempotencyKey || typeof redis.get !== 'function') {
        return false;
    }

    const recordKey = `ride_offline_intent:${normalizedBookingId}:${normalizedIdempotencyKey}`;
    const existing = parseStoredIntent(await redis.get(recordKey).catch(() => null));
    if (!existing) return false;

    await saveIntentRecord(redis, recordKey, {
        ...existing,
        status: 'rejected',
        error: normalizeText(error) || 'Intencao offline rejeitada',
        code: normalizeText(code) || 'OFFLINE_INTENT_REJECTED',
        rejectedAt: new Date().toISOString()
    }, ttlSeconds);

    return true;
}

module.exports = {
    DEFAULT_INTENT_TTL_SECONDS,
    RIDE_OFFLINE_INTENT_TYPES,
    EVENT_POLICY,
    hasRideOfflineIntentPayload,
    normalizeEventType,
    normalizeRole,
    validateAndReserveRideOfflineIntent,
    markRideOfflineIntentProcessed,
    markRideOfflineIntentRejected
};
