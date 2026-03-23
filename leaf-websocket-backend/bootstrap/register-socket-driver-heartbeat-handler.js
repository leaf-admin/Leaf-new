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
                            kycRequired: true
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

                // Atualizar lastSeen
                await redis.hset(`driver:${driverId}`, 'lastSeen', new Date().toISOString());

                const effectiveLat = Number.parseFloat(existingData.lat || lat);
                const effectiveLng = Number.parseFloat(existingData.lng || lng);
                const shouldBeEligible = !isInTripState && existingData.dispatchEligible === 'true';
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
