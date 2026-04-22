const { assessDriverArrivalAtPickup } = require('../utils/pickup-arrival-policy');
const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
const { buildActiveRideSnapshotForUser } = require('./active-ride-sync-utils');
const RideStateManager = require('../services/ride-state-manager');
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
const { writeVisibleBookingSnapshot } = require('../services/booking-visibility-service');
const {
    resolveDriverActivationState
} = require('../services/driver-activation-state-service');

const DRIVER_BOARDING_WINDOW_SECONDS = Math.max(
    30,
    Number.parseInt(process.env.DRIVER_BOARDING_WINDOW_SECONDS || '120', 10) || 120
);

function registerSocketDriverControlHandlers({
    socket,
    io,
    redisPool,
    logStructured,
    enforceSubscriptionForOnline = null,
    enforceDailyKYCForOnline = null
}) {
    const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

    const handleArriveAtPickup = async (data = {}, transport = 'arriveAtPickup') => {
        try {
            const rideId = data.rideId || data.bookingId || null;
            const location = data.location || null;

            if (!rideId) return;

            const redis = redisPool.getConnection();
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
                timestamp: new Date().toISOString()
            };
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
        try {
            const redis = redisPool.getConnection();
            const driverId = data.driverId || socket.userId;
            const requestedStatus = String(data.status || '').toUpperCase();
            const requestedOnline = data.isOnline !== false && requestedStatus !== 'OFFLINE';
            const status = requestedOnline ? 'AVAILABLE' : 'OFFLINE';
            const isOnline = requestedOnline === true;

            if (!driverId) {
                socket.emit('driverStatusError', {
                    error: 'driverId ausente',
                    code: 'MISSING_DRIVER_ID'
                });
                return;
            }

            const driverKey = `driver:${driverId}`;
            const existingDriverState = await redis.hgetall(driverKey);
            const existingIsEligible = existingDriverState?.dispatchEligible === 'true';

            if (!isOnline) {
                await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                await redis.zrem('driver_locations', driverId);
                await redis.srem('online_drivers', driverId);
                await pricingH3ReadModelService.removeDriverSnapshot(redis, driverId).catch(() => null);
            }

            if (isOnline) {
                const activationState = await resolveDriverActivationState({ driverId }).catch((error) => {
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
                    await redis
                        .multi()
                        .hset(driverKey, {
                            driverId,
                            status: 'OFFLINE',
                            isOnline: 'false',
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: activationState?.state || 'DRIVER_ACTIVATION_BLOCKED',
                            dispatchEligibilityCheckedAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        })
                        .zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId)
                        .zrem('driver_locations', driverId)
                        .srem('online_drivers', driverId)
                        .exec();

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
                        socket.emit('driverStatusError', {
                            success: false,
                            error: kycGate?.reason || 'Validacao facial obrigatoria para ficar online.',
                            code: kycGate?.code || 'kycRequired',
                            kycRequired: true,
                            activationState,
                            requirement: activationState?.requiresLiveness ? 'FIRST_ONLINE_LIVENESS' : 'RISK_OR_RECURRENCE_LIVENESS'
                        });
                        return;
                    }
                }
            }

            await redis.hset(driverKey, {
                driverId,
                status,
                isOnline: String(isOnline),
                dispatchEligible: String(isOnline && existingIsEligible),
                dispatchEligibilityCode: isOnline
                    ? (existingDriverState?.dispatchEligibilityCode || 'AWAITING_LOCATION_SYNC')
                    : 'OFFLINE',
                dispatchEligibilityCheckedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            if (isOnline && existingIsEligible) {
                const lat = Number(existingDriverState?.lat);
                const lng = Number(existingDriverState?.lng);
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    await redis.geoadd(ELIGIBLE_DRIVER_GEO_KEY, lng, lat, driverId);
                    await redis.geoadd('driver_locations', lng, lat, driverId);
                    await redis.sadd('online_drivers', driverId);
                    await pricingH3ReadModelService.applyDriverSnapshot(redis, {
                        driverId,
                        lat,
                        lng,
                        isOnline: true,
                        available: true
                    }).catch(() => null);
                }
            }

            socket.emit('driverStatusUpdated', {
                success: true,
                driverId,
                status,
                isOnline,
                dispatchEligible: isOnline && existingIsEligible,
                checkedAt: new Date().toISOString()
            });
            scheduleMapH3Refresh(io, {
                reason: 'driver_status_updated',
                driverId,
                status,
                isOnline
            });
        } catch (error) {
            logStructured('warn', 'Falha ao processar setDriverStatus', {
                service: 'driver-control-handlers',
                driverId: data.driverId || socket.userId || null,
                error: error.message
            });

            socket.emit('driverStatusError', {
                error: error.message || 'Erro ao atualizar status do motorista',
                code: 'DRIVER_STATUS_UPDATE_FAILED'
            });
        }
    });
}

module.exports = registerSocketDriverControlHandlers;
