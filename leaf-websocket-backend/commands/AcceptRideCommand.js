/**
 * COMMAND: AcceptRideCommand
 * 
 * Processa aceitação de corrida por motorista.
 * 
 * Responsabilidades:
 * - Validar que corrida pode ser aceita
 * - Atualizar estado da corrida
 * - Atribuir motorista à corrida
 * - Construir evento canônico ride.accepted (publicação ocorre no handler/EventBus)
 * 
 * NÃO faz:
 * - Notificar passageiro (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideAcceptedEvent = require('../events/ride.accepted');
const RideStateManager = require('../services/ride-state-manager');
const redisPool = require('../utils/redis-pool');
const driverLockManager = require('../services/driver-lock-manager');
const driverEligibilityService = require('../services/driver-eligibility-service');
const { logger, logStructured } = require('../utils/logger');
const eventSourcing = require('../services/event-sourcing');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const {
    ACTIVE_TRIP_TTL_SECONDS,
    activeTripKey,
    activeTripCustomerKey,
    identityVerificationKey,
    identityPolicyMutationKey,
    activeStepUpChallengeKey
} = require('../utils/active-trip-index');
const { resolveAcceptRidePayload } = require('../utils/accept-ride-payload');
const {
    rehydratePrimaryBooking,
    writeVisibleBookingSnapshot
} = require('../services/booking-visibility-service');
const {
    hasOfferReservation,
    clearOfferReservationsForBooking
} = require('../services/offer-reservation-service');

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseLocationCandidate(rawValue) {
    if (!rawValue) return null;
    if (typeof rawValue === 'object') {
        const lat = toFiniteNumber(rawValue.lat);
        const lng = toFiniteNumber(rawValue.lng);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    }

    try {
        const parsed = JSON.parse(rawValue);
        const lat = toFiniteNumber(parsed?.lat);
        const lng = toFiniteNumber(parsed?.lng);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    } catch (_error) {
        return null;
    }
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
    const nLat1 = toFiniteNumber(lat1);
    const nLng1 = toFiniteNumber(lng1);
    const nLat2 = toFiniteNumber(lat2);
    const nLng2 = toFiniteNumber(lng2);
    if ([nLat1, nLng1, nLat2, nLng2].some((entry) => entry === null)) {
        return null;
    }

    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(nLat2 - nLat1);
    const dLng = toRad(nLng2 - nLng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2))
        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const earthRadiusKm = 6371;
    return earthRadiusKm * c;
}

function estimateEtaMinutesFromDistanceKm(distanceKm) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
        return null;
    }
    // Estimativa conservadora (~27 km/h em tráfego urbano)
    const minutes = Math.round(distanceKm / 0.45);
    return Math.max(1, minutes);
}

class AcceptRideCommand extends Command {
    constructor(data) {
        super(data);
        this.driverId = data.driverId;
        this.bookingId = data.bookingId;
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'AcceptRide');
        this.correlationId = data.correlationId || this.bookingId; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.driverId) {
            throw new Error('AcceptRideCommand: driverId é obrigatório');
        }
        if (!this.bookingId) {
            throw new Error('AcceptRideCommand: bookingId é obrigatório');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId
        return await traceContext.runWithTraceId(this.traceId, async () => {
            let driverRideLockManaged = false;
            let bookingAcceptanceCommitted = false;
            const releaseManagedRideLock = async () => {
                if (!driverRideLockManaged || bookingAcceptanceCommitted) {
                    return;
                }
                try {
                    const lockedBooking = await driverLockManager.getLockedBooking(this.driverId);
                    if (lockedBooking === this.bookingId) {
                        await driverLockManager.releaseLock(this.driverId);
                    }
                } finally {
                    driverRideLockManaged = false;
                }
            };
            try {
                logStructured('info', 'AcceptRideCommand.execute iniciado', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'AcceptRideCommand'
                });

                // Validar
                this.validate();

                // Garantir conexão Redis
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                const bookingKey = `booking:${this.bookingId}`;
                const normalizeState = (value) => String(value || '').trim().toUpperCase();
                const bookingExists = await redis.exists(bookingKey);
                if (!bookingExists) {
                    await rehydratePrimaryBooking(redis, this.bookingId, {
                        state: RideStateManager.STATES.PENDING,
                        status: 'PENDING'
                    });
                }

                const activeNotificationKey = `driver_active_notification:${this.driverId}`;
                const [activeBookingId, bookingTuple] = await Promise.all([
                    redis.get(activeNotificationKey),
                    redis.hmget(
                        bookingKey,
                        'driverId',
                        'state',
                        'status',
                        'carType',
                        'requestedCarType',
                        'vehicleCategory',
                        'vehicleType'
                    )
                ]);
                const reservationActive = await hasOfferReservation(redis, this.bookingId, this.driverId);
                const currentDriverId = String(bookingTuple?.[0] || '');
                const currentStateUpper = normalizeState(bookingTuple?.[1]);
                const currentStatusUpper = normalizeState(bookingTuple?.[2]);
                const requestedCategory =
                    bookingTuple?.[3] ||
                    bookingTuple?.[4] ||
                    bookingTuple?.[5] ||
                    bookingTuple?.[6] ||
                    null;
                const snapshotSuggestsAlreadyOwnedBySameDriver =
                    (
                        currentStateUpper === 'ACCEPTED' ||
                        currentStatusUpper === 'ACCEPTED' ||
                        currentStateUpper === 'IN_PROGRESS' ||
                        currentStatusUpper === 'IN_PROGRESS' ||
                        currentStatusUpper === 'STARTED'
                    ) &&
                    currentDriverId === String(this.driverId);

                // O snapshot acima serve apenas para decidir se vale executar a prova
                // atômica. Ele nunca autoriza, sozinho, pular oferta/elegibilidade.
                let atomicallyConfirmedIdempotentResult = null;
                if (snapshotSuggestsAlreadyOwnedBySameDriver) {
                    const idempotencyProbeScript = `
                        local bookingKey = KEYS[1]
                        local activeTripKey = KEYS[2]
                        local activeTripCustomerKey = KEYS[3]
                        local driverKey = KEYS[4]
                        local driverId = ARGV[1]
                        local bookingId = ARGV[2]
                        local activeTripTtl = ARGV[3]
                        local updatedAt = ARGV[4]
                        if redis.call('EXISTS', bookingKey) == 0 then
                            return 'ERR_NOT_FOUND'
                        end
                        local state = string.upper(redis.call('HGET', bookingKey, 'state') or '')
                        local status = string.upper(redis.call('HGET', bookingKey, 'status') or '')
                        local currentDriverId = tostring(redis.call('HGET', bookingKey, 'driverId') or '')
                        local alreadyOwned = (
                            state == 'ACCEPTED' or
                            status == 'ACCEPTED' or
                            state == 'IN_PROGRESS' or
                            status == 'IN_PROGRESS' or
                            status == 'STARTED'
                        ) and currentDriverId == tostring(driverId)
                        if not alreadyOwned then
                            return 'NOT_ALREADY_OWNED'
                        end
                        local customerId = redis.call('HGET', bookingKey, 'customerId')
                        local pickupLoc = redis.call('HGET', bookingKey, 'pickupLocation')
                        redis.call('SET', activeTripKey, bookingId, 'EX', activeTripTtl)
                        if customerId and customerId ~= '' then
                            redis.call('SET', activeTripCustomerKey, customerId, 'EX', activeTripTtl)
                        end
                        redis.call('HSET', driverKey,
                            'activeTripId', bookingId,
                            'activeTripUpdatedAt', updatedAt
                        )
                        return 'OK_ALREADY_ACCEPTED|||' .. (customerId or '') .. '|||' .. (pickupLoc or '')
                    `;
                    const probeResult = await redis.eval(
                        idempotencyProbeScript,
                        4,
                        bookingKey,
                        activeTripKey(this.driverId),
                        activeTripCustomerKey(this.driverId),
                        `driver:${this.driverId}`,
                        this.driverId,
                        this.bookingId,
                        String(ACTIVE_TRIP_TTL_SECONDS),
                        new Date().toISOString()
                    );
                    if (
                        typeof probeResult === 'string' &&
                        probeResult.startsWith('OK_ALREADY_ACCEPTED|||')
                    ) {
                        atomicallyConfirmedIdempotentResult = probeResult;
                        bookingAcceptanceCommitted = true;
                    }
                }

                if (
                    !atomicallyConfirmedIdempotentResult &&
                    activeBookingId !== this.bookingId &&
                    !reservationActive
                ) {
                    logStructured('warn', 'AcceptRideCommand bloqueado por oferta indisponivel', {
                        command: 'AcceptRideCommand',
                        driverId: this.driverId,
                        bookingId: this.bookingId,
                        activeBookingId: activeBookingId || null,
                        reservationActive,
                        currentDriverId: currentDriverId || null,
                        currentState: currentStateUpper || null,
                        currentStatus: currentStatusUpper || null
                    });
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Oferta expirada para este motorista. Aguarde uma nova solicitação.');
                }

                if (!atomicallyConfirmedIdempotentResult) {
                    let canonicalEligibility;
                    try {
                        canonicalEligibility = await driverEligibilityService.isDriverEligibleForRide(
                            this.driverId,
                            requestedCategory
                        );
                    } catch (error) {
                        logStructured('error', 'AcceptRideCommand falhou ao revalidar elegibilidade canônica', {
                            command: 'AcceptRideCommand',
                            driverId: this.driverId,
                            bookingId: this.bookingId,
                            error: error?.message || String(error)
                        });
                        metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                        return CommandResult.failure('Não foi possível validar a elegibilidade do motorista agora.');
                    }

                    if (!canonicalEligibility?.eligible) {
                        logStructured('warn', 'AcceptRideCommand bloqueado por elegibilidade canônica', {
                            command: 'AcceptRideCommand',
                            driverId: this.driverId,
                            bookingId: this.bookingId,
                            requestedCategory,
                            eligibilityCode: canonicalEligibility?.code || 'NOT_ELIGIBLE'
                        });
                        metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                        return CommandResult.failure('Motorista não está elegível para receber esta corrida.');
                    }
                }

                // Garantir lock da corrida aceita (evita re-oferta até completeTrip/cancelRide).
                const lockStatus = await driverLockManager.isDriverLocked(this.driverId);
                if (lockStatus.isLocked && lockStatus.bookingId !== this.bookingId) {
                    // Lock pode ficar residual após falhas/restarts; recuperar automaticamente quando stale.
                    let staleLockDetected = false;
                    try {
                        const [lockStateRaw, lockStatusRaw] = await redis.hmget(
                            `booking:${lockStatus.bookingId}`,
                            'state',
                            'status'
                        );
                        const lockState = normalizeState(lockStateRaw);
                        const lockBookingStatus = normalizeState(lockStatusRaw);
                        const terminalStates = new Set([
                            'COMPLETED',
                            'CANCELED',
                            'CANCELLED',
                            'REJECTED',
                            'EXPIRED',
                            'NO_DRIVERS_FOUND'
                        ]);
                        staleLockDetected = (
                            (!lockState && !lockBookingStatus) ||
                            terminalStates.has(lockState) ||
                            terminalStates.has(lockBookingStatus)
                        );
                    } catch (_lockInspectError) {
                        staleLockDetected = false;
                    }

                    if (staleLockDetected) {
                        await driverLockManager.releaseLock(this.driverId);
                        logStructured('warn', 'Lock stale recuperado durante AcceptRideCommand', {
                            command: 'AcceptRideCommand',
                            driverId: this.driverId,
                            previousBookingId: lockStatus.bookingId,
                            newBookingId: this.bookingId
                        });
                    } else {
                        metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                        return CommandResult.failure('Motorista já está em outra corrida');
                    }
                }

                const lockStatusAfterRecovery = await driverLockManager.isDriverLocked(this.driverId);
                if (lockStatusAfterRecovery.isLocked && lockStatusAfterRecovery.bookingId !== this.bookingId) {
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Motorista já está em outra corrida');
                }

                const acceptedRideLockTtlSeconds = 3600;
                let rideLockReady = false;
                if (lockStatusAfterRecovery.isLocked && lockStatusAfterRecovery.bookingId === this.bookingId) {
                    rideLockReady = await driverLockManager.renewLock(
                        this.driverId,
                        acceptedRideLockTtlSeconds
                    );
                }

                if (!rideLockReady) {
                    rideLockReady = await driverLockManager.acquireLock(
                        this.driverId,
                        this.bookingId,
                        acceptedRideLockTtlSeconds
                    );
                }

                if (!rideLockReady) {
                    // Dois aceites concorrentes da mesma corrida podem observar o lock
                    // em momentos diferentes. Só prosseguir se o lock atual for desta
                    // corrida e seu TTL puder ser renovado de forma explícita.
                    const lockAfterRace = await driverLockManager.getLockedBooking(this.driverId);
                    rideLockReady = lockAfterRace === this.bookingId
                        ? await driverLockManager.renewLock(
                            this.driverId,
                            acceptedRideLockTtlSeconds
                        )
                        : false;
                }

                if (!rideLockReady) {
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Motorista já está em outra corrida');
                }
                driverRideLockManaged = true;

                const newState = RideStateManager.STATES.ACCEPTED;
                const updatedAt = new Date().toISOString();
                const bookingOwnershipToken = `${this.bookingId}:${this.driverId}:${Date.now()}`;

                // LUA Script Atômico para garantir lock transacional absoluto do Booking
                const luaScript = `
                    local bookingKey = KEYS[1]
                    local activeTripKey = KEYS[2]
                    local activeTripCustomerKey = KEYS[3]
                    local driverKey = KEYS[4]
                    local identityVerificationKey = KEYS[5]
                    local identityPolicyMutationKey = KEYS[6]
                    local activeStepUpChallengeKey = KEYS[7]
                    local driverId = ARGV[1]
                    local newState = ARGV[2]
                    local updatedAt = ARGV[3]
                    local bookingId = ARGV[5]
                    local activeTripTtl = ARGV[6]

                    if redis.call('EXISTS', bookingKey) == 0 then
                        return 'ERR_NOT_FOUND'
                    end

                    local currentState = redis.call('HGET', bookingKey, 'state')
                    local currentStatus = redis.call('HGET', bookingKey, 'status')
                    local currentDriverId = redis.call('HGET', bookingKey, 'driverId')
                    local currentStateUpper = string.upper(currentState or '')
                    local currentStatusUpper = string.upper(currentStatus or '')
                    local alreadyOwnedBySameDriver = (
                        currentStateUpper == 'ACCEPTED' or
                        currentStatusUpper == 'ACCEPTED' or
                        currentStateUpper == 'IN_PROGRESS' or
                        currentStatusUpper == 'IN_PROGRESS' or
                        currentStatusUpper == 'STARTED'
                    ) and tostring(currentDriverId or '') == tostring(driverId)

                    local identityVerification = redis.call('GET', identityVerificationKey)
                    local identityPolicyMutation = redis.call('GET', identityPolicyMutationKey)
                    if (identityVerification or identityPolicyMutation) and not alreadyOwnedBySameDriver then
                        return 'ERR_KYC_VERIFICATION_IN_PROGRESS'
                    end

                    local activeStepUpChallenge = redis.call('GET', activeStepUpChallengeKey)
                    if activeStepUpChallenge and not alreadyOwnedBySameDriver then
                        return 'ERR_KYC_CHALLENGE_ACTIVE'
                    end

                    local kycReverifyRequired = string.lower(tostring(redis.call('HGET', driverKey, 'kyc_reverify_required') or 'false'))
                    local kycBlocked = string.lower(tostring(redis.call('HGET', driverKey, 'kyc_blocked') or 'false'))
                    local kycStatus = string.lower(tostring(redis.call('HGET', driverKey, 'kyc_status') or ''))
                    if (
                        kycReverifyRequired == 'true' or
                        kycReverifyRequired == '1' or
                        kycBlocked == 'true' or
                        kycBlocked == '1' or
                        kycStatus == 'blocked' or
                        kycStatus == 'rejected' or
                        kycStatus == 'failed' or
                        kycStatus == 'denied' or
                        kycStatus == 'pending' or
                        kycStatus == 'pending_review' or
                        kycStatus == 'pending_reverify' or
                        kycStatus == 'in_review' or
                        kycStatus == 'review'
                    ) and not alreadyOwnedBySameDriver then
                        return 'ERR_KYC_REVERIFICATION_REQUIRED'
                    end

                    local dispatchEligible = string.lower(tostring(redis.call('HGET', driverKey, 'dispatchEligible') or ''))
                    if dispatchEligible ~= 'true' and not alreadyOwnedBySameDriver then
                        return 'ERR_DRIVER_NOT_DISPATCH_ELIGIBLE'
                    end

                    local function persistActiveTripIndex(customerId)
                        redis.call('SET', activeTripKey, bookingId, 'EX', activeTripTtl)
                        if customerId and customerId ~= '' then
                            redis.call('SET', activeTripCustomerKey, customerId, 'EX', activeTripTtl)
                        end
                        redis.call('HSET', driverKey,
                            'activeTripId', bookingId,
                            'activeTripUpdatedAt', updatedAt
                        )
                    end

                    if alreadyOwnedBySameDriver then
                        local customerId = redis.call('HGET', bookingKey, 'customerId')
                        local pickupLoc = redis.call('HGET', bookingKey, 'pickupLocation')
                        persistActiveTripIndex(customerId)
                        return 'OK_ALREADY_ACCEPTED|||' .. (customerId or '') .. '|||' .. (pickupLoc or '')
                    end

                    local acceptAllowedState =
                        currentStateUpper == 'PENDING' or
                        currentStateUpper == 'REQUESTED' or
                        currentStateUpper == 'SEARCHING' or
                        currentStateUpper == 'NOTIFIED' or
                        currentStateUpper == 'AWAITING_RESPONSE' or
                        currentStateUpper == 'EXPANDED' or
                        currentStateUpper == 'MATCHED' or
                        currentStateUpper == 'REASSIGNMENT_PENDING'

                    local acceptAllowedStatus =
                        currentStatusUpper == 'PENDING' or
                        currentStatusUpper == 'REQUESTED' or
                        currentStatusUpper == 'SEARCHING' or
                        currentStatusUpper == 'NOTIFIED' or
                        currentStatusUpper == 'AWAITING_RESPONSE' or
                        currentStatusUpper == 'EXPANDED' or
                        currentStatusUpper == 'MATCHED' or
                        currentStatusUpper == 'REASSIGNMENT_PENDING'

                    if not acceptAllowedState and not acceptAllowedStatus then
                        return 'ERR_INVALID_STATE_' .. (currentStateUpper ~= '' and currentStateUpper or 'NULL')
                    end

                    -- Realiza o update atômico
                    redis.call('HMSET', bookingKey, 
                        'state', newState, 
                        'status', 'ACCEPTED', 
                        'driverId', driverId, 
                        'ownerDriverId', driverId,
                        'bookingOwnershipToken', ARGV[4],
                        'updatedAt', updatedAt, 
                        'acceptedAt', updatedAt
                    )

                    -- Retorna dados complementares concatenados (customerId|||pickupLocation)
                    local customerId = redis.call('HGET', bookingKey, 'customerId')
                    local pickupLoc = redis.call('HGET', bookingKey, 'pickupLocation')
                    persistActiveTripIndex(customerId)
                    return (customerId or '') .. '|||' .. (pickupLoc or '')
                `;

                // Executar o CAS apenas quando a posse idempotente ainda não foi
                // confirmada atomicamente. Assim um snapshot stale nunca pula gates.
                let redisResult = atomicallyConfirmedIdempotentResult;
                if (!redisResult) {
                    redisResult = await redis.eval(
                        luaScript,
                        7,
                        bookingKey,
                        activeTripKey(this.driverId),
                        activeTripCustomerKey(this.driverId),
                        `driver:${this.driverId}`,
                        identityVerificationKey(this.driverId),
                        identityPolicyMutationKey(this.driverId),
                        activeStepUpChallengeKey(this.driverId),
                        this.driverId,
                        newState,
                        updatedAt,
                        bookingOwnershipToken,
                        this.bookingId,
                        String(ACTIVE_TRIP_TTL_SECONDS)
                    );
                }

                if (typeof redisResult !== 'string' || redisResult.length === 0) {
                    throw new Error('Resposta inválida do CAS de aceite da corrida');
                }

                if (redisResult.startsWith('ERR_')) {
                    logStructured('warn', 'AcceptRideCommand rejeitado no CAS do booking', {
                        command: 'AcceptRideCommand',
                        driverId: this.driverId,
                        bookingId: this.bookingId,
                        redisResult,
                        currentDriverId: currentDriverId || null,
                        currentState: currentStateUpper || null,
                        currentStatus: currentStatusUpper || null
                    });
                    await releaseManagedRideLock().catch(() => null);
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    if (redisResult === 'ERR_NOT_FOUND') {
                        return CommandResult.failure('Corrida não encontrada');
                    }
                    if (redisResult === 'ERR_KYC_VERIFICATION_IN_PROGRESS') {
                        return CommandResult.failure('Validação de identidade em andamento. Conclua antes de aceitar uma corrida.');
                    }
                    if (redisResult === 'ERR_KYC_REVERIFICATION_REQUIRED') {
                        return CommandResult.failure('Validação de identidade pendente. Conclua antes de aceitar uma corrida.');
                    }
                    if (redisResult === 'ERR_KYC_CHALLENGE_ACTIVE') {
                        return CommandResult.failure('Validação de identidade pendente. Conclua antes de aceitar uma corrida.');
                    }
                    if (redisResult === 'ERR_DRIVER_NOT_DISPATCH_ELIGIBLE') {
                        return CommandResult.failure('Motorista não está elegível para receber esta corrida.');
                    }
                    return CommandResult.failure(`A corrida já foi aceita por outro motorista ou não está mais disponível.`);
                }

                // A partir daqui a corrida já estava ou acabou de ser aceita no Redis.
                // Falhas de enriquecimento/persistência secundária não devem liberar
                // o lock de uma corrida efetivamente comprometida.
                bookingAcceptanceCommitted = true;

                const alreadyAcceptedBySameDriver =
                    typeof redisResult === 'string' &&
                    redisResult.startsWith('OK_ALREADY_ACCEPTED|||');
                const serializedResult = alreadyAcceptedBySameDriver
                    ? redisResult.replace('OK_ALREADY_ACCEPTED|||', '')
                    : redisResult;

                // Parseando retorno atômico do LUA
                const [customerId, rawPickupLocation] = String(serializedResult || '|||').split('|||');
                const pickupLocation = parseLocationCandidate(rawPickupLocation);
                const currentState = alreadyAcceptedBySameDriver ? 'ACCEPTED' : 'PENDING'; // Historicamente veio de Pending

                const bookingSnapshot = await redis.hgetall(bookingKey);
                let operationalContinuation = null;
                try {
                    operationalContinuation = bookingSnapshot?.operationalContinuation
                        ? JSON.parse(bookingSnapshot.operationalContinuation)
                        : null;
                } catch (_continuationError) {
                    operationalContinuation = null;
                }
                const isReassignment = Boolean(
                    operationalContinuation &&
                    (
                        operationalContinuation.status === 'SEARCHING_REPLACEMENT_DRIVER' ||
                        operationalContinuation.status === 'REPLACEMENT_DRIVER_ACCEPTED'
                    )
                );
                let destinationLocation = parseLocationCandidate(bookingSnapshot?.destinationLocation);
                let estimatedFare = Number.parseFloat(
                    bookingSnapshot?.estimatedFare ?? bookingSnapshot?.fare ?? bookingSnapshot?.estimate ?? 0
                );

                let driverAcceptedLocation = null;
                let driverDistanceToPickupKm = null;
                let estimatedArrivalToPickupMin = null;

                try {
                    const driverGeo = await redis.geopos('driver_locations', this.driverId);
                    const driverGeoPoint = Array.isArray(driverGeo) && driverGeo.length > 0
                        ? driverGeo[0]
                        : null;
                    const driverLng = toFiniteNumber(driverGeoPoint?.[0]);
                    const driverLat = toFiniteNumber(driverGeoPoint?.[1]);
                    if (driverLat !== null && driverLng !== null) {
                        driverAcceptedLocation = { lat: driverLat, lng: driverLng };
                    }
                } catch (_geoError) {
                    driverAcceptedLocation = null;
                }

                if (driverAcceptedLocation && pickupLocation) {
                    const computedDistance = haversineDistanceKm(
                        driverAcceptedLocation.lat,
                        driverAcceptedLocation.lng,
                        pickupLocation.lat,
                        pickupLocation.lng
                    );
                    if (Number.isFinite(computedDistance)) {
                        driverDistanceToPickupKm = Number(computedDistance.toFixed(3));
                        estimatedArrivalToPickupMin = estimateEtaMinutesFromDistanceKm(driverDistanceToPickupKm);
                    }
                }

                const bookingPatch = {};
                if (driverAcceptedLocation) {
                    bookingPatch.driverAcceptedLocation = JSON.stringify(driverAcceptedLocation);
                }
                if (driverDistanceToPickupKm !== null) {
                    bookingPatch.driverDistanceToPickupKm = String(driverDistanceToPickupKm);
                }
                if (estimatedArrivalToPickupMin !== null) {
                    bookingPatch.estimatedArrivalToPickupMin = String(estimatedArrivalToPickupMin);
                }
                if (Object.keys(bookingPatch).length > 0) {
                    await redis.hset(bookingKey, bookingPatch);
                    await writeVisibleBookingSnapshot(redis, this.bookingId, bookingPatch);
                }

                if (isReassignment && operationalContinuation) {
                    const continuationPatch = {
                        ...operationalContinuation,
                        status: 'REPLACEMENT_DRIVER_ACCEPTED',
                        replacementDriverId: this.driverId,
                        replacementAcceptedAt: updatedAt
                    };
                    await redis.hset(bookingKey, {
                        operationalContinuation: JSON.stringify(continuationPatch),
                        reassignedDriverId: this.driverId,
                        reassignedAcceptedAt: updatedAt
                    });
                    await writeVisibleBookingSnapshot(redis, this.bookingId, {
                        operationalContinuation: JSON.stringify(continuationPatch),
                        reassignedDriverId: this.driverId,
                        reassignedAcceptedAt: updatedAt
                    });
                }

                await writeVisibleBookingSnapshot(redis, this.bookingId, {
                    state: RideStateManager.STATES.ACCEPTED,
                    status: 'ACCEPTED',
                    driverId: this.driverId,
                    ownerDriverId: this.driverId,
                    bookingOwnershipToken,
                    acceptedAt: updatedAt,
                    updatedAt
                });

                const enrichedPayload = await resolveAcceptRidePayload(redis, this.bookingId, {
                    pickupLocation,
                    destinationLocation,
                    estimatedFare,
                    driverAcceptedLocation,
                    driverDistanceToPickupKm,
                    estimatedArrivalToPickupMin
                });
                destinationLocation = enrichedPayload.destinationLocation;
                estimatedFare = enrichedPayload.estimatedFare;
                driverAcceptedLocation = enrichedPayload.driverAcceptedLocation;
                driverDistanceToPickupKm = enrichedPayload.driverDistanceToPickupKm;
                estimatedArrivalToPickupMin = enrichedPayload.estimatedArrivalToPickupMin;

                // Limpar corrida ativa na tela do motorista após aceite bem-sucedido.
                await redis.del(`driver_active_notification:${this.driverId}`);
                await clearOfferReservationsForBooking(redis, this.bookingId).catch(() => null);

                // Registrar histórico fora do caminho crítico de latência.
                if (!alreadyAcceptedBySameDriver) {
                    setImmediate(() => {
                        eventSourcing.recordEvent(require('../services/event-sourcing').EVENT_TYPES.STATE_CHANGED, {
                            bookingId: this.bookingId,
                            fromState: currentState,
                            toState: newState,
                            driverId: this.driverId
                        }).catch(() => null);
                    });
                }

                // Criar evento canônico
                const event = alreadyAcceptedBySameDriver
                    ? null
                    : new RideAcceptedEvent({
                        bookingId: this.bookingId,
                        driverId: this.driverId,
                        customerId: customerId,
                        traceId: this.traceId, // ✅ Incluir traceId no evento
                        correlationId: this.correlationId || this.bookingId // ✅ Incluir correlationId no evento
                    });

                logStructured('info', 'AcceptRideCommand executado com sucesso', {
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    idempotentReuse: alreadyAcceptedBySameDriver,
                    command: 'AcceptRideCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    event: event ? event.toJSON() : null,
                    pickupLocation,
                    destinationLocation,
                    estimatedFare: Number.isFinite(estimatedFare) ? estimatedFare : null,
                    driverAcceptedLocation,
                    driverDistanceToPickupKm,
                    estimatedArrivalToPickupMin,
                    idempotentAccept: alreadyAcceptedBySameDriver,
                    isReassignment
                });

            } catch (error) {
                await releaseManagedRideLock().catch(() => null);
                logStructured('error', 'AcceptRideCommand falhou', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'AcceptRideCommand',
                    error: error.message
                });
                metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = AcceptRideCommand;
