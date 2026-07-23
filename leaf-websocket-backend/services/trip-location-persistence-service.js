const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const RedisScan = require('../utils/redis-scan');
const { logStructured, logError } = require('../utils/logger');
const {
    SandboxPersistenceContextError,
    resolveRidePersistenceScope
} = require('./sandbox-persistence-context');

const EARTH_RADIUS_KM = 6371;

function normalizePointLocation(value = {}) {
    const lat = Number(value.lat ?? value.latitude);
    const lng = Number(value.lng ?? value.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

function normalizeTimestampMs(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function haversineDistanceKm(origin, destination) {
    const toRadians = (value) => (Number(value) * Math.PI) / 180;
    const latDelta = toRadians(destination.lat - origin.lat);
    const lngDelta = toRadians(destination.lng - origin.lng);
    const originLat = toRadians(origin.lat);
    const destinationLat = toRadians(destination.lat);
    const a =
        Math.sin(latDelta / 2) ** 2 +
        Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(lngDelta / 2) ** 2;
    const normalizedA = Math.min(1, Math.max(0, a));
    return EARTH_RADIUS_KM * 2 * Math.atan2(
        Math.sqrt(normalizedA),
        Math.sqrt(1 - normalizedA)
    );
}

function normalizeScopeInput(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const normalized = { ...source };
    if (
        Object.prototype.hasOwnProperty.call(source, 'testUserSandbox') &&
        source.testUserSandbox !== undefined &&
        source.testUserSandbox !== null &&
        source.testUserSandbox !== ''
    ) {
        normalized.testUserSandbox =
            source.testUserSandbox === true ||
            String(source.testUserSandbox || '').trim().toLowerCase() === 'true';
    } else {
        delete normalized.testUserSandbox;
    }
    return normalized;
}

function hasPersistenceEnvelope(input = {}) {
    return Boolean(
        input?.financialContext ||
        input?.financialNamespace ||
        input?.financialContextId ||
        input?.providerEnvironment ||
        input?.paymentProviderEnvironment ||
        input?.paymentProfileId ||
        input?.testUserSandbox === true ||
        String(input?.testUserSandbox || '').trim().toLowerCase() === 'true'
    );
}

function buildPersistenceEnvelope(scope, { redis = false } = {}) {
    if (!scope || scope.source === 'legacy_operational') {
        return {};
    }

    const financialContext = scope.financialContext;
    return {
        financialContext: redis ? JSON.stringify(financialContext) : financialContext,
        financialNamespace: scope.namespace,
        financialContextId: scope.financialContextId,
        providerEnvironment: financialContext.providerEnvironment,
        paymentProfileId: financialContext.paymentProfileId || (redis ? '' : null),
        testUserSandbox: redis
            ? String(financialContext.testUserSandbox === true)
            : financialContext.testUserSandbox === true
    };
}

function assertScopeMatchesStoredEnvelope(scope, stored = {}, source = 'trip_location_metadata') {
    if (!stored || Object.keys(stored).length === 0) return;

    const storedScope = resolveRidePersistenceScope(normalizeScopeInput(stored));
    const namespaceMismatch = storedScope.namespace !== scope.namespace;
    const sandboxContextMismatch =
        scope.namespace === 'sandbox' &&
        storedScope.financialContextId !== scope.financialContextId;

    if (namespaceMismatch || sandboxContextMismatch) {
        throw new SandboxPersistenceContextError(
            'TRIP_LOCATION_PERSISTENCE_SCOPE_MISMATCH',
            `Contexto de persistência divergente em ${source}`
        );
    }
}

function resolveTripPersistenceScope(primaryInput = {}, storedMetadata = {}) {
    const normalizedPrimary = normalizeScopeInput(primaryInput);
    const normalizedStored = normalizeScopeInput(storedMetadata);
    const scopeInput = hasPersistenceEnvelope(normalizedPrimary)
        ? normalizedPrimary
        : normalizedStored;
    const scope = resolveRidePersistenceScope(scopeInput);

    if (storedMetadata && Object.keys(storedMetadata).length > 0) {
        assertScopeMatchesStoredEnvelope(scope, normalizedStored);
    }
    return scope;
}

class TripLocationPersistenceService {
    constructor() {
        this.chunkSize = Number.parseInt(process.env.TRIP_LOCATION_CHUNK_SIZE || '30', 10);
        this.bufferTtlSeconds = Number.parseInt(process.env.TRIP_LOCATION_BUFFER_TTL_SECONDS || String(24 * 60 * 60), 10);
        this.workerIdempotencyTtlSeconds = Number.parseInt(process.env.TRIP_LOCATION_WORKER_IDEMPOTENCY_TTL_SECONDS || String(24 * 60 * 60), 10);
        this.flushLockTtlSeconds = Number.parseInt(process.env.TRIP_LOCATION_FLUSH_LOCK_TTL_SECONDS || '15', 10);
        this.flushMaxTripsPerCycle = Number.parseInt(process.env.TRIP_LOCATION_FLUSH_MAX_TRIPS_PER_CYCLE || '200', 10);
        this.flushMaxChunksPerTrip = Number.parseInt(process.env.TRIP_LOCATION_FLUSH_MAX_CHUNKS_PER_TRIP || '4', 10);
        this.chunkRetentionDays = Number.parseInt(process.env.TRIP_LOCATION_CHUNK_RETENTION_DAYS || '30', 10);
        this.chunkRetentionMs = this.chunkRetentionDays * 24 * 60 * 60 * 1000;
        this.enableFirestorePersistence = process.env.ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE !== 'false';
    }

    getBufferKey(tripId) {
        return `trip_loc_buffer:${tripId}`;
    }

    getMetaKey(tripId) {
        return `trip_loc_meta:${tripId}`;
    }

    getFlushLockKey(tripId) {
        return `trip_loc_flush_lock:${tripId}`;
    }

    getWorkerDedupKey(tripId, driverId, seq, capturedAt) {
        return `trip_loc_worker_dedup:${tripId}:${driverId}:${seq}:${capturedAt}`;
    }

    buildRetentionTimestamp(referenceTs = Date.now()) {
        const baseTs = Number.isFinite(Number(referenceTs)) ? Number(referenceTs) : Date.now();
        return new Date(baseTs + this.chunkRetentionMs);
    }

    async getRedis() {
        await redisPool.ensureConnection();
        return redisPool.getConnection();
    }

    getFirestore() {
        if (!this.enableFirestorePersistence) {
            return null;
        }
        return firebaseConfig.getFirestore();
    }

    normalizeLocationEvent(eventData = {}) {
        const tripId = String(eventData.tripId || eventData.bookingId || '');
        const driverId = String(eventData.driverId || '');
        const lat = Number(eventData.lat);
        const lng = Number(eventData.lng);
        const seq = Number.isInteger(Number(eventData.seq)) ? Number(eventData.seq) : null;
        const capturedAt = Number.isFinite(Number(eventData.capturedAt))
            ? Number(eventData.capturedAt)
            : Date.now();

        if (!tripId || !driverId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new Error('Evento de localização inválido: tripId/driverId/lat/lng obrigatórios');
        }

        const persistenceScope = resolveRidePersistenceScope(normalizeScopeInput(eventData));

        return {
            tripId,
            driverId,
            customerId: eventData.customerId ? String(eventData.customerId) : null,
            seq,
            lat,
            lng,
            capturedAt,
            receivedAt: Number.isFinite(Number(eventData.receivedAt)) ? Number(eventData.receivedAt) : Date.now(),
            accuracy: Number.isFinite(Number(eventData.accuracy)) ? Number(eventData.accuracy) : null,
            heading: Number.isFinite(Number(eventData.heading)) ? Number(eventData.heading) : null,
            speed: Number.isFinite(Number(eventData.speed)) ? Number(eventData.speed) : null,
            orderStatus: eventData.orderStatus ? String(eventData.orderStatus) : null,
            outOfOrderWindow: Number.isInteger(Number(eventData.outOfOrderWindow))
                ? Number(eventData.outOfOrderWindow)
                : null,
            lastAcceptedSeq: Number.isInteger(Number(eventData.lastAcceptedSeq))
                ? Number(eventData.lastAcceptedSeq)
                : null,
            ...buildPersistenceEnvelope(persistenceScope)
        };
    }

    async bufferLocationEvent(eventData = {}) {
        const point = this.normalizeLocationEvent(eventData);
        const persistenceScope = resolveRidePersistenceScope(point);
        const redis = await this.getRedis();
        const bufferKey = this.getBufferKey(point.tripId);
        const metaKey = this.getMetaKey(point.tripId);
        const previousMeta = typeof redis.hgetall === 'function'
            ? await redis.hgetall(metaKey)
            : {};
        assertScopeMatchesStoredEnvelope(persistenceScope, previousMeta);

        if (point.seq !== null) {
            const workerDedupKey = this.getWorkerDedupKey(point.tripId, point.driverId, point.seq, point.capturedAt);
            const dedupResult = await redis.set(workerDedupKey, '1', 'NX', 'EX', this.workerIdempotencyTtlSeconds);
            if (!dedupResult) {
                return { success: true, duplicate: true, tripId: point.tripId };
            }
        }

        const bufferLength = await redis.rpush(bufferKey, JSON.stringify(point));
        const sameCanonicalDriver =
            String(previousMeta?.canonicalDriverId || '').trim() === point.driverId;
        const previousLocation = normalizePointLocation({
            lat: previousMeta?.canonicalLastLat,
            lng: previousMeta?.canonicalLastLng
        });
        const previousReceivedAt = normalizeTimestampMs(previousMeta?.canonicalLastReceivedAt);
        const canAppendCanonicalMetric = Boolean(
            sameCanonicalDriver &&
            previousLocation &&
            previousReceivedAt &&
            point.receivedAt >= previousReceivedAt
        );
        const previousDistanceKm = Number(previousMeta?.canonicalDistanceKm);
        const isStaleCanonicalPoint = Boolean(
            sameCanonicalDriver &&
            previousLocation &&
            previousReceivedAt &&
            point.receivedAt < previousReceivedAt
        );
        const canonicalDistanceKm = isStaleCanonicalPoint
            ? Math.max(0, Number.isFinite(previousDistanceKm) ? previousDistanceKm : 0)
            : canAppendCanonicalMetric
                ? Math.max(0, Number.isFinite(previousDistanceKm) ? previousDistanceKm : 0) +
                    haversineDistanceKm(previousLocation, point)
                : 0;
        const canonicalPointsCount = isStaleCanonicalPoint
            ? Math.max(1, Number.parseInt(previousMeta?.canonicalPointsCount || '1', 10) || 1)
            : canAppendCanonicalMetric
                ? Math.max(1, Number.parseInt(previousMeta?.canonicalPointsCount || '1', 10) || 1) + 1
                : 1;
        const canonicalFirstLocation = canAppendCanonicalMetric || isStaleCanonicalPoint
            ? normalizePointLocation({
                lat: previousMeta?.canonicalFirstLat,
                lng: previousMeta?.canonicalFirstLng
            }) || point
            : point;
        const canonicalFirstReceivedAt = canAppendCanonicalMetric || isStaleCanonicalPoint
            ? normalizeTimestampMs(previousMeta?.canonicalFirstReceivedAt) || point.receivedAt
            : point.receivedAt;
        const canonicalLastLocation = isStaleCanonicalPoint ? previousLocation : point;
        const canonicalLastReceivedAt = isStaleCanonicalPoint
            ? previousReceivedAt
            : point.receivedAt;

        await redis.expire(bufferKey, this.bufferTtlSeconds);
        await redis.hset(metaKey, {
            tripId: point.tripId,
            driverId: point.driverId,
            customerId: point.customerId || '',
            lastSeq: point.seq !== null ? String(point.seq) : '',
            lastCapturedAt: String(point.capturedAt),
            lastBufferedAt: String(Date.now()),
            bufferedCount: String(bufferLength),
            canonicalDriverId: point.driverId,
            canonicalDistanceKm: canonicalDistanceKm.toFixed(6),
            canonicalPointsCount: String(canonicalPointsCount),
            canonicalFirstLat: String(canonicalFirstLocation.lat),
            canonicalFirstLng: String(canonicalFirstLocation.lng),
            canonicalFirstReceivedAt: String(canonicalFirstReceivedAt),
            canonicalLastLat: String(canonicalLastLocation.lat),
            canonicalLastLng: String(canonicalLastLocation.lng),
            canonicalLastReceivedAt: String(canonicalLastReceivedAt),
            ...buildPersistenceEnvelope(persistenceScope, { redis: true })
        });
        await redis.expire(metaKey, this.bufferTtlSeconds);

        if (bufferLength >= this.chunkSize) {
            await this.flushTripChunks(point.tripId, {
                force: false,
                maxChunks: 1,
                reason: 'threshold',
                ...buildPersistenceEnvelope(persistenceScope)
            });
        }

        return {
            success: true,
            tripId: point.tripId,
            bufferedCount: bufferLength
        };
    }

    async resolveCanonicalTripMetrics(options = {}) {
        const tripId = String(options.tripId || options.bookingId || '').trim();
        const driverId = String(options.driverId || '').trim();
        if (!tripId || !driverId) {
            return {
                success: false,
                code: 'CANONICAL_TRIP_IDENTITY_REQUIRED'
            };
        }

        const redis = options.redis || await this.getRedis();
        const startedAtMs = normalizeTimestampMs(options.startedAt);
        const metadata = typeof redis?.hgetall === 'function'
            ? await redis.hgetall(this.getMetaKey(tripId))
            : {};
        const canonicalFirstLocation = normalizePointLocation({
            lat: metadata?.canonicalFirstLat,
            lng: metadata?.canonicalFirstLng
        });
        const canonicalLastLocation = normalizePointLocation({
            lat: metadata?.canonicalLastLat,
            lng: metadata?.canonicalLastLng
        });
        const canonicalFirstReceivedAt = normalizeTimestampMs(
            metadata?.canonicalFirstReceivedAt
        );
        const canonicalLastReceivedAt = normalizeTimestampMs(
            metadata?.canonicalLastReceivedAt
        );
        const canonicalDistanceKm = Number(metadata?.canonicalDistanceKm);
        const hasCanonicalMetadata = Boolean(
            String(metadata?.canonicalDriverId || '').trim() === driverId &&
            canonicalFirstLocation &&
            canonicalLastLocation &&
            canonicalFirstReceivedAt &&
            canonicalLastReceivedAt &&
            Number.isFinite(canonicalDistanceKm) &&
            (!startedAtMs || canonicalFirstReceivedAt >= startedAtMs)
        );

        if (hasCanonicalMetadata) {
            const startLocation = normalizePointLocation(options.startLocation);
            const startDistanceKm = startLocation
                ? haversineDistanceKm(startLocation, canonicalFirstLocation)
                : 0;
            const nowMs = normalizeTimestampMs(options.nowMs) || Date.now();
            const durationStartMs = startedAtMs || canonicalFirstReceivedAt;
            return {
                success: true,
                source: 'server_trip_location_telemetry',
                distanceKm: Number((startDistanceKm + canonicalDistanceKm).toFixed(3)),
                durationSecs: Math.max(0, Math.round((nowMs - durationStartMs) / 1000)),
                endLocation: canonicalLastLocation,
                startedAtMs: durationStartMs,
                lastReceivedAtMs: canonicalLastReceivedAt,
                pointsCount: Math.max(
                    1,
                    Number.parseInt(metadata?.canonicalPointsCount || '1', 10) || 1
                )
            };
        }

        const rawPoints = typeof redis?.lrange === 'function'
            ? await redis.lrange(this.getBufferKey(tripId), 0, -1)
            : [];
        const candidates = (rawPoints || []).map((raw) => {
            try {
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (_error) {
                return null;
            }
        }).filter(Boolean);

        const points = candidates
            .map((point) => {
                const location = normalizePointLocation(point);
                const receivedAt = normalizeTimestampMs(point.receivedAt);
                if (!location || !receivedAt) return null;
                if (String(point.driverId || '').trim() !== driverId) return null;
                if (startedAtMs && receivedAt < startedAtMs) return null;
                return {
                    ...location,
                    receivedAt,
                    seq: Number.isFinite(Number(point.seq)) ? Number(point.seq) : null
                };
            })
            .filter(Boolean)
            .sort((left, right) => left.receivedAt - right.receivedAt);

        const deduplicatedPoints = [];
        const seen = new Set();
        points.forEach((point) => {
            const key = [point.seq ?? '', point.receivedAt, point.lat, point.lng].join('|');
            if (seen.has(key)) return;
            seen.add(key);
            deduplicatedPoints.push(point);
        });

        if (deduplicatedPoints.length === 0) {
            return {
                success: false,
                code: 'CANONICAL_TRIP_TELEMETRY_UNAVAILABLE'
            };
        }

        const startLocation = normalizePointLocation(options.startLocation);
        const routePoints = startLocation
            ? [{ ...startLocation, receivedAt: startedAtMs || deduplicatedPoints[0].receivedAt }, ...deduplicatedPoints]
            : deduplicatedPoints;
        let distanceKm = 0;
        for (let index = 1; index < routePoints.length; index += 1) {
            distanceKm += haversineDistanceKm(routePoints[index - 1], routePoints[index]);
        }

        const nowMs = normalizeTimestampMs(options.nowMs) || Date.now();
        const durationStartMs = startedAtMs || deduplicatedPoints[0].receivedAt;
        const durationSecs = Math.max(0, Math.round((nowMs - durationStartMs) / 1000));
        const latestPoint = deduplicatedPoints[deduplicatedPoints.length - 1];

        return {
            success: true,
            source: 'server_trip_location_telemetry',
            distanceKm: Number(distanceKm.toFixed(3)),
            durationSecs,
            endLocation: {
                lat: latestPoint.lat,
                lng: latestPoint.lng
            },
            startedAtMs: durationStartMs,
            lastReceivedAtMs: latestPoint.receivedAt,
            pointsCount: deduplicatedPoints.length
        };
    }

    async flushTripChunks(tripId, options = {}) {
        const force = options.force === true;
        const reason = options.reason || 'periodic';
        const maxChunks = Number.isInteger(options.maxChunks) && options.maxChunks > 0
            ? options.maxChunks
            : this.flushMaxChunksPerTrip;

        const redis = await this.getRedis();
        const storedMetadata = typeof redis.hgetall === 'function'
            ? await redis.hgetall(this.getMetaKey(tripId))
            : {};
        const persistenceScope = resolveTripPersistenceScope(options, storedMetadata);
        const firestore = this.getFirestore();
        const lockKey = this.getFlushLockKey(tripId);
        const lockValue = `${process.pid}:${Date.now()}`;
        const lockAcquired = await redis.set(lockKey, lockValue, 'NX', 'EX', this.flushLockTtlSeconds);

        if (!lockAcquired) {
            return { success: true, flushedPoints: 0, skipped: true, reason: 'locked' };
        }

        let flushedPoints = 0;
        let flushedChunks = 0;

        try {
            while (flushedChunks < maxChunks) {
                const length = await redis.llen(this.getBufferKey(tripId));
                if (length <= 0) {
                    break;
                }

                const currentChunkSize = force ? Math.min(length, this.chunkSize) : Math.min(length, this.chunkSize);
                if (currentChunkSize <= 0) {
                    break;
                }

                const rawPoints = await redis.lrange(this.getBufferKey(tripId), 0, currentChunkSize - 1);
                const points = rawPoints
                    .map((raw) => {
                        try {
                            return JSON.parse(raw);
                        } catch (error) {
                            return null;
                        }
                    })
                    .filter(Boolean);

                if (points.length === 0) {
                    await redis.ltrim(this.getBufferKey(tripId), currentChunkSize, -1);
                    continue;
                }

                points.forEach((point) => {
                    assertScopeMatchesStoredEnvelope(
                        persistenceScope,
                        point,
                        'trip_location_buffer_point'
                    );
                });

                if (!firestore) {
                    return {
                        success: false,
                        flushedPoints,
                        flushedChunks,
                        reason: 'firestore_unavailable'
                    };
                }

                const chunkDoc = {
                    tripId,
                    driverId: points[0].driverId || null,
                    customerId: points[0].customerId || null,
                    points,
                    pointsCount: points.length,
                    firstSeq: points[0].seq || null,
                    lastSeq: points[points.length - 1].seq || null,
                    firstCapturedAt: points[0].capturedAt || null,
                    lastCapturedAt: points[points.length - 1].capturedAt || null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    expiresAt: this.buildRetentionTimestamp(points[points.length - 1].capturedAt),
                    source: 'trip-location-worker',
                    reason,
                    ...buildPersistenceEnvelope(persistenceScope)
                };

                await firestore
                    .collection(persistenceScope.collections.tripLocationChunks)
                    .add(chunkDoc);
                await redis.ltrim(this.getBufferKey(tripId), currentChunkSize, -1);
                await redis.hincrby(this.getMetaKey(tripId), 'persistedPoints', points.length);
                await redis.hset(this.getMetaKey(tripId), {
                    lastPersistedAt: String(Date.now())
                });

                flushedPoints += points.length;
                flushedChunks += 1;

                if (!force) {
                    break;
                }
            }

            return {
                success: true,
                tripId,
                flushedPoints,
                flushedChunks
            };
        } finally {
            const currentLockValue = await redis.get(lockKey);
            if (currentLockValue === lockValue) {
                await redis.del(lockKey);
            }
        }
    }

    async writeTripSummary(tripId, summaryData = {}) {
        const persistenceScope = resolveRidePersistenceScope(normalizeScopeInput(summaryData));
        const firestore = this.getFirestore();
        if (!firestore) {
            return { success: false, reason: 'firestore_unavailable' };
        }

        await firestore.collection(persistenceScope.collections.tripLocationSummaries).doc(String(tripId)).set({
            tripId: String(tripId),
            retentionDays: this.chunkRetentionDays,
            expiresAt: summaryData.expiresAt || this.buildRetentionTimestamp(Date.now()),
            ...summaryData,
            ...buildPersistenceEnvelope(persistenceScope),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return { success: true };
    }

    async forceFinalizeTrip(tripId, metadata = {}) {
        const persistenceScope = resolveRidePersistenceScope(normalizeScopeInput(metadata));
        const redis = await this.getRedis();
        let totalFlushedPoints = 0;
        let totalFlushedChunks = 0;

        while (true) {
            const length = await redis.llen(this.getBufferKey(tripId));
            if (length <= 0) {
                break;
            }

            const result = await this.flushTripChunks(tripId, {
                force: true,
                maxChunks: this.flushMaxChunksPerTrip,
                reason: metadata.reason || 'finalization',
                ...buildPersistenceEnvelope(persistenceScope)
            });

            if (!result.success) {
                return {
                    success: false,
                    tripId,
                    reason: result.reason || 'flush_failed',
                    totalFlushedPoints,
                    totalFlushedChunks
                };
            }

            totalFlushedPoints += result.flushedPoints || 0;
            totalFlushedChunks += result.flushedChunks || 0;

            if ((result.flushedPoints || 0) === 0) {
                break;
            }
        }

        const meta = await redis.hgetall(this.getMetaKey(tripId));
        assertScopeMatchesStoredEnvelope(persistenceScope, meta);
        const summary = {
            status: metadata.status || 'finalized',
            finalizeReason: metadata.reason || 'finalization',
            finalizedAt: Date.now(),
            flushedPointsInFinalization: totalFlushedPoints,
            flushedChunksInFinalization: totalFlushedChunks,
            persistedPoints: Number.parseInt(meta.persistedPoints || '0', 10),
            lastSeq: meta.lastSeq || null,
            lastCapturedAt: meta.lastCapturedAt ? Number(meta.lastCapturedAt) : null,
            retentionDays: this.chunkRetentionDays,
            expiresAt: this.buildRetentionTimestamp(meta.lastCapturedAt || Date.now()),
            ...buildPersistenceEnvelope(persistenceScope)
        };

        await this.writeTripSummary(tripId, summary);

        await redis.expire(this.getMetaKey(tripId), this.bufferTtlSeconds);
        await redis.expire(this.getBufferKey(tripId), 60);

        return {
            success: true,
            tripId,
            ...summary
        };
    }

    async flushPendingTrips(maxTrips = this.flushMaxTripsPerCycle) {
        const redis = await this.getRedis();
        const keys = await RedisScan.scanKeys(redis, 'trip_loc_buffer:*', 200);
        const selectedKeys = keys.slice(0, maxTrips);

        let processedTrips = 0;
        let flushedPoints = 0;
        let failures = 0;

        for (const key of selectedKeys) {
            const tripId = key.replace('trip_loc_buffer:', '');
            if (!tripId) {
                continue;
            }
            processedTrips += 1;
            try {
                const result = await this.flushTripChunks(tripId, {
                    force: false,
                    maxChunks: 1,
                    reason: 'periodic'
                });
                if (!result.success) {
                    failures += 1;
                    continue;
                }
                flushedPoints += result.flushedPoints || 0;
            } catch (error) {
                failures += 1;
                logError(error, 'Falha ao flush periódico de trip location', {
                    service: 'trip-location-persistence',
                    tripId
                });
            }
        }

        return {
            success: true,
            processedTrips,
            flushedPoints,
            failures
        };
    }
}

const tripLocationPersistenceService = new TripLocationPersistenceService();
module.exports = tripLocationPersistenceService;
