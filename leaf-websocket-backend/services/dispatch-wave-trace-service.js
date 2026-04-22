const { logger } = require('../utils/logger');

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const TRACE_TTL_SECONDS = parsePositiveInt(
    process.env.DISPATCH_WAVE_TRACE_TTL_SECONDS,
    86400
);
const TRACE_MAX_EVENTS = parsePositiveInt(
    process.env.DISPATCH_WAVE_TRACE_MAX_EVENTS,
    24
);

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function toStoredFiniteNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function toFiniteString(value, fallback = '0') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return String(numeric);
    }
    return fallback;
}

function getTraceKey(bookingId) {
    return `dispatch_wave_trace:${bookingId}`;
}

function normalizeSource(source, fallback = 'unknown') {
    const normalized = String(source || '').trim();
    return normalized || fallback;
}

function normalizeFailureReasons(raw = null) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }

    return Object.entries(raw).reduce((acc, [key, value]) => {
        const normalizedKey = String(key || '').trim();
        const numericValue = Number(value);
        if (!normalizedKey || !Number.isFinite(numericValue) || numericValue <= 0) {
            return acc;
        }
        acc[normalizedKey] = Math.trunc(numericValue);
        return acc;
    }, {});
}

async function beginDispatchWave(redis, bookingId, payload = {}) {
    if (!redis || !bookingId) return null;

    try {
        const bookingKey = `booking:${bookingId}`;
        const timestampMs = toFiniteNumber(payload.timestampMs, Date.now());
        const timestampIso = new Date(timestampMs).toISOString();
        const radiusKm = Math.max(0, toFiniteNumber(payload.radiusKm, 0));
        const candidateCount = Math.max(0, toFiniteNumber(payload.candidateCount, 0));
        const limit = Math.max(0, toFiniteNumber(payload.limit, 0));
        const source = normalizeSource(payload.source, 'gradual_expander');
        const waveNumber = await redis.hincrby(bookingKey, 'dispatchWaveCount', 1);

        await redis.hset(bookingKey, {
            dispatchWavePendingWave: String(waveNumber),
            dispatchWavePendingAt: timestampIso,
            dispatchWavePendingRadiusKm: toFiniteString(radiusKm),
            dispatchWavePendingSource: source,
            dispatchWavePendingCandidateCount: String(candidateCount),
            dispatchWavePendingLimit: String(limit)
        });

        return {
            waveNumber,
            radiusKm,
            source,
            at: timestampIso
        };
    } catch (error) {
        logger.warn(`⚠️ [DispatchWaveTrace] Falha ao iniciar wave ${bookingId}: ${error.message}`);
        return null;
    }
}

async function recordDispatchWave(redis, bookingId, payload = {}) {
    if (!redis || !bookingId) return null;

    try {
        const bookingKey = `booking:${bookingId}`;
        const traceKey = getTraceKey(bookingId);
        const timestampMs = toFiniteNumber(payload.timestampMs, Date.now());
        const timestampIso = new Date(timestampMs).toISOString();
        const candidateCount = Math.max(0, toFiniteNumber(payload.candidateCount, 0));
        const notifiedCount = Math.max(0, toFiniteNumber(payload.notifiedCount, 0));
        const failedCount = Math.max(0, toFiniteNumber(payload.failedCount, 0));
        const radiusKm = Math.max(0, toFiniteNumber(payload.radiusKm, 0));
        const source = normalizeSource(payload.source, 'gradual_expander');
        const failureReasons = normalizeFailureReasons(payload.failureReasons);
        const requestedWaveNumber = toStoredFiniteNumber(payload.waveNumber, Number.NaN);
        const waveNumber = Number.isFinite(requestedWaveNumber) && requestedWaveNumber > 0
            ? requestedWaveNumber
            : await redis.hincrby(bookingKey, 'dispatchWaveCount', 1);

        const eventPayload = {
            type: 'wave',
            source,
            waveNumber,
            at: timestampIso,
            radiusKm,
            candidateCount,
            notifiedCount,
            failedCount,
            failureReasons,
            limit: Math.max(0, toFiniteNumber(payload.limit, 0)),
            bookingState: payload.bookingState || null
        };

        const pipeline = redis.multi();
        pipeline.hset(bookingKey, {
            dispatchWaveCount: String(waveNumber),
            dispatchWaveLastNumber: String(waveNumber),
            dispatchWaveLastAt: timestampIso,
            dispatchWaveLastRadiusKm: toFiniteString(radiusKm),
            dispatchWaveLastCandidateCount: String(candidateCount),
            dispatchWaveLastNotifiedCount: String(notifiedCount),
            dispatchWaveLastFailedCount: String(failedCount),
            dispatchWaveLastFailureReasonsJson: JSON.stringify(failureReasons),
            dispatchTraceLastType: 'wave',
            dispatchTraceLastSource: source,
            dispatchTraceLastAt: timestampIso
        });
        pipeline.hincrby(bookingKey, 'dispatchWaveTotalCandidates', candidateCount);
        pipeline.hincrby(bookingKey, 'dispatchWaveTotalNotified', notifiedCount);
        pipeline.hincrby(bookingKey, 'dispatchWaveTotalFailed', failedCount);

        if (notifiedCount > 0) {
            pipeline.hset(bookingKey, {
                dispatchWaveLastNotifiedWave: String(waveNumber),
                dispatchWaveLastNotifiedAt: timestampIso,
                dispatchWaveLastNotifiedRadiusKm: toFiniteString(radiusKm),
                dispatchWaveLastNotifiedCount: String(notifiedCount),
                dispatchWaveLastNotifiedSource: source
            });
            pipeline.hsetnx(bookingKey, 'dispatchWaveFirstNotifiedWave', String(waveNumber));
            pipeline.hsetnx(bookingKey, 'dispatchWaveFirstNotifiedAt', timestampIso);
            pipeline.hsetnx(bookingKey, 'dispatchWaveFirstNotifiedRadiusKm', toFiniteString(radiusKm));
            pipeline.hsetnx(bookingKey, 'dispatchWaveFirstNotifiedSource', source);
        }

        pipeline.rpush(traceKey, JSON.stringify(eventPayload));
        pipeline.ltrim(traceKey, -TRACE_MAX_EVENTS, -1);
        pipeline.expire(traceKey, TRACE_TTL_SECONDS);
        pipeline.hdel(
            bookingKey,
            'dispatchWavePendingWave',
            'dispatchWavePendingAt',
            'dispatchWavePendingRadiusKm',
            'dispatchWavePendingSource',
            'dispatchWavePendingCandidateCount',
            'dispatchWavePendingLimit'
        );
        await pipeline.exec();

        return {
            source,
            waveNumber,
            candidateCount,
            notifiedCount,
            failedCount,
            failureReasons,
            radiusKm,
            at: timestampIso
        };
    } catch (error) {
        logger.warn(`⚠️ [DispatchWaveTrace] Falha ao registrar wave ${bookingId}: ${error.message}`);
        return null;
    }
}

async function recordDispatchDirectNotification(redis, bookingId, payload = {}) {
    if (!redis || !bookingId) return null;

    try {
        const bookingKey = `booking:${bookingId}`;
        const traceKey = getTraceKey(bookingId);
        const timestampMs = toFiniteNumber(payload.timestampMs, Date.now());
        const timestampIso = new Date(timestampMs).toISOString();
        const source = normalizeSource(payload.source, 'response_handler');
        const driverId = String(payload.driverId || '');
        const directCount = await redis.hincrby(bookingKey, 'dispatchDirectCount', 1);

        const eventPayload = {
            type: 'direct',
            source,
            at: timestampIso,
            driverId,
            bookingState: payload.bookingState || null,
            notified: payload.notified !== false
        };

        const pipeline = redis.multi();
        pipeline.hset(bookingKey, {
            dispatchDirectLastAt: timestampIso,
            dispatchDirectLastDriverId: driverId,
            dispatchDirectLastSource: source,
            dispatchTraceLastType: 'direct',
            dispatchTraceLastSource: source,
            dispatchTraceLastAt: timestampIso
        });
        pipeline.hsetnx(bookingKey, 'dispatchDirectFirstAt', timestampIso);
        pipeline.hsetnx(bookingKey, 'dispatchDirectFirstSource', source);
        pipeline.rpush(traceKey, JSON.stringify(eventPayload));
        pipeline.ltrim(traceKey, -TRACE_MAX_EVENTS, -1);
        pipeline.expire(traceKey, TRACE_TTL_SECONDS);
        await pipeline.exec();

        return {
            directCount,
            source,
            at: timestampIso,
            driverId
        };
    } catch (error) {
        logger.warn(`⚠️ [DispatchWaveTrace] Falha ao registrar notificação direta ${bookingId}: ${error.message}`);
        return null;
    }
}

async function recordDispatchWaveAcceptance(redis, bookingId, payload = {}) {
    if (!redis || !bookingId) return null;

    try {
        const bookingKey = `booking:${bookingId}`;
        const traceKey = getTraceKey(bookingId);
        const acceptedAtMs = toFiniteNumber(payload.timestampMs, Date.now());
        const acceptedAtIso = new Date(acceptedAtMs).toISOString();
        const [
            acceptedWaveRaw,
            lastNotifiedWaveRaw,
            lastNotifiedRadiusRaw,
            waveCountRaw,
            totalCandidatesRaw,
            totalNotifiedRaw,
            totalFailedRaw,
            acceptedSourceRaw,
            lastNotifiedSourceRaw,
            directCountRaw,
            dispatchTraceLastTypeRaw,
            dispatchTraceLastSourceRaw,
            pendingWaveRaw,
            pendingRadiusRaw,
            pendingSourceRaw,
            pendingCandidateCountRaw,
            pendingLimitRaw
        ] = await redis.hmget(
            bookingKey,
            'dispatchWaveAcceptedWave',
            'dispatchWaveLastNotifiedWave',
            'dispatchWaveLastNotifiedRadiusKm',
            'dispatchWaveCount',
            'dispatchWaveTotalCandidates',
            'dispatchWaveTotalNotified',
            'dispatchWaveTotalFailed',
            'dispatchWaveAcceptedSource',
            'dispatchWaveLastNotifiedSource',
            'dispatchDirectCount',
            'dispatchTraceLastType',
            'dispatchTraceLastSource',
            'dispatchWavePendingWave',
            'dispatchWavePendingRadiusKm',
            'dispatchWavePendingSource',
            'dispatchWavePendingCandidateCount',
            'dispatchWavePendingLimit'
        );

        const pendingWave = toStoredFiniteNumber(pendingWaveRaw, 0);
        const acceptedWave = toFiniteNumber(
            toStoredFiniteNumber(acceptedWaveRaw, Number.NaN),
            toStoredFiniteNumber(
                lastNotifiedWaveRaw,
                pendingWave
            )
        );
        const pendingRadiusKm = toStoredFiniteNumber(pendingRadiusRaw, 0);
        const pendingCandidateCount = toStoredFiniteNumber(pendingCandidateCountRaw, 0);
        const pendingLimit = toStoredFiniteNumber(pendingLimitRaw, 0);
        const acceptedRadiusKm = toStoredFiniteNumber(lastNotifiedRadiusRaw, pendingRadiusKm);
        const waveCount = toStoredFiniteNumber(waveCountRaw, 0);
        const storedTotalCandidates = toStoredFiniteNumber(totalCandidatesRaw, Number.NaN);
        const storedTotalNotified = toStoredFiniteNumber(totalNotifiedRaw, Number.NaN);
        const acceptedFromPendingWave = pendingWave > 0 && acceptedWave >= pendingWave;
        const fallbackTotalNotified = Math.min(pendingCandidateCount, pendingLimit || pendingCandidateCount);
        const totalCandidates = (
            acceptedFromPendingWave
            && pendingCandidateCount > 0
            && (!Number.isFinite(storedTotalCandidates) || storedTotalCandidates <= 0)
        )
            ? pendingCandidateCount
            : toFiniteNumber(storedTotalCandidates, pendingCandidateCount);
        const totalNotified = (
            acceptedFromPendingWave
            && pendingCandidateCount > 0
            && (!Number.isFinite(storedTotalNotified) || storedTotalNotified <= 0)
        )
            ? fallbackTotalNotified
            : toFiniteNumber(storedTotalNotified, fallbackTotalNotified);
        const totalFailed = toStoredFiniteNumber(totalFailedRaw, 0);
        const directCount = toStoredFiniteNumber(directCountRaw, 0);
        const acceptedSource = normalizeSource(
            acceptedSourceRaw,
            lastNotifiedSourceRaw
                || pendingSourceRaw
                || dispatchTraceLastSourceRaw
                || (directCount > 0 ? 'response_handler' : 'unknown')
        );
        const acceptedType = normalizeSource(
            dispatchTraceLastTypeRaw,
            directCount > 0 ? 'direct' : 'wave'
        );

        const pipeline = redis.multi();
        pipeline.hset(bookingKey, {
            dispatchWaveAcceptedWave: String(acceptedWave),
            dispatchWaveAcceptedRadiusKm: toFiniteString(acceptedRadiusKm),
            dispatchWaveAcceptedAt: acceptedAtIso,
            dispatchWaveAcceptedDriverId: String(payload.driverId || ''),
            dispatchWaveAcceptedSource: acceptedSource,
            dispatchWaveAcceptedType: acceptedType
        });
        pipeline.rpush(traceKey, JSON.stringify({
            type: 'accepted',
            source: acceptedSource,
            dispatchType: acceptedType,
            waveNumber: acceptedWave,
            radiusKm: acceptedRadiusKm,
            at: acceptedAtIso,
            driverId: String(payload.driverId || ''),
            waveCount,
            totalCandidates,
            totalNotified,
            totalFailed,
            directCount
        }));
        pipeline.ltrim(traceKey, -TRACE_MAX_EVENTS, -1);
        pipeline.expire(traceKey, TRACE_TTL_SECONDS);
        await pipeline.exec();

        return {
            acceptedWave,
            acceptedRadiusKm,
            acceptedAt: acceptedAtIso,
            driverId: String(payload.driverId || ''),
            acceptedSource,
            acceptedType,
            waveCount,
            totalCandidates,
            totalNotified,
            totalFailed,
            directCount
        };
    } catch (error) {
        logger.warn(`⚠️ [DispatchWaveTrace] Falha ao registrar aceite ${bookingId}: ${error.message}`);
        return null;
    }
}

module.exports = {
    beginDispatchWave,
    recordDispatchWave,
    recordDispatchDirectNotification,
    recordDispatchWaveAcceptance
};
