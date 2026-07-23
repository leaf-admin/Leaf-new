const driverEligibilityService = require('../services/driver-eligibility-service');
const {
    DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
    readDriverOnlineDailySnapshot,
    resolveDriverOnlineTransition
} = require('../services/driver-online-time-policy-service');
const {
    upsertDriverSocketPresence
} = require('../services/driver-socket-presence-service');
const {
    renewActiveTripForDriver,
    resolveActiveTripForDriver
} = require('../utils/active-trip-index');
const {
    buildPublicDriverKycSocketPayload
} = require('../utils/driver-kyc-socket-projection');

const parseTimestampMs = (rawValue) => {
    if (!rawValue) return 0;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return rawValue;

    const numeric = Number.parseInt(String(rawValue), 10);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }

    const parsedDate = Date.parse(String(rawValue));
    return Number.isFinite(parsedDate) ? parsedDate : 0;
};

const DISPATCH_ELIGIBILITY_RECHECK_MIN_MS = Math.max(
    3000,
    Number.parseInt(process.env.DISPATCH_ELIGIBILITY_RECHECK_MIN_MS || '15000', 10) || 15000
);

function registerSocketDriverHeartbeatHandler({
    socket,
    redisPool,
    logStructured,
    enforceSubscriptionForOnline,
    enforceDailyKYCForOnline,
    saveDriverLocation,
    vehicleLockManager
}) {
    const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
    socket.on('driverHeartbeat', async (data) => {
        try {
            const driverId = socket.userId || data.uid || data.driverId;
            const { lat, lng } = data;
            const latNum = Number(lat);
            const lngNum = Number(lng);

            if (!driverId || !Number.isFinite(latNum) || !Number.isFinite(lngNum) || socket.userType !== 'driver') {
                return; // Dados inválidos, ignorar silenciosamente
            }
            if (socket.vehicleLeaseSuperseded === true) {
                return;
            }

            socket.lastHeartbeat = Date.now();
            socket.lastDriverHeartbeatAt = socket.lastHeartbeat;

            // ✅ CAOS SCENARIO: Registrar Heartbeat para calcular tempo offline/resiliência de billing
            try {
                const heartbeatService = require('../services/heartbeat-service');
                await heartbeatService.ping(driverId);
            } catch (hbErr) {
                logStructured('warn', 'Falha ao processar novo heartbeat service', { driverId, error: hbErr.message });
            }

            const redis = redisPool.getConnection();
            let activeTripIndexResolved = false;
            let canonicalActiveTrip = { tripId: null, customerId: null };
            try {
                canonicalActiveTrip = await resolveActiveTripForDriver(redis, driverId)
                    || { tripId: null, customerId: null };
                activeTripIndexResolved = true;
            } catch (error) {
                logStructured('warn', 'Heartbeat: falha ao consultar indice canonico de corrida ativa', {
                    service: 'driverHeartbeat',
                    driverId,
                    error: error.message
                });
            }
            if (activeTripIndexResolved && canonicalActiveTrip?.tripId) {
                try {
                    const leaseRenewed = await renewActiveTripForDriver(
                        redis,
                        driverId,
                        canonicalActiveTrip.tripId
                    );
                    if (!leaseRenewed) {
                        logStructured('warn', 'Heartbeat: lease de corrida ativa nao foi renovado', {
                            service: 'driverHeartbeat',
                            driverId,
                            bookingId: canonicalActiveTrip.tripId,
                            reason: 'backend_booking_not_confirmed'
                        });
                    }
                } catch (error) {
                    logStructured('warn', 'Heartbeat: falha ao renovar lease de corrida ativa', {
                        service: 'driverHeartbeat',
                        driverId,
                        bookingId: canonicalActiveTrip.tripId,
                        error: error.message
                    });
                }
            }
            // Sem leitura autoritativa conclusiva, o heartbeat preserva a corrida
            // e nunca inicia uma verificacao biometrica paga. Quando a leitura
            // conclui que nao ha corrida, flags do cliente nao podem suprimir KYC.
            let isInTripState = !activeTripIndexResolved
                || Boolean(canonicalActiveTrip?.tripId);
            await upsertDriverSocketPresence(redis, {
                driverId,
                socket,
                source: 'driverHeartbeat',
                fallbackRooms: ['drivers_room', `driver_${driverId}`]
            }).catch((presenceError) => {
                logStructured('warn', 'Falha ao renovar presença distribuída do motorista no heartbeat', {
                    service: 'driverHeartbeat',
                    driverId,
                    socketId: socket.id,
                    error: presenceError.message
                });
            });

            // Aplicar validação KYC diária na transição offline -> online via updateLocation
            const existingDriverState = await redis.hgetall(`driver:${driverId}`);
            const wasOnline = existingDriverState?.isOnline === 'true';
            let kycContinuityDeferred = !activeTripIndexResolved || Boolean(canonicalActiveTrip?.tripId);
            const applyKycContinuityState = async (gateResult = {}) => {
                const activeTripId = gateResult.activeTripId || canonicalActiveTrip?.tripId || null;
                isInTripState = true;
                kycContinuityDeferred = true;
                const checkedAt = new Date().toISOString();
                await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                await redis.hset(`driver:${driverId}`, {
                    isOnline: 'true',
                    dispatchEligible: 'false',
                    dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
                    dispatchEligibilityCheckedAt: checkedAt,
                    kycRecheckPendingAfterTrip: 'true',
                    ...(activeTripId ? { activeTripId: String(activeTripId) } : {}),
                    updatedAt: checkedAt
                });
            };

            if (isInTripState) {
                await applyKycContinuityState({ activeTripId: canonicalActiveTrip?.tripId || null });
            }

            if (!wasOnline && !isInTripState) {
                const subscriptionGate = await enforceSubscriptionForOnline(driverId);
                if (!subscriptionGate.allowed) {
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    await redis.hset(`driver:${driverId}`, {
                        dispatchEligible: 'false',
                        dispatchEligibilityCode: subscriptionGate.code || 'SUBSCRIPTION_REQUIRED',
                        dispatchEligibilityCheckedAt: new Date().toISOString()
                    });
                    socket.emit('driverStatusError', {
                        error: 'Assinatura pendente. Regularize para ficar online.',
                        reason: subscriptionGate.reason,
                        code: subscriptionGate.code,
                        subscriptionRequired: true
                    });
                    return;
                }

                try {
                    const dailyKYC = await enforceDailyKYCForOnline(driverId);
                    if (!dailyKYC.allowed) {
                        await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                        await redis.hset(`driver:${driverId}`, {
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: dailyKYC.code || 'KYC_REQUIRED',
                            dispatchEligibilityCheckedAt: new Date().toISOString()
                        });
                        socket.emit('driverStatusError', buildPublicDriverKycSocketPayload(
                            dailyKYC,
                            { message: 'Verificação facial necessária para ficar online.' }
                        ));
                        return;
                    }
                    if (dailyKYC.continuityOnly === true || dailyKYC.deferred === true) {
                        await applyKycContinuityState(dailyKYC);
                    }
                } catch (kycError) {
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    await redis.hset(`driver:${driverId}`, {
                        dispatchEligible: 'false',
                        dispatchEligibilityCode: 'KYC_CHECK_FAILED',
                        dispatchEligibilityCheckedAt: new Date().toISOString()
                    });
                    socket.emit('driverStatusError', {
                        error: 'Não foi possível validar KYC agora. Tente novamente.',
                        reason: 'Não foi possível validar KYC agora. Tente novamente.',
                        code: 'kycCheckFailed',
                        kycRequired: true
                    });
                    return;
                }
            }

            const previousEligibilityCode = String(
                existingDriverState?.dispatchEligibilityCode || ''
            ).toUpperCase();
            const requiresPostTripKyc =
                existingDriverState?.kycRecheckPendingAfterTrip === 'true'
                || previousEligibilityCode === 'IN_TRIP'
                || previousEligibilityCode === 'IN_TRIP_KYC_DEFERRED';
            if (
                wasOnline
                && activeTripIndexResolved
                && !canonicalActiveTrip?.tripId
                && !isInTripState
                && !kycContinuityDeferred
                && requiresPostTripKyc
            ) {
                const postTripKyc = await enforceDailyKYCForOnline(driverId);
                if (!postTripKyc?.allowed) {
                    const checkedAt = new Date().toISOString();
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    await redis.zrem('driver_locations', driverId);
                    await redis.srem('online_drivers', driverId);
                    await redis.hset(`driver:${driverId}`, {
                        status: 'OFFLINE',
                        isOnline: 'false',
                        dispatchEligible: 'false',
                        dispatchEligibilityCode: postTripKyc?.code || 'KYC_REQUIRED',
                        dispatchEligibilityCheckedAt: checkedAt,
                        kycRecheckPendingAfterTrip: postTripKyc?.retryRequired === true
                            ? 'true'
                            : 'false',
                        updatedAt: checkedAt
                    });
                    socket.emit('driverStatusError', buildPublicDriverKycSocketPayload(
                        postTripKyc,
                        { message: 'Validação facial necessária para voltar a receber corridas.' }
                    ));
                    return;
                }
                if (postTripKyc.continuityOnly === true || postTripKyc.deferred === true) {
                    await applyKycContinuityState(postTripKyc);
                } else {
                    await redis.hset(`driver:${driverId}`, {
                        kycRecheckPendingAfterTrip: 'false',
                        dispatchEligibilityCheckedAt: new Date().toISOString()
                    });
                }
            }

            if (wasOnline && !isInTripState) {
                let onlineDailySnapshot = await readDriverOnlineDailySnapshot(redis, driverId);
                // Ao cruzar a meia-noite (ou perder apenas a chave diaria), o
                // motorista segue online. Abrir a sessao do novo dia evita um
                // contador zerado indefinidamente e garante nova transicao
                // offline antes da proxima janela de KYC.
                if (!onlineDailySnapshot.sessionStartedAtMs && !onlineDailySnapshot.limitReached) {
                    const rollover = await resolveDriverOnlineTransition(redis, {
                        driverId,
                        isOnline: true
                    });
                    onlineDailySnapshot = rollover.snapshot;
                }
                if (onlineDailySnapshot.limitReached) {
                    const transition = await resolveDriverOnlineTransition(redis, {
                        driverId,
                        isOnline: false
                    });
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    await redis.zrem('driver_locations', driverId);
                    await redis.srem('online_drivers', driverId);
                    await redis.hset(`driver:${driverId}`, {
                        status: 'OFFLINE',
                        isOnline: 'false',
                        dispatchEligible: 'false',
                        dispatchEligibilityCode: 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
                        dispatchEligibilityCheckedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                    socket.emit('driverStatusError', {
                        success: false,
                        error: DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
                        message: DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
                        code: 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
                        driverOnlineDaily: transition.snapshot
                    });
                    socket.emit('driverStatusUpdated', {
                        success: true,
                        driverId,
                        status: 'OFFLINE',
                        isOnline: false,
                        dispatchEligible: false,
                        code: 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
                        message: DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
                        driverOnlineDaily: transition.snapshot,
                        checkedAt: new Date().toISOString()
                    });
                    return;
                }
            }
            // Verificar se motorista já está no Redis
            const existingData = await redis.hgetall(`driver:${driverId}`);

                if (existingData && existingData.id) {
                    // ✅ Motorista existe: apenas renovar TTL e garantir que está no GEO
                    // TTL alinhado com saveDriverLocation: 60s em viagem, 120s online
                    // Heartbeat a cada 30s garante que nunca expire se motorista estiver online
                    const { getTTL } = require('../config/redis-ttl-config');
                const ttl = isInTripState
                    ? getTTL('DRIVER_LOCATION', 'IN_TRIP')
                    : getTTL('DRIVER_LOCATION', 'ONLINE');
                await redis.expire(`driver:${driverId}`, ttl);

                // Garantir que está no GEO ativo (pode ter expirado)
                const isInGeo = await redis.zscore('driver_locations', driverId);
                    if (!isInGeo) {
                        // Re-adicionar ao GEO se não estiver
                        await redis.geoadd('driver_locations', parseFloat(existingData.lng || lngNum), parseFloat(existingData.lat || latNum), driverId);
                        await redis.zrem('driver_offline_locations', driverId);
                    }
                    await redis.sadd('online_drivers', driverId);

                const effectiveLat = Number.parseFloat(existingData.lat || lat);
                const effectiveLng = Number.parseFloat(existingData.lng || lng);
                // Atualizar lastSeen/heartbeat com timestamp numérico recente para evitar stale cleanup
                const nowIso = new Date().toISOString();
                const heartbeatTs = Date.now();
                await redis.hset(`driver:${driverId}`, {
                    lastSeen: nowIso,
                    lastHeartbeatAt: nowIso,
                    lastUpdate: String(heartbeatTs),
                    timestamp: String(heartbeatTs),
                    lat: String(effectiveLat),
                    lng: String(effectiveLng)
                });
                const currentEligibilityCode = String(existingData.dispatchEligibilityCode || '').toUpperCase();
                const isCurrentlyEligible = existingData.dispatchEligible === 'true';
                let shouldBeEligible = !isInTripState && isCurrentlyEligible;

                // Heartbeat também precisa recuperar elegibilidade quando o driver ficou preso em estado residual
                // (ex.: IN_TRIP/AWAITING_LOCATION_SYNC) sem depender exclusivamente do updateLocation.
                if (!isInTripState && !shouldBeEligible) {
                    const recheckCandidates = new Set([
                        '',
                        'UNKNOWN',
                        'CACHED',
                        'IN_TRIP',
                        'IN_TRIP_KYC_DEFERRED',
                        'AWAITING_LOCATION_SYNC'
                    ]);
                    const lastCheckedAtMs = parseTimestampMs(existingData.dispatchEligibilityCheckedAt);
                    const canRecheckNow = (Date.now() - lastCheckedAtMs) >= DISPATCH_ELIGIBILITY_RECHECK_MIN_MS;

                    if (canRecheckNow && recheckCandidates.has(currentEligibilityCode)) {
                        try {
                            const eligibility = await driverEligibilityService.isDriverEligibleForRide(
                                driverId,
                                null,
                                existingData || {}
                            );
                            shouldBeEligible = eligibility.eligible === true;

                            if (shouldBeEligible) {
                                await redis.hset(`driver:${driverId}`, {
                                    dispatchEligible: 'true',
                                    dispatchEligibilityCode: eligibility.code || 'ELIGIBLE',
                                    dispatchEligibilityCheckedAt: new Date().toISOString()
                                });
                            } else {
                                await redis.hset(`driver:${driverId}`, {
                                    dispatchEligible: 'false',
                                    dispatchEligibilityCode: eligibility.code || 'NOT_ELIGIBLE',
                                    dispatchEligibilityCheckedAt: new Date().toISOString()
                                });
                            }
                        } catch (eligibilityError) {
                            logStructured('debug', 'Heartbeat: falha ao revalidar elegibilidade de dispatch', {
                                service: 'driverHeartbeat',
                                driverId,
                                error: eligibilityError.message
                            });
                        }
                    }
                }

                if (shouldBeEligible && Number.isFinite(effectiveLat) && Number.isFinite(effectiveLng)) {
                    await redis.geoadd(ELIGIBLE_DRIVER_GEO_KEY, effectiveLng, effectiveLat, driverId);
                } else {
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    if (isInTripState) {
                        await redis.hset(`driver:${driverId}`, {
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: kycContinuityDeferred
                                ? 'IN_TRIP_KYC_DEFERRED'
                                : 'IN_TRIP',
                            dispatchEligibilityCheckedAt: new Date().toISOString(),
                            ...(kycContinuityDeferred ? { kycRecheckPendingAfterTrip: 'true' } : {})
                        });
                    }
                }

                // ✅ HEARTBEAT: Renovar lock de veículo (se motorista estiver online)
                if (socket.vehiclePlate) {
                    const vehiclePlate = socket.vehiclePlate;
                    let lockRenewed = false;
                    try {
                        lockRenewed = await vehicleLockManager.renewLock(vehiclePlate, driverId, {
                            leaseToken: socket.vehicleLockLeaseToken || socket.id
                        });
                    } catch (lockError) {
                        logStructured('error', 'Erro ao renovar lock de veículo', {
                            service: 'server',
                            driverId,
                            vehiclePlate,
                            error: lockError.message,
                            stack: lockError.stack,
                            eventType: 'driverHeartbeat'
                        });
                    }

                    if (!lockRenewed) {
                        const currentLeaseToken = socket.vehicleLockLeaseToken || socket.id;
                        const currentOwner = typeof vehicleLockManager?.getLockOwner === 'function'
                            ? await vehicleLockManager.getLockOwner(vehiclePlate).catch(() => null)
                            : null;
                        const sessionWasSuperseded = currentOwner?.driverId === driverId &&
                            Boolean(currentOwner?.leaseToken) &&
                            currentOwner.leaseToken !== currentLeaseToken;
                        if (sessionWasSuperseded) {
                            socket.vehicleLeaseSuperseded = true;
                            socket.vehiclePlate = null;
                            socket.vehicleLockLeaseToken = null;
                            const message = 'Esta sessão foi substituída por uma conexão mais recente.';
                            socket.emit('driverStatusError', {
                                success: false,
                                error: message,
                                message,
                                code: 'DRIVER_SESSION_REPLACED'
                            });
                            return;
                        }

                        if (isInTripState) {
                            const checkedAt = new Date().toISOString();
                            await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                            await redis.hset(`driver:${driverId}`, {
                                status: existingData.status || existingDriverState?.status || 'IN_TRIP',
                                isOnline: 'true',
                                dispatchEligible: 'false',
                                dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
                                dispatchEligibilityCheckedAt: checkedAt,
                                kycRecheckPendingAfterTrip: 'true',
                                vehicleLeaseRecheckPendingAfterTrip: 'true',
                                vehicleLeaseLastFailureAt: checkedAt,
                                updatedAt: checkedAt
                            });
                            logStructured('warn', 'Falha ao renovar lease veicular durante corrida; continuidade preservada', {
                                service: 'driverHeartbeat',
                                driverId,
                                vehiclePlate,
                                activeTripId: canonicalActiveTrip?.tripId || null
                            });
                            return;
                        }

                        const checkedAt = new Date().toISOString();
                        await resolveDriverOnlineTransition(redis, {
                            driverId,
                            isOnline: false
                        }).catch((transitionError) => {
                            logStructured('warn', 'Falha ao fechar sessão online após perda do lease veicular', {
                                service: 'driverHeartbeat',
                                driverId,
                                error: transitionError.message
                            });
                        });
                        await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                        await redis.zrem('driver_locations', driverId);
                        await redis.srem('online_drivers', driverId);
                        await redis.hset(`driver:${driverId}`, {
                            status: 'OFFLINE',
                            isOnline: 'false',
                            dispatchEligible: 'false',
                            dispatchEligibilityCode: 'VEHICLE_LEASE_LOST',
                            dispatchEligibilityCheckedAt: checkedAt,
                            updatedAt: checkedAt
                        });
                        socket.vehiclePlate = null;
                        socket.vehicleLockLeaseToken = null;
                        const message = 'A sessão deste veículo perdeu validade. Fique online novamente.';
                        socket.emit('driverStatusError', {
                            success: false,
                            error: message,
                            message,
                            code: 'VEHICLE_LEASE_LOST'
                        });
                        socket.emit('driverStatusUpdated', {
                            success: true,
                            driverId,
                            status: 'OFFLINE',
                            isOnline: false,
                            dispatchEligible: false,
                            code: 'VEHICLE_LEASE_LOST',
                            message,
                            checkedAt
                        });
                        return;
                    }

                    logStructured('debug', 'Lock de veículo renovado', {
                        service: 'server',
                        driverId,
                        vehiclePlate,
                        eventType: 'driverHeartbeat'
                    });
                }
            } else {
                // Se não existe, criar com dados do heartbeat
                await saveDriverLocation(driverId, latNum, lngNum, 0, 0, Date.now(), true, isInTripState);
                await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                await redis.hset(`driver:${driverId}`, {
                    dispatchEligible: 'false',
                    dispatchEligibilityCode: isInTripState
                        ? (kycContinuityDeferred ? 'IN_TRIP_KYC_DEFERRED' : 'IN_TRIP')
                        : 'AWAITING_LOCATION_SYNC',
                    dispatchEligibilityCheckedAt: new Date().toISOString(),
                    ...(kycContinuityDeferred ? { kycRecheckPendingAfterTrip: 'true' } : {})
                });
            }

        } catch (error) {
            // Ignorar erros de heartbeat silenciosamente (não é crítico)
            logStructured('debug', `Erro ao processar heartbeat`, {
                service: 'driverHeartbeat',
                error: error.message
            });
        }
    });
}

module.exports = registerSocketDriverHeartbeatHandler;
