/**
 * DRIVER NOTIFICATION DISPATCHER
 * 
 * Responsável por buscar motoristas, calcular scores e enviar notificações
 * via WebSocket com locks para prevenir duplicatas.
 * 
 * Algoritmo de Score:
 * - Distância: 100% (Conforme solicitado - foco em proximidade)
 */

const redisPool = require('../utils/redis-pool');
const driverLockManager = require('./driver-lock-manager');
const eventSourcing = require('./event-sourcing');
const { EVENT_TYPES } = require('./event-sourcing');
const { logger, logStructured, logError } = require('../utils/logger');
const { performance } = require('perf_hooks');
const PaymentService = require('./payment-service');
const { resolveEstimatedFareSnapshot } = require('../utils/fare-snapshot-utils');
const {
    reserveOffer,
    clearOfferReservation
} = require('./offer-reservation-service');
const {
    beginDispatchWave,
    recordDispatchWave,
    recordDispatchDirectNotification
} = require('./dispatch-wave-trace-service');
const { getDriverResponseTimeoutSeconds } = require('../utils/dispatch-config');
const {
    driverMatchesRidePreferences,
    hasRideDispatchPreferences
} = require('./ride-dispatch-preference-service');
const driverEligibilityService = require('./driver-eligibility-service');
const {
    getDriverPaymentReservation,
    reservationMatchesContext
} = require('./payment-driver-reservation-service');

const DISPATCHABLE_SEARCH_STATES = new Set([
    'PENDING',
    'SEARCHING',
    'EXPANDED',
    'NOTIFIED',
    'AWAITING_RESPONSE',
    'REJECTED',
    'REASSIGNMENT_PENDING'
]);
const TERMINAL_LOCK_BOOKING_STATES = new Set([
    'COMPLETED',
    'CANCELED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED',
    'NO_DRIVERS_AVAILABLE',
    'NO_DRIVERS_FOUND',
    'EARLY_ENDED_BY_RIDER',
    'INTERRUPTED_OPERATIONAL_ENDED',
    'EARLY_ENDED_REVIEW'
]);
const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
const ALL_DRIVER_GEO_KEY = process.env.ALL_DRIVER_GEO_KEY || 'driver_locations';
const STRICT_ELIGIBLE_DRIVER_POOL = process.env.STRICT_ELIGIBLE_DRIVER_POOL !== 'false';
const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const incrementCounter = (target, key) => {
    if (!target || typeof target !== 'object') {
        return;
    }
    const normalizedKey = String(key || 'UNKNOWN').trim() || 'UNKNOWN';
    target[normalizedKey] = Number.parseInt(target[normalizedKey] || 0, 10) + 1;
};
const DISPATCH_GEO_CANDIDATE_MIN = parsePositiveInt(process.env.DISPATCH_GEO_CANDIDATE_MIN, 200);
const DISPATCH_GEO_CANDIDATE_MAX = parsePositiveInt(process.env.DISPATCH_GEO_CANDIDATE_MAX, 800);
const DISPATCH_SCORE_POOL_MIN = parsePositiveInt(process.env.DISPATCH_SCORE_POOL_MIN, 48);
const DISPATCH_SCORE_POOL_MAX = parsePositiveInt(process.env.DISPATCH_SCORE_POOL_MAX, 200);
const DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS = getDriverResponseTimeoutSeconds();
const DRIVER_REOFFER_MAX_REJECTIONS = parsePositiveInt(
    process.env.DRIVER_REOFFER_MAX_REJECTIONS,
    2
);
const DISPATCH_NOTIFY_CONCURRENCY = parsePositiveInt(process.env.DISPATCH_NOTIFY_CONCURRENCY, 4);
const DISPATCH_DRIVER_LIVENESS_GRACE_MS = parsePositiveInt(
    process.env.DISPATCH_DRIVER_LIVENESS_GRACE_MS,
    45000
);
const DISPATCH_VERIFY_SOCKET_ROOM = process.env.DISPATCH_VERIFY_SOCKET_ROOM === 'true';
const globalTimeoutHandlers = new Map();

class DriverNotificationDispatcher {
    constructor(redis, io) {
        this.redis = redis || redisPool.getConnection();
        this.io = io;
        // Compartilhar timeouts entre instancias evita timeout "fantasma"
        // quando o agendamento nasce no expander e a resposta chega pelo response-handler.
        this.timeoutHandlers = globalTimeoutHandlers; // bookingId_driverId -> timeoutId
        this.paymentService = new PaymentService();

        // Configurações de score (Foco 100% em distância conforme solicitado)
        this.scoreWeights = {
            distance: 1.0,    // 100%
            rating: 0.0,      // 0%
            acceptanceRate: 0.0, // 0%
            responseTime: 0.0  // 0%
        };
    }

    /**
     * Parse seguro para JSON
     * @private
     */
    safeJSONParse(data, defaultValue = {}) {
        if (!data) return defaultValue;
        if (typeof data === 'object') return data;
        try {
            return JSON.parse(data);
        } catch (error) {
            return defaultValue;
        }
    }

    getRideExcludedDriversKey(bookingId) {
        return `ride_excluded_drivers:${bookingId}`;
    }

    getRideNotificationsKey(bookingId) {
        return `ride_notifications:${bookingId}`;
    }

    getRideRejectionCountKey(bookingId) {
        return `ride_rejection_count:${bookingId}`;
    }

    getRideReofferCooldownKey(bookingId, driverId) {
        return `ride_reoffer_cooldown:${bookingId}:${driverId}`;
    }

    reportNotificationOutcome(options = {}, outcome = {}) {
        const callback = options?.onNotificationOutcome;
        if (typeof callback !== 'function') {
            return;
        }
        try {
            callback({
                ok: outcome?.ok === true,
                reason: String(outcome?.reason || '').trim() || 'UNKNOWN',
                ...outcome
            });
        } catch (_error) {
            // Observability callback must never break dispatch flow.
        }
    }

    finishNotificationOutcome(options = {}, ok, reason, extra = {}) {
        this.reportNotificationOutcome(options, {
            ok,
            reason,
            ...extra
        });
        return ok;
    }

    readPreflightPipelineResult(results, index, fallback = null) {
        const entry = results?.[index];
        if (!entry || entry[0]) {
            return fallback;
        }
        return entry[1];
    }

    resolveDriverLivenessTimestampMs(lastUpdateRaw, lastSeenRaw) {
        const lastUpdateMs = Number.parseInt(String(lastUpdateRaw || ''), 10);
        if (Number.isFinite(lastUpdateMs) && lastUpdateMs > 0) {
            return lastUpdateMs;
        }

        if (typeof lastSeenRaw === 'string' && lastSeenRaw.trim()) {
            const parsedMs = Date.parse(lastSeenRaw);
            if (Number.isFinite(parsedMs) && parsedMs > 0) {
                return parsedMs;
            }
        }

        return null;
    }

    getDriverLivenessMeta(lastUpdateRaw, lastSeenRaw) {
        const lastSignalAtMs = this.resolveDriverLivenessTimestampMs(
            lastUpdateRaw,
            lastSeenRaw
        );

        if (!Number.isFinite(lastSignalAtMs)) {
            return {
                isFresh: false,
                lastSignalAtMs: null,
                ageMs: null
            };
        }

        const ageMs = Math.max(0, Date.now() - lastSignalAtMs);
        return {
            isFresh: ageMs <= DISPATCH_DRIVER_LIVENESS_GRACE_MS,
            lastSignalAtMs,
            ageMs
        };
    }

    getDriverRideRejectionMetaFromSnapshot({
        cooldownTtlRaw = -2,
        rejectionCountRaw = 0,
        excludedRaw = 0
    } = {}) {
        const cooldownTtlSeconds = Number(cooldownTtlRaw);
        const rejectionCount = Number(rejectionCountRaw || 0);
        const permanentlyExcluded =
            Number(excludedRaw || 0) === 1 ||
            rejectionCount >= DRIVER_REOFFER_MAX_REJECTIONS;

        return {
            cooldownActive:
                Number.isFinite(cooldownTtlSeconds) && cooldownTtlSeconds > 0,
            cooldownTtlSeconds: Number.isFinite(cooldownTtlSeconds)
                ? cooldownTtlSeconds
                : -2,
            rejectionCount: Number.isFinite(rejectionCount) ? rejectionCount : 0,
            permanentlyExcluded
        };
    }

    normalizeAwaitingResponseResumeState(state) {
        switch (state) {
        case 'EXPANDED':
            return 'EXPANDED';
        case 'REASSIGNMENT_PENDING':
            return 'REASSIGNMENT_PENDING';
        case 'SEARCHING':
            return 'SEARCHING';
        case 'PENDING':
            return 'SEARCHING';
        default:
            return 'SEARCHING';
        }
    }

    /**
     * Prefetch de estado transitório por motorista para reduzir N+1 no matching.
     * Busca em lote: driver_active_notification + driver_lock.
     * @private
     */
    async prefetchDriverTransientState(driverIds = []) {
        const uniqueIds = [...new Set((driverIds || []).filter(Boolean))];
        const activeNotificationByDriver = new Map();
        const lockByDriver = new Map();

        if (uniqueIds.length === 0) {
            return { activeNotificationByDriver, lockByDriver };
        }

        const pipeline = this.redis.pipeline();
        for (const driverId of uniqueIds) {
            pipeline.get(`driver_active_notification:${driverId}`);
            pipeline.get(`driver_lock:${driverId}`);
        }

        const results = await pipeline.exec();
        const lockBookingIds = [];
        const lockBookingIdByDriver = new Map();

        for (let i = 0; i < uniqueIds.length; i++) {
            const driverId = uniqueIds[i];
            const activeResult = results[i * 2];
            const lockResult = results[i * 2 + 1];

            const activeBookingId = activeResult && !activeResult[0] ? activeResult[1] : null;
            const lockBookingId = lockResult && !lockResult[0] ? lockResult[1] : null;

            if (activeBookingId) {
                activeNotificationByDriver.set(driverId, activeBookingId);
            }
            if (lockBookingId) {
                lockBookingIdByDriver.set(driverId, lockBookingId);
                lockBookingIds.push(lockBookingId);
            }
        }

        if (lockBookingIds.length > 0) {
            const bookingStatePipeline = this.redis.pipeline();
            for (const lockBookingId of lockBookingIds) {
                bookingStatePipeline.hmget(`booking:${lockBookingId}`, 'state', 'status');
            }
            const bookingStateResults = await bookingStatePipeline.exec();
            const cleanupPipeline = this.redis.pipeline();
            let cleanupCount = 0;
            let lockIndex = 0;

            for (const driverId of uniqueIds) {
                const lockBookingId = lockBookingIdByDriver.get(driverId);
                if (!lockBookingId) {
                    continue;
                }

                const result = bookingStateResults[lockIndex] || [];
                lockIndex += 1;
                const stateTuple = result && !result[0] ? result[1] || [] : [];
                const state = String(stateTuple?.[0] || '').trim().toUpperCase();
                const status = String(stateTuple?.[1] || '').trim().toUpperCase();
                const staleLock =
                    (!state && !status) ||
                    TERMINAL_LOCK_BOOKING_STATES.has(state) ||
                    TERMINAL_LOCK_BOOKING_STATES.has(status);

                if (staleLock) {
                    cleanupPipeline.del(`driver_lock:${driverId}`);
                    cleanupCount += 1;
                    logger.info(
                        `🧹 [Dispatcher] Lock stale removido para driver ${driverId} (booking: ${lockBookingId}, state=${state || 'missing'}, status=${status || 'missing'})`
                    );
                    continue;
                }

                lockByDriver.set(driverId, lockBookingId);
            }

            if (cleanupCount > 0) {
                await cleanupPipeline.exec();
            }
        }

        return { activeNotificationByDriver, lockByDriver };
    }

    /**
     * Verificar se booking ainda pode ser despachado.
     * Evita notificar motorista para corrida stale/superseded.
     * @private
     */
    async getDispatchability(bookingId, bookingData = null) {
        const bookingKey = `booking:${bookingId}`;
        const snapshot = bookingData && Object.keys(bookingData).length > 0
            ? bookingData
            : await this.redis.hgetall(bookingKey);

        if (!snapshot || Object.keys(snapshot).length === 0) {
            return { ok: false, reason: 'BOOKING_NOT_FOUND' };
        }

        const RideStateManager = require('./ride-state-manager');
        const state = await RideStateManager.getBookingState(this.redis, bookingId);
        const status = String(snapshot.status || '').toUpperCase();

        if (!state || !DISPATCHABLE_SEARCH_STATES.has(state)) {
            return { ok: false, reason: 'STATE_NOT_DISPATCHABLE', state, status };
        }

        if (RideStateManager.isTerminalStateValue(status)) {
            return { ok: false, reason: 'BOOKING_STATUS_BLOCKED', state, status };
        }

        const customerId = snapshot.customerId;
        if (customerId) {
            const activeBookingId = await this.redis.get(`customer_active_booking:${customerId}`);
            if (activeBookingId && activeBookingId !== bookingId) {
                return {
                    ok: false,
                    reason: 'STALE_CUSTOMER_ACTIVE_BOOKING',
                    state,
                    status,
                    customerId,
                    activeBookingId
                };
            }
        }

        return { ok: true, state, status, bookingData: snapshot };
    }

    /**
     * Buscar motoristas próximos e calcular scores
     * @param {Object} pickupLocation - { lat, lng }
     * @param {number} radius - Raio em km
     * @param {number} limit - Limite de motoristas
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<Array>} Array de motoristas com scores ordenados
     */
    async findAndScoreDrivers(pickupLocation, radius, limit, bookingId, rideRequirements = {}) {
        try {
            // ✅ CORREÇÃO: Garantir que pickupLocation seja um objeto válido
            const parsedPickup = this.safeJSONParse(pickupLocation, null);
            if (!parsedPickup || typeof parsedPickup.lat !== 'number' || typeof parsedPickup.lng !== 'number') {
                logger.warn(`⚠️ [Dispatcher] Localização de pickup inválida para ${bookingId}:`, pickupLocation);
                return [];
            }
            pickupLocation = parsedPickup;

            logger.debug(`🔍 [Dispatcher] Buscando motoristas em ${radius}km for ${bookingId}`);

            const startTime = performance.now();
            const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 5);
            const geoCandidateMax = Math.max(DISPATCH_GEO_CANDIDATE_MAX, DISPATCH_GEO_CANDIDATE_MIN);
            const scorePoolMax = Math.max(DISPATCH_SCORE_POOL_MAX, DISPATCH_SCORE_POOL_MIN);
            const geoCandidateCount = Math.min(
                geoCandidateMax,
                Math.max(DISPATCH_GEO_CANDIDATE_MIN, normalizedLimit * 8)
            );
            const scorePoolLimit = Math.min(
                scorePoolMax,
                Math.max(DISPATCH_SCORE_POOL_MIN, normalizedLimit * 4)
            );

            // 1. Tentar buscar do cache geoespacial primeiro
            const geospatialCache = require('./geospatial-cache');

            // Cache geoespacial é opt-in para priorizar consistência de dispatch em produção.
            const cacheEnabled = process.env.ENABLE_GEOSPATIAL_CACHE === 'true' &&
                process.env.BYPASS_CACHE !== 'true' &&
                process.env.NODE_ENV !== 'test';
            const cachedDrivers = cacheEnabled
                ? await geospatialCache.get(pickupLocation.lat, pickupLocation.lng, radius)
                : null;

            let nearbyDrivers;
            if (cachedDrivers && cachedDrivers.length > 0) {
                // Usar cache (retornar em formato compatível com georadius)
                logger.debug(`✅ [Dispatcher] Cache HIT para ${bookingId} (raio: ${radius}km)`);
                nearbyDrivers = cachedDrivers.map(d => [d.driverId, d.distance, [d.coordinates.lng, d.coordinates.lat]]);
            } else {
                // Cache miss - buscar do Redis GEO
                nearbyDrivers = await this.redis.georadius(
                    ELIGIBLE_DRIVER_GEO_KEY,
                    pickupLocation.lng,
                    pickupLocation.lat,
                    radius,
                    'km',
                    'WITHCOORD',
                    'WITHDIST',
                    'ASC',
                    'COUNT',
                    geoCandidateCount
                );
            }

            if (!nearbyDrivers || nearbyDrivers.length === 0) {
                logger.warn(`⚠️ [Dispatcher] Nenhum motorista encontrado em ${radius}km para ${bookingId}`);
                // Diagnóstico opcional (custoso) para incidentes.
                if (!STRICT_ELIGIBLE_DRIVER_POOL) {
                    nearbyDrivers = await this.redis.georadius(
                        ALL_DRIVER_GEO_KEY,
                        pickupLocation.lng,
                        pickupLocation.lat,
                        radius,
                        'km',
                        'WITHCOORD',
                        'WITHDIST',
                        'ASC',
                        'COUNT',
                        geoCandidateCount
                    );
                    if (nearbyDrivers && nearbyDrivers.length > 0) {
                        logger.warn(`⚠️ [Dispatcher] Fallback para pool completo (STRICT_ELIGIBLE_DRIVER_POOL=false) em ${bookingId}`);
                    }
                }

                if ((!nearbyDrivers || nearbyDrivers.length === 0) && process.env.DEBUG_DISPATCHER_REDIS === 'true') {
                    const eligibleDrivers = await this.redis.zrange(ELIGIBLE_DRIVER_GEO_KEY, 0, -1);
                    logger.info(`🔍 [Dispatcher] DEBUG: Total elegíveis no GEO ${ELIGIBLE_DRIVER_GEO_KEY}: ${eligibleDrivers.length}`);
                    if (eligibleDrivers.length > 0) {
                        logger.info(`🔍 [Dispatcher] DEBUG: Elegíveis no Redis: ${eligibleDrivers.slice(0, 5).join(', ')}...`);
                    }
                }
                if (!nearbyDrivers || nearbyDrivers.length === 0) {
                    return [];
                }
            }

            logger.info(`✅ [Dispatcher] Encontrados ${nearbyDrivers.length} motoristas em ${radius}km para ${bookingId}`);

            // 2. Filtrar motoristas já notificados para esta corrida
            const notifiedDriverIds = await this.redis.smembers(`ride_notifications:${bookingId}`);
            const notifiedSet = new Set(notifiedDriverIds);
            const transientState = await this.prefetchDriverTransientState(
                nearbyDrivers.map((driver) => driver && driver[0]).filter(Boolean)
            );

            const useDistanceOnlyScoring =
                this.scoreWeights.distance >= 0.999 &&
                this.scoreWeights.rating === 0 &&
                this.scoreWeights.acceptanceRate === 0 &&
                this.scoreWeights.responseTime === 0;
            const shouldApplyRidePreferences = hasRideDispatchPreferences(rideRequirements);
            const requestedCategory =
                rideRequirements.carType ||
                rideRequirements.requestedCarType ||
                rideRequirements.vehicleCategory ||
                null;
            const shouldApplyDriverEligibility = Boolean(requestedCategory);
            const paymentReservationContext = {
                bookingId,
                rideId: bookingData?.paymentReferenceRideId,
                paymentSessionId: bookingData?.paymentSessionId,
                quoteLockId: bookingData?.paymentQuoteLockId,
                reservationId: bookingData?.paymentDriverReservationId
            };

            // 3. Buscar dados completos e calcular scores
            const scoredDrivers = [];

            for (const driver of nearbyDrivers) {
                if (useDistanceOnlyScoring && scoredDrivers.length >= scorePoolLimit) {
                    break;
                }

                const driverId = driver[0];
                const distance = parseFloat(driver[1]);
                if (!Number.isFinite(distance)) {
                    continue;
                }
                const coordinates = {
                    lng: parseFloat(driver[2][0]),
                    lat: parseFloat(driver[2][1])
                };

                // 2. Filtrar motoristas já notificados (permitir re-notificação se não estiver na tela)
                if (notifiedSet.has(driverId)) {
                    // Se já foi notificado, verificar se ainda tem esta corrida na tela
                    const activeBookingIdAtFind = transientState.activeNotificationByDriver.get(driverId) || null;

                    if (activeBookingIdAtFind === bookingId) {
                        logger.debug(`⏭️ [Dispatcher] Driver ${driverId} ignorado: já notificado e com ${bookingId} na tela`);
                        continue;
                    }

                    // Se não está na tela, permitir re-notificação (pode ter sido sobrescrita ou expirada)
                    logger.debug(`🔄 [Dispatcher] Driver ${driverId} já foi notificado para ${bookingId}, mas não está na tela - permitindo re-notificação`);
                }

                // ✅ CORREÇÃO: Verificar se motorista tem lock (corrida em andamento)
                // Não verificar corrida ativa na tela aqui (pode receber múltiplas se rejeitar)
                // Não ignorar motorista se o lock for para a mesma corrida (re-notificação / expansão do raio)
                const lockBookingId = transientState.lockByDriver.get(driverId) || null;
                if (lockBookingId && lockBookingId !== bookingId) {
                    logger.debug(`⏭️ [Dispatcher] Driver ${driverId} ignorado: possui lock para outra corrida (${lockBookingId})`);
                    continue; // Motorista ocupado com outra corrida
                }

                const paymentReservation = await getDriverPaymentReservation(this.redis, driverId);
                if (
                    paymentReservation &&
                    !reservationMatchesContext(paymentReservation, paymentReservationContext)
                ) {
                    logger.debug(`⏭️ [Dispatcher] Driver ${driverId} ignorado: reservado para outro pagamento`);
                    continue;
                }

                let driverData = null;
                let score = 0;

                if (useDistanceOnlyScoring && !shouldApplyRidePreferences && !shouldApplyDriverEligibility) {
                    // Em produção a ordenação é 100% por proximidade, então evitamos round-trips extras.
                    score = Math.max(0.01, (1 - (distance / (radius + 0.1))) * 100);
                    driverData = {
                        rating: 5.0,
                        acceptanceRate: 50.0,
                        avgResponseTime: 5.0,
                        totalTrips: 0,
                        carType: null,
                        vehicleCategory: null
                    };
                } else {
                    // Buscar dados do motorista para calcular score
                    driverData = await this.getDriverData(driverId);

                    // ✅ Verificar status (aceitar 'AVAILABLE', 'available', 'online')
                    const isAvailable = driverData &&
                        driverData.isOnline &&
                        (driverData.status === 'AVAILABLE' ||
                            driverData.status === 'available' ||
                            driverData.status === 'online' ||
                            !driverData.status); // Se não tem status, assumir disponível

                    if (!isAvailable) {
                        logger.debug(`⚠️ [Dispatcher] Driver ${driverId} ignorado: não disponível (isOnline=${driverData?.isOnline}, status=${driverData?.status})`);
                        continue; // Motorista offline ou não disponível
                    }

                    if (shouldApplyDriverEligibility) {
                        const eligibility = await driverEligibilityService.isDriverEligibleForRide(
                            driverId,
                            requestedCategory,
                            driverData
                        );
                        if (!eligibility?.eligible) {
                            logger.debug(`⏭️ [Dispatcher] Driver ${driverId} ignorado por categoria: ${eligibility?.code || 'NOT_ELIGIBLE'}`);
                            continue;
                        }
                    }

                    const preferenceMatch = driverMatchesRidePreferences(
                        driverData,
                        {
                            ...rideRequirements,
                            pickupLocation
                        }
                    );
                    if (!preferenceMatch.ok) {
                        logger.debug(`⏭️ [Dispatcher] Driver ${driverId} ignorado por preferência: ${preferenceMatch.reason}`);
                        continue;
                    }

                    score = useDistanceOnlyScoring
                        ? Math.max(0.01, (1 - (distance / (radius + 0.1))) * 100)
                        : await this.calculateDriverScore(
                            driverId,
                            distance,
                            driverData,
                            bookingId,
                            radius
                        );
                }

                if (score <= 0) {
                    logger.debug(`⏭️ [Dispatcher] Driver ${driverId} ignorado: score zero ou negativo (${score})`);
                    continue;
                }

                logger.debug(`✅ [Dispatcher] Driver ${driverId} qualificado: distância=${distance}km, score=${score}`);
                scoredDrivers.push({
                    driverId,
                    distance,
                    coordinates,
                    score,
                    rating: driverData.rating || 5.0,
                    acceptanceRate: driverData.acceptanceRate || 50.0,
                    responseTime: driverData.avgResponseTime || 5.0,
                    totalTrips: driverData.totalTrips || 0,
                    carType: driverData.carType || null,
                    category: driverData.vehicleCategory || null,
                    gender: driverData.gender || null,
                    destinationModeActive: driverData.destinationModeActive === true
                });
            }

            // 4. Ordenar por score (maior primeiro) e retornar pool para notificação
            // Pool é derivado do limite por onda para evitar cap fixo em áreas densas.
            const topDrivers = useDistanceOnlyScoring
                ? scoredDrivers.slice(0, scorePoolLimit)
                : scoredDrivers
                    .sort((a, b) => b.score - a.score)
                    .slice(0, scorePoolLimit);

            // 5. Armazenar no cache geoespacial (apenas se não veio do cache)
            if (cacheEnabled && (!cachedDrivers || cachedDrivers.length === 0)) {
                const driversForCache = topDrivers.map(d => ({
                    driverId: d.driverId,
                    distance: d.distance,
                    coordinates: d.coordinates,
                    score: d.score
                }));
                await geospatialCache.set(pickupLocation.lat, pickupLocation.lng, radius, driversForCache);
            }

            // 6. Registrar latência
            const latency = performance.now() - startTime;
            const metricsCollector = require('./metrics-collector');
            await metricsCollector.recordLatency('findAndScoreDrivers', latency);

            logger.info(`✅ [Dispatcher] ${topDrivers.length} motoristas encontrados e pontuados para ${bookingId} (${latency.toFixed(2)}ms, candidates=${geoCandidateCount}, pool=${scorePoolLimit})`);

            return topDrivers;
        } catch (error) {
            logger.error(`❌ Erro ao buscar e pontuar motoristas para ${bookingId}:`, error);
            return [];
        }
    }

    /**
     * Buscar dados do motorista (rating, acceptance rate, etc)
     * @private
     */
    async getDriverData(driverId) {
        try {
            // Tentar buscar do cache Redis primeiro
            const cached = await this.redis.hgetall(`driver:${driverId}`);

            if (cached && cached.id) {
                // ✅ Normalizar status (aceitar 'online', 'available', 'AVAILABLE')
                const normalizedStatus = cached.status ?
                    (cached.status.toUpperCase() === 'ONLINE' || cached.status.toUpperCase() === 'AVAILABLE' ? 'AVAILABLE' : cached.status) :
                    'AVAILABLE';

                return {
                    id: cached.id,
                    isOnline: cached.isOnline === 'true' || cached.isOnline === true,
                    status: normalizedStatus,
                    carType: cached.carType || null,
                    vehicleCategory: cached.vehicleCategory || null,
                    gender: cached.gender || cached.genero || cached.genderCode || cached.genderLabel || null,
                    destinationModeActive:
                        cached.destinationModeActive === 'true' ||
                        cached.driverDestinationModeActive === 'true' ||
                        cached.destinationFilterActive === 'true',
                    destinationModeLat:
                        cached.destinationModeLat ||
                        cached.driverDestinationLat ||
                        cached.destinationFilterLat ||
                        null,
                    destinationModeLng:
                        cached.destinationModeLng ||
                        cached.driverDestinationLng ||
                        cached.destinationFilterLng ||
                        null,
                    destinationModeExpiresAt:
                        cached.destinationModeExpiresAt ||
                        cached.driverDestinationExpiresAt ||
                        cached.destinationFilterExpiresAt ||
                        null,
                    destinationModeMinProgressKm:
                        cached.destinationModeMinProgressKm ||
                        cached.driverDestinationMinProgressKm ||
                        null,
                    destinationModeArrivalRadiusKm:
                        cached.destinationModeArrivalRadiusKm ||
                        cached.driverDestinationArrivalRadiusKm ||
                        null,
                    acceptsPlusWithElite: cached.acceptsPlusWithElite === 'true' || cached.acceptsPlusWithElite === true,
                    driverApproved: cached.driverApproved === 'true' || cached.driverApproved === true,
                    vehicleApproved: cached.vehicleApproved === 'true' || cached.vehicleApproved === true,
                    rating: parseFloat(cached.rating || 5.0),
                    acceptanceRate: parseFloat(cached.acceptanceRate || 50.0),
                    avgResponseTime: parseFloat(cached.avgResponseTime || 5.0),
                    totalTrips: parseInt(cached.totalTrips || 0)
                };
            }

            // Se não estiver no cache, buscar do Firebase/DB e cachear
            // Por enquanto, retornar dados padrão
            // TODO: Integrar com DriverResolver ou Firebase
            return {
                id: driverId,
                isOnline: true,
                status: 'AVAILABLE',
                carType: null,
                vehicleCategory: null,
                gender: null,
                destinationModeActive: false,
                acceptsPlusWithElite: true,
                driverApproved: true,
                vehicleApproved: true,
                rating: 5.0,
                acceptanceRate: 50.0,
                avgResponseTime: 5.0,
                totalTrips: 0
            };
        } catch (error) {
            logger.error(`❌ Erro ao buscar dados do motorista ${driverId}:`, error);
            return null;
        }
    }

    /**
     * Calcular score do motorista
     * Score final = (distância × 0.4) + (rating × 0.2) + (acceptanceRate × 0.2) + (responseTime × 0.2)
     * @private
     */
    async calculateDriverScore(driverId, distance, driverData, bookingId, radius = 5.0) {
        try {
            // ✅ CORREÇÃO: Usar o raio atual da busca para normalização, não um valor fixo de 5km.
            // Adicionamos +0.1 para que o score seja > 0 mesmo no limite do raio.
            const normalizedDistance = Math.max(0.01, 1 - (distance / (radius + 0.1)));

            // Normalizar rating (0-5 → 0-1)
            const normalizedRating = (driverData.rating || 5.0) / 5.0;

            // Normalizar acceptance rate (0-100 → 0-1)
            const normalizedAcceptanceRate = (driverData.acceptanceRate || 50.0) / 100.0;

            // Normalizar response time (menor = melhor, escala 0-1)
            // Assumir que tempo médio de resposta máximo é 30s
            const maxResponseTime = 30.0;
            const normalizedResponseTime = Math.max(0, 1 - ((driverData.avgResponseTime || 5.0) / maxResponseTime));

            // Calcular score ponderado
            const score = (
                normalizedDistance * this.scoreWeights.distance +
                normalizedRating * this.scoreWeights.rating +
                normalizedAcceptanceRate * this.scoreWeights.acceptanceRate +
                normalizedResponseTime * this.scoreWeights.responseTime
            ) * 100; // Escala 0-100

            logger.debug(`📊 [Dispatcher] Score calculado para driver ${driverId}: ${score.toFixed(2)} (dist: ${distance.toFixed(2)}km, rating: ${driverData.rating}, acceptance: ${driverData.acceptanceRate}%, response: ${driverData.avgResponseTime}s)`);

            return score;
        } catch (error) {
            logger.error(`❌ Erro ao calcular score para driver ${driverId}:`, error);
            // Retornar score baseado apenas em distância (usando radius)
            return Math.max(0.01, (1 - (distance / (radius + 0.1))) * 100);
        }
    }

    /**
     * Notificar motorista via WebSocket com lock
     * @param {string} driverId - ID do motorista
     * @param {string} bookingId - ID da corrida
     * @param {Object} bookingData - Dados completos da corrida
     * @returns {Promise<boolean>} true se notificado com sucesso
     */
    async notifyDriver(driverId, bookingId, bookingData, options = {}) {
        try {
            const finish = (ok, reason, extra = {}) =>
                this.finishNotificationOutcome(options, ok, reason, extra);
            const responseTimeoutSeconds = DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS;
            const skipInitialDispatchabilityCheck = options?.skipInitialDispatchabilityCheck === true;
            let dispatchabilitySnapshot = options?.precomputedDispatchability || null;

            if (!skipInitialDispatchabilityCheck) {
                dispatchabilitySnapshot = await this.getDispatchability(bookingId, bookingData);
                if (!dispatchabilitySnapshot.ok) {
                    logger.info(`⚠️ [Dispatcher] NOTIFY_FALSE: booking ${bookingId} não despachável (${dispatchabilitySnapshot.reason})`);
                    return finish(false, dispatchabilitySnapshot.reason || 'BOOKING_NOT_DISPATCHABLE');
                }
            }

            // 1. Pré-validações em lote para reduzir round-trips no caminho quente.
            const activeNotificationKey = `driver_active_notification:${driverId}`;
            const preflightPipeline = this.redis.pipeline();
            preflightPipeline.get(activeNotificationKey);
            preflightPipeline.sismember(this.getRideExcludedDriversKey(bookingId), driverId);
            preflightPipeline.sismember(this.getRideNotificationsKey(bookingId), driverId);
            preflightPipeline.hmget(
                `driver:${driverId}`,
                'isOnline',
                'dispatchEligible',
                'status',
                'lastUpdate',
                'lastSeen'
            );
            preflightPipeline.ttl(`driver_soft_ban:${driverId}`);
            preflightPipeline.ttl(this.getRideReofferCooldownKey(bookingId, driverId));
            preflightPipeline.hget(this.getRideRejectionCountKey(bookingId), driverId);
            const preflightResults = await preflightPipeline.exec();

            const currentActiveId = this.readPreflightPipelineResult(preflightResults, 0, null);
            const excludedRaw = this.readPreflightPipelineResult(preflightResults, 1, 0);
            const alreadyNotified = Number(this.readPreflightPipelineResult(preflightResults, 2, 0)) === 1;
            const driverStatusTuple = this.readPreflightPipelineResult(preflightResults, 3, []) || [];
            const softBanTtlSeconds = Number(this.readPreflightPipelineResult(preflightResults, 4, -2));
            const rejectionMeta = this.getDriverRideRejectionMetaFromSnapshot({
                cooldownTtlRaw: this.readPreflightPipelineResult(preflightResults, 5, -2),
                rejectionCountRaw: this.readPreflightPipelineResult(preflightResults, 6, 0),
                excludedRaw
            });
            const rawIsOnline = driverStatusTuple?.[0];
            const rawDispatchEligible = driverStatusTuple?.[1];
            const rawDriverStatus = driverStatusTuple?.[2];
            const rawLastUpdate = driverStatusTuple?.[3];
            const rawLastSeen = driverStatusTuple?.[4];
            const isDriverOnline = String(rawIsOnline || '').toLowerCase() === 'true';
            const isDriverDispatchEligible = String(rawDispatchEligible || '').toLowerCase() !== 'false';
            const normalizedDriverStatus = String(rawDriverStatus || 'available').toLowerCase();
            const isDriverStatusEligible =
                normalizedDriverStatus === '' ||
                normalizedDriverStatus === 'available' ||
                normalizedDriverStatus === 'online';
            const livenessMeta = this.getDriverLivenessMeta(rawLastUpdate, rawLastSeen);

            if (!isDriverOnline || !isDriverDispatchEligible || !isDriverStatusEligible) {
                logger.debug(`⏭️ [Dispatcher] Driver ${driverId} ignorado no preflight (online=${isDriverOnline}, dispatchEligible=${isDriverDispatchEligible}, status=${normalizedDriverStatus || 'n/a'})`);
                return finish(false, 'DRIVER_NOT_ELIGIBLE', {
                    isDriverOnline,
                    isDriverDispatchEligible,
                    driverStatus: normalizedDriverStatus || 'n/a'
                });
            }

            if (!livenessMeta.isFresh) {
                logger.debug(
                    `⏭️ [Dispatcher] Driver ${driverId} ignorado por liveness stale (ageMs=${livenessMeta.ageMs ?? 'n/a'}, graceMs=${DISPATCH_DRIVER_LIVENESS_GRACE_MS})`
                );
                return finish(false, 'DRIVER_LIVENESS_STALE', {
                    livenessAgeMs: livenessMeta.ageMs ?? null
                });
            }

            if (Number.isFinite(softBanTtlSeconds) && softBanTtlSeconds > 0) {
                logger.info(`⛔ [Dispatcher] Driver ${driverId} em soft-ban por ${softBanTtlSeconds}s, pulando dispatch`);
                return finish(false, 'DRIVER_SOFT_BAN', {
                    ttlSeconds: softBanTtlSeconds
                });
            }

            // 2. Verificar se motorista já tem corrida ativa na tela (usa chave específica para UI)
            if (currentActiveId && currentActiveId !== bookingId) {
                logger.info(`⚠️ [Dispatcher] NOTIFY_FALSE: Driver ${driverId} já tem corrida ativa na tela (${currentActiveId}), aguardando resposta`);
                return finish(false, 'DRIVER_ACTIVE_NOTIFICATION', {
                    activeBookingId: currentActiveId
                });
            }

            // ✅ CORREÇÃO: Verificar exclusão PRIMEIRO (se rejeitou, não pode receber)
            // Se motorista está excluído, não pode receber esta corrida
            if (rejectionMeta.permanentlyExcluded) {
                logger.info(`🚫 [Dispatcher] Driver ${driverId} está excluído para ${bookingId} após ${rejectionMeta.rejectionCount} recusas`);
                return finish(false, 'DRIVER_PERMANENTLY_EXCLUDED', {
                    rejectionCount: rejectionMeta.rejectionCount
                });
            }

            if (rejectionMeta.cooldownActive) {
                logger.info(`⏳ [Dispatcher] Driver ${driverId} em cooldown (${rejectionMeta.cooldownTtlSeconds}s) para ${bookingId}`);
                return finish(false, 'DRIVER_REJECTION_COOLDOWN', {
                    ttlSeconds: rejectionMeta.cooldownTtlSeconds
                });
            }

            // ✅ CORREÇÃO: Se já foi notificado para ESTA corrida, verificar se ainda está na tela
            // Se não está na tela, permitir re-notificação (pode ter sido sobrescrita ou expirada)
            if (alreadyNotified) {
                if (currentActiveId === bookingId) {
                    logger.info(`⚠️ [Dispatcher] NOTIFY_FALSE: Driver ${driverId} já foi notificado para ${bookingId} e ainda está na tela`);
                    return finish(false, 'DRIVER_ALREADY_NOTIFIED', {
                        activeBookingId: currentActiveId
                    });
                }

                logger.info(`🔄 [Dispatcher] Driver ${driverId} já foi notificado para ${bookingId}, mas não está na tela - re-notificando`);
            }

            // ✅ Lock após validações rápidas para reduzir lock órfão
            const lockAcquired = await driverLockManager.acquireLock(driverId, bookingId, responseTimeoutSeconds);
            if (!lockAcquired) {
                const currentLock = await driverLockManager.getLockedBooking(driverId);
                if (currentLock !== bookingId) {
                    logger.info(`⚠️ [Dispatcher] NOTIFY_FALSE: Driver ${driverId} já tem lock para outra corrida (${currentLock})`);
                    return finish(false, 'DRIVER_LOCKED_OTHER_BOOKING', {
                        currentLock
                    });
                }
                logger.debug(`🔄 [Dispatcher] Driver ${driverId} já tem lock para ${bookingId}, permitindo re-notificação`);
            }

            // Revalidar tela ativa após lock para evitar corrida entre dispatchers paralelos
            const postLockPipeline = this.redis.pipeline();
            postLockPipeline.get(activeNotificationKey);
            postLockPipeline.sismember(this.getRideExcludedDriversKey(bookingId), driverId);
            postLockPipeline.ttl(this.getRideReofferCooldownKey(bookingId, driverId));
            postLockPipeline.hget(this.getRideRejectionCountKey(bookingId), driverId);
            const postLockResults = await postLockPipeline.exec();
            const activeAfterLock = this.readPreflightPipelineResult(postLockResults, 0, null);
            const postLockRejectionMeta = this.getDriverRideRejectionMetaFromSnapshot({
                excludedRaw: this.readPreflightPipelineResult(postLockResults, 1, 0),
                cooldownTtlRaw: this.readPreflightPipelineResult(postLockResults, 2, -2),
                rejectionCountRaw: this.readPreflightPipelineResult(postLockResults, 3, 0)
            });

            if (activeAfterLock && activeAfterLock !== bookingId) {
                if (lockAcquired) {
                    await driverLockManager.releaseLock(driverId);
                }
                logger.info(`⚠️ [Dispatcher] NOTIFY_FALSE: Driver ${driverId} ficou ocupado na tela (${activeAfterLock}) durante lock`);
                return finish(false, 'DRIVER_BECAME_ACTIVE_DURING_LOCK', {
                    activeBookingId: activeAfterLock
                });
            }

            if (postLockRejectionMeta.permanentlyExcluded) {
                if (lockAcquired) {
                    await driverLockManager.releaseLock(driverId);
                }
                logger.info(`🚫 [Dispatcher] NOTIFY_FALSE: Driver ${driverId} foi excluído para ${bookingId} durante lock`);
                return finish(false, 'DRIVER_EXCLUDED_DURING_LOCK', {
                    rejectionCount: postLockRejectionMeta.rejectionCount
                });
            }

            if (postLockRejectionMeta.cooldownActive) {
                if (lockAcquired) {
                    await driverLockManager.releaseLock(driverId);
                }
                logger.info(`⏳ [Dispatcher] NOTIFY_FALSE: Driver ${driverId} entrou em cooldown (${postLockRejectionMeta.cooldownTtlSeconds}s) para ${bookingId} durante lock`);
                return finish(false, 'DRIVER_COOLDOWN_DURING_LOCK', {
                    ttlSeconds: postLockRejectionMeta.cooldownTtlSeconds
                });
            }

            const finalDispatchability = await this.getDispatchability(
                bookingId,
                dispatchabilitySnapshot?.bookingData || bookingData
            );
            if (!finalDispatchability.ok) {
                if (lockAcquired) {
                    await driverLockManager.releaseLock(driverId);
                }
                logger.info(`⚠️ [Dispatcher] NOTIFY_FALSE: booking ${bookingId} invalidado antes do envio (${finalDispatchability.reason})`);
                return finish(false, finalDispatchability.reason || 'BOOKING_INVALIDATED_BEFORE_SEND');
            }

            const effectiveBookingData = {
                ...finalDispatchability.bookingData,
                ...bookingData
            };
            const pickupLocationParsed = this.safeJSONParse(effectiveBookingData.pickupLocation);
            const destinationLocationParsed = this.safeJSONParse(effectiveBookingData.destinationLocation);
            const operationalContinuation = this.safeJSONParse(
                effectiveBookingData.operationalContinuation || effectiveBookingData.reassignmentContext,
                null
            );

            const pickupLat = Number(pickupLocationParsed?.lat);
            const pickupLng = Number(pickupLocationParsed?.lng);
            const destinationLat = Number(destinationLocationParsed?.lat);
            const destinationLng = Number(destinationLocationParsed?.lng);
            let estimatedTripDistanceKm = null;
            if (
                Number.isFinite(pickupLat) &&
                Number.isFinite(pickupLng) &&
                Number.isFinite(destinationLat) &&
                Number.isFinite(destinationLng)
            ) {
                const earthRadiusKm = 6371;
                const toRad = (deg) => (deg * Math.PI) / 180;
                const dLat = toRad(destinationLat - pickupLat);
                const dLng = toRad(destinationLng - pickupLng);
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                    + Math.cos(toRad(pickupLat)) * Math.cos(toRad(destinationLat))
                    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                estimatedTripDistanceKm = Number((earthRadiusKm * c).toFixed(2));
            }

            const driverDistanceToPickupKm = Number(effectiveBookingData.driverDistanceToPickupKm);
            const estimatedArrivalToPickupMinFromDistance = Number.isFinite(driverDistanceToPickupKm) && driverDistanceToPickupKm >= 0
                ? Math.max(1, Math.round(driverDistanceToPickupKm / 0.45))
                : null;
            const estimatedArrivalToPickupMin = Number.isFinite(Number(effectiveBookingData.estimatedArrivalToPickupMin))
                ? Number(effectiveBookingData.estimatedArrivalToPickupMin)
                : estimatedArrivalToPickupMinFromDistance;

            // 3. Preparar dados da notificação
            const notificationData = {
                rideId: bookingId,
                bookingId: bookingId,
                customerId: effectiveBookingData.customerId,
                passengerName: effectiveBookingData.passengerName || effectiveBookingData.customerName || null,
                pickupLocation: pickupLocationParsed,
                destinationLocation: destinationLocationParsed,
                estimatedFare: effectiveBookingData.estimatedFare,
                paymentMethod: effectiveBookingData.paymentMethod || 'pix',
                pickupAddress: pickupLocationParsed?.add || pickupLocationParsed?.address || null,
                destinationAddress: destinationLocationParsed?.add || destinationLocationParsed?.address || null,
                ...(Number.isFinite(estimatedTripDistanceKm) ? { estimatedTripDistanceKm } : {}),
                ...(Number.isFinite(estimatedArrivalToPickupMin) ? { estimatedArrivalToPickupMin } : {}),
                ...(Number.isFinite(driverDistanceToPickupKm) ? { driverDistanceToPickupKm } : {}),
                ...(operationalContinuation
                    ? {
                        isOperationalContinuation: true,
                        rideMode: 'continuation',
                        previousDriverId: operationalContinuation?.interruptedByDriverId || null,
                        remainingReservedAmount: Number(operationalContinuation?.remainingReservedAmount || 0) || 0,
                        continuationMessage: 'Corrida em continuidade a partir do ponto de interrupção.',
                        operationalContinuation
                    }
                    : {}),
                timeout: responseTimeoutSeconds,
                timestamp: new Date().toISOString()
            };

            const estimatedFare = Number(
                effectiveBookingData.estimatedFare
                ?? effectiveBookingData.estimate
                ?? effectiveBookingData.fare
                ?? 0
            );
            const estimatedSnapshot = resolveEstimatedFareSnapshot({
                payload: effectiveBookingData,
                paymentService: this.paymentService,
                estimatedFare,
                tollFee: effectiveBookingData?.tollFee
            });
            if (estimatedSnapshot) {
                Object.assign(notificationData, estimatedSnapshot, {
                    pricingSnapshotLocked:
                        String(effectiveBookingData?.pricingSnapshotLocked || '').trim().toLowerCase() === 'true'
                        || effectiveBookingData?.pricingSnapshotLocked === true,
                    pricingSnapshotLockedAt: effectiveBookingData?.pricingSnapshotLockedAt || null
                });
            }

            // 4. ✅ VERIFICAR CONEXÃO: Verificar se motorista está conectado antes de enviar
            const driverRoom = `driver_${driverId}`;
            let socketsInRoomCount = null;
            if (DISPATCH_VERIFY_SOCKET_ROOM) {
                const socketsInRoom = await this.io.in(driverRoom).fetchSockets();
                socketsInRoomCount = socketsInRoom.length;
                if (socketsInRoomCount === 0) {
                    if (lockAcquired) {
                        await driverLockManager.releaseLock(driverId);
                    }
                    logger.info(`⚠️ [Dispatcher] NOTIFY_FALSE: Driver ${driverId} não está conectado (nenhum socket na room ${driverRoom})`);
                    return finish(false, 'DRIVER_SOCKET_OFFLINE');
                }
                logger.info(`✅ [Dispatcher] Driver ${driverId} está conectado (${socketsInRoomCount} socket(s) na room ${driverRoom})`);
            } else {
                // Fast-path: emissão direta no room do motorista, sem fetchSockets por notificação.
                socketsInRoomCount = -1;
            }

            // 5. Corrida entra em janela de resposta para pausar a expansão,
            // mas preserva o estado anterior para retomada após timeout/recusa.
            const currentState = finalDispatchability.state;
            const RideStateManager = require('./ride-state-manager');
            const resumeState = this.normalizeAwaitingResponseResumeState(currentState);

            // 6. Persistência mínima antes da emissão.
            // Isso evita uma race onde o motorista recebe a oferta e aceita
            // antes de `driver_active_notification`/reserva ficarem visíveis no Redis.
            const writePipeline = this.redis.multi();
            if (
                currentState === 'SEARCHING' ||
                currentState === 'EXPANDED' ||
                currentState === 'PENDING' ||
                currentState === 'REASSIGNMENT_PENDING' ||
                currentState === 'NOTIFIED' ||
                currentState === 'AWAITING_RESPONSE'
            ) {
                writePipeline.hset(`booking:${bookingId}`, {
                    notifiedDriverId: driverId,
                    notifiedAt: new Date().toISOString(),
                    awaitingResponseDriverId: driverId,
                    awaitingResponseAt: new Date().toISOString(),
                    awaitingResponsePreviousState: resumeState
                });
                logger.info(
                    `📊 [Dispatcher] Motorista ${driverId} notificado para ${bookingId} (corrida em AWAITING_RESPONSE, retorno previsto para ${resumeState})`
                );
            } else {
                logger.debug(`ℹ️ [Dispatcher] Estado atual é ${currentState}, não registrando notificação`);
            }
            writePipeline.sadd(`ride_notifications:${bookingId}`, driverId);
            writePipeline.set(activeNotificationKey, bookingId, 'EX', responseTimeoutSeconds);
            await writePipeline.exec();
            await reserveOffer(this.redis, bookingId, driverId, {
                ttlSeconds: responseTimeoutSeconds,
                metadata: {
                    status: 'AWAITING_RESPONSE'
                }
            });

            // 7. Enviar notificação via WebSocket
            // Usar room específico do motorista (driver_${driverId})
            this.io.to(driverRoom).emit('newRideRequest', notificationData);

            if (options?.dispatchTrace?.type === 'direct') {
                await recordDispatchDirectNotification(this.redis, bookingId, {
                    driverId,
                    source: options?.dispatchTrace?.source || 'response_handler',
                    bookingState: options?.dispatchTrace?.bookingState || currentState,
                    timestampMs: Date.now()
                });
            }

            logger.info(`📤 [Dispatcher] Evento 'newRideRequest' enviado para room ${driverRoom}`, {
                bookingId,
                driverId,
                socketsInRoom: socketsInRoomCount,
                notificationData: {
                    bookingId: notificationData.bookingId,
                    estimatedFare: notificationData.estimatedFare,
                    timeout: notificationData.timeout
                }
            });

            if (
                currentState === RideStateManager.STATES.SEARCHING ||
                currentState === RideStateManager.STATES.EXPANDED ||
                currentState === RideStateManager.STATES.PENDING ||
                currentState === RideStateManager.STATES.REASSIGNMENT_PENDING
            ) {
                await RideStateManager.updateBookingState(
                    this.redis,
                    bookingId,
                    RideStateManager.STATES.AWAITING_RESPONSE,
                    {
                        awaitingResponseDriverId: driverId,
                        awaitingResponseAt: new Date().toISOString(),
                        awaitingResponsePreviousState: resumeState
                    }
                );
            }

            // Agendar timeout de resposta usando o mesmo TTL do lock/notificação.
            this.scheduleDriverTimeout(driverId, bookingId, responseTimeoutSeconds);

            // 7. Registrar evento
            eventSourcing.recordEvent(
                EVENT_TYPES.DRIVER_NOTIFIED,
                {
                    bookingId,
                    driverId,
                    pickupLocation: bookingData.pickupLocation,
                    score: bookingData.score || 0
                }
            ).catch((eventError) => {
                logger.warn(`⚠️ [Dispatcher] Falha ao registrar evento DRIVER_NOTIFIED (${bookingId}/${driverId}): ${eventError.message}`);
            });

            // FASE 10: Registrar notificação para métricas
            const metricsCollector = require('./metrics-collector');
            metricsCollector.recordDriverNotification(bookingId, driverId, Date.now()).catch((metricError) => {
                logger.warn(`⚠️ [Dispatcher] Falha ao registrar métrica de notificação (${bookingId}/${driverId}): ${metricError.message}`);
            });

            logger.info(`📱 [Dispatcher] Notificação enviada para driver ${driverId} (booking: ${bookingId})`);

            return finish(true, 'NOTIFIED', {
                socketsInRoom: socketsInRoomCount
            });
        } catch (error) {
            logger.error(`❌ Erro ao notificar driver ${driverId}:`, error);
            // Limpar corrida ativa na tela em caso de erro
            try {
                await this.redis.del(`driver_active_notification:${driverId}`);
                await clearOfferReservation(this.redis, bookingId, driverId).catch(() => null);
                const lockedBooking = await driverLockManager.getLockedBooking(driverId);
                if (lockedBooking === bookingId) {
                    await driverLockManager.releaseLock(driverId);
                }
            } catch (cleanupError) {
                logger.error(`❌ Erro ao limpar corrida ativa após falha de notificação:`, cleanupError);
            }
            return this.finishNotificationOutcome(options, false, 'NOTIFY_EXCEPTION', {
                error: error?.message || 'unknown_error'
            });
        }
    }

    /**
     * Notificar múltiplos motoristas
     * @param {Array} drivers - Array de motoristas com scores
     * @param {string} bookingId - ID da corrida
     * @param {Object} bookingData - Dados completos da corrida
     * @param {number} limit - Limite de notificações bem-sucedidas (padrão 5)
     * @returns {Promise<{notified: number, failed: number}>}
     */
    async notifyMultipleDrivers(drivers, bookingId, bookingData, limit = 5, options = {}) {
        let notified = 0;
        let failed = 0;
        const notificationLog = [];
        const failureReasonCounts = {};
        const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 5);
        const notifyConcurrency = Math.max(1, DISPATCH_NOTIFY_CONCURRENCY);
        let cursor = 0;
        const waveTrace = options?.dispatchTrace?.type === 'wave'
            ? await beginDispatchWave(this.redis, bookingId, {
                radiusKm: options?.dispatchTrace?.radiusKm || 0,
                candidateCount: options?.dispatchTrace?.candidateCount || drivers.length,
                limit: normalizedLimit,
                bookingState: options?.dispatchTrace?.bookingState || null,
                source: options?.dispatchTrace?.source || 'gradual_expander',
                timestampMs: Date.now()
            })
            : null;

        logStructured('info', 'Iniciando notificações para motoristas', {
            service: 'driver-notification-dispatcher',
            bookingId,
            totalDrivers: drivers.length,
            pickupLocation: bookingData.pickupLocation,
            estimatedFare: bookingData.estimatedFare
        });

        while (cursor < drivers.length && notified < normalizedLimit) {
            const dispatchability = await this.getDispatchability(bookingId, bookingData);
            if (!dispatchability.ok) {
                logStructured('warn', `Parando notifyMultipleDrivers para ${bookingId}: ${dispatchability.reason}`, {
                    service: 'driver-notification-dispatcher',
                    bookingId,
                    reason: dispatchability.reason,
                    state: dispatchability.state || null
                });
                break;
            }

            const remainingSuccessBudget = normalizedLimit - notified;
            const remainingDrivers = drivers.length - cursor;
            const batchSize = Math.min(notifyConcurrency, remainingSuccessBudget, remainingDrivers);
            const batch = drivers.slice(cursor, cursor + batchSize);
            const batchStartIndex = cursor;
            cursor += batchSize;

            const batchDispatchability = dispatchability;

            const batchResults = await Promise.all(batch.map(async (driver, idx) => {
                const driverNumber = batchStartIndex + idx + 1;
                logStructured('debug', `Notificando motorista ${driverNumber}/${drivers.length}`, {
                    service: 'driver-notification-dispatcher',
                    driverId: driver.driverId,
                    bookingId,
                    distance: driver.distance,
                    score: driver.score
                });

                const startTime = Date.now();
                let outcomeMeta = null;
                const result = await this.notifyDriver(
                    driver.driverId,
                    bookingId,
                    {
                        ...bookingData,
                        score: driver.score,
                        driverDistanceToPickupKm: driver.distance,
                        estimatedArrivalToPickupMin: Number.isFinite(driver.distance)
                            ? Math.max(1, Math.round(driver.distance / 0.45))
                            : null
                    },
                    {
                        skipInitialDispatchabilityCheck: true,
                        precomputedDispatchability: batchDispatchability,
                        onNotificationOutcome: (meta) => {
                            outcomeMeta = meta;
                            if (typeof options?.onNotificationOutcome === 'function') {
                                options.onNotificationOutcome(meta);
                            }
                        }
                    }
                );
                return {
                    driver,
                    result,
                    duration: Date.now() - startTime,
                    outcomeMeta
                };
            }));

            for (const item of batchResults) {
                const { driver, result, duration, outcomeMeta } = item;
                const outcomeReason = String(outcomeMeta?.reason || (result ? 'NOTIFIED' : 'UNKNOWN')).trim() || 'UNKNOWN';
                if (result) {
                    notified++;
                    logStructured('debug', 'Notificação enviada com sucesso', {
                        service: 'driver-notification-dispatcher',
                        driverId: driver.driverId,
                        bookingId,
                        duration
                    });
                    notificationLog.push({
                        driverId: driver.driverId,
                        status: 'success',
                        reason: outcomeReason,
                        distance: driver.distance,
                        score: driver.score,
                        duration
                    });
                } else {
                    failed++;
                    incrementCounter(failureReasonCounts, outcomeReason);
                    logStructured('warn', 'Falha ao enviar notificação', {
                        service: 'driver-notification-dispatcher',
                        driverId: driver.driverId,
                        bookingId,
                        duration,
                        reason: outcomeReason
                    });
                    notificationLog.push({
                        driverId: driver.driverId,
                        status: 'failed',
                        reason: outcomeReason,
                        distance: driver.distance,
                        score: driver.score,
                        duration
                    });
                }
            }
        }

        logStructured('info', `Resumo de notificações: ${notified}/${drivers.length} sucessos, ${failed}/${drivers.length} falhas`, {
            service: 'driver-notification-dispatcher',
            bookingId,
            totalDrivers: drivers.length,
            notified,
            failed,
            notificationLog
        });

        logStructured('info', `${notified}/${drivers.length} motoristas notificados para ${bookingId} (${failed} falhas)`, {
            bookingId,
            totalDrivers: drivers.length,
            notified,
            failed,
            notificationLog
        });

        if (options?.dispatchTrace?.type === 'wave') {
            await recordDispatchWave(this.redis, bookingId, {
                waveNumber: waveTrace?.waveNumber,
                radiusKm: options?.dispatchTrace?.radiusKm || 0,
                candidateCount: options?.dispatchTrace?.candidateCount || drivers.length,
                notifiedCount: notified,
                failedCount: failed,
                failureReasons: failureReasonCounts,
                limit: normalizedLimit,
                bookingState: options?.dispatchTrace?.bookingState || null,
                source: options?.dispatchTrace?.source || 'gradual_expander',
                timestampMs: Date.now()
            });
        }

        return { notified, failed, notificationLog };
    }

    /**
     * Agendar timeout de resposta do motorista
     * @private
     */
    scheduleDriverTimeout(driverId, bookingId, timeoutSeconds) {
        const timeoutKey = `${bookingId}_${driverId}`;

        // Cancelar timeout anterior se existir
        const existingTimeout = this.timeoutHandlers.get(timeoutKey);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Timeout configurável para alinhar com lock TTL sem hardcode.
        const alignedTimeout = Math.max(
            1,
            Number.parseInt(timeoutSeconds, 10) || DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS
        );

        // Agendar novo timeout
        const timeoutId = setTimeout(async () => {
            try {
                const RideStateManager = require('./ride-state-manager');
                const currentState = await RideStateManager.getBookingState(this.redis, bookingId);

                // Verificar se corrida ainda está em janela de busca/resposta.
                if (
                    currentState === RideStateManager.STATES.SEARCHING ||
                    currentState === RideStateManager.STATES.EXPANDED ||
                    currentState === RideStateManager.STATES.NOTIFIED ||
                    currentState === RideStateManager.STATES.AWAITING_RESPONSE
                ) {

                    // ✅ Limpar corrida ativa na tela do motorista (timeout)
                    await this.redis.del(`driver_active_notification:${driverId}`);
                    await clearOfferReservation(this.redis, bookingId, driverId).catch(() => null);

                    // ✅ Liberar lock órfão desta corrida para permitir novos dispatches.
                    const lockedBooking = await driverLockManager.getLockedBooking(driverId);
                    if (lockedBooking === bookingId) {
                        await driverLockManager.releaseLock(driverId);
                        logger.debug(`🔓 [Dispatcher] Lock liberado por timeout para driver ${driverId} (booking: ${bookingId})`);
                    }

                    const bookingKey = `booking:${bookingId}`;
                    const resumeStateRaw = await this.redis.hget(bookingKey, 'awaitingResponsePreviousState');
                    const resumeState = this.normalizeAwaitingResponseResumeState(resumeStateRaw);

                    if (
                        currentState === RideStateManager.STATES.NOTIFIED ||
                        currentState === RideStateManager.STATES.AWAITING_RESPONSE
                    ) {
                        await RideStateManager.updateBookingState(
                            this.redis,
                            bookingId,
                            resumeState,
                            {
                                timeoutDriverId: driverId,
                                timeoutAt: new Date().toISOString()
                            }
                        );
                    }

                    await this.redis.hset(`booking:${bookingId}`, {
                        timeoutDriverId: driverId,
                        timeoutAt: new Date().toISOString(),
                        awaitingResponseResolvedAt: new Date().toISOString()
                    });
                    await this.redis.hdel(
                        bookingKey,
                        'awaitingResponseDriverId',
                        'awaitingResponseAt'
                    );
                    logger.info(
                        `⏰ [Dispatcher] Timeout de resposta para driver ${driverId} (booking: ${bookingId}, retomando ${resumeState})`
                    );

                    // Registrar evento
                    await eventSourcing.recordEvent(
                        EVENT_TYPES.DRIVER_TIMEOUT,
                        {
                            bookingId,
                            driverId,
                            timeoutAt: new Date().toISOString()
                        }
                    );
                } else {
                    // Estado já mudou (corrida aceita, cancelada, etc.)
                    logger.debug(`ℹ️ [Dispatcher] Timeout para driver ${driverId} (booking: ${bookingId}), mas estado já é ${currentState}`);
                }
            } catch (error) {
                logger.error(`❌ Erro ao processar timeout para driver ${driverId}:`, error);
            } finally {
                this.timeoutHandlers.delete(timeoutKey);
            }
        }, alignedTimeout * 1000);

        this.timeoutHandlers.set(timeoutKey, timeoutId);
    }

    /**
     * Cancelar timeout de resposta (quando motorista responde)
     * @param {string} driverId - ID do motorista
     * @param {string} bookingId - ID da corrida
     */
    cancelDriverTimeout(driverId, bookingId) {
        const timeoutKey = `${bookingId}_${driverId}`;
        const timeoutId = this.timeoutHandlers.get(timeoutKey);

        if (timeoutId) {
            clearTimeout(timeoutId);
            this.timeoutHandlers.delete(timeoutKey);
            logger.debug(`✅ [Dispatcher] Timeout cancelado para driver ${driverId} (booking: ${bookingId})`);
        }
    }

    /**
     * Limpar todos os timeouts de uma corrida
     * @param {string} bookingId - ID da corrida
     */
    clearAllTimeouts(bookingId) {
        let cleared = 0;

        for (const [key, timeoutId] of this.timeoutHandlers.entries()) {
            if (key.startsWith(`${bookingId}_`)) {
                clearTimeout(timeoutId);
                this.timeoutHandlers.delete(key);
                cleared++;
            }
        }

        if (cleared > 0) {
            logger.debug(`🧹 [Dispatcher] ${cleared} timeouts cancelados para booking ${bookingId}`);
        }
    }

    /**
     * Limpar notificação ativa na tela do motorista
     * @param {string} driverId - ID do motorista
     */
    async clearActiveNotification(driverId) {
        try {
            const activeNotificationKey = `driver_active_notification:${driverId}`;
            const activeBookingId = await this.redis.get(activeNotificationKey);

            if (activeBookingId) {
                await this.redis.del(activeNotificationKey);
                await clearOfferReservation(this.redis, activeBookingId, driverId).catch(() => null);
                logger.debug(`🧹 [Dispatcher] Notificação ativa limpa para driver ${driverId} (era: ${activeBookingId})`);

                // Opcional: Notificar o driver via socket que a notificação expirou/foi cancelada
                if (this.io) {
                    this.io.to(`driver_${driverId}`).emit('clearRideRequest', { rideId: activeBookingId });
                }
            }
        } catch (error) {
            logger.error(`❌ Erro ao limpar notificação ativa para driver ${driverId}:`, error);
        }
    }
}

module.exports = DriverNotificationDispatcher;
