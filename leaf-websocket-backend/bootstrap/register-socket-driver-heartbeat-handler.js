const driverEligibilityService = require('../services/driver-eligibility-service');

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
                const heartbeatService = require('../services/heartbeat-service');
                await heartbeatService.ping(driverId);
            } catch (hbErr) {
                logStructured('warn', 'Falha ao processar novo heartbeat service', { driverId, error: hbErr.message });
            }

            // ✅ Heartbeat: apenas renovar TTL usando última localização conhecida
            const isInTripState = isInTrip || tripStatus === 'started' || tripStatus === 'accepted';
            const redis = redisPool.getConnection();

            // Aplicar validação KYC diária na transição offline -> online via updateLocation
            const existingDriverState = await redis.hgetall(`driver:${driverId}`);
            const wasOnline = existingDriverState?.isOnline === 'true';
            if (!wasOnline) {
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
                        socket.emit('driverStatusError', {
                            error: 'Verificação facial diária necessária para ficar online.',
                            reason: dailyKYC.reason,
                            code: dailyKYC.code,
                            kycRequired: true,
                            requirement: dailyKYC.requirement || 'LIVENESS_REQUIRED',
                            challengeId: dailyKYC.challenge?.challengeId || null,
                            challenge: dailyKYC.challenge || null
                        });
                        return;
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
                        reason: kycError.message,
                        code: 'kycCheckFailed',
                        kycRequired: true
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
                            dispatchEligibilityCode: 'IN_TRIP',
                            dispatchEligibilityCheckedAt: new Date().toISOString()
                        });
                    }
                }

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
                await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                await redis.hset(`driver:${driverId}`, {
                    dispatchEligible: 'false',
                    dispatchEligibilityCode: isInTripState ? 'IN_TRIP' : 'AWAITING_LOCATION_SYNC',
                    dispatchEligibilityCheckedAt: new Date().toISOString()
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
