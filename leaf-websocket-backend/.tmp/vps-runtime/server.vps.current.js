// server.js
// Servidor principal integrado com GraphQL

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '.env') });

// Canonicaliza REDIS_URL para evitar divergência entre módulos (ex.: fallback para redis-master).
if (process.env.REDIS_HOST && process.env.REDIS_PASSWORD && process.env.REDIS_CANONICAL_URL !== 'false') {
    const redisPort = process.env.REDIS_PORT || '6379';
    const redisDb = process.env.REDIS_DB || '0';
    process.env.REDIS_URL = `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD)}@${process.env.REDIS_HOST}:${redisPort}/${redisDb}`;
}

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const cluster = require('cluster');
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');
const cors = require('cors');
const admin = require('firebase-admin');

// Importar GraphQL
const { applyMiddleware } = require('./graphql/server');

// Importar rotas de monitoramento do cache
const cacheMonitoring = require('./routes/cache-monitoring');

// Importar rotas de autenticação
const authRoutes = require('./routes/auth-routes');
const customOtpRoutes = require('./routes/auth-otp');

// Importar rotas de autenticação admin (JWT)
const adminAuthRoutes = require('./routes/admin-auth');

// Importar rotas KYC
const kycRoutes = require('./routes/kyc-routes');

// Importar rotas KYC Proxy
const kycProxyRoutes = require('./routes/kyc-proxy-routes');

// Importar rotas KYC Analytics
const kycAnalyticsRoutes = require('./routes/kyc-analytics-routes');

// Importar rotas Dashboard
const dashboardRoutes = require('./routes/dashboard');

// Importar rotas de Métricas
const metricsRoutes = require('./routes/metrics');

// Importar rotas Waitlist
const waitlistRoutes = require('./routes/waitlist');
// const metricsRoutes = require('./routes/metrics'); // ✅ Já importado acima

// Importar rotas de verificação de status do driver
const driverStatusCheckRoutes = require('./routes/driver-status-check');

// Importar rotas de drivers
const driversRoutes = require('./routes/drivers');
const driverActivationRoutes = require('./routes/driver-activation');

// Importar rotas de Notificações
const notificationsRoutes = require('./routes/notifications');

// Importar rotas de Alertas
const alertsRoutes = require('./routes/alerts');

// Importar rotas de Health Check
const healthRoutes = require('./routes/health');

// Importar logger primeiro (necessário para logs abaixo)
const { logStructured, logError, logCommand, logEvent } = require('./utils/logger');

// Importar rotas de Places Cache (com feature flag)
let placesRoutes = null;
try {
    placesRoutes = require('./routes/places-routes');
    logStructured('info', 'Rotas de Places Cache carregadas', { service: 'server' });
} catch (error) {
    logStructured('warn', 'Rotas de Places Cache não disponíveis', { service: 'server', error: error.message });
}

// ==================== IMPORTAÇÕES FASE 7: SISTEMA DE FILAS E MATCHING ====================
// Importar serviços do sistema de filas e matching
const rideQueueManager = require('./services/ride-queue-manager');
const GradualRadiusExpander = require('./services/gradual-radius-expander');
const ResponseHandler = require('./services/response-handler');
const RadiusExpansionManager = require('./services/radius-expansion-manager');
const RideStateManager = require('./services/ride-state-manager');
const redisPool = require('./utils/redis-pool');
const GeoHashUtils = require('./utils/geohash-utils');
const connectionMonitor = require('./services/connection-monitor');
const PaymentService = require('./services/payment-service');
const rateLimiterService = require('./services/rate-limiter-service');
const auditService = require('./services/audit-service');
const validationService = require('./services/validation-service');
const idempotencyService = require('./services/idempotency-service');
const ConnectionCleanupService = require('./services/connection-cleanup-service');
const vehicleLockManager = require('./services/vehicle-lock-manager');
const driverLockManager = require('./services/driver-lock-manager');
const FCMService = require('./services/fcm-service');
const { clearActiveTripForDriver, resolveActiveTripForDriver } = require('./utils/active-trip-index');
const fcmService = new FCMService(); // Singleton local ao worker
// =========================================================================================

// ==================== IMPORTAÇÕES REFATORAÇÃO: COMMANDS E LISTENERS ====================
const setupListeners = require('./listeners/setupListeners');
const { getEventBus } = require('./listeners');
const notifyDriversInline = require('./listeners/onRideRequested.notifyDrivers');
const RequestRideCommand = require('./commands/RequestRideCommand');
const AcceptRideCommand = require('./commands/AcceptRideCommand');
const StartTripCommand = require('./commands/StartTripCommand');
const CompleteTripCommand = require('./commands/CompleteTripCommand');
const CancelRideCommand = require('./commands/CancelRideCommand');
// =======================================================================================

// ==================== IMPORTAÇÕES WORKERS E ESCALABILIDADE ====================
const WorkerManager = require('./workers/WorkerManager');
const { EVENT_TYPES } = require('./events');
// ==============================================================================

// ==================== IMPORTAÇÕES FASE 1: OBSERVABILIDADE ====================
const traceContext = require('./utils/trace-context');
// logStructured e logError já importados acima
const { traceIdSocketMiddleware, traceIdExpressMiddleware, extractTraceIdFromEvent } = require('./middleware/trace-id-middleware');
// ==================== FASE 1.3: OPENTELEMETRY ====================
const { initializeTracer, getTracer, shutdown: shutdownTracer } = require('./utils/tracer');
const {
    createSocketSpan,
    createCommandSpan,
    createEventSpan,
    createListenerSpan,
    createRedisSpan,
    createCircuitBreakerSpan,
    endSpanSuccess,
    endSpanError,
    addSpanEvent,
    runInSpan
} = require('./utils/span-helpers');
// =======================================================================================

// ==================== IMPORTAÇÕES FASE 8: QUEUE WORKER ====================
const QueueWorker = require('./services/queue-worker');
// ===========================================================================

// ==================== IMPORTAÇÕES FASE 10: OTIMIZAÇÕES E MONITORAMENTO ====================
const metricsCollector = require('./services/metrics-collector');
const queueMonitoringRoutes = require('./routes/queue-monitoring');
const IntegratedKYCService = require('./services/IntegratedKYCService');
const { recordIngest, getStatus: getOtelIngestStatus } = require('./utils/otel-ingest-monitor');
const { metrics: runtimeMetrics } = require('./utils/prometheus-metrics');
// ============================================================================================

function recordRealtimeMetricSafe(channel, result, count = 1) {
    try {
        runtimeMetrics.recordRealtimeUpdate(channel, result, count);
    } catch (error) {
        if (process.env.DEBUG_OBSERVABILITY_METRICS === 'true') {
            logStructured('debug', 'Falha ao registrar métrica realtime', {
                service: 'observability',
                channel,
                result,
                error: error.message
            });
        }
    }
}

function recordHotpathLatencySafe(pathName, durationMs, success = true) {
    const durationSeconds = Number(durationMs) / 1000;
    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0;
    try {
        runtimeMetrics.recordHotpathLatency(pathName, safeDuration, success);
    } catch (error) {
        if (process.env.DEBUG_OBSERVABILITY_METRICS === 'true') {
            logStructured('debug', 'Falha ao registrar latência hotpath', {
                service: 'observability',
                path: pathName,
                durationMs,
                success,
                error: error.message
            });
        }
    }
}

// Configurações otimizadas para VPS com recursos limitados
const VPS_CONFIG = {
    MAX_CONNECTIONS: 10000, // Reduzido para VPS
    MAX_REQUESTS_PER_SECOND: 5000, // Reduzido para VPS
    CLUSTER_WORKERS: Math.min(os.cpus().length, 2), // Máximo 2 workers para VPS
    MEMORY_LIMIT: '512MB', // Limite de memória para VPS
    TIMEOUT: 30000 // Timeout aumentado para conexões mais lentas
};

const CLUSTER_ENABLED =
    String(process.env.LEAF_CLUSTER_ENABLED || 'false').toLowerCase() === 'true' &&
    process.env.NODE_ENV === 'production';
const CLUSTER_WORKERS = Math.max(
    1,
    Number.parseInt(process.env.LEAF_CLUSTER_WORKERS || String(VPS_CONFIG.CLUSTER_WORKERS), 10) || VPS_CONFIG.CLUSTER_WORKERS
);
const CLUSTER_SCHEDULER_LEADER_ID = Math.max(
    1,
    Number.parseInt(process.env.LEAF_CLUSTER_SCHEDULER_LEADER_ID || '1', 10) || 1
);
const IS_CLUSTER_PRIMARY = CLUSTER_ENABLED && (cluster.isPrimary || cluster.isMaster);

// Cache curto para reduzir custo de verifyIdToken em picos de reconexão/reautenticação.
const AUTH_TOKEN_CACHE_TTL_MS = Number.parseInt(process.env.AUTH_TOKEN_CACHE_TTL_MS || '120000', 10);
const AUTH_TOKEN_CACHE_MAX = Number.parseInt(process.env.AUTH_TOKEN_CACHE_MAX || '5000', 10);
const AUTH_CONTEXT_STATE = {
    AUTHENTICATED: 'authenticated',
    CACHED: 'cached'
};
const authTokenCache = new Map();
const authTokenVerifyInFlight = new Map();
const integratedKYCService = new IntegratedKYCService();
const paymentServiceSingleton = new PaymentService();
const paymentDispatchService = require('./services/payment-dispatch-service');
const SESSION_LOCK_TTL_MS = Number.parseInt(process.env.SESSION_LOCK_TTL_MS || '5000', 10);
const SESSION_LOCK_MAX_ATTEMPTS = Number.parseInt(process.env.SESSION_LOCK_MAX_ATTEMPTS || '25', 10);
const SESSION_LOCK_RETRY_MS = Number.parseInt(process.env.SESSION_LOCK_RETRY_MS || '25', 10);

// Admission control para reduzir picos de handshake/socket em bursts.
const SOCKET_ADMISSION_ENABLED = process.env.SOCKET_ADMISSION_ENABLED !== 'false';
const SOCKET_ADMISSION_MAX_INFLIGHT = Number.parseInt(process.env.SOCKET_ADMISSION_MAX_INFLIGHT || '220', 10);
const SOCKET_ADMISSION_MAX_QUEUE = Number.parseInt(process.env.SOCKET_ADMISSION_MAX_QUEUE || '1200', 10);
const SOCKET_ADMISSION_MAX_WAIT_MS = Number.parseInt(process.env.SOCKET_ADMISSION_MAX_WAIT_MS || '2500', 10);
const SOCKET_ADMISSION_HOLD_MS = Number.parseInt(process.env.SOCKET_ADMISSION_HOLD_MS || '10000', 10);
let socketAdmissionInFlight = 0;
const socketAdmissionQueue = [];

const ENABLE_LEGACY_RUNTIME_ENDPOINTS =
    String(process.env.ENABLE_LEGACY_RUNTIME_ENDPOINTS || 'false').toLowerCase() === 'true';
const ENABLE_LEGACY_UPDATE_DRIVER_LOCATION_EVENT =
    String(process.env.ENABLE_LEGACY_UPDATE_DRIVER_LOCATION_EVENT || 'false').toLowerCase() === 'true';
const ENABLE_LEGACY_NO_DRIVERS_FOUND_EVENT =
    String(process.env.ENABLE_LEGACY_NO_DRIVERS_FOUND_EVENT || 'false').toLowerCase() === 'true';
const ENABLE_SOCKETIO_REDIS_ADAPTER =
    String(process.env.ENABLE_SOCKETIO_REDIS_ADAPTER || 'true').toLowerCase() !== 'false';
const ENABLE_DIRECT_RIDE_REQUESTED_DISPATCH =
    String(process.env.ENABLE_DIRECT_RIDE_REQUESTED_DISPATCH || 'true').toLowerCase() === 'true';
const RUNTIME_ROLE = String(process.env.RUNTIME_ROLE || 'gateway').trim().toLowerCase();
const ENABLE_EMBEDDED_LISTENER_WORKERS =
    String(
        process.env.ENABLE_EMBEDDED_LISTENER_WORKERS ||
        (RUNTIME_ROLE === 'gateway' ? 'true' : 'false')
    ).toLowerCase() === 'true';

// Lane dedicada para autenticação para evitar rajadas de verifyIdToken simultâneas.
const AUTH_VERIFY_ADMISSION_ENABLED = process.env.AUTH_VERIFY_ADMISSION_ENABLED !== 'false';
const AUTH_VERIFY_MAX_INFLIGHT = Number.parseInt(process.env.AUTH_VERIFY_MAX_INFLIGHT || '160', 10);
const AUTH_VERIFY_MAX_QUEUE = Number.parseInt(process.env.AUTH_VERIFY_MAX_QUEUE || '1200', 10);
const AUTH_VERIFY_MAX_WAIT_MS = Number.parseInt(process.env.AUTH_VERIFY_MAX_WAIT_MS || '6000', 10);
const AUTH_VERIFY_BUSY_RETRY_ATTEMPTS = Math.max(
    0,
    Number.parseInt(process.env.AUTH_VERIFY_BUSY_RETRY_ATTEMPTS || '1', 10) || 1
);
const AUTH_VERIFY_BUSY_RETRY_DELAY_MS = Math.max(
    50,
    Number.parseInt(process.env.AUTH_VERIFY_BUSY_RETRY_DELAY_MS || '250', 10) || 250
);
const AUTH_BUSY_RETRY_AFTER_SEC = Math.max(
    1,
    Number.parseInt(process.env.AUTH_BUSY_RETRY_AFTER_SEC || '2', 10) || 2
);
let authVerifyInFlight = 0;
const authVerifyQueue = [];

// Realtime hot state/cache controls (presença/localização)
const DRIVER_STATE_HOT_CACHE_TTL_MS = Number.parseInt(process.env.DRIVER_STATE_HOT_CACHE_TTL_MS || '1000', 10);
const DRIVER_STATE_HOT_CACHE_MAX = Number.parseInt(process.env.DRIVER_STATE_HOT_CACHE_MAX || '20000', 10);
const UPDATE_LOCATION_RATE_LIMIT_CACHE_MS = Number.parseInt(process.env.UPDATE_LOCATION_RATE_LIMIT_CACHE_MS || '1000', 10);
const DRIVER_UPDATE_MIN_INTERVAL_MS = Number.parseInt(process.env.DRIVER_UPDATE_MIN_INTERVAL_MS || '350', 10);
const DRIVER_UPDATE_MIN_INTERVAL_TRIP_MS = Number.parseInt(process.env.DRIVER_UPDATE_MIN_INTERVAL_TRIP_MS || '200', 10);
const DRIVER_UPDATE_MIN_DISTANCE_METERS = Number.parseFloat(process.env.DRIVER_UPDATE_MIN_DISTANCE_METERS || '8');
const DRIVER_UPDATE_MIN_DISTANCE_TRIP_METERS = Number.parseFloat(process.env.DRIVER_UPDATE_MIN_DISTANCE_TRIP_METERS || '2');
const VEHICLE_LOCK_RECOVERY_COOLDOWN_MS = Number.parseInt(process.env.VEHICLE_LOCK_RECOVERY_COOLDOWN_MS || '12000', 10);
const VEHICLE_LOCK_RECOVERY_FIREBASE_LOOKUP_ENABLED =
    String(process.env.VEHICLE_LOCK_RECOVERY_FIREBASE_LOOKUP_ENABLED || 'true').toLowerCase() !== 'false';
const DRIVER_DISCONNECT_GRACE_MS = Math.max(
    0,
    Number.parseInt(process.env.DRIVER_DISCONNECT_GRACE_MS || '25000', 10) || 25000
);
const DRIVER_BOARDING_WINDOW_SECONDS = Math.max(
    30,
    Number.parseInt(process.env.DRIVER_BOARDING_WINDOW_SECONDS || '120', 10) || 120
);
const TRIP_INTEGRITY_ENABLED =
    String(process.env.TRIP_INTEGRITY_ENABLED || 'true').toLowerCase() !== 'false';
const TRIP_INTEGRITY_DISTANCE_THRESHOLD_METERS = Math.max(
    50,
    Number.parseInt(process.env.TRIP_INTEGRITY_DISTANCE_THRESHOLD_METERS || '220', 10) || 220
);
const TRIP_INTEGRITY_LOCATION_STALE_MS = Math.max(
    5000,
    Number.parseInt(process.env.TRIP_INTEGRITY_LOCATION_STALE_MS || '45000', 10) || 45000
);
const TRIP_INTEGRITY_CONSECUTIVE_BREACH_LIMIT = Math.max(
    1,
    Number.parseInt(process.env.TRIP_INTEGRITY_CONSECUTIVE_BREACH_LIMIT || '3', 10) || 3
);
const TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS = Math.max(
    5000,
    Number.parseInt(process.env.TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS || '20000', 10) || 20000
);
const TRIP_INTEGRITY_SOFT_BAN_SECONDS = Math.max(
    60,
    Number.parseInt(process.env.TRIP_INTEGRITY_SOFT_BAN_SECONDS || '300', 10) || 300
);
const AUTH_PUSH_ACTIVE_RIDE_SYNC = String(process.env.AUTH_PUSH_ACTIVE_RIDE_SYNC || 'true').toLowerCase() !== 'false';
const EVENT_LOOP_LAG_SAMPLE_MS = Number.parseInt(process.env.EVENT_LOOP_LAG_SAMPLE_MS || '1000', 10);
const EVENT_LOOP_LAG_RESOLUTION_MS = Number.parseInt(process.env.EVENT_LOOP_LAG_RESOLUTION_MS || '20', 10);

const driverStateHotCache = new Map();
const updateLocationRateLimitCache = new Map();
const driverRealtimeUpdateGateCache = new Map();
const vehicleLockRecoveryAttemptCache = new Map();
const pendingDriverDisconnectCleanup = new Map();
const pendingBoardingWindowTimeouts = new Map();
const pendingTripIntegrityConfirmTimeouts = new Map();

function fingerprintToken(token) {
    if (!token || typeof token !== 'string') return '';
    return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanupAuthTokenCache() {
    const now = Date.now();
    for (const [tokenHash, cached] of authTokenCache.entries()) {
        if (!cached || cached.expiresAt <= now) {
            authTokenCache.delete(tokenHash);
        }
    }
    if (authTokenCache.size > AUTH_TOKEN_CACHE_MAX) {
        const overflow = authTokenCache.size - AUTH_TOKEN_CACHE_MAX;
        let dropped = 0;
        for (const tokenHash of authTokenCache.keys()) {
            authTokenCache.delete(tokenHash);
            dropped += 1;
            if (dropped >= overflow) break;
        }
    }
}

function trimHotMapIfNeeded(mapRef, maxItems) {
    if (!mapRef || mapRef.size <= maxItems) return;
    const overflow = mapRef.size - maxItems;
    let dropped = 0;
    for (const key of mapRef.keys()) {
        mapRef.delete(key);
        dropped += 1;
        if (dropped >= overflow) break;
    }
}

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeVehiclePlate(plate) {
    return String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
    const nLat1 = toFiniteNumber(lat1);
    const nLng1 = toFiniteNumber(lng1);
    const nLat2 = toFiniteNumber(lat2);
    const nLng2 = toFiniteNumber(lng2);
    if ([nLat1, nLng1, nLat2, nLng2].some((v) => v === null)) return Number.POSITIVE_INFINITY;

    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(nLat2 - nLat1);
    const dLng = toRad(nLng2 - nLng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2))
        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const earthRadiusMeters = 6371000;
    return earthRadiusMeters * c;
}

function clearBoardingWindowTimeout(bookingId) {
    if (!bookingId) return;
    const existingTimeout = pendingBoardingWindowTimeouts.get(bookingId);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        pendingBoardingWindowTimeouts.delete(bookingId);
    }
}

function scheduleBoardingWindowTimeout({
    io,
    bookingId,
    customerId,
    driverId,
    pickupAddress,
    deadlineAtMs
}) {
    if (!bookingId || !io) return;

    clearBoardingWindowTimeout(bookingId);
    const delayMs = Math.max(1000, Number(deadlineAtMs) - Date.now());

    const timeoutId = setTimeout(async () => {
        pendingBoardingWindowTimeouts.delete(bookingId);
        clearTripIntegrityConfirmationTimeout(bookingId);

        try {
            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();
            const bookingKey = `booking:${bookingId}`;
            const bookingData = await redis.hgetall(bookingKey);
            if (!bookingData || Object.keys(bookingData).length === 0) {
                return;
            }

            const stateUpper = String(bookingData.state || '').trim().toUpperCase();
            const statusUpper = String(bookingData.status || '').trim().toUpperCase();
            const activeStates = new Set(['ARRIVED', 'DRIVER_ARRIVED', 'ACCEPTED']);
            const terminalStates = new Set(['IN_PROGRESS', 'STARTED', 'COMPLETED', 'CANCELED', 'CANCELLED', 'REJECTED']);
            if (terminalStates.has(stateUpper) || terminalStates.has(statusUpper)) {
                return;
            }
            if (!activeStates.has(stateUpper) && !activeStates.has(statusUpper)) {
                return;
            }

            const resolvedCustomerId = customerId || bookingData.customerId || null;
            const resolvedDriverId = driverId || bookingData.driverId || null;
            const cancelledAt = new Date().toISOString();
            const cancelReason = 'Tempo de embarque expirado';

            await RideStateManager.updateBookingState(
                redis,
                bookingId,
                RideStateManager.STATES.CANCELED,
                {
                    canceledBy: 'system',
                    reason: cancelReason,
                    cancellationFee: 0,
                    cancelledAt
                }
            );
            await redis.hset(bookingKey, {
                status: 'CANCELED',
                state: 'CANCELED',
                canceledBy: 'system',
                reason: cancelReason,
                cancellationFee: '0',
                cancelledAt
            });
            await redis.hdel('bookings:active', bookingId);
            await redis.del(`booking_search:${bookingId}`);

            if (resolvedDriverId) {
                try {
                    await driverLockManager.releaseLock(resolvedDriverId);
                } catch (_releaseError) {
                    // best effort
                }
                try {
                    await clearActiveTripForDriver(redis, resolvedDriverId, bookingId);
                } catch (_clearTripError) {
                    // best effort
                }
            }

            const expirationPayload = {
                success: true,
                bookingId,
                reason: 'BOARDING_WINDOW_EXPIRED',
                message: 'Tempo de embarque expirou. A corrida foi cancelada automaticamente.',
                pickupAddress: pickupAddress || bookingData?.pickupLocation?.add || 'local de embarque',
                deadlineAt: new Date(deadlineAtMs).toISOString(),
                timestamp: new Date().toISOString()
            };

            if (resolvedCustomerId) {
                io.to(`customer_${resolvedCustomerId}`).emit('boardingWindowExpired', expirationPayload);
                io.to(`customer_${resolvedCustomerId}`).emit('rideCancelled', expirationPayload);
            }
            if (resolvedDriverId) {
                io.to(`driver_${resolvedDriverId}`).emit('boardingWindowExpired', expirationPayload);
                io.to(`driver_${resolvedDriverId}`).emit('rideCancelled', expirationPayload);
            }

            logStructured('warn', 'Janela de embarque expirada - corrida cancelada automaticamente', {
                service: 'server',
                bookingId,
                customerId: resolvedCustomerId,
                driverId: resolvedDriverId,
                deadlineAt: new Date(deadlineAtMs).toISOString(),
                eventType: 'boardingWindowExpired'
            });
        } catch (error) {
            logStructured('error', 'Falha ao processar expiração da janela de embarque', {
                service: 'server',
                bookingId,
                error: error.message,
                eventType: 'boardingWindowExpired'
            });
        }
    }, delayMs);

    pendingBoardingWindowTimeouts.set(bookingId, timeoutId);
}

function clearTripIntegrityConfirmationTimeout(bookingId) {
    if (!bookingId) return;
    const timeoutId = pendingTripIntegrityConfirmTimeouts.get(bookingId);
    if (timeoutId) {
        clearTimeout(timeoutId);
        pendingTripIntegrityConfirmTimeouts.delete(bookingId);
    }
}

function parseIntegrityTimestampMs(value) {
    if (value == null) return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsedDate = Date.parse(String(value));
    return Number.isFinite(parsedDate) ? parsedDate : null;
}

function parseIntegrityLocation(snapshot, prefix) {
    if (!snapshot || !prefix) return null;
    const lat = Number(snapshot[`${prefix}Lat`]);
    const lng = Number(snapshot[`${prefix}Lng`]);
    const at = parseIntegrityTimestampMs(snapshot[`${prefix}At`]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(at)) {
        return null;
    }
    return { lat, lng, at };
}

function isTripIntegrityMonitoringState(stateOrStatus) {
    const normalized = String(stateOrStatus || '').trim().toUpperCase();
    return normalized === 'STARTED' || normalized === 'IN_PROGRESS';
}

async function cancelRideForTripIntegrityViolation({
    io,
    redis,
    bookingId,
    driverId,
    customerId,
    reasonCode,
    reasonMessage
}) {
    if (!TRIP_INTEGRITY_ENABLED || !bookingId || !redis || !io) {
        return { success: false, skipped: true, reason: 'NOT_ENABLED_OR_INVALID' };
    }

    const cancelLockKey = `trip_integrity_cancel_lock:${bookingId}`;
    const lockAcquired = await redis.set(cancelLockKey, String(Date.now()), 'NX', 'EX', 20);
    if (!lockAcquired) {
        return { success: false, skipped: true, reason: 'LOCK_ALREADY_HELD' };
    }

    clearTripIntegrityConfirmationTimeout(bookingId);

    let bookingData = null;
    let resolvedDriverId = driverId || null;
    let resolvedCustomerId = customerId || null;

    try {
        bookingData = await redis.hgetall(`booking:${bookingId}`);
        if (bookingData && Object.keys(bookingData).length > 0) {
            resolvedDriverId = resolvedDriverId || bookingData.driverId || null;
            resolvedCustomerId = resolvedCustomerId || bookingData.customerId || null;
        }

        const currentState = await RideStateManager.getBookingState(redis, bookingId);
        const stateUpper = String(currentState || '').trim().toUpperCase();
        const statusUpper = String(bookingData?.status || '').trim().toUpperCase();
        const alreadyTerminal = new Set(['COMPLETED', 'CANCELED', 'CANCELLED', 'REJECTED']);
        if (alreadyTerminal.has(stateUpper) || alreadyTerminal.has(statusUpper)) {
            return { success: false, skipped: true, reason: 'BOOKING_ALREADY_TERMINAL' };
        }

        const tripIntegrityReason = reasonMessage || 'Corrida cancelada por divergência de localização entre motorista e passageiro.';
        const command = new CancelRideCommand({
            bookingId,
            canceledBy: 'system_trip_integrity',
            reason: tripIntegrityReason,
            cancellationFee: 0,
            traceId: traceContext.generateTraceId('trip_integrity_cancel'),
            correlationId: bookingId,
            userType: 'system'
        });

        const cancelResult = await command.execute();
        if (!cancelResult?.success) {
            logStructured('error', 'CancelRideCommand falhou no cancelamento por tripIntegrity', {
                service: 'trip-integrity',
                bookingId,
                reasonCode,
                error: cancelResult?.error || 'unknown_cancel_command_failure'
            });
            recordRealtimeMetricSafe('trip_integrity', 'cancel_failed');
            return { success: false, error: cancelResult?.error || 'CANCEL_COMMAND_FAILED' };
        }

        const rideCanceledEvent = cancelResult?.data?.event || null;
        if (rideCanceledEvent) {
            try {
                await eventBus.publish({
                    eventType: 'ride.canceled',
                    data: rideCanceledEvent
                });
            } catch (eventPublishError) {
                logStructured('warn', 'Falha ao publicar ride.canceled no cancelamento por tripIntegrity', {
                    service: 'trip-integrity',
                    bookingId,
                    reasonCode,
                    error: eventPublishError.message
                });
            }
        }

        if (resolvedDriverId) {
            await redis.set(`driver_soft_ban:${resolvedDriverId}`, String(Date.now()), 'EX', TRIP_INTEGRITY_SOFT_BAN_SECONDS);
        }

        const payload = {
            success: true,
            bookingId,
            reason: reasonCode || 'TRIP_INTEGRITY_VIOLATION',
            message: tripIntegrityReason,
            driverSoftBanSec: resolvedDriverId ? TRIP_INTEGRITY_SOFT_BAN_SECONDS : 0,
            timestamp: new Date().toISOString()
        };

        if (resolvedCustomerId) {
            io.to(`customer_${resolvedCustomerId}`).emit('tripIntegrityCancelled', payload);
            io.to(`customer_${resolvedCustomerId}`).emit('rideCancelled', payload);
        }
        if (resolvedDriverId) {
            io.to(`driver_${resolvedDriverId}`).emit('tripIntegrityCancelled', payload);
            io.to(`driver_${resolvedDriverId}`).emit('rideCancelled', payload);
        }

        const tripIntegrityKey = `trip_integrity:${bookingId}`;
        await redis.hset(tripIntegrityKey, {
            divergenceCount: '0',
            alertOpenAt: '',
            alertResolvedAt: String(Date.now()),
            lastCancellationAt: String(Date.now()),
            lastCancellationReason: payload.reason
        });
        await redis.expire(tripIntegrityKey, 6 * 60 * 60);
        recordRealtimeMetricSafe('trip_integrity', 'cancelled');

        logStructured('warn', 'Corrida cancelada por violação de tripulação', {
            service: 'trip-integrity',
            bookingId,
            driverId: resolvedDriverId,
            customerId: resolvedCustomerId,
            reasonCode: payload.reason,
            softBanSeconds: payload.driverSoftBanSec
        });

        return { success: true, payload };
    } catch (error) {
        logStructured('error', 'Erro ao cancelar corrida por tripIntegrity', {
            service: 'trip-integrity',
            bookingId,
            driverId: resolvedDriverId,
            customerId: resolvedCustomerId,
            reasonCode,
            error: error.message
        });
        recordRealtimeMetricSafe('trip_integrity', 'cancel_exception');
        return { success: false, error: error.message };
    }
}

function scheduleTripIntegrityConfirmationTimeout({
    io,
    bookingId,
    timeoutMs
}) {
    if (!TRIP_INTEGRITY_ENABLED || !io || !bookingId) return;
    clearTripIntegrityConfirmationTimeout(bookingId);

    const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS);
    const timeoutId = setTimeout(async () => {
        pendingTripIntegrityConfirmTimeouts.delete(bookingId);

        try {
            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();
            const integrityKey = `trip_integrity:${bookingId}`;
            const snapshot = await redis.hgetall(integrityKey);
            if (!snapshot || Object.keys(snapshot).length === 0) {
                return;
            }

            if (snapshot.alertOpenAt && !snapshot.alertResolvedAt && !snapshot.boardingConfirmedAt) {
                const bookingData = await redis.hgetall(`booking:${bookingId}`);
                await cancelRideForTripIntegrityViolation({
                    io,
                    redis,
                    bookingId,
                    driverId: bookingData?.driverId || null,
                    customerId: bookingData?.customerId || null,
                    reasonCode: 'TRIP_INTEGRITY_CONFIRMATION_TIMEOUT',
                    reasonMessage: 'Corrida cancelada por falta de confirmação de embarque após divergência de localização.'
                });
            }
        } catch (error) {
            logStructured('error', 'Erro ao processar timeout de confirmação de tripIntegrity', {
                service: 'trip-integrity',
                bookingId,
                error: error.message
            });
        }
    }, safeTimeoutMs);

    pendingTripIntegrityConfirmTimeouts.set(bookingId, timeoutId);
}

async function registerTripIntegrityLocationUpdate({
    io,
    redis,
    bookingId,
    driverId,
    customerId,
    driverLocation,
    passengerLocation
}) {
    if (!TRIP_INTEGRITY_ENABLED || !io || !redis || !bookingId) {
        return;
    }

    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    if (!bookingData || Object.keys(bookingData).length === 0) {
        return;
    }

    const state = await RideStateManager.getBookingState(redis, bookingId);
    const status = String(bookingData.status || '').trim().toUpperCase();
    if (!isTripIntegrityMonitoringState(state) && !isTripIntegrityMonitoringState(status)) {
        clearTripIntegrityConfirmationTimeout(bookingId);
        return;
    }

    const integrityKey = `trip_integrity:${bookingId}`;
    const nowTs = Date.now();
    const nextFields = {
        updatedAt: String(nowTs),
        driverId: String(driverId || bookingData.driverId || ''),
        customerId: String(customerId || bookingData.customerId || '')
    };

    if (
        driverLocation &&
        Number.isFinite(Number(driverLocation.lat)) &&
        Number.isFinite(Number(driverLocation.lng))
    ) {
        nextFields.driverLat = String(Number(driverLocation.lat));
        nextFields.driverLng = String(Number(driverLocation.lng));
        nextFields.driverAt = String(parseIntegrityTimestampMs(driverLocation.timestamp) || nowTs);
    }

    if (
        passengerLocation &&
        Number.isFinite(Number(passengerLocation.lat)) &&
        Number.isFinite(Number(passengerLocation.lng))
    ) {
        nextFields.passengerLat = String(Number(passengerLocation.lat));
        nextFields.passengerLng = String(Number(passengerLocation.lng));
        nextFields.passengerAt = String(parseIntegrityTimestampMs(passengerLocation.timestamp) || nowTs);
    }

    await redis.hset(integrityKey, nextFields);
    await redis.expire(integrityKey, 6 * 60 * 60);

    const snapshot = await redis.hgetall(integrityKey);
    const driverPoint = parseIntegrityLocation(snapshot, 'driver');
    const passengerPoint = parseIntegrityLocation(snapshot, 'passenger');

    if (!driverPoint || !passengerPoint) {
        return;
    }

    const staleThresholdMs = TRIP_INTEGRITY_LOCATION_STALE_MS;
    if ((nowTs - driverPoint.at) > staleThresholdMs || (nowTs - passengerPoint.at) > staleThresholdMs) {
        return;
    }

    const distanceMeters = Math.round(
        haversineDistanceMeters(driverPoint.lat, driverPoint.lng, passengerPoint.lat, passengerPoint.lng)
    );
    if (!Number.isFinite(distanceMeters)) {
        return;
    }

    const thresholdMeters = TRIP_INTEGRITY_DISTANCE_THRESHOLD_METERS;
    const parsedCount = Number.parseInt(snapshot.divergenceCount || '0', 10);
    const currentCount = Number.isFinite(parsedCount) ? Math.max(0, parsedCount) : 0;

    if (distanceMeters <= thresholdMeters) {
        await redis.hset(integrityKey, {
            divergenceCount: '0',
            alertOpenAt: '',
            alertResolvedAt: String(nowTs),
            lastDistanceMeters: String(distanceMeters),
            lastEvaluatedAt: String(nowTs)
        });
        clearTripIntegrityConfirmationTimeout(bookingId);
        recordRealtimeMetricSafe('trip_integrity', 'within_threshold');
        return;
    }

    const nextCount = currentCount + 1;
    await redis.hset(integrityKey, {
        divergenceCount: String(nextCount),
        lastDistanceMeters: String(distanceMeters),
        lastEvaluatedAt: String(nowTs)
    });

    recordRealtimeMetricSafe('trip_integrity', 'distance_breach');

    if (nextCount < TRIP_INTEGRITY_CONSECUTIVE_BREACH_LIMIT) {
        return;
    }

    const alertOpenAt = parseIntegrityTimestampMs(snapshot.alertOpenAt);
    const resolvedDriverId = String(snapshot.driverId || bookingData.driverId || driverId || '');
    const resolvedCustomerId = String(snapshot.customerId || bookingData.customerId || customerId || '');

    if (!alertOpenAt) {
        const payload = {
            success: true,
            bookingId,
            reason: 'TRIP_INTEGRITY_DISTANCE_DIVERGENCE',
            message: 'Detectamos divergência de localização. Você embarcou corretamente?',
            distanceMeters,
            thresholdMeters,
            confirmationTimeoutSec: Math.round(TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS / 1000),
            timestamp: new Date().toISOString()
        };

        await redis.hset(integrityKey, {
            alertOpenAt: String(nowTs),
            alertResolvedAt: '',
            lastAlertAt: String(nowTs),
            lastAlertDistanceMeters: String(distanceMeters)
        });
        await redis.expire(integrityKey, 6 * 60 * 60);

        if (resolvedCustomerId) {
            io.to(`customer_${resolvedCustomerId}`).emit('tripIntegrityCheckRequired', payload);
        }
        if (resolvedDriverId) {
            io.to(`driver_${resolvedDriverId}`).emit('tripIntegrityCheckRequired', {
                ...payload,
                message: 'Divergência de localização detectada. Aguarde confirmação do passageiro.'
            });
        }

        scheduleTripIntegrityConfirmationTimeout({
            io,
            bookingId,
            timeoutMs: TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS
        });

        logStructured('warn', 'Alerta de tripIntegrity emitido', {
            service: 'trip-integrity',
            bookingId,
            customerId: resolvedCustomerId || null,
            driverId: resolvedDriverId || null,
            distanceMeters,
            thresholdMeters,
            divergenceCount: nextCount
        });
        recordRealtimeMetricSafe('trip_integrity', 'alert_emitted');
        return;
    }

    const elapsedSinceAlertMs = nowTs - alertOpenAt;
    if (elapsedSinceAlertMs >= TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS) {
        await cancelRideForTripIntegrityViolation({
            io,
            redis,
            bookingId,
            driverId: resolvedDriverId || null,
            customerId: resolvedCustomerId || null,
            reasonCode: 'TRIP_INTEGRITY_DISTANCE_TIMEOUT',
            reasonMessage: 'Corrida cancelada após divergência de localização não resolvida.'
        });
    }
}

function getCachedDriverState(driverId) {
    if (!driverId) return null;
    const cached = driverStateHotCache.get(driverId);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        driverStateHotCache.delete(driverId);
        return null;
    }
    return cached.state || null;
}

function setCachedDriverState(driverId, state) {
    if (!driverId || !state || typeof state !== 'object') return;
    driverStateHotCache.set(driverId, {
        state,
        expiresAt: Date.now() + DRIVER_STATE_HOT_CACHE_TTL_MS
    });
    trimHotMapIfNeeded(driverStateHotCache, DRIVER_STATE_HOT_CACHE_MAX);
}

async function getDriverStateHot(redis, driverId, fallbackState = null) {
    if (fallbackState && typeof fallbackState === 'object' && Object.keys(fallbackState).length > 0) {
        setCachedDriverState(driverId, fallbackState);
        runtimeMetrics.recordRealtimeUpdate('driver_state_hot_cache', 'set');
        return fallbackState;
    }

    const cachedState = getCachedDriverState(driverId);
    if (cachedState) {
        runtimeMetrics.recordRealtimeUpdate('driver_state_hot_cache', 'hit');
        return cachedState;
    }

    runtimeMetrics.recordRealtimeUpdate('driver_state_hot_cache', 'miss');
    const redisStart = Date.now();
    const fetchedState = await redis.hgetall(`driver:${driverId}`);
    runtimeMetrics.recordRedisHotpathOp('driver_state_hot_fetch', 'hgetall', 1);
    runtimeMetrics.recordHotpathLatency('driver_state_hot_fetch', (Date.now() - redisStart) / 1000, true);

    if (fetchedState && Object.keys(fetchedState).length > 0) {
        setCachedDriverState(driverId, fetchedState);
        return fetchedState;
    }
    return {};
}

function shouldRunUpdateLocationRateLimit(driverId) {
    if (!driverId) return true;
    const now = Date.now();
    const cached = updateLocationRateLimitCache.get(driverId);
    if (cached && cached.expiresAt > now) {
        return false;
    }
    updateLocationRateLimitCache.set(driverId, {
        expiresAt: now + UPDATE_LOCATION_RATE_LIMIT_CACHE_MS
    });
    trimHotMapIfNeeded(updateLocationRateLimitCache, DRIVER_STATE_HOT_CACHE_MAX);
    return true;
}

function shouldSkipRealtimeUpdate(driverId, nextState) {
    if (!driverId || !nextState) {
        return { skip: false, reason: null };
    }
    const previous = driverRealtimeUpdateGateCache.get(driverId);
    if (!previous) {
        return { skip: false, reason: null };
    }

    const nowTs = Number(nextState.timestamp || Date.now());
    const prevTs = Number(previous.timestamp || 0);
    const elapsedMs = Math.max(0, nowTs - prevTs);
    const inTrip = Boolean(nextState.isInTrip);
    const minIntervalMs = inTrip ? DRIVER_UPDATE_MIN_INTERVAL_TRIP_MS : DRIVER_UPDATE_MIN_INTERVAL_MS;
    const minDistanceMeters = inTrip ? DRIVER_UPDATE_MIN_DISTANCE_TRIP_METERS : DRIVER_UPDATE_MIN_DISTANCE_METERS;
    const movedMeters = haversineDistanceMeters(previous.lat, previous.lng, nextState.lat, nextState.lng);
    const statusChanged = String(previous.tripStatus || '') !== String(nextState.tripStatus || '');
    const onlineChanged = String(previous.isOnline || '') !== String(nextState.isOnline || '');

    if (!statusChanged && !onlineChanged && elapsedMs < minIntervalMs && movedMeters < minDistanceMeters) {
        return { skip: true, reason: 'coalesced' };
    }
    return { skip: false, reason: null };
}

function markRealtimeUpdateProcessed(driverId, state) {
    if (!driverId || !state) return;
    driverRealtimeUpdateGateCache.set(driverId, {
        lat: toFiniteNumber(state.lat),
        lng: toFiniteNumber(state.lng),
        timestamp: Number(state.timestamp || Date.now()),
        isInTrip: Boolean(state.isInTrip),
        tripStatus: state.tripStatus || '',
        isOnline: Boolean(state.isOnline)
    });
    trimHotMapIfNeeded(driverRealtimeUpdateGateCache, DRIVER_STATE_HOT_CACHE_MAX);
}

function shouldAttemptVehicleLockRecovery(driverId) {
    if (!driverId) return false;
    const now = Date.now();
    const cached = vehicleLockRecoveryAttemptCache.get(driverId);
    if (cached && cached.expiresAt > now) {
        return false;
    }
    vehicleLockRecoveryAttemptCache.set(driverId, {
        expiresAt: now + Math.max(2000, VEHICLE_LOCK_RECOVERY_COOLDOWN_MS)
    });
    trimHotMapIfNeeded(vehicleLockRecoveryAttemptCache, DRIVER_STATE_HOT_CACHE_MAX);
    return true;
}

async function tryRecoverVehicleLockContext({
    driverId,
    socket,
    existingDriverState,
    redis,
    logStructured
}) {
    let vehiclePlate = normalizeVehiclePlate(socket?.vehiclePlate || existingDriverState?.vehiclePlate || '');
    let source = vehiclePlate ? 'cached_state' : 'firebase_profile';

    if (!vehiclePlate && VEHICLE_LOCK_RECOVERY_FIREBASE_LOOKUP_ENABLED) {
        const db = firebaseConfig?.getRealtimeDB?.();
        if (db) {
            const userSnapshot = await db.ref(`users/${driverId}`).once('value');
            const userData = userSnapshot?.val?.() || {};
            vehiclePlate = normalizeVehiclePlate(
                userData.carPlate || userData.vehicleNumber || userData.vehiclePlate || ''
            );
        }
    }

    if (!vehiclePlate) {
        return { recovered: false, reason: 'VEHICLE_PLATE_UNAVAILABLE' };
    }

    const lockResult = await vehicleLockManager.acquireLock(vehiclePlate, driverId);
    if (!lockResult?.success) {
        return {
            recovered: false,
            reason: 'VEHICLE_LOCK_NOT_ACQUIRED',
            error: lockResult?.error || null
        };
    }

    const nowIso = new Date().toISOString();
    const driverPatch = {
        vehiclePlate,
        vehicleLockValidated: 'true',
        vehicleLockValidatedAt: nowIso,
        updatedAt: nowIso
    };

    socket.vehiclePlate = vehiclePlate;
    await redis.hset(`driver:${driverId}`, driverPatch);
    setCachedDriverState(driverId, {
        ...(existingDriverState || {}),
        ...driverPatch
    });

    logStructured('info', 'Contexto de lock recuperado durante updateLocation', {
        service: 'websocket',
        operation: 'updateLocation',
        driverId,
        source,
        vehiclePlate
    });

    return { recovered: true, vehiclePlate, source };
}

function releaseSocketAdmissionSlot() {
    if (socketAdmissionInFlight > 0) {
        socketAdmissionInFlight -= 1;
    }

    while (socketAdmissionInFlight < SOCKET_ADMISSION_MAX_INFLIGHT && socketAdmissionQueue.length > 0) {
        const nextItem = socketAdmissionQueue.shift();
        if (!nextItem || nextItem.cancelled) continue;
        socketAdmissionInFlight += 1;
        nextItem.grant();
    }
}

function runSocketAdmission(socket, next) {
    if (!SOCKET_ADMISSION_ENABLED) {
        next();
        return;
    }

    let granted = false;
    const grant = () => {
        if (granted) return;
        granted = true;

        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            if (socket.__admissionHoldTimer) {
                clearTimeout(socket.__admissionHoldTimer);
                socket.__admissionHoldTimer = null;
            }
            releaseSocketAdmissionSlot();
        };

        socket.__releaseAdmissionSlot = release;
        socket.__admissionHoldTimer = setTimeout(() => {
            release();
        }, SOCKET_ADMISSION_HOLD_MS);

        next();
    };

    if (socketAdmissionInFlight < SOCKET_ADMISSION_MAX_INFLIGHT) {
        socketAdmissionInFlight += 1;
        grant();
        return;
    }

    if (socketAdmissionQueue.length >= SOCKET_ADMISSION_MAX_QUEUE) {
        recordRealtimeMetricSafe('socket_admission', 'server_busy_retry');
        next(new Error('SERVER_BUSY_RETRY'));
        return;
    }

    const pending = {
        cancelled: false,
        grant
    };

    socketAdmissionQueue.push(pending);
    setTimeout(() => {
        if (pending.cancelled || granted) return;
        pending.cancelled = true;
        recordRealtimeMetricSafe('socket_admission', 'server_busy_timeout');
        next(new Error('SERVER_BUSY_TIMEOUT'));
    }, SOCKET_ADMISSION_MAX_WAIT_MS);
}

function releaseAuthVerifySlot() {
    if (authVerifyInFlight > 0) {
        authVerifyInFlight -= 1;
    }

    while (authVerifyInFlight < AUTH_VERIFY_MAX_INFLIGHT && authVerifyQueue.length > 0) {
        const nextItem = authVerifyQueue.shift();
        if (!nextItem || nextItem.cancelled) continue;
        authVerifyInFlight += 1;
        nextItem.grant();
    }
}

function acquireAuthVerifySlot() {
    return new Promise((resolve, reject) => {
        if (!AUTH_VERIFY_ADMISSION_ENABLED) {
            resolve(() => { });
            return;
        }

        const grant = () => {
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                releaseAuthVerifySlot();
            };
            resolve(release);
        };

        if (authVerifyInFlight < AUTH_VERIFY_MAX_INFLIGHT) {
            authVerifyInFlight += 1;
            grant();
            return;
        }

        if (authVerifyQueue.length >= AUTH_VERIFY_MAX_QUEUE) {
            recordRealtimeMetricSafe('authenticate', 'auth_busy_queue_full');
            reject(new Error('AUTH_BUSY_QUEUE_FULL'));
            return;
        }

        const pending = {
            cancelled: false,
            grant
        };

        authVerifyQueue.push(pending);
        setTimeout(() => {
            if (pending.cancelled) return;
            pending.cancelled = true;
            recordRealtimeMetricSafe('authenticate', 'auth_busy_timeout');
            reject(new Error('AUTH_BUSY_TIMEOUT'));
        }, AUTH_VERIFY_MAX_WAIT_MS);
    });
}

async function verifyFirebaseTokenCached(token, requestedRole = 'unknown') {
    const tokenHash = fingerprintToken(token);
    if (!tokenHash) {
        throw new Error('AUTH_TOKEN_INVALID');
    }

    const now = Date.now();
    const cached = authTokenCache.get(tokenHash);
    if (cached && cached.expiresAt > now) {
        cached.lastSeenAt = now;
        if ((!cached.role || cached.role === 'unknown') && requestedRole && requestedRole !== 'unknown') {
            cached.role = requestedRole;
        }
        return {
            uid: cached.uid,
            role: cached.role || requestedRole || 'unknown',
            sessionState: AUTH_CONTEXT_STATE.CACHED,
            tokenHash,
            fromCache: true
        };
    }

    if (authTokenVerifyInFlight.has(tokenHash)) {
        return authTokenVerifyInFlight.get(tokenHash);
    }

    const verifyPromise = (async () => {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const nowInner = Date.now();
        const tokenExpMs = decodedToken?.exp ? decodedToken.exp * 1000 : nowInner + AUTH_TOKEN_CACHE_TTL_MS;
        const cacheExpiresAt = Math.min(tokenExpMs, nowInner + AUTH_TOKEN_CACHE_TTL_MS);
        const role = decodedToken?.role || decodedToken?.userType || requestedRole || 'unknown';
        authTokenCache.set(tokenHash, {
            uid: decodedToken.uid,
            role,
            sessionState: AUTH_CONTEXT_STATE.AUTHENTICATED,
            expiresAt: cacheExpiresAt,
            lastSeenAt: nowInner
        });

        if (authTokenCache.size % 100 === 0 || authTokenCache.size > AUTH_TOKEN_CACHE_MAX) {
            cleanupAuthTokenCache();
        }

        return {
            uid: decodedToken.uid,
            role,
            sessionState: AUTH_CONTEXT_STATE.AUTHENTICATED,
            tokenHash,
            fromCache: false
        };
    })();

    authTokenVerifyInFlight.set(tokenHash, verifyPromise);
    try {
        return await verifyPromise;
    } finally {
        authTokenVerifyInFlight.delete(tokenHash);
    }
}

function sleepMs(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function acquireUserSessionLock(redis, userId, ownerToken) {
    const key = `session_lock:${userId}`;
    for (let attempt = 0; attempt < SESSION_LOCK_MAX_ATTEMPTS; attempt += 1) {
        const acquired = await redis.set(key, ownerToken, 'PX', SESSION_LOCK_TTL_MS, 'NX');
        if (acquired === 'OK') {
            return { key, acquired: true };
        }
        await sleepMs(SESSION_LOCK_RETRY_MS);
    }
    return { key, acquired: false };
}

async function releaseUserSessionLock(redis, lockRef, ownerToken) {
    if (!lockRef?.key) {
        return;
    }
    try {
        const currentOwner = await redis.get(lockRef.key);
        if (currentOwner === ownerToken) {
            await redis.del(lockRef.key);
        }
    } catch (_releaseError) {
        // Silencioso: lock expira por TTL.
    }
}

// Cluster mode otimizado para VPS (opt-in por env)
if (IS_CLUSTER_PRIMARY) {
    logStructured('info', 'Iniciando cluster do websocket backend', {
        service: 'server',
        workers: CLUSTER_WORKERS,
        schedulerLeaderWorkerId: CLUSTER_SCHEDULER_LEADER_ID
    });

    for (let i = 0; i < CLUSTER_WORKERS; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        logStructured('warn', 'Worker do cluster encerrou, reiniciando', {
            service: 'server',
            workerPid: worker?.process?.pid,
            workerId: worker?.id,
            code,
            signal
        });
        cluster.fork();
    });

    cluster.on('online', (worker) => {
        logStructured('info', 'Worker do cluster online', {
            service: 'server',
            workerPid: worker?.process?.pid,
            workerId: worker?.id
        });
    });
} else {
    logStructured('info', 'Inicializando runtime de aplicação', {
        service: 'server',
        clusterEnabled: CLUSTER_ENABLED,
        isClusterWorker: Boolean(cluster.worker),
        workerId: cluster.worker?.id || null,
        runtimeRole: RUNTIME_ROLE,
        embeddedListenerWorkers: ENABLE_EMBEDDED_LISTENER_WORKERS
    });
}

if (!IS_CLUSTER_PRIMARY) {
    // ✅ FASE 1.3: Inicializar OpenTelemetry ANTES de tudo
    initializeTracer();

// Worker process
const app = express();
const server = http.createServer(app);

// Executa atrás de Nginx reverse proxy (VPS produção), necessário para rate-limit/IP real.
// Mantemos configurável via env para rollback rápido.
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
app.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 1);

// Observabilidade de saturação: event loop lag.
const eventLoopLagMonitor = monitorEventLoopDelay({
    resolution: Math.max(10, EVENT_LOOP_LAG_RESOLUTION_MS)
});
eventLoopLagMonitor.enable();
setInterval(() => {
    const meanMs = Number((eventLoopLagMonitor.mean / 1e6).toFixed(2));
    const p95Ms = Number((eventLoopLagMonitor.percentile(95) / 1e6).toFixed(2));
    const maxMs = Number((eventLoopLagMonitor.max / 1e6).toFixed(2));
    runtimeMetrics.setEventLoopLag(meanMs, p95Ms, maxMs);
    eventLoopLagMonitor.reset();
}, Math.max(250, EVENT_LOOP_LAG_SAMPLE_MS)).unref();

// Health check ultra-rápido antes de middlewares pesados (rate limit/redis/etc)
app.get('/health/liveness', (_req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString()
    });
});

// ✅ Configuração CORS segura - apenas origens permitidas
const allowedOrigins = [
    // Produção
    'https://leaf.app.br',
    'https://www.leaf.app.br',
    'https://dashboard.leaf.app.br',
    'https://api.leaf.app.br',
    'https://socket.leaf.app.br',
    'https://dashboard.147.182.204.181.sslip.io',
    'https://api.147.182.204.181.sslip.io',
    'https://socket.147.182.204.181.sslip.io',
    'http://147.182.204.181:3001',
    'https://147.182.204.181:3001',
    // Desenvolvimento local
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3020',
    'http://localhost:8081',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3020',
    'http://127.0.0.1:8081',
    // IPs Locais do desenvolvedor
    'http://192.168.0.33:8081',
    'http://192.168.0.33:3000',
    'http://192.168.0.33:3001',
    // Capacitor/React Native (não tem origin tradicional)
    'capacitor://localhost',
    'ionic://localhost',
    'file://',
];

// Função para validar origem
const corsOptions = {
    origin: (origin, callback) => {
        // ✅ React Native e apps nativos não enviam origin (é null/undefined)
        // Permitir se não houver origin (React Native) ou se estiver na whitelist
        // Também permite qualquer IP da rede local 192.168.*.*
        const isVpcDirectOrigin = /^https?:\/\/147\.182\.204\.181(?::\d+)?$/.test(origin || '');

        if (
            !origin ||
            allowedOrigins.includes(origin) ||
            isVpcDirectOrigin ||
            origin.endsWith('ngrok-free.app') ||
            origin.startsWith('http://192.168.') ||
            origin.startsWith('http://10.') ||
            origin.startsWith('exp://') ||
            origin.includes('.expo.dev')
        ) {
            callback(null, true);
        } else {
            logStructured('warn', `CORS bloqueado: ${origin}`, { service: 'server', origin });
            callback(new Error('Não permitido pelo CORS'));
        }
    },
    credentials: false, // React Native não precisa
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
};

// ✅ NOVO: Middleware para gerar traceId automaticamente em requisições HTTP
app.use(traceIdExpressMiddleware);

app.use(cors(corsOptions));

// OTLP ingest local para evitar exporter apontando para endpoint inválido (ECONNREFUSED)
app.post('/otel/v1/traces', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
    const bytesFromBody = Buffer.isBuffer(req.body) ? req.body.length : 0;
    const headerLength = Number.parseInt(req.headers['content-length'] || '0', 10);
    const bytes = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : bytesFromBody;
    recordIngest(bytes, 200);
    res.status(200).end();
});

app.get('/otel/health', (_req, res) => {
    res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        otel: getOtelIngestStatus()
    });
});

// ✅ PROPRIEDADE DE SEGURANÇA: Rate Limiting Global
if (process.env.NODE_ENV !== 'test') {
    const { applyRateLimit } = require('./middleware/rateLimiter');
    app.use(applyRateLimit);
} else {
    logStructured('info', 'Rate Limiting desabilitado no ambiente de testes', { service: 'server' });
}

// ✅ LOG DE DEBUG: Capturar TODAS as requisições (apenas em desenvolvimento)
if (process.env.NODE_ENV === 'development' || process.env.DEBUG_REQUESTS === 'true') {
    app.use((req, res, next) => {
        if (req.path.includes('socket.io')) {
            logStructured('debug', 'Requisição Socket.IO', { service: 'server', method: req.method, path: req.path, origin: req.headers.origin || 'N/A' });
        }
        // ✅ Debug para rotas de drivers
        if (req.path.includes('/api/drivers')) {
            logStructured('debug', 'Requisição Drivers', { service: 'server', method: req.method, path: req.path, query: req.query });
        }
        // ✅ Debug para waitlist
        if (req.path.includes('/api/waitlist/landing')) {
            logStructured('debug', 'Requisição Waitlist', { service: 'server', method: req.method, path: req.path, origin: req.headers.origin || 'N/A' });
        }
        // ✅ Debug para rotas OCR
        if (req.path.includes('/api/ocr')) {
            logStructured('debug', 'Requisição OCR', { service: 'server', method: req.method, path: req.path, origin: req.headers.origin || 'N/A', contentType: req.headers['content-type'] || 'N/A' });
        }
        next();
    });
}

// ✅ CORREÇÃO: Aumentar limite e timeout para uploads de CNH
app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
        const path = String(req.originalUrl || req.url || '');
        if (path.includes('/api/woovi/webhook') || path.includes('/api/woovi-webhook')) {
            req.rawBody = Buffer.from(buf || Buffer.alloc(0));
        }
    }
})); // Aumentado de 10mb para 50mb
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Adicionado para multipart/form-data

// ✅ CORREÇÃO: Configurar timeout do servidor para uploads grandes (60s)
server.timeout = parseInt(process.env.SERVER_TIMEOUT) || 60000; // 60 segundos
server.keepAliveTimeout = 65000; // 65 segundos (maior que timeout)
server.headersTimeout = 66000; // 66 segundos (maior que keepAliveTimeout)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ INICIALIZAR FIREBASE ANTES DE REGISTRAR ROTAS
const firebaseConfig = require('./firebase-config');
try {
    firebaseConfig.initializeFirebase();
    logStructured('info', 'Firebase inicializado com sucesso', { service: 'server' });
} catch (error) {
    logStructured('error', 'Erro ao inicializar Firebase', { service: 'server', error: error.message, stack: error.stack });
    // Não quebra o servidor, mas algumas rotas podem não funcionar
}

// Registrar rotas IMEDIATAMENTE após middleware básico
logStructured('info', 'Registrando rotas...', { service: 'server' });

// Rotas de monitoramento do cache
app.use('/cache', cacheMonitoring);
logStructured('info', 'Rotas de cache registradas', { service: 'server' });

// Rotas de autenticação
app.use('/auth', authRoutes);
// Rotas de autenticação também em /api/auth
app.use('/api/auth', authRoutes);
app.use('/api/custom-otp', customOtpRoutes);
logStructured('info', 'Rotas de Autenticação registradas', { service: 'server' });

// Rotas de autenticação admin (JWT)
app.use('/api/admin/auth', adminAuthRoutes);
logStructured('info', 'Rotas de Autenticação Admin (JWT) registradas', { service: 'server' });

// Rotas KYC
app.use('/api/kyc', kycRoutes.getRouter());

// Rotas KYC Proxy (para microserviço)
app.use('/api/kyc-proxy', kycProxyRoutes.getRouter());

// Rotas KYC Analytics
app.use('/api/kyc-analytics', kycAnalyticsRoutes.getRouter());
logStructured('info', 'Rotas KYC registradas', { service: 'server' });

// ✅ Rotas de OCR (CNH e Documento do Veículo) - ANTES das rotas catch-all
// IMPORTANTE: Registrar ANTES de rotas catch-all como dashboardRoutes
try {
    const ocrRoutes = require('./routes/ocr-routes');
    app.use('/api/ocr', ocrRoutes);
    logStructured('info', 'Rotas de OCR registradas', { service: 'server' });
} catch (error) {
    logStructured('warn', 'Rotas de OCR não disponíveis', { service: 'server', error: error.message });
}

// Rotas Dashboard
app.use('/', dashboardRoutes);
logStructured('info', 'Rotas Dashboard registradas', { service: 'server' });

// Rotas de Métricas
app.use('/', metricsRoutes);
logStructured('info', 'Rotas de Métricas registradas', { service: 'server' });

// Rotas de Worker Health
const workerHealthRoutes = require('./routes/worker-health');
app.use('/', workerHealthRoutes);
logStructured('info', 'Rotas de Worker Health registradas', { service: 'server' });

// Rotas Waitlist - ANTES do CORS global para evitar conflitos
// Nota: waitlistRoutes tem seu próprio middleware CORS que sobrescreve o global
app.use('/', waitlistRoutes);
app.use('/', metricsRoutes);
logStructured('info', 'Rotas Waitlist registradas', { service: 'server' });

// Rotas de verificação de status do driver
app.use('/api/driver-status', driverStatusCheckRoutes);

// Rotas de drivers (inclui /api/drivers/nearby)
app.use('/', driversRoutes);
app.use('/', driverActivationRoutes);
logStructured('info', 'Rotas de Drivers registradas', { service: 'server' });
logStructured('info', 'Rotas de Ativação de Motorista registradas', { service: 'server' });
// app.set('io', io); // ✅ Será definido depois da criação do io (linha ~244)
logStructured('info', 'Rotas de verificação de status do driver registradas', { service: 'server' });

// Rotas de Conta (Account Management)
const accountRoutes = require('./routes/account-routes');
app.use('/', accountRoutes);
logStructured('info', 'Rotas de Conta (Account) registradas', { service: 'server' });

// Rotas públicas legais (privacidade, termos e exclusão de conta)
const legalPagesRoutes = require('./routes/legal-pages');
app.use('/', legalPagesRoutes);
logStructured('info', 'Rotas Legais públicas registradas', { service: 'server' });

// Rotas de Payment (Saldo do motorista e pagamentos)
const paymentRoutes = require('./routes/payment');
app.use('/api', paymentRoutes); // As rotas começam com /payment, então /api + /payment = /api/payment
logStructured('info', 'Rotas de Payment registradas', { service: 'server' });

// ✅ Rotas de Woovi (Webhooks e integração)
const wooviRoutes = require('./routes/woovi');
app.use('/api', wooviRoutes); // As rotas começam com /woovi, então /api + /woovi = /api/woovi
logStructured('info', 'Rotas de Woovi registradas', { service: 'server' });

// Rotas de Help
const helpRoutes = require('./routes/help-routes');
app.use('/api/help', helpRoutes);
logStructured('info', 'Rotas de Help registradas', { service: 'server' });

// Rotas de Support
const supportRoutes = require('./routes/support-routes');
app.use('/api/support', supportRoutes);
logStructured('info', 'Rotas de Support registradas', { service: 'server' });

// Rotas de Support (completo com tickets)
const supportFullRoutes = require('./routes/support');
app.use('/api/support', supportFullRoutes);

// ✅ Rotas de Chat de Suporte (Redis Pub/Sub + Firestore)
const supportChatRoutes = require('./routes/support-chat');
app.use('/api/support', supportChatRoutes);

// Nota: injeção de Socket.IO nas rotas de suporte ocorre após criação do io.
logStructured('info', 'Rotas de Support (completo) registradas', { service: 'server' });

// ✅ Rotas de KYC Onboarding (CNH + Selfie)
const kycOnboardingRoutes = require('./routes/kyc-onboarding');
app.use('/', kycOnboardingRoutes);
logStructured('info', 'Rotas de KYC Onboarding registradas', { service: 'server' });

// Rotas de Alertas
app.use('/api/alerts', alertsRoutes);
logStructured('info', 'Rotas de Alertas registradas', { service: 'server' });

// Rotas de Health Check
app.use('/', healthRoutes);
logStructured('info', 'Rotas de Health Check registradas', { service: 'server' });

// Rotas de App Info
const appRoutes = require('./routes/app-routes');
app.use('/api/app', appRoutes);

const geofenceRoutes = require('./routes/geofence-routes');
app.use('/api/geofence', geofenceRoutes);
logStructured('info', 'Rotas de App Info registradas', { service: 'server' });

// Rotas de Notificações
app.use('/api/notifications', notificationsRoutes);
logStructured('info', 'Rotas de Notificações registradas', { service: 'server' });

// Rotas de Monitoramento de Filas (FASE 10)
app.use('/', queueMonitoringRoutes);
logStructured('info', 'Rotas de Monitoramento de Filas registradas', { service: 'server' });

// Rotas de Places Cache (com feature flag)
if (process.env.ENABLE_PLACES_CACHE !== 'false' && placesRoutes) {
    try {
        app.use('/', placesRoutes);

        // Inicializar serviço de Places Cache
        const placesCacheService = require('./services/places-cache-service');
        placesCacheService.initialize().catch(error => {
            logStructured('warn', 'Places Cache Service não inicializado', { service: 'server', error: error.message });
        });

        logStructured('info', 'Rotas de Places Cache registradas', { service: 'server' });
    } catch (error) {
        logStructured('warn', 'Erro ao registrar rotas de Places Cache', { service: 'server', error: error.message });
        // Não quebra o servidor se Places Cache falhar
    }
} else {
    logStructured('info', 'Places Cache desabilitado (ENABLE_PLACES_CACHE=false ou rotas não disponíveis)', { service: 'server' });
}

// ✅ Configuração CORS simplificada para debug (aceitar qualquer origem)
// TODO: Restaurar whitelist em produção
const socketIoAllowedOrigins = [
    'https://leaf.app.br',
    'https://www.leaf.app.br',
    'https://dashboard.leaf.app.br',
    'http://localhost:3000',
    'http://localhost:3001',
    'capacitor://localhost',
    'ionic://localhost',
];

// Configurações ultra-otimizadas do Socket.IO
const socketConnectTimeoutMs = Number.parseInt(process.env.SOCKET_CONNECT_TIMEOUT_MS || '60000', 10);
const socketPingTimeoutMs = Number.parseInt(process.env.SOCKET_PING_TIMEOUT_MS || '45000', 10);
const socketPingIntervalMs = Number.parseInt(process.env.SOCKET_PING_INTERVAL_MS || '20000', 10);
const socketAllowPolling = process.env.SOCKET_ALLOW_POLLING
    ? process.env.SOCKET_ALLOW_POLLING === 'true'
    : process.env.NODE_ENV !== 'production';
const io = socketIo(server, {
    // ✅ Expor io globalmente para health checks e workers
    // global.io será definido logo abaixo
    transports: socketAllowPolling ? ['websocket', 'polling'] : ['websocket'],
    pingTimeout: Number.isFinite(socketPingTimeoutMs) ? socketPingTimeoutMs : 45000,
    pingInterval: Number.isFinite(socketPingIntervalMs) ? socketPingIntervalMs : 20000,
    allowEIO3: true,
    allowEIO4: true, // ✅ Permitir Engine.IO v4
    connectTimeout: Number.isFinite(socketConnectTimeoutMs) ? socketConnectTimeoutMs : 60000,
    maxHttpBufferSize: 1e6, // 1MB limit para VPS
    cors: process.env.NODE_ENV === 'test' ? { origin: true } : corsOptions, // ✅ Empregando a WhiteList global nos ambientes reais
    // Configurações otimizadas para VPS
    compression: false, // Desabilitar compressão para reduzir overhead
    serveClient: false, // Desabilitar cliente para economizar recursos
    allowUpgrades: true,
    perMessageDeflate: false // Desabilitar compressão per-message
});
let socketIoAdapterPubClient = null;
let socketIoAdapterSubClient = null;
const initializeSocketIoRedisAdapter = async () => {
    if (!ENABLE_SOCKETIO_REDIS_ADAPTER) {
        logStructured('info', 'Socket.IO Redis Adapter desabilitado por configuração', {
            service: 'websocket',
            runtimeRole: RUNTIME_ROLE
        });
        return;
    }

    try {
        await redisPool.ensureConnection();
        const baseRedisClient = redisPool.getConnection();
        socketIoAdapterPubClient = baseRedisClient.duplicate();
        socketIoAdapterSubClient = baseRedisClient.duplicate();
        await socketIoAdapterPubClient.ping();
        await socketIoAdapterSubClient.ping();
        io.adapter(createAdapter(socketIoAdapterPubClient, socketIoAdapterSubClient));
        logStructured('info', 'Socket.IO Redis Adapter inicializado', {
            service: 'websocket',
            runtimeRole: RUNTIME_ROLE
        });
    } catch (error) {
        if (socketIoAdapterPubClient) {
            socketIoAdapterPubClient.disconnect();
            socketIoAdapterPubClient = null;
        }
        if (socketIoAdapterSubClient) {
            socketIoAdapterSubClient.disconnect();
            socketIoAdapterSubClient = null;
        }
        logStructured('warn', 'Falha ao inicializar Socket.IO Redis Adapter (seguindo sem adapter)', {
            service: 'websocket',
            runtimeRole: RUNTIME_ROLE,
            error: error.message
        });
    }
};
initializeSocketIoRedisAdapter().catch((error) => {
    logStructured('warn', 'Erro inesperado ao inicializar Socket.IO Redis Adapter', {
        service: 'websocket',
        runtimeRole: RUNTIME_ROLE,
        error: error.message
    });
});

// Injetar Socket.IO nas rotas de suporte após inicialização do io
if (supportFullRoutes.setIOInstance) {
    supportFullRoutes.setIOInstance(io);
    logStructured('info', 'Rotas de Support (completo) conectadas ao WebSocket', { service: 'server' });
}

// ✅ DEBUG: Log de conexões e erros
io.engine.on('connection_error', (err) => {
    logStructured('error', 'Socket.IO Engine - Erro de conexão', {
        service: 'websocket',
        error: err.message,
        reqUrl: err.req?.url,
        code: err.code,
        context: err.context,
        origin: err.req?.headers?.origin || 'null (React Native)',
        userAgent: err.req?.headers['user-agent'] || 'N/A',
        method: err.req?.method
    });
});

// ✅ DEBUG: Log de requisições de polling (apenas em desenvolvimento)
if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
    io.engine.on('request', (req, res) => {
        if (req.url?.includes('socket.io') && req.url?.includes('polling')) {
            logStructured('debug', 'Socket.IO - Requisição polling', {
                service: 'websocket',
                method: req.method,
                url: req.url,
                origin: req.headers.origin || 'null (React Native)',
                userAgent: req.headers['user-agent'] || 'N/A'
            });
        }
    });
}

io.engine.on('upgrade_error', (err) => {
    logStructured('error', 'Socket.IO Engine - Erro de upgrade', {
        service: 'websocket',
        error: err.message
    });
});

// ✅ Disponibilizar io para as rotas (após criação do io)
app.set('io', io);

// ✅ Expor io globalmente para health checks e workers
global.io = io;

// ✅ REMOVIDO: Health check antigo (linha 504-571)
// A rota /health agora é gerenciada por healthRoutes (linha 362)
// que inclui: /health, /health/quick, /health/readiness, /health/liveness

const runtimeAccessToken = String(
    process.env.RUNTIME_ADMIN_TOKEN || process.env.RESTART_TOKEN || ''
).trim();
const runtimeAccessTokenConfigured = runtimeAccessToken.length > 0;
const enforceRuntimeAccess = (req, res, next) => {
    if (!runtimeAccessTokenConfigured) {
        if (process.env.NODE_ENV === 'production') {
            return res.status(503).json({
                error: 'Token de runtime nao configurado',
                hint: 'Configure RUNTIME_ADMIN_TOKEN no ambiente'
            });
        }
        return next();
    }

    const providedToken =
        req.headers['x-runtime-token'] ||
        req.headers['x-restart-token'] ||
        req.query.token;

    if (providedToken !== runtimeAccessToken) {
        return res.status(403).json({ error: 'Token invalido' });
    }

    return next();
};

// ✅ Endpoint de restart (apenas em desenvolvimento ou com token)
app.post('/restart', enforceRuntimeAccess, async (req, res) => {
    res.json({
        message: 'Reiniciando servidor...',
        timestamp: new Date().toISOString()
    });

    // Fechar servidor graciosamente após 1 segundo
    setTimeout(() => {
        logStructured('info', 'Reiniciando servidor via endpoint', { service: 'server', action: 'restart' });
        process.exit(0); // PM2 ou systemd vai reiniciar automaticamente
    }, 1000);
});

// Metrics endpoint ultra-otimizado
// ✅ FASE 2.1: Endpoint Prometheus (formato padrão)
app.get('/metrics', enforceRuntimeAccess, async (req, res) => {
    try {
        const { getMetrics } = require('./utils/prometheus-metrics');
        const metrics = await getMetrics();
        res.set('Content-Type', 'text/plain; version=0.0.4');
        res.send(metrics);
    } catch (error) {
        logStructured('error', 'Erro ao obter métricas Prometheus', {
            service: 'server',
            operation: 'getMetricsEndpoint',
            error: error.message
        });
        res.status(500).send('# Erro ao obter métricas\n');
    }
});

if (ENABLE_LEGACY_RUNTIME_ENDPOINTS) {
    // Endpoint antigo (mantido apenas quando legado estiver explicitamente habilitado).
    app.get('/metrics-old', enforceRuntimeAccess, async (req, res) => {
        try {
            const metrics = {
                timestamp: new Date().toISOString(),
                connections: {
                    total: io.engine.clientsCount,
                    max: VPS_CONFIG.MAX_CONNECTIONS,
                    percentage: (io.engine.clientsCount / VPS_CONFIG.MAX_CONNECTIONS * 100).toFixed(2)
                },
                performance: {
                    memory: process.memoryUsage(),
                    uptime: process.uptime(),
                    workers: VPS_CONFIG.CLUSTER_WORKERS
                },
                graphql: {
                    enabled: true,
                    queries: 26,
                    mutations: 6,
                    subscriptions: 6,
                    features: [
                        'Dashboard Resolver',
                        'User Resolver com DataLoader',
                        'Driver Resolver com Redis GEO',
                        'Booking Resolver',
                        'Cache Inteligente',
                        'Rate Limiting',
                        'Query Complexity Analysis'
                    ]
                }
            };

            res.json(metrics);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/stats', enforceRuntimeAccess, async (req, res) => {
        try {
            const stats = {
                timestamp: new Date().toISOString(),
                server: {
                    status: 'running',
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    workers: VPS_CONFIG.CLUSTER_WORKERS
                },
                websocket: {
                    connections: io.engine.clientsCount,
                    maxConnections: VPS_CONFIG.MAX_CONNECTIONS
                },
                graphql: {
                    status: 'active',
                    endpoint: '/graphql',
                    queries: 26,
                    mutations: 6,
                    subscriptions: 6,
                    features: [
                        'Dashboard Resolver',
                        'User Resolver com DataLoader',
                        'Driver Resolver com Redis GEO',
                        'Booking Resolver',
                        'Cache Inteligente',
                        'Rate Limiting',
                        'Query Complexity Analysis',
                        'Depth Limiting'
                    ]
                },
                performance: {
                    requestsPerSecond: VPS_CONFIG.MAX_REQUESTS_PER_SECOND,
                    maxConnections: VPS_CONFIG.MAX_CONNECTIONS,
                    clusterWorkers: VPS_CONFIG.CLUSTER_WORKERS
                }
            };

            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

// ==================== INICIALIZAÇÃO FASE 7: SISTEMA DE FILAS E MATCHING ====================
// Inicializar instâncias dos serviços
const responseHandler = new ResponseHandler(io);
const gradualExpander = new GradualRadiusExpander(io);
const radiusExpansionManager = new RadiusExpansionManager(io);

// Iniciar monitoramento de expansão para 5km
radiusExpansionManager.start();
logStructured('info', 'RadiusExpansionManager iniciado', { service: 'server', phase: 'fase7' });

// Variável para armazenar activeBookings (compatibilidade)
if (!io.activeBookings) {
    io.activeBookings = new Map();
}
// =========================================================================================

// ==================== INICIALIZAÇÃO FASE 8: QUEUE WORKER ====================
// Inicializar worker para processar filas continuamente
const queueWorker = new QueueWorker(io);
const shouldRunQueueWorker =
    !CLUSTER_ENABLED || !cluster.worker || cluster.worker.id === CLUSTER_SCHEDULER_LEADER_ID;

if (shouldRunQueueWorker) {
    queueWorker.start();
    logStructured('info', 'QueueWorker iniciado no worker líder (processamento contínuo de filas)', {
        service: 'server',
        phase: 'fase8',
        workerId: cluster.worker?.id || null,
        schedulerLeaderWorkerId: CLUSTER_SCHEDULER_LEADER_ID
    });
} else {
    logStructured('info', 'QueueWorker desabilitado neste worker do cluster', {
        service: 'server',
        phase: 'fase8',
        workerId: cluster.worker?.id || null,
        schedulerLeaderWorkerId: CLUSTER_SCHEDULER_LEADER_ID
    });
}

// FASE 10: Injetar instância do worker nas rotas de monitoramento
queueMonitoringRoutes.setQueueWorker(queueWorker);
logStructured('info', 'Rotas de monitoramento configuradas', { service: 'server', phase: 'fase10' });
// ============================================================================

// ==================== INICIALIZAÇÃO FASE 9: DRIVER POOL MONITOR ====================
// Inicializar monitor de motoristas disponíveis
const DriverPoolMonitor = require('./services/driver-pool-monitor');
const driverPoolMonitor = new DriverPoolMonitor(io);

// Iniciar monitor (verifica motoristas livres a cada 5 segundos)
const enableDriverPoolMonitor = process.env.ENABLE_DRIVER_POOL_MONITOR === 'true';
if (enableDriverPoolMonitor) {
    driverPoolMonitor.start();
    logStructured('info', 'DriverPoolMonitor iniciado (monitoramento contínuo de motoristas livres)', { service: 'server', phase: 'fase9' });
} else {
    logStructured('info', 'DriverPoolMonitor desabilitado por configuração', {
        service: 'server',
        phase: 'fase9',
        env: 'ENABLE_DRIVER_POOL_MONITOR'
    });
}
// ============================================================================

// ==================== SERVIÇO DE NOTIFICAÇÃO DE DEMANDA ====================
const DemandNotificationService = require('./services/demand-notification-service');
const demandNotificationService = new DemandNotificationService(io);
logStructured('info', 'Serviço de Notificação de Demanda inicializado', { service: 'server' });
// ============================================================================

// ==================== DASHBOARD WEBSOCKET SERVICE ====================
const DashboardWebSocketService = require('./services/dashboard-websocket');
const dashboardWebSocketService = new DashboardWebSocketService(io, redisPool.getConnection());
logStructured('info', 'Dashboard WebSocket Service inicializado', { service: 'server' });
// ======================================================================

// ==================== JOB DE LIMPEZA PERIÓDICA ====================
// Limpar motoristas "fantasma" do GEO (online e offline)
setInterval(async () => {
    try {
        const redis = redisPool.getConnection();

        // Garantir conexão Redis
        if (redis.status !== 'ready' && redis.status !== 'connect') {
            try {
                await redis.connect();
            } catch (connectError) {
                if (!connectError.message.includes('already connecting') &&
                    !connectError.message.includes('already connected')) {
                    logStructured('error', 'Erro ao conectar Redis no job de limpeza', {
                        service: 'server',
                        operation: 'cleanupJob',
                        error: connectError.message
                    });
                    return;
                }
            }
        }

        // ✅ CORREÇÃO: NÃO remover motoristas do GEO ativo se estão conectados
        // A lógica anterior removia motoristas que não tinham `driver:${driverId}` no Redis,
        // mas isso pode expirar por TTL mesmo com motorista online e parado.
        // Agora só removemos se o motorista realmente desconectou do WebSocket.
        const activeDrivers = await redis.zrange('driver_locations', 0, -1);
        let cleanedActive = 0;
        let renewedActive = 0;
        for (const driverId of activeDrivers) {
            // Verificar se motorista está conectado via WebSocket
            let isConnected = false;
            if (io.connectedUsers) {
                const connectedSocket = io.connectedUsers.get(driverId);
                isConnected = !!connectedSocket;
            }

            const exists = await redis.exists(`driver:${driverId}`);

            if (isConnected) {
                // Motorista está conectado - NUNCA remover, apenas renovar se necessário
                if (!exists) {
                    // TTL expirou mas motorista está conectado - renovar entrada
                    const driverLocation = await redis.geopos('driver_locations', driverId);
                    if (driverLocation && driverLocation.length > 0) {
                        const [lng, lat] = driverLocation[0];
                        await redis.hset(`driver:${driverId}`, {
                            id: driverId,
                            isOnline: 'true',
                            status: 'AVAILABLE',
                            lat: lat.toString(),
                            lng: lng.toString(),
                            lastUpdate: Date.now().toString(),
                            timestamp: Date.now().toString(),
                            lastSeen: new Date().toISOString()
                        });
                        // ✅ Usar configuração centralizada de TTL
                        const { getTTL } = require('./config/redis-ttl-config');
                        await redis.expire(`driver:${driverId}`, getTTL('DRIVER_LOCATION', 'ONLINE'));
                        renewedActive++;
                    }
                } else {
                    // Existe e está conectado - apenas renovar TTL para manter histórico
                    const { getTTL } = require('./config/redis-ttl-config');
                    await redis.expire(`driver:${driverId}`, getTTL('DRIVER_LOCATION', 'ONLINE'));
                }
            } else {
                // Motorista NÃO está conectado - pode remover se não existe
                // Mas manter por um tempo para análise de comportamento (não remover imediatamente)
                // Só remover se realmente não existe E não está conectado há muito tempo
                if (!exists) {
                    // Verificar última atualização (se houver)
                    const lastSeen = await redis.hget(`driver:${driverId}`, 'lastSeen');
                    if (!lastSeen) {
                        // Não tem histórico - pode remover (motorista nunca foi salvo corretamente)
                        await redis.zrem('driver_locations', driverId);
                        cleanedActive++;
                    }
                    // Se tem lastSeen, manter para análise de comportamento (não remover)
                }
            }
        }

        // Limpar GEO offline (motoristas que expiraram)
        const offlineDrivers = await redis.zrange('driver_offline_locations', 0, -1);
        let cleanedOffline = 0;
        for (const driverId of offlineDrivers) {
            const exists = await redis.exists(`driver:${driverId}`);
            if (!exists) {
                await redis.zrem('driver_offline_locations', driverId);
                cleanedOffline++;
            }
        }

        if (cleanedActive > 0 || cleanedOffline > 0 || renewedActive > 0) {
            logStructured('info', 'Limpeza periódica de motoristas concluída', {
                service: 'server',
                cleanedActive,
                cleanedOffline,
                renewedActive
            });
        }

        // Limpar cooldowns antigos
        demandNotificationService.cleanupCooldowns();

    } catch (error) {
        logStructured('error', 'Erro no job de limpeza', {
            service: 'server',
            error: error.message,
            stack: error.stack
        });
    }
}, 60000); // A cada 1 minuto
logStructured('info', 'Job de limpeza periódica iniciado (a cada 1 minuto)', { service: 'server' });
// ============================================================================

function normalizeCarType(value) {
    if (!value) return '';
    return value.toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

function parseBookingLocation(rawValue) {
    if (!rawValue) return null;
    if (typeof rawValue === 'object' && rawValue.lat && rawValue.lng) {
        return rawValue;
    }
    if (typeof rawValue !== 'string') {
        return null;
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && parsed.lat && parsed.lng) {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

const BOOKING_PARTY_CACHE_TTL_MS = 30 * 1000;
const bookingPartyCache = new Map();
const BOOKING_PARTY_CACHE_MAX = 5000;

function parseBookingParticipant(rawValue) {
    if (!rawValue) return null;
    if (typeof rawValue === 'object') {
        return rawValue.uid || rawValue.id || rawValue.userId || null;
    }
    if (typeof rawValue !== 'string') {
        return null;
    }
    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === 'object') {
            return parsed.uid || parsed.id || parsed.userId || null;
        }
    } catch (_) {
        // Ignorar parse errors e usar fallback string.
    }
    return rawValue;
}

function getCachedBookingParties(bookingId) {
    const cached = bookingPartyCache.get(bookingId);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        bookingPartyCache.delete(bookingId);
        return null;
    }
    return cached.value;
}

function setCachedBookingParties(bookingId, value) {
    if (bookingPartyCache.size >= BOOKING_PARTY_CACHE_MAX) {
        const iterator = bookingPartyCache.keys();
        const firstKey = iterator.next().value;
        if (firstKey !== undefined) {
            bookingPartyCache.delete(firstKey);
        }
    }
    bookingPartyCache.set(bookingId, {
        value,
        expiresAt: Date.now() + BOOKING_PARTY_CACHE_TTL_MS
    });
}

async function resolveBookingParties(redis, bookingId) {
    if (!bookingId) {
        return { customerId: null, driverId: null };
    }

    const cached = getCachedBookingParties(bookingId);
    if (cached) {
        return cached;
    }

    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    if (!bookingData || Object.keys(bookingData).length === 0) {
        return { customerId: null, driverId: null };
    }

    const customerId = bookingData.customerId
        || bookingData.customer
        || bookingData.passengerId
        || parseBookingParticipant(bookingData.passenger)
        || parseBookingParticipant(bookingData.customer)
        || null;

    const driverId = bookingData.driverId
        || bookingData.driver
        || parseBookingParticipant(bookingData.driverData)
        || null;

    const value = { customerId, driverId };
    setCachedBookingParties(bookingId, value);
    return value;
}

const TERMINAL_BOOKING_STATES = new Set([
    'COMPLETED',
    'CANCELED',
    'CANCELLED',
    'SUPERSEDED',
    'NO_DRIVERS_AVAILABLE',
    'EXPIRED'
]);

function normalizeBookingState(bookingData = {}) {
    const rawState = bookingData.status || bookingData.state || bookingData.tripStatus || '';
    return String(rawState || '').trim().toUpperCase();
}

function parseNumericBookingValue(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function buildActiveRideSnapshotForUser(redis, userId, userType) {
    if (!redis || !userId || !userType) {
        return {
            hasActiveRide: false,
            bookingId: null
        };
    }

    let bookingId = null;

    if (userType === 'driver') {
        const indexedTrip = await resolveActiveTripForDriver(redis, userId);
        bookingId = indexedTrip?.tripId || null;

        if (!bookingId) {
            const driverState = await getDriverStateHot(redis, userId);
            bookingId = driverState?.activeTripId || null;
        }
    } else if (userType === 'customer' || userType === 'passenger') {
        bookingId = await redis.get(`customer_active_booking:${userId}`);
    }

    if (!bookingId) {
        return {
            hasActiveRide: false,
            bookingId: null
        };
    }

    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    if (!bookingData || Object.keys(bookingData).length === 0) {
        return {
            hasActiveRide: false,
            bookingId,
            stale: true
        };
    }

    const status = normalizeBookingState(bookingData);
    const hasActiveRide = !TERMINAL_BOOKING_STATES.has(status);

    return {
        hasActiveRide,
        bookingId,
        status: status || 'UNKNOWN',
        customerId: bookingData.customerId
            || bookingData.customer
            || bookingData.passengerId
            || parseBookingParticipant(bookingData.passenger)
            || null,
        driverId: bookingData.driverId
            || bookingData.driver
            || parseBookingParticipant(bookingData.driverData)
            || null,
        pickupLocation: parseBookingLocation(bookingData.pickupLocation) || parseBookingLocation(bookingData.pickup),
        destinationLocation: parseBookingLocation(bookingData.destinationLocation) || parseBookingLocation(bookingData.drop),
        estimatedFare: parseNumericBookingValue(bookingData.estimatedFare || bookingData.estimate),
        finalFare: parseNumericBookingValue(bookingData.finalFare || bookingData.fare),
        paymentStatus: bookingData.paymentStatus || bookingData.payment_status || null,
        startedAt: bookingData.startedAt || null,
        acceptedAt: bookingData.acceptedAt || null,
        updatedAt: bookingData.updatedAt || bookingData.timestamp || null
    };
}

async function hasEligibleDriversForPickupFast(pickupLocation, options = {}) {
    const redis = redisPool.getConnection();
    await redisPool.ensureConnection();

    const latitude = Number.parseFloat(pickupLocation?.lat);
    const longitude = Number.parseFloat(pickupLocation?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return {
            success: false,
            error: 'pickup_location_invalid',
            hasDrivers: false,
            radiusKm: null
        };
    }

    const radiusKm = Number.parseFloat(options.radiusKm || process.env.PAYMENT_AVAILABILITY_RADIUS_KM || '5');
    const requestedCarType = normalizeCarType(options.carType);
    const eligibleGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

    const nearbyDrivers = await redis.georadius(
        eligibleGeoKey,
        longitude,
        latitude,
        radiusKm,
        'km',
        'COUNT',
        8
    );

    if (!Array.isArray(nearbyDrivers) || nearbyDrivers.length === 0) {
        return {
            success: true,
            hasDrivers: false,
            radiusKm
        };
    }

    if (!requestedCarType) {
        return {
            success: true,
            hasDrivers: true,
            radiusKm
        };
    }

    // Reduz N+1: buscar estado dos motoristas em lote.
    const driverStatePipeline = redis.pipeline();
    for (const driverId of nearbyDrivers) {
        driverStatePipeline.hgetall(`driver:${driverId}`);
    }
    const driverStateResults = await driverStatePipeline.exec();

    for (let i = 0; i < nearbyDrivers.length; i += 1) {
        const driverId = nearbyDrivers[i];
        const [driverErr, driverData] = driverStateResults[i] || [];
        if (driverErr || !driverData || Object.keys(driverData).length === 0) continue;

        const isOnline = driverData.isOnline === true || driverData.isOnline === 'true';
        const dispatchEligible = driverData.dispatchEligible === true || driverData.dispatchEligible === 'true';
        const driverStatus = (driverData.status || '').toUpperCase();
        const isAvailable = driverStatus === 'AVAILABLE' || driverStatus === 'ONLINE';
        const driverCarType = normalizeCarType(driverData.carType);

        if (isOnline && dispatchEligible && isAvailable && driverCarType === requestedCarType) {
            return {
                success: true,
                hasDrivers: true,
                radiusKm
            };
        }
    }

    return {
        success: true,
        hasDrivers: false,
        radiusKm
    };
}

async function findAvailableDriversForPickup(pickupLocation, options = {}) {
    const redis = redisPool.getConnection();
    await redisPool.ensureConnection();

    const latitude = Number.parseFloat(pickupLocation?.lat);
    const longitude = Number.parseFloat(pickupLocation?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return {
            success: false,
            error: 'pickup_location_invalid',
            drivers: []
        };
    }

    const radiusKm = Number.parseFloat(options.radiusKm || process.env.PAYMENT_AVAILABILITY_RADIUS_KM || '5');
    const limit = Number.parseInt(options.limit || process.env.PAYMENT_AVAILABILITY_LIMIT || '12', 10);
    const requestedCarType = normalizeCarType(options.carType);
    const georadiusCount = Math.max(limit * 3, limit);
    const nearbyDrivers = await redis.georadius(
        'driver_locations',
        longitude,
        latitude,
        radiusKm,
        'km',
        'WITHCOORD',
        'WITHDIST',
        'COUNT',
        georadiusCount
    );

    if (!Array.isArray(nearbyDrivers) || nearbyDrivers.length === 0) {
        return {
            success: true,
            drivers: [],
            summary: {
                radiusKm,
                candidates: 0,
                eligible: 0
            }
        };
    }

    const eligibleDrivers = [];
    for (const driverEntry of nearbyDrivers) {
        const driverId = driverEntry?.[0];
        if (!driverId) continue;

        const distanceKm = Number.parseFloat(driverEntry?.[1] || '0');
        const coords = driverEntry?.[2];
        const lng = Number.parseFloat(coords?.[0]);
        const lat = Number.parseFloat(coords?.[1]);

        const lockStatus = await driverLockManager.isDriverLocked(driverId);
        if (lockStatus.isLocked) continue;

        const driverData = await redis.hgetall(`driver:${driverId}`);
        if (!driverData || Object.keys(driverData).length === 0) continue;

        const isOnline = driverData.isOnline === true || driverData.isOnline === 'true';
        const driverStatus = (driverData.status || '').toUpperCase();
        const isAvailable = driverStatus === 'AVAILABLE' || driverStatus === 'ONLINE';
        if (!isOnline || !isAvailable) continue;

        const driverCarType = normalizeCarType(driverData.carType);
        if (requestedCarType && driverCarType && driverCarType !== requestedCarType) {
            continue;
        }

        eligibleDrivers.push({
            id: driverId,
            distanceKm,
            estimatedArrivalMin: Math.max(1, Math.round(distanceKm / 0.583)),
            location: {
                lat,
                lng
            },
            carType: driverData.carType || null,
            rating: Number.parseFloat(driverData.rating || '5.0')
        });

        if (eligibleDrivers.length >= limit) {
            break;
        }
    }

    return {
        success: true,
        drivers: eligibleDrivers.sort((a, b) => a.distanceKm - b.distanceKm),
        summary: {
            radiusKm,
            candidates: nearbyDrivers.length,
            eligible: eligibleDrivers.length
        }
    };
}

// ==================== FUNÇÃO AUXILIAR: SALVAR LOCALIZAÇÃO DO MOTORISTA ====================
/**
 * Salvar localização do motorista no Redis (GEO + status)
 * Gerencia motoristas online e offline de forma otimizada
 * @param {string} driverId - ID do motorista
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} heading - Direção (opcional)
 * @param {number} speed - Velocidade (opcional)
 * @param {number} timestamp - Timestamp (opcional)
 * @param {boolean} isOnline - Se motorista está online (padrão: true)
 * @param {boolean} isInTrip - Se motorista está em viagem (padrão: false)
 */
const parseRedisBool = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true || value === false) return value;
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const computeDispatchEligibilityFromState = (driverState, isOnline, isInTrip) => {
    if (!isOnline) return { eligible: false, code: 'OFFLINE' };
    if (isInTrip) return { eligible: false, code: 'IN_TRIP' };

    const driverApproved = parseRedisBool(driverState?.driverApproved, true);
    const vehicleApproved = parseRedisBool(driverState?.vehicleApproved, true);
    const kycBlocked = parseRedisBool(driverState?.kyc_blocked, false) || parseRedisBool(driverState?.kycBlocked, false);
    const kycReverifyRequired =
        parseRedisBool(driverState?.kyc_reverify_required, false) ||
        parseRedisBool(driverState?.kycReverifyRequired, false);

    if (!driverApproved) return { eligible: false, code: 'DRIVER_NOT_APPROVED' };
    if (!vehicleApproved) return { eligible: false, code: 'VEHICLE_NOT_APPROVED' };
    if (kycBlocked || kycReverifyRequired) return { eligible: false, code: 'KYC_BLOCKED' };

    return { eligible: true, code: 'ELIGIBLE' };
};

const saveDriverLocation = async (
    driverId,
    lat,
    lng,
    heading = 0,
    speed = 0,
    timestamp = Date.now(),
    isOnline = true,
    isInTrip = false,
    preloadedDriverState = null
) => {
    const hotpathStart = Date.now();
    try {
        const redis = redisPool.getConnection();
        const driverKey = `driver:${driverId}`;
        const eligibleDriverGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

        // Garantir conexão Redis (ioredis usa status, não isOpen)
        if (redis.status !== 'ready' && redis.status !== 'connect') {
            try {
                await redis.connect();
            } catch (connectError) {
                // Se já está conectando/conectado, ignorar erro
                if (!connectError.message.includes('already connecting') &&
                    !connectError.message.includes('already connected')) {
                    throw connectError;
                }
            }
        }

        const existingDriverState = await getDriverStateHot(redis, driverId, preloadedDriverState);

        // 1. Construir patch completo de status
        const driverStatus = {
            id: driverId,
            isOnline: isOnline ? 'true' : 'false',
            status: isOnline ? 'AVAILABLE' : 'OFFLINE',
            lat: lat.toString(),
            lng: lng.toString(),
            heading: heading.toString(),
            speed: speed.toString(),
            lastUpdate: timestamp.toString(),
            timestamp: timestamp.toString(),
            lastSeen: new Date().toISOString()
        };
        const mergedDriverState = { ...existingDriverState, ...driverStatus };
        const eligibility = computeDispatchEligibilityFromState(mergedDriverState, isOnline, isInTrip);
        const dispatchPatch = {
            dispatchEligible: eligibility.eligible ? 'true' : 'false',
            dispatchEligibilityCode: eligibility.code,
            dispatchEligibilityCheckedAt: new Date().toISOString()
        };

        // ✅ OTIMIZAÇÃO: consolidar mutações em um único pipeline.
        const pipeline = redis.pipeline();
        pipeline.hset(driverKey, { ...driverStatus, ...dispatchPatch });

        if (isOnline) {
            // 2. Motorista ONLINE: adicionar/atualizar no GEO ativo (para match rápido)
            pipeline.geoadd('driver_locations', lng, lat, driverId);

            // 3. Remover do GEO offline (se estava offline antes)
            pipeline.zrem('driver_offline_locations', driverId);
            if (eligibility.eligible) {
                pipeline.geoadd(eligibleDriverGeoKey, lng, lat, driverId);
            } else {
                pipeline.zrem(eligibleDriverGeoKey, driverId);
            }

            // 5. ✅ OTIMIZAÇÃO: TTL diferenciado por estado (usando configuração centralizada)
            // - Em viagem: 60 segundos (dados críticos, mas heartbeat renova a cada 30s)
            // - Online disponível: 120 segundos (heartbeat renova a cada 30s, então nunca expira se online)
            // - Heartbeat garante que motorista parado permanece online
            const { getTTL } = require('./config/redis-ttl-config');
            const ttl = isInTrip
                ? getTTL('DRIVER_LOCATION', 'IN_TRIP')
                : getTTL('DRIVER_LOCATION', 'ONLINE');
            pipeline.expire(driverKey, ttl);

            const pipelineResult = await pipeline.exec();
            const pipelineError = pipelineResult?.find(([cmdErr]) => cmdErr)?.[0];
            if (pipelineError) {
                throw pipelineError;
            }
            runtimeMetrics.recordRedisHotpathOp('save_driver_location_online', 'pipeline_ops', 5);

            if (process.env.DEBUG_LOCATION === 'true' || process.env.DEBUG_DRIVER_LOCATION === 'true') {
                logStructured('debug', `Motorista ${isInTrip ? 'EM VIAGEM' : 'ONLINE'} salvo no Redis (GEO ativo)`, {
                    service: 'server',
                    driverId,
                    status: isInTrip ? 'IN_TRIP' : 'ONLINE',
                    location: { lat, lng },
                    dispatchEligible: eligibility.eligible,
                    dispatchEligibilityCode: eligibility.code,
                    ttl
                });
            }
        } else {
            // 2. Motorista OFFLINE: adicionar no GEO offline (para notificações de demanda)
            pipeline.geoadd('driver_offline_locations', lng, lat, driverId);

            // 3. Remover do GEO ativo (não deve aparecer em buscas de match)
            pipeline.zrem('driver_locations', driverId);

            // 4. Remover do GEO elegível para dispatch
            pipeline.zrem(eligibleDriverGeoKey, driverId);

            // 5. TTL longo para offline (24 horas - para notificações futuras)
            const { getTTL } = require('./config/redis-ttl-config');
            pipeline.expire(driverKey, getTTL('DRIVER_LOCATION', 'OFFLINE'));

            const pipelineResult = await pipeline.exec();
            const pipelineError = pipelineResult?.find(([cmdErr]) => cmdErr)?.[0];
            if (pipelineError) {
                throw pipelineError;
            }
            runtimeMetrics.recordRedisHotpathOp('save_driver_location_offline', 'pipeline_ops', 5);

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_DRIVER_LOCATION === 'true') {
                logStructured('debug', 'Motorista OFFLINE salvo no Redis (GEO offline)', {
                    service: 'server',
                    driverId,
                    lat,
                    lng
                });
            }
        }

        const cachedMergedState = { ...mergedDriverState, ...dispatchPatch };
        setCachedDriverState(driverId, cachedMergedState);
        runtimeMetrics.recordRealtimeUpdate('driver_state_hot_cache', 'set');
        runtimeMetrics.recordHotpathLatency('save_driver_location', (Date.now() - hotpathStart) / 1000, true);

    } catch (error) {
        runtimeMetrics.recordHotpathLatency('save_driver_location', (Date.now() - hotpathStart) / 1000, false);
        logStructured('error', 'Erro ao salvar localização do motorista', {
            service: 'server',
            driverId,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

function clearPendingDriverDisconnectCleanup(driverId, reason = null) {
    if (!driverId) {
        return false;
    }

    const pending = pendingDriverDisconnectCleanup.get(driverId);
    if (!pending) {
        return false;
    }

    clearTimeout(pending.timeoutHandle);
    pendingDriverDisconnectCleanup.delete(driverId);

    if (reason) {
        logStructured('info', 'Cleanup de desconexão de motorista cancelado durante janela de graça', {
            service: 'websocket',
            driverId,
            previousSocketId: pending.socketId,
            reason
        });
    }

    return true;
}

async function finalizeDriverDisconnectCleanup({
    io,
    driverId,
    socketId,
    vehiclePlate,
    reason
}) {
    if (!driverId) {
        return;
    }

    const replacementSocket = io?.connectedUsers?.get(driverId);
    if (replacementSocket && replacementSocket.connected && replacementSocket.id !== socketId) {
        logStructured('info', 'Cleanup de desconexão abortado: motorista reconectou na janela de graça', {
            service: 'websocket',
            userId: driverId,
            oldSocketId: socketId,
            newSocketId: replacementSocket.id,
            reason
        });
        return;
    }

    try {
        if (vehiclePlate) {
            logStructured('info', 'Liberando lock de veículo após grace period de desconexão', {
                service: 'websocket',
                socketId,
                userId: driverId,
                vehiclePlate
            });
            try {
                await vehicleLockManager.releaseLock(vehiclePlate, driverId);
            } catch (lockError) {
                logStructured('error', 'Erro ao liberar lock de veículo após grace period', {
                    service: 'websocket',
                    userId: driverId,
                    vehiclePlate,
                    error: lockError.message
                });
            }
        }

        const redis = redisPool.getConnection();
        if (redis.status !== 'ready' && redis.status !== 'connect') {
            try {
                await redis.connect();
            } catch (connectError) {
                if (!connectError.message.includes('already connecting') &&
                    !connectError.message.includes('already connected')) {
                    logStructured('error', 'Erro ao conectar Redis no cleanup de desconexão', {
                        service: 'websocket',
                        socketId,
                        userId: driverId,
                        error: connectError.message
                    });
                    return;
                }
            }
        }

        const driverData = await redis.hgetall(`driver:${driverId}`);
        if (driverData && driverData.lat && driverData.lng) {
            await saveDriverLocation(
                driverId,
                parseFloat(driverData.lat),
                parseFloat(driverData.lng),
                parseFloat(driverData.heading || 0),
                parseFloat(driverData.speed || 0),
                Date.now(),
                false
            );
        } else {
            try {
                await redis.zrem('driver_locations', driverId);
            } catch (zremError) {
                logStructured('warn', 'Erro ao remover motorista desconectado do GEO ativo após grace period', {
                    service: 'websocket',
                    socketId,
                    userId: driverId,
                    error: zremError.message
                });
            }
        }

        try {
            const nowIso = new Date().toISOString();
            await redis.hset(`driver:${driverId}`, {
                vehiclePlate: '',
                vehicleLockValidated: 'false',
                vehicleLockValidatedAt: nowIso,
                isOnline: 'false',
                updatedAt: nowIso
            });
        } catch (driverLockCleanupError) {
            logStructured('warn', 'Falha ao limpar estado de lock após grace period de desconexão', {
                service: 'websocket',
                socketId,
                userId: driverId,
                error: driverLockCleanupError.message
            });
        }

        logStructured('info', 'Cleanup de desconexão de motorista concluído após janela de graça', {
            service: 'websocket',
            socketId,
            userId: driverId,
            reason
        });
    } catch (error) {
        logStructured('error', 'Erro ao executar cleanup de desconexão de motorista', {
            service: 'websocket',
            socketId,
            userId: driverId,
            error: error.message,
            stack: error.stack
        });
    }
}

function scheduleDriverDisconnectCleanup({
    io,
    driverId,
    socketId,
    vehiclePlate,
    reason
}) {
    if (!driverId || DRIVER_DISCONNECT_GRACE_MS <= 0) {
        return false;
    }

    clearPendingDriverDisconnectCleanup(driverId);

    const timeoutHandle = setTimeout(async () => {
        pendingDriverDisconnectCleanup.delete(driverId);
        await finalizeDriverDisconnectCleanup({
            io,
            driverId,
            socketId,
            vehiclePlate,
            reason
        });
    }, DRIVER_DISCONNECT_GRACE_MS);

    pendingDriverDisconnectCleanup.set(driverId, {
        timeoutHandle,
        socketId,
        reason,
        vehiclePlate: vehiclePlate || null,
        createdAt: Date.now()
    });

    logStructured('info', 'Janela de graça de desconexão agendada para motorista', {
        service: 'websocket',
        userId: driverId,
        socketId,
        graceMs: DRIVER_DISCONNECT_GRACE_MS,
        reason
    });

    return true;
}
// =========================================================================================

// ✅ LOG DE DEBUG: Capturar erros de conexão
io.engine.on('connection_error', (err) => {
    logStructured('error', 'Erro de conexão Socket.IO', {
        service: 'websocket',
        url: err.req?.url,
        error: err.message
    });
});

// Helper para extrair metadados do socket para auditoria
const getSocketMetadata = (socket) => {
    const headers = socket.handshake?.headers || {};
    const ip = headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        headers['x-real-ip'] ||
        socket.handshake?.address ||
        socket.request?.connection?.remoteAddress ||
        'unknown';
    const userAgent = headers['user-agent'] || 'unknown';

    return {
        ip,
        userAgent,
        socketId: socket.id
    };
};

// ✅ Rate Limiter para conexões WebSocket
const websocketRateLimiter = require('./middleware/websocket-rate-limiter');

// ✅ REFATORAÇÃO: Configurar EventBus e Listeners
logStructured('info', 'Configurando EventBus e Listeners', { service: 'server', phase: 'refactoring' });
const eventBus = setupListeners(io);
logStructured('info', 'EventBus e Listeners configurados', { service: 'server', phase: 'refactoring' });

// ==================== WORKERS E ESCALABILIDADE ====================
// ✅ NOVO: Inicializar WorkerManager para processar listeners pesados em paralelo
let workerManager = null;
const initializeWorkers = async () => {
    try {
        // Garantir que Redis está pronto
        await redisPool.ensureConnection();

        logStructured('info', 'Inicializando WorkerManager', { service: 'server', phase: 'workers' });

        // Criar WorkerManager
        workerManager = new WorkerManager({
            streamName: 'ride_events',
            groupName: 'listener-workers',
            consumerName: `server-worker-${process.pid}`,
            batchSize: 10,
            blockTime: 1000,
            maxRetries: 3,
            retryBackoff: [1000, 2000, 5000]
        });

        // Importar listeners pesados
        const notifyDrivers = require('./listeners/onRideRequested.notifyDrivers');
        const sendPush = require('./listeners/onRideAccepted.sendPush');
        const notifyPassenger = require('./listeners/onRideAccepted.notifyPassenger');
        const notifyDriver = require('./listeners/onRideAccepted.notifyDriver');
        const startTripTimer = require('./listeners/onRideStarted.startTripTimer');

        // Registrar listeners pesados no WorkerManager
        // Nota: io já está exposto globalmente (linha ~507)
        // Nota: io será acessado via global.io nos listeners
        workerManager.registerListener(EVENT_TYPES.RIDE_REQUESTED, async (event) => {
            // notifyDrivers precisa de io, usar global.io
            const ioInstance = global.io || io;
            await notifyDrivers(event, ioInstance);
        });

        workerManager.registerListener(EVENT_TYPES.RIDE_ACCEPTED, async (event) => {
            const ioInstance = global.io || io;
            await notifyPassenger(event, ioInstance);
            await notifyDriver(event, ioInstance);
            await sendPush(event, ioInstance);
        });

        workerManager.registerListener(EVENT_TYPES.RIDE_STARTED, async (event) => {
            const ioInstance = global.io || io;
            await startTripTimer(event, ioInstance);
        });

        workerManager.registerListener(EVENT_TYPES.RIDE_CANCELED, async (event) => {
            const rawPayload = event?.data && typeof event.data === 'object' ? event.data : {};
            const nestedPayload = rawPayload?.data && typeof rawPayload.data === 'object' ? rawPayload.data : null;
            const bookingId = event?.bookingId || rawPayload?.bookingId || nestedPayload?.bookingId;
            if (!bookingId) {
                logStructured('debug', 'RIDE_CANCELED listener ignorou evento sem bookingId', {
                    listener: 'ride_canceled.stop_search',
                    eventType: event?.eventType || null
                });
                return;
            }
            const ioInstance = global.io || io;
            const GradualRadiusExpander = require('./services/gradual-radius-expander');
            const expander = new GradualRadiusExpander(ioInstance);
            await expander.stopSearch(bookingId);
        });

        // Inicializar WorkerManager
        const initialized = await workerManager.initialize();
        if (!initialized) {
            logStructured('warn', 'Falha ao inicializar WorkerManager, continuando sem workers', {
                service: 'server',
                phase: 'workers'
            });
            return;
        }

        // Iniciar worker em background (não bloqueia servidor)
        // Nota: start() é um loop infinito, então não podemos usar await aqui
        workerManager.start().catch((error) => {
            logError(error, 'Erro no WorkerManager', { service: 'server', phase: 'workers' });
        });

        logStructured('info', 'WorkerManager inicializado e rodando', {
            service: 'server',
            phase: 'workers',
            consumerName: workerManager.consumerName
        });

    } catch (error) {
        logError(error, 'Erro ao inicializar WorkerManager', {
            service: 'server',
            phase: 'workers'
        });
        // Não lançar erro - servidor deve continuar funcionando sem workers
        logStructured('warn', 'Servidor continuará funcionando sem workers (fallback para processamento síncrono)', {
            service: 'server',
            phase: 'workers'
        });
    }
};

// Inicializar workers após Redis estar pronto
// Executar em background para não bloquear inicialização do servidor
if (ENABLE_EMBEDDED_LISTENER_WORKERS) {
    initializeWorkers().catch((error) => {
        logError(error, 'Erro ao inicializar workers', { service: 'server' });
    });
} else {
    logStructured('info', 'WorkerManager embutido desabilitado para este runtime role', {
        service: 'server',
        phase: 'workers',
        runtimeRole: RUNTIME_ROLE
    });
}
// ====================================================================

// ✅ NOVO: Middleware para gerar traceId automaticamente em conexões Socket.IO
io.use(traceIdSocketMiddleware);
io.use((socket, next) => runSocketAdmission(socket, next));

// ✅ CRÍTICO: Inicializar GraphQL e iniciar servidor ANTES de registrar handlers
// Integrar GraphQL com o servidor
const initializeGraphQL = async () => {
    try {
        logStructured('info', 'Inicializando GraphQL', { service: 'graphql' });

        // Aplicar middleware do GraphQL (já inicia o servidor)
        await applyMiddleware(app);

        const playgroundEnabled = process.env.NODE_ENV !== 'production' ? '/graphql' : 'disabled';
        logStructured('info', 'GraphQL integrado com sucesso', {
            service: 'graphql',
            endpoint: '/graphql',
            playground: playgroundEnabled
        });

    } catch (error) {
        logError(error, 'Erro ao inicializar GraphQL', { service: 'graphql' });
        // Continuar sem GraphQL se houver erro
    }
};

// ✅ Inicializar GraphQL e depois iniciar servidor
// IMPORTANTE: Este bloco DEVE ser executado para o servidor escutar na porta
logStructured('info', '🔵 Iniciando processo de inicialização do servidor', { service: 'server' });
(async () => {
    try {
        logStructured('info', 'Iniciando processo de inicialização do servidor', { service: 'server' });
        await initializeGraphQL();
        logStructured('info', 'GraphQL inicializado, iniciando servidor HTTP', { service: 'server' });

        // Iniciar servidor
        const PORT = process.env.PORT || 3001;
        const HOST = process.env.HOST || '0.0.0.0'; // Escutar em todas as interfaces para aceitar conexões da rede local

        logStructured('info', 'Chamando server.listen()', { service: 'server', port: PORT, host: HOST });

        if (!server) {
            logStructured('error', 'Variável server não está definida!', { service: 'server' });
            throw new Error('Variável server não está definida');
        }

        server.listen(PORT, HOST, () => {
            if (process.env.NODE_ENV === 'production') {
                logStructured('info', 'Ultra Worker rodando', { service: 'server', workerId: cluster.worker?.id || 'N/A', port: PORT, maxConnections: VPS_CONFIG.MAX_CONNECTIONS, workers: VPS_CONFIG.CLUSTER_WORKERS });
            } else {
                logStructured('info', 'Servidor de desenvolvimento iniciado', {
                    service: 'server',
                    port: PORT
                });
                logStructured('info', 'Configurado para conexões', { service: 'server', maxConnections: VPS_CONFIG.MAX_CONNECTIONS });
            }
            logStructured('info', 'Servidor iniciado', {
                service: 'server',
                port: PORT,
                graphqlEndpoint: `http://localhost:${PORT}/graphql`,
                websocketEndpoint: `ws://localhost:${PORT}`
            });

            // ✅ Injetar Socket.IO no SupportChatService
            const supportChatService = require('./services/support-chat-service');
            supportChatService.setIOInstance(io);
            logStructured('info', 'Support Chat Service conectado ao Socket.IO', { service: 'support-chat' });

            // ✅ Iniciar serviço de limpeza automática de conexões
            const connectionCleanupService = new ConnectionCleanupService(io);
            connectionCleanupService.start();
            logStructured('info', 'Serviço de limpeza de conexões iniciado', { service: 'connection-cleanup' });

            const isSchedulerLeaderWorker =
                !CLUSTER_ENABLED || !cluster.worker || cluster.worker.id === CLUSTER_SCHEDULER_LEADER_ID;
            if (isSchedulerLeaderWorker) {
                // ✅ Iniciar serviço de cobrança diária de assinatura
                const dailySubscriptionService = require('./services/daily-subscription-service');

                // Agendar cobrança diária (todos os dias às 00:00)
                const scheduleDailySubscription = () => {
                    const now = new Date();
                    const tomorrow = new Date(now);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    tomorrow.setHours(0, 0, 0, 0); // Meia-noite

                    const msUntilMidnight = tomorrow.getTime() - now.getTime();

                    // Agendar primeira execução
                    setTimeout(() => {
                        logStructured('info', 'Iniciando cobrança diária de assinaturas', { service: 'daily-subscription' });
                        dailySubscriptionService.processAllDailyCharges()
                            .then(result => {
                                logStructured('info', 'Cobrança diária concluída', {
                                    service: 'daily-subscription',
                                    total: result.total,
                                    processed: result.processed,
                                    skipped: result.skipped,
                                    failed: result.failed
                                });
                            })
                            .catch(error => {
                                logError(error, 'Erro na cobrança diária', { service: 'daily-subscription' });
                            });

                        // Agendar próxima execução (24 horas depois)
                        setInterval(() => {
                            logStructured('info', 'Iniciando cobrança diária de assinaturas', { service: 'daily-subscription' });
                            dailySubscriptionService.processAllDailyCharges()
                                .then(result => {
                                    logStructured('info', 'Cobrança diária concluída', {
                                        service: 'daily-subscription',
                                        total: result.total,
                                        processed: result.processed,
                                        skipped: result.skipped,
                                        failed: result.failed
                                    });
                                })
                                .catch(error => {
                                    logError(error, 'Erro na cobrança diária', { service: 'daily-subscription' });
                                });
                        }, 24 * 60 * 60 * 1000); // 24 horas
                    }, msUntilMidnight);

                    logStructured('info', 'Cobrança diária de assinaturas agendada', {
                        service: 'daily-subscription',
                        scheduledFor: tomorrow.toISOString(),
                        workerId: cluster.worker?.id || null
                    });
                };

                scheduleDailySubscription();

                // Reprocessa finalizacoes pendentes (outbox) para garantir persistencia no Firestore.
                try {
                    const ridePersistenceService = require('./services/ride-persistence-service');
                    const outboxIntervalMs = Number.parseInt(process.env.RIDE_FINALIZATION_OUTBOX_INTERVAL_MS || '10000', 10);
                    setInterval(async () => {
                        const stats = await ridePersistenceService.processFinalizationOutboxBatch(30);
                        if ((stats.processed || 0) > 0 || (stats.retried || 0) > 0 || (stats.failed || 0) > 0) {
                            logStructured('info', 'Outbox de finalizacao processado', {
                                service: 'ride-persistence',
                                processed: stats.processed || 0,
                                retried: stats.retried || 0,
                                failed: stats.failed || 0
                            });
                        }
                    }, outboxIntervalMs);
                } catch (outboxInitError) {
                    logStructured('error', 'Falha ao iniciar processador de outbox de finalizacao', {
                        service: 'ride-persistence',
                        error: outboxInitError.message
                    });
                }
            } else {
                logStructured('info', 'Jobs periódicos desabilitados neste worker do cluster', {
                    service: 'server',
                    workerId: cluster.worker?.id || null,
                    schedulerLeaderWorkerId: CLUSTER_SCHEDULER_LEADER_ID
                });
            }

            logStructured('info', 'Health endpoint disponível', { service: 'server', healthEndpoint: `http://localhost:${PORT}/health` });
            logStructured('info', 'SERVIDOR ESCUTANDO NA PORTA', { service: 'server', port: PORT, host: HOST });
        }); // Fecha server.listen callback
    } catch (error) {
        logError(error, 'Erro ao inicializar servidor', { service: 'server' });
        process.exit(1);
    }
})();

// WebSocket events ultra-otimizados
io.on('connection', async (socket) => {
    const authDebugEnabled = process.env.DEBUG_AUTH_EVENTS === 'true';
    const releaseAdmissionSlotIfNeeded = () => {
        if (typeof socket.__releaseAdmissionSlot === 'function') {
            socket.__releaseAdmissionSlot();
            socket.__releaseAdmissionSlot = null;
        }
    };

    if (authDebugEnabled) {
        logStructured('debug', 'Nova conexão WebSocket', {
            service: 'websocket',
            socketId: socket.id,
            totalConnections: io.engine.clientsCount,
            workerId: cluster.worker?.id || 'main'
        });
    }

    // ==================== NOVOS EVENTOS - NOTIFICAÇÕES FCM ====================
    // REGISTRAR IMEDIATAMENTE PARA NÃO PERDER EVENTOS DO CLIENTE
    socket.on('registerFCMToken', async (data) => {
        try {
            logStructured('info', `Token FCM registrado`, { service: 'registerFCMToken', userId: data.userId, userType: data.userType, platform: data.platform });

            const { userId, userType, fcmToken, platform, timestamp } = data;

            if (!fcmToken) {
                logStructured('error', `Token FCM não fornecido`, { service: 'registerFCMToken' });
                socket.emit('fcmTokenError', { error: 'Token FCM é obrigatório' });
                return;
            }

            const effectiveUserId = userId || `temp_${socket.id}`;
            const effectiveUserType = userType || 'customer';

            if (!userId) {
                logStructured('warn', `Token FCM registrado sem userId, usando temporário`, { service: 'registerFCMToken', effectiveUserId });
            }

            const redis = redisPool.getConnection();

            if (effectiveUserType === 'driver') {
                await redis.hset(`driver:${effectiveUserId}`, {
                    fcmToken: fcmToken,
                    fcmTokenUpdated: new Date().toISOString(),
                    fcmPlatform: platform || 'unknown',
                    isTemporary: (!userId).toString()
                });
            } else {
                await redis.hset(`user:${effectiveUserId}`, {
                    fcmToken: fcmToken,
                    fcmTokenUpdated: new Date().toISOString(),
                    fcmPlatform: platform || 'unknown',
                    isTemporary: (!userId).toString()
                });
            }

            try {
                if (!fcmService.isServiceAvailable()) {
                    logStructured('info', 'Inicializando FCMService para registro de token', { service: 'websocket' });
                    fcmService.setRedis(redis);
                    await fcmService.initialize();
                }

                const saved = await fcmService.saveUserFCMToken(effectiveUserId, effectiveUserType, fcmToken, {
                    platform,
                    isTemporary: !userId,
                    socketId: socket.id
                });
            } catch (fcmError) {
                logStructured('error', 'Erro ao salvar token no FCMService', { service: 'websocket', operation: 'registerFCMToken', error: fcmError.message });
            }

            socket.emit('fcmTokenRegistered', {
                success: true,
                userId: effectiveUserId,
                message: 'Token FCM registrado com sucesso'
            });
        } catch (error) {
            logError(error, 'Erro ao registrar token FCM', { service: 'registerFCMToken', userId: data.userId });
            socket.emit('fcmTokenError', { error: 'Erro interno do servidor: ' + error.message });
        }
    });

    socket.on('unregisterFCMToken', async (data) => {
        try {
            const { userId, fcmToken } = data;
            if (!userId || !fcmToken) return;
            const redis = redisPool.getConnection();
            await fcmService.removeUserFCMToken(userId, fcmToken);
            socket.emit('fcmTokenUnregistered', { success: true });
        } catch (error) {
            logError(error, 'Erro ao desregistrar token FCM', { service: 'unregisterFCMToken' });
        }
    });
    // ==========================================================================

    // ✅ Registrar handler de authenticate IMEDIATAMENTE após conexão
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
        logStructured('debug', 'Registrando handlers para socket', {
            service: 'websocket',
            socketId: socket.id,
            headers: socket.handshake.headers
        });
    }

    // ✅ REGISTRAR HANDLER ANTES DE QUALQUER OPERAÇÃO ASSÍNCRONA
    // Isso garante que o handler esteja pronto quando o evento chegar
    socket.on('authenticate', async (data) => {
        if (authDebugEnabled) {
            logStructured('debug', 'Evento authenticate recebido', {
                service: 'websocket',
                socketId: socket.id,
                hasData: !!data
            });
        }
        recordRealtimeMetricSafe('authenticate', 'attempt');

        try {
            // Verificar token de autenticação (JWT)
            const isProd = process.env.NODE_ENV === 'production';
            const requestedUserType = data.userType || data.usertype || socket.userType;
            let verifiedUid = null;
            let verifiedAuthContext = null;
            let releaseAuthSlot = () => { };

            const handshakeTokenRaw =
                socket.handshake?.auth?.token ||
                socket.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
                '';
            const authTokenRaw = data?.token || handshakeTokenRaw;
            const authToken = typeof authTokenRaw === 'string' ? authTokenRaw.trim() : '';
            const authTokenDigest = fingerprintToken(authToken);

            // Fast-path: mesma sessão/socket já autenticado com o mesmo token e tipo.
            if (
                socket.userId &&
                socket.userType === requestedUserType &&
                (
                    (authTokenDigest && socket.authTokenDigest === authTokenDigest) ||
                    (!authTokenDigest && socket.userId === data?.uid)
                )
            ) {
                socket.emit('authenticated', {
                    uid: socket.userId,
                    userId: socket.userId,
                    success: true,
                    userType: socket.userType,
                    socketId: socket.id,
                    reauthenticated: true
                });
                recordRealtimeMetricSafe('authenticate', 'success_reauth');
                releaseAdmissionSlotIfNeeded();
                return;
            }

            if (isProd || authToken) {
                if (!authToken) {
                    recordRealtimeMetricSafe('authenticate', 'error_missing_token');
                    socket.emit('authentication_error', { message: 'Token de autenticação ausente' });
                    socket.emit('auth_error', { message: 'Token de autenticação ausente' });
                    socket.disconnect();
                    releaseAdmissionSlotIfNeeded();
                    return;
                }

                try {
                    let verified = false;
                    let busyAuthError = null;
                    for (let attempt = 0; attempt <= AUTH_VERIFY_BUSY_RETRY_ATTEMPTS; attempt += 1) {
                        releaseAuthSlot = () => { };
                        try {
                            releaseAuthSlot = await acquireAuthVerifySlot();
                            verifiedAuthContext = await verifyFirebaseTokenCached(authToken, requestedUserType || 'unknown');
                            verifiedUid = verifiedAuthContext.uid;
                            verified = true;
                            break;
                        } catch (authError) {
                            const authBusy = authError?.message === 'AUTH_BUSY_QUEUE_FULL' || authError?.message === 'AUTH_BUSY_TIMEOUT';
                            if (!authBusy) {
                                throw authError;
                            }

                            busyAuthError = authError;
                            if (attempt >= AUTH_VERIFY_BUSY_RETRY_ATTEMPTS) {
                                throw authError;
                            }

                            const backoffMs = AUTH_VERIFY_BUSY_RETRY_DELAY_MS * (attempt + 1);
                            await sleepMs(backoffMs);
                        } finally {
                            releaseAuthSlot();
                        }
                    }

                    if (!verified && busyAuthError) {
                        throw busyAuthError;
                    }
                } catch (authError) {
                    if (authError?.message === 'AUTH_BUSY_QUEUE_FULL' || authError?.message === 'AUTH_BUSY_TIMEOUT') {
                        const retryAfterSec = AUTH_BUSY_RETRY_AFTER_SEC;
                        recordRealtimeMetricSafe('authenticate', 'auth_busy');
                        socket.emit('authentication_error', {
                            message: 'Sistema autenticando em alta carga. Tente novamente.',
                            code: 'AUTH_BUSY',
                            retryAfterSec
                        });
                        socket.emit('auth_error', {
                            message: 'Sistema autenticando em alta carga. Tente novamente.',
                            code: 'AUTH_BUSY',
                            retryAfterSec
                        });
                        releaseAdmissionSlotIfNeeded();
                        return;
                    }
                    logStructured('warn', `Token de autenticação inválido ou expirado: ${authError.message}`, {
                        service: 'websocket',
                        socketId: socket.id
                    });
                    recordRealtimeMetricSafe('authenticate', 'error_invalid_token');
                    socket.emit('authentication_error', { message: 'Token inválido ou expirado' });
                    socket.emit('auth_error', { message: 'Token inválido ou expirado' });
                    socket.disconnect();
                    releaseAdmissionSlotIfNeeded();
                    return;
                }
            } else {
                // Modo dev/teste sem token
                verifiedUid = data.uid;

                if (!verifiedUid) {
                    recordRealtimeMetricSafe('authenticate', 'error_missing_uid');
                    socket.emit('authentication_error', { message: 'ID de usuário (uid) ausente' });
                    socket.disconnect();
                    releaseAdmissionSlotIfNeeded();
                    return;
                }
            }

            // A partir daqui, usar SOMENTE o uid validado pelo token
            const authUserId = verifiedUid;
            const authUserType = requestedUserType || verifiedAuthContext?.role || 'unknown';

            // ✅ Registrar conexão no monitor centralizado (não bloquear se falhar)
            const workerId = process.env.NODE_ENV === 'production'
                ? `worker-${cluster.worker?.id || 'main'}`
                : `dev-${process.pid}`;
            socket.workerId = workerId;

            connectionMonitor
                .registerConnection(socket.id, authUserId, authUserType, workerId)
                .catch((monitorError) => {
                    logStructured('error', 'Erro ao registrar no connectionMonitor (continuando)', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: authUserId,
                        error: monitorError.message
                    });
                });

            // Armazenar informações do usuário no socket
            socket.userId = authUserId;
            socket.userType = authUserType; // Armazenar tipo: driver ou customer/passenger
            socket.authTokenDigest = authTokenDigest;
            if (socket.userType === 'driver') {
                clearPendingDriverDisconnectCleanup(authUserId, 'reauthenticated');
            }
            if (authTokenDigest && authTokenCache.has(authTokenDigest)) {
                const cachedContext = authTokenCache.get(authTokenDigest);
                if (cachedContext) {
                    cachedContext.role = socket.userType || cachedContext.role || 'unknown';
                    cachedContext.sessionState = AUTH_CONTEXT_STATE.AUTHENTICATED;
                    cachedContext.lastSeenAt = Date.now();
                    authTokenCache.set(authTokenDigest, cachedContext);
                }
            }

            if (authDebugEnabled) {
                logStructured('debug', 'Usuário autenticado', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId,
                    userType: socket.userType
                });
            }

            const sessionRoom = `session_user_${authUserId}`;

            // Inicializar rastreamento de conexões local (compatibilidade observabilidade)
            if (!io.connectedUsers) {
                io.connectedUsers = new Map();
            }

            // Política: Bloquear sessão simultânea (conforme PARAMETROS_DEFINIDOS.md)
            // ✅ DESABILITADO para testes - permitir múltiplas conexões de teste
            const SESSION_SIMULTANEA_BLOCKED = process.env.ALLOW_MULTIPLE_SESSIONS !== 'true'; // Permitir em testes

            // Registrar nova conexão
            io.connectedUsers.set(authUserId, socket);
            socket.join(sessionRoom);

            let sessionLockRef = null;
            const sessionLockOwner = `${socket.id}:${Date.now()}`;
            let redisForSessionLock = null;
            if (SESSION_SIMULTANEA_BLOCKED) {
                try {
                    await redisPool.ensureConnection();
                    redisForSessionLock = redisPool.getConnection();
                    sessionLockRef = await acquireUserSessionLock(redisForSessionLock, authUserId, sessionLockOwner);
                    if (!sessionLockRef.acquired) {
                        logStructured('warn', 'Não foi possível adquirir lock de sessão no tempo limite', {
                            service: 'websocket',
                            userId: authUserId,
                            socketId: socket.id
                        });
                    }
                } catch (sessionLockError) {
                    logStructured('warn', 'Falha ao adquirir lock de sessão', {
                        service: 'websocket',
                        userId: authUserId,
                        socketId: socket.id,
                        error: sessionLockError.message
                    });
                }
            }

            try {
                // Fast-path: evitar fetchSockets cross-worker por conexão (custoso em alto volume).
                // Em modo bloqueado, terminamos qualquer sessão anterior pelo room da sessão.
                if (SESSION_SIMULTANEA_BLOCKED) {
                    io.to(sessionRoom).except(socket.id).emit('sessionTerminated', {
                        reason: 'Nova sessão iniciada em outro dispositivo',
                        timestamp: new Date().toISOString()
                    });
                    io.in(sessionRoom).except(socket.id).disconnectSockets(true);
                }
            } finally {
                if (SESSION_SIMULTANEA_BLOCKED && sessionLockRef?.acquired && redisForSessionLock) {
                    await releaseUserSessionLock(redisForSessionLock, sessionLockRef, sessionLockOwner);
                }
            }

            // ✅ Atualizar tipo de conexão no monitor centralizado
            connectionMonitor
                .updateConnectionType(socket.id, authUserId, socket.userType)
                .catch((monitorError) => {
                    logStructured('error', 'Erro ao atualizar connectionMonitor (continuando)', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: authUserId,
                        error: monitorError.message
                    });
                });

            // Se for driver, adicionar ao room de drivers E room específico
            if (socket.userType === 'driver') {
                socket.join('drivers_room');
                socket.join(`driver_${authUserId}`); // ✅ Room específico para notificações diretas (usado pelo DriverNotificationDispatcher)
                if (authDebugEnabled) {
                    logStructured('debug', 'Driver adicionado aos rooms', {
                        service: 'websocket',
                        userId: authUserId,
                        socketId: socket.id
                    });
                }
            } else if (socket.userType === 'passenger' || socket.userType === 'customer') {
                socket.join('customers_room');
                socket.join(`customer_${authUserId}`); // ✅ Room específico para notificações diretas
                if (authDebugEnabled) {
                    logStructured('debug', 'Customer adicionado aos rooms', {
                        service: 'websocket',
                        userId: authUserId,
                        socketId: socket.id
                    });
                }
            }

            // Atualização de FCM não bloqueia mais o handshake de autenticação.
            const bindFCMTokenAsync = async () => {
                try {
                    await redisPool.ensureConnection();
                    const redis = redisPool.getConnection();
                    const tempUserId = `temp_${socket.id}`;

                    if (!fcmService.isServiceAvailable()) {
                        fcmService.setRedis(redis);
                        await fcmService.initialize();
                    }

                    let fcmToken = await redis.hget(`user:${tempUserId}`, 'fcmToken');
                    if (!fcmToken && socket.userType === 'driver') {
                        fcmToken = await redis.hget(`driver:${tempUserId}`, 'fcmToken');
                    }

                    if (!fcmToken) {
                        fcmToken = await redis.hget(`user:${authUserId}`, 'fcmToken');
                        if (!fcmToken && socket.userType === 'driver') {
                            fcmToken = await redis.hget(`driver:${authUserId}`, 'fcmToken');
                        }
                    }

                    if (!fcmToken) {
                        return;
                    }

                    const platform = await redis.hget(`user:${tempUserId}`, 'fcmPlatform') ||
                        await redis.hget(`user:${authUserId}`, 'fcmPlatform') ||
                        await redis.hget(`driver:${tempUserId}`, 'fcmPlatform') ||
                        await redis.hget(`driver:${authUserId}`, 'fcmPlatform') ||
                        'unknown';

                    if (socket.userType === 'driver') {
                        await redis.hset(`driver:${authUserId}`, {
                            fcmToken: fcmToken,
                            fcmTokenUpdated: new Date().toISOString(),
                            fcmPlatform: platform,
                            isTemporary: 'false',
                            authenticatedAt: new Date().toISOString(),
                            userId: authUserId
                        });
                    } else {
                        await redis.hset(`user:${authUserId}`, {
                            fcmToken: fcmToken,
                            fcmTokenUpdated: new Date().toISOString(),
                            fcmPlatform: platform,
                            isTemporary: 'false',
                            authenticatedAt: new Date().toISOString(),
                            userId: authUserId
                        });
                    }

                    await fcmService.saveUserFCMToken(authUserId, socket.userType, fcmToken, {
                        platform,
                        authenticated: true,
                        authenticatedAt: new Date().toISOString(),
                        userId: authUserId,
                        userType: socket.userType
                    });

                    if (await redis.exists(`user:${tempUserId}`) || await redis.exists(`driver:${tempUserId}`)) {
                        const tempTokens = await redis.hgetall(`fcm_tokens:${tempUserId}`);
                        for (const token of Object.keys(tempTokens)) {
                            await redis.hdel(`fcm_tokens:${tempUserId}`, token);
                        }
                        await redis.del(`user:${tempUserId}`);
                        await redis.del(`driver:${tempUserId}`);
                    }

                    socket.emit('fcmTokenUpdated', {
                        success: true,
                        userId: authUserId,
                        message: 'Token FCM vinculado ao usuário autenticado',
                        token: fcmToken.substring(0, 20) + '...'
                    });
                } catch (updateError) {
                    logStructured('error', 'Erro ao atualizar token FCM para usuário autenticado', {
                        service: 'websocket',
                        userId: authUserId,
                        error: updateError.message
                    });
                }
            };

            if (process.env.AUTH_SYNC_FCM === 'true') {
                await bindFCMTokenAsync();
            } else {
                setImmediate(() => {
                    bindFCMTokenAsync().catch(() => { });
                });
            }

            // Preparar payload de resposta
            const authResponse = {
                uid: authUserId,
                userId: authUserId, // ✅ Adicionar userId para compatibilidade
                success: true,
                userType: socket.userType || authUserType, // ✅ Incluir userType que o app espera
                socketId: socket.id // ✅ Adicionar socketId para debug
            };

            // Adicionar status inicial para drivers (conforme política: Status inicial = offline)
            if (socket.userType === 'driver') {
                authResponse.status = 'offline';
                authResponse.initialStatus = 'offline';
            }

            // ✅ GARANTIR que userId e userType estão setados no socket
            socket.userId = authUserId;
            socket.userType = socket.userType || authUserType;

            if (authDebugEnabled) {
                logStructured('debug', 'Autenticação confirmada', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId,
                    userType: socket.userType
                });
            }

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                logStructured('debug', 'Enviando evento authenticated', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId,
                    payload: authResponse
                });
            }

            // ✅ Emitir authenticated ANTES de qualquer outra coisa
            socket.emit('authenticated', authResponse);
            recordRealtimeMetricSafe('authenticate', 'success');

            if (AUTH_PUSH_ACTIVE_RIDE_SYNC) {
                setImmediate(async () => {
                    try {
                        const redis = redisPool.getConnection();
                        if (redis.status !== 'ready' && redis.status !== 'connect') {
                            await redis.connect().catch(() => { });
                        }

                        const activeRideSnapshot = await buildActiveRideSnapshotForUser(
                            redis,
                            authUserId,
                            socket.userType
                        );

                        socket.emit('activeRideSync', {
                            success: true,
                            source: 'auth_rehydrate',
                            ...activeRideSnapshot,
                            syncedAt: new Date().toISOString()
                        });
                    } catch (activeRideSyncError) {
                        logStructured('warn', 'Falha ao enviar sync de corrida ativa pós-autenticação', {
                            service: 'websocket',
                            socketId: socket.id,
                            userId: authUserId,
                            userType: socket.userType,
                            error: activeRideSyncError.message
                        });
                    }
                });
            }

            releaseAdmissionSlotIfNeeded();
            if (authDebugEnabled) {
                logStructured('debug', 'Evento authenticated emitido', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId
                });
            }
        } catch (error) {
            logStructured('error', 'Erro na autenticação', {
                service: 'websocket',
                socketId: socket.id,
                userId: data.uid || 'unknown',
                error: error.message,
                stack: error.stack
            });
            recordRealtimeMetricSafe('authenticate', 'error_exception');
            socket.emit('auth_error', { message: error.message });
            releaseAdmissionSlotIfNeeded();
        }
    });

    // ==================== FASE 1: REGISTRAR TODOS OS HANDLERS CRÍTICOS (ANTES DE QUALQUER OPERAÇÃO ASSÍNCRONA) ====================
    // ✅ CRÍTICO: Registrar handlers críticos imediatamente para evitar race conditions
    // Estes handlers devem estar prontos antes de qualquer evento chegar

    // 1. Disconnect (crítico - deve estar sempre pronto)
    socket.on('disconnect', async (reason) => {
        releaseAdmissionSlotIfNeeded();
        if (process.env.DEBUG_WEBSOCKET === 'true') {
            logStructured('debug', 'Desconexão WebSocket', {
                service: 'websocket',
                socketId: socket.id,
                userId: socket.userId,
                userType: socket.userType,
                reason: reason, // ✅ Adicionado: motivo da desconexão
                totalConnections: io.engine.clientsCount
            });
        }

        // ✅ Remover conexão do rate limiter
        await websocketRateLimiter.unregisterConnection(socket);

        // ✅ Remover conexão do monitor centralizado
        await connectionMonitor.unregisterConnection(socket.id, socket.workerId);

        // Se for motorista, salvar última localização como offline e liberar lock de veículo
        if (socket.userId && socket.userType === 'driver') {
            const replacementSocket = io.connectedUsers?.get(socket.userId);
            const hasActiveReplacement =
                replacementSocket &&
                replacementSocket.connected &&
                replacementSocket.id !== socket.id;

            if (hasActiveReplacement) {
                logStructured('info', 'Desconexão de socket antigo ignorada: motorista já possui sessão ativa', {
                    service: 'websocket',
                    userId: socket.userId,
                    oldSocketId: socket.id,
                    newSocketId: replacementSocket.id,
                    reason
                });
            } else if (DRIVER_DISCONNECT_GRACE_MS > 0) {
                scheduleDriverDisconnectCleanup({
                    io,
                    driverId: socket.userId,
                    socketId: socket.id,
                    vehiclePlate: socket.vehiclePlate,
                    reason
                });
            } else {
                await finalizeDriverDisconnectCleanup({
                    io,
                    driverId: socket.userId,
                    socketId: socket.id,
                    vehiclePlate: socket.vehiclePlate,
                    reason
                });
            }
        }

        // Limpar registro de usuário conectado
        if (socket.userId && io.connectedUsers) {
            const existingSocket = io.connectedUsers.get(socket.userId);
            if (existingSocket && existingSocket.id === socket.id) {
                io.connectedUsers.delete(socket.userId);
                logStructured('info', 'Removido do registro de conexões', {
                    service: 'websocket',
                    userId: socket.userId,
                    socketId: socket.id,
                    action: 'cleanup_connection'
                });
            }
        }
    });

    socket.on('syncActiveRide', async (data = {}) => {
        try {
            const userId = socket.userId || data.uid || data.userId;
            const userType = socket.userType || data.userType;

            if (!userId || !userType) {
                socket.emit('activeRideSync', {
                    success: false,
                    code: 'NOT_AUTHENTICATED',
                    message: 'Usuário não autenticado para sincronização de corrida ativa'
                });
                return;
            }

            const redis = redisPool.getConnection();
            if (redis.status !== 'ready' && redis.status !== 'connect') {
                await redis.connect().catch(() => { });
            }

            const activeRideSnapshot = await buildActiveRideSnapshotForUser(redis, userId, userType);

            socket.emit('activeRideSync', {
                success: true,
                source: 'explicit_sync',
                ...activeRideSnapshot,
                syncedAt: new Date().toISOString()
            });
        } catch (error) {
            logStructured('error', 'Erro ao sincronizar corrida ativa para reconexão', {
                service: 'websocket',
                socketId: socket.id,
                userId: socket.userId || 'unknown',
                userType: socket.userType || 'unknown',
                error: error.message
            });

            socket.emit('activeRideSync', {
                success: false,
                code: 'SYNC_FAILED',
                message: 'Não foi possível sincronizar a corrida ativa agora'
            });
        }
    });

    // ======================== EVENTOS DE CORRIDA ========================

    // ==================== FASE 7: createBooking - INTEGRAÇÃO COM SISTEMA DE FILAS ====================
    const CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS = Number.parseInt(
        process.env.CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS || '21600',
        10
    );
    const CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH = process.env.CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH !== 'false';
    const SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS = process.env.SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS !== 'false';
    const REQUIRE_PAYMENT_BEFORE_BOOKING =
        String(process.env.REQUIRE_PAYMENT_BEFORE_BOOKING || 'true').toLowerCase() !== 'false';
    const VERIFY_PAYMENT_BEFORE_BOOKING =
        String(process.env.VERIFY_PAYMENT_BEFORE_BOOKING || 'true').toLowerCase() !== 'false';
    const REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING =
        String(process.env.REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING || 'true').toLowerCase() !== 'false';
    const PAID_PAYMENT_STATUSES = new Set(['confirmed', 'paid', 'in_holding']);
    const CONFIRM_PAYMENT_SYNC_HOLDING =
        String(process.env.CONFIRM_PAYMENT_SYNC_HOLDING || 'false').toLowerCase() === 'true';
    const SEARCH_STATES = new Set(['PENDING', 'SEARCHING', 'NOTIFIED', 'AWAITING_RESPONSE', 'EXPANDED', 'REJECTED']);
    const BLOCKING_STATES = new Set(['MATCHED', 'ACCEPTED', 'IN_PROGRESS']);
    const FINAL_STATES = new Set(['COMPLETED', 'CANCELED']);

    const buildCreateBookingIdempotencyFingerprint = ({
        pickupLocation,
        destinationLocation,
        carType,
        paymentMethod,
        estimatedFare,
        paymentStatus,
        dedupeWindowBucket
    }) => {
        const pickupLat = Number(pickupLocation?.lat || 0).toFixed(6);
        const pickupLng = Number(pickupLocation?.lng || 0).toFixed(6);
        const destinationLat = Number(destinationLocation?.lat || 0).toFixed(6);
        const destinationLng = Number(destinationLocation?.lng || 0).toFixed(6);
        const normalizedFare = Number(estimatedFare || 0).toFixed(2);
        const normalizedCarType = String(carType || 'leaf_plus').toLowerCase();
        const normalizedPaymentMethod = String(paymentMethod || 'pix').toLowerCase();
        const normalizedPaymentStatus = String(paymentStatus || 'pending_payment').toLowerCase();
        const normalizedWindowBucket = Number(dedupeWindowBucket || 0);
        return [
            pickupLat,
            pickupLng,
            destinationLat,
            destinationLng,
            normalizedCarType,
            normalizedPaymentMethod,
            normalizedFare,
            normalizedPaymentStatus,
            normalizedWindowBucket
        ].join('|');
    };

    const cleanupSupersededBookingSearch = async ({
        previousBookingId,
        customerId,
        replacementBookingId,
        redis
    }) => {
        if (!previousBookingId || previousBookingId === replacementBookingId) {
            return;
        }

        try {
            const GradualRadiusExpander = require('./services/gradual-radius-expander');
            const RideStateManager = require('./services/ride-state-manager');
            const expander = new GradualRadiusExpander(io);

            const previousState = await RideStateManager.getBookingState(redis, previousBookingId);
            if (previousState &&
                previousState !== RideStateManager.STATES.CANCELED &&
                previousState !== RideStateManager.STATES.COMPLETED) {
                try {
                    await RideStateManager.updateBookingState(
                        redis,
                        previousBookingId,
                        RideStateManager.STATES.CANCELED,
                        {
                            canceledBy: customerId || 'system',
                            reason: 'SUPERSEDED_BY_NEW_REQUEST',
                            supersededByBookingId: replacementBookingId || '',
                            cancelledAt: new Date().toISOString()
                        }
                    );
                } catch (stateError) {
                    logStructured('warn', 'Falha ao finalizar estado do booking supersedido', {
                        customerId,
                        previousBookingId,
                        replacementBookingId: replacementBookingId || null,
                        eventType: 'createBooking',
                        error: stateError.message
                    });
                }
            }

            await expander.stopSearch(previousBookingId);
            await rideQueueManager.dequeueRide(previousBookingId);

            await redis.hset(`booking:${previousBookingId}`, {
                status: 'SUPERSEDED',
                supersededAt: new Date().toISOString(),
                supersededByBookingId: replacementBookingId || '',
                supersededByCustomerId: customerId || ''
            });

            logStructured('info', 'Busca de booking anterior encerrada por supersedência', {
                customerId,
                previousBookingId,
                replacementBookingId,
                eventType: 'createBooking'
            });
        } catch (supersedeError) {
            logStructured('warn', 'Falha ao encerrar booking anterior supersedido', {
                customerId,
                previousBookingId,
                replacementBookingId,
                eventType: 'createBooking',
                error: supersedeError.message
            });
        }
    };

    const releaseSupersededBookingDriverLocks = async (bookingId, redis) => {
        if (!bookingId) return;
        try {
            const driverLockManager = require('./services/driver-lock-manager');
            const notifiedDrivers = await redis.smembers(`ride_notifications:${bookingId}`);

            const syncLimit = Math.max(
                1,
                Number.parseInt(process.env.SUPERSEDED_LOCK_RELEASE_SYNC_LIMIT || '6', 10)
            );
            const syncDrivers = notifiedDrivers.slice(0, syncLimit);
            const asyncDrivers = notifiedDrivers.slice(syncLimit);

            const releaseForDriver = async (driverId) => {
                try {
                    const lockStatus = await driverLockManager.isDriverLocked(driverId);
                    if (lockStatus.isLocked && lockStatus.bookingId === bookingId) {
                        await driverLockManager.releaseLock(driverId);
                    }
                } catch (lockError) {
                    logStructured('warn', 'Falha ao liberar lock de driver de booking supersedido', {
                        bookingId,
                        driverId,
                        eventType: 'createBooking',
                        error: lockError.message
                    });
                }

                try {
                    const activeNotificationKey = `driver_active_notification:${driverId}`;
                    const activeBookingId = await redis.get(activeNotificationKey);
                    if (activeBookingId === bookingId) {
                        await redis.del(activeNotificationKey);
                    }
                } catch (notificationError) {
                    logStructured('warn', 'Falha ao limpar notificação ativa de booking supersedido', {
                        bookingId,
                        driverId,
                        eventType: 'createBooking',
                        error: notificationError.message
                    });
                }
            };

            for (const driverId of syncDrivers) {
                await releaseForDriver(driverId);
            }

            if (asyncDrivers.length > 0) {
                setImmediate(async () => {
                    for (const driverId of asyncDrivers) {
                        await releaseForDriver(driverId);
                    }
                });
            }
        } catch (error) {
            logStructured('warn', 'Falha ao liberar locks/notificações de booking supersedido', {
                bookingId,
                eventType: 'createBooking',
                error: error.message
            });
        }
    };

    const markBookingSupersededFast = async ({
        bookingId,
        customerId,
        replacementBookingId,
        redis
    }) => {
        if (!bookingId) return;

        await redis.hset(`booking:${bookingId}`, {
            status: 'SUPERSEDED',
            state: 'CANCELED',
            supersededAt: new Date().toISOString(),
            supersededByBookingId: replacementBookingId || '',
            supersededByCustomerId: customerId || '',
            updatedAt: new Date().toISOString()
        });
    };

    socket.on('checkRideAvailability', async (data = {}) => {
        const userId = socket.userId || data.customerId || socket.id;

        try {
            const pickupLocation = data?.pickupLocation || {
                lat: data?.lat,
                lng: data?.lng
            };
            const requestedCarType = data?.carType || data?.vehicle || null;
            const requestedRadiusKm = Number.parseFloat(
                data?.radiusKm || process.env.PAYMENT_AVAILABILITY_RADIUS_KM || '5'
            );

            const availability = await hasEligibleDriversForPickupFast(pickupLocation, {
                carType: requestedCarType,
                radiusKm: requestedRadiusKm
            });

            if (!availability?.success) {
                socket.emit('rideAvailabilityError', {
                    success: false,
                    code: 'AVAILABILITY_CHECK_FAILED',
                    error: 'Não foi possível validar disponibilidade agora.',
                    message: 'Não foi possível validar disponibilidade agora.'
                });
                return;
            }

            socket.emit('rideAvailabilityResult', {
                success: true,
                available: Boolean(availability.hasDrivers),
                hasDrivers: Boolean(availability.hasDrivers),
                code: availability.hasDrivers ? 'DRIVERS_AVAILABLE' : 'NO_DRIVERS_AVAILABLE',
                message: availability.hasDrivers
                    ? 'Há motoristas disponíveis para esta corrida.'
                    : 'Não há motoristas disponíveis',
                carType: requestedCarType,
                radiusKm: availability.radiusKm || requestedRadiusKm
            });

            logStructured('info', 'Pré-check de disponibilidade concluído', {
                userId,
                eventType: 'checkRideAvailability',
                requestedCarType,
                hasDrivers: Boolean(availability.hasDrivers),
                radiusKm: availability.radiusKm || requestedRadiusKm
            });
        } catch (availabilityError) {
            logStructured('warn', 'Erro no pré-check de disponibilidade', {
                userId,
                eventType: 'checkRideAvailability',
                error: availabilityError.message
            });

            socket.emit('rideAvailabilityError', {
                success: false,
                code: 'AVAILABILITY_CHECK_ERROR',
                error: 'Não foi possível validar disponibilidade agora.',
                message: 'Não foi possível validar disponibilidade agora.'
            });
        }
    });

    // Solicitar corrida (NOVO FLUXO COM FILAS E EXPANSÃO GRADUAL)
    socket.on('createBooking', async (data) => {
        const bookingHandlerStartedAt = Date.now();
        recordRealtimeMetricSafe('create_booking', 'attempt');

        const emitBookingError = (payload = {}, metricCode) => {
            const normalizedCode = String(metricCode || payload?.code || payload?.error || 'unknown')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_]+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_+|_+$/g, '');
            const metricLabel = normalizedCode ? `error_${normalizedCode}` : 'error_unknown';
            recordRealtimeMetricSafe('create_booking', metricLabel);
            socket.emit('bookingError', payload);
        };

        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);

        // ✅ CORRELATION ID: Usar bookingId se disponível, senão gerar
        // correlationId é de negócio (estável por fluxo de corrida)
        const correlationId = data.bookingId || `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // ✅ FASE 1.3: Criar span root para socket handler
        const tracer = getTracer();
        const socketSpan = createSocketSpan(tracer, 'createBooking', {
            'user.id': socket.userId || data.customerId || socket.id,
            'user.type': socket.userType || 'customer',
            'correlation.id': correlationId, // ✅ Adicionar correlationId
            'booking.id': data.bookingId || correlationId
        });

        await traceContext.runWithTraceId(traceId, async () => {
            try {
                return await runInSpan(socketSpan, async () => {
                    logStructured('info', 'createBooking iniciado', {
                        userId: socket.userId || data.customerId || socket.id,
                        eventType: 'createBooking'
                    });

                    const startTime = Date.now();

                    // ✅ NOVO: Rate Limiting
                    const userId = socket.userId || data.customerId || socket.id;
                    const metadata = getSocketMetadata(socket);
                    const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'createBooking', {
                        ip: metadata.ip
                    });

                    if (!rateLimitCheck.allowed) {
                        emitBookingError({
                            error: 'Muitas requisições',
                            message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                            code: 'RATE_LIMIT_EXCEEDED',
                            limit: rateLimitCheck.limit,
                            remaining: rateLimitCheck.remaining,
                            resetAt: rateLimitCheck.resetAt
                        }, 'RATE_LIMIT_EXCEEDED');
                        logStructured('warn', 'Rate limit excedido', {
                            userId,
                            eventType: 'createBooking',
                            limit: rateLimitCheck.limit
                        });

                        // Auditoria em background para não bloquear ACK ao app.
                        setImmediate(async () => {
                            try {
                                await auditService.logSecurityAction(userId, 'rateLimitExceeded', 'createBooking', {
                                    limit: rateLimitCheck.limit,
                                    remaining: rateLimitCheck.remaining,
                                    resetAt: rateLimitCheck.resetAt
                                }, metadata);
                            } catch (auditError) {
                                logStructured('warn', 'Falha ao registrar auditoria de rateLimitExceeded (background)', {
                                    userId,
                                    eventType: 'createBooking',
                                    error: auditError.message
                                });
                            }
                        });
                        return;
                    }

                    logStructured('info', 'Solicitação de corrida recebida', {
                        socketId: socket.id,
                        userId,
                        eventType: 'createBooking'
                    });

                    // ✅ Segurança: forçar customerId autenticado no payload antes da validação
                    const authCustomerId = socket.userId || null;
                    const validationPayload = authCustomerId
                        ? { ...data, customerId: authCustomerId }
                        : data;

                    // ✅ NOVO: Validação e sanitização de dados
                    const validation = validationService.validateEndpoint('createBooking', validationPayload);

                    if (!validation.valid) {
                        logStructured('warn', 'Validação falhou', {
                            userId,
                            eventType: 'createBooking',
                            validationErrors: validation.errors
                        });

                        emitBookingError({
                            error: 'Dados inválidos',
                            message: 'Os dados fornecidos não são válidos',
                            details: validation.errors,
                            code: 'VALIDATION_ERROR'
                        }, 'VALIDATION_ERROR');

                        // Auditoria em background para não bloquear ACK ao app.
                        setImmediate(async () => {
                            try {
                                await auditService.logRideAction(userId, 'createBooking', null, {
                                    error: 'Validação falhou',
                                    validationErrors: validation.errors
                                }, false, 'Dados de entrada inválidos', metadata);
                            } catch (auditError) {
                                logStructured('warn', 'Falha ao registrar auditoria de validação createBooking (background)', {
                                    userId,
                                    eventType: 'createBooking',
                                    error: auditError.message
                                });
                            }
                        });
                        return;
                    }

                    // Usar dados sanitizados
                    const {
                        customerId: sanitizedCustomerId,
                        pickupLocation,
                        destinationLocation,
                        estimatedFare,
                        routeDistanceKm,
                        routeDurationSecs,
                        tollFee,
                        carType: sanitizedCarType,
                        paymentMethod
                    } = validation.sanitized;
                    const customerId = authCustomerId || sanitizedCustomerId;
                    const customerActiveBookingKey = customerId
                        ? `customer_active_booking:${customerId}`
                        : null;
                    let supersededBookingId = null;

                    if (authCustomerId && sanitizedCustomerId && sanitizedCustomerId !== authCustomerId) {
                        logStructured('warn', 'createBooking com customerId divergente do usuário autenticado', {
                            userId,
                            socketUserId: authCustomerId,
                            payloadCustomerId: sanitizedCustomerId,
                            eventType: 'createBooking'
                        });
                    }

                    if (customerActiveBookingKey) {
                        try {
                            const redis = redisPool.getConnection();
                            const activeBookingId = await redis.get(customerActiveBookingKey);

                            if (activeBookingId) {
                                const RideStateManager = require('./services/ride-state-manager');
                                const activeState = await RideStateManager.getBookingState(redis, activeBookingId);

                                if (BLOCKING_STATES.has(activeState)) {
                                    emitBookingError({
                                        error: 'Você já possui uma corrida ativa',
                                        message: 'Finalize a corrida atual antes de solicitar uma nova.',
                                        code: 'ACTIVE_RIDE_EXISTS',
                                        activeBookingId
                                    }, 'ACTIVE_RIDE_EXISTS');
                                    return;
                                }

                                if (FINAL_STATES.has(activeState)) {
                                    await redis.del(customerActiveBookingKey);
                                } else if (SEARCH_STATES.has(activeState)) {
                                    supersededBookingId = activeBookingId;
                                    await markBookingSupersededFast({
                                        bookingId: activeBookingId,
                                        customerId,
                                        replacementBookingId: null,
                                        redis
                                    });
                                    // Caminho crítico mínimo: restante da supersedência segue em background.
                                    setImmediate(async () => {
                                        try {
                                            await releaseSupersededBookingDriverLocks(activeBookingId, redis);
                                        } catch (releaseError) {
                                            logStructured('warn', 'Falha ao liberar locks de booking supersedido em background', {
                                                customerId,
                                                previousBookingId: activeBookingId,
                                                eventType: 'createBooking',
                                                error: releaseError.message
                                            });
                                        }
                                        try {
                                            await cleanupSupersededBookingSearch({
                                                previousBookingId: activeBookingId,
                                                customerId,
                                                replacementBookingId: null,
                                                redis
                                            });
                                        } catch (supersedeCleanupError) {
                                            logStructured('warn', 'Falha ao limpar booking supersedido em background', {
                                                customerId,
                                                previousBookingId: activeBookingId,
                                                eventType: 'createBooking',
                                                error: supersedeCleanupError.message
                                            });
                                        }
                                    });
                                }
                            }
                        } catch (activeBookingGuardError) {
                            logStructured('warn', 'Falha ao validar/superseder booking ativo do cliente (seguindo fluxo)', {
                                customerId,
                                eventType: 'createBooking',
                                error: activeBookingGuardError.message
                            });
                        }
                    }

                    let normalizedPaymentStatus = (data?.paymentStatus || 'pending_payment').toString().toLowerCase();
                    let hasConfirmedPayment = PAID_PAYMENT_STATUSES.has(normalizedPaymentStatus);
                    const paymentChargeId = String(data?.paymentData?.chargeId || data?.paymentId || '').trim();
                    const paymentReferenceRideId = String(data?.paymentData?.rideId || data?.rideId || '').trim();
                    const parsedPaymentAmountInCents = Number.parseInt(
                        String(data?.paymentData?.amountInCents ?? data?.paymentAmountInCents ?? data?.amountInCents ?? ''),
                        10
                    );
                    let resolvedPaymentAmountInCents =
                        Number.isFinite(parsedPaymentAmountInCents) && parsedPaymentAmountInCents > 0
                            ? parsedPaymentAmountInCents
                            : null;
                    const requestedCarType = sanitizedCarType || data?.carType || null;

                    if (REQUIRE_PAYMENT_BEFORE_BOOKING && !hasConfirmedPayment) {
                        emitBookingError({
                            error: 'Pagamento obrigatório',
                            message: 'Finalize o pagamento PIX antes de solicitar a corrida.',
                            code: 'PAYMENT_REQUIRED'
                        }, 'PAYMENT_REQUIRED');
                        return;
                    }

                    if (
                        REQUIRE_PAYMENT_BEFORE_BOOKING &&
                        REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING &&
                        !paymentChargeId
                    ) {
                        emitBookingError({
                            error: 'Referência de pagamento ausente',
                            message: 'Não foi possível validar o pagamento desta solicitação. Gere um novo PIX e tente novamente.',
                            code: 'PAYMENT_REFERENCE_REQUIRED'
                        }, 'PAYMENT_REFERENCE_REQUIRED');
                        return;
                    }

                    if (hasConfirmedPayment && VERIFY_PAYMENT_BEFORE_BOOKING && paymentChargeId) {
                        try {
                            const paymentStatusCheck = await paymentServiceSingleton.getPaymentStatus(paymentChargeId);
                            if (!paymentStatusCheck?.success) {
                                emitBookingError({
                                    error: 'Pagamento não confirmado',
                                    message: 'Ainda não recebemos a confirmação do PIX. Aguarde alguns segundos e tente novamente.',
                                    code: 'PAYMENT_NOT_CONFIRMED',
                                    retryAfterSec: 2
                                }, 'PAYMENT_NOT_CONFIRMED');
                                return;
                            }

                            const verifiedPaymentStatus = String(paymentStatusCheck.status || '').trim().toLowerCase();
                            if (!PAID_PAYMENT_STATUSES.has(verifiedPaymentStatus)) {
                                emitBookingError({
                                    error: 'Pagamento não confirmado',
                                    message: 'O pagamento desta corrida ainda não foi confirmado.',
                                    code: 'PAYMENT_NOT_CONFIRMED',
                                    paymentStatus: verifiedPaymentStatus,
                                    retryAfterSec: 2
                                }, 'PAYMENT_NOT_CONFIRMED');
                                return;
                            }

                            normalizedPaymentStatus = verifiedPaymentStatus;
                            hasConfirmedPayment = true;

                            const amountFromPaymentStatus = Number(paymentStatusCheck.amount);
                            if (
                                (!Number.isFinite(resolvedPaymentAmountInCents) || resolvedPaymentAmountInCents <= 0) &&
                                Number.isFinite(amountFromPaymentStatus) &&
                                amountFromPaymentStatus > 0
                            ) {
                                resolvedPaymentAmountInCents = Math.round(amountFromPaymentStatus);
                            }
                        } catch (paymentVerificationError) {
                            logStructured('warn', 'Falha ao validar status do pagamento antes do createBooking', {
                                userId,
                                eventType: 'createBooking',
                                paymentChargeId,
                                error: paymentVerificationError.message
                            });

                            emitBookingError({
                                error: 'Erro ao validar pagamento',
                                message: 'Não foi possível validar o pagamento agora. Tente novamente em instantes.',
                                code: 'PAYMENT_VERIFICATION_ERROR',
                                retryAfterSec: 2
                            }, 'PAYMENT_VERIFICATION_ERROR');
                            return;
                        }
                    }

                    // Backpressure no início do fluxo: evita empilhar corrida quando fila regional já está saturada.
                    const queueBackpressureEnabled = process.env.ENABLE_QUEUE_BACKPRESSURE !== 'false';
                    if (queueBackpressureEnabled) {
                        try {
                            const regionHashForGuard = GeoHashUtils.getRegionHash(
                                pickupLocation.lat,
                                pickupLocation.lng
                            );
                            const queueKey = `ride_queue:${regionHashForGuard}:pending`;
                            const redis = redisPool.getConnection();
                            const queuePipeline = redis.pipeline();
                            queuePipeline.zcard(queueKey);
                            queuePipeline.scard('online_drivers');
                            const queuePipelineResult = await queuePipeline.exec();
                            const pendingResult = queuePipelineResult?.[0] || [];
                            const onlineDriversResult = queuePipelineResult?.[1] || [];
                            if (pendingResult[0]) throw pendingResult[0];
                            if (onlineDriversResult[0]) throw onlineDriversResult[0];
                            const pendingRides = Number(pendingResult[1] || 0);
                            const pendingLimit = Number.parseInt(process.env.QUEUE_PENDING_LIMIT_PER_REGION || '5000', 10);
                            const onlineDrivers = Number(onlineDriversResult[1] || 0);
                            const minOnlineDriversBypass = Number.parseInt(process.env.QUEUE_BACKPRESSURE_MIN_ONLINE_DRIVERS_BYPASS || '200', 10);

                            if (pendingRides >= pendingLimit && onlineDrivers < minOnlineDriversBypass) {
                                const retryAfterSec = Number.parseInt(process.env.QUEUE_BACKPRESSURE_RETRY_AFTER_SEC || '3', 10);
                                emitBookingError({
                                    error: 'Sistema temporariamente congestionado',
                                    message: 'Estamos com alta demanda na sua região. Tente novamente em alguns segundos.',
                                    code: 'QUEUE_BACKPRESSURE',
                                    retryAfterSec,
                                    pendingRides,
                                    pendingLimit,
                                    onlineDrivers,
                                    minOnlineDriversBypass,
                                    regionHash: regionHashForGuard
                                }, 'QUEUE_BACKPRESSURE');

                                logStructured('warn', 'createBooking bloqueado por backpressure', {
                                    userId,
                                    regionHash: regionHashForGuard,
                                    pendingRides,
                                    pendingLimit,
                                    onlineDrivers,
                                    minOnlineDriversBypass,
                                    retryAfterSec
                                });
                                return;
                            }
                        } catch (backpressureError) {
                            logStructured('warn', 'Falha na validação de backpressure (seguindo fluxo)', {
                                userId,
                                error: backpressureError.message
                            });
                        }
                    }

                    // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                    const dedupeWindowBucket = Math.floor(Date.now() / 15000);
                    const createBookingFingerprint = buildCreateBookingIdempotencyFingerprint({
                        pickupLocation,
                        destinationLocation,
                        carType: requestedCarType,
                        paymentMethod,
                        estimatedFare,
                        paymentStatus: normalizedPaymentStatus,
                        dedupeWindowBucket
                    });
                    const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                        userId,
                        'createBooking',
                        createBookingFingerprint
                    );

                    const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey);

                    if (!idempotencyCheck.isNew) {
                        // Requisição duplicada - retornar resultado cached ou erro
                        if (idempotencyCheck.cachedResult) {
                            logStructured('info', 'Resultado cached retornado (idempotency)', {
                                userId,
                                eventType: 'createBooking',
                                idempotencyKey,
                                action: 'return_cached'
                            });
                            // ✅ Garantir que traceId esteja no resultado cached
                            const cachedResult = {
                                ...idempotencyCheck.cachedResult,
                                traceId: idempotencyCheck.cachedResult.traceId || traceId || traceContext.getCurrentTraceId() || 'CACHED-TRACE-ID'
                            };
                            // ✅ FORÇAR traceId também em data se não estiver
                            if (cachedResult.data && !cachedResult.data.traceId) {
                                cachedResult.data.traceId = cachedResult.traceId;
                            }
                            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                                logStructured('debug', 'cachedResult antes de emit', {
                                    service: 'websocket',
                                    operation: 'createBooking',
                                    cachedResult
                                });
                            }
                            socket.emit('bookingCreated', cachedResult);
                            if (customerId) {
                                try {
                                    socket.to(`customer_${customerId}`).emit('bookingCreated', cachedResult);
                                } catch (mirrorEmitError) {
                                    logStructured('warn', 'Falha ao espelhar bookingCreated cached para room do cliente', {
                                        customerId,
                                        eventType: 'createBooking',
                                        error: mirrorEmitError.message
                                    });
                                }
                            }
                            return;
                        } else {
                            // Requisição duplicada mas sem resultado cached (ainda processando)
                            logStructured('warn', 'Requisição duplicada detectada', {
                                userId,
                                eventType: 'createBooking',
                                idempotencyKey
                            });
                            emitBookingError({
                                error: 'Requisição duplicada',
                                message: 'Esta requisição já está sendo processada. Aguarde...',
                                code: 'DUPLICATE_REQUEST',
                                retryAfterSec: 1
                            }, 'DUPLICATE_REQUEST');
                            return;
                        }
                    }

                    // ✅ REFATORAÇÃO: Usar RequestRideCommand
                    logStructured('info', 'Executando RequestRideCommand', {
                        customerId,
                        eventType: 'createBooking'
                    });

                    // ✅ NOVO: Validação de Geofence - Verificar se origem e destino estão dentro da região permitida
                    const geofenceService = require('./services/geofence-service');
                    if (geofenceService.isActive()) {
                        const geofenceValidation = geofenceService.validateRideLocations(pickupLocation, destinationLocation);

                        if (!geofenceValidation.valid) {
                            logStructured('warn', 'Geofence validation falhou', {
                                userId,
                                eventType: 'createBooking',
                                geofenceError: geofenceValidation.error
                            });

                            emitBookingError({
                                error: geofenceValidation.error,
                                message: geofenceValidation.error,
                                code: geofenceValidation.code,
                                details: geofenceValidation.details
                            }, geofenceValidation.code || 'GEOFENCE_VALIDATION_ERROR');

                            // Auditoria em background para não bloquear ACK ao app.
                            setImmediate(async () => {
                                try {
                                    await auditService.logRideAction(userId, 'createBooking', null, {
                                        error: 'Geofence validation failed',
                                        geofenceError: geofenceValidation.error,
                                        code: geofenceValidation.code,
                                        details: geofenceValidation.details
                                    }, false, geofenceValidation.error, metadata);
                                } catch (auditError) {
                                    logStructured('warn', 'Falha ao registrar auditoria de geofence createBooking (background)', {
                                        userId,
                                        eventType: 'createBooking',
                                        error: auditError.message
                                    });
                                }
                            });
                            return;
                        }

                        logStructured('info', 'Geofence validado', {
                            userId,
                            eventType: 'createBooking'
                        });
                    }

                    // Guarda de negócio: se a corrida já está paga, validar disponibilidade real antes de criar booking.
                    if (hasConfirmedPayment) {
                        const availability = await hasEligibleDriversForPickupFast(pickupLocation, {
                            carType: requestedCarType
                        });

                        if (!availability.success) {
                            emitBookingError({
                                error: 'Não foi possível validar disponibilidade de motoristas',
                                message: 'Falha temporária ao validar disponibilidade. Tente novamente em instantes.',
                                code: 'AVAILABILITY_CHECK_FAILED'
                            }, 'AVAILABILITY_CHECK_FAILED');
                            return;
                        }

                        if (!availability.hasDrivers) {
                            let refundPayload = null;
                            if (paymentChargeId && Number.isFinite(resolvedPaymentAmountInCents) && resolvedPaymentAmountInCents > 0) {
                                const refundRequestedAt = new Date().toISOString();
                                try {
                                    const refundResult = await paymentServiceSingleton.processRefund(
                                        paymentChargeId,
                                        resolvedPaymentAmountInCents,
                                        'No driver found before booking creation'
                                    );

                                    if (refundResult?.success) {
                                        refundPayload = {
                                            refundStatus: 'REFUNDED',
                                            refundAmount: Number((resolvedPaymentAmountInCents / 100).toFixed(2)),
                                            refundAmountInCents: resolvedPaymentAmountInCents,
                                            cancellationFee: 0,
                                            cancellationFeeInCents: 0,
                                            refundId: refundResult.refundId || null,
                                            chargeId: paymentChargeId,
                                            refundRequestedAt
                                        };

                                        io.to(`customer_${customerId}`).emit('paymentRefunded', {
                                            success: true,
                                            rideId: paymentReferenceRideId || null,
                                            chargeId: paymentChargeId,
                                            refundStatus: 'REFUNDED',
                                            refundAmount: refundPayload.refundAmount,
                                            cancellationFee: 0,
                                            refundId: refundPayload.refundId,
                                            initiatedBy: 'system',
                                            initiatedById: 'createBooking_no_driver',
                                            timestamp: refundRequestedAt
                                        });

                                        setImmediate(async () => {
                                            try {
                                                await auditService.logPaymentAction(
                                                    userId,
                                                    'autoRefundNoDriverBeforeBooking',
                                                    paymentReferenceRideId || null,
                                                    paymentChargeId,
                                                    {
                                                        amountInCents: resolvedPaymentAmountInCents,
                                                        refundId: refundPayload.refundId,
                                                        reason: 'No driver found before booking creation'
                                                    },
                                                    true,
                                                    null,
                                                    metadata
                                                );
                                            } catch (auditError) {
                                                logStructured('warn', 'Falha ao registrar auditoria de auto-refund sem motorista (background)', {
                                                    userId,
                                                    paymentChargeId,
                                                    eventType: 'createBooking',
                                                    error: auditError.message
                                                });
                                            }
                                        });
                                    } else {
                                        refundPayload = {
                                            refundStatus: 'REFUND_PENDING',
                                            refundAmount: Number((resolvedPaymentAmountInCents / 100).toFixed(2)),
                                            refundAmountInCents: resolvedPaymentAmountInCents,
                                            cancellationFee: 0,
                                            cancellationFeeInCents: 0,
                                            chargeId: paymentChargeId,
                                            refundRequestedAt,
                                            refundError: refundResult?.error || refundResult?.details || 'Falha ao processar reembolso'
                                        };

                                        logStructured('warn', 'Reembolso automático não concluído no createBooking sem motorista', {
                                            userId,
                                            customerId,
                                            paymentChargeId,
                                            eventType: 'createBooking',
                                            refundError: refundPayload.refundError
                                        });
                                    }
                                } catch (refundError) {
                                    refundPayload = {
                                        refundStatus: 'REFUND_PENDING',
                                        refundAmount: Number((resolvedPaymentAmountInCents / 100).toFixed(2)),
                                        refundAmountInCents: resolvedPaymentAmountInCents,
                                        cancellationFee: 0,
                                        cancellationFeeInCents: 0,
                                        chargeId: paymentChargeId,
                                        refundRequestedAt,
                                        refundError: refundError.message
                                    };

                                    logStructured('warn', 'Erro ao processar auto-refund no createBooking sem motorista', {
                                        userId,
                                        customerId,
                                        paymentChargeId,
                                        eventType: 'createBooking',
                                        error: refundError.message
                                    });
                                }
                            }

                            emitBookingError({
                                error: 'Não há motoristas disponíveis na sua região no momento',
                                message: refundPayload?.refundStatus === 'REFUNDED'
                                    ? 'Não há parceiros disponíveis no momento. O estorno do seu PIX já foi iniciado automaticamente.'
                                    : 'Não foi possível iniciar a busca de corrida agora porque não há parceiros disponíveis.',
                                code: 'NO_DRIVERS_AVAILABLE',
                                ...(refundPayload || {})
                            }, 'NO_DRIVERS_AVAILABLE');
                            return;
                        }
                    }

                    // ✅ FASE 1.3: Criar span para Command
                    const tracer = getTracer();
                    const { context, trace: otelTrace } = require('@opentelemetry/api');
                    const activeSpan = otelTrace.getActiveSpan();

                    const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
                        'command.customer_id': customerId,
                        'command.pickup_lat': pickupLocation.lat,
                        'command.pickup_lng': pickupLocation.lng,
                        'correlation.id': correlationId // ✅ Passar correlationId
                    });

                    // ✅ MÉTRICAS: Registrar corrida solicitada
                    const { metrics } = require('./utils/prometheus-metrics');
                    const city = data.city || 'unknown';
                    metrics.recordRideRequested(city, 'standard');

                    // Executar command dentro do span
                    const commandStartTime = Date.now();
                    let result;
                    let commandLatency;
                    try {
                        const command = new RequestRideCommand({
                            customerId,
                            pickupLocation,
                            destinationLocation,
                            estimatedFare: estimatedFare || 0,
                            routeDistanceKm: routeDistanceKm || 0,
                            routeDurationSecs: routeDurationSecs || 0,
                            tollFee: tollFee || 0,
                            carType: requestedCarType,
                            paymentMethod: paymentMethod || 'pix',
                            traceId, // ✅ Passar traceId para o command
                            correlationId // ✅ Passar correlationId para o command
                        });

                        result = await runInSpan(commandSpan, async () => {
                            return await command.execute();
                        });

                        // ✅ MÉTRICAS: Registrar latência do command
                        commandLatency = (Date.now() - commandStartTime) / 1000;
                    } catch (error) {
                        endSpanError(commandSpan, error);
                        commandLatency = (Date.now() - commandStartTime) / 1000;
                        throw error;
                    }

                    // ✅ Log de command
                    logCommand('RequestRideCommand', result.success, commandLatency, {
                        customerId,
                        bookingId: result.data?.bookingId
                    });

                    if (!result.success) {
                        logStructured('error', 'RequestRideCommand falhou', {
                            userId,
                            eventType: 'createBooking',
                            error: result.error
                        });

                        emitBookingError({
                            error: result.error,
                            message: result.error,
                            code: 'COMMAND_ERROR'
                        }, 'COMMAND_ERROR');

                        // Auditoria em background para não bloquear ACK ao app.
                        setImmediate(async () => {
                            try {
                                await auditService.logRideAction(userId, 'createBooking', null, {
                                    error: result.error
                                }, false, result.error, metadata);
                            } catch (auditError) {
                                logStructured('warn', 'Falha ao registrar auditoria de commandError createBooking (background)', {
                                    userId,
                                    eventType: 'createBooking',
                                    error: auditError.message
                                });
                            }
                        });
                        return;
                    }

                    // Command executado com sucesso
                    const { bookingId, bookingData: commandBookingData, event, regionHash } = result.data;

                    // Persistir metadados de pagamento antes do dispatch.
                    // Isso evita janelas onde consumidores veem a corrida como "unpaid".
                    try {
                        const paymentDispatchService = require('./services/payment-dispatch-service');
                        const paymentAmountInCents = Number.isFinite(resolvedPaymentAmountInCents)
                            ? String(Math.round(resolvedPaymentAmountInCents))
                            : '';
                        const temporaryRideId = paymentReferenceRideId;

                        if (hasConfirmedPayment) {
                            await paymentDispatchService.markBookingPaymentConfirmed({
                                bookingId,
                                chargeId: paymentChargeId,
                                temporaryRideId,
                                amountInCents: paymentAmountInCents,
                                paymentStatus: 'in_holding',
                                source: 'createBooking'
                            });
                        } else {
                            await paymentDispatchService.linkPaymentToBooking({
                                bookingId,
                                chargeId: paymentChargeId,
                                temporaryRideId
                            });
                        }
                    } catch (bookingMetaError) {
                        logStructured('warn', 'Falha ao persistir metadados de pagamento antes do dispatch', {
                            bookingId,
                            error: bookingMetaError.message,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ REFATORAÇÃO: Publicar evento no EventBus sem travar ACK (quando habilitado).
                    if (event) {
                        if (!event.data) {
                            event.data = {};
                        }
                        if (!event.data.metadata) {
                            event.data.metadata = {};
                        }
                        if (hasConfirmedPayment && SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS) {
                            event.data.skipDriverNotify = true;
                            event.data.metadata.skipDriverNotify = true;
                            event.data.metadata.dispatchStrategy = 'payment_dispatch_only';
                        }

                        const publishRideRequestedEvent = async () => {
                            const { trace: otelTrace } = require('@opentelemetry/api');
                            const activeSpan = otelTrace.getActiveSpan();
                            const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
                                'event.booking_id': bookingId,
                                'correlation.id': correlationId
                            });

                            const eventStartTime = Date.now();
                            try {
                                await runInSpan(eventSpan, async () => {
                                    await eventBus.publish({
                                        eventType: 'ride.requested',
                                        data: event
                                    });
                                });

                                const eventSpanContext = eventSpan.spanContext();
                                if (event.data) {
                                    event.data._otelSpanContext = eventSpanContext;
                                    if (!event.data.metadata) {
                                        event.data.metadata = {};
                                    }
                                    event.data.metadata.correlationId = correlationId;
                                    event.data.metadata.traceId = eventSpanContext.traceId;
                                    event.data.metadata.spanId = eventSpanContext.spanId;
                                }

                                endSpanSuccess(eventSpan, {
                                    'event.latency_ms': Date.now() - eventStartTime
                                });
                            } catch (error) {
                                endSpanError(eventSpan, error);
                                throw error;
                            }

                            const eventLatency = Date.now() - eventStartTime;
                            logEvent('ride.requested', 'published', {
                                bookingId,
                                latency_ms: eventLatency
                            });
                        };

                        if (CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH) {
                            setImmediate(async () => {
                                try {
                                    await publishRideRequestedEvent();
                                } catch (publishError) {
                                    logStructured('warn', 'createBooking: falha ao publicar ride.requested em background', {
                                        bookingId,
                                        eventType: 'createBooking',
                                        error: publishError.message
                                    });
                                }
                            });
                        } else {
                            await publishRideRequestedEvent();
                        }
                    }

                    // Dispatch crítico deve ocorrer no gateway para evitar jitter de rede/consumer no caminho de matching.
                    if (
                        event
                        && ENABLE_DIRECT_RIDE_REQUESTED_DISPATCH
                        && RUNTIME_ROLE === 'gateway'
                        && !ENABLE_EMBEDDED_LISTENER_WORKERS
                    ) {
                        setImmediate(async () => {
                            try {
                                await notifyDriversInline(
                                    {
                                        eventType: 'ride.requested',
                                        data: event
                                    },
                                    io
                                );
                            } catch (dispatchError) {
                                logStructured('warn', 'createBooking: falha no dispatch inline de ride.requested', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    error: dispatchError.message
                                });
                            }
                        });
                    }

                    // Armazenar também em activeBookings (compatibilidade)
                    io.activeBookings.set(bookingId, {
                        bookingId,
                        customerId,
                        pickupLocation,
                        destinationLocation,
                        estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                        paymentMethod,
                        status: 'requested'
                    });

                    // FASE 10 / Auditoria em background para não atrasar ACK ao app.
                    setImmediate(async () => {
                        try {
                            await metricsCollector.recordMatchStart(bookingId, Date.now());
                        } catch (metricsError) {
                            logStructured('warn', 'Falha ao registrar match start (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: metricsError.message
                            });
                        }

                        try {
                            await auditService.logRideAction(userId, 'createBooking', bookingId, {
                                pickupLocation,
                                destinationLocation,
                                estimatedFare,
                                paymentMethod,
                                regionHash
                            }, true, null, metadata);
                        } catch (auditError) {
                            logStructured('warn', 'Falha ao registrar auditoria createBooking (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: auditError.message
                            });
                        }
                    });

                    // Verificar demanda e notificar motoristas offline (em background)
                    setImmediate(async () => {
                        try {
                            const redis = redisPool.getConnection();
                            await redisPool.ensureConnection();

                            const queueKey = `ride_queue:${regionHash}:pending`;
                            const pendingRides = await redis.zcard(queueKey);

                            // Notificar motoristas offline se houver demanda
                            if (pendingRides >= 3) {
                                const demandNotificationService = require('./services/demand-notification-service');
                                await demandNotificationService.checkAndNotifyDemand(
                                    pickupLocation,
                                    pendingRides
                                );
                            }
                        } catch (error) {
                            logStructured('error', 'Erro ao verificar demanda', {
                                error: error.message,
                                eventType: 'createBooking'
                            });
                        }
                    });

                    // Persistência em Firestore em background (best-effort).
                    setImmediate(async () => {
                        try {
                            const ridePersistenceService = require('./services/ride-persistence-service');
                            await ridePersistenceService.saveRide({
                                rideId: bookingId,
                                bookingId: bookingId,
                                passengerId: customerId,
                                pickupLocation: pickupLocation,
                                destinationLocation: destinationLocation,
                                estimatedFare: estimatedFare || 0,
                                paymentMethod: paymentMethod || 'pix',
                                paymentStatus: normalizedPaymentStatus,
                                status: 'pending',
                                carType: data.carType || null
                            });
                        } catch (persistError) {
                            logStructured('error', 'Erro ao salvar corrida no Firestore (background)', {
                                bookingId,
                                error: persistError.message,
                                eventType: 'createBooking'
                            });
                        }
                    });

                    // Persistir metadados adicionais de pagamento/disponibilidade no booking para validações posteriores.
                    try {
                        const redis = redisPool.getConnection();
                        const bookingMetaPipeline = redis.pipeline();
                        bookingMetaPipeline.hset(`booking:${bookingId}`, {
                            paymentStatus: normalizedPaymentStatus,
                            carType: requestedCarType || '',
                            paymentChargeId: paymentChargeId,
                            paymentAmountInCents: Number.isFinite(resolvedPaymentAmountInCents)
                                ? String(Math.round(resolvedPaymentAmountInCents))
                                : '',
                            paymentReferenceRideId: paymentReferenceRideId
                        });

                        if (customerActiveBookingKey) {
                            bookingMetaPipeline.set(
                                customerActiveBookingKey,
                                bookingId,
                                'EX',
                                CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS
                            );
                        }
                        const bookingMetaPipelineResult = await bookingMetaPipeline.exec();
                        const bookingMetaPipelineError = bookingMetaPipelineResult?.find(([commandError]) => commandError)?.[0];
                        if (bookingMetaPipelineError) {
                            throw bookingMetaPipelineError;
                        }

                        if (supersededBookingId) {
                            setImmediate(async () => {
                                try {
                                    await redis.hset(`booking:${supersededBookingId}`, {
                                        supersededByBookingId: bookingId,
                                        supersededAt: new Date().toISOString()
                                    });
                                } catch (supersedeCleanupError) {
                                    logStructured('warn', 'Falha ao atualizar vínculo de supersedência em background', {
                                        customerId,
                                        previousBookingId: supersededBookingId,
                                        replacementBookingId: bookingId,
                                        eventType: 'createBooking',
                                        error: supersedeCleanupError.message
                                    });
                                }
                            });
                        }
                    } catch (bookingMetaError) {
                        logStructured('warn', 'Falha ao persistir metadados no booking', {
                            bookingId,
                            error: bookingMetaError.message,
                            eventType: 'createBooking'
                        });
                    }

                    // Preparar resposta de sucesso
                    // ✅ Garantir que traceId esteja disponível (pode vir do contexto ou do handler)
                    let currentTraceId = traceId || traceContext.getCurrentTraceId() || extractTraceIdFromEvent(data, socket);

                    // ✅ Garantir que traceId nunca seja undefined ou null
                    if (!currentTraceId) {
                        currentTraceId = traceContext.generateTraceId('booking');
                        logStructured('warn', 'traceId não encontrado, gerando novo', {
                            bookingId,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ Criar objeto de resposta com traceId garantido
                    const finalTraceId = currentTraceId || traceContext.getCurrentTraceId() || traceContext.generateTraceId('booking');

                    const bookingResponse = {
                        success: true,
                        bookingId,
                        idempotencyKey,
                        message: 'Corrida solicitada com sucesso',
                        traceId: finalTraceId, // ✅ Incluir traceId no nível raiz
                        data: {
                            bookingId,
                            idempotencyKey,
                            customerId,
                            pickupLocation,
                            destinationLocation,
                            estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                            paymentMethod,
                            status: 'requested',
                            timestamp: new Date().toISOString(),
                            traceId: finalTraceId // ✅ SOLUÇÃO: Incluir também dentro de data (garantido)
                        }
                    };

                    // ✅ Debug: Log para confirmar traceId na resposta
                    logStructured('info', 'bookingResponse criado com traceId', {
                        bookingId,
                        traceId: finalTraceId,
                        eventType: 'createBooking'
                    });

                    // Cachear resultado de idempotência em background para não atrasar ACK.
                    setImmediate(async () => {
                        try {
                            await idempotencyService.cacheResult(idempotencyKey, bookingResponse);
                        } catch (idempotencyCacheError) {
                            logStructured('warn', 'Falha ao cachear resultado de idempotência (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: idempotencyCacheError.message
                            });
                        }
                    });

                    // ✅ GARANTIR que traceId esteja presente antes de emitir (dupla verificação)
                    if (!bookingResponse.traceId) {
                        bookingResponse.traceId = finalTraceId;
                    }
                    if (bookingResponse.data && !bookingResponse.data.traceId) {
                        bookingResponse.data.traceId = finalTraceId;
                    }

                    // ✅ DEBUG: Log imediatamente antes de emitir para verificar conteúdo
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_TRACEID === 'true') {
                        logStructured('debug', 'bookingResponse antes de emitir', {
                            service: 'server',
                            bookingId: bookingResponse.bookingId,
                            traceId: bookingResponse.traceId,
                            traceIdInData: bookingResponse.data?.traceId,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ Criar uma cópia explícita do objeto para garantir que traceId não seja perdido
                    const responseToEmit = {
                        success: bookingResponse.success,
                        bookingId: bookingResponse.bookingId,
                        idempotencyKey: bookingResponse.idempotencyKey,
                        message: bookingResponse.message,
                        traceId: bookingResponse.traceId, // ✅ Forçar inclusão explícita
                        data: {
                            ...bookingResponse.data,
                            traceId: bookingResponse.data?.traceId || bookingResponse.traceId // ✅ Forçar inclusão explícita
                        }
                    };

                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                        logStructured('debug', 'responseToEmit criado', {
                            service: 'websocket',
                            operation: 'createBooking',
                            responseToEmit
                        });
                    }

                    // Emitir confirmação para o cliente
                    socket.emit('bookingCreated', responseToEmit);
                    if (customerId) {
                        try {
                            socket.to(`customer_${customerId}`).emit('bookingCreated', responseToEmit);
                        } catch (mirrorEmitError) {
                            logStructured('warn', 'Falha ao espelhar bookingCreated para room do cliente', {
                                customerId,
                                bookingId,
                                eventType: 'createBooking',
                                error: mirrorEmitError.message
                            });
                        }
                    }

                    // ✅ DEBUG: Log após emitir para confirmar
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                        logStructured('debug', 'bookingCreated emitido', {
                            service: 'websocket',
                            operation: 'createBooking',
                            traceId: responseToEmit.traceId
                        });
                    }

                    // Para corridas já pagas, acionar dispatch imediato e resiliente sem depender de fila/event bus.
                    if (hasConfirmedPayment) {
                        const paymentDispatchService = require('./services/payment-dispatch-service');
                        const paidDispatchMaxAttempts = Number.parseInt(
                            process.env.PAID_BOOKING_DISPATCH_MAX_ATTEMPTS || '120',
                            10
                        );
                        const paidDispatchRetryDelayMs = Number.parseInt(
                            process.env.PAID_BOOKING_DISPATCH_RETRY_DELAY_MS || '1000',
                            10
                        );

                        paymentDispatchService.triggerDispatchAfterPayment({
                            bookingId,
                            io,
                            pickupLocation,
                            source: 'createBooking_paid_immediate',
                            force: true,
                            maxAttempts: paidDispatchMaxAttempts,
                            retryDelayMs: paidDispatchRetryDelayMs
                        }).then((dispatchResult) => {
                            logStructured('info', 'createBooking: dispatch imediato para corrida paga processado', {
                                bookingId,
                                eventType: 'createBooking',
                                success: Boolean(dispatchResult?.success),
                                skipped: Boolean(dispatchResult?.skipped),
                                reason: dispatchResult?.reason || null,
                                attempts: dispatchResult?.attempts || 1
                            });
                        }).catch((dispatchError) => {
                            logStructured('warn', 'createBooking: falha ao acionar dispatch imediato para corrida paga', {
                                bookingId,
                                eventType: 'createBooking',
                                error: dispatchError.message
                            });
                        });
                    }

                    const totalLatency = Date.now() - startTime;
                    recordRealtimeMetricSafe('create_booking', 'success');
                    recordHotpathLatencySafe('create_booking', totalLatency, true);
                    logStructured('info', 'createBooking concluído com sucesso', {
                        userId,
                        bookingId,
                        eventType: 'createBooking',
                        latency_ms: totalLatency
                    });
                });
            } catch (error) {
                endSpanError(socketSpan, error);
                recordRealtimeMetricSafe('create_booking', 'error_exception');
                recordHotpathLatencySafe('create_booking', Date.now() - bookingHandlerStartedAt, false);
                console.error('🔥 ERRO CRÍTICO EM CREATE_BOOKING:', error); // ✅ DEBUG DIRETO
                logStructured('error', 'Erro ao criar corrida', {
                    userId: socket.userId || data?.customerId || socket.id,
                    eventType: 'createBooking',
                    error: error.message,
                    stack: error.stack
                });

                // ✅ NOVO: Log de auditoria para erro na criação de corrida
                const userId = socket.userId || data?.customerId || socket.id;
                const metadata = getSocketMetadata(socket);
                emitBookingError({
                    error: 'Erro interno do servidor',
                    message: 'Não foi possível concluir sua solicitação agora. Tente novamente em instantes.',
                    code: 'INTERNAL_SERVER_ERROR'
                }, 'INTERNAL_SERVER_ERROR');

                setImmediate(async () => {
                    try {
                        await auditService.logRideAction(userId, 'createBooking', null, {
                            error: error.message,
                            stack: error.stack
                        }, false, error.message, metadata);
                    } catch (auditError) {
                        logStructured('warn', 'Falha ao registrar auditoria de erro crítico createBooking (background)', {
                            userId,
                            eventType: 'createBooking',
                            error: auditError.message
                        });
                    }
                });
            }
        });
    });
    // =========================================================================================

    // Confirmar pagamento
    socket.on('confirmPayment', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                logStructured('info', 'confirmPayment iniciado', {
                    userId: socket.userId || data.customerId || socket.id,
                    eventType: 'confirmPayment'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting
                const userId = socket.userId || data.customerId || socket.id;
                const metadata = getSocketMetadata(socket);
                const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'confirmPayment', {
                    ip: metadata.ip
                });

                if (!rateLimitCheck.allowed) {
                    // ✅ NOVO: Log de auditoria para rate limit excedido
                    await auditService.logSecurityAction(userId, 'rateLimitExceeded', 'confirmPayment', {
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    }, metadata);

                    socket.emit('paymentError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        userId,
                        eventType: 'confirmPayment',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Confirmação de pagamento recebida', {
                    userId,
                    bookingId: data.bookingId,
                    eventType: 'confirmPayment'
                });

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('confirmPayment', data);

                if (!validation.valid) {
                    await auditService.logPaymentAction(userId, 'confirmPayment', data.bookingId || null, null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('paymentError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { bookingId, paymentMethod, paymentId, amount } = validation.sanitized;
                const paymentMockEnabled =
                    data?.mockPayment === true ||
                    data?.__mockPayment === true ||
                    String(process.env.MOCK_PAYMENT_FOR_TESTS || '').toLowerCase() === 'true';
                const skipAvailabilityCheck =
                    String(process.env.CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK || 'true').toLowerCase() === 'true';

                // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                    userId,
                    'confirmPayment',
                    `${bookingId}_${paymentId || paymentMethod || amount || 'unknown'}`
                );

                const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey);

                if (!idempotencyCheck.isNew) {
                    // Requisição duplicada - retornar resultado cached ou erro
                    if (idempotencyCheck.cachedResult) {
                        logStructured('info', 'Resultado cached retornado', {
                            userId,
                            eventType: 'confirmPayment',
                            idempotencyKey
                        });
                        socket.emit('paymentConfirmed', idempotencyCheck.cachedResult);
                        return;
                    } else {
                        // Requisição duplicada mas sem resultado cached (ainda processando)
                        logStructured('warn', 'Requisição duplicada detectada', {
                            userId,
                            eventType: 'confirmPayment',
                            idempotencyKey
                        });
                        socket.emit('paymentError', {
                            error: 'Requisição duplicada',
                            message: 'Este pagamento já está sendo processado. Aguarde...',
                            code: 'DUPLICATE_REQUEST',
                            retryAfterSec: 1
                        });
                        return;
                    }
                }

                // Guarda de negócio:
                // A elegibilidade já é garantida no pool ativo de dispatch; aqui só validamos em modo best-effort.
                let bookingPickupLocation = null;
                let bookingCarType = null;
                const payloadPickupLocation = parseBookingLocation(data?.pickupLocation);
                const shouldLoadBookingContext = !payloadPickupLocation || !skipAvailabilityCheck;
                try {
                    if (shouldLoadBookingContext) {
                        const redis = redisPool.getConnection();
                        const [bookingPickupRaw, bookingCarTypeRaw] = await redis.hmget(
                            `booking:${bookingId}`,
                            'pickupLocation',
                            'carType'
                        );
                        bookingPickupLocation = parseBookingLocation(bookingPickupRaw);
                        bookingCarType = bookingCarTypeRaw || null;
                    }
                } catch (bookingLookupError) {
                    logStructured('warn', 'confirmPayment: erro ao buscar booking para validação de disponibilidade', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: bookingLookupError.message
                    });
                }

                const pickupLocationToValidate = payloadPickupLocation || bookingPickupLocation;

                if (!paymentMockEnabled && !skipAvailabilityCheck && pickupLocationToValidate?.lat && pickupLocationToValidate?.lng) {
                    try {
                        const availabilityTimeoutMs = Number.parseInt(
                            process.env.CONFIRM_PAYMENT_AVAILABILITY_TIMEOUT_MS || '800',
                            10
                        );
                        const availability = await Promise.race([
                            findAvailableDriversForPickup(pickupLocationToValidate, { carType: bookingCarType }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('availability_check_timeout')), availabilityTimeoutMs))
                        ]);

                        if (!availability?.success) {
                            logStructured('warn', 'confirmPayment: pre-check de disponibilidade indisponível (seguindo fluxo)', {
                                bookingId,
                                eventType: 'confirmPayment',
                                code: 'AVAILABILITY_CHECK_FAILED'
                            });
                        } else if ((availability.drivers || []).length === 0) {
                            logStructured('warn', 'confirmPayment: sem motoristas no pre-check (seguindo fluxo)', {
                                bookingId,
                                eventType: 'confirmPayment',
                                code: 'NO_DRIVERS_AVAILABLE'
                            });
                        }
                    } catch (availabilityError) {
                        logStructured('warn', 'confirmPayment: erro no pre-check de disponibilidade (seguindo fluxo)', {
                            bookingId,
                            eventType: 'confirmPayment',
                            error: availabilityError.message
                        });
                    }
                }

                const amountInCents = typeof amount === 'number' && amount < 1000
                    ? Math.round(amount * 100)
                    : Math.round(amount || 0);
                const paymentHoldingTimeoutMs = Number.parseInt(
                    process.env.PAYMENT_HOLDING_TIMEOUT_MS || '2500',
                    10
                );
                const persistPaymentHolding = async () => {
                    try {
                        await Promise.race([
                            paymentServiceSingleton.savePaymentHolding(bookingId, {
                                status: 'in_holding',
                                amount: amountInCents,
                                paymentMethod: paymentMethod,
                                paymentId: paymentId || `payment_${Date.now()}`,
                                paidAt: new Date().toISOString(),
                                confirmedAt: new Date().toISOString()
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('payment_holding_timeout')), paymentHoldingTimeoutMs))
                        ]);

                        logStructured('info', 'Payment holding salvo', {
                            bookingId,
                            eventType: 'confirmPayment'
                        });
                    } catch (holdingError) {
                        logStructured('error', 'Erro ao salvar payment holding', {
                            bookingId,
                            eventType: 'confirmPayment',
                            error: holdingError.message
                        });
                        // Não bloquear confirmação se holding falhar
                    }
                };

                if (CONFIRM_PAYMENT_SYNC_HOLDING) {
                    await persistPaymentHolding();
                } else {
                    setImmediate(() => {
                        persistPaymentHolding().catch(() => { });
                    });
                }

                // Simular processamento do pagamento
                const paymentData = {
                    bookingId,
                    paymentMethod,
                    paymentId,
                    amount,
                    status: 'confirmed',
                    timestamp: new Date().toISOString()
                };

                try {
                    await paymentDispatchService.markBookingPaymentConfirmed({
                        bookingId,
                        chargeId: paymentId || data?.chargeId || '',
                        temporaryRideId: data?.rideId || data?.temporaryRideId || '',
                        amountInCents,
                        paymentStatus: 'in_holding',
                        source: 'socket_confirmPayment'
                    });
                } catch (markPaymentError) {
                    logStructured('warn', 'confirmPayment: falha ao marcar booking como pago', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: markPaymentError.message
                    });
                }

                // Emitir confirmação
                socket.emit('paymentConfirmed', {
                    success: true,
                    bookingId,
                    message: 'Pagamento confirmado com sucesso',
                    data: paymentData
                });

                // Auditoria em background para não bloquear ACK de pagamento.
                setImmediate(async () => {
                    try {
                        const chargeId = paymentId || `payment_${Date.now()}`;
                        await auditService.logPaymentAction(userId, 'confirmPayment', bookingId, chargeId, {
                            paymentMethod,
                            amount,
                            amountInCents
                        }, true, null, metadata);
                    } catch (auditError) {
                        logStructured('warn', 'confirmPayment: falha ao gravar auditoria em background', {
                            bookingId,
                            eventType: 'confirmPayment',
                            error: auditError.message
                        });
                    }
                });

                // Disparar busca de motorista sem esperar o próximo tick para reduzir janela de corrida.
                paymentDispatchService.triggerDispatchAfterPayment({
                    bookingId,
                    io,
                    pickupLocation: pickupLocationToValidate,
                    source: 'socket_confirmPayment',
                    force: true
                }).then((dispatchResult) => {
                    logStructured('info', 'confirmPayment: dispatch pós-pagamento processado', {
                        bookingId,
                        eventType: 'confirmPayment',
                        success: Boolean(dispatchResult?.success),
                        skipped: Boolean(dispatchResult?.skipped),
                        reason: dispatchResult?.reason || null,
                        attempts: dispatchResult?.attempts || 1
                    });
                }).catch((dispatchError) => {
                    logStructured('warn', 'confirmPayment: falha ao acionar dispatch pós-pagamento', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: dispatchError.message
                    });
                });

                const totalLatency = Date.now() - startTime;
                logStructured('info', 'confirmPayment concluído com sucesso', {
                    userId,
                    bookingId,
                    eventType: 'confirmPayment',
                    amount,
                    latency_ms: totalLatency
                });

                // ======================== TESTE AUTOMÁTICO ========================
                // Simular fluxo completo automaticamente após pagamento confirmado
                if (process.env.AUTO_TEST_MODE === 'true') {
                    logStructured('info', 'TESTE AUTOMÁTICO: Simulando fluxo completo', {
                        service: 'server',
                        bookingId,
                        mode: 'auto_test'
                    });

                    // Aguardar 1 segundo e simular motorista aceitando
                    setTimeout(() => {
                        logStructured('info', 'Simulando motorista aceitando corrida', {
                            service: 'server',
                            bookingId,
                            mode: 'auto_test'
                        });

                        // Emitir evento de corrida aceita para o cliente
                        socket.emit('rideAccepted', {
                            success: true,
                            bookingId,
                            message: 'Motorista aceitou sua corrida',
                            driverId: 'simulated_driver',
                            timestamp: new Date().toISOString()
                        });

                        // Aguardar 2 segundos e simular início da viagem
                        setTimeout(() => {
                            logStructured('info', 'Simulando início da viagem', {
                                service: 'server',
                                bookingId,
                                mode: 'auto_test'
                            });

                            socket.emit('tripStarted', {
                                success: true,
                                bookingId,
                                message: 'Viagem iniciada',
                                startLocation: { lat: -23.5505, lng: -46.6333 },
                                timestamp: new Date().toISOString()
                            });

                            // Aguardar 3 segundos e simular finalização
                            setTimeout(() => {
                                logStructured('info', 'Simulando finalização da viagem', {
                                    service: 'server',
                                    bookingId,
                                    mode: 'auto_test'
                                });

                                socket.emit('tripCompleted', {
                                    success: true,
                                    bookingId,
                                    message: 'Viagem finalizada',
                                    endLocation: { lat: -23.5615, lng: -46.6553 },
                                    distance: 5.2,
                                    fare: amount,
                                    timestamp: new Date().toISOString()
                                });

                                if (process.env.AUTO_TEST_MODE === 'true') {
                                    logStructured('info', 'TESTE AUTOMÁTICO COMPLETO', {
                                        service: 'server',
                                        bookingId,
                                        mode: 'auto_test'
                                    });
                                }

                            }, 3000);

                        }, 2000);

                    }, 1000);
                }

            } catch (error) {
                logStructured('error', 'Erro ao confirmar pagamento', {
                    userId: socket.userId || data?.customerId || socket.id,
                    eventType: 'confirmPayment',
                    error: error.message,
                    stack: error.stack
                });
                socket.emit('paymentError', { error: 'Erro ao processar pagamento' });
            }
        });
    });

    // Resposta do motorista
    socket.on('driverResponse', async (data) => {
        try {
            logStructured('info', 'Resposta do motorista recebida', {
                service: 'websocket',
                userId: socket.userId || socket.id,
                bookingId: data?.bookingId,
                accepted: data?.accepted,
                eventType: 'driverResponse'
            });

            const { bookingId, accepted, reason } = data;

            if (!bookingId || accepted === undefined) {
                socket.emit('driverResponseError', { error: 'Dados incompletos para resposta do motorista' });
                return;
            }

            if (accepted) {
                // Motorista aceitou
                socket.emit('rideAccepted', {
                    success: true,
                    bookingId,
                    message: 'Corrida aceita com sucesso',
                    driverId: socket.id
                });

                // Notificar somente o passageiro dono da corrida (evita fan-out global).
                const redis = redisPool.getConnection();
                const { customerId } = await resolveBookingParties(redis, bookingId);
                if (customerId) {
                    io.to(`customer_${customerId}`).emit('rideAccepted', {
                        success: true,
                        bookingId,
                        message: 'Motorista aceitou sua corrida',
                        driverId: socket.id
                    });
                } else {
                    logStructured('warn', 'rideAccepted sem customerId resolvido (fan-out bloqueado)', {
                        service: 'websocket',
                        bookingId,
                        socketId: socket.id
                    });
                }

                logStructured('info', 'Motorista aceitou corrida', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: socket.userId,
                    bookingId
                });
            } else {
                // Motorista recusou
                socket.emit('rideRejected', {
                    success: true,
                    bookingId,
                    message: 'Corrida recusada',
                    reason: reason || 'Motorista não disponível'
                });

                logStructured('info', 'Motorista recusou corrida', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: socket.userId,
                    bookingId,
                    reason: reason || 'Motorista não disponível'
                });
            }

        } catch (error) {
            logStructured('error', 'Erro na resposta do motorista', {
                service: 'websocket',
                socketId: socket.id,
                userId: socket.userId,
                bookingId,
                error: error.message,
                stack: error.stack
            });
            socket.emit('driverResponseError', { error: 'Erro ao processar resposta' });
        }
    });

    // 4. AcceptRide (crítico - aceitar corrida)
    socket.on('acceptRide', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                logStructured('info', 'acceptRide iniciado', {
                    driverId: socket.userId || socket.id,
                    eventType: 'acceptRide'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting
                const driverId = socket.userId || socket.id;
                const correlationId = data?.correlationId || data?.bookingId;
                const metadata = getSocketMetadata(socket);
                const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'acceptRide', {
                    ip: metadata.ip
                });

                if (!rateLimitCheck.allowed) {
                    socket.emit('acceptRideError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'acceptRide bloqueado por rate limiter', {
                        service: 'websocket',
                        driverId,
                        limit: rateLimitCheck.limit,
                        window: '1min'
                    });
                    return;
                }

                if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                    logStructured('debug', 'Aceitar corrida', {
                        service: 'websocket',
                        driverId,
                        data
                    });
                }

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('acceptRide', data);

                if (!validation.valid) {
                    const metadata = getSocketMetadata(socket);
                    await auditService.logRideAction(driverId, 'acceptRide', data.bookingId || data.rideId || null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('acceptRideError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { rideId, bookingId, ...driverData } = validation.sanitized;

                // Usar bookingId ou rideId (compatibilidade)
                const bookingIdToUse = bookingId || rideId;

                if (!bookingIdToUse) {
                    socket.emit('acceptRideError', { error: 'ID da corrida obrigatório' });
                    return;
                }

                if (!driverId) {
                    socket.emit('acceptRideError', { error: 'Motorista não autenticado' });
                    return;
                }

                // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                    driverId,
                    'acceptRide',
                    bookingIdToUse
                );

                const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey);

                if (!idempotencyCheck.isNew) {
                    // Requisição duplicada - retornar resultado cached ou erro
                    if (idempotencyCheck.cachedResult) {
                        logStructured('info', 'Resultado cached retornado para acceptRide (idempotency)', {
                            service: 'server',
                            userId: socket.userId || socket.id,
                            bookingId: data?.bookingId,
                            idempotencyKey,
                            eventType: 'acceptRide',
                            action: 'return_cached'
                        });
                        socket.emit('rideAccepted', idempotencyCheck.cachedResult);
                        return;
                    } else {
                        // Requisição duplicada mas sem resultado cached (ainda processando)
                        socket.emit('acceptRideError', {
                            error: 'Requisição duplicada',
                            message: 'Esta requisição já está sendo processada. Aguarde...',
                            code: 'DUPLICATE_REQUEST',
                            retryAfterSec: 1
                        });
                        logStructured('warn', 'Requisição duplicada detectada (idempotency)', {
                            service: 'websocket',
                            operation: 'acceptRide',
                            driverId,
                            idempotencyKey
                        });
                        return;
                    }
                }

                // ✅ REFATORAÇÃO: Usar AcceptRideCommand
                logStructured('info', 'Executando AcceptRideCommand', {
                    service: 'websocket',
                    operation: 'acceptRide',
                    driverId,
                    bookingId: data.bookingId
                });

                // ✅ FASE 1.3: Criar span para Command
                const { trace: otelTrace } = require('@opentelemetry/api');
                const activeSpan = otelTrace.getActiveSpan();
                const tracer = getTracer();
                const commandSpan = createCommandSpan(tracer, 'accept_ride', activeSpan, {
                    'command.driver_id': driverId,
                    'command.booking_id': bookingIdToUse,
                    'correlation.id': correlationId // ✅ Passar correlationId
                });

                // ✅ MÉTRICAS: Preparar para registrar corrida aceita
                const { metrics } = require('./utils/prometheus-metrics');
                const city = data.city || 'unknown';
                const acceptStartTime = Date.now(); // Para calcular tempo até aceite

                let result;
                try {
                    const command = new AcceptRideCommand({
                        driverId,
                        bookingId: bookingIdToUse,
                        traceId, // ✅ Passar traceId
                        correlationId // ✅ Passar correlationId
                    });

                    result = await runInSpan(commandSpan, async () => {
                        return await command.execute();
                    });

                    // ✅ MÉTRICAS: Registrar latência do command
                    const commandLatency = (Date.now() - acceptStartTime) / 1000;

                    // ✅ MÉTRICAS: Registrar corrida aceita
                    if (result.success) {
                        metrics.recordRideAccepted(city, 'standard');
                        // Calcular tempo até aceite (idealmente comparar com timestamp de criação do booking)
                        // Por enquanto, usar latência do command como proxy
                        metrics.recordTimeToAccept(commandLatency, city);
                    }
                } catch (error) {
                    endSpanError(commandSpan, error);
                    const commandLatency = (Date.now() - acceptStartTime) / 1000;
                    throw error;
                }

                if (!result.success) {
                    // Erro no command
                    logStructured('error', 'AcceptRideCommand falhou', {
                        driverId,
                        bookingId: bookingIdToUse,
                        eventType: 'acceptRide',
                        error: result.error
                    });
                    socket.emit('acceptRideError', {
                        error: result.error || 'Erro ao processar aceitação'
                    });
                    return;
                }

                // Command executado com sucesso
                const {
                    bookingId: resultBookingId,
                    driverId: resultDriverId,
                    customerId,
                    event
                } = result.data;
                const { resolveAcceptRidePayload } = require('./utils/accept-ride-payload');
                const acceptRideRedis = redisPool.getConnection();
                const {
                    pickupLocation,
                    destinationLocation,
                    estimatedFare,
                    driverAcceptedLocation,
                    driverDistanceToPickupKm,
                    estimatedArrivalToPickupMin
                } = await resolveAcceptRidePayload(acceptRideRedis, bookingIdToUse, result.data);

                const driverNamePayload = String(
                    driverData?.driver?.name ||
                    driverData?.driverName ||
                    socket?.driverName ||
                    'Motorista Leaf'
                ).trim();
                const driverVehicleModel = String(
                    driverData?.driver?.vehicle?.model ||
                    driverData?.vehicle?.model ||
                    socket?.vehicleModel ||
                    ''
                ).trim();
                const driverVehiclePlate = String(
                    driverData?.driver?.vehicle?.plate ||
                    driverData?.vehicle?.plate ||
                    socket?.vehiclePlate ||
                    ''
                ).trim();
                const acceptedLat = toFiniteNumber(
                    driverData?.driver?.location?.lat ??
                    driverData?.location?.lat ??
                    driverAcceptedLocation?.lat
                );
                const acceptedLng = toFiniteNumber(
                    driverData?.driver?.location?.lng ??
                    driverData?.location?.lng ??
                    driverAcceptedLocation?.lng
                );
                const acceptedLocation = (acceptedLat !== null && acceptedLng !== null)
                    ? { lat: acceptedLat, lng: acceptedLng }
                    : null;

                if (event?.data) {
                    if (!event.data.metadata || typeof event.data.metadata !== 'object') {
                        event.data.metadata = {};
                    }
                    if (!event.data.metadata.socketDelivery || typeof event.data.metadata.socketDelivery !== 'object') {
                        event.data.metadata.socketDelivery = {};
                    }
                    event.data.metadata.socketDelivery.driverRideAcceptedEmitted = true;
                    event.data.metadata.socketDelivery.passengerRideAcceptedEmitted = Boolean(customerId);
                }

                let estimatedBreakdown = null;
                const estimatedFareValue = Number(estimatedFare);
                if (Number.isFinite(estimatedFareValue) && estimatedFareValue >= 0) {
                    estimatedBreakdown = paymentServiceSingleton.calculateFareBreakdownFromReais(estimatedFareValue, 0);
                }

                const acceptRideResponse = {
                    success: true,
                    bookingId: bookingIdToUse,
                    driverId: driverId,
                    message: 'Corrida aceita com sucesso',
                    timestamp: new Date().toISOString(),
                    pickupLocation: pickupLocation || null,
                    destinationLocation: destinationLocation || null,
                    estimatedFare: Number.isFinite(estimatedFareValue) ? estimatedFareValue : null,
                    driverDistanceToPickupKm: Number.isFinite(Number(driverDistanceToPickupKm))
                        ? Number(driverDistanceToPickupKm)
                        : null,
                    estimatedArrivalToPickupMin: Number.isFinite(Number(estimatedArrivalToPickupMin))
                        ? Number(estimatedArrivalToPickupMin)
                        : null,
                    ...(estimatedBreakdown ? {
                        estimatedOperationalFee: estimatedBreakdown.operationalFee,
                        estimatedPaymentIntermediationFee: estimatedBreakdown.paymentIntermediationFee,
                        estimatedTotalFees: estimatedBreakdown.totalFees,
                        estimatedDriverNetAmount: estimatedBreakdown.driverNetAmount
                    } : {}),
                    driver: {
                        id: driverId,
                        name: driverNamePayload || 'Motorista Leaf',
                        vehicle: {
                            model: driverVehicleModel,
                            plate: driverVehiclePlate
                        },
                        ...(acceptedLocation ? { location: acceptedLocation } : {})
                    },
                    ...(acceptedLocation ? { location: acceptedLocation } : {}),
                    vehicle: {
                        model: driverVehicleModel,
                        plate: driverVehiclePlate
                    }
                };

                // ✅ Emitir confirmação IMEDIATAMENTE para o motorista que solicitou o aceite
                socket.emit('rideAccepted', acceptRideResponse);
                if (customerId) {
                    io.to(`customer_${customerId}`).emit('rideAccepted', {
                        ...acceptRideResponse,
                        message: 'Motorista aceitou sua corrida'
                    });
                }

                // Pós-processamento em background para manter acceptRide responsivo.
                setImmediate(async () => {
                    try {
                        // Encerrar imediatamente a busca desta corrida e liberar motoristas concorrentes.
                        // Mantém o lock do motorista vencedor para evitar corrida com novas ofertas.
                        try {
                            const GradualRadiusExpander = require('./services/gradual-radius-expander');
                            const expander = new GradualRadiusExpander(io);
                            await expander.stopSearch(bookingIdToUse, {
                                preserveDriverId: driverId
                            });
                        } catch (stopSearchError) {
                            logStructured('warn', 'acceptRide: falha ao encerrar busca pós-aceite', {
                                driverId,
                                bookingId: bookingIdToUse,
                                eventType: 'acceptRide',
                                error: stopSearchError.message
                            });
                        }

                        // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão notificar passageiro e motorista)
                        if (event) {
                            const eventSpan = createEventSpan(tracer, 'ride.accepted', activeSpan, {
                                'event.booking_id': resultBookingId || bookingIdToUse,
                                'correlation.id': correlationId
                            });

                            const eventStartTime = Date.now();
                            try {
                                await runInSpan(eventSpan, async () => {
                                    await eventBus.publish({
                                        eventType: 'ride.accepted',
                                        data: event
                                    });
                                });

                                const eventSpanContext = eventSpan.spanContext();
                                if (event.data) {
                                    event.data._otelSpanContext = eventSpanContext;
                                    if (!event.data.metadata) {
                                        event.data.metadata = {};
                                    }
                                    event.data.metadata.correlationId = correlationId;
                                    event.data.metadata.traceId = eventSpanContext.traceId;
                                    event.data.metadata.spanId = eventSpanContext.spanId;
                                }

                                endSpanSuccess(eventSpan, {
                                    'event.latency_ms': Date.now() - eventStartTime
                                });
                            } catch (eventError) {
                                endSpanError(eventSpan, eventError);
                                throw eventError;
                            }

                            const eventLatency = Date.now() - eventStartTime;
                            logEvent('ride.accepted', 'published', {
                                bookingId: bookingIdToUse,
                                latency_ms: eventLatency
                            });
                        }

                        // ✅ Atualizar motorista da corrida no Firestore (best-effort)
                        try {
                            const ridePersistenceService = require('./services/ride-persistence-service');
                            await ridePersistenceService.updateRideDriver(bookingIdToUse, driverId);
                        } catch (persistError) {
                            logStructured('error', 'Erro ao atualizar motorista da corrida no Firestore', {
                                bookingId: bookingIdToUse,
                                driverId,
                                eventType: 'acceptRide',
                                error: persistError.message
                            });
                        }

                        // ✅ Ativar corrida em bookings:active (compatibilidade)
                        if (!redisPool) {
                            throw new Error('redisPool indisponível no acceptRide');
                        }
                        await redisPool.ensureConnection();
                        const redis = redisPool.getConnection();
                        if (!redis) {
                            throw new Error('Conexão Redis indisponível no acceptRide');
                        }

                        const bookingData = await redis.hgetall(`booking:${bookingIdToUse}`);
                        if (bookingData && Object.keys(bookingData).length > 0) {
                            const activeBookingData = {
                                ...bookingData,
                                status: 'ACCEPTED',
                                driverId
                            };

                            try {
                                if (bookingData.pickupLocation) activeBookingData.pickup = JSON.parse(bookingData.pickupLocation);
                                if (bookingData.destinationLocation) activeBookingData.drop = JSON.parse(bookingData.destinationLocation);
                                if (bookingData.estimatedFare) activeBookingData.estimate = parseFloat(bookingData.estimatedFare);
                            } catch (e) {
                                logger.warn(`⚠️ [acceptRide] Erro ao parsear campos para bookings:active: ${e.message}`);
                            }

                            const bookingDataStr = JSON.stringify(activeBookingData);
                            const flowDebugEnabled = process.env.DEBUG_RIDE_FLOW === 'true';
                            if (flowDebugEnabled) {
                                logStructured('debug', 'acceptRide: persistindo booking ativo', {
                                    service: 'acceptRide',
                                    bookingId: bookingIdToUse
                                });
                            }

                            const keyType = await redis.type('bookings:active');
                            if (keyType !== 'hash' && keyType !== 'none') {
                                logStructured('warn', 'acceptRide: key bookings:active com tipo inválido, corrigindo', {
                                    service: 'acceptRide',
                                    keyType
                                });
                                await redis.del('bookings:active');
                            }

                            await redis.hset('bookings:active', bookingIdToUse, bookingDataStr);
                            if (flowDebugEnabled) {
                                logStructured('debug', 'acceptRide: booking ativo persistido', {
                                    service: 'acceptRide',
                                    bookingId: bookingIdToUse
                                });
                            }

                            if (io.activeBookings) {
                                io.activeBookings.set(bookingIdToUse, {
                                    ...io.activeBookings.get(bookingIdToUse),
                                    ...activeBookingData
                                });
                            }
                        } else if (process.env.DEBUG_RIDE_FLOW === 'true') {
                            logStructured('debug', 'acceptRide: bookingData vazio ao ativar corrida', {
                                service: 'acceptRide',
                                bookingId: bookingIdToUse
                            });
                        }

                        await idempotencyService.cacheResult(idempotencyKey, acceptRideResponse);

                        try {
                            await metricsCollector.recordMatchEnd(bookingIdToUse, driverId, Date.now());
                            await metricsCollector.recordDriverAcceptance(bookingIdToUse, driverId, Date.now());
                        } catch (metErr) {
                            logger.error(`❌ [acceptRide] Erro em métricas: ${metErr.message}`);
                        }
                    } catch (backgroundError) {
                        logError(backgroundError, {
                            context: 'Erro no pós-processamento do acceptRide',
                            bookingId: bookingIdToUse
                        });
                    }
                });

                // ✅ NOTIFICAÇÃO JÁ FOI ENVIADA PARA PASSAGEIRO PELOS LISTENERS via EventBus
                const totalLatency = Date.now() - startTime;
                logStructured('info', 'acceptRide concluído com sucesso (Emissão Adiantada)', {
                    driverId,
                    bookingId: bookingIdToUse,
                    eventType: 'acceptRide',
                    latency_ms: totalLatency
                });

            } catch (error) {
                console.error('[ACCEPT_RIDE_FATAL] Error not formatted properly:', error);

                let safeErrorMsg = 'Erro desconhecido';
                if (error instanceof Error) {
                    safeErrorMsg = error.message;
                } else if (typeof error === 'string') {
                    safeErrorMsg = error;
                } else if (error) {
                    safeErrorMsg = JSON.stringify(error);
                }

                logStructured('error', 'Erro ao aceitar corrida', {
                    driverId: socket.userId || socket.id,
                    eventType: 'acceptRide',
                    error: safeErrorMsg,
                    stack: error?.stack || null,
                    rawError: safeErrorMsg
                });
                socket.emit('acceptRideError', { error: 'Erro ao processar aceitação' });
            }
        });
    });

    // 5. RejectRide (crítico - rejeitar corrida)
    socket.on('rejectRide', async (data) => {
        const driverId = socket.userId || socket.id;

        try {
            // ✅ NOVO: Rate Limiting
            const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'rejectRide');

            if (!rateLimitCheck.allowed) {
                socket.emit('rejectRideError', {
                    error: 'Muitas requisições',
                    message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                    code: 'RATE_LIMIT_EXCEEDED',
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt
                });
                logStructured('warn', 'rejectRide bloqueado por rate limiter', {
                    service: 'websocket',
                    driverId,
                    limit: rateLimitCheck.limit,
                    window: '1min'
                });
                return;
            }
        } catch (rateLimitError) {
            logStructured('error', 'Erro ao verificar rate limit para rejectRide', {
                service: 'websocket',
                driverId,
                error: rateLimitError.message,
                stack: rateLimitError.stack
            });
            // Continuar se rate limit falhar (fail-open)
        }

        try {
            // ✅ NOVO: Validação e sanitização de dados
            const validation = validationService.validateEndpoint('rejectRide', data);

            if (!validation.valid) {
                const metadata = getSocketMetadata(socket);
                await auditService.logRideAction(driverId, 'rejectRide', data.bookingId || null, {
                    error: 'Validação falhou',
                    validationErrors: validation.errors
                }, false, 'Dados de entrada inválidos', metadata);

                socket.emit('rejectRideError', {
                    error: 'Dados inválidos',
                    message: 'Os dados fornecidos não são válidos',
                    details: validation.errors,
                    code: 'VALIDATION_ERROR'
                });
                return;
            }

            // Usar dados sanitizados
            const { bookingId: sanitizedBookingId, reason: sanitizedReason } = validation.sanitized;

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                logStructured('debug', 'Rejeitar corrida', {
                    service: 'websocket',
                    driverId,
                    data
                });
            }

            const { rideId, bookingId, reason } = data;

            // Usar bookingId ou rideId (compatibilidade)
            const bookingIdToUse = sanitizedBookingId || bookingId || rideId;

            if (!bookingIdToUse) {
                socket.emit('rejectRideError', { error: 'ID da corrida obrigatório' });
                return;
            }

            if (!driverId) {
                socket.emit('rejectRideError', { error: 'Motorista não autenticado' });
                return;
            }

            // Usar ResponseHandler para processar rejeição
            const result = await responseHandler.handleRejectRide(
                driverId,
                bookingIdToUse,
                sanitizedReason || reason || 'Motorista indisponível'
            );

            if (result.success) {
                // Notificação já foi enviada pelo ResponseHandler
                socket.emit('rideRejected', {
                    success: true,
                    bookingId: bookingIdToUse,
                    rideId: rideId,
                    message: 'Corrida rejeitada com sucesso',
                    reason: reason || 'Motorista indisponível'
                });

                // Se há próxima corrida, ela já foi enviada pelo ResponseHandler
                if (result.nextRide) {
                    logStructured('info', 'Próxima corrida enviada para motorista', {
                        service: 'server',
                        driverId,
                        bookingId: result.nextRide?.bookingId,
                        eventType: 'rejectRide'
                    });
                }

                logStructured('info', 'Motorista rejeitou corrida', {
                    service: 'server',
                    driverId,
                    bookingId: bookingIdToUse,
                    eventType: 'rejectRide'
                });
            } else {
                socket.emit('rejectRideError', {
                    error: result.error || 'Erro ao processar rejeição'
                });
                logStructured('error', 'Falha ao rejeitar corrida', {
                    service: 'server',
                    driverId,
                    bookingId: bookingIdToUse,
                    error: result.error,
                    eventType: 'rejectRide'
                });
            }

        } catch (error) {
            logStructured('error', 'Erro ao rejeitar corrida', {
                service: 'websocket',
                driverId,
                bookingId: bookingIdToUse,
                error: error.message,
                stack: error.stack
            });
            socket.emit('rejectRideError', { error: 'Erro ao processar rejeição' });
        }
    });

    // 6. StartTrip (crítico - iniciar viagem)
    socket.on('startTrip', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                // ✅ Obter driverId do socket (autenticado)
                const driverId = socket.userId || data.driverId || data.uid;

                logStructured('info', 'startTrip iniciado', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'startTrip'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting (antes de validação de pagamento)
                const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'startTrip');

                if (!rateLimitCheck.allowed) {
                    socket.emit('tripStartError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        driverId,
                        eventType: 'startTrip',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Início de viagem recebido', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'startTrip'
                });

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('startTrip', data);

                if (!validation.valid) {
                    const metadata = getSocketMetadata(socket);
                    await auditService.logRideAction(driverId, 'startTrip', data.bookingId || null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('tripStartError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { bookingId, startLocation } = validation.sanitized;

                // Ao iniciar, encerra janela de embarque pendente (se existir).
                clearBoardingWindowTimeout(bookingId);
                clearTripIntegrityConfirmationTimeout(bookingId);

                // ✅ Obter conexão Redis
                const redis = redisPool.getConnection();

                if (!driverId) {
                    socket.emit('tripStartError', { error: 'Motorista não autenticado' });
                    return;
                }

                // ✅ VALIDAÇÃO CRÍTICA: Verificar se pagamento está confirmado
                // Primeiro tenta fast-path no Redis (booking hash), fallback para serviço externo.
                try {
                    const normalizeStatus = (value) => String(value || '').trim().toLowerCase();
                    const parsePositiveAmount = (value) => {
                        const parsed = Number.parseFloat(value);
                        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
                    };
                    const validStatuses = new Set(['in_holding', 'confirmed', 'paid']);

                    let paymentStatus = null;
                    const bookingSnapshot = await redis.hgetall(`booking:${bookingId}`);
                    if (bookingSnapshot && Object.keys(bookingSnapshot).length > 0) {
                        const redisStatus = normalizeStatus(
                            bookingSnapshot.paymentStatus ||
                            bookingSnapshot.payment_status ||
                            bookingSnapshot.statusPagamento
                        );
                        if (validStatuses.has(redisStatus)) {
                            paymentStatus = {
                                success: true,
                                status: redisStatus,
                                amount:
                                    parsePositiveAmount(bookingSnapshot.amount) ||
                                    parsePositiveAmount(bookingSnapshot.finalFare) ||
                                    parsePositiveAmount(bookingSnapshot.estimatedFare)
                            };
                        }
                    }

                    if (!paymentStatus) {
                        const PaymentService = require('./services/payment-service');
                        const paymentService = new PaymentService();
                        paymentStatus = await paymentService.getPaymentStatus(bookingId);
                    }

                    if (!paymentStatus?.success) {
                        const isNotFound = paymentStatus?.error && (
                            paymentStatus.error.includes('não encontrado') ||
                            paymentStatus.error.includes('not found') ||
                            paymentStatus.error.includes('não existe') ||
                            paymentStatus.status === null ||
                            paymentStatus.status === undefined
                        );

                        if (isNotFound) {
                            logStructured('warn', 'Tentativa de iniciar corrida sem pagamento', {
                                driverId,
                                bookingId,
                                eventType: 'startTrip'
                            });

                            socket.emit('tripStartError', {
                                error: 'Pagamento não encontrado',
                                message: 'Nenhum pagamento foi encontrado para esta corrida. A corrida não pode ser iniciada sem pagamento confirmado.',
                                code: 'PAYMENT_NOT_FOUND',
                                paymentStatus: null
                            });
                            return;
                        }

                        logStructured('error', 'Erro ao verificar status do pagamento', {
                            driverId,
                            bookingId,
                            eventType: 'startTrip',
                            error: paymentStatus?.error || 'unknown_payment_validation_error'
                        });

                        socket.emit('tripStartError', {
                            error: 'Erro ao verificar pagamento',
                            message: 'Não foi possível verificar o status do pagamento. Tente novamente.',
                            code: 'PAYMENT_VERIFICATION_ERROR'
                        });
                        return;
                    }

                    const normalizedStatus = normalizeStatus(paymentStatus.status);
                    if (!normalizedStatus) {
                        logStructured('warn', 'Tentativa de iniciar corrida sem status de pagamento válido', {
                            driverId,
                            bookingId,
                            eventType: 'startTrip'
                        });

                        socket.emit('tripStartError', {
                            error: 'Pagamento não encontrado',
                            message: 'Nenhum pagamento foi encontrado para esta corrida. A corrida não pode ser iniciada sem pagamento confirmado.',
                            code: 'PAYMENT_NOT_FOUND',
                            paymentStatus: null
                        });
                        return;
                    }

                    if (!validStatuses.has(normalizedStatus)) {
                        logStructured('warn', 'Tentativa de iniciar corrida com pagamento em status inválido', {
                            driverId,
                            bookingId,
                            eventType: 'startTrip',
                            currentStatus: normalizedStatus,
                            requiredStatus: 'in_holding|confirmed|paid'
                        });

                        socket.emit('tripStartError', {
                            error: 'Pagamento não confirmado',
                            message: `A corrida só pode ser iniciada após confirmação do pagamento. Status atual: ${normalizedStatus}.`,
                            code: 'PAYMENT_NOT_CONFIRMED',
                            paymentStatus: normalizedStatus,
                            requiredStatus: 'in_holding|confirmed|paid',
                            amount: paymentStatus.amount || null
                        });
                        return;
                    }

                    if (paymentStatus.amount && Number(paymentStatus.amount) <= 0) {
                        logStructured('warn', 'Tentativa de iniciar corrida com valor de pagamento inválido', {
                            service: 'websocket',
                            operation: 'startTrip',
                            bookingId,
                            driverId,
                            amount: paymentStatus.amount
                        });

                        socket.emit('tripStartError', {
                            error: 'Valor de pagamento inválido',
                            message: 'O valor do pagamento é inválido. Entre em contato com o suporte.',
                            code: 'INVALID_PAYMENT_AMOUNT',
                            paymentStatus: normalizedStatus
                        });
                        return;
                    }

                    logStructured('info', 'Pagamento confirmado para corrida', {
                        service: 'websocket',
                        operation: 'startTrip',
                        bookingId,
                        driverId,
                        paymentStatus: normalizedStatus,
                        source: paymentStatus?.success ? 'redis_or_payment_service' : 'unknown',
                        amount: paymentStatus.amount || null
                    });
                } catch (paymentCheckError) {
                    logStructured('error', 'Erro crítico ao verificar pagamento para corrida', {
                        service: 'websocket',
                        operation: 'startTrip',
                        bookingId,
                        driverId,
                        error: paymentCheckError.message,
                        stack: paymentCheckError.stack
                    });

                    socket.emit('tripStartError', {
                        error: 'Erro ao verificar pagamento',
                        message: 'Não foi possível verificar o status do pagamento. A corrida não pode ser iniciada por segurança.',
                        code: 'PAYMENT_VERIFICATION_CRITICAL_ERROR'
                    });
                    return;
                }

                // ✅ REFATORAÇÃO: Usar StartTripCommand
                logStructured('info', 'Executando StartTripCommand', {
                    driverId,
                    bookingId,
                    eventType: 'startTrip'
                });

                // ✅ FASE 1.3: Criar span para Command
                const tracer = getTracer();
                const { trace: otelTrace } = require('@opentelemetry/api');
                const activeSpan = otelTrace.getActiveSpan();
                const correlationId = bookingId; // Usar bookingId como correlationId

                const commandSpan = createCommandSpan(tracer, 'start_trip', activeSpan, {
                    'command.driver_id': driverId,
                    'command.booking_id': bookingId,
                    'correlation.id': correlationId
                });

                // ✅ MÉTRICAS: Preparar para registrar viagem iniciada
                const { metrics } = require('./utils/prometheus-metrics');
                const commandStartTime = Date.now();

                let result;
                try {
                    const command = new StartTripCommand({
                        driverId,
                        bookingId,
                        startLocation,
                        traceId, // ✅ Passar traceId para o command
                        correlationId // ✅ Passar correlationId para o command
                    });

                    result = await runInSpan(commandSpan, async () => {
                        return await command.execute();
                    });

                    // ✅ MÉTRICAS: Registrar latência do command
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                } catch (error) {
                    endSpanError(commandSpan, error);
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                    throw error;
                }

                const commandLatency = Date.now() - commandStartTime;

                // ✅ Log de command
                logCommand('StartTripCommand', result.success, commandLatency, {
                    driverId,
                    bookingId
                });

                if (!result.success) {
                    // Erro no command
                    logStructured('error', 'StartTripCommand falhou', {
                        driverId,
                        bookingId,
                        eventType: 'startTrip',
                        error: result.error
                    });
                    socket.emit('tripStartError', {
                        error: result.error || 'Erro ao iniciar viagem'
                    });
                    return;
                }

                // Command executado com sucesso
                const { bookingId: resultBookingId, driverId: resultDriverId, customerId, event, startLocation: resultStartLocation } = result.data;

                // ✅ Padronizar uso de rooms para alta escalabilidade e confiabilidade
                const tripStartedData = {
                    success: true,
                    bookingId,
                    message: 'Viagem iniciada com sucesso',
                    startLocation: resultStartLocation,
                    timestamp: new Date().toISOString()
                };

                // ✅ Notificar driver via room (escalável e confiável)
                io.to(`driver_${driverId}`).emit('tripStarted', tripStartedData);

                const customerIdToNotify = customerId || io.activeBookings?.get(bookingId)?.customerId || null;
                if (customerIdToNotify) {
                    io.to(`customer_${customerIdToNotify}`).emit('tripStarted', {
                        ...tripStartedData,
                        message: 'Viagem iniciada'
                    });
                }

                const totalLatency = Date.now() - startTime;
                logStructured('info', 'startTrip concluído com sucesso', {
                    driverId,
                    bookingId,
                    eventType: 'startTrip',
                    latency_ms: totalLatency
                });

                // Pós-processamentos em background para manter startTrip com ACK rápido.
                setImmediate(async () => {
                    try {
                        if (event) {
                            const eventSpan = createEventSpan(tracer, 'ride.started', activeSpan, {
                                'event.booking_id': bookingId,
                                'correlation.id': correlationId
                            });

                            const eventStartTime = Date.now();
                            try {
                                await runInSpan(eventSpan, async () => {
                                    await eventBus.publish({
                                        eventType: 'ride.started',
                                        data: event
                                    });
                                });

                                const eventSpanContext = eventSpan.spanContext();
                                if (event.data) {
                                    event.data._otelSpanContext = eventSpanContext;
                                }

                                const eventLatency = Date.now() - eventStartTime;
                                logEvent('ride.started', 'published', {
                                    bookingId,
                                    latency_ms: eventLatency
                                });
                            } catch (eventError) {
                                endSpanError(eventSpan, eventError);
                                throw eventError;
                            }
                        }

                        try {
                            const ridePersistenceService = require('./services/ride-persistence-service');
                            await ridePersistenceService.markRideStarted(bookingId);

                            const bookingDataRaw = await redis.hgetall(`booking:${bookingId}`);
                            if (bookingDataRaw && Object.keys(bookingDataRaw).length > 0) {
                                const activeBookingData = {
                                    ...bookingDataRaw,
                                    status: 'IN_PROGRESS'
                                };

                                try {
                                    if (bookingDataRaw.pickupLocation) activeBookingData.pickup = JSON.parse(bookingDataRaw.pickupLocation);
                                    if (bookingDataRaw.destinationLocation) activeBookingData.drop = JSON.parse(bookingDataRaw.destinationLocation);
                                    if (bookingDataRaw.estimatedFare) activeBookingData.estimate = parseFloat(bookingDataRaw.estimatedFare);
                                } catch (_) {
                                    // noop
                                }

                                const bookingDataStr = JSON.stringify(activeBookingData);
                                const flowDebugEnabled = process.env.DEBUG_RIDE_FLOW === 'true';
                                if (flowDebugEnabled) {
                                    logStructured('debug', 'startTrip: persistindo booking ativo', {
                                        service: 'startTrip',
                                        bookingId
                                    });
                                }

                                const keyType = await redis.type('bookings:active');
                                if (keyType !== 'hash' && keyType !== 'none') {
                                    logStructured('warn', 'startTrip: key bookings:active com tipo inválido, corrigindo', {
                                        service: 'startTrip',
                                        keyType
                                    });
                                    await redis.del('bookings:active');
                                }

                                await redis.hset('bookings:active', bookingId, bookingDataStr);
                                if (flowDebugEnabled) {
                                    logStructured('debug', 'startTrip: booking ativo persistido', {
                                        service: 'startTrip',
                                        bookingId
                                    });
                                }

                                if (io.activeBookings && io.activeBookings.has(bookingId)) {
                                    io.activeBookings.set(bookingId, {
                                        ...io.activeBookings.get(bookingId),
                                        ...activeBookingData
                                    });
                                }
                            }
                        } catch (persistError) {
                            logStructured('error', 'Erro ao marcar corrida como iniciada no Firestore/Redis', {
                                bookingId,
                                eventType: 'startTrip',
                                error: persistError.message
                            });
                        }

                        const bookingDataRedis = await redis.hgetall(`booking:${bookingId}`);
                        const customerIdFallback = customerIdToNotify || bookingDataRedis?.customerId || bookingDataRedis?.customer || null;
                        if (!customerIdToNotify && customerIdFallback) {
                            io.to(`customer_${customerIdFallback}`).emit('tripStarted', {
                                ...tripStartedData,
                                message: 'Viagem iniciada'
                            });
                            logStructured('info', 'tripStarted enviado para customer (fallback)', {
                                bookingId,
                                customerId: customerIdFallback,
                                eventType: 'startTrip'
                            });
                        }

                        try {
                            const destinationLocation = bookingDataRedis.destinationLocation
                                ? (typeof bookingDataRedis.destinationLocation === 'string'
                                    ? JSON.parse(bookingDataRedis.destinationLocation)
                                    : bookingDataRedis.destinationLocation)
                                : null;
                            const destinationAddress = destinationLocation?.address || destinationLocation?.add || 'destino';
                            const driverFcmToken = await redis.hget(`driver:${driverId}`, 'fcmToken');

                            if (driverFcmToken && destinationAddress) {
                                if (!fcmService.isServiceAvailable()) {
                                    fcmService.setRedis(redisPool.getConnection());
                                    await fcmService.initialize();
                                }

                                let estimatedArrival = 'calculando...';
                                if (
                                    startLocation &&
                                    destinationLocation &&
                                    startLocation.lat &&
                                    startLocation.lng &&
                                    destinationLocation.lat &&
                                    destinationLocation.lng
                                ) {
                                    const R = 6371;
                                    const dLat = (destinationLocation.lat - startLocation.lat) * Math.PI / 180;
                                    const dLon = (destinationLocation.lng - startLocation.lng) * Math.PI / 180;
                                    const a =
                                        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                                        Math.cos(startLocation.lat * Math.PI / 180) * Math.cos(destinationLocation.lat * Math.PI / 180) *
                                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                                    const distanceKm = R * c;
                                    const speedKmPerMin = 0.583;
                                    const estimatedMinutes = Math.max(1, Math.round(distanceKm / speedKmPerMin));
                                    estimatedArrival = `${estimatedMinutes} ${estimatedMinutes === 1 ? 'minuto' : 'minutos'}`;
                                }

                                await fcmService.sendInteractiveNotification(
                                    driverFcmToken,
                                    {
                                        title: '🚗 A caminho do destino',
                                        body: `A caminho de ${destinationAddress} • Chegada em ${estimatedArrival}`,
                                        data: {
                                            type: 'trip_in_progress',
                                            bookingId: bookingId,
                                            driverId: driverId,
                                            destinationAddress: destinationAddress,
                                            estimatedArrival: estimatedArrival,
                                            hasActions: 'true'
                                        },
                                        channelId: 'driver_actions',
                                        badge: 1
                                    },
                                    [
                                        {
                                            id: 'end_trip',
                                            title: 'Encerrar corrida',
                                            icon: 'ic_stop'
                                        }
                                    ],
                                    'TRIP_IN_PROGRESS'
                                );
                            }
                        } catch (notifError) {
                            logStructured('error', 'Erro ao enviar notificação durante corrida', {
                                service: 'websocket',
                                operation: 'startTrip',
                                driverId,
                                bookingId,
                                error: notifError.message,
                                stack: notifError.stack
                            });
                        }
                    } catch (backgroundError) {
                        logStructured('error', 'Erro no pós-processamento assíncrono do startTrip', {
                            bookingId,
                            driverId,
                            eventType: 'startTrip',
                            error: backgroundError.message
                        });
                    }
                });

            } catch (error) {
                logStructured('error', 'Erro ao iniciar viagem', {
                    service: 'websocket',
                    operation: 'startTrip',
                    driverId,
                    bookingId: data.bookingId,
                    error: error.message,
                    stack: error.stack
                });
                socket.emit('tripStartError', { error: 'Erro ao iniciar viagem' });
            }
        }); // Fecha traceContext.runWithTraceId
    });

    // 7. UpdateTripLocation (crítico - GPS durante viagem)
    socket.on('updateTripLocation', async (data) => {
        try {
            const { bookingId, lat, lng, heading, speed } = data;

            if (!bookingId || !lat || !lng) {
                // Não emitir erro para não interromper atualizações frequentes
                // Apenas logar em desenvolvimento
                if (process.env.NODE_ENV !== 'production') {
                    logStructured('warn', 'Dados incompletos para atualização de localização da viagem', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        data
                    });
                }
                return;
            }

            // Simular atualização no Redis/Firebase para trip específica
            const tripLocationData = {
                bookingId,
                location: { lat, lng },
                heading: heading || 0,
                speed: speed || 0,
                timestamp: Date.now(),
                lastUpdate: new Date().toISOString()
            };

            const payload = {
                bookingId,
                location: { lat, lng },
                heading: heading || 0,
                speed: speed || 0,
                timestamp: tripLocationData.timestamp
            };

            // Notificar somente partes da corrida (evita broadcast global).
            const redis = redisPool.getConnection();
            const { customerId, driverId } = await resolveBookingParties(redis, bookingId);
            if (customerId) {
                io.to(`customer_${customerId}`).emit('tripLocationUpdated', payload);
            }
            if (driverId && driverId !== socket.userId) {
                io.to(`driver_${driverId}`).emit('tripLocationUpdated', payload);
            }

            // Log apenas a cada 10 atualizações para não poluir logs
            if (Math.random() < 0.1) {
                if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                    logStructured('debug', 'Localização da viagem atualizada', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        bookingId,
                        lat: lat.toFixed(6),
                        lng: lng.toFixed(6)
                    });
                }
            }

        } catch (error) {
            logStructured('error', 'Erro ao atualizar localização da viagem', {
                service: 'websocket',
                operation: 'updateLocation',
                bookingId: data.bookingId,
                error: error.message,
                stack: error.stack
            });
            // Não emitir erro para não interromper fluxo de atualizações
        }
    });

    // 8. CompleteTrip (crítico - finalizar viagem)
    socket.on('completeTrip', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                const driverId = socket.userId || socket.id;

                logStructured('info', 'completeTrip iniciado', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'completeTrip'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting
                const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'finishTrip');

                if (!rateLimitCheck.allowed) {
                    socket.emit('tripCompleteError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        driverId,
                        eventType: 'completeTrip',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Finalização de viagem recebida', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'completeTrip'
                });

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('finishTrip', data);

                if (!validation.valid) {
                    const metadata = getSocketMetadata(socket);
                    await auditService.logRideAction(driverId, 'finishTrip', data.bookingId || null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('tripCompleteError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { bookingId, endLocation, distance, fare } = validation.sanitized;
                clearBoardingWindowTimeout(bookingId);
                clearTripIntegrityConfirmationTimeout(bookingId);

                // ✅ REFATORAÇÃO: Usar CompleteTripCommand
                logStructured('info', 'Executando CompleteTripCommand', {
                    driverId,
                    bookingId,
                    eventType: 'completeTrip'
                });

                // Calcular duração se necessário (pode ser obtido do timer iniciado pelo listener)
                const redis = redisPool.getConnection();
                const timerKey = `trip_timer:${bookingId}`;
                const timerData = await redis.hgetall(timerKey);
                const duration = timerData.startTimestamp ?
                    Math.floor((Date.now() - parseInt(timerData.startTimestamp)) / 1000) : 0;

                // ✅ FASE 1.3: Criar span para Command
                const tracer = getTracer();
                const { trace: otelTrace } = require('@opentelemetry/api');
                const activeSpan = otelTrace.getActiveSpan();
                const correlationId = bookingId; // Usar bookingId como correlationId

                const commandSpan = createCommandSpan(tracer, 'complete_trip', activeSpan, {
                    'command.driver_id': driverId,
                    'command.booking_id': bookingId,
                    'correlation.id': correlationId
                });

                // ✅ MÉTRICAS: Preparar para registrar viagem finalizada
                const { metrics } = require('./utils/prometheus-metrics');
                const commandStartTime = Date.now();

                let result;
                try {
                    const command = new CompleteTripCommand({
                        driverId,
                        bookingId,
                        endLocation,
                        finalFare: parseFloat(fare) || 0,
                        distance: parseFloat(distance) || 0,
                        duration: duration,
                        traceId, // ✅ Passar traceId para o command
                        correlationId // ✅ Passar correlationId para o command
                    });

                    result = await runInSpan(commandSpan, async () => {
                        return await command.execute();
                    });

                    // ✅ MÉTRICAS: Registrar latência do command
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                } catch (error) {
                    endSpanError(commandSpan, error);
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                    throw error;
                }

                const commandLatency = Date.now() - commandStartTime;

                // ✅ Log de command
                logCommand('CompleteTripCommand', result.success, commandLatency, {
                    driverId,
                    bookingId
                });

                if (!result.success) {
                    // Erro no command
                    logStructured('error', 'CompleteTripCommand falhou', {
                        driverId,
                        bookingId,
                        eventType: 'completeTrip',
                        error: result.error
                    });
                    socket.emit('tripCompleteError', {
                        error: result.error || 'Erro ao finalizar viagem'
                    });
                    return;
                }

                // Command executado com sucesso (já processou pagamento e atualizou estado)
                const {
                    bookingId: resultBookingId,
                    driverId: resultDriverId,
                    customerId,
                    city = 'unknown',
                    serviceType = 'standard',
                    event,
                    endLocation: resultEndLocation,
                    finalFare,
                    tollFee: resultTollFee,
                    distance: resultDistance,
                    duration: resultDuration,
                    paymentDistribution
                } = result.data;

                const PaymentService = require('./services/payment-service');
                const paymentService = new PaymentService();
                const fareReais = Number(finalFare || fare || 0);
                const tollFeeReais = Number(resultTollFee || 0);
                const fareBreakdown = paymentService.calculateFareBreakdownFromReais(fareReais, tollFeeReais);

                metrics.recordRideCompleted(city, serviceType || 'standard');
                if (Number.isFinite(Number(resultDuration)) && Number(resultDuration) >= 0) {
                    metrics.recordRideTotalDuration(Number(resultDuration), city);
                }

                // Emitir confirmação imediatamente para reduzir latência no caminho crítico
                const tripCompletedData = {
                    success: true,
                    bookingId,
                    message: 'Viagem finalizada com sucesso',
                    endLocation: resultEndLocation || endLocation,
                    distance: resultDistance || distance,
                    fare: fareBreakdown.totalFare,
                    operationalFee: fareBreakdown.operationalFee,
                    paymentIntermediationFee: fareBreakdown.paymentIntermediationFee,
                    totalFees: fareBreakdown.totalFees,
                    driverNetAmount: fareBreakdown.driverNetAmount,
                    persistence: 'accepted_background',
                    timestamp: new Date().toISOString()
                };

                io.to(`driver_${driverId}`).emit('tripCompleted', tripCompletedData);

                let customerIdToNotify = customerId || io.activeBookings?.get(bookingId)?.customerId || null;

                if (customerIdToNotify) {
                    io.to(`customer_${customerIdToNotify}`).emit('tripCompleted', {
                        ...tripCompletedData,
                        message: 'Viagem finalizada'
                    });
                } else {
                    logStructured('warn', 'CustomerId não encontrado para tripCompleted', {
                        bookingId,
                        eventType: 'completeTrip'
                    });
                }

                // Pós-processamento assíncrono para não bloquear ack da finalização
                setImmediate(async () => {
                    try {
                        if (event) {
                            const eventSpan = createEventSpan(tracer, 'ride.completed', activeSpan, {
                                'event.booking_id': bookingId,
                                'correlation.id': correlationId
                            });

                            const eventStartTime = Date.now();
                            try {
                                await runInSpan(eventSpan, async () => {
                                    await eventBus.publish({
                                        eventType: 'ride.completed',
                                        data: event
                                    });
                                });

                                const eventSpanContext = eventSpan.spanContext();
                                if (event.data) {
                                    event.data._otelSpanContext = eventSpanContext;
                                }

                                const eventLatency = Date.now() - eventStartTime;
                                logEvent('ride.completed', 'published', {
                                    bookingId,
                                    latency_ms: eventLatency
                                });
                            } catch (eventError) {
                                endSpanError(eventSpan, eventError);
                                throw eventError;
                            }
                        }

                        if (!customerIdToNotify) {
                            const bookingDataRedisForCustomer = await redis.hgetall(`booking:${bookingId}`);
                            const customerIdFallback =
                                bookingDataRedisForCustomer?.customerId ||
                                bookingDataRedisForCustomer?.customer ||
                                null;
                            if (customerIdFallback) {
                                customerIdToNotify = customerIdFallback;
                                io.to(`customer_${customerIdToNotify}`).emit('tripCompleted', {
                                    ...tripCompletedData,
                                    message: 'Viagem finalizada'
                                });
                            }
                        }

                        const finalRideSnapshot = {
                            fare: finalFare || fare,
                            netFare: null,
                            distance: resultDistance || distance,
                            duration: resultDuration || duration || null,
                            endLocation: resultEndLocation || endLocation,
                            driverEarnings: null,
                            financialBreakdown: paymentDistribution || null
                        };

                        io.to(`driver_${driverId}`).emit('paymentDistributed', {
                            success: true,
                            bookingId,
                            pending: true,
                            message: 'Distribuição financeira em processamento assíncrono'
                        });

                        const ridePersistenceService = require('./services/ride-persistence-service');
                        const persistFinalResult = await ridePersistenceService.persistFinalRideDataWithOutbox(
                            bookingId,
                            finalRideSnapshot
                        );

                        if (!persistFinalResult.success) {
                            logStructured('error', 'Falha ao persistir finalizacao da corrida (background)', {
                                bookingId,
                                eventType: 'completeTrip',
                                error: persistFinalResult.error || 'persist_final_failed'
                            });
                        } else if (persistFinalResult.deferred) {
                            logStructured('warn', 'Finalizacao enfileirada em outbox para retry', {
                                bookingId,
                                eventType: 'completeTrip'
                            });
                        }

                        clearTripIntegrityConfirmationTimeout(bookingId);
                        await redis.del(`trip_integrity:${bookingId}`);

                        try {
                            const ReceiptService = require('./services/receipt-service');
                            const receiptService = new ReceiptService();
                            const bookingDataForReceipt = io.activeBookings?.get(bookingId);
                            if (bookingDataForReceipt) {
                                const receiptData = {
                                    ...bookingDataForReceipt,
                                    finalPrice: finalFare || fare,
                                    distance: resultDistance || distance,
                                    endTime: new Date().toISOString(),
                                    completedAt: new Date().toISOString(),
                                    status: 'COMPLETED'
                                };
                                const firebaseDb = firebaseConfig?.getRealtimeDB?.();
                                await receiptService.generateAndSaveReceipt(bookingId, receiptData, firebaseDb);
                            }
                        } catch (receiptError) {
                            logStructured('warn', 'Erro ao gerar recibo', {
                                bookingId,
                                eventType: 'completeTrip',
                                error: receiptError.message
                            });
                        }

                        try {
                            const payloadData = {
                                bookingId: bookingId,
                                status: 'completed',
                                distance: String(resultDistance || distance || '0'),
                                fare: String(finalFare || fare || '0')
                            };

                            if (customerIdToNotify) {
                                await fcmService.sendRideStatusUpdate(customerIdToNotify, { ...payloadData, userType: 'customer' });
                            }
                            await fcmService.sendRideStatusUpdate(driverId, { ...payloadData, userType: 'driver' });
                        } catch (silentPushError) {
                            logStructured('error', 'Erro ao enviar silent push em completeTrip', { error: silentPushError.message });
                        }
                    } catch (backgroundError) {
                        logStructured('error', 'Erro no pós-processamento assíncrono do completeTrip', {
                            bookingId,
                            driverId,
                            eventType: 'completeTrip',
                            error: backgroundError.message
                        });
                    } finally {
                        if (io.activeBookings) {
                            io.activeBookings.delete(bookingId);
                        }
                    }
                });

            } catch (error) {
                logStructured('error', 'Erro ao finalizar viagem', {
                    service: 'websocket',
                    operation: 'completeTrip',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('tripCompleteError', { error: 'Erro ao finalizar viagem' });
            }
        }); // Fecha traceContext.runWithTraceId
    });

    // Enviar avaliação
    socket.on('submitRating', async (data) => {
        try {
            logStructured('info', 'Avaliação recebida', {
                service: 'websocket',
                operation: 'submitRating',
                tripId: data.tripId,
                rating: data.rating
            });

            const { tripId, rating, comment, selectedOptions, userType, timestamp, tripData } = data;

            if (!tripId || !rating) {
                socket.emit('ratingError', { error: 'ID da viagem e avaliação são obrigatórios' });
                return;
            }

            const redis = redisPool.getConnection();

            // Buscar dados da corrida em múltiplas estruturas (legado + fluxo atual)
            let bookingExists = false;

            const activeBooking = await redis.hget('bookings:active', tripId);
            if (activeBooking) {
                bookingExists = true;
            }

            if (!bookingExists) {
                const completedBooking = await redis.hget('bookings:completed', tripId);
                if (completedBooking) {
                    bookingExists = true;
                }
            }

            if (!bookingExists) {
                const bookingHash = await redis.hgetall(`booking:${tripId}`);
                if (bookingHash && Object.keys(bookingHash).length > 0) {
                    bookingExists = true;
                }
            }

            if (!bookingExists && tripData && typeof tripData === 'object') {
                const tripDataId = tripData.bookingId || tripData.tripId;
                if (tripDataId && String(tripDataId) === String(tripId)) {
                    bookingExists = true;
                }
            }

            if (!bookingExists) {
                socket.emit('ratingError', { error: 'Corrida não encontrada' });
                return;
            }

            // Obter userId do socket ou dos dados
            const userId = socket.userId || socket.user?.id || data.userId || 'unknown';

            // Criar objeto de avaliação
            const ratingData = {
                id: `rating_${Date.now()}_${userId}`,
                tripId,
                userId,
                userType: userType || 'passenger',
                rating: parseInt(rating),
                comment: comment || '',
                selectedOptions: selectedOptions || [],
                timestamp: timestamp || new Date().toISOString(),
                createdAt: new Date().toISOString()
            };

            // Salvar avaliação no Redis
            await redis.hset('ratings', ratingData.id, JSON.stringify(ratingData));

            // Adicionar à lista de avaliações da viagem
            await redis.sadd(`trip_ratings:${tripId}`, ratingData.id);

            // Adicionar à lista de avaliações do usuário
            await redis.sadd(`user_ratings:${userId}`, ratingData.id);

            // ✅ Avaliação salva via evento (se necessário, pode ser persistida no Firestore)
            // try {
            //     await firebaseBatch.batchCreate('ratings', [ratingData]);
            // } catch (firebaseError) {
            //     console.warn('⚠️ Erro ao salvar no Firebase:', firebaseError.message);
            // }

            // ✅ Padronizar uso de rooms para alta escalabilidade
            const ratingSubmittedData = {
                success: true,
                ratingId: ratingData.id,
                tripId,
                message: 'Avaliação enviada com sucesso',
                timestamp: new Date().toISOString()
            };

            // Emitir confirmação via room
            if (userType === 'driver') {
                io.to(`driver_${userId}`).emit('ratingSubmitted', ratingSubmittedData);
            } else {
                io.to(`customer_${userId}`).emit('ratingSubmitted', ratingSubmittedData);
            }

            logStructured('info', 'Avaliação salva com sucesso', {
                service: 'server',
                ratingId: ratingData.id,
                tripId,
                rating,
                hasComment: !!comment,
                eventType: 'submitRating'
            });

        } catch (error) {
            logStructured('error', 'Erro ao enviar avaliação', {
                service: 'websocket',
                operation: 'submitRating',
                tripId,
                error: error.message,
                stack: error.stack
            });
            socket.emit('ratingError', { error: 'Erro ao enviar avaliação: ' + error.message });
        }
    });

    // ==================== NOTIFICAÇÕES INTERATIVAS - AÇÕES DE NOTIFICAÇÃO ====================

    // Processar ação de notificação (quando motorista clica em botão da notificação)
    socket.on('notificationAction', async (data) => {
        try {
            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                logStructured('debug', 'Ação de notificação recebida', {
                    service: 'websocket',
                    operation: 'notificationAction',
                    data
                });
            }

            const { action, bookingId, driverId: providedDriverId } = data;
            const driverId = socket.userId || providedDriverId;

            if (!driverId || socket.userType !== 'driver') {
                socket.emit('notificationActionError', { error: 'Apenas motoristas podem executar ações' });
                return;
            }

            if (!action || !bookingId) {
                socket.emit('notificationActionError', { error: 'Ação e ID da corrida são obrigatórios' });
                return;
            }

            const redis = redisPool.getConnection();

            // Buscar dados da corrida
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('notificationActionError', { error: 'Corrida não encontrada' });
                return;
            }

            const booking = JSON.parse(bookingData);

            // Processar ação específica
            switch (action) {
                case 'arrived_at_pickup':
                    // Motorista chegou ao local de embarque
                    logStructured('info', 'Motorista chegou ao local de embarque', {
                        service: 'server',
                        driverId,
                        bookingId,
                        action: 'arrived_at_pickup',
                        eventType: 'notificationAction'
                    });

                    // Atualizar status da corrida
                    booking.status = 'ARRIVED';
                    booking.driverArrivedAt = Date.now();
                    const boardingDeadlineAtMs = booking.driverArrivedAt + (DRIVER_BOARDING_WINDOW_SECONDS * 1000);
                    booking.boardingDeadlineAt = boardingDeadlineAtMs;
                    booking.boardingWindowSec = DRIVER_BOARDING_WINDOW_SECONDS;
                    await RideStateManager.updateBookingState(
                        redis,
                        bookingId,
                        RideStateManager.STATES.ARRIVED,
                        {
                            status: 'ARRIVED',
                            driverId,
                            driverArrivedAt: String(booking.driverArrivedAt),
                            boardingDeadlineAt: String(boardingDeadlineAtMs),
                            boardingWindowSec: String(DRIVER_BOARDING_WINDOW_SECONDS)
                        }
                    );
                    await redis.hset('bookings:active', bookingId, JSON.stringify(booking));

                    // Notificar passageiro
                    if (booking.customerId && io) {
                        const pickupAddress = booking.pickupLocation?.address || booking.pickup?.add || 'local de embarque';
                        io.to(`customer_${booking.customerId}`).emit('driverArrived', {
                            bookingId,
                            driverId,
                            message: `Dirija-se ao local de embarque em ${pickupAddress}`,
                            pickupAddress: pickupAddress,
                            boardingWindowSec: DRIVER_BOARDING_WINDOW_SECONDS,
                            boardingDeadlineAt: new Date(boardingDeadlineAtMs).toISOString(),
                            timestamp: new Date().toISOString()
                        });

                        // ✅ NOVO: Atualizar Live Activity/Foreground Service (Silent Push)
                        try {
                            if (!fcmService.isServiceAvailable()) fcmService.setRedis(redisPool.getConnection());
                            await fcmService.sendRideStatusUpdate(booking.customerId, {
                                bookingId: bookingId,
                                status: 'arrived',
                                userType: 'customer',
                                driverName: driverId,
                                pickup: booking.pickupLocation || booking.pickup || { address: pickupAddress },
                                destination: booking.destination || booking.destinationLocation || {}
                            });
                        } catch (e) {
                            logStructured('error', 'Erro ao enviar silent push de chegada (customer)', { error: e.message });
                        }
                    }

                    // ✅ NOVO: Atualizar Live Activity/Foreground Service do Motorista
                    try {
                        const pickupAddress = booking.pickupLocation?.address || booking.pickup?.add || 'local de embarque';
                        if (!fcmService.isServiceAvailable()) fcmService.setRedis(redisPool.getConnection());
                        await fcmService.sendRideStatusUpdate(driverId, {
                            bookingId: bookingId,
                            status: 'arrived',
                            userType: 'driver',
                            pickup: booking.pickupLocation || booking.pickup || { address: pickupAddress },
                            destination: booking.destination || booking.destinationLocation || {}
                        });
                    } catch (e) {
                        logStructured('error', 'Erro ao enviar silent push de chegada (driver)', { error: e.message });
                    }

                    // ✅ NOVO: Enviar nova notificação para o motorista com botão "Iniciar corrida"
                    try {
                        const driverFcmToken = await redis.hget(`driver:${driverId}`, 'fcmToken');
                        if (driverFcmToken) {
                            // Usar singleton
                            if (!fcmService.isServiceAvailable()) {
                                fcmService.setRedis(redisPool.getConnection());
                                await fcmService.initialize();
                            }

                            const pickupAddress = booking.pickupLocation?.address || booking.pickup?.add || 'Local de embarque';

                            // Nova notificação com botão "Iniciar corrida"
                            await fcmService.sendInteractiveNotification(
                                driverFcmToken,
                                {
                                    title: '✅ Você chegou ao local!',
                                    body: `Aguardando passageiro em ${pickupAddress}`,
                                    data: {
                                        type: 'trip_started',
                                        bookingId: bookingId,
                                        driverId: driverId,
                                        pickupAddress: pickupAddress,
                                        hasActions: 'true'
                                    },
                                    channelId: 'driver_actions',
                                    badge: 1
                                },
                                [
                                    {
                                        id: 'start_trip',
                                        title: 'Iniciar corrida',
                                        icon: 'ic_play'
                                    },
                                    {
                                        id: 'cancel_ride',
                                        title: 'Cancelar',
                                        icon: 'ic_close'
                                    }
                                ],
                                'TRIP_STARTED' // Categoria para iOS com botão "Iniciar corrida"
                            );

                            logStructured('info', 'Nova notificação com botão "Iniciar corrida" enviada para motorista', {
                                service: 'server',
                                driverId,
                                bookingId,
                                action: 'start_trip',
                                eventType: 'notificationAction'
                            });
                        }
                    } catch (fcmError) {
                        logStructured('error', 'Erro ao enviar notificação de início', {
                            service: 'server',
                            driverId,
                            bookingId,
                            error: fcmError.message,
                            stack: fcmError.stack,
                            eventType: 'notificationAction'
                        });
                        // Não falhar o fluxo se a notificação falhar
                    }

                    // Notificar motorista (confirmação)
                    io.to(`driver_${driverId}`).emit('arrivedAtPickup', {
                        success: true,
                        bookingId,
                        message: 'Chegada registrada. Aguardando embarque do passageiro.',
                        boardingWindowSec: DRIVER_BOARDING_WINDOW_SECONDS,
                        boardingDeadlineAt: new Date(boardingDeadlineAtMs).toISOString(),
                        timestamp: new Date().toISOString()
                    });
                    socket.emit('notificationActionSuccess', {
                        action,
                        bookingId,
                        message: 'Você informou que chegou ao local de embarque'
                    });

                    scheduleBoardingWindowTimeout({
                        io,
                        bookingId,
                        customerId: booking.customerId,
                        driverId,
                        pickupAddress: booking.pickupLocation?.address || booking.pickup?.add || 'local de embarque',
                        deadlineAtMs: boardingDeadlineAtMs
                    });

                    break;

                case 'cancel_ride':
                    // Motorista cancelou a corrida
                    logStructured('warn', 'Motorista cancelou a corrida via notificação', {
                        service: 'server',
                        driverId,
                        bookingId,
                        action: 'cancel_ride',
                        eventType: 'notificationAction'
                    });

                    // Liberar lock do motorista
                    clearBoardingWindowTimeout(bookingId);
                    clearTripIntegrityConfirmationTimeout(bookingId);
                    await redis.set(`driver_soft_ban:${driverId}`, String(Date.now()), 'EX', 300);
                    await driverLockManager.releaseLock(driverId);

                    // Atualizar status da corrida
                    booking.status = 'CANCELED';
                    booking.canceledBy = 'driver';
                    booking.canceledAt = Date.now();
                    await redis.hset('bookings:active', bookingId, JSON.stringify(booking));
                    await redis.del(`trip_integrity:${bookingId}`);

                    // Notificar passageiro
                    if (booking.customerId && io) {
                        io.to(`customer_${booking.customerId}`).emit('rideCanceled', {
                            bookingId,
                            driverId,
                            reason: 'Motorista cancelou a corrida',
                            message: 'Motorista cancelou a corrida. Procurando novo motorista...',
                            timestamp: new Date().toISOString()
                        });

                        // Reiniciar busca de motorista
                        // TODO: Implementar lógica de reiniciar busca
                    }

                    // Notificar motorista (confirmação)
                    socket.emit('notificationActionSuccess', {
                        action,
                        bookingId,
                        message: 'Corrida cancelada com sucesso'
                    });

                    break;

                default:
                    socket.emit('notificationActionError', { error: 'Ação não reconhecida' });
                    return;
            }

            logStructured('info', 'Ação processada com sucesso', {
                service: 'server',
                action,
                bookingId,
                eventType: 'notificationAction'
            });

        } catch (error) {
            logStructured('error', 'Erro ao processar ação de notificação', {
                service: 'server',
                action,
                bookingId,
                error: error.message,
                stack: error.stack,
                eventType: 'notificationAction'
            });
            socket.emit('notificationActionError', { error: 'Erro ao processar ação: ' + error.message });
        }
    });

    // ==================== NOVOS EVENTOS - GERENCIAMENTO DE STATUS DO DRIVER ====================

    const enforceDailyKYCForOnline = async (driverId) => {
        const requiresDailyKYC = process.env.KYC_DAILY_VERIFICATION_REQUIRED === 'true';
        if (!requiresDailyKYC) {
            return { allowed: true };
        }

        const verificationStatus = await integratedKYCService.hasValidVerification(driverId, 24);

        if (!verificationStatus.hasValid) {
            return {
                allowed: false,
                reason: verificationStatus.reason || 'Verificação KYC expirada',
                code: 'kycRequired'
            };
        }

        return { allowed: true };
    };

    // Definir status do driver
    socket.on('setDriverStatus', async (data) => {
        try {
            if (process.env.DEBUG_DRIVER_STATUS === 'true') {
                logStructured('debug', 'Status do driver atualizado', {
                    service: 'server',
                    userId: socket.userId,
                    userType: socket.userType,
                    socketId: socket.id,
                    isOnline: data?.isOnline,
                    eventType: 'setDriverStatus'
                });
            }

            const driverId = socket.userId || data?.driverId;
            const {
                status,
                isOnline,
                lat: statusLat,
                lng: statusLng,
                heading: statusHeading,
                speed: statusSpeed
            } = data || {};

            recordRealtimeMetricSafe('set_driver_status', 'attempt');

            const emitDriverStatusError = (payload = {}, metricResult) => {
                const normalizedCode = String(metricResult || payload?.code || payload?.reason || payload?.error || 'unknown')
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_]+/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_+|_+$/g, '');
                const metricLabel = normalizedCode ? `error_${normalizedCode}` : 'error_unknown';
                recordRealtimeMetricSafe('set_driver_status', metricLabel);
                socket.emit('driverStatusError', payload);
            };

            if (!driverId || socket.userType !== 'driver') {
                logStructured('warn', 'Tentativa de atualizar status por não-motorista', {
                    service: 'websocket',
                    operation: 'setDriverStatus',
                    driverId: driverId,
                    userType: socket.userType,
                    socketId: socket.id
                });
                emitDriverStatusError({ error: 'Apenas motoristas podem atualizar status' }, 'non_driver');
                return;
            }

            // Validar status
            const validStatuses = ['online', 'offline', 'busy', 'available'];
            if (status && !validStatuses.includes(status)) {
                logStructured('warn', 'Status inválido recebido', {
                    service: 'websocket',
                    operation: 'setDriverStatus',
                    driverId: driverId,
                    status: status,
                    validStatuses: validStatuses
                });
                emitDriverStatusError({ error: 'Status inválido' }, 'invalid_status');
                return;
            }

            // ✅ FASE 0: Verificar se motorista está bloqueado por KYC
            const newIsOnline = isOnline !== undefined ? isOnline : (status === 'online' || status === 'available');
            if (newIsOnline) {
                try {
                    const kycDriverStatusService = require('./services/kyc-driver-status-service');
                    const canWork = await kycDriverStatusService.canDriverWork(driverId);
                    if (!canWork) {
                        const blockStatus = await kycDriverStatusService.isDriverBlocked(driverId);
                        logStructured('warn', 'Motorista bloqueado por KYC tentou ficar online', {
                            service: 'websocket',
                            operation: 'setDriverStatus',
                            driverId: driverId,
                            reason: blockStatus.reason || 'KYC não aprovado',
                            socketId: socket.id
                        });
                        emitDriverStatusError({
                            error: 'Sua conta está bloqueada. Entre em contato com o suporte.',
                            reason: blockStatus.reason || 'KYC não aprovado',
                            blocked: true
                        }, 'kyc_blocked');
                        return;
                    }

                    const dailyKYC = await enforceDailyKYCForOnline(driverId);
                    if (!dailyKYC.allowed) {
                        logStructured('warn', 'Motorista sem verificação KYC diária tentou ficar online', {
                            service: 'websocket',
                            operation: 'setDriverStatus',
                            driverId: driverId,
                            reason: dailyKYC.reason,
                            socketId: socket.id
                        });
                        emitDriverStatusError({
                            error: 'Verificação facial diária necessária para ficar online.',
                            reason: dailyKYC.reason,
                            code: dailyKYC.code,
                            kycRequired: true
                        }, dailyKYC.code || 'kyc_required');
                        return;
                    }
                } catch (kycError) {
                    // Falha de validação KYC deve impedir online para segurança
                    logStructured('warn', 'Erro ao verificar KYC (bloqueando online)', {
                        service: 'websocket',
                        operation: 'setDriverStatus',
                        driverId: driverId,
                        error: kycError.message
                    });
                    emitDriverStatusError({
                        error: 'Não foi possível validar KYC agora. Tente novamente.',
                        reason: kycError.message,
                        code: 'kycCheckFailed',
                        kycRequired: true
                    }, 'kyc_check_failed');
                    return;
                }
            }

            // ✅ FASE 1: LOCK DE VEÍCULO

            if (newIsOnline) {
                // FICAR ONLINE: Adquirir lock do veículo
                logStructured('info', 'Tentando adquirir lock de veículo para driver', {
                    service: 'server',
                    driverId,
                    action: 'acquire_vehicle_lock',
                    eventType: 'setDriverStatus'
                });

                try {
                    // Buscar veículo ativo do motorista
                    const db = firebaseConfig?.getRealtimeDB?.();
                    if (!db) {
                        throw new Error('Firebase Database não disponível');
                    }

                    // Buscar veículo ativo em user_vehicles
                    const userVehiclesRef = db.ref(`user_vehicles/${driverId}`);
                    const userVehiclesSnapshot = await userVehiclesRef.once('value');

                    let activeVehicle = null;
                    let vehiclePlate = null;

                    if (userVehiclesSnapshot.exists()) {
                        userVehiclesSnapshot.forEach((childSnapshot) => {
                            const userVehicle = childSnapshot.val();
                            if (userVehicle.isActive === true &&
                                (userVehicle.status === 'approved' || userVehicle.approved === true)) {
                                activeVehicle = userVehicle;
                                return true; // Parar iteração
                            }
                        });
                    }

                    // Se não encontrou em user_vehicles, buscar no perfil do usuário
                    if (!activeVehicle) {
                        const userRef = db.ref(`users/${driverId}`);
                        const userSnapshot = await userRef.once('value');
                        const userData = userSnapshot.val();

                        if (userData && (userData.carPlate || userData.vehicleNumber || userData.vehiclePlate)) {
                            vehiclePlate = userData.carPlate || userData.vehicleNumber || userData.vehiclePlate;
                        }
                    } else {
                        // Buscar placa do veículo
                        const vehicleRef = db.ref(`vehicles/${activeVehicle.vehicleId}`);
                        const vehicleSnapshot = await vehicleRef.once('value');

                        if (vehicleSnapshot.exists()) {
                            const vehicleData = vehicleSnapshot.val();
                            vehiclePlate = vehicleData.plate || vehicleData.vehicleNumber || vehicleData.vehiclePlate;
                        }
                    }

                    if (!vehiclePlate) {
                        logStructured('warn', 'Motorista sem veículo ativo tentou ficar online', {
                            service: 'websocket',
                            operation: 'setDriverStatus',
                            driverId: driverId
                        });
                        emitDriverStatusError({
                            error: 'Você precisa ter um veículo ativo cadastrado para ficar online'
                        }, 'vehicle_required');
                        return;
                    }

                    // Tentar adquirir lock
                    const lockResult = await vehicleLockManager.acquireLock(vehiclePlate, driverId);

                    if (!lockResult.success) {
                        logStructured('warn', `Lock de veículo ${vehiclePlate} não adquirido`, {
                            service: 'setDriverStatus',
                            vehiclePlate,
                            driverId,
                            error: lockResult.error
                        });
                        emitDriverStatusError({
                            error: lockResult.error || 'Este veículo já está sendo utilizado por outro motorista no momento.'
                        }, 'vehicle_lock_failed');
                        return;
                    }

                    // Armazenar placa no socket para liberar depois
                    socket.vehiclePlate = vehiclePlate;
                    logStructured('info', 'Lock de veículo adquirido', {
                        service: 'server',
                        driverId,
                        vehiclePlate,
                        eventType: 'setDriverStatus'
                    });

                } catch (lockError) {
                    logStructured('error', 'Erro ao adquirir lock de veículo', {
                        service: 'server',
                        driverId,
                        error: lockError.message,
                        stack: lockError.stack,
                        eventType: 'setDriverStatus'
                    });
                    emitDriverStatusError({
                        error: 'Erro ao verificar disponibilidade do veículo. Tente novamente.'
                    }, 'vehicle_lock_error');
                    return;
                }
            } else {
                // FICAR OFFLINE: Liberar lock do veículo
                if (socket.vehiclePlate) {
                    logStructured('info', 'Liberando lock de veículo', {
                        service: 'server',
                        driverId,
                        vehiclePlate: socket.vehiclePlate,
                        action: 'release_vehicle_lock',
                        eventType: 'setDriverStatus'
                    });
                    try {
                        await vehicleLockManager.releaseLock(socket.vehiclePlate, driverId);
                        delete socket.vehiclePlate;
                        logStructured('info', 'Lock de veículo liberado com sucesso', {
                            service: 'server',
                            driverId,
                            eventType: 'setDriverStatus'
                        });
                    } catch (releaseError) {
                        logStructured('error', 'Erro ao liberar lock de veículo', {
                            service: 'server',
                            driverId,
                            error: releaseError.message,
                            stack: releaseError.stack,
                            eventType: 'setDriverStatus'
                        });
                        // Não bloquear o processo de ficar offline por erro no lock
                    }
                }
            }

            // Buscar última localização conhecida
            const redis = redisPool.getConnection();

            // Garantir conexão Redis
            if (redis.status !== 'ready' && redis.status !== 'connect') {
                try {
                    await redis.connect();
                } catch (connectError) {
                    if (!connectError.message.includes('already connecting') &&
                        !connectError.message.includes('already connected')) {
                        throw connectError;
                    }
                }
            }

            const driverData = await redis.hgetall(`driver:${driverId}`);
            const resolvedIsOnline = isOnline !== undefined ? isOnline : (status === 'online' || status === 'available');

            if (resolvedIsOnline) {
                clearPendingDriverDisconnectCleanup(driverId, 'set_driver_status_online');
            }

            const payloadLat = Number.parseFloat(statusLat);
            const payloadLng = Number.parseFloat(statusLng);
            const payloadHeading = Number.parseFloat(statusHeading);
            const payloadSpeed = Number.parseFloat(statusSpeed);
            const hasPayloadLocation = Number.isFinite(payloadLat) && Number.isFinite(payloadLng);

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_DRIVER_STATUS === 'true') {
                logStructured('debug', 'Dados do motorista no Redis', {
                    service: 'server',
                    driverId,
                    hasData: !!driverData && Object.keys(driverData).length > 0,
                    hasLocation: !!(driverData?.lat && driverData?.lng),
                    eventType: 'setDriverStatus'
                });
            }

            const persistedLat = Number.parseFloat(driverData?.lat);
            const persistedLng = Number.parseFloat(driverData?.lng);
            const persistedHeading = Number.parseFloat(driverData?.heading || 0);
            const persistedSpeed = Number.parseFloat(driverData?.speed || 0);
            const hasPersistedLocation = Number.isFinite(persistedLat) && Number.isFinite(persistedLng);

            let locationToPersist = null;
            let locationSource = null;

            if (hasPersistedLocation) {
                locationToPersist = {
                    lat: persistedLat,
                    lng: persistedLng,
                    heading: Number.isFinite(payloadHeading) ? payloadHeading : persistedHeading,
                    speed: Number.isFinite(payloadSpeed) ? payloadSpeed : persistedSpeed
                };
                locationSource = 'redis_state';
            } else if (resolvedIsOnline && hasPayloadLocation) {
                locationToPersist = {
                    lat: payloadLat,
                    lng: payloadLng,
                    heading: Number.isFinite(payloadHeading) ? payloadHeading : 0,
                    speed: Number.isFinite(payloadSpeed) ? payloadSpeed : 0
                };
                locationSource = 'payload';
            }

            if (locationToPersist) {
                // Atualizar localização com novo status
                if (process.env.NODE_ENV === 'development' || process.env.DEBUG_DRIVER_STATUS === 'true') {
                    logStructured('debug', 'Salvando localização com status', {
                        service: 'websocket',
                        operation: 'setDriverStatus',
                        driverId,
                        isOnline: resolvedIsOnline,
                        lat: locationToPersist.lat,
                        lng: locationToPersist.lng,
                        source: locationSource
                    });
                }

                await saveDriverLocation(
                    driverId,
                    locationToPersist.lat,
                    locationToPersist.lng,
                    locationToPersist.heading,
                    locationToPersist.speed,
                    Date.now(),
                    resolvedIsOnline
                );

                logStructured('info', 'Localização salva para driver com status', {
                    service: 'websocket',
                    operation: 'setDriverStatus',
                    driverId,
                    status: resolvedIsOnline ? 'ONLINE' : 'OFFLINE'
                });

                if (resolvedIsOnline) {
                    const eligibleDriverGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
                    let onlineReady = false;
                    let activeGeoScore = null;
                    let eligibleGeoScore = null;

                    for (let attempt = 0; attempt < 3; attempt += 1) {
                        [activeGeoScore, eligibleGeoScore] = await Promise.all([
                            redis.zscore('driver_locations', driverId),
                            redis.zscore(eligibleDriverGeoKey, driverId)
                        ]);

                        if (activeGeoScore !== null) {
                            onlineReady = true;
                            break;
                        }

                        await sleepMs(90 * (attempt + 1));
                    }

                    if (!onlineReady) {
                        if (socket.vehiclePlate) {
                            try {
                                await vehicleLockManager.releaseLock(socket.vehiclePlate, driverId);
                            } catch (_releaseError) {
                                // best-effort
                            }
                            delete socket.vehiclePlate;
                        }

                        const nowIso = new Date().toISOString();
                        await redis.hset(`driver:${driverId}`, {
                            vehiclePlate: '',
                            vehicleLockValidated: 'false',
                            vehicleLockValidatedAt: nowIso,
                            isOnline: 'false',
                            updatedAt: nowIso
                        });

                        emitDriverStatusError({
                            error: 'Não foi possível finalizar o modo online agora. Tente novamente.',
                            code: 'ONLINE_NOT_READY',
                            onlineRedis: false,
                            eligibleGeo: eligibleGeoScore !== null,
                            retryAfterSec: 1
                        }, 'online_not_ready');
                        return;
                    }
                }
            } else if (resolvedIsOnline) {
                logStructured('warn', 'Motorista não tem localização salva no Redis. Aguardando updateLocation', {
                    service: 'websocket',
                    operation: 'setDriverStatus',
                    driverId
                });

                if (socket.vehiclePlate) {
                    try {
                        await vehicleLockManager.releaseLock(socket.vehiclePlate, driverId);
                    } catch (_releaseError) {
                        // best-effort
                    }
                    delete socket.vehiclePlate;
                }

                const nowIso = new Date().toISOString();
                await redis.hset(`driver:${driverId}`, {
                    vehiclePlate: '',
                    vehicleLockValidated: 'false',
                    vehicleLockValidatedAt: nowIso,
                    isOnline: 'false',
                    updatedAt: nowIso
                });

                emitDriverStatusError({
                    error: 'Localização inicial necessária para ativar o modo online.',
                    message: 'Envie uma localização válida e tente novamente.',
                    code: 'LOCATION_REQUIRED',
                    retryAfterSec: 1
                }, 'location_required');
                return;
            }

            // Persistir contexto de lock para garantir que updateLocation não coloque online
            // motoristas sem veículo válido/lock ativo.
            try {
                const nowIso = new Date().toISOString();
                const persistedVehiclePlate = resolvedIsOnline
                    ? (socket.vehiclePlate || driverData?.vehiclePlate || '')
                    : '';
                const hasValidatedLock = resolvedIsOnline && Boolean(persistedVehiclePlate);

                await redis.hset(`driver:${driverId}`, {
                    vehiclePlate: persistedVehiclePlate,
                    vehicleLockValidated: hasValidatedLock ? 'true' : 'false',
                    vehicleLockValidatedAt: nowIso,
                    updatedAt: nowIso
                });
                setCachedDriverState(driverId, {
                    ...(driverData || {}),
                    vehiclePlate: persistedVehiclePlate,
                    vehicleLockValidated: hasValidatedLock ? 'true' : 'false',
                    vehicleLockValidatedAt: nowIso,
                    updatedAt: nowIso
                });
            } catch (driverLockStateError) {
                logStructured('warn', 'Falha ao persistir estado de lock do motorista', {
                    service: 'websocket',
                    operation: 'setDriverStatus',
                    driverId,
                    error: driverLockStateError.message
                });
            }

            // Emitir confirmação
            socket.emit('driverStatusUpdated', {
                success: true,
                driverId,
                status: status || (resolvedIsOnline ? 'online' : 'offline'),
                isOnline: resolvedIsOnline,
                ready: true,
                onlineRedis: resolvedIsOnline ? true : false,
                message: 'Status atualizado com sucesso'
            });
            recordRealtimeMetricSafe('set_driver_status', resolvedIsOnline ? 'success_online' : 'success_offline');

            if (process.env.DEBUG_DRIVER_STATUS === 'true') {
                logStructured('debug', 'Status do driver atualizado', {
                    service: 'websocket',
                    operation: 'setDriverStatus',
                    driverId,
                    status: status || (resolvedIsOnline ? 'online' : 'offline')
                });
            }

        } catch (error) {
            logStructured('error', 'Erro ao atualizar status do driver', {
                service: 'websocket',
                operation: 'setDriverStatus',
                driverId: socket.userId || socket.id,
                error: error.message
            });
            recordRealtimeMetricSafe('set_driver_status', 'error_internal_server_error');
            socket.emit('driverStatusError', { error: 'Erro interno do servidor' });
        }
    });

    // 9. UpdateDriverLocation (legado, desabilitado por padrão)
    if (ENABLE_LEGACY_UPDATE_DRIVER_LOCATION_EVENT) {
    socket.on('updateDriverLocation', async (data) => {
        try {
            // ✅ NOVO: Rate Limiting (leve para não afetar GPS)
            const driverId = socket.userId || data.driverId || socket.id;
            const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'updateDriverLocation');

            if (!rateLimitCheck.allowed) {
                // Para GPS, apenas logar mas não bloquear (fail-open para não afetar rastreamento)
                logStructured('warn', `updateDriverLocation excedido para ${driverId}, mas permitindo (GPS crítico)`, {
                    service: 'RateLimiter',
                    driverId,
                    action: 'updateDriverLocation'
                });
                // Continuar processamento (GPS é crítico)
            }

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Localização do driver atualizada', {
                    service: 'server',
                    driverId: socket.userId || socket.id,
                    location: { lat: data?.lat, lng: data?.lng },
                    eventType: 'updateLocation'
                });
            }

            const { lat, lng, heading, speed, timestamp } = data;

            if (!driverId || !lat || !lng) {
                socket.emit('locationError', { error: 'Dados de localização incompletos' });
                return;
            }

            await saveDriverLocation(driverId, lat, lng, heading, speed, timestamp);

            // Emitir confirmação
            socket.emit('locationUpdated', {
                success: true,
                driverId,
                message: 'Localização atualizada com sucesso',
                data: {
                    driverId,
                    location: { lat, lng },
                    heading: heading || 0,
                    speed: speed || 0,
                    timestamp: timestamp || Date.now()
                }
            });

            // Notificar outros clientes sobre mudança de localização
            socket.broadcast.emit('driverLocationUpdated', {
                driverId,
                location: { lat, lng },
                heading,
                speed,
                timestamp: timestamp || Date.now()
            });

            logStructured('info', 'Localização do driver atualizada', {
                service: 'server',
                driverId,
                location: { lat, lng },
                eventType: 'updateLocation'
            });

        } catch (error) {
            logStructured('error', 'Erro ao atualizar localização do driver', {
                service: 'websocket',
                operation: 'updateDriverLocation',
                driverId: socket.userId,
                error: error.message,
                stack: error.stack
            });
            socket.emit('locationError', { error: 'Erro interno do servidor' });
        }
    });
    }

    // 10. DriverHeartbeat (crítico - heartbeat GPS)
    socket.on('driverHeartbeat', async (data) => {
        const heartbeatStartedAt = Date.now();
        try {
            const driverId = socket.userId || data.uid || data.driverId;
            const { lat, lng, tripStatus, isInTrip } = data;
            const latNum = Number(lat);
            const lngNum = Number(lng);

            if (!driverId || !Number.isFinite(latNum) || !Number.isFinite(lngNum) || socket.userType !== 'driver') {
                return; // Dados inválidos, ignorar silenciosamente
            }

            socket.lastHeartbeat = Date.now();
            socket.lastDriverHeartbeatAt = socket.lastHeartbeat;

            // ✅ CAOS SCENARIO: Registrar Heartbeat para calcular tempo offline/resiliência de billing
            try {
                const heartbeatService = require('./services/heartbeat-service');
                await heartbeatService.ping(driverId);
            } catch (hbErr) {
                logStructured('warn', 'Falha ao processar novo heartbeat service', { driverId, error: hbErr.message });
            }

            // ✅ Heartbeat: apenas renovar TTL usando última localização conhecida
            const isInTripState = isInTrip || tripStatus === 'started' || tripStatus === 'accepted';
            const redis = redisPool.getConnection();
            const eligibleDriverGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

            // Aplicar validação KYC diária na transição offline -> online via updateLocation
            const existingDriverState = await getDriverStateHot(redis, driverId);
            const wasOnline = existingDriverState?.isOnline === 'true';
            if (!wasOnline) {
                try {
                    const dailyKYC = await enforceDailyKYCForOnline(driverId);
                    if (!dailyKYC.allowed) {
                        socket.emit('driverStatusError', {
                            error: 'Verificação facial diária necessária para ficar online.',
                            reason: dailyKYC.reason,
                            code: dailyKYC.code,
                            kycRequired: true
                        });
                        return;
                    }
                } catch (kycError) {
                    socket.emit('driverStatusError', {
                        error: 'Não foi possível validar KYC agora. Tente novamente.',
                        reason: kycError.message,
                        code: 'kycCheckFailed',
                        kycRequired: true
                    });
                    return;
                }
            }
            if (existingDriverState && existingDriverState.id) {
                // ✅ Motorista existe: apenas renovar TTL e garantir que está no GEO
                // TTL alinhado com saveDriverLocation: 60s em viagem, 120s online
                // Heartbeat a cada 30s garante que nunca expire se motorista estiver online
                const { getTTL } = require('./config/redis-ttl-config');
                const ttl = isInTripState
                    ? getTTL('DRIVER_LOCATION', 'IN_TRIP')
                    : getTTL('DRIVER_LOCATION', 'ONLINE');
                const geoLng = Number.parseFloat(existingDriverState.lng || lngNum);
                const geoLat = Number.parseFloat(existingDriverState.lat || latNum);
                const heartbeatTs = Date.now();
                const nowIso = new Date().toISOString();
                const heartbeatPipeline = redis.pipeline();
                heartbeatPipeline.expire(`driver:${driverId}`, ttl);
                heartbeatPipeline.hset(`driver:${driverId}`, {
                    lastSeen: nowIso,
                    lastHeartbeatAt: nowIso,
                    lastUpdate: String(heartbeatTs),
                    timestamp: String(heartbeatTs),
                    lat: String(geoLat),
                    lng: String(geoLng)
                });
                heartbeatPipeline.geoadd('driver_locations', geoLng, geoLat, driverId);
                heartbeatPipeline.zrem('driver_offline_locations', driverId);
                if (existingDriverState.dispatchEligible === 'true') {
                    heartbeatPipeline.geoadd(eligibleDriverGeoKey, geoLng, geoLat, driverId);
                } else {
                    heartbeatPipeline.zrem(eligibleDriverGeoKey, driverId);
                }
                const heartbeatPipelineResult = await heartbeatPipeline.exec();
                const heartbeatPipelineError = heartbeatPipelineResult?.find(([cmdErr]) => cmdErr)?.[0];
                if (heartbeatPipelineError) {
                    throw heartbeatPipelineError;
                }
                runtimeMetrics.recordRedisHotpathOp('driver_heartbeat', 'pipeline_ops', 5);

                setCachedDriverState(driverId, {
                    ...existingDriverState,
                    lat: String(geoLat),
                    lng: String(geoLng),
                    isOnline: 'true',
                    status: isInTripState ? 'IN_TRIP' : (existingDriverState.status || 'AVAILABLE'),
                    lastSeen: nowIso,
                    lastHeartbeatAt: nowIso,
                    lastUpdate: String(heartbeatTs),
                    timestamp: String(heartbeatTs)
                });
                runtimeMetrics.recordRealtimeUpdate('driverHeartbeat', 'processed');

                // ✅ HEARTBEAT: Renovar lock de veículo (se motorista estiver online)
                if (socket.vehiclePlate) {
                    try {
                        await vehicleLockManager.renewLock(socket.vehiclePlate, driverId);
                        logStructured('debug', 'Lock de veículo renovado', {
                            service: 'server',
                            driverId,
                            vehiclePlate: socket.vehiclePlate,
                            eventType: 'driverHeartbeat'
                        });
                    } catch (lockError) {
                        logStructured('error', 'Erro ao renovar lock de veículo', {
                            service: 'server',
                            driverId,
                            vehiclePlate: socket.vehiclePlate,
                            error: lockError.message,
                            stack: lockError.stack,
                            eventType: 'driverHeartbeat'
                        });
                        // Não bloquear heartbeat por erro no lock
                    }
                }
            } else {
                // Se não existe, criar com dados do heartbeat
                await saveDriverLocation(driverId, latNum, lngNum, 0, 0, Date.now(), true, isInTripState);
                runtimeMetrics.recordRealtimeUpdate('driverHeartbeat', 'processed');
            }

            runtimeMetrics.recordHotpathLatency('driverHeartbeat', (Date.now() - heartbeatStartedAt) / 1000, true);

        } catch (error) {
            runtimeMetrics.recordRealtimeUpdate('driverHeartbeat', 'failed');
            runtimeMetrics.recordHotpathLatency('driverHeartbeat', (Date.now() - heartbeatStartedAt) / 1000, false);
            // Ignorar erros de heartbeat silenciosamente (não é crítico)
            logStructured('debug', `Erro ao processar heartbeat`, {
                service: 'driverHeartbeat',
                error: error.message
            });
        }
    });

    // 11. UpdateLocation (crítico - GPS genérico)
    socket.on('updateLocation', async (data) => {
        const updateStartedAt = Date.now();
        try {
            // Obter driverId do socket (autenticado) ou dos dados
            const driverId = socket.userId || data.uid || data.driverId;
            const { lat, lng, tripStatus, isInTrip } = data;
            const latNum = Number(lat);
            const lngNum = Number(lng);

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'updateLocation recebido do cliente', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    socketUserId: socket.userId,
                    dataUid: data.uid,
                    dataDriverId: data.driverId,
                    userType: socket.userType,
                    lat: latNum,
                    lng: lngNum,
                    tripStatus,
                    isInTrip
                });
            }

            if (!driverId || !Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
                logStructured('error', 'Dados incompletos para updateLocation', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    lat: latNum,
                    lng: lngNum,
                    socketUserId: socket.userId,
                    dataUid: data.uid,
                    dataDriverId: data.driverId
                });
                runtimeMetrics.recordRealtimeUpdate('updateLocation', 'invalid');
                socket.emit('error', { message: 'Dados de localização incompletos ou motorista não autenticado' });
                return;
            }

            // Verificar se é motorista
            if (socket.userType !== 'driver') {
                logStructured('error', 'Usuário não é motorista tentando updateLocation', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    userType: socket.userType,
                    driverId,
                    socketId: socket.id
                });
                runtimeMetrics.recordRealtimeUpdate('updateLocation', 'rejected_non_driver');
                socket.emit('error', { message: 'Apenas motoristas podem atualizar localização' });
                return;
            }

            clearPendingDriverDisconnectCleanup(driverId, 'update_location_received');

            // ✅ OTIMIZAÇÃO 4: TTL diferenciado por estado
            // - Em viagem: 30 segundos (dados críticos, precisa ser muito atualizado)
            // - Online disponível: 90 segundos (balanceia responsividade e tolerância a falhas)
            const isInTripState = isInTrip || tripStatus === 'started' || tripStatus === 'accepted';
            const redis = redisPool.getConnection();

            // Debounce/coalescing para reduzir spam de updates sem mudar semântica útil.
            const updateGate = shouldSkipRealtimeUpdate(driverId, {
                lat: latNum,
                lng: lngNum,
                timestamp: Date.now(),
                isInTrip: isInTripState,
                tripStatus: tripStatus || '',
                isOnline: true
            });
            if (updateGate.skip) {
                runtimeMetrics.recordRealtimeUpdate('updateLocation', updateGate.reason || 'coalesced');
                runtimeMetrics.recordHotpathLatency('updateLocation', (Date.now() - updateStartedAt) / 1000, true);
                socket.emit('locationUpdated', {
                    message: 'Localização atualizada',
                    location: { lat: latNum, lng: lngNum },
                    driverId,
                    coalesced: true
                });
                return;
            }

            // Rate limit cache local curto para cortar round-trips Redis em picos de GPS.
            if (shouldRunUpdateLocationRateLimit(driverId)) {
                const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'updateLocation');
                if (!rateLimitCheck.allowed) {
                    logStructured('warn', 'updateLocation excedido por rate limiter, mas permitindo (GPS crítico)', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        driverId,
                        limit: rateLimitCheck.limit
                    });
                }
                runtimeMetrics.recordRedisHotpathOp('updateLocation_rate_limit', 'checkRateLimit', 1);
            } else {
                runtimeMetrics.recordRealtimeUpdate('updateLocation_rate_limit', 'cache_hit');
            }

            // Aplicar validação KYC diária na transição offline -> online via updateLocation
            const existingDriverState = await getDriverStateHot(redis, driverId);
            const wasOnline = existingDriverState?.isOnline === 'true';
            if (!wasOnline) {
                try {
                    const dailyKYC = await enforceDailyKYCForOnline(driverId);
                    if (!dailyKYC.allowed) {
                        socket.emit('driverStatusError', {
                            error: 'Verificação facial diária necessária para ficar online.',
                            reason: dailyKYC.reason,
                            code: dailyKYC.code,
                            kycRequired: true
                        });
                        return;
                    }
                } catch (kycError) {
                    socket.emit('driverStatusError', {
                        error: 'Não foi possível validar KYC agora. Tente novamente.',
                        reason: kycError.message,
                        code: 'kycCheckFailed',
                        kycRequired: true
                    });
                    return;
                }
            }

            // Segurança operacional: updateLocation não pode tornar motorista online sem lock/veículo válido.
            const enforceVehicleLockOnUpdateLocation =
                String(process.env.ENFORCE_VEHICLE_LOCK_ON_UPDATE_LOCATION || 'true').toLowerCase() !== 'false';
            const hasVehicleContext =
                Boolean(socket.vehiclePlate) ||
                existingDriverState?.vehicleLockValidated === 'true' ||
                Boolean(existingDriverState?.vehiclePlate);

            if (enforceVehicleLockOnUpdateLocation && !isInTripState && !hasVehicleContext) {
                let lockRecovered = false;

                if (shouldAttemptVehicleLockRecovery(driverId)) {
                    try {
                        const lockRecovery = await tryRecoverVehicleLockContext({
                            driverId,
                            socket,
                            existingDriverState,
                            redis,
                            logStructured
                        });
                        lockRecovered = lockRecovery.recovered === true;
                    } catch (lockRecoveryError) {
                        logStructured('warn', 'Falha ao recuperar lock de veículo no updateLocation', {
                            service: 'websocket',
                            operation: 'updateLocation',
                            driverId,
                            error: lockRecoveryError.message,
                            eventType: 'updateLocation'
                        });
                    }
                }

                if (!lockRecovered) {
                    logStructured('warn', 'updateLocation bloqueado: motorista sem lock de veículo validado', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        driverId,
                        eventType: 'updateLocation'
                    });
                    socket.emit('driverStatusError', {
                        error: 'Ative o modo online antes de compartilhar localização.',
                        message: 'Você precisa ativar seu status com veículo válido para ficar disponível.',
                        code: 'VEHICLE_LOCK_REQUIRED'
                    });
                    return;
                }
            }

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Salvando localização do driver no Redis', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    lat: latNum,
                    lng: lngNum,
                    isInTrip: isInTripState,
                    tripStatus: tripStatus,
                    isOnline: true
                });
            }

            await saveDriverLocation(driverId, latNum, lngNum, 0, 0, Date.now(), true, isInTripState, existingDriverState);
            runtimeMetrics.recordRealtimeUpdate('updateLocation', 'processed');
            markRealtimeUpdateProcessed(driverId, {
                lat: latNum,
                lng: lngNum,
                timestamp: Date.now(),
                isInTrip: isInTripState,
                tripStatus: tripStatus || '',
                isOnline: true
            });

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                // Verificação de GEO é custosa, manter apenas em modo debug.
                const isInGeo = await redis.zscore('driver_locations', driverId);
                logStructured('debug', 'Verificação pós-salvamento de localização', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    isInGeo: isInGeo !== null,
                    geoScore: isInGeo
                });
            }

            // ✅ NOVO: Se motorista está em uma corrida ativa, enviar localização para o passageiro
            if (isInTripState) {
                try {
                    // O(1): resolver corrida ativa por motorista via índice dedicado.
                    // Fallback mínimo para compatibilidade com dados legados sem varredura global.
                    const activeTrip = await resolveActiveTripForDriver(redis, driverId);
                    let activeBookingId = activeTrip?.tripId || existingDriverState?.activeTripId || null;
                    let customerId = activeTrip?.customerId || null;

                    if (activeBookingId && !customerId) {
                        const activeBookingData = await redis.hgetall(`booking:${activeBookingId}`);
                        customerId = activeBookingData?.customerId || activeBookingData?.customer || null;
                    }

                    if (activeBookingId && customerId) {
                        io.to(`customer_${customerId}`).emit('driverLocation', {
                            bookingId: activeBookingId,
                            driverId,
                            location: {
                                lat: parseFloat(latNum),
                                lng: parseFloat(lngNum),
                                heading: 0,
                                speed: 0,
                                timestamp: Date.now()
                            }
                        });
                        if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                            logStructured('debug', 'Localização do motorista enviada para passageiro', {
                                service: 'websocket',
                                operation: 'updateLocation',
                                driverId,
                                customerId,
                                bookingId: activeBookingId
                            });
                        }

                        if (TRIP_INTEGRITY_ENABLED) {
                            try {
                                await registerTripIntegrityLocationUpdate({
                                    io,
                                    redis,
                                    bookingId: activeBookingId,
                                    driverId,
                                    customerId,
                                    driverLocation: {
                                        lat: latNum,
                                        lng: lngNum,
                                        timestamp: Date.now()
                                    }
                                });
                            } catch (tripIntegrityError) {
                                logStructured('warn', 'Falha ao atualizar tripIntegrity com localização do motorista', {
                                    service: 'trip-integrity',
                                    bookingId: activeBookingId,
                                    driverId,
                                    customerId,
                                    error: tripIntegrityError.message
                                });
                            }
                        }
                    }
                } catch (locationError) {
                    logStructured('warn', 'Erro ao buscar booking ativo para enviar localização', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        driverId,
                        error: locationError.message
                    });
                }
            }

            // Emitir confirmação
            socket.emit('locationUpdated', {
                message: 'Localização atualizada',
                location: { lat: latNum, lng: lngNum },
                driverId: driverId
            });

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Localização do driver salva no Redis', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    lat: latNum,
                    lng: lngNum,
                    status: isInTripState ? 'em viagem' : 'online'
                });
            }
            runtimeMetrics.recordHotpathLatency('updateLocation', (Date.now() - updateStartedAt) / 1000, true);

        } catch (error) {
            runtimeMetrics.recordRealtimeUpdate('updateLocation', 'failed');
            runtimeMetrics.recordHotpathLatency('updateLocation', (Date.now() - updateStartedAt) / 1000, false);
            logStructured('error', 'Erro ao atualizar localização (updateLocation)', {
                service: 'websocket',
                operation: 'updateLocation',
                driverId: socket.userId,
                error: error.message,
                stack: error.stack
            });
            // Stack já está incluído no logStructured acima
            socket.emit('error', { message: 'Erro ao atualizar localização' });
        }
    });

    // Localização periódica do passageiro durante corrida ativa (tripulação)
    socket.on('passengerLocationUpdate', async (data = {}) => {
        const updateStartedAt = Date.now();
        try {
            if (!TRIP_INTEGRITY_ENABLED) {
                socket.emit('passengerLocationUpdated', {
                    success: true,
                    skipped: true,
                    reason: 'TRIP_INTEGRITY_DISABLED'
                });
                return;
            }

            const customerId = socket.userId || data.customerId || data.uid || null;
            const socketUserType = String(socket.userType || '').trim().toLowerCase();
            if (!customerId || (socketUserType !== 'customer' && socketUserType !== 'passenger')) {
                socket.emit('passengerLocationError', {
                    error: 'Apenas passageiros podem enviar localização de tripulação.',
                    code: 'PASSENGER_ONLY'
                });
                return;
            }

            const bookingIdRaw = data.bookingId || null;
            const lat = Number(data.lat);
            const lng = Number(data.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                socket.emit('passengerLocationError', {
                    error: 'Latitude e longitude válidas são obrigatórias.',
                    code: 'LOCATION_REQUIRED'
                });
                return;
            }

            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();

            let bookingId = bookingIdRaw;
            if (!bookingId) {
                bookingId = await redis.get(`customer_active_booking:${customerId}`);
            }

            if (!bookingId) {
                socket.emit('passengerLocationError', {
                    error: 'Nenhuma corrida ativa encontrada para este passageiro.',
                    code: 'ACTIVE_BOOKING_REQUIRED'
                });
                return;
            }

            const bookingData = await redis.hgetall(`booking:${bookingId}`);
            if (!bookingData || Object.keys(bookingData).length === 0) {
                socket.emit('passengerLocationError', {
                    error: 'Corrida não encontrada.',
                    code: 'BOOKING_NOT_FOUND'
                });
                return;
            }

            if (String(bookingData.customerId || '') !== String(customerId)) {
                socket.emit('passengerLocationError', {
                    error: 'Passageiro não autorizado para esta corrida.',
                    code: 'BOOKING_CUSTOMER_MISMATCH'
                });
                return;
            }

            const bookingState = await RideStateManager.getBookingState(redis, bookingId);
            const bookingStatus = String(bookingData.status || '').trim().toUpperCase();
            if (!isTripIntegrityMonitoringState(bookingState) && !isTripIntegrityMonitoringState(bookingStatus)) {
                socket.emit('passengerLocationUpdated', {
                    success: true,
                    bookingId,
                    skipped: true,
                    reason: 'BOOKING_NOT_IN_MONITORED_STATE'
                });
                return;
            }

            await registerTripIntegrityLocationUpdate({
                io,
                redis,
                bookingId,
                customerId,
                driverId: bookingData.driverId || null,
                passengerLocation: {
                    lat,
                    lng,
                    timestamp: data.timestamp || Date.now()
                }
            });

            recordRealtimeMetricSafe('trip_integrity', 'passenger_location_update');
            recordHotpathLatencySafe('passenger_location_update', Date.now() - updateStartedAt, true);

            socket.emit('passengerLocationUpdated', {
                success: true,
                bookingId,
                location: {
                    lat,
                    lng,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            recordRealtimeMetricSafe('trip_integrity', 'passenger_location_error');
            recordHotpathLatencySafe('passenger_location_update', Date.now() - updateStartedAt, false);
            logStructured('error', 'Erro ao processar passengerLocationUpdate', {
                service: 'trip-integrity',
                customerId: socket.userId || null,
                socketUserType: socket.userType || null,
                error: error.message
            });
            socket.emit('passengerLocationError', {
                error: 'Falha ao atualizar localização do passageiro.',
                code: 'PASSENGER_LOCATION_UPDATE_ERROR'
            });
        }
    });

    // Confirmação de embarque após alerta de divergência (tripulação)
    socket.on('confirmBoardingStatus', async (data = {}) => {
        try {
            if (!TRIP_INTEGRITY_ENABLED) {
                socket.emit('boardingStatusConfirmed', {
                    success: true,
                    skipped: true,
                    reason: 'TRIP_INTEGRITY_DISABLED'
                });
                return;
            }

            const customerId = socket.userId || data.customerId || data.uid || null;
            const socketUserType = String(socket.userType || '').trim().toLowerCase();
            if (!customerId || (socketUserType !== 'customer' && socketUserType !== 'passenger')) {
                socket.emit('boardingStatusError', {
                    error: 'Apenas passageiros podem confirmar embarque.',
                    code: 'PASSENGER_ONLY'
                });
                return;
            }

            const bookingId = data.bookingId || null;
            if (!bookingId) {
                socket.emit('boardingStatusError', {
                    error: 'ID da corrida é obrigatório.',
                    code: 'BOOKING_ID_REQUIRED'
                });
                return;
            }

            const boarded = Boolean(data.boarded);
            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();
            const bookingData = await redis.hgetall(`booking:${bookingId}`);

            if (!bookingData || Object.keys(bookingData).length === 0) {
                socket.emit('boardingStatusError', {
                    error: 'Corrida não encontrada.',
                    code: 'BOOKING_NOT_FOUND'
                });
                return;
            }

            if (String(bookingData.customerId || '') !== String(customerId)) {
                socket.emit('boardingStatusError', {
                    error: 'Passageiro não autorizado para esta corrida.',
                    code: 'BOOKING_CUSTOMER_MISMATCH'
                });
                return;
            }

            const integrityKey = `trip_integrity:${bookingId}`;
            const nowTs = Date.now();
            const driverId = bookingData.driverId || null;

            if (boarded) {
                clearTripIntegrityConfirmationTimeout(bookingId);
                await redis.hset(integrityKey, {
                    divergenceCount: '0',
                    alertOpenAt: '',
                    alertResolvedAt: String(nowTs),
                    boardingConfirmedAt: String(nowTs)
                });
                await redis.expire(integrityKey, 6 * 60 * 60);
                recordRealtimeMetricSafe('trip_integrity', 'boarding_confirmed');

                const payload = {
                    success: true,
                    bookingId,
                    boarded: true,
                    message: 'Confirmação de embarque recebida.',
                    timestamp: new Date().toISOString()
                };
                io.to(`customer_${customerId}`).emit('boardingStatusConfirmed', payload);
                if (driverId) {
                    io.to(`driver_${driverId}`).emit('boardingStatusConfirmed', payload);
                }
                return;
            }

            await redis.hset(integrityKey, {
                passengerReportedIssueAt: String(nowTs),
                alertOpenAt: String(nowTs)
            });
            await redis.expire(integrityKey, 6 * 60 * 60);
            recordRealtimeMetricSafe('trip_integrity', 'boarding_not_confirmed');

            await cancelRideForTripIntegrityViolation({
                io,
                redis,
                bookingId,
                driverId,
                customerId,
                reasonCode: 'PASSENGER_REPORTED_NOT_BOARDED',
                reasonMessage: 'Corrida cancelada após passageiro informar embarque incorreto.'
            });

            socket.emit('boardingStatusConfirmed', {
                success: true,
                bookingId,
                boarded: false,
                message: 'Corrida cancelada por inconsistência de embarque.',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logStructured('error', 'Erro ao processar confirmação de embarque (tripIntegrity)', {
                service: 'trip-integrity',
                customerId: socket.userId || null,
                error: error.message
            });
            recordRealtimeMetricSafe('trip_integrity', 'boarding_confirm_error');
            socket.emit('boardingStatusError', {
                error: 'Falha ao confirmar status de embarque.',
                code: 'BOARDING_CONFIRMATION_ERROR'
            });
        }
    });

    // ==================== NOVOS EVENTOS - BUSCA E MATCHING DE DRIVERS ====================

    // Buscar motoristas próximos
    socket.on('searchDrivers', async (data) => {
        try {
            // ✅ NOVO: Rate Limiting
            const userId = socket.userId || data.customerId || socket.id;
            const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'searchDrivers');

            if (!rateLimitCheck.allowed) {
                socket.emit('searchDriversError', {
                    error: 'Muitas requisições',
                    message: `Você excedeu o limite de ${rateLimitCheck.limit} buscas por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                    code: 'RATE_LIMIT_EXCEEDED',
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt
                });
                logStructured('warn', 'searchDrivers bloqueado por rate limit', {
                    service: 'server',
                    userId,
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt,
                    eventType: 'searchDrivers',
                    action: 'rate_limit_exceeded'
                });
                return;
            }

            logStructured('info', 'Busca de motoristas iniciada', {
                service: 'server',
                userId: socket.userId || socket.id,
                pickupLocation: data?.pickupLocation,
                destinationLocation: data?.destinationLocation,
                rideType: data?.rideType,
                eventType: 'searchDrivers'
            });

            const { pickupLocation, destinationLocation, rideType, estimatedFare, preferences, carType } = data;

            if (!pickupLocation) {
                socket.emit('driverSearchError', { error: 'Localização de origem obrigatória' });
                return;
            }

            const radiusFromPreferences = Number.parseFloat(preferences?.radiusKm || preferences?.searchRadiusKm || process.env.PAYMENT_AVAILABILITY_RADIUS_KM || '5');
            const availability = await findAvailableDriversForPickup(pickupLocation, {
                carType: carType || preferences?.carType || null,
                radiusKm: Number.isFinite(radiusFromPreferences) ? radiusFromPreferences : 5,
                limit: Number.parseInt(preferences?.limit || '10', 10)
            });

            if (!availability.success) {
                socket.emit('searchDriversError', {
                    error: 'Falha ao buscar motoristas disponíveis',
                    message: 'Não foi possível consultar disponibilidade no momento',
                    code: 'DRIVER_AVAILABILITY_FAILED'
                });
                return;
            }

            const drivers = availability.drivers || [];
            const estimatedWaitTime = drivers.length > 0
                ? Math.min(...drivers.map((driver) => driver.estimatedArrivalMin || 3))
                : null;

            const payload = {
                success: true,
                drivers,
                estimatedWaitTime,
                searchRadius: (availability.summary?.radiusKm || radiusFromPreferences) * 1000,
                fare: estimatedFare || null,
                message: drivers.length > 0
                    ? `${drivers.length} motoristas encontrados`
                    : 'Não há motoristas disponíveis no momento',
                summary: availability.summary || null
            };

            // Emitir resultado principal
            socket.emit('driversFound', payload);

            // Compatibilidade com listeners legados (desabilitado por padrão)
            if (ENABLE_LEGACY_NO_DRIVERS_FOUND_EVENT && drivers.length === 0) {
                socket.emit('noDriversFound', {
                    success: true,
                    message: payload.message,
                    searchRadius: payload.searchRadius
                });
            }

            logStructured('info', 'Motoristas encontrados para busca', {
                service: 'server',
                userId: socket.userId || socket.id,
                driversFound: drivers.length,
                eventType: 'searchDrivers'
            });

        } catch (error) {
            logStructured('error', 'Erro na busca de motoristas', {
                service: 'server',
                userId: socket.userId || socket.id,
                error: error.message,
                stack: error.stack,
                eventType: 'searchDrivers'
            });
            socket.emit('driverSearchError', { error: 'Erro interno do servidor' });
        }
    });

    // Cancelar busca de motoristas
    socket.on('cancelDriverSearch', async (data) => {
        try {
            logStructured('info', 'Busca de motoristas cancelada', {
                service: 'server',
                userId: socket.userId || socket.id,
                bookingId: data?.bookingId,
                reason: data?.reason,
                eventType: 'cancelDriverSearch'
            });

            const { bookingId, reason } = data;

            // Emitir confirmação
            socket.emit('driverSearchCancelled', {
                success: true,
                bookingId,
                reason: reason || 'Cancelado pelo usuário',
                message: 'Busca cancelada com sucesso'
            });

            logStructured('info', 'Busca de motoristas cancelada para corrida', {
                service: 'websocket',
                operation: 'cancelSearch',
                bookingId
            });

        } catch (error) {
            logStructured('error', 'Erro ao cancelar busca', {
                service: 'websocket',
                operation: 'cancelSearch',
                bookingId: data.bookingId,
                error: error.message,
                stack: error.stack
            });
            socket.emit('driverSearchError', { error: 'Erro interno do servidor' });
        }
    });

    // ==================== NOVOS EVENTOS - GERENCIAMENTO DE CORRIDAS ====================

    // Cancelar corrida (com reembolso automático PIX)
    // ==================== FASE 7: cancelRide - CANCELAMENTO DE CORRIDA ====================
    socket.on('cancelRide', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                const { bookingId, reason, cancellationFee } = data;
                clearBoardingWindowTimeout(bookingId);
                clearTripIntegrityConfirmationTimeout(bookingId);
                const userId = socket.userId || socket.id;

                logStructured('info', 'cancelRide iniciado', {
                    userId,
                    bookingId,
                    eventType: 'cancelRide'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting
                const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'cancelRide');

                if (!rateLimitCheck.allowed) {
                    socket.emit('rideCancellationError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        userId,
                        eventType: 'cancelRide',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Cancelamento de corrida recebido', {
                    userId,
                    bookingId,
                    eventType: 'cancelRide'
                });

                // ✅ GARANTIR conexão Redis antes de usar
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                if (!bookingId) {
                    socket.emit('rideCancellationError', { error: 'ID da corrida obrigatório' });
                    return;
                }

                // ✅ NOVO: Marcar corrida como cancelada no Firestore
                try {
                    const ridePersistenceService = require('./services/ride-persistence-service');
                    const cancelReason = reason || 'Cancelado pelo usuário';
                    await ridePersistenceService.markRideCancelled(bookingId, cancelReason);
                } catch (persistError) {
                    logStructured('error', 'Erro ao marcar corrida como cancelada no Firestore', {
                        bookingId,
                        eventType: 'cancelRide',
                        error: persistError.message
                    });
                    // Não bloquear cancelamento se persistência falhar
                }

                // 1. Buscar dados da corrida
                const bookingKey = `booking:${bookingId}`;
                const bookingData = await redis.hgetall(bookingKey);

                if (!bookingData || Object.keys(bookingData).length === 0) {
                    logStructured('error', 'Corrida não encontrada', {
                        bookingId,
                        eventType: 'cancelRide'
                    });
                    socket.emit('rideCancellationError', { error: 'Corrida não encontrada' });
                    return;
                }

                // 2. Parar busca gradual se ainda estiver em busca
                const currentState = await RideStateManager.getBookingState(redis, bookingId);
                if (currentState === RideStateManager.STATES.SEARCHING || currentState === RideStateManager.STATES.PENDING) {
                    await gradualExpander.stopSearch(bookingId);
                    logStructured('info', 'Busca parada para corrida cancelada', {
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // 3. Liberar locks de todos os motoristas notificados
                const notifiedDrivers = await redis.smembers(`ride_notifications:${bookingId}`);
                const driverLockManager = require('./services/driver-lock-manager');
                const DriverNotificationDispatcher = require('./services/driver-notification-dispatcher');
                const dispatcher = new DriverNotificationDispatcher(io);

                // ✅ NOVO: Identificar motorista que cancelou (se for motorista)
                const cancellingDriverId = socket.userId && socket.userType === 'driver' ? socket.userId : null;
                if (cancellingDriverId) {
                    await redis.set(`driver_soft_ban:${cancellingDriverId}`, String(Date.now()), 'EX', 300);
                }

                for (const driverId of notifiedDrivers) {
                    try {
                        await driverLockManager.releaseLock(driverId);
                        dispatcher.cancelDriverTimeout(driverId, bookingId);
                        await redis.del(`driver_active_notification:${driverId}`);

                        // ✅ NOVO: Se este motorista cancelou, adicionar à lista de exclusão permanente
                        if (cancellingDriverId && driverId === cancellingDriverId) {
                            await redis.sadd(`ride_excluded_drivers:${bookingId}`, driverId);
                            await redis.expire(`ride_excluded_drivers:${bookingId}`, 3600); // Expirar após 1 hora
                            logStructured('info', 'Motorista adicionado à lista de exclusão', {
                                driverId,
                                bookingId,
                                eventType: 'cancelRide'
                            });
                        }
                    } catch (e) {
                        // Ignorar erros de lock não existente
                    }
                }

                // Garantia adicional: se houver motorista associado no booking,
                // limpar lock/notificação mesmo que não esteja em ride_notifications.
                const bookingDriverId = bookingData.driverId || null;
                if (bookingDriverId) {
                    try {
                        await driverLockManager.releaseLock(bookingDriverId);
                        dispatcher.cancelDriverTimeout(bookingDriverId, bookingId);
                        await redis.del(`driver_active_notification:${bookingDriverId}`);
                    } catch (_cleanupDriverError) {
                        // best effort
                    }
                }

                // ✅ NOVO: Se motorista cancelou mas não estava na lista de notificados, adicionar à exclusão mesmo assim
                if (cancellingDriverId && !notifiedDrivers.includes(cancellingDriverId)) {
                    await redis.sadd(`ride_excluded_drivers:${bookingId}`, cancellingDriverId);
                    await redis.expire(`ride_excluded_drivers:${bookingId}`, 3600);
                    logStructured('info', 'Motorista (não notificado) adicionado à lista de exclusão', {
                        driverId: cancellingDriverId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // 4. Remover da fila regional (já feito pelo command, mas manter para compatibilidade)
                if (bookingData.pickupLocation) {
                    const pickupLocation = JSON.parse(bookingData.pickupLocation);
                    const regionHash = GeoHashUtils.getRegionHash(pickupLocation.lat, pickupLocation.lng, 5);
                    await rideQueueManager.dequeueRide(bookingId, regionHash);
                }

                // ✅ REFATORAÇÃO: Usar CancelRideCommand
                logStructured('info', 'Executando CancelRideCommand', {
                    userId,
                    bookingId,
                    eventType: 'cancelRide'
                });

                // ✅ FASE 1.3: Criar span para Command
                const tracer = getTracer();
                const { trace: otelTrace } = require('@opentelemetry/api');
                const activeSpan = otelTrace.getActiveSpan();
                const correlationId = bookingId; // Usar bookingId como correlationId

                const commandSpan = createCommandSpan(tracer, 'cancel_ride', activeSpan, {
                    'command.user_id': userId,
                    'command.booking_id': bookingId,
                    'correlation.id': correlationId
                });

                // ✅ MÉTRICAS: Preparar para registrar corrida cancelada
                const { metrics } = require('./utils/prometheus-metrics');
                const commandStartTime = Date.now();

                let result;
                try {
                    const providedCancellationFeeRaw = Number(cancellationFee);
                    const providedCancellationFeeCents = Number.isFinite(providedCancellationFeeRaw) && providedCancellationFeeRaw > 0
                        ? (providedCancellationFeeRaw >= 50
                            ? Math.round(providedCancellationFeeRaw)
                            : Math.round(providedCancellationFeeRaw * 100))
                        : 0;

                    const command = new CancelRideCommand({
                        bookingId,
                        canceledBy: userId,
                        reason: reason || 'Cancelado pelo usuário',
                        cancellationFee: providedCancellationFeeCents,
                        traceId, // ✅ Passar traceId para o command
                        correlationId, // ✅ Passar correlationId para o command
                        userType: socket.userType // Tipo de usuário (customer/driver)
                    });

                    result = await runInSpan(commandSpan, async () => {
                        return await command.execute();
                    });

                    // ✅ MÉTRICAS: Registrar latência do command
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                } catch (error) {
                    endSpanError(commandSpan, error);
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                    throw error;
                }

                const commandLatency = Date.now() - commandStartTime;

                // ✅ Log de command
                logCommand('CancelRideCommand', result.success, commandLatency, {
                    userId,
                    bookingId
                });

                if (!result.success) {
                    // Erro no command
                    logStructured('error', 'CancelRideCommand falhou', {
                        userId,
                        bookingId,
                        eventType: 'cancelRide',
                        error: result.error
                    });
                    socket.emit('rideCancellationError', {
                        error: result.error || 'Erro ao cancelar corrida'
                    });
                    return;
                }

                // Command executado com sucesso (já processou reembolso e atualizou estado)
                const { bookingId: resultBookingId, canceledBy, reason: resultReason, cancellationFee: resultCancellationFee, event, refundResult } = result.data;
                const effectiveCancellationFeeCents = Math.max(0, Number(resultCancellationFee || 0));

                // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão processar notificações)
                if (event) {
                    // ✅ FASE 1.3: Criar span para Event publish
                    const eventSpan = createEventSpan(tracer, 'ride.canceled', activeSpan, {
                        'event.booking_id': bookingId,
                        'correlation.id': correlationId
                    });

                    const eventStartTime = Date.now();
                    try {
                        await runInSpan(eventSpan, async () => {
                            await eventBus.publish({
                                eventType: 'ride.canceled',
                                data: event
                            });
                        });

                        // ✅ Salvar contexto do evento para linkar com listeners
                        const eventSpanContext = eventSpan.spanContext();
                        if (event.data) {
                            event.data._otelSpanContext = eventSpanContext;
                        }

                        const eventLatency = Date.now() - eventStartTime;
                        logEvent('ride.canceled', 'published', {
                            bookingId,
                            latency_ms: eventLatency
                        });
                    } catch (error) {
                        endSpanError(eventSpan, error);
                        throw error;
                    }
                }

                // ✅ Processar reembolso PIX real (já feito pelo command, mas manter compatibilidade para logs)
                const paymentService = new PaymentService();
                const parseSafeJson = (value) => {
                    if (!value) return null;
                    if (typeof value === 'object') return value;
                    try {
                        return JSON.parse(value);
                    } catch {
                        return null;
                    }
                };

                const passengerData = parseSafeJson(bookingData.passenger) || parseSafeJson(bookingData.customer);
                const passengerId = bookingData.passengerId
                    || bookingData.customerId
                    || passengerData?.uid
                    || passengerData?.id
                    || null;

                const paymentRecord = await paymentService.getStoredPayment(bookingId);
                const estimatedFare = parseFloat(bookingData.estimatedFare || bookingData.totalAmount || 0) || 0;
                const chargeId = paymentRecord?.chargeId || bookingData.paymentChargeId || null;
                const cancellationFeeInCents = effectiveCancellationFeeCents;

                let refundSummary = {
                    status: 'NO_PAYMENT_FOUND',
                    refundAmountInCents: 0,
                    refundAmountInReais: '0.00',
                    cancellationFeeInCents,
                    cancellationFeeInReais: (cancellationFeeInCents / 100).toFixed(2),
                    refundId: null,
                    chargeId
                };

                if (paymentRecord) {
                    if (paymentRecord.status === 'CREDITED' || paymentRecord.credited) {
                        socket.emit('rideCancellationError', { error: 'Pagamento já foi repassado ao motorista. Entre em contato com o suporte.' });
                        return;
                    }

                    if (paymentRecord.refunded || paymentRecord.status === 'REFUNDED') {
                        refundSummary.status = 'ALREADY_REFUNDED';
                    } else {
                        const totalPaidCents = Number(paymentRecord.amount) || Math.round(estimatedFare * 100);
                        const feeCents = Math.min(totalPaidCents, cancellationFeeInCents);
                        const refundAmountCents = Math.max(0, totalPaidCents - feeCents);
                        const refundReason = reason || 'Cancelado pelo passageiro';

                        if (refundAmountCents > 0 && chargeId) {
                            const refundResult = await paymentService.processRefund(chargeId, refundAmountCents, refundReason);
                            if (!refundResult.success) {
                                socket.emit('rideCancellationError', { error: 'Falha ao processar reembolso PIX' });
                                return;
                            }

                            await paymentService.markPaymentRefunded(bookingId, {
                                refundId: refundResult.refundId,
                                refundAmount: refundAmountCents,
                                cancellationFee: feeCents,
                                reason: refundReason,
                                status: 'REFUNDED'
                            });

                            refundSummary = {
                                status: 'REFUNDED',
                                refundId: refundResult.refundId,
                                refundAmountInCents: refundAmountCents,
                                refundAmountInReais: (refundAmountCents / 100).toFixed(2),
                                cancellationFeeInCents: feeCents,
                                cancellationFeeInReais: (feeCents / 100).toFixed(2),
                                chargeId
                            };
                        } else {
                            await paymentService.markPaymentRefunded(bookingId, {
                                refundAmount: 0,
                                cancellationFee: feeCents,
                                reason: refundReason,
                                status: feeCents > 0 ? 'FEE_ONLY' : 'NO_REFUND_REQUIRED'
                            });

                            refundSummary = {
                                status: feeCents > 0 ? 'FEE_ONLY' : 'NO_REFUND_REQUIRED',
                                refundAmountInCents: 0,
                                refundAmountInReais: '0.00',
                                cancellationFeeInCents: feeCents,
                                cancellationFeeInReais: (feeCents / 100).toFixed(2),
                                chargeId
                            };
                        }
                    }
                }

                const cancellationData = {
                    bookingId,
                    reason: reason || 'Cancelado pelo usuário',
                    cancellationFee: parseFloat(refundSummary.cancellationFeeInReais),
                    refundAmount: parseFloat(refundSummary.refundAmountInReais),
                    refundStatus: refundSummary.status,
                    refundMethod: refundSummary.status === 'REFUNDED' ? 'PIX' : null,
                    refundId: refundSummary.refundId,
                    chargeId: refundSummary.chargeId,
                    timestamp: new Date().toISOString()
                };

                const cancellationResponse = {
                    success: true,
                    bookingId,
                    message: refundSummary.status === 'REFUNDED'
                        ? 'Corrida cancelada e reembolso processado'
                        : 'Corrida cancelada',
                    initiatedBy: socket.userType || 'unknown',
                    initiatedById: socket.userId || null,
                    data: cancellationData
                };

                // 8. Emitir confirmação
                // ✅ Padronizar uso de rooms para alta escalabilidade
                const initiatorId = socket.userId || socket.id;
                const initiatorType = socket.userType || 'unknown';

                // Emitir para quem iniciou o cancelamento via room
                if (initiatorType === 'driver') {
                    io.to(`driver_${initiatorId}`).emit('rideCancelled', cancellationResponse);
                    logStructured('info', 'rideCancelled enviado para driver', {
                        driverId: initiatorId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                } else if (initiatorType === 'customer' || initiatorType === 'passenger') {
                    io.to(`customer_${initiatorId}`).emit('rideCancelled', cancellationResponse);
                    logStructured('info', 'rideCancelled enviado para customer', {
                        customerId: initiatorId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // ✅ NOVO: Atualizar Live Activity/Foreground Service (Silent Push)
                try {
                    const payloadData = {
                        bookingId: bookingId,
                        status: 'cancelled',
                        distance: '0',
                        fare: String(refundSummary?.refundAmountInReais || '0')
                    };

                    const drvIdToNotify = bookingData.driverId || (initiatorType === 'driver' ? initiatorId : null);
                    if (passengerId) await fcmService.sendRideStatusUpdate(passengerId, { ...payloadData, userType: 'customer' });
                    if (drvIdToNotify) await fcmService.sendRideStatusUpdate(drvIdToNotify, { ...payloadData, userType: 'driver' });
                } catch (silentPushError) {
                    logStructured('error', 'Erro ao enviar silent push em cancelRide', { error: silentPushError.message });
                }

                // ✅ Também emitir para o passageiro se houver (e for diferente do iniciador)
                if (passengerId && passengerId !== initiatorId) {
                    io.to(`customer_${passengerId}`).emit('rideCancelled', cancellationResponse);
                    logStructured('info', 'rideCancelled enviado para customer (passageiro)', {
                        customerId: passengerId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // ✅ Também emitir para o motorista se houver (e for diferente do iniciador)
                const bookingKeyForDriver = `booking:${bookingId}`;
                const bookingDataForDriver = await redis.hgetall(bookingKeyForDriver);
                const driverIdFromBooking = bookingDataForDriver?.driverId;
                if (driverIdFromBooking && driverIdFromBooking !== initiatorId) {
                    io.to(`driver_${driverIdFromBooking}`).emit('rideCancelled', cancellationResponse);
                    logStructured('info', 'rideCancelled enviado para driver (motorista)', {
                        driverId: driverIdFromBooking,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }
                if (passengerId && refundSummary.status !== 'NO_PAYMENT_FOUND') {
                    const refundEventPayload = {
                        success: true,
                        rideId: bookingId,
                        chargeId: refundSummary.chargeId,
                        refundStatus: refundSummary.status,
                        refundAmount: parseFloat(refundSummary.refundAmountInReais),
                        cancellationFee: parseFloat(refundSummary.cancellationFeeInReais),
                        refundId: refundSummary.refundId,
                        initiatedBy: socket.userType || 'unknown',
                        initiatedById: socket.userId || null,
                        timestamp: new Date().toISOString()
                    };
                    io.to(`customer_${passengerId}`).emit('paymentRefunded', refundEventPayload);
                    logStructured('info', 'paymentRefunded emitido', {
                        bookingId,
                        passengerId,
                        refundStatus: refundSummary.status,
                        eventType: 'cancelRide'
                    });
                }

                // 9. Limpar dados de busca
                await redis.del(`booking_search:${bookingId}`);
                await redis.del(`ride_notifications:${bookingId}`);
                await redis.del(`trip_integrity:${bookingId}`);

                logStructured('info', 'Corrida cancelada - Reembolso automático processado', {
                    service: 'server',
                    bookingId,
                    eventType: 'cancelRide',
                    refundProcessed: true
                });

                // ✅ NOVO: Limpar activeBookings (Memória)
                if (io.activeBookings) {
                    io.activeBookings.delete(bookingId);
                }

            } catch (error) {
                logStructured('error', 'Erro ao cancelar corrida', {
                    service: 'websocket',
                    operation: 'cancelRide',
                    bookingId: data.bookingId,
                    error: error.message,
                    stack: error.stack
                });
                socket.emit('rideCancellationError', { error: 'Erro interno do servidor' });
            }
        });
    });
    // =========================================================================================

    // ==================== NOVOS EVENTOS - SISTEMA DE SEGURANÇA ====================

    // Reportar incidente
    socket.on('reportIncident', async (data) => {
            try {
                logStructured('info', 'Incidente reportado', {
                    service: 'server',
                    userId: socket.userId || socket.id,
                    type: data?.type,
                    eventType: 'reportIncident'
                });

                const { type, description, evidence, location, timestamp } = data;

                if (!type || !description) {
                    socket.emit('incidentReportError', { error: 'Tipo e descrição obrigatórios' });
                    return;
                }

                // Simular processamento do incidente
                const incidentData = {
                    reportId: `incident_${Date.now()}`,
                    type,
                    description,
                    evidence: evidence || [],
                    location,
                    status: 'under_review',
                    priority: type === 'safety' ? 'high' : 'medium',
                    timestamp: timestamp || new Date().toISOString()
                };

                // Emitir confirmação
                socket.emit('incidentReported', {
                    success: true,
                    reportId: incidentData.reportId,
                    message: 'Incidente reportado com sucesso',
                    data: incidentData
                });

                logStructured('info', 'Incidente reportado com sucesso', {
                    service: 'server',
                    userId: socket.userId || socket.id,
                    reportId: incidentData.reportId,
                    type,
                    priority: incidentData.priority,
                    eventType: 'reportIncident'
                });

            } catch (error) {
                logStructured('error', 'Erro ao reportar incidente', {
                    service: 'websocket',
                    operation: 'reportIncident',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('incidentReportError', { error: 'Erro interno do servidor' });
            }
        });

        // Contato de emergência
        socket.on('emergencyContact', async (data) => {
            try {
                logStructured('warn', 'Contato de emergência recebido', {
                    service: 'server',
                    userId: socket.userId || socket.id,
                    contactType: data?.contactType,
                    eventType: 'emergencyContact'
                });

                const { contactType, location, message } = data;

                if (!contactType) {
                    socket.emit('emergencyError', { error: 'Tipo de contato obrigatório' });
                    return;
                }

                // Simular contato de emergência
                const emergencyData = {
                    emergencyId: `emergency_${Date.now()}`,
                    contactType,
                    location,
                    message: message || 'Solicitação de emergência',
                    status: 'contacted',
                    estimatedResponseTime: contactType === 'police' ? 5 : 10,
                    timestamp: new Date().toISOString()
                };

                // Emitir confirmação
                socket.emit('emergencyContacted', {
                    success: true,
                    emergencyId: emergencyData.emergencyId,
                    contactType,
                    estimatedResponseTime: emergencyData.estimatedResponseTime,
                    message: 'Contato de emergência realizado'
                });

                logStructured('warn', 'Contato de emergência realizado', {
                    service: 'server',
                    userId: socket.userId || socket.id,
                    emergencyId: emergencyData.emergencyId,
                    contactType,
                    estimatedResponseTime: emergencyData.estimatedResponseTime,
                    eventType: 'emergencyContact'
                });

            } catch (error) {
                logStructured('error', 'Erro no contato de emergência', {
                    service: 'websocket',
                    operation: 'emergencyContact',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('emergencyError', { error: 'Erro interno do servidor' });
            }
        });

        // ==================== NOVOS EVENTOS - SISTEMA DE SUPORTE ====================

        // 💬 CHAT DE SUPORTE EM TEMPO REAL (Redis Pub/Sub + Firestore)
        socket.on('support:chat:message', async (data) => {
            try {
                const SupportChatService = require('./services/support-chat-service');
                const supportChatService = SupportChatService;

                // Injetar io se ainda não foi injetado
                if (!supportChatService.io) {
                    supportChatService.setIOInstance(io);
                }

                const { userId, message, senderType = 'user' } = data;

                if (!userId || !message) {
                    socket.emit('support:chat:error', { error: 'Dados inválidos' });
                    return;
                }

                logStructured('info', 'Nova mensagem no chat de suporte', {
                    service: 'server',
                    userId,
                    senderType,
                    eventType: 'supportChat'
                });

                // ✅ Enviar via SupportChatService (Redis Pub/Sub + Firestore)
                const result = await supportChatService.sendMessage(userId, message, senderType);

                // Confirmar recebimento
                socket.emit('support:chat:sent', {
                    success: true,
                    messageId: result.message.id
                });

            } catch (error) {
                logStructured('error', 'Erro ao processar mensagem de chat', {
                    service: 'websocket',
                    operation: 'supportChat',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('support:chat:error', { error: 'Erro interno do servidor' });
            }
        });

        // Criar ticket de suporte
        socket.on('createSupportTicket', async (data) => {
            try {
                logStructured('info', 'Ticket de suporte recebido', {
                    service: 'websocket',
                    operation: 'createSupportTicket',
                    userId: socket.userId || socket.id,
                    type: data.type
                });

                const { type, priority, description, attachments } = data;

                if (!type || !description) {
                    socket.emit('supportTicketError', { error: 'Tipo e descrição obrigatórios' });
                    return;
                }

                // Simular criação do ticket
                const ticketData = {
                    ticketId: `ticket_${Date.now()}`,
                    type,
                    priority: priority || 'N3',
                    description,
                    attachments: attachments || [],
                    status: 'open',
                    estimatedResponseTime: priority === 'N1' ? 30 : priority === 'N2' ? 120 : 480, // minutos
                    timestamp: new Date().toISOString()
                };

                // Emitir confirmação
                socket.emit('supportTicketCreated', {
                    success: true,
                    ticketId: ticketData.ticketId,
                    estimatedResponseTime: ticketData.estimatedResponseTime,
                    message: 'Ticket de suporte criado com sucesso',
                    data: ticketData
                });

                logStructured('info', 'Ticket de suporte criado com sucesso', {
                    service: 'websocket',
                    operation: 'createSupportTicket',
                    ticketId: ticketData.ticketId,
                    priority: ticketData.priority
                });

            } catch (error) {
                logStructured('error', 'Erro ao criar ticket de suporte', {
                    service: 'websocket',
                    operation: 'createSupportTicket',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('supportTicketError', { error: 'Erro interno do servidor' });
            }
        });

        // ==================== NOVOS EVENTOS - NOTIFICAÇÕES AVANÇADAS ====================

        // Atualizar preferências de notificação
        socket.on('updateNotificationPreferences', async (data) => {
            try {
                logStructured('info', 'Preferências de notificação recebidas', {
                    service: 'websocket',
                    operation: 'updateNotificationPreferences',
                    userId: socket.userId || socket.id
                });

                const { rideUpdates, promotions, driverMessages, systemAlerts } = data;

                // Simular atualização das preferências
                const preferencesData = {
                    rideUpdates: rideUpdates !== undefined ? rideUpdates : true,
                    promotions: promotions !== undefined ? promotions : false,
                    driverMessages: driverMessages !== undefined ? driverMessages : true,
                    systemAlerts: systemAlerts !== undefined ? systemAlerts : true,
                    timestamp: new Date().toISOString()
                };

                // Emitir confirmação
                socket.emit('notificationPreferencesUpdated', {
                    success: true,
                    message: 'Preferências de notificação atualizadas',
                    data: preferencesData
                });

                logStructured('info', 'Preferências de notificação atualizadas com sucesso', {
                    service: 'websocket',
                    operation: 'updateNotificationPreferences',
                    userId: socket.userId || socket.id
                });

            } catch (error) {
                logStructured('error', 'Erro ao atualizar preferências de notificação', {
                    service: 'websocket',
                    operation: 'updateNotificationPreferences',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });

        // ==================== NOVOS EVENTOS - ANALYTICS E FEEDBACK ====================

        // Rastrear ação do usuário
        socket.on('trackUserAction', async (data) => {
            try {
                logStructured('info', 'Ação do usuário recebida para rastreamento', {
                    service: 'websocket',
                    operation: 'trackUserAction',
                    userId: socket.userId || socket.id,
                    action: data.action
                });

                const { action, data: actionData, timestamp } = data;

                if (!action) {
                    socket.emit('trackingError', { error: 'Ação obrigatória' });
                    return;
                }

                // Simular rastreamento
                const trackingData = {
                    actionId: `action_${Date.now()}`,
                    action,
                    data: actionData || {},
                    timestamp: timestamp || new Date().toISOString(),
                    processed: true
                };

                // Emitir confirmação
                socket.emit('userActionTracked', {
                    success: true,
                    actionId: trackingData.actionId,
                    message: 'Ação rastreada com sucesso'
                });

                logStructured('info', 'Ação do usuário rastreada com sucesso', {
                    service: 'websocket',
                    operation: 'trackUserAction',
                    userId: socket.userId || socket.id,
                    actionId: trackingData.actionId,
                    action: action
                });

            } catch (error) {
                logStructured('error', 'Erro ao rastrear ação do usuário', {
                    service: 'websocket',
                    operation: 'trackUserAction',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('trackingError', { error: 'Erro interno do servidor' });
            }
        });

        // Enviar feedback
        socket.on('submitFeedback', async (data) => {
            try {
                logStructured('info', 'Feedback recebido', {
                    service: 'websocket',
                    operation: 'submitFeedback',
                    userId: socket.userId || socket.id,
                    type: data.type,
                    rating: data.rating
                });

                const { type, rating, comments, suggestions } = data;

                if (!type || !rating) {
                    socket.emit('feedbackError', { error: 'Tipo e avaliação obrigatórios' });
                    return;
                }

                // Simular processamento do feedback
                const feedbackData = {
                    feedbackId: `feedback_${Date.now()}`,
                    type,
                    rating,
                    comments: comments || '',
                    suggestions: suggestions || '',
                    status: 'received',
                    timestamp: new Date().toISOString()
                };

                // Emitir confirmação
                socket.emit('feedbackReceived', {
                    success: true,
                    feedbackId: feedbackData.feedbackId,
                    thankYouMessage: 'Obrigado pelo seu feedback! Sua opinião é muito importante para nós.',
                    data: feedbackData
                });

                logStructured('info', 'Feedback processado com sucesso', {
                    service: 'websocket',
                    operation: 'submitFeedback',
                    userId: socket.userId || socket.id,
                    feedbackId: feedbackData.feedbackId,
                    type: type,
                    rating: rating
                });

            } catch (error) {
                logStructured('error', 'Erro ao processar feedback', {
                    service: 'websocket',
                    operation: 'submitFeedback',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('feedbackError', { error: 'Erro interno do servidor' });
            }
        });

        // ==================== NOVOS EVENTOS - CHAT E COMUNICAÇÃO ====================

        // Criar chat
        socket.on('createChat', async (data) => {
            try {
                logStructured('info', 'Criação de chat solicitada', {
                    service: 'websocket',
                    operation: 'createChat',
                    userId: socket.userId || socket.id
                });

                const chatId = `chat_${Date.now()}`;

                socket.emit('chatCreated', {
                    success: true,
                    chatId,
                    message: 'Chat criado com sucesso'
                });

                logStructured('info', 'Chat criado com sucesso', {
                    service: 'websocket',
                    operation: 'createChat',
                    userId: socket.userId || socket.id,
                    chatId: chatId
                });

            } catch (error) {
                logStructured('error', 'Erro ao criar chat', {
                    service: 'websocket',
                    operation: 'createChat',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('chatError', { error: 'Erro interno do servidor' });
            }
        });

        // Enviar mensagem
        socket.on('sendMessage', async (data) => {
            try {
                // ✅ NOVO: Rate Limiting
                const senderId = data.senderId || socket.userId || socket.id;
                const rateLimitCheck = await rateLimiterService.checkRateLimit(senderId, 'sendMessage');

                if (!rateLimitCheck.allowed) {
                    socket.emit('messageError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} mensagens por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido para sendMessage', {
                        service: 'websocket',
                        operation: 'sendMessage',
                        senderId: senderId,
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining
                    });
                    return;
                }

                logStructured('info', 'Mensagem recebida para envio', {
                    service: 'websocket',
                    operation: 'sendMessage',
                    senderId: senderId,
                    bookingId: data.bookingId,
                    rideId: data.rideId
                });

                const { bookingId, rideId, message, receiverId, senderType } = data;

                if (!message || !senderId) {
                    socket.emit('messageError', { error: 'Mensagem e senderId são obrigatórios' });
                    return;
                }

                const conversationId = bookingId || rideId;

                if (!conversationId) {
                    socket.emit('messageError', { error: 'bookingId ou rideId é obrigatório' });
                    return;
                }

                // ✅ NOVO: Salvar mensagem no Firestore com TTL de 90 dias
                try {
                    const chatPersistenceService = require('./services/chat-persistence-service');
                    const saveResult = await chatPersistenceService.saveMessage({
                        bookingId: bookingId || conversationId,
                        rideId: rideId || conversationId,
                        senderId: senderId,
                        receiverId: receiverId || null,
                        message: message,
                        senderType: senderType || (socket.userType === 'driver' ? 'driver' : 'passenger'),
                        timestamp: new Date().toISOString()
                    });

                    if (!saveResult.success) {
                        logStructured('error', 'Erro ao salvar mensagem no Firestore', {
                            service: 'websocket',
                            operation: 'sendMessage',
                            senderId: senderId,
                            conversationId: conversationId,
                            error: saveResult.error
                        });
                        // Não bloquear envio se persistência falhar, mas logar erro
                    }
                } catch (persistError) {
                    logStructured('error', 'Erro ao persistir mensagem', {
                        service: 'websocket',
                        operation: 'sendMessage',
                        senderId: senderId,
                        conversationId: conversationId,
                        error: persistError.message
                    });
                    // Não bloquear envio se persistência falhar
                }

                // Gerar ID da mensagem
                const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Buscar dados do booking para notificar o outro participante
                const bookingData = io.activeBookings?.get(conversationId);
                const customerId = bookingData?.customerId;
                const driverId = bookingData?.driverId;

                // Determinar receiverId se não fornecido
                let finalReceiverId = receiverId;
                if (!finalReceiverId) {
                    if (senderId === customerId) {
                        finalReceiverId = driverId;
                    } else if (senderId === driverId) {
                        finalReceiverId = customerId;
                    }
                }

                // Notificar o remetente
                socket.emit('messageSent', {
                    success: true,
                    messageId: messageId,
                    message: 'Mensagem enviada com sucesso',
                    timestamp: new Date().toISOString()
                });

                // Notificar o receptor se estiver conectado
                if (finalReceiverId && io.connectedUsers) {
                    const receiverSocket = io.connectedUsers.get(finalReceiverId);
                    if (receiverSocket) {
                        receiverSocket.emit('newMessage', {
                            success: true,
                            messageId: messageId,
                            bookingId: conversationId,
                            senderId: senderId,
                            message: message,
                            senderType: senderType || (socket.userType === 'driver' ? 'driver' : 'passenger'),
                            timestamp: new Date().toISOString()
                        });
                        logStructured('info', 'Mensagem enviada para receptor', {
                            service: 'websocket',
                            operation: 'sendMessage',
                            senderId: senderId,
                            receiverId: finalReceiverId,
                            conversationId: conversationId
                        });
                    }
                }

            } catch (error) {
                logStructured('error', 'Erro ao enviar mensagem', {
                    service: 'websocket',
                    operation: 'sendMessage',
                    senderId: data.senderId || socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('messageError', { error: 'Erro interno do servidor' });
            }
        });

        // ==================== NOVOS EVENTOS - GERENCIAMENTO DE CORRIDA EM ANDAMENTO ====================

        // Reportar problema durante corrida
        socket.on('reportProblem', async (data) => {
            try {
                logStructured('info', 'Problema reportado durante corrida', {
                    service: 'websocket',
                    operation: 'reportProblem',
                    userId: socket.userId || socket.id,
                    bookingId: data.bookingId,
                    problemType: data.problemType
                });

                const { bookingId, problemType, description } = data;

                if (!bookingId || !problemType) {
                    socket.emit('problemReportError', { error: 'bookingId e problemType obrigatórios' });
                    return;
                }

                const redis = redisPool.getConnection();

                // Buscar dados da corrida
                const bookingData = await redis.hget('bookings:active', bookingId);
                if (!bookingData) {
                    socket.emit('problemReportError', { error: 'Corrida não encontrada' });
                    return;
                }

                const booking = JSON.parse(bookingData);

                // Salvar problema reportado
                const problemData = {
                    problemId: `problem_${Date.now()}`,
                    bookingId,
                    problemType, // 'accident', 'vehicle_defect', 'unsafe', 'danger'
                    description: description || '',
                    timestamp: new Date().toISOString(),
                    status: 'reported'
                };

                await redis.hset(`problems:${bookingId}`, problemData.problemId, JSON.stringify(problemData));

                socket.emit('problemReported', {
                    success: true,
                    problemId: problemData.problemId,
                    problemType,
                    message: 'Problema reportado com sucesso',
                    data: problemData
                });

                logStructured('info', `Problema reportado`, { service: 'reportProblem', problemId: problemData.problemId, userId: socket.userId });

            } catch (error) {
                logError(error, 'Erro ao reportar problema', { service: 'reportProblem', userId: socket.userId });
                socket.emit('problemReportError', { error: 'Erro interno do servidor' });
            }
        });

        // Calcular pagamento parcial ao motorista
        socket.on('calculatePartialPayment', async (data) => {
            try {
                logStructured('info', `Calculando pagamento parcial`, { service: 'calculatePartialPayment', bookingId: data.bookingId, userId: socket.userId });

                const { bookingId } = data;

                if (!bookingId) {
                    socket.emit('partialPaymentError', { error: 'bookingId obrigatório' });
                    return;
                }

                const redis = redisPool.getConnection();

                // Buscar dados da corrida
                const bookingData = await redis.hget('bookings:active', bookingId);
                if (!bookingData) {
                    socket.emit('partialPaymentError', { error: 'Corrida não encontrada' });
                    return;
                }

                const booking = JSON.parse(bookingData);

                // Buscar distância e tempo percorridos (se disponível)
                const tripDistance = booking.tripDistance || 0; // km
                const tripDuration = booking.tripDuration || 0; // minutos
                const vehicleType = booking.vehicleType || 'Leaf Plus';

                // Calcular valor percorrido (metade do valor total estimado)
                const originalFare = parseFloat(booking.estimate || 0);
                const partialValue = originalFare / 2; // Metade do valor

                // Calcular taxas (usar valores do payment-service)
                const PaymentService = require('./services/payment-service');
                const paymentService = new PaymentService();

                // Converter para centavos para cálculo
                const partialValueCents = Math.round(partialValue * 100);
                const netCalculation = paymentService.calculateNetAmount(partialValueCents);

                // Converter de volta para reais
                const operationalFee = netCalculation.operationalFee / 100;
                const wooviFee = netCalculation.wooviFee / 100;
                const driverPayment = netCalculation.netAmount / 100;

                socket.emit('partialPaymentCalculated', {
                    success: true,
                    bookingId,
                    partialValue: partialValue.toFixed(2),
                    operationalFee: operationalFee.toFixed(2),
                    wooviFee: wooviFee.toFixed(2),
                    driverPayment: driverPayment.toFixed(2),
                    breakdown: {
                        originalFare: originalFare.toFixed(2),
                        partialValue: partialValue.toFixed(2),
                        operationalFee: operationalFee.toFixed(2),
                        wooviFee: wooviFee.toFixed(2),
                        driverPayment: driverPayment.toFixed(2)
                    }
                });

                logStructured('info', `Pagamento parcial calculado`, { service: 'calculatePartialPayment', bookingId, driverPayment: driverPayment.toFixed(2), partialValue: partialValue.toFixed(2) });

            } catch (error) {
                logError(error, 'Erro ao calcular pagamento parcial', { service: 'calculatePartialPayment', bookingId: data.bookingId });
                socket.emit('partialPaymentError', { error: 'Erro interno do servidor' });
            }
        });

        // Procurar novo motorista após problema
        socket.on('findNewDriver', async (data) => {
            try {
                logStructured('info', `Procurando novo motorista`, { service: 'findNewDriver', bookingId: data.bookingId, problemType: data.problemType, userId: socket.userId });

                const { bookingId, problemType, partialPayment } = data;

                if (!bookingId) {
                    socket.emit('findNewDriverError', { error: 'bookingId obrigatório' });
                    return;
                }

                const redis = redisPool.getConnection();

                // Buscar dados da corrida
                const bookingData = await redis.hget('bookings:active', bookingId);
                if (!bookingData) {
                    socket.emit('findNewDriverError', { error: 'Corrida não encontrada' });
                    return;
                }

                const booking = JSON.parse(bookingData);

                // Liberar lock do motorista anterior
                if (booking.driverId) {
                    await redis.del(`driver_lock:${booking.driverId}`);
                }

                // Processar pagamento parcial ao motorista anterior
                if (partialPayment && booking.driverId) {
                    // ✅ Pagamento via Woovi já implementado em processAdvancePayment
                    logStructured('info', `Pagando motorista anterior`, { service: 'findNewDriver', bookingId, driverId: booking.driverId, partialPayment });
                }

                // Criar nova busca de motorista
                const newBooking = {
                    ...booking,
                    driverId: null,
                    status: 'DRIVER_SEARCH',
                    previousDriverId: booking.driverId,
                    previousDriverPayment: partialPayment,
                    problemType,
                    searchStartedAt: new Date().toISOString()
                };

                await redis.hset('bookings:active', bookingId, JSON.stringify(newBooking));

                // Emitir evento para iniciar nova busca
                socket.emit('newDriverSearchStarted', {
                    success: true,
                    bookingId,
                    message: 'Buscando novo motorista...'
                });

                // ✅ Integrado com sistema de filas e matching (rideQueueManager)
                // Por enquanto, apenas emitir evento
                logStructured('info', `Nova busca de motorista iniciada`, { service: 'findNewDriver', bookingId });

            } catch (error) {
                logError(error, 'Erro ao procurar novo motorista', { service: 'findNewDriver', bookingId: data.bookingId });
                socket.emit('findNewDriverError', { error: 'Erro interno do servidor' });
            }
        });

        // Alterar destino durante corrida
        socket.on('changeDestination', async (data) => {
            try {
                logStructured('info', `Alterando destino`, { service: 'changeDestination', bookingId: data.bookingId, userId: socket.userId });

                const { bookingId, newDestination } = data;

                if (!bookingId || !newDestination || !newDestination.lat || !newDestination.lng) {
                    socket.emit('changeDestinationError', { error: 'bookingId e newDestination obrigatórios' });
                    return;
                }

                const redis = redisPool.getConnection();

                // Buscar dados da corrida
                const bookingData = await redis.hget('bookings:active', bookingId);
                if (!bookingData) {
                    socket.emit('changeDestinationError', { error: 'Corrida não encontrada' });
                    return;
                }

                const booking = JSON.parse(bookingData);

                // Obter localização atual do passageiro (usar pickup atual ou localização do motorista)
                const currentLocation = booking.currentLocation || booking.pickup;
                if (!currentLocation) {
                    socket.emit('changeDestinationError', { error: 'Localização atual não encontrada' });
                    return;
                }

                // ✅ Rota calculada no frontend usando Google Directions API
                // Por enquanto, usar estimativa baseada em distância Haversine
                function calculateDistance(lat1, lng1, lat2, lng2) {
                    const R = 6371; // Raio da Terra em km
                    const dLat = (lat2 - lat1) * Math.PI / 180;
                    const dLng = (lng2 - lng1) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                        Math.sin(dLng / 2) * Math.sin(dLng / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return R * c; // Retorna em km
                }

                const distanceKm = calculateDistance(
                    currentLocation.lat,
                    currentLocation.lng,
                    newDestination.lat,
                    newDestination.lng
                );

                // Estimativa de tempo (assumindo velocidade média de 40 km/h)
                const estimatedTimeMinutes = (distanceKm / 40) * 60;

                // Calcular nova tarifa (usar mesma lógica do booking original)
                const vehicleType = booking.vehicleType || 'Leaf Plus';
                const rateDetails = booking.rateDetails || {};

                // ✅ Tarifa calculada no frontend e enviada no createBooking
                const newFare = booking.estimate * (distanceKm / (booking.distance || 1)); // Estimativa simples

                const currentFare = parseFloat(booking.estimate || 0);
                const fareDifference = newFare - currentFare;

                // Atualizar destino no booking
                const updatedBooking = {
                    ...booking,
                    drop: newDestination,
                    newEstimate: newFare,
                    fareDifference,
                    destinationChangedAt: new Date().toISOString()
                };

                await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
                socket.emit('destinationChanged', {
                    success: true,
                    bookingId,
                    newDestination,
                    newFare: newFare.toFixed(2),
                    fareDifference: fareDifference.toFixed(2),
                    requiresPayment: fareDifference > 0,
                    requiresRefund: fareDifference < 0,
                    message: 'Destino alterado com sucesso'
                });

                logStructured('info', `Destino alterado para corrida`, { service: 'changeDestination', bookingId });

            } catch (error) {
                logError(error, 'Erro ao alterar destino', { service: 'changeDestination', bookingId: data.bookingId });
                socket.emit('changeDestinationError', { error: 'Erro interno do servidor' });
            }
        });

        // ✅ CAOS SCENARIO: Extensão de Rota Pré-Paga (Pix)
        socket.on('requestRideExtension', async (data) => {
            try {
                const customerId = socket.userId || data.customerId;
                const { bookingId, newEndLocation, newFare } = data;

                if (!customerId || !bookingId || !newEndLocation || !newFare) {
                    socket.emit('rideExtensionError', { error: 'Dados incompletos para extensão da corrida' });
                    return;
                }

                logStructured('info', 'Solicitação de extensão de rota recebida', { bookingId, customerId });

                const ExtendRideCommand = require('./commands/ExtendRideCommand');
                const command = new ExtendRideCommand({
                    bookingId,
                    customerId,
                    newEndLocation,
                    newFare,
                    correlationId: bookingId
                });

                const result = await command.execute();

                if (!result.success) {
                    socket.emit('rideExtensionError', { error: result.error });
                    return;
                }

                // Enviar QR Code Pix para o passageiro pagar a diferença
                socket.emit('rideExtensionPaymentRequired', result.data);

                // Avisar o motorista que uma extensão está aguardando pagamento
                const redis = redisPool.getConnection();
                const bookingDataStr = await redis.hget('bookings:active', bookingId);
                if (bookingDataStr) {
                    const booking = JSON.parse(bookingDataStr);
                    if (booking.driverId) {
                        io.to(`driver_${booking.driverId}`).emit('rideExtensionRequested', {
                            bookingId,
                            message: 'Passageiro solicitou extensão da rota. Aguardando pagamento Pix...'
                        });
                    }
                }

            } catch (error) {
                logError(error, 'Erro em requestRideExtension', { bookingId: data.bookingId });
                socket.emit('rideExtensionError', { error: 'Erro interno ao processar extensão' });
            }
        });

        // NOTIFICAÇÕES FCM (Handlers agora registrados no topo da função connection)

        // Enviar notificação
        socket.on('sendNotification', async (data) => {
            try {
                logStructured('info', `Notificação enviada`, { service: 'sendNotification', userId: data.userId, userType: data.userType });

                const { userId, userType, notification, timestamp } = data;

                if (!notification) {
                    socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                    return;
                }

                // Simular envio de notificação
                const notificationData = {
                    notificationId: `notif_${Date.now()}`,
                    userId,
                    userType,
                    notification,
                    timestamp: timestamp || new Date().toISOString(),
                    status: 'sent'
                };

                // Emitir confirmação
                socket.emit('notificationSent', {
                    success: true,
                    notificationId: notificationData.notificationId,
                    message: 'Notificação enviada com sucesso',
                    data: notificationData
                });

                logStructured('info', `Notificação enviada`, { service: 'sendNotification', notificationId: notificationData.notificationId });

            } catch (error) {
                logError(error, 'Erro ao enviar notificação', { service: 'sendNotification' });
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });

        // Enviar notificação para usuário específico
        socket.on('sendNotificationToUser', async (data) => {
            try {
                logStructured('info', `Notificação para usuário`, { service: 'sendNotificationToUser', userId: data.userId });

                const { userId, notification, timestamp } = data;

                if (!userId || !notification) {
                    socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                    return;
                }

                // Simular envio de notificação para usuário específico
                const notificationData = {
                    notificationId: `notif_user_${Date.now()}`,
                    targetUserId: userId,
                    notification,
                    timestamp: timestamp || new Date().toISOString(),
                    status: 'sent'
                };

                // Emitir confirmação
                socket.emit('notificationSentToUser', {
                    success: true,
                    notificationId: notificationData.notificationId,
                    targetUserId: userId,
                    message: 'Notificação enviada para usuário com sucesso',
                    data: notificationData
                });

                logStructured('info', `Notificação enviada para usuário`, { service: 'sendNotificationToUser', userId, notificationId: notificationData.notificationId });

            } catch (error) {
                logError(error, 'Erro ao enviar notificação para usuário', { service: 'sendNotificationToUser', userId: data.userId });
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });

        // Enviar notificação para todos os usuários de um tipo
        socket.on('sendNotificationToUserType', async (data) => {
            try {
                logStructured('info', 'Notificação para tipo de usuário', {
                    service: 'sendNotificationToUserType',
                    userType: data.userType
                });

                const { userType, notification, timestamp } = data;

                if (!userType || !notification) {
                    socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                    return;
                }

                // Simular envio de notificação para tipo de usuário
                const notificationData = {
                    notificationId: `notif_type_${Date.now()}`,
                    targetUserType: userType,
                    notification,
                    timestamp: timestamp || new Date().toISOString(),
                    status: 'sent'
                };

                // Emitir confirmação
                socket.emit('notificationSentToUserType', {
                    success: true,
                    notificationId: notificationData.notificationId,
                    targetUserType: userType,
                    message: 'Notificação enviada para tipo de usuário com sucesso',
                    data: notificationData
                });

                logStructured('info', 'Notificação enviada para tipo de usuário', {
                    service: 'sendNotificationToUserType',
                    userType,
                    notificationId: notificationData.notificationId
                });

            } catch (error) {
                logError(error, 'Erro ao enviar notificação para tipo de usuário', { service: 'sendNotificationToUserType', userType: data.userType });
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });
    }); // Fecha io.on('connection')

    // Graceful shutdown (registrar uma única vez por processo)
    if (!process.__leafShutdownHandlersRegistered) {
        process.__leafShutdownHandlersRegistered = true;
        const gracefulShutdown = (signal) => {
            logStructured('info', `Recebido ${signal}, fechando servidor`, { service: 'server' });
            server.close(async () => {
                if (socketIoAdapterPubClient) {
                    socketIoAdapterPubClient.disconnect();
                    socketIoAdapterPubClient = null;
                }
                if (socketIoAdapterSubClient) {
                    socketIoAdapterSubClient.disconnect();
                    socketIoAdapterSubClient = null;
                }
                await shutdownTracer();
                process.exit(0);
            });
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    }
}
