const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const RedisScan = require('../utils/redis-scan');
const { logStructured, logError } = require('../utils/logger');

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
                : null
        };
    }

    async bufferLocationEvent(eventData = {}) {
        const point = this.normalizeLocationEvent(eventData);
        const redis = await this.getRedis();

        if (point.seq !== null) {
            const workerDedupKey = this.getWorkerDedupKey(point.tripId, point.driverId, point.seq, point.capturedAt);
            const dedupResult = await redis.set(workerDedupKey, '1', 'NX', 'EX', this.workerIdempotencyTtlSeconds);
            if (!dedupResult) {
                return { success: true, duplicate: true, tripId: point.tripId };
            }
        }

        const bufferKey = this.getBufferKey(point.tripId);
        const metaKey = this.getMetaKey(point.tripId);
        const bufferLength = await redis.rpush(bufferKey, JSON.stringify(point));

        await redis.expire(bufferKey, this.bufferTtlSeconds);
        await redis.hset(metaKey, {
            tripId: point.tripId,
            driverId: point.driverId,
            customerId: point.customerId || '',
            lastSeq: point.seq !== null ? String(point.seq) : '',
            lastCapturedAt: String(point.capturedAt),
            lastBufferedAt: String(Date.now()),
            bufferedCount: String(bufferLength)
        });
        await redis.expire(metaKey, this.bufferTtlSeconds);

        if (bufferLength >= this.chunkSize) {
            await this.flushTripChunks(point.tripId, {
                force: false,
                maxChunks: 1,
                reason: 'threshold'
            });
        }

        return {
            success: true,
            tripId: point.tripId,
            bufferedCount: bufferLength
        };
    }

    async flushTripChunks(tripId, options = {}) {
        const force = options.force === true;
        const reason = options.reason || 'periodic';
        const maxChunks = Number.isInteger(options.maxChunks) && options.maxChunks > 0
            ? options.maxChunks
            : this.flushMaxChunksPerTrip;

        const redis = await this.getRedis();
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
                    reason
                };

                await firestore.collection('trip_location_chunks').add(chunkDoc);
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
        const firestore = this.getFirestore();
        if (!firestore) {
            return { success: false, reason: 'firestore_unavailable' };
        }

        await firestore.collection('trip_location_summaries').doc(String(tripId)).set({
            tripId: String(tripId),
            retentionDays: this.chunkRetentionDays,
            expiresAt: summaryData.expiresAt || this.buildRetentionTimestamp(Date.now()),
            ...summaryData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return { success: true };
    }

    async forceFinalizeTrip(tripId, metadata = {}) {
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
                reason: metadata.reason || 'finalization'
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
            expiresAt: this.buildRetentionTimestamp(meta.lastCapturedAt || Date.now())
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
