const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const { randomUUID } = require('node:crypto');
const { digest, APPEND_BUFFER, CLAIM_TRIPS, CLAIM_CHUNK, ACK_CHUNK, REQUEST_FINALIZATION, FINISH_FINALIZATION } = require('../utils/trip-location-buffer-ops');
const { logStructured, logError } = require('../utils/logger');
const {
    SandboxPersistenceContextError,
    resolveRidePersistenceScope
} = require('./sandbox-persistence-context');

const { findCrossedTolls, mergeTollCrossings } = require('./route-toll-service');
const safetySignalService = require('./safety-signal-service');

const EARTH_RADIUS_KM = 6371;
// Valor gravado quando a detecção de praça falha: a corrida fica sem
// travessias verificadas em vez de parecer que não cruzou nenhuma.
const TOLL_CROSSINGS_UNTRACKED = 'untracked';
const SAFETY_JUMP_MIN_KM = Number(process.env.SAFETY_JUMP_MIN_KM || 0.5);
const SAFETY_JUMP_MAX_KMH = Number(process.env.SAFETY_JUMP_MAX_KMH || 180);
const SAFETY_JUMP_MAX_ACCURACY_M = Number(process.env.SAFETY_JUMP_MAX_ACCURACY_M || 200);

function parseTollCrossings(raw) {
    if (raw === undefined || raw === null || raw === '' || raw === TOLL_CROSSINGS_UNTRACKED) {
        return null;
    }
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : null;
    } catch (_error) {
        return null;
    }
}

function detectTollCrossings(from, to, at) {
    return findCrossedTolls([from, to]).map((toll) => ({
        id: toll.id,
        amount: toll.amount,
        at
    }));
}

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

const DEFAULT_WORKER_HEALTH_KEY = 'leaf:runtime:trip-location-worker:health';
const DEFAULT_WORKER_HEALTH_TTL_SECONDS = 90;
const WORKER_HEALTH_STATUSES = new Set(['healthy', 'idle', 'degraded']);
const BUFFER_KEY_PREFIX = 'trip_loc_buffer:';
const DEFAULT_BUFFER_INDEX_KEY = 'trip_loc_buffer_index';
const DEFAULT_BUFFER_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

class TripLocationPersistenceService {
    constructor() {
        this.chunkSize = Math.min(100, Math.max(1, Number.parseInt(process.env.TRIP_LOCATION_CHUNK_SIZE || '30', 10) || 30));
        this.bufferTtlSeconds = Number.parseInt(process.env.TRIP_LOCATION_BUFFER_TTL_SECONDS || String(24 * 60 * 60), 10);
        this.workerIdempotencyTtlSeconds = Number.parseInt(process.env.TRIP_LOCATION_WORKER_IDEMPOTENCY_TTL_SECONDS || String(24 * 60 * 60), 10);
        this.flushLockTtlSeconds = Number.parseInt(process.env.TRIP_LOCATION_FLUSH_LOCK_TTL_SECONDS || '15', 10);
        this.flushMaxTripsPerCycle = Number.parseInt(process.env.TRIP_LOCATION_FLUSH_MAX_TRIPS_PER_CYCLE || '200', 10);
        this.flushMaxChunksPerTrip = Number.parseInt(process.env.TRIP_LOCATION_FLUSH_MAX_CHUNKS_PER_TRIP || '4', 10);
        this.chunkRetentionDays = Number.parseInt(process.env.TRIP_LOCATION_CHUNK_RETENTION_DAYS || '30', 10);
        this.chunkRetentionMs = this.chunkRetentionDays * 24 * 60 * 60 * 1000;
        this.enableFirestorePersistence = process.env.ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE !== 'false';
        this.workerHealthKey = String(
            process.env.TRIP_LOCATION_WORKER_HEALTH_KEY || DEFAULT_WORKER_HEALTH_KEY
        ).trim() || DEFAULT_WORKER_HEALTH_KEY;
        this.workerHealthTtlSeconds = Math.max(
            30,
            Number.parseInt(
                process.env.TRIP_LOCATION_WORKER_HEALTH_TTL_SECONDS
                    || String(DEFAULT_WORKER_HEALTH_TTL_SECONDS),
                10
            ) || DEFAULT_WORKER_HEALTH_TTL_SECONDS
        );
        // Index of trips with buffered points, so the periodic flush avoids a keyspace SCAN.
        // Kept outside the trip_loc_buffer:* namespace so the reconcile SCAN never matches it.
        this.bufferIndexKey = String(
            process.env.TRIP_LOCATION_BUFFER_INDEX_KEY || DEFAULT_BUFFER_INDEX_KEY
        ).trim() || DEFAULT_BUFFER_INDEX_KEY;
        this.bufferReconcileIntervalMs = Math.max(
            15000,
            Number.parseInt(
                process.env.TRIP_LOCATION_BUFFER_RECONCILE_INTERVAL_MS
                    || String(DEFAULT_BUFFER_RECONCILE_INTERVAL_MS),
                10
            ) || DEFAULT_BUFFER_RECONCILE_INTERVAL_MS
        );
        this.lastBufferReconcileAt = 0;
        this.bufferQueueKey = `${this.bufferIndexKey}:due:v2`;
        this.reconcileCursor = '0';
        this.flushInProgress = false;
        this.activeFlushes = 0;
        this.flushCycleBudgetMs = 10000;
        this.periodicFlushMs = Math.max(1000, Number(process.env.TRIP_LOCATION_PERIODIC_FLUSH_MS) || 15000);
        this.maxChunkBytes = 512 * 1024;
        this.maxTelemetryRecoveryPoints = 2000;
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

    async publishWorkerHealth(status, counters = {}, redisClient = null) {
        const normalizedStatus = String(status || '').trim().toLowerCase();
        if (!WORKER_HEALTH_STATUSES.has(normalizedStatus)) {
            throw new Error('Status de saúde inválido para trip-location-worker');
        }

        const redis = redisClient || await this.getRedis();
        const payload = {
            status: normalizedStatus,
            heartbeatAt: String(Date.now()),
            processedTrips: String(Math.max(0, Number(counters.processedTrips) || 0)),
            flushedPoints: String(Math.max(0, Number(counters.flushedPoints) || 0)),
            failures: String(Math.max(0, Number(counters.failures) || 0))
        };

        if (typeof redis.zcard === 'function') payload.pendingTrips = String(await redis.zcard(this.bufferQueueKey));
        await redis.hset(this.workerHealthKey, payload);
        await redis.expire(this.workerHealthKey, this.workerHealthTtlSeconds);

        return payload;
    }

    async tryMarkWorkerDegraded(counters = {}, redisClient = null) {
        try {
            await this.publishWorkerHealth('degraded', {
                ...counters,
                failures: Math.max(1, Number(counters.failures) || 0)
            }, redisClient);
            return true;
        } catch (healthError) {
            logStructured('warn', 'Não foi possível publicar saúde degradada do trip-location-worker', {
                service: 'trip-location-persistence',
                operation: 'worker-health-heartbeat',
                errorCode: /^[A-Z0-9_-]{1,64}$/.test(String(healthError?.code || ''))
                    ? String(healthError.code)
                    : null
            });
            return false;
        }
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
        const seq = eventData.seq != null && Number.isInteger(Number(eventData.seq)) ? Number(eventData.seq) : null;
        const capturedAt = Number.isFinite(Number(eventData.capturedAt))
            ? Number(eventData.capturedAt)
            : Date.now();

        if (!tripId || !driverId || tripId.length > 256 || driverId.length > 256 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
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
            accuracy: eventData.accuracy != null && Number.isFinite(Number(eventData.accuracy)) ? Number(eventData.accuracy) : null,
            heading: eventData.heading != null && Number.isFinite(Number(eventData.heading)) ? Number(eventData.heading) : null,
            speed: eventData.speed != null && Number.isFinite(Number(eventData.speed)) ? Number(eventData.speed) : null,
            orderStatus: eventData.orderStatus ? String(eventData.orderStatus) : null,
            outOfOrderWindow: eventData.outOfOrderWindow != null && Number.isInteger(Number(eventData.outOfOrderWindow))
                ? Number(eventData.outOfOrderWindow)
                : null,
            lastAcceptedSeq: eventData.lastAcceptedSeq != null && Number.isInteger(Number(eventData.lastAcceptedSeq))
                ? Number(eventData.lastAcceptedSeq)
                : null,
            ...buildPersistenceEnvelope(persistenceScope)
        };
    }

    async bufferLocationEvent(eventData = {}, attempt = 0) {
        const point = this.normalizeLocationEvent(eventData);
        const persistenceScope = resolveRidePersistenceScope(point);
        const redis = await this.getRedis();
        const bufferKey = this.getBufferKey(point.tripId);
        const metaKey = this.getMetaKey(point.tripId);
        const previousMeta = typeof redis.hgetall === 'function'
            ? await redis.hgetall(metaKey)
            : {};
        assertScopeMatchesStoredEnvelope(persistenceScope, previousMeta);

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

        // Praças cruzadas acompanham a mesma cadeia da distância canônica. Uma
        // cadeia que começou antes deste registro existir fica sem o campo e o
        // encerramento antecipado trata o pedágio como não verificado.
        const previousTollCrossings = parseTollCrossings(previousMeta?.canonicalTollCrossings);
        let tollCrossingsValue = null;
        try {
            if (isStaleCanonicalPoint) {
                tollCrossingsValue = previousTollCrossings ? JSON.stringify(previousTollCrossings) : null;
            } else if (canAppendCanonicalMetric) {
                tollCrossingsValue = previousTollCrossings
                    ? JSON.stringify(mergeTollCrossings(
                        previousTollCrossings,
                        detectTollCrossings(previousLocation, point, point.receivedAt)
                    ))
                    : null;
            } else {
                tollCrossingsValue = '[]';
            }
        } catch (_tollError) {
            tollCrossingsValue = TOLL_CROSSINGS_UNTRACKED;
        }

        const canonicalLastCapturedAt = isStaleCanonicalPoint
            ? normalizeTimestampMs(previousMeta?.canonicalLastCapturedAt)
            : point.capturedAt;
        if (canAppendCanonicalMetric) {
            this.checkLocationJump(point, previousLocation, previousMeta);
        }

        const patch = {
            tripId: point.tripId,
            driverId: point.driverId,
            customerId: point.customerId || '',
            lastSeq: point.seq !== null ? String(point.seq) : '',
            lastCapturedAt: String(point.capturedAt),
            lastBufferedAt: String(Date.now()),
            canonicalDriverId: point.driverId,
            canonicalDistanceKm: canonicalDistanceKm.toFixed(6),
            canonicalPointsCount: String(canonicalPointsCount),
            canonicalFirstLat: String(canonicalFirstLocation.lat),
            canonicalFirstLng: String(canonicalFirstLocation.lng),
            canonicalFirstReceivedAt: String(canonicalFirstReceivedAt),
            canonicalLastLat: String(canonicalLastLocation.lat),
            canonicalLastLng: String(canonicalLastLocation.lng),
            canonicalLastReceivedAt: String(canonicalLastReceivedAt),
            ...(canonicalLastCapturedAt ? { canonicalLastCapturedAt: String(canonicalLastCapturedAt) } : {}),
            ...(tollCrossingsValue !== null ? { canonicalTollCrossings: tollCrossingsValue } : {}),
            ...buildPersistenceEnvelope(persistenceScope, { redis: true })
        };
        const rawPoint = JSON.stringify(point);
        if (Buffer.byteLength(rawPoint) > 16 * 1024) throw new Error('Location point exceeds byte budget');
        const result = await redis.eval(APPEND_BUFFER, 5, bufferKey, metaKey,
            `trip_loc_worker_dedup:${point.tripId}:${digest(rawPoint)}`,
            this.bufferIndexKey, this.bufferQueueKey, previousMeta?.bufferVersion || '0',
            rawPoint, JSON.stringify(patch), point.tripId, String(Date.now()), String(this.workerIdempotencyTtlSeconds),
            String(this.periodicFlushMs), String(Math.min(100, Math.max(1, this.chunkSize))));
        if (Number(result[0]) === 0) return { success: true, duplicate: true, tripId: point.tripId };
        if (Number(result[0]) === -1) {
            if (attempt >= 3) throw new Error('Concurrent location update; retry stream event');
            return this.bufferLocationEvent(point, attempt + 1);
        }
        const bufferLength = Number(result[1]);
        // Firestore flush runs only in the existing periodic/finalization path.
        // Stream ingestion never waits for external storage.

        return {
            success: true,
            tripId: point.tripId,
            bufferedCount: bufferLength
        };
    }

    // Salto impossível entre dois pontos seguidos da mesma corrida: distância e velocidade
    // calculadas pelo horário de captura no aparelho, para que pontos reenviados em lote
    // depois de uma queda de sinal não pareçam teletransporte. Ponto impreciso não conta;
    // corrida de teste fica registrada sem avisar. Só registra e avisa o bot de Segurança.
    checkLocationJump(point, previousLocation, previousMeta = {}) {
        try {
            const previousCapturedAt = normalizeTimestampMs(previousMeta?.canonicalLastCapturedAt);
            if (!previousCapturedAt) return null;
            if (point.accuracy !== null && point.accuracy > SAFETY_JUMP_MAX_ACCURACY_M) return null;
            const elapsedSeconds = (point.capturedAt - previousCapturedAt) / 1000;
            if (!(elapsedSeconds > 0)) return null;
            const distanceKm = haversineDistanceKm(previousLocation, point);
            const speedKmh = distanceKm / (elapsedSeconds / 3600);
            if (distanceKm < SAFETY_JUMP_MIN_KM || speedKmh <= SAFETY_JUMP_MAX_KMH) return null;
            safetySignalService.record({
                type: 'location_jump',
                driverId: point.driverId,
                bookingId: point.tripId,
                reason: `Salto de ${distanceKm.toFixed(1)} km em ${Math.round(elapsedSeconds)} s na corrida`,
                score: Math.round(speedKmh),
                details: {
                    distanceKm: Number(distanceKm.toFixed(3)),
                    elapsedSeconds: Math.round(elapsedSeconds),
                    speedKmh: Math.round(speedKmh),
                    accuracy: point.accuracy
                },
                sandbox: point.testUserSandbox === true || point.financialNamespace === 'sandbox',
                dedupeKey: point.tripId
            });
            return { distanceKm, speedKmh };
        } catch (_error) {
            return null;
        }
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
            const storedTollCrossings = parseTollCrossings(metadata?.canonicalTollCrossings);
            let tollCrossings = storedTollCrossings;
            if (storedTollCrossings && startLocation) {
                try {
                    tollCrossings = mergeTollCrossings(
                        detectTollCrossings(startLocation, canonicalFirstLocation, canonicalFirstReceivedAt),
                        storedTollCrossings
                    );
                } catch (_tollError) {
                    tollCrossings = null;
                }
            }
            return {
                success: true,
                source: 'server_trip_location_telemetry',
                tollCrossings: tollCrossings || [],
                tollCrossingsTracked: Boolean(tollCrossings),
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

        // A trilha pode começar antes do início da viagem (motorista ainda a caminho do
        // embarque). A distância acumulada mistura esse trecho e não serve, mas a última
        // posição recebida depois do início continua confiável. Quem pede
        // `allowPreStartTelemetry` recebe essa posição e a distância em linha reta desde
        // o início; sem isso o encerramento longe do destino ficava sem posição e a
        // corrida era cobrada inteira.
        const hasPreStartCanonicalMetadata = Boolean(
            options.allowPreStartTelemetry === true &&
            startedAtMs &&
            String(metadata?.canonicalDriverId || '').trim() === driverId &&
            canonicalLastLocation &&
            canonicalFirstReceivedAt &&
            canonicalLastReceivedAt &&
            canonicalFirstReceivedAt < startedAtMs &&
            canonicalLastReceivedAt >= startedAtMs
        );
        if (hasPreStartCanonicalMetadata) {
            const startLocation = normalizePointLocation(options.startLocation);
            const nowMs = normalizeTimestampMs(options.nowMs) || Date.now();
            const storedTollCrossings = parseTollCrossings(metadata?.canonicalTollCrossings);
            return {
                success: true,
                source: 'server_trip_location_last_point',
                // A cadeia começou antes do início: só contam as travessias depois dele.
                tollCrossings: (storedTollCrossings || []).filter(
                    (crossing) => Number(crossing.at) >= startedAtMs
                ),
                tollCrossingsTracked: Boolean(storedTollCrossings),
                distanceKm: startLocation
                    ? Number(haversineDistanceKm(startLocation, canonicalLastLocation).toFixed(3))
                    : 0,
                durationSecs: Math.max(0, Math.round((nowMs - startedAtMs) / 1000)),
                endLocation: canonicalLastLocation,
                startedAtMs,
                lastReceivedAtMs: canonicalLastReceivedAt,
                pointsCount: 1
            };
        }

        if (typeof redis?.llen === 'function' && await redis.llen(this.getBufferKey(tripId)) > this.maxTelemetryRecoveryPoints) {
            return { success: false, reason: 'canonical_telemetry_recovery_budget_exceeded' };
        }
        const rawPoints = typeof redis?.lrange === 'function'
            ? await redis.lrange(this.getBufferKey(tripId), 0, this.maxTelemetryRecoveryPoints)
            : [];
        if (rawPoints.length > this.maxTelemetryRecoveryPoints) {
            return { success: false, reason: 'canonical_telemetry_recovery_budget_exceeded' };
        }
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

        let tollCrossings = null;
        try {
            tollCrossings = findCrossedTolls(routePoints).map((toll) => ({
                id: toll.id,
                amount: toll.amount,
                at: null
            }));
        } catch (_tollError) {
            tollCrossings = null;
        }

        return {
            success: true,
            source: 'server_trip_location_telemetry',
            tollCrossings: tollCrossings || [],
            tollCrossingsTracked: Boolean(tollCrossings),
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
        if (this.activeFlushes >= 4) return { success: false, pending: true, reason: 'flush_capacity' };
        this.activeFlushes++;
        try { return await this.flushTripChunksWithinBudget(tripId, options); }
        finally { this.activeFlushes--; }
    }

    async flushTripChunksWithinBudget(tripId, options = {}) {
        const maxChunks = Math.min(4, Math.max(1, Number(options.maxChunks) || this.flushMaxChunksPerTrip));
        const redis = await this.getRedis();
        const storedMetadata = await redis.hgetall(this.getMetaKey(tripId));
        const scope = resolveTripPersistenceScope(options, storedMetadata || {});
        const firestore = this.getFirestore();
        if (!firestore) return { success: false, flushedPoints: 0, reason: 'firestore_unavailable' };
        const lockKey = this.getFlushLockKey(tripId);
        const lockValue = randomUUID();
        const claimKey = `trip_loc_chunk_claim:${tripId}`;
        if (!await redis.set(lockKey, lockValue, 'NX', 'EX', this.flushLockTtlSeconds)) {
            return { success: true, flushedPoints: 0, skipped: true, reason: 'locked' };
        }
        let flushedPoints = 0;
        let flushedChunks = 0;
        const startedAt = Date.now();
        try {
            while (flushedChunks < maxChunks && Date.now() - startedAt < this.flushCycleBudgetMs) {
                let manifest = await redis.get(claimKey);
                if (!manifest) {
                    const raw = await redis.lrange(this.getBufferKey(tripId), 0, Math.min(100, this.chunkSize) - 1);
                    if (!raw.length) break;
                    const selected = [];
                    let bytes = 0;
                    for (const point of raw) {
                        const size = Buffer.byteLength(point);
                        if (size > this.maxChunkBytes) throw new Error('Single buffered point exceeds chunk budget');
                        if (bytes + size > this.maxChunkBytes) break;
                        selected.push(point); bytes += size;
                    }
                    manifest = await redis.eval(CLAIM_CHUNK, 2, lockKey, claimKey, lockValue,
                        JSON.stringify({ count: selected.length, digest: digest(JSON.stringify(selected)) }));
                    if (!manifest) return { success: false, reason: 'lock_lost', flushedPoints, flushedChunks };
                }
                const claim = JSON.parse(manifest);
                if (!Number.isInteger(claim.count) || claim.count < 1 || claim.count > 100) throw new Error('Invalid chunk claim');
                const rawPoints = await redis.lrange(this.getBufferKey(tripId), 0, claim.count - 1);
                if (digest(JSON.stringify(rawPoints)) !== claim.digest) throw new Error('Chunk prefix changed before persistence');
                const points = rawPoints.map(raw => JSON.parse(raw));
                points.forEach(point => assertScopeMatchesStoredEnvelope(scope, point, 'trip_location_buffer_point'));
                const chunkDoc = {
                    tripId, driverId: points[0].driverId || null, customerId: points[0].customerId || null,
                    points, pointsCount: points.length, chunkDigest: claim.digest,
                    firstSeq: points[0].seq ?? null, lastSeq: points[points.length - 1].seq ?? null,
                    firstCapturedAt: points[0].capturedAt || null,
                    lastCapturedAt: points[points.length - 1].capturedAt || null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    expiresAt: this.buildRetentionTimestamp(points[points.length - 1].capturedAt),
                    source: 'trip-location-worker', reason: options.reason || 'periodic',
                    ...buildPersistenceEnvelope(scope)
                };
                const ref = firestore.collection(scope.collections.tripLocationChunks)
                    .doc(`v2_${digest(String(tripId)).slice(0, 24)}_${claim.digest}`);
                try {
                    await ref.create(chunkDoc);
                } catch (error) {
                    if (error.code !== 6 && error.code !== 'already-exists') throw error;
                    const existing = await ref.get();
                    if (!existing.exists || existing.data().chunkDigest !== claim.digest) throw error;
                }
                const acknowledged = Number(await redis.eval(ACK_CHUNK, 6, lockKey, claimKey,
                    this.getBufferKey(tripId), this.getMetaKey(tripId), this.bufferQueueKey, this.bufferIndexKey,
                    lockValue, manifest, JSON.stringify(rawPoints), String(Date.now()), String(tripId), String(this.bufferTtlSeconds)));
                if (acknowledged !== points.length) {
                    return { success: false, reason: 'chunk_ack_conflict', flushedPoints, flushedChunks };
                }
                flushedPoints += acknowledged;
                flushedChunks++;
                if (!options.force) break;
            }
            return { success: true, tripId, flushedPoints, flushedChunks };
        } finally {
            await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, lockKey, lockValue);
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
        const redis = await this.getRedis();
        const persistenceScope = resolveTripPersistenceScope(metadata, await redis.hgetall(this.getMetaKey(tripId)) || {});
        let totalFlushedPoints = 0;
        let totalFlushedChunks = 0;

        const finalizationConfig = JSON.stringify({ ...metadata, ...buildPersistenceEnvelope(persistenceScope) });
        await redis.eval(REQUEST_FINALIZATION, 2, this.getMetaKey(tripId), this.bufferQueueKey,
            finalizationConfig, String(Date.now()), String(tripId));
        const result = await this.flushTripChunks(tripId, {
            force: true, maxChunks: this.flushMaxChunksPerTrip,
            reason: metadata.reason || 'finalization', ...buildPersistenceEnvelope(persistenceScope)
        });
        totalFlushedPoints = result.flushedPoints || 0;
        totalFlushedChunks = result.flushedChunks || 0;
        const remaining = await redis.llen(this.getBufferKey(tripId));
        if (!result.success || remaining > 0) {
            await redis.zadd(this.bufferQueueKey, 'NX', Date.now(), String(tripId));
            return { success: false, pending: true, tripId, reason: result.reason || 'finalization_pending',
                totalFlushedPoints, totalFlushedChunks };
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

        const written = await this.writeTripSummary(tripId, summary);
        if (!written.success) {
            await redis.zadd(this.bufferQueueKey, 'NX', Date.now(), String(tripId));
            return { success: false, pending: true, reason: written.reason };
        }

        const finished = Number(await redis.eval(FINISH_FINALIZATION, 4, this.getMetaKey(tripId), this.bufferQueueKey,
            this.bufferIndexKey, this.getBufferKey(tripId), meta.bufferVersion || '0', String(tripId),
            String(this.bufferTtlSeconds), String(Date.now())));
        if (!finished) return { success: false, pending: true, reason: 'late_points_during_summary' };

        return {
            success: true,
            tripId,
            ...summary
        };
    }

    async listBufferedTripIds(redis, maxTrips = this.flushMaxTripsPerCycle) {
        // Incremental migration/reconciliation only. Never collect a complete
        // keyspace or set. COUNT is a hint: reject oversized pages explicitly.
        const now = Date.now();
        if (this.reconcileCursor !== '0' || this.keyReconcileCursor || now - this.lastBufferReconcileAt >= this.bufferReconcileIntervalMs) {
            const [cursor, ids] = await redis.sscan(this.bufferIndexKey, this.reconcileCursor, 'COUNT', 100);
            if (ids.length > 1000) throw new Error('Legacy buffer index page exceeds migration budget');
            this.reconcileCursor = cursor;
            for (const id of ids) await redis.zadd(this.bufferQueueKey, 'NX', now, id);
            const [keyCursor, keys] = await redis.scan(this.keyReconcileCursor || '0', 'MATCH', `${BUFFER_KEY_PREFIX}*`, 'COUNT', 100);
            if (keys.length > 1000) throw new Error('Legacy buffer key page exceeds migration budget');
            this.keyReconcileCursor = keyCursor === '0' ? null : keyCursor;
            for (const key of keys) await redis.zadd(this.bufferQueueKey, 'NX', now, key.slice(BUFFER_KEY_PREFIX.length));
            this.lastBufferReconcileAt = now;
        }
        return redis.eval(CLAIM_TRIPS, 1, this.bufferQueueKey, String(now),
            String(Math.min(200, Math.max(1, Number(maxTrips) || 1))), String(now + this.flushLockTtlSeconds * 1000));
    }

    async flushPendingTrips(maxTrips = this.flushMaxTripsPerCycle) {
        if (this.flushInProgress) return { success: true, skipped: true, reason: 'cycle_running' };
        this.flushInProgress = true;
        const cycleStartedAt = Date.now();
        let redis = null;
        let processedTrips = 0;
        let flushedPoints = 0;
        let failures = 0;

        try {
            redis = await this.getRedis();

            if (this.enableFirestorePersistence && !this.getFirestore()) {
                failures = 1;
                const result = {
                    success: false,
                    processedTrips,
                    flushedPoints,
                    failures,
                    reason: 'firestore_unavailable'
                };

                await this.publishWorkerHealth('degraded', result, redis);
                return result;
            }

            const tripIds = await this.listBufferedTripIds(redis, maxTrips);
            const selectedTripIds = tripIds;

            let nextTrip = 0;
            const processTrips = async () => {
              while (nextTrip < selectedTripIds.length && Date.now() - cycleStartedAt < this.flushCycleBudgetMs) {
                const tripId = selectedTripIds[nextTrip++];
                // Legacy buffers may have expired; never trim an unpersisted live buffer.
                const length = await redis.llen(this.getBufferKey(tripId));
                if (length <= 0) {
                    await redis.srem(this.bufferIndexKey, tripId);
                    await redis.zrem(this.bufferQueueKey, tripId);
                    const meta = await redis.hgetall(this.getMetaKey(tripId));
                    if (meta?.finalizationRequested) await this.forceFinalizeTrip(tripId, JSON.parse(meta.finalizationRequested));
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
                    const meta = await redis.hgetall(this.getMetaKey(tripId));
                    if (meta?.finalizationRequested) await this.forceFinalizeTrip(tripId, JSON.parse(meta.finalizationRequested));
                } catch (error) {
                    failures += 1;
                    logError(error, 'Falha ao flush periódico de trip location', {
                        service: 'trip-location-persistence',
                        tripId
                    });
                } finally {
                    const remaining = await redis.llen(this.getBufferKey(tripId));
                    if (remaining > 0) {
                        const meta = await redis.hgetall(this.getMetaKey(tripId));
                        const delay = failures > 0 ? this.periodicFlushMs
                            : remaining >= this.chunkSize || meta?.finalizationRequested ? 0 : this.periodicFlushMs;
                        await redis.zadd(this.bufferQueueKey, Date.now() + delay, tripId);
                    }
                }
              }
            };
            const workers = await Promise.allSettled(Array.from({ length: 4 }, () => processTrips()));
            const rejected = workers.find(worker => worker.status === 'rejected');
            if (rejected) throw rejected.reason;

            const success = failures === 0;
            const status = success
                ? (processedTrips === 0 ? 'idle' : 'healthy')
                : 'degraded';
            const result = {
                success,
                processedTrips,
                flushedPoints,
                failures
            };

            await this.publishWorkerHealth(status, result, redis);
            return result;
        } catch (error) {
            await this.tryMarkWorkerDegraded({
                processedTrips,
                flushedPoints,
                failures
            }, redis);
            throw error;
        } finally {
            this.flushInProgress = false;
        }
    }
}

const tripLocationPersistenceService = new TripLocationPersistenceService();
module.exports = tripLocationPersistenceService;
