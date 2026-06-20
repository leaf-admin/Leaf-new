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
const cluster = require('cluster');
const os = require('os');
const cors = require('cors');
const admin = require('firebase-admin');
const firebaseConfig = require('./firebase-config');

// Importar GraphQL
const { applyMiddleware } = require('./graphql/server');

// Bootstrap do HTTP (fase de modularização)
const configureHttpMiddleware = require('./bootstrap/http-middleware');
const registerHttpRoutes = require('./bootstrap/register-http-routes');
const registerRuntimeEndpoints = require('./bootstrap/register-runtime-endpoints');
const createSocketServer = require('./bootstrap/create-socket-server');
const startHttpServer = require('./bootstrap/start-http-server');
const initializeRuntimeServices = require('./bootstrap/init-runtime-services');
const registerSocketFcmHandlers = require('./bootstrap/register-socket-fcm-handlers');
const setupEventBusAndWorkers = require('./bootstrap/setup-eventbus-workers');
const registerSocketAuthenticateHandler = require('./bootstrap/register-socket-authenticate-handler');
const registerSocketDisconnectHandler = require('./bootstrap/register-socket-disconnect-handler');
const registerSocketCreateBookingHandler = require('./bootstrap/register-socket-create-booking-handler');
const registerSocketRideCostTelemetryHandler = require('./bootstrap/register-socket-ride-cost-telemetry-handler');
const registerSocketConfirmPaymentHandler = require('./bootstrap/register-socket-confirm-payment-handler');
const registerSocketDriverResponseHandler = require('./bootstrap/register-socket-driver-response-handler');
const registerSocketAcceptRideHandler = require('./bootstrap/register-socket-accept-ride-handler');
const registerSocketRejectRideHandler = require('./bootstrap/register-socket-reject-ride-handler');
const registerSocketStartTripHandler = require('./bootstrap/register-socket-start-trip-handler');
const registerSocketCompleteTripHandler = require('./bootstrap/register-socket-complete-trip-handler');
const registerSocketEndTripEarlyHandler = require('./bootstrap/register-socket-end-trip-early-handler');
const registerSocketDriverHeartbeatHandler = require('./bootstrap/register-socket-driver-heartbeat-handler');
const registerSocketUpdateLocationHandler = require('./bootstrap/register-socket-update-location-handler');
const registerSocketSearchDriversHandler = require('./bootstrap/register-socket-search-drivers-handler');
const registerSocketCancelDriverSearchHandler = require('./bootstrap/register-socket-cancel-driver-search-handler');
const registerSocketUpdateTripLocationHandler = require('./bootstrap/register-socket-update-trip-location-handler');
const registerSocketTripIntegrityHandlers = require('./bootstrap/register-socket-trip-integrity-handlers');
const registerSocketCancelRideHandler = require('./bootstrap/register-socket-cancel-ride-handler');
const registerSocketSafetySupportHandlers = require('./bootstrap/register-socket-safety-support-handlers');
const registerSocketEngagementChatHandlers = require('./bootstrap/register-socket-engagement-chat-handlers');
const registerSocketActiveRideHandlers = require('./bootstrap/register-socket-active-ride-handlers');
const registerSocketDriverControlHandlers = require('./bootstrap/register-socket-driver-control-handlers');

// Importar logger primeiro (necessário para logs abaixo)
const { logStructured, logError, logCommand, logEvent } = require('./utils/logger');
const {
    buildRuntimeCorsConfig
} = require('./utils/runtime-cors-config');

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
const rideCostTelemetryService = require('./services/ride-cost-telemetry-service');
const pricingH3ReadModelService = require('./services/pricing-h3-read-model-service');
const ConnectionCleanupService = require('./services/connection-cleanup-service');
const vehicleLockManager = require('./services/vehicle-lock-manager');
const driverLockManager = require('./services/driver-lock-manager');
const FCMService = require('./services/fcm-service');
const fcmService = new FCMService(); // Singleton local ao worker
const {
    driverMatchesRidePreferences
} = require('./services/ride-dispatch-preference-service');
const driverEligibilityService = require('./services/driver-eligibility-service');
// =========================================================================================

// ==================== IMPORTAÇÕES REFATORAÇÃO: COMMANDS E LISTENERS ====================
const setupListeners = require('./listeners/setupListeners');
const RequestRideCommand = require('./commands/RequestRideCommand');
const AcceptRideCommand = require('./commands/AcceptRideCommand');
const StartTripCommand = require('./commands/StartTripCommand');
const CompleteTripCommand = require('./commands/CompleteTripCommand');
const CancelRideCommand = require('./commands/CancelRideCommand');
const EndRideEarlyByRiderCommand = require('./commands/EndRideEarlyByRiderCommand');
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
    endSpanSuccess,
    endSpanError,
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
const kycPolicyService = require('./services/kyc-policy-service');
const { resolveBiometricPolicy } = require('./services/kyc-biometric-production-policy');
const driverActivationStateService = require('./services/driver-activation-state-service');
const { recordIngest, getStatus: getOtelIngestStatus } = require('./utils/otel-ingest-monitor');
// ============================================================================================

// Configurações otimizadas para VPS com recursos limitados
const VPS_CONFIG = {
    MAX_CONNECTIONS: 10000, // Reduzido para VPS
    MAX_REQUESTS_PER_SECOND: 5000, // Reduzido para VPS
    CLUSTER_WORKERS: Math.min(os.cpus().length, 6), // Usa até 6 workers por padrão em hosts maiores
    MEMORY_LIMIT: '512MB', // Limite de memória para VPS
    TIMEOUT: 30000 // Timeout aumentado para conexões mais lentas
};

// Cache curto para reduzir custo de verifyIdToken em picos de reconexão/reautenticação.
const AUTH_TOKEN_CACHE_TTL_MS = Number.parseInt(process.env.AUTH_TOKEN_CACHE_TTL_MS || '120000', 10);
const AUTH_TOKEN_CACHE_MAX = Number.parseInt(process.env.AUTH_TOKEN_CACHE_MAX || '5000', 10);
const authTokenCache = new Map();
const authTokenVerifyInFlight = new Map();
const integratedKYCService = new IntegratedKYCService();

// Admission control para reduzir picos de handshake/socket em bursts.
const SOCKET_ADMISSION_ENABLED = process.env.SOCKET_ADMISSION_ENABLED !== 'false';
const SOCKET_ADMISSION_MAX_INFLIGHT = Number.parseInt(process.env.SOCKET_ADMISSION_MAX_INFLIGHT || '220', 10);
const SOCKET_ADMISSION_MAX_QUEUE = Number.parseInt(process.env.SOCKET_ADMISSION_MAX_QUEUE || '1200', 10);
const SOCKET_ADMISSION_MAX_WAIT_MS = Number.parseInt(process.env.SOCKET_ADMISSION_MAX_WAIT_MS || '2500', 10);
const SOCKET_ADMISSION_HOLD_MS = Number.parseInt(process.env.SOCKET_ADMISSION_HOLD_MS || '10000', 10);
let socketAdmissionInFlight = 0;
const socketAdmissionQueue = [];

const ENABLE_LEGACY_SOCKET_NOTIFICATIONS =
    String(process.env.ENABLE_LEGACY_SOCKET_NOTIFICATIONS || 'false').toLowerCase() === 'true';
const ENABLE_LEGACY_SOCKET_BRIDGE =
    String(process.env.ENABLE_LEGACY_SOCKET_BRIDGE || 'false').toLowerCase() === 'true';

// Lane dedicada para autenticação para evitar rajadas de verifyIdToken simultâneas.
const AUTH_VERIFY_ADMISSION_ENABLED = process.env.AUTH_VERIFY_ADMISSION_ENABLED !== 'false';
const AUTH_VERIFY_MAX_INFLIGHT = Number.parseInt(process.env.AUTH_VERIFY_MAX_INFLIGHT || '160', 10);
const AUTH_VERIFY_MAX_QUEUE = Number.parseInt(process.env.AUTH_VERIFY_MAX_QUEUE || '1200', 10);
const AUTH_VERIFY_MAX_WAIT_MS = Number.parseInt(process.env.AUTH_VERIFY_MAX_WAIT_MS || '6000', 10);
let authVerifyInFlight = 0;
const authVerifyQueue = [];

function fingerprintToken(token) {
    if (!token || typeof token !== 'string') return '';
    return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanupAuthTokenCache() {
    const now = Date.now();
    for (const [token, cached] of authTokenCache.entries()) {
        if (!cached || cached.expiresAt <= now) {
            authTokenCache.delete(token);
        }
    }
    if (authTokenCache.size > AUTH_TOKEN_CACHE_MAX) {
        const overflow = authTokenCache.size - AUTH_TOKEN_CACHE_MAX;
        let dropped = 0;
        for (const token of authTokenCache.keys()) {
            authTokenCache.delete(token);
            dropped += 1;
            if (dropped >= overflow) break;
        }
    }
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
            reject(new Error('AUTH_BUSY_TIMEOUT'));
        }, AUTH_VERIFY_MAX_WAIT_MS);
    });
}

async function verifyFirebaseTokenCached(token) {
    const now = Date.now();
    const cached = authTokenCache.get(token);
    if (cached && cached.expiresAt > now) {
        return cached.uid;
    }

    if (authTokenVerifyInFlight.has(token)) {
        return authTokenVerifyInFlight.get(token);
    }

    const verifyPromise = (async () => {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const nowInner = Date.now();
        const tokenExpMs = decodedToken?.exp ? decodedToken.exp * 1000 : nowInner + AUTH_TOKEN_CACHE_TTL_MS;
        const cacheExpiresAt = Math.min(tokenExpMs, nowInner + AUTH_TOKEN_CACHE_TTL_MS);
        authTokenCache.set(token, {
            uid: decodedToken.uid,
            expiresAt: cacheExpiresAt
        });

        if (authTokenCache.size % 100 === 0 || authTokenCache.size > AUTH_TOKEN_CACHE_MAX) {
            cleanupAuthTokenCache();
        }

        return decodedToken.uid;
    })();

    authTokenVerifyInFlight.set(token, verifyPromise);
    try {
        return await verifyPromise;
    } finally {
        authTokenVerifyInFlight.delete(token);
    }
}

// Cluster mode otimizado para VPS - DESABILITADO TEMPORARIAMENTE (causa "Session ID unknown")
// TODO: Implementar sticky sessions ou Redis adapter para Socket.IO antes de reativar cluster
if (false && cluster.isMaster && process.env.NODE_ENV === 'production') {
    logStructured('info', `Iniciando ${VPS_CONFIG.CLUSTER_WORKERS} workers otimizados para VPS`, { service: 'server', workers: VPS_CONFIG.CLUSTER_WORKERS });

    for (let i = 0; i < VPS_CONFIG.CLUSTER_WORKERS; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        logStructured('warn', 'Worker morreu. Reiniciando...', { service: 'server', workerPid: worker.process.pid, code, signal });
        cluster.fork();
    });

    cluster.on('online', (worker) => {
        logStructured('info', 'Worker online', { service: 'server', workerPid: worker.process.pid });
    });
} else {
    // Modo desenvolvimento - sem cluster (ou cluster desabilitado)
    logStructured('info', 'Executando servidor único (cluster desabilitado para evitar Session ID unknown)', { service: 'server' });
}
// ✅ FASE 1.3: Inicializar OpenTelemetry ANTES de tudo
initializeTracer();

// Worker process
const app = express();
const server = http.createServer(app);

// Necessário atrás de Nginx/Load Balancer para rate limit e IP real funcionarem corretamente.
app.set('trust proxy', 1);

// Health check ultra-rápido antes de middlewares pesados (rate limit/redis/etc)
app.get('/health/liveness', (_req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString()
    });
});

const { corsOptions } = buildRuntimeCorsConfig({
    env: process.env,
    logger: logStructured,
    serviceName: 'server'
});

configureHttpMiddleware({
    app,
    server,
    express,
    cors,
    corsOptions,
    traceIdExpressMiddleware,
    recordIngest,
    getOtelIngestStatus,
    logStructured
});

registerHttpRoutes({
    app,
    logStructured
});

const io = createSocketServer({
    server,
    socketIo,
    corsOptions,
    app,
    logStructured
});

// Disponibiliza io para rotas HTTP que precisam publicar eventos realtime.
app.set('io', io);
app.locals.io = io;

// Injeção explícita de Socket.IO nas rotas de suporte HTTP.
// O registerHttpRoutes é executado antes da criação do io.
try {
    const supportRoutes = require('./routes/support');
    if (supportRoutes.setIOInstance) {
        supportRoutes.setIOInstance(io);
    }
} catch (error) {
    logStructured('warn', 'Falha ao injetar io nas rotas de suporte', {
        service: 'server',
        error: error.message
    });
}

// ✅ REMOVIDO: Health check antigo (linha 504-571)
// A rota /health agora é gerenciada por healthRoutes (linha 362)
// que inclui: /health, /health/quick, /health/readiness, /health/liveness

registerRuntimeEndpoints({
    app,
    io,
    VPS_CONFIG,
    logStructured
});

const {
    responseHandler,
    gradualExpander
} = initializeRuntimeServices({
    io,
    ResponseHandler,
    GradualRadiusExpander,
    RadiusExpansionManager,
    QueueWorker,
    queueMonitoringRoutes,
    redisPool,
    logStructured
});

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

async function enforceSubscriptionForOnline(driverId) {
    if (!driverId) {
        return {
            allowed: false,
            reason: 'driverId ausente',
            code: 'driverIdMissing'
        };
    }

    if (process.env.SUBSCRIPTION_ONLINE_GATE_ENABLED === 'false') {
        return {
            allowed: true,
            reason: 'Gate de assinatura desabilitado',
            code: 'subscriptionGateDisabled'
        };
    }

    try {
        const db = firebaseConfig.getRealtimeDB();
        if (!db) {
            return {
                allowed: true,
                reason: 'Realtime DB indisponível (fail-open)',
                code: 'subscriptionCheckSkipped'
            };
        }

        const [userSnapshot, subscriptionSnapshot] = await Promise.all([
            db.ref(`users/${driverId}`).once('value'),
            db.ref(`subscriptions/${driverId}`).once('value')
        ]);

        const userData = userSnapshot.val() || {};
        const subscriptionData = subscriptionSnapshot.val() || {};

        const billingStatus = String(userData.billing_status || userData.billingStatus || '').toLowerCase();
        const subscriptionStatus = String(subscriptionData.status || userData.subscriptionStatus || '').toLowerCase();
        const pendingFeeCents = Number(subscriptionData.pendingFeeCents || userData.subscription_pending_fee_cents || 0);
        const gracePeriodEndsAtRaw = subscriptionData.gracePeriodEndsAt || userData.subscription_grace_period_ends_at || null;
        const gracePeriodEndsAtTs = gracePeriodEndsAtRaw ? Date.parse(gracePeriodEndsAtRaw) : Number.NaN;
        const gracePeriodExpired = Number.isFinite(gracePeriodEndsAtTs) ? gracePeriodEndsAtTs < Date.now() : false;
        const blockAfterGraceEnabled =
            String(process.env.SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY || 'false').toLowerCase() === 'true';

        const statusBlocked = subscriptionStatus === 'blocked' || subscriptionStatus === 'cancelled' || billingStatus === 'suspended';
        const blockedAfterGrace = blockAfterGraceEnabled && subscriptionStatus === 'grace_period' && gracePeriodExpired;

        if (statusBlocked || blockedAfterGrace) {
            return {
                allowed: false,
                reason: 'Assinatura bloqueada para ficar online',
                code: 'subscriptionBlocked',
                details: {
                    billingStatus,
                    subscriptionStatus,
                    pendingFeeCents,
                    gracePeriodEndsAt: gracePeriodEndsAtRaw || null
                }
            };
        }

        return {
            allowed: true,
            reason: 'Assinatura válida',
            code: 'subscriptionActive',
            details: {
                billingStatus: billingStatus || 'active',
                subscriptionStatus: subscriptionStatus || 'active',
                pendingFeeCents
            }
        };
    } catch (error) {
        logStructured('warn', 'Falha no gate de assinatura (fail-open)', {
            service: 'server',
            operation: 'enforceSubscriptionForOnline',
            driverId,
            error: error.message
        });
        return {
            allowed: true,
            reason: 'Falha ao validar assinatura (fail-open)',
            code: 'subscriptionCheckFailed'
        };
    }
}

async function enforceDailyKYCForOnline(driverId) {
    if (!driverId) {
        return {
            allowed: false,
            reason: 'driverId ausente',
            code: 'driverIdMissing'
        };
    }

    try {
        const activationState = await driverActivationStateService.resolveDriverActivationState({ driverId });
        if (activationState?.canGoOnline && !activationState?.requiresLiveness) {
            return {
                allowed: true,
                reason: 'Motorista apto pela politica canonica de ativacao.',
                code: 'driverActivationActive',
                details: activationState
            };
        }
        if (activationState && !activationState.canAttemptOnline) {
            return {
                allowed: false,
                reason: activationState.blockingReason || 'Motorista nao apto para ficar online.',
                code: activationState.requiresLiveness ? 'kycRequired' : 'driverActivationBlocked',
                requirement: activationState.requiresLiveness ? 'LIVENESS_REQUIRED' : undefined,
                details: activationState
            };
        }

        const approvalGate = await kycPolicyService.requireApprovedKyc(driverId);
        if (!approvalGate.allowed) {
            return {
                allowed: false,
                reason: approvalGate.reason,
                code: approvalGate.code,
                details: approvalGate
            };
        }
    } catch (error) {
        logStructured('warn', 'Falha no gate de status KYC para online (fail-closed)', {
            service: 'server',
            operation: 'enforceDailyKYCForOnline',
            driverId,
            error: error.message
        });
        return {
            allowed: false,
            reason: 'Nao foi possivel validar o status KYC agora.',
            code: 'KYC_STATUS_CHECK_FAILED'
        };
    }

    if (process.env.DAILY_KYC_ONLINE_GATE_ENABLED === 'false') {
        return {
            allowed: true,
            reason: 'Gate KYC diário desabilitado',
            code: 'kycGateDisabled'
        };
    }

    const maxAgeHours = Number.parseInt(process.env.KYC_DAILY_MAX_AGE_HOURS || '24', 10);
    const safeMaxAgeHours = Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : 24;

    try {
        const verification = await integratedKYCService.hasValidVerification(driverId, safeMaxAgeHours);

        if (verification?.hasValid) {
            return {
                allowed: true,
                reason: 'KYC diário válido',
                code: 'kycValid',
                details: verification
            };
        }

        return {
            allowed: false,
            reason: verification?.reason || 'Verificação facial diária necessária',
            code: 'kycRequired',
            requirement: 'LIVENESS_REQUIRED',
            challenge: await kycPolicyService.createStepUpChallenge({
                driverId,
                requirement: 'LIVENESS_REQUIRED',
                score: 100,
                source: 'driver_online',
                signals: [
                    {
                        code: 'KYC_STALE_OR_MISSING',
                        weight: 100,
                        message: verification?.reason || 'Verificação facial diária necessária',
                        details: {
                            maxAgeHours: safeMaxAgeHours
                        }
                    }
                ]
            }).catch((challengeError) => {
                logStructured('warn', 'Falha ao criar challenge KYC para online', {
                    service: 'server',
                    operation: 'enforceDailyKYCForOnline',
                    driverId,
                    error: challengeError.message
                });
                return null;
            })
        };
    } catch (error) {
        const biometricPolicy = resolveBiometricPolicy(process.env);
        const failClosed = biometricPolicy.productionBiometricsEnabled;
        logStructured('warn', `Falha no gate KYC diário (${failClosed ? 'fail-closed' : 'fail-open'})`, {
            service: 'server',
            operation: 'enforceDailyKYCForOnline',
            driverId,
            error: error.message
        });
        if (failClosed) {
            return {
                allowed: false,
                reason: 'Nao foi possivel validar KYC diario agora.',
                code: 'KYC_DAILY_CHECK_FAILED'
            };
        }
        return {
            allowed: true,
            reason: 'Falha ao validar KYC diário (fail-open)',
            code: 'kycCheckFailedOpen'
        };
    }
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
    const rideRequirements = {
        pickupLocation,
        destinationLocation: options.destinationLocation || options.destination || null,
        preferences: options.preferences || {},
        carType: options.carType || options.requestedCarType || options.vehicleCategory || null
    };
    const eligibleDriverGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
    const georadiusCount = Math.max(limit * 3, limit);
    const nearbyDrivers = await redis.georadius(
        eligibleDriverGeoKey,
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

        const preferenceMatch = driverMatchesRidePreferences(driverData, rideRequirements);
        if (!preferenceMatch.ok) continue;

        if (rideRequirements.carType) {
            const eligibility = await driverEligibilityService.isDriverEligibleForRide(
                driverId,
                rideRequirements.carType,
                driverData
            );
            if (!eligibility?.eligible) continue;
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
            category: driverData.vehicleCategory || null,
            rating: Number.parseFloat(driverData.rating || '5.0'),
            dispatchPreferenceMatch: preferenceMatch.reason
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
const saveDriverLocation = async (driverId, lat, lng, heading = 0, speed = 0, timestamp = Date.now(), isOnline = true, isInTrip = false) => {
    try {
        const redis = redisPool.getConnection();

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

        // 1. Salvar status completo do motorista em driver:${driverId}
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

        await redis.hset(`driver:${driverId}`, driverStatus);

        if (isOnline) {
            // 2. Motorista ONLINE: adicionar/atualizar no GEO ativo (para match rápido)
            await redis.geoadd('driver_locations', lng, lat, driverId);
            await redis.sadd('online_drivers', driverId);

            // 3. Remover do GEO offline (se estava offline antes)
            await redis.zrem('driver_offline_locations', driverId);

            // 4. ✅ OTIMIZAÇÃO: TTL diferenciado por estado (usando configuração centralizada)
            // - Em viagem: 60 segundos (dados críticos, mas heartbeat renova a cada 30s)
            // - Online disponível: 120 segundos (heartbeat renova a cada 30s, então nunca expira se online)
            // - Heartbeat garante que motorista parado permanece online
            const { getTTL } = require('./config/redis-ttl-config');
            const ttl = isInTrip
                ? getTTL('DRIVER_LOCATION', 'IN_TRIP')
                : getTTL('DRIVER_LOCATION', 'ONLINE');
            await redis.expire(`driver:${driverId}`, ttl);

            logStructured('info', `Motorista ${isInTrip ? 'EM VIAGEM' : 'ONLINE'} salvo no Redis (GEO ativo)`, {
                service: 'server',
                driverId,
                status: isInTrip ? 'IN_TRIP' : 'ONLINE',
                location: { lat, lng },
                ttl
            });
        } else {
            // 2. Motorista OFFLINE: adicionar no GEO offline (para notificações de demanda)
            await redis.geoadd('driver_offline_locations', lng, lat, driverId);

            // 3. Remover do GEO ativo (não deve aparecer em buscas de match)
            await redis.zrem('driver_locations', driverId);
            await redis.srem('online_drivers', driverId);

            // 4. TTL longo para offline (24 horas - para notificações futuras)
            const { getTTL } = require('./config/redis-ttl-config');
            await redis.expire(`driver:${driverId}`, getTTL('DRIVER_LOCATION', 'OFFLINE'));

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_DRIVER_LOCATION === 'true') {
                logStructured('debug', 'Motorista OFFLINE salvo no Redis (GEO offline)', {
                    service: 'server',
                    driverId,
                    lat,
                    lng
                });
            }
        }

        await pricingH3ReadModelService.applyDriverSnapshot(redis, {
            driverId,
            lat,
            lng,
            isOnline,
            available: Boolean(isOnline) && !Boolean(isInTrip)
        }).catch(() => null);

    } catch (error) {
        logStructured('error', 'Erro ao salvar localização do motorista', {
            service: 'server',
            driverId,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};
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
const enableEmbeddedListenerWorkers = String(
    process.env.ENABLE_EMBEDDED_LISTENER_WORKERS || 'false'
).trim().toLowerCase() === 'true';

const { eventBus } = setupEventBusAndWorkers({
    io,
    setupListeners,
    redisPool,
    WorkerManager,
    EVENT_TYPES,
    logStructured,
    logError,
    enableEmbeddedListenerWorkers
});

// ✅ NOVO: Middleware para gerar traceId automaticamente em conexões Socket.IO
io.use(traceIdSocketMiddleware);
io.use((socket, next) => runSocketAdmission(socket, next));

startHttpServer({
    app,
    server,
    io,
    applyMiddleware,
    cluster,
    VPS_CONFIG,
    ConnectionCleanupService,
    logStructured,
    logError
});

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

    registerSocketFcmHandlers({
        socket,
        redisPool,
        fcmService,
        logStructured,
        logError
    });

    // ✅ Registrar handler de authenticate IMEDIATAMENTE após conexão
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
        logStructured('debug', 'Registrando handlers para socket', {
            service: 'websocket',
            socketId: socket.id,
            headers: socket.handshake.headers
        });
    }

    registerSocketAuthenticateHandler({
        socket,
        io,
        cluster,
        connectionMonitor,
        redisPool,
        fcmService,
        logStructured,
        authDebugEnabled,
        releaseAdmissionSlotIfNeeded,
        fingerprintToken,
        acquireAuthVerifySlot,
        verifyFirebaseTokenCached
    });

    // ==================== FASE 1: REGISTRAR TODOS OS HANDLERS CRÍTICOS (ANTES DE QUALQUER OPERAÇÃO ASSÍNCRONA) ====================
    // ✅ CRÍTICO: Registrar handlers críticos imediatamente para evitar race conditions
    // Estes handlers devem estar prontos antes de qualquer evento chegar

    registerSocketDisconnectHandler({
        socket,
        io,
        websocketRateLimiter,
        connectionMonitor,
        vehicleLockManager,
        redisPool,
        saveDriverLocation,
        logStructured,
        releaseAdmissionSlotIfNeeded
    });

    // ======================== EVENTOS DE CORRIDA ========================

    // ==================== FASE 7: createBooking - INTEGRAÇÃO COM SISTEMA DE FILAS ====================
    // Solicitar corrida (NOVO FLUXO COM FILAS E EXPANSÃO GRADUAL)
    registerSocketCreateBookingHandler({
        socket,
        io,
        extractTraceIdFromEvent,
        traceContext,
        getTracer,
        createSocketSpan,
        runInSpan,
        logStructured,
        rateLimiterService,
        getSocketMetadata,
        auditService,
        validationService,
        GeoHashUtils,
        redisPool,
        idempotencyService,
        RequestRideCommand,
        createCommandSpan,
        endSpanError,
        logCommand,
        createEventSpan,
        endSpanSuccess,
        logEvent,
        eventBus,
        metricsCollector,
        findAvailableDriversForPickup,
        rideCostTelemetryService
    });
    // =========================================================================================

    registerSocketRideCostTelemetryHandler({
        socket,
        logStructured,
        rideCostTelemetryService
    });

    // Confirmar pagamento
    registerSocketConfirmPaymentHandler({
        socket,
        io,
        extractTraceIdFromEvent,
        traceContext,
        logStructured,
        rateLimiterService,
        getSocketMetadata,
        auditService,
        validationService,
        redisPool,
        parseBookingLocation,
        findAvailableDriversForPickup,
        idempotencyService
    });

    registerSocketDriverResponseHandler({
        socket,
        io,
        logStructured
    });

    // 4. AcceptRide (crítico - aceitar corrida)
    registerSocketAcceptRideHandler({
        socket,
        io,
        redisPool,
        extractTraceIdFromEvent,
        traceContext,
        logStructured,
        getSocketMetadata,
        rateLimiterService,
        auditService,
        validationService,
        idempotencyService,
        AcceptRideCommand,
        getTracer,
        createCommandSpan,
        runInSpan,
        endSpanError,
        eventBus,
        createEventSpan,
        endSpanSuccess,
        logEvent,
        metricsCollector,
        logError
    });

    registerSocketRejectRideHandler({
        socket,
        rateLimiterService,
        logStructured,
        validationService,
        getSocketMetadata,
        auditService,
        responseHandler
    });

    // 6. StartTrip (crítico - iniciar viagem)
    registerSocketStartTripHandler({
        socket,
        io,
        extractTraceIdFromEvent,
        traceContext,
        logStructured,
        rateLimiterService,
        validationService,
        getSocketMetadata,
        auditService,
        redisPool,
        idempotencyService,
        StartTripCommand,
        getTracer,
        createCommandSpan,
        runInSpan,
        endSpanError,
        logCommand,
        eventBus,
        createEventSpan,
        logEvent,
        fcmService
    });

    // 7. UpdateTripLocation (crítico - GPS durante viagem)
    registerSocketUpdateTripLocationHandler({
        socket,
        io,
        redisPool,
        logStructured
    });

    registerSocketTripIntegrityHandlers({
        socket,
        io,
        redisPool,
        logStructured,
        CancelRideCommand,
        traceContext,
        eventBus
    });

    // 8. CompleteTrip (crítico - finalizar viagem)
    registerSocketCompleteTripHandler({
        socket,
        io,
        extractTraceIdFromEvent,
        traceContext,
        logStructured,
        rateLimiterService,
        validationService,
        getSocketMetadata,
        auditService,
        redisPool,
        idempotencyService,
        getTracer,
        createCommandSpan,
        runInSpan,
        endSpanError,
        logCommand,
        CompleteTripCommand,
        createEventSpan,
        eventBus,
        logEvent,
        fcmService
    });

    registerSocketEndTripEarlyHandler({
        socket,
        io,
        redisPool,
        logStructured,
        EndRideEarlyByRiderCommand,
        traceContext,
        eventBus
    });

    // 9. DriverHeartbeat (crítico - heartbeat GPS)
    registerSocketDriverHeartbeatHandler({
        socket,
        redisPool,
        logStructured,
        enforceSubscriptionForOnline,
        enforceDailyKYCForOnline,
        saveDriverLocation,
        vehicleLockManager
    });

    // 10. UpdateLocation + UpdateDriverLocation (crítico - GPS unificado)
    registerSocketUpdateLocationHandler({
        socket,
        io,
        rateLimiterService,
        logStructured,
        redisPool,
        enforceSubscriptionForOnline,
        enforceDailyKYCForOnline,
        saveDriverLocation
    });

    // ==================== NOVOS EVENTOS - BUSCA E MATCHING DE DRIVERS ====================

    // Buscar motoristas próximos
    registerSocketSearchDriversHandler({
        socket,
        rateLimiterService,
        logStructured,
        findAvailableDriversForPickup
    });

    // Cancelar busca de motoristas
    registerSocketCancelDriverSearchHandler({
        socket,
        logStructured
    });

    // ==================== NOVOS EVENTOS - GERENCIAMENTO DE CORRIDAS ====================

    // Cancelar corrida (com reembolso automático PIX)
    // ==================== FASE 7: cancelRide - CANCELAMENTO DE CORRIDA ====================
    registerSocketCancelRideHandler({
        socket,
        io,
        extractTraceIdFromEvent,
        traceContext,
        logStructured,
        rateLimiterService,
        redisPool,
        RideStateManager,
        gradualExpander,
        GeoHashUtils,
        rideQueueManager,
        getTracer,
        createCommandSpan,
        runInSpan,
        endSpanError,
        logCommand,
        CancelRideCommand,
        createEventSpan,
        eventBus,
        logEvent,
        PaymentService,
        idempotencyService,
        fcmService
    });
    // =========================================================================================

    registerSocketSafetySupportHandlers({
        socket,
        io,
        logStructured
    });

    registerSocketEngagementChatHandlers({
        socket,
        io,
        logStructured,
        rateLimiterService,
        redisPool
    });

    registerSocketActiveRideHandlers({
        socket,
        io,
        redisPool,
        gradualExpander,
        logStructured,
        logError
    });

    registerSocketDriverControlHandlers({
        socket,
        io,
        redisPool,
        logStructured,
        idempotencyService,
        enforceSubscriptionForOnline,
        enforceDailyKYCForOnline
    });

    if (ENABLE_LEGACY_SOCKET_NOTIFICATIONS) {
        const registerSocketLegacyNotificationHandlers = require('./bootstrap/register-socket-legacy-notification-handlers');
        registerSocketLegacyNotificationHandlers({
            socket,
            logStructured,
            logError
        });
    }

    if (ENABLE_LEGACY_SOCKET_BRIDGE) {
        const registerSocketLegacyBridgeHandler = require('./bootstrap/register-socket-legacy-bridge-handler');
        registerSocketLegacyBridgeHandler({
            socket,
            io,
            redisPool,
            logStructured
        });
    } else {
        const registerSocketRatingHandler = require('./bootstrap/register-socket-rating-handler');
        registerSocketRatingHandler({
            socket,
            io,
            logStructured
        });
    }
    }); // Fecha io.on('connection')

    // Graceful shutdown (registrar uma única vez por processo)
    if (!process.__leafShutdownHandlersRegistered) {
        process.__leafShutdownHandlersRegistered = true;
        let shuttingDown = false;
        const gracefulShutdown = async (signal) => {
            if (shuttingDown) {
                logStructured('warn', `Shutdown já em andamento (${signal})`, { service: 'server' });
                return;
            }

            shuttingDown = true;
            process.__leafIsShuttingDown = true;
            logStructured('info', `Recebido ${signal}, fechando servidor`, { service: 'server' });

            const hardTimeoutMs = Number.parseInt(process.env.SHUTDOWN_FORCE_TIMEOUT_MS || '15000', 10);
            const hardTimeout = setTimeout(() => {
                logStructured('error', 'Timeout de shutdown atingido, encerrando processo forçadamente', { service: 'server' });
                process.exit(1);
            }, hardTimeoutMs);
            if (typeof hardTimeout.unref === 'function') {
                hardTimeout.unref();
            }

            try {
                if (io && typeof io.close === 'function') {
                    await new Promise((resolve) => io.close(() => resolve()));
                }
            } catch (ioError) {
                logStructured('warn', 'Falha ao fechar Socket.IO durante shutdown', {
                    service: 'server',
                    error: ioError.message
                });
            }

            await new Promise((resolve) => {
                try {
                    server.close(() => resolve());
                } catch (_) {
                    resolve();
                }
            });

            try {
                await redisPool.shutdown({ timeoutMs: 5000 });
            } catch (redisShutdownError) {
                logStructured('warn', 'Falha ao encerrar Redis Pool durante shutdown', {
                    service: 'server',
                    error: redisShutdownError.message
                });
            }

            try {
                await shutdownTracer();
            } catch (tracerError) {
                logStructured('warn', 'Falha ao encerrar tracer durante shutdown', {
                    service: 'server',
                    error: tracerError.message
                });
            }

            clearTimeout(hardTimeout);
            process.exit(0);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    }
