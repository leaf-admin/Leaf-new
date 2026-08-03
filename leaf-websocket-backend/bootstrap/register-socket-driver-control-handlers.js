const { assessDriverArrivalAtPickup } = require('../utils/pickup-arrival-policy');
const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
const { buildActiveRideSnapshotForUser } = require('./active-ride-sync-utils');
const RideStateManager = require('../services/ride-state-manager');
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
const { writeVisibleBookingSnapshot } = require('../services/booking-visibility-service');
const {
    hasRideOfflineIntentPayload,
    markRideOfflineIntentProcessed,
    markRideOfflineIntentRejected,
    validateAndReserveRideOfflineIntent
} = require('../services/ride-offline-intent-validator');
const {
    resolveDriverActivationState
} = require('../services/driver-activation-state-service');
const driverEligibilityService = require('../services/driver-eligibility-service');
const {
    resolveDestinationModeIntent
} = require('../services/driver-destination-mode-service');
const {
    DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
    resolveDriverOnlineTransition
} = require('../services/driver-online-time-policy-service');
const { buildDriverVehicleIdentity } = require('../utils/driver-vehicle-identity');
const { resolveActiveTripForDriver } = require('../utils/active-trip-index');
const {
    buildPublicDriverKycSocketPayload
} = require('../utils/driver-kyc-socket-projection');
const {
    commitDriverOnlineProjection
} = require('../services/driver-online-projection-service');

const DRIVER_BOARDING_WINDOW_SECONDS = Math.max(
    30,
    Number.parseInt(process.env.DRIVER_BOARDING_WINDOW_SECONDS || '120', 10) || 120
);

function normalizeBooleanFlag(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
}

function resolveVehicleLockIdentifier({ plate, vehicleId } = {}) {
    const normalizedPlate = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalizedPlate) {
        return normalizedPlate;
    }

    const normalizedVehicleId = String(vehicleId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalizedVehicleId ? `VEHID${normalizedVehicleId}` : '';
}

function buildPublicDriverStatusFailure(error = {}) {
    const errorCode = String(error?.code || '').trim().toUpperCase();

    if (errorCode === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK') {
        return {
            success: false,
            error: 'Esta conta não pode usar o modo motorista.',
            code: 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK',
            retryable: false
        };
    }

    if (errorCode.startsWith('KYC_') || errorCode.startsWith('PERSISTENCE_')) {
        return {
            success: false,
            error: 'Não foi possível confirmar sua liberação agora. Tente novamente em alguns minutos.',
            code: 'KYC_STATUS_UNAVAILABLE',
            retryable: true
        };
    }

    return {
        success: false,
        error: 'Não foi possível atualizar o status do motorista agora. Tente novamente.',
        code: 'DRIVER_STATUS_UPDATE_FAILED',
        retryable: true
    };
}

function normalizeDriverDestinationModePayload(data = {}) {
    const provided = Boolean(
        data?.destinationMode && typeof data.destinationMode === 'object'
    ) || Object.prototype.hasOwnProperty.call(data || {}, 'destinationModeActive');
    const source = data?.destinationMode && typeof data.destinationMode === 'object'
        ? data.destinationMode
        : data;
    const destination = source?.destination || source?.destinationLocation || {};
    const coordinate = destination?.coordinate || destination || {};
    const lat = Number(
        source?.destinationModeLat ??
        source?.lat ??
        coordinate?.latitude ??
        coordinate?.lat
    );
    const lng = Number(
        source?.destinationModeLng ??
        source?.lng ??
        coordinate?.longitude ??
        coordinate?.lng
    );
    const active = normalizeBooleanFlag(source?.active ?? source?.destinationModeActive);

    if (!active || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return {
            provided,
            active: false,
            lat: '',
            lng: '',
            expiresAt: '',
            minProgressKm: '',
            arrivalRadiusKm: '',
            label: '',
            address: ''
        };
    }

    return {
        provided,
        active: true,
        lat: String(lat),
        lng: String(lng),
        expiresAt: String(source?.expiresAt || source?.destinationModeExpiresAt || ''),
        minProgressKm: String(
            Number.isFinite(Number(source?.minProgressKm ?? source?.destinationModeMinProgressKm))
                ? Number(source?.minProgressKm ?? source?.destinationModeMinProgressKm)
                : 1
        ),
        arrivalRadiusKm: String(
            Number.isFinite(Number(source?.arrivalRadiusKm ?? source?.destinationModeArrivalRadiusKm))
                ? Number(source?.arrivalRadiusKm ?? source?.destinationModeArrivalRadiusKm)
                : 3
        ),
        label: String(source?.destinationName || destination?.name || source?.label || ''),
        address: String(source?.destinationAddress || destination?.address || source?.address || '')
    };
}

function registerSocketDriverControlHandlers({
    socket,
    io,
    redisPool,
    logStructured,
    idempotencyService = null,
    enforceSubscriptionForOnline = null,
    enforceDailyKYCForOnline = null,
    vehicleLockManager = null
}) {
    const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
    const rideIdempotencyService = idempotencyService;

    const handleArriveAtPickup = async (data = {}, transport = 'arriveAtPickup') => {
        let outerIdempotencyKey = null;
        let outerIdempotencyOwner = false;
        try {
            const rideId = data.rideId || data.bookingId || null;
            const location = data.location || null;

            if (!rideId) return;

            if (rideIdempotencyService) {
                const driverId = socket.userId || data.driverId || 'driver';
                const idempotencyKey = data.idempotencyKey || rideIdempotencyService.generateKey(
                    driverId,
                    'arriveAtPickup',
                    rideId
                );
                outerIdempotencyKey = idempotencyKey;

                const idempotencyCheck = await rideIdempotencyService.beginRequest(idempotencyKey, {
                    joinWaitMs: Number.parseInt(
                        process.env.IDEMPOTENCY_ARRIVE_PICKUP_JOIN_WAIT_MS
                        || process.env.IDEMPOTENCY_JOIN_WAIT_MS
                        || '8000',
                        10
                    )
                });

                if (!idempotencyCheck.isNew) {
                    if (idempotencyCheck.cachedResult) {
                        socket.emit('arrivedAtPickup', idempotencyCheck.cachedResult);
                        if (transport === 'notificationAction') {
                            socket.emit('notificationActionSuccess', {
                                ...idempotencyCheck.cachedResult,
                                action: 'arrived_at_pickup'
                            });
                        }
                        return;
                    }

                    const duplicatePayload = {
                        success: false,
                        error: 'Requisição duplicada',
                        message: 'Esta ação já está sendo processada. Aguarde...',
                        code: 'DUPLICATE_REQUEST',
                        bookingId: rideId,
                        retryAfterSec: 1
                    };
                    socket.emit('arrivedAtPickup', duplicatePayload);
                    if (transport === 'notificationAction') {
                        socket.emit('notificationActionError', {
                            ...duplicatePayload,
                            action: 'arrived_at_pickup'
                        });
                    }
                    return;
                }
                outerIdempotencyOwner = true;
            }

            const redis = redisPool.getConnection();
            let offlineIntentValidation = null;
            if (hasRideOfflineIntentPayload(data)) {
                offlineIntentValidation = await validateAndReserveRideOfflineIntent({
                    redis,
                    bookingId: rideId,
                    actorId: socket.userId || data.driverId,
                    role: 'driver',
                    eventType: 'arrived_at_pickup',
                    idempotencyKey: outerIdempotencyKey || data.idempotencyKey,
                    clientSequence: data.clientSequence,
                    clientCreatedAt: data.clientCreatedAt,
                    payload: {
                        location
                    },
                    data
                });

                if (!offlineIntentValidation.accepted) {
                    const errorPayload = {
                        success: false,
                        error: offlineIntentValidation.message || 'Intencao offline rejeitada',
                        code: offlineIntentValidation.code || 'OFFLINE_INTENT_REJECTED',
                        bookingId: rideId
                    };
                    socket.emit('arrivedAtPickup', errorPayload);
                    if (transport === 'notificationAction') {
                        socket.emit('notificationActionError', {
                            ...errorPayload,
                            action: 'arrived_at_pickup'
                        });
                    }
                    if (outerIdempotencyOwner && outerIdempotencyKey && rideIdempotencyService) {
                        outerIdempotencyOwner = false;
                        await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                    }
                    return;
                }

                if (offlineIntentValidation.replay && offlineIntentValidation.cachedResult) {
                    if (rideIdempotencyService && outerIdempotencyKey) {
                        await rideIdempotencyService.cacheResult(outerIdempotencyKey, offlineIntentValidation.cachedResult);
                        outerIdempotencyOwner = false;
                    }
                    socket.emit('arrivedAtPickup', offlineIntentValidation.cachedResult);
                    if (transport === 'notificationAction') {
                        socket.emit('notificationActionSuccess', {
                            ...offlineIntentValidation.cachedResult,
                            action: 'arrived_at_pickup'
                        });
                    }
                    return;
                }
            }
            const bookingData = await redis.hgetall(`booking:${rideId}`);
            const arrivalAssessment = await assessDriverArrivalAtPickup({
                redis,
                driverId: socket.userId || null,
                booking: bookingData,
                location
            });

            if (!arrivalAssessment.allowed) {
                const errorPayload = {
                    success: false,
                    error: arrivalAssessment.message,
                    code: arrivalAssessment.code,
                    bookingId: rideId,
                    details: {
                        distanceMeters: arrivalAssessment.distanceMeters ?? null,
                        toleranceMeters: arrivalAssessment.toleranceMeters ?? null
                    }
                };
                socket.emit('arrivedAtPickup', errorPayload);
                if (transport === 'notificationAction') {
                    socket.emit('notificationActionError', {
                        ...errorPayload,
                        action: 'arrived_at_pickup'
                    });
                }
                if (outerIdempotencyOwner && outerIdempotencyKey && rideIdempotencyService) {
                    outerIdempotencyOwner = false;
                    if (offlineIntentValidation && !offlineIntentValidation.skipped) {
                        await markRideOfflineIntentRejected({
                            redis,
                            bookingId: rideId,
                            idempotencyKey: outerIdempotencyKey,
                            error: arrivalAssessment.message || 'Chegada rejeitada',
                            code: arrivalAssessment.code || 'ARRIVAL_VALIDATION_FAILED'
                        }).catch(() => null);
                    }
                    await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                }
                return;
            }

            const customerId = bookingData?.customerId || bookingData?.customer || bookingData?.passengerId || null;
            const driverArrivedAtMs = Date.now();
            const boardingDeadlineAt = new Date(
                driverArrivedAtMs + (DRIVER_BOARDING_WINDOW_SECONDS * 1000)
            ).toISOString();
            const ownershipToken = String(
                bookingData?.bookingOwnershipToken ||
                `${rideId}:${socket.userId || 'driver'}:${driverArrivedAtMs}`
            );

            await RideStateManager.updateBookingState(
                redis,
                rideId,
                RideStateManager.STATES.ARRIVED,
                {
                    status: 'ARRIVED',
                    driverId: socket.userId || '',
                    ownerDriverId: socket.userId || '',
                    bookingOwnershipToken: ownershipToken,
                    driverArrivedAt: String(driverArrivedAtMs),
                    arrivalRegisteredAt: new Date(driverArrivedAtMs).toISOString(),
                    pickupArrivalDistanceMeters: String(arrivalAssessment.distanceMeters ?? ''),
                    boardingDeadlineAt,
                    boardingWindowSec: String(DRIVER_BOARDING_WINDOW_SECONDS)
                }
            );

            const activeBookingData = {
                ...bookingData,
                status: 'ARRIVED',
                state: RideStateManager.STATES.ARRIVED,
                driverId: socket.userId || '',
                ownerDriverId: socket.userId || '',
                bookingOwnershipToken: ownershipToken,
                driverArrivedAt: String(driverArrivedAtMs),
                arrivalRegisteredAt: new Date(driverArrivedAtMs).toISOString(),
                pickupArrivalDistanceMeters: String(arrivalAssessment.distanceMeters ?? ''),
                boardingDeadlineAt,
                boardingWindowSec: String(DRIVER_BOARDING_WINDOW_SECONDS)
            };

            await redis.hset(`booking:${rideId}`, activeBookingData);
            await writeVisibleBookingSnapshot(redis, rideId, activeBookingData);
            const activeBookingsKeyType = await redis.type('bookings:active');
            if (activeBookingsKeyType !== 'hash' && activeBookingsKeyType !== 'none') {
                await redis.del('bookings:active');
            }
            await redis.hset('bookings:active', rideId, JSON.stringify(activeBookingData));
            await pricingH3ReadModelService.applyBookingSnapshot(redis, {
                bookingId: rideId,
                ...activeBookingData
            }).catch(() => null);

            if (io.activeBookings) {
                io.activeBookings.set(rideId, {
                    ...(io.activeBookings.get(rideId) || {}),
                    ...activeBookingData
                });
            }

            if (customerId) {
                const customerRoom = `customer_${customerId}`;
                const passengerArrivalPayload = {
                    success: true,
                    rideId,
                    bookingId: rideId,
                    location,
                    driverId: socket.userId || null,
                    pickupToleranceReached: true,
                    distanceMeters: arrivalAssessment.distanceMeters,
                    toleranceMeters: arrivalAssessment.toleranceMeters,
                    boardingWindowSec: DRIVER_BOARDING_WINDOW_SECONDS,
                    boardingDeadlineAt,
                    timestamp: new Date().toISOString()
                };

                io.to(customerRoom).emit('arrivedAtPickup', passengerArrivalPayload);
                io.to(customerRoom).emit('driverArrived', passengerArrivalPayload);

                try {
                    const activeRideSnapshot = await buildActiveRideSnapshotForUser(
                        redis,
                        customerId,
                        'customer'
                    );

                    io.to(customerRoom).emit('activeRideSync', {
                        success: true,
                        source: 'driver_arrived',
                        ...activeRideSnapshot,
                        syncedAt: new Date().toISOString()
                    });
                } catch (syncError) {
                    logStructured('warn', 'Falha ao emitir activeRideSync apos chegada no embarque', {
                        service: 'driver-control-handlers',
                        bookingId: rideId,
                        customerId,
                        driverId: socket.userId || null,
                        error: syncError?.message || String(syncError)
                    });
                }
            }

            const successPayload = {
                success: true,
                rideId,
                bookingId: rideId,
                location,
                pickupToleranceReached: true,
                distanceMeters: arrivalAssessment.distanceMeters,
                toleranceMeters: arrivalAssessment.toleranceMeters,
                boardingWindowSec: DRIVER_BOARDING_WINDOW_SECONDS,
                boardingDeadlineAt,
                ...(outerIdempotencyKey ? { idempotencyKey: outerIdempotencyKey } : {}),
                timestamp: new Date().toISOString()
            };
            if (outerIdempotencyKey && rideIdempotencyService) {
                await rideIdempotencyService.cacheResult(outerIdempotencyKey, successPayload);
                if (offlineIntentValidation && !offlineIntentValidation.skipped) {
                    await markRideOfflineIntentProcessed({
                        redis,
                        bookingId: rideId,
                        idempotencyKey: outerIdempotencyKey,
                        result: successPayload
                    }).catch(() => null);
                }
                outerIdempotencyOwner = false;
            }
            socket.emit('arrivedAtPickup', successPayload);
            if (transport === 'notificationAction') {
                socket.emit('notificationActionSuccess', {
                    ...successPayload,
                    action: 'arrived_at_pickup'
                });
            }
            scheduleMapH3Refresh(io, {
                reason: 'arrived_at_pickup',
                bookingId: rideId,
                driverId: socket.userId || null
            });
        } catch (error) {
            if (outerIdempotencyOwner && outerIdempotencyKey && rideIdempotencyService) {
                outerIdempotencyOwner = false;
                await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
            }
            const errorPayload = {
                success: false,
                error: error.message || 'Erro ao processar chegada no pickup'
            };
            socket.emit('arrivedAtPickup', errorPayload);
            if (transport === 'notificationAction') {
                socket.emit('notificationActionError', {
                    ...errorPayload,
                    action: 'arrived_at_pickup'
                });
            }
        }
    };

    socket.on('arriveAtPickup', async (data = {}) => {
        await handleArriveAtPickup(data, 'arriveAtPickup');
    });

    socket.on('notificationAction', async (data = {}) => {
        if (String(data?.action || '') !== 'arrived_at_pickup') {
            socket.emit('notificationActionError', {
                success: false,
                error: 'Ação não suportada neste socket',
                code: 'UNSUPPORTED_NOTIFICATION_ACTION',
                action: data?.action || null,
                bookingId: data?.bookingId || data?.rideId || null
            });
            return;
        }

        await handleArriveAtPickup(data, 'notificationAction');
    });

    socket.on('setDriverStatus', async (data = {}) => {
        let pendingVehicleLockIdentifier = null;
        let pendingVehicleLeaseToken = null;
        let vehicleLockCommitted = false;
        try {
            const redis = redisPool.getConnection();
            const driverId = data.driverId || socket.userId;
            const requestedStatus = String(data.status || '').toUpperCase();
            const requestedOnline = data.isOnline !== false && requestedStatus !== 'OFFLINE';
            const status = requestedOnline ? 'AVAILABLE' : 'OFFLINE';
            const isOnline = requestedOnline === true;
            let driverOnlineDaily = null;
            let activationState = null;

            if (!driverId) {
                socket.emit('driverStatusError', {
                    error: 'driverId ausente',
                    code: 'MISSING_DRIVER_ID'
                });
                return;
            }

            const driverKey = `driver:${driverId}`;
            const existingDriverState = await redis.hgetall(driverKey);
            let activeTripIndexResolved = false;
            let canonicalActiveTrip = { tripId: null, customerId: null };
            try {
                canonicalActiveTrip = await resolveActiveTripForDriver(redis, driverId)
                    || { tripId: null, customerId: null };
                activeTripIndexResolved = true;
            } catch (error) {
                logStructured('warn', 'Falha ao consultar corrida ativa antes do gate online', {
                    service: 'driver-control-handlers',
                    driverId,
                    error: error?.message || String(error)
                });
            }
            const requestedDestinationMode = normalizeDriverDestinationModePayload(data);
            let destinationIntent = {
                allowed: true,
                shouldWrite: false,
                patch: null,
                destinationMode: undefined,
                policy: null
            };

            if (!activeTripIndexResolved || canonicalActiveTrip?.tripId) {
                const lat = Number(existingDriverState?.lat ?? data?.lat ?? data?.location?.lat);
                const lng = Number(existingDriverState?.lng ?? data?.lng ?? data?.location?.lng);
                const checkedAt = new Date().toISOString();
                const continuityCode = !activeTripIndexResolved
                    ? (isOnline
                        ? 'ONLINE_DEFERRED_ACTIVE_TRIP_STATE_UNKNOWN'
                        : 'OFFLINE_DEFERRED_ACTIVE_TRIP_STATE_UNKNOWN')
                    : (isOnline
                        ? 'IN_TRIP_KYC_DEFERRED'
                        : 'OFFLINE_DEFERRED_ACTIVE_TRIP');
                await commitDriverOnlineProjection(redis, {
                    driverId,
                    driverKey,
                    eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                    isOnline: true,
                    dispatchEligible: false,
                    lat,
                    lng,
                    fields: {
                        driverId,
                        status: existingDriverState?.status || 'IN_TRIP',
                        isOnline: 'true',
                        dispatchEligible: 'false',
                        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
                        dispatchEligibilityCheckedAt: checkedAt,
                        kycRecheckPendingAfterTrip: 'true',
                        ...(canonicalActiveTrip?.tripId
                            ? { activeTripId: String(canonicalActiveTrip.tripId) }
                            : {}),
                        updatedAt: checkedAt
                    }
                });
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    await pricingH3ReadModelService.applyDriverSnapshot(redis, {
                        driverId,
                        lat,
                        lng,
                        isOnline: true,
                        available: false
                    }).catch(() => null);
                }
                socket.emit('driverStatusUpdated', {
                    success: true,
                    driverId,
                    status: existingDriverState?.status || 'IN_TRIP',
                    isOnline: true,
                    dispatchEligible: false,
                    code: continuityCode,
                    kycDeferred: true,
                    offlineDeferred: !isOnline,
                    activeTripId: canonicalActiveTrip?.tripId || null,
                    activeTripStateUnknown: !activeTripIndexResolved,
                    checkedAt
                });
                scheduleMapH3Refresh(io, {
                    reason: 'driver_status_continuity_in_trip',
                    driverId,
                    status: existingDriverState?.status || 'IN_TRIP',
                    isOnline: true
                });
                return;
            }

            if (isOnline) {
                const onlineTimeGate = await resolveDriverOnlineTransition(redis, {
                    driverId,
                    isOnline: true,
                    persist: false
                });
                driverOnlineDaily = onlineTimeGate.snapshot;
                if (!onlineTimeGate.allowed) {
                    const checkedAt = new Date().toISOString();
                    await commitDriverOnlineProjection(redis, {
                        driverId,
                        driverKey,
                        eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                        isOnline: false,
                        dispatchEligible: false,
                        fields: {
                            driverId,
                            status: 'OFFLINE',
                            isOnline: 'false',
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: onlineTimeGate.code || 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
                            dispatchEligibilityCheckedAt: checkedAt,
                            updatedAt: checkedAt
                        }
                    });

                    socket.emit('driverStatusError', {
                        success: false,
                        error: onlineTimeGate.message || DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
                        message: onlineTimeGate.message || DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
                        code: onlineTimeGate.code || 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
                        driverOnlineDaily
                    });
                    return;
                }

                activationState = await resolveDriverActivationState({ driverId }).catch((error) => {
                    logStructured('warn', 'Falha ao resolver estado canonico do motorista para online', {
                        service: 'driver-control-handlers',
                        driverId,
                        error: error?.message || String(error)
                    });
                    return {
                        state: 'UNKNOWN',
                        label: 'Status indisponivel',
                        canAttemptOnline: false,
                        canGoOnline: false,
                        requiresLiveness: false,
                        blockingReason: 'Nao foi possivel validar seu cadastro agora.'
                    };
                });

                if (!activationState?.canAttemptOnline) {
                    const checkedAt = new Date().toISOString();
                    await commitDriverOnlineProjection(redis, {
                        driverId,
                        driverKey,
                        eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                        isOnline: false,
                        dispatchEligible: false,
                        fields: {
                            driverId,
                            status: 'OFFLINE',
                            isOnline: 'false',
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: activationState?.state || 'DRIVER_ACTIVATION_BLOCKED',
                            dispatchEligibilityCheckedAt: checkedAt,
                            updatedAt: checkedAt
                        }
                    });

                    socket.emit('driverStatusError', {
                        success: false,
                        error: activationState?.blockingReason || 'Cadastro de motorista ainda nao liberado para online.',
                        code: activationState?.state || 'DRIVER_ACTIVATION_BLOCKED',
                        activationState
                    });
                    return;
                }

                if (typeof enforceSubscriptionForOnline === 'function') {
                    const subscriptionGate = await enforceSubscriptionForOnline(driverId);
                    if (!subscriptionGate?.allowed) {
                        socket.emit('driverStatusError', {
                            success: false,
                            error: subscriptionGate?.reason || 'Assinatura pendente para ficar online.',
                            code: subscriptionGate?.code || 'SUBSCRIPTION_BLOCKED',
                            activationState,
                            subscription: subscriptionGate
                        });
                        return;
                    }
                }

                if (typeof enforceDailyKYCForOnline === 'function') {
                    const kycGate = await enforceDailyKYCForOnline(driverId);
                    if (!kycGate?.allowed) {
                        const checkedAt = new Date().toISOString();
                        await commitDriverOnlineProjection(redis, {
                            driverId,
                            driverKey,
                            eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                            isOnline: false,
                            dispatchEligible: false,
                            fields: {
                                driverId,
                                status: 'OFFLINE',
                                isOnline: 'false',
                                dispatchEligible: 'false',
                                dispatchEligibilityCode: kycGate?.code || 'KYC_REQUIRED',
                                dispatchEligibilityCheckedAt: checkedAt,
                                kycRecheckPendingAfterTrip: kycGate?.retryRequired === true
                                    ? 'true'
                                    : 'false',
                                updatedAt: checkedAt
                            }
                        });
                        socket.emit('driverStatusError', {
                            success: false,
                            activationState,
                            ...buildPublicDriverKycSocketPayload(kycGate, {
                                message: 'Validação facial necessária para ficar online.',
                                fallbackCode: 'kycRequired'
                            })
                        });
                        return;
                    }
                    if (kycGate?.continuityOnly || kycGate?.deferred) {
                        const checkedAt = new Date().toISOString();
                        const activeTripId = kycGate?.activeTripId || existingDriverState?.activeTripId || null;
                        await commitDriverOnlineProjection(redis, {
                            driverId,
                            driverKey,
                            eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                            isOnline: true,
                            dispatchEligible: false,
                            fields: {
                                driverId,
                                status: existingDriverState?.status || 'IN_TRIP',
                                isOnline: 'true',
                                dispatchEligible: 'false',
                                dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
                                dispatchEligibilityCheckedAt: checkedAt,
                                kycRecheckPendingAfterTrip: 'true',
                                ...(activeTripId ? { activeTripId: String(activeTripId) } : {}),
                                updatedAt: checkedAt
                            }
                        });
                        socket.emit('driverStatusUpdated', {
                            success: true,
                            driverId,
                            status: existingDriverState?.status || 'IN_TRIP',
                            isOnline: true,
                            dispatchEligible: false,
                            code: 'IN_TRIP_KYC_DEFERRED',
                            kycDeferred: true,
                            activeTripId,
                            checkedAt
                        });
                        return;
                    }
                }
            }

            destinationIntent = await resolveDestinationModeIntent({
                redis,
                driverId,
                requestedMode: requestedDestinationMode,
                existingDriverState,
                isOnline
            });
            if (!destinationIntent.allowed) {
                socket.emit('driverStatusError', {
                    success: false,
                    error: destinationIntent.error || 'Destino de caminho indisponível agora.',
                    code: destinationIntent.code || 'DRIVER_DESTINATION_MODE_REJECTED',
                    destinationModePolicy: destinationIntent.policy || null
                });
                return;
            }
            const shouldWriteDestinationMode = destinationIntent.shouldWrite === true;

            let nextDispatchEligible = false;
            let nextDispatchEligibilityCode = isOnline
                ? (existingDriverState?.dispatchEligibilityCode || 'AWAITING_LOCATION_SYNC')
                : 'OFFLINE';
            const lat = Number(existingDriverState?.lat ?? data?.lat ?? data?.location?.lat);
            const lng = Number(existingDriverState?.lng ?? data?.lng ?? data?.location?.lng);
            const hasValidLocation = Number.isFinite(lat) && Number.isFinite(lng);
            let vehicleIdentity = null;
            let vehicleProfile = null;

            if (isOnline) {
                if (hasValidLocation) {
                    try {
                        const eligibility = await driverEligibilityService.isDriverEligibleForRide(
                            driverId,
                            null,
                            existingDriverState || {}
                        );
                        nextDispatchEligible = eligibility?.eligible === true;
                        nextDispatchEligibilityCode = nextDispatchEligible
                            ? (eligibility?.code || 'ELIGIBLE')
                            : (eligibility?.code || 'NOT_ELIGIBLE');
                    } catch (eligibilityError) {
                        nextDispatchEligible = false;
                        nextDispatchEligibilityCode = 'ELIGIBILITY_CHECK_FAILED';
                        logStructured('warn', 'Falha ao recalcular elegibilidade no toggle online', {
                            service: 'driver-control-handlers',
                            driverId,
                            error: eligibilityError?.message || String(eligibilityError)
                        });
                    }
                } else {
                    nextDispatchEligibilityCode = 'AWAITING_LOCATION_SYNC';
                }
            }

            if (isOnline) {
                try {
                    vehicleProfile = await driverEligibilityService.resolveDriverProfile(
                        driverId,
                        existingDriverState || {}
                    );
                    vehicleProfile = {
                        ...vehicleProfile,
                        activeVehicleId: activationState?.vehicle?.vehicleId || vehicleProfile?.activeVehicleId,
                        vehiclePlate: activationState?.vehicle?.plate || vehicleProfile?.vehiclePlate,
                        vehicleModel: activationState?.vehicle?.model || vehicleProfile?.vehicleModel,
                        vehicleColor: activationState?.vehicle?.color || vehicleProfile?.vehicleColor,
                        vehicleIdentitySource: activationState?.vehicle?.identitySource || vehicleProfile?.vehicleIdentitySource,
                        vehicleIdentityCanonical: activationState?.vehicle?.identityComplete === true
                            || vehicleProfile?.vehicleIdentityCanonical === true
                    };
                    vehicleIdentity = buildDriverVehicleIdentity(vehicleProfile);
                } catch (identityError) {
                    logStructured('warn', 'Falha ao hidratar identidade veicular antes do lock online', {
                        service: 'driver-control-handlers',
                        driverId,
                        error: identityError.message
                    });
                }

                const vehicleLockIdentifier = resolveVehicleLockIdentifier({
                    plate: activationState?.vehicle?.plate || vehicleProfile?.vehiclePlate || existingDriverState?.vehiclePlate,
                    vehicleId: activationState?.vehicle?.vehicleId || vehicleProfile?.activeVehicleId || existingDriverState?.activeVehicleId
                });

                if (!vehicleLockManager || !vehicleLockIdentifier) {
                    const checkedAt = new Date().toISOString();
                    await commitDriverOnlineProjection(redis, {
                        driverId,
                        driverKey,
                        eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                        isOnline: false,
                        dispatchEligible: false,
                        fields: {
                            driverId,
                            status: 'OFFLINE',
                            isOnline: 'false',
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: 'VEHICLE_IDENTITY_UNAVAILABLE',
                            dispatchEligibilityCheckedAt: checkedAt,
                            updatedAt: checkedAt
                        }
                    });
                    await resolveDriverOnlineTransition(redis, {
                        driverId,
                        isOnline: false
                    });
                    socket.emit('driverStatusError', {
                        success: false,
                        error: 'Não foi possível validar o veículo selecionado para ficar online.',
                        code: 'VEHICLE_IDENTITY_UNAVAILABLE'
                    });
                    return;
                }

                pendingVehicleLeaseToken = String(socket.id || '').trim();
                const lockResult = await vehicleLockManager.acquireLock(vehicleLockIdentifier, driverId, {
                    leaseToken: pendingVehicleLeaseToken
                });
                if (!lockResult?.success) {
                    const lockFailureCode = lockResult?.currentDriver
                        ? 'VEHICLE_ALREADY_ONLINE'
                        : 'VEHICLE_LOCK_UNAVAILABLE';
                    const checkedAt = new Date().toISOString();
                    await commitDriverOnlineProjection(redis, {
                        driverId,
                        driverKey,
                        eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                        isOnline: false,
                        dispatchEligible: false,
                        fields: {
                            driverId,
                            status: 'OFFLINE',
                            isOnline: 'false',
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: lockFailureCode,
                            dispatchEligibilityCheckedAt: checkedAt,
                            updatedAt: checkedAt
                        }
                    });
                    await resolveDriverOnlineTransition(redis, {
                        driverId,
                        isOnline: false
                    });
                    socket.emit('driverStatusError', {
                        success: false,
                        error: lockResult?.currentDriver
                            ? 'Este veículo já está online em outro perfil.'
                            : 'Não foi possível validar a disponibilidade do veículo agora.',
                        code: lockFailureCode
                    });
                    return;
                }

                pendingVehicleLockIdentifier = vehicleLockIdentifier;
                socket.vehiclePlate = vehicleLockIdentifier;
                socket.vehicleLockLeaseToken = pendingVehicleLeaseToken;
                socket.vehicleLeaseSuperseded = false;
            }

            const projectionCheckedAt = new Date().toISOString();
            await commitDriverOnlineProjection(redis, {
                driverId,
                driverKey,
                eligibleGeoKey: ELIGIBLE_DRIVER_GEO_KEY,
                isOnline,
                dispatchEligible: nextDispatchEligible,
                lat,
                lng,
                fields: {
                    driverId,
                    status,
                    isOnline: String(isOnline),
                    dispatchEligible: String(nextDispatchEligible),
                    dispatchEligibilityCode: nextDispatchEligibilityCode,
                    dispatchEligibilityCheckedAt: projectionCheckedAt,
                    ...(isOnline && pendingVehicleLockIdentifier
                        ? {
                            vehiclePlate: pendingVehicleLockIdentifier,
                            vehicleLockValidated: 'true',
                            vehicleLockValidatedAt: projectionCheckedAt
                        }
                        : {}),
                    ...(shouldWriteDestinationMode ? destinationIntent.patch : {}),
                    updatedAt: projectionCheckedAt
                }
            });
            vehicleLockCommitted = isOnline && Boolean(pendingVehicleLockIdentifier);

            if (isOnline) {
                const transition = await resolveDriverOnlineTransition(redis, {
                    driverId,
                    isOnline: true
                });
                driverOnlineDaily = transition.snapshot;
            } else {
                const currentVehicleLockIdentifier = resolveVehicleLockIdentifier({
                    plate: socket.vehiclePlate || existingDriverState?.vehiclePlate,
                    vehicleId: existingDriverState?.activeVehicleId
                });
                if (currentVehicleLockIdentifier && vehicleLockManager) {
                    await vehicleLockManager.releaseLock(currentVehicleLockIdentifier, driverId, {
                        leaseToken: socket.vehicleLockLeaseToken || socket.id
                    });
                }
                socket.vehiclePlate = null;
                socket.vehicleLockLeaseToken = null;
                socket.vehicleLeaseSuperseded = false;

                const transition = await resolveDriverOnlineTransition(redis, {
                    driverId,
                    isOnline: false
                });
                driverOnlineDaily = transition.snapshot;
            }

            if (isOnline && hasValidLocation) {
                await pricingH3ReadModelService.applyDriverSnapshot(redis, {
                    driverId,
                    lat,
                    lng,
                    isOnline: true,
                    available: nextDispatchEligible
                }).catch(() => null);
            } else if (!isOnline) {
                await pricingH3ReadModelService.removeDriverSnapshot(redis, driverId).catch(() => null);
            }

            socket.emit('driverStatusUpdated', {
                success: true,
                driverId,
                status,
                isOnline,
                dispatchEligible: nextDispatchEligible,
                destinationMode: shouldWriteDestinationMode
                    ? destinationIntent.destinationMode
                    : undefined,
                destinationModePolicy: destinationIntent.policy || null,
                vehicleIdentity,
                driverOnlineDaily,
                checkedAt: new Date().toISOString()
            });
            scheduleMapH3Refresh(io, {
                reason: 'driver_status_updated',
                driverId,
                status,
                isOnline
            });
        } catch (error) {
            if (pendingVehicleLockIdentifier && !vehicleLockCommitted && vehicleLockManager) {
                await vehicleLockManager
                    .releaseLock(pendingVehicleLockIdentifier, data.driverId || socket.userId, {
                        leaseToken: pendingVehicleLeaseToken
                    })
                    .catch(() => null);
                socket.vehiclePlate = null;
                socket.vehicleLockLeaseToken = null;
            }
            logStructured('warn', 'Falha ao processar setDriverStatus', {
                service: 'driver-control-handlers',
                driverId: data.driverId || socket.userId || null,
                error: error?.message || String(error)
            });

            socket.emit('driverStatusError', buildPublicDriverStatusFailure(error));
        }
    });
}

module.exports = registerSocketDriverControlHandlers;
