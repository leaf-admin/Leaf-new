const {
    resolveActiveTripForDriver,
    setActiveTripForDriver
} = require('../utils/active-trip-index');
const driverEligibilityService = require('../services/driver-eligibility-service');
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');

const ENABLE_ACTIVE_TRIP_INDEX = process.env.ENABLE_ACTIVE_TRIP_INDEX !== 'false';
const ENABLE_TRIP_LOCATION_STREAM = process.env.ENABLE_TRIP_LOCATION_STREAM !== 'false';
const TRIP_LOCATION_OUT_OF_ORDER_WINDOW = Number.parseInt(process.env.TRIP_LOCATION_OUT_OF_ORDER_WINDOW || '15', 10);
const TRIP_LOCATION_DEDUP_TTL_SECONDS = Number.parseInt(process.env.TRIP_LOCATION_DEDUP_TTL_SECONDS || String(6 * 60 * 60), 10);
const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
const ENABLE_LEGACY_UPDATE_DRIVER_LOCATION_EVENT =
    String(process.env.ENABLE_LEGACY_UPDATE_DRIVER_LOCATION_EVENT || 'false').toLowerCase() === 'true';
const MAX_SHARED_ROUTE_COORDINATES = Number.parseInt(
    process.env.MAX_SHARED_ROUTE_COORDINATES || '700',
    10
);

function normalizeSharedRouteCoordinate(coordinate) {
    const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
    const longitude = Number(coordinate?.longitude ?? coordinate?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
    }
    return { latitude, longitude };
}

function normalizeSharedRouteCoordinates(coordinates) {
    if (!Array.isArray(coordinates)) {
        return [];
    }
    return coordinates
        .slice(0, Math.max(2, MAX_SHARED_ROUTE_COORDINATES))
        .map(normalizeSharedRouteCoordinate)
        .filter(Boolean);
}

function normalizeSharedRouteMetric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeSharedRoutePlan(routePlan) {
    if (!routePlan || typeof routePlan !== 'object') {
        return null;
    }

    const pickupCoordinates = normalizeSharedRouteCoordinates(routePlan.pickupCoordinates);
    const destinationCoordinates = normalizeSharedRouteCoordinates(routePlan.destinationCoordinates);
    const combinedCoordinates = normalizeSharedRouteCoordinates(routePlan.combinedCoordinates);

    if (pickupCoordinates.length < 2 || destinationCoordinates.length < 2) {
        return null;
    }

    return {
        pickupCoordinates,
        destinationCoordinates,
        combinedCoordinates:
            combinedCoordinates.length >= 2
                ? combinedCoordinates
                : [...pickupCoordinates, ...destinationCoordinates.slice(1)],
        pickupDistanceKm: normalizeSharedRouteMetric(routePlan.pickupDistanceKm),
        pickupDurationMinutes: normalizeSharedRouteMetric(routePlan.pickupDurationMinutes),
        destinationDistanceKm: normalizeSharedRouteMetric(routePlan.destinationDistanceKm),
        destinationDurationMinutes: normalizeSharedRouteMetric(routePlan.destinationDurationMinutes)
    };
}

function registerSocketUpdateLocationHandler({
    socket,
    io,
    rateLimiterService,
    logStructured,
    redisPool,
    enforceSubscriptionForOnline,
    enforceDailyKYCForOnline,
    saveDriverLocation
}) {
    const normalizeIncomingLocationPayload = (payload = {}, sourceEvent = 'updateLocation') => {
        if (sourceEvent !== 'updateDriverLocation') {
            return payload || {};
        }

        const normalized = { ...(payload || {}) };
        if (!normalized.uid && normalized.driverId) {
            normalized.uid = normalized.driverId;
        }
        if (!normalized.tripStatus) {
            normalized.tripStatus = normalized.isInTrip ? 'started' : 'available';
        }
        if (normalized.capturedAt == null && normalized.timestamp != null) {
            normalized.capturedAt = normalized.timestamp;
        }

        return normalized;
    };

    const handleUpdateLocation = async (incomingData = {}, sourceEvent = 'updateLocation') => {
        const data = normalizeIncomingLocationPayload(incomingData, sourceEvent);
        const emitLocationError = (payload) => {
            const normalizedPayload = typeof payload === 'string' ? { error: payload } : payload;
            if (sourceEvent === 'updateDriverLocation') {
                socket.emit('locationError', normalizedPayload);
                return;
            }
            socket.emit('error', normalizedPayload);
        };

        try {
            // Obter driverId do socket (autenticado) ou dos dados
            const driverId = socket.userId || data.uid || data.driverId;

            // ✅ NOVO: Rate Limiting (leve para não afetar GPS)
            const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'updateLocation');

            if (!rateLimitCheck.allowed) {
                // Para GPS, apenas logar mas não bloquear (fail-open para não afetar rastreamento)
                logStructured('warn', 'updateLocation excedido por rate limiter, mas permitindo (GPS crítico)', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    limit: rateLimitCheck.limit
                });
                // Continuar processamento (GPS é crítico)
            }

            const {
                lat,
                lng,
                tripStatus,
                isInTrip,
                tripId: tripIdFromClient,
                seq,
                capturedAt,
                accuracy,
                heading,
                speed
            } = data;
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
                    lat,
                    lng,
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
                emitLocationError({ message: 'Dados de localização incompletos ou motorista não autenticado' });
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
                emitLocationError({ message: 'Apenas motoristas podem atualizar localização' });
                return;
            }

            // ✅ OTIMIZAÇÃO 4: TTL diferenciado por estado
            // - Em viagem: 30 segundos (dados críticos, precisa ser muito atualizado)
            // - Online disponível: 90 segundos (balanceia responsividade e tolerância a falhas)
            const sharedRouteBookingId = String(data.bookingId || tripIdFromClient || '').trim();
            const hasSharedRoutePlanCandidate = Boolean(
                sharedRouteBookingId &&
                data.routePlan &&
                typeof data.routePlan === 'object'
            );
            const isInTripState =
                isInTrip ||
                tripStatus === 'started' ||
                tripStatus === 'accepted' ||
                hasSharedRoutePlanCandidate;
            const redis = redisPool.getConnection();

            // Aplicar validação KYC diária na transição offline -> online via updateLocation
            const driverHashKey = `driver:${driverId}`;
            const existingDriverState = await redis.hgetall(driverHashKey);
            const wasOnline = existingDriverState?.isOnline === 'true';
            let dispatchEligibility = {
                eligible: existingDriverState?.dispatchEligible === 'true',
                code: existingDriverState?.dispatchEligibilityCode || 'CACHED'
            };
            if (!wasOnline) {
                const subscriptionGate = await enforceSubscriptionForOnline(driverId);
                if (!subscriptionGate.allowed) {
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    await redis.hset(driverHashKey, {
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
                        await redis.hset(driverHashKey, {
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
                    await redis.hset(driverHashKey, {
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

                // Elegibilidade é validada no momento de ficar online.
                // Se não elegível, não entra no pool ativo de dispatch.
                dispatchEligibility = await driverEligibilityService.isDriverEligibleForRide(
                    driverId,
                    null,
                    existingDriverState || {}
                );
                if (!dispatchEligibility.eligible) {
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    await redis.hset(driverHashKey, {
                        isOnline: 'false',
                        status: 'OFFLINE',
                        dispatchEligible: 'false',
                        dispatchEligibilityCode: dispatchEligibility.code || 'NOT_ELIGIBLE',
                        dispatchEligibilityCheckedAt: new Date().toISOString()
                    });
                    socket.emit('driverStatusError', {
                        error: 'Cadastro pendente de aprovação para receber corridas.',
                        reason: dispatchEligibility.code || 'NOT_ELIGIBLE',
                        code: 'driverNotEligible',
                        eligibilityRequired: true
                    });
                    return;
                }
            }

            // Motorista pode permanecer online após completar corrida com flag elegível em false (ex.: IN_TRIP).
            // Revalidar apenas nesse cenário para voltar ao pool de dispatch sem esperar fallback por expansão.
            const eligibilityCode = String(dispatchEligibility.code || '').toUpperCase();
            const needsEligibilityRecheck = !isInTripState && (
                dispatchEligibility.eligible !== true ||
                eligibilityCode === 'IN_TRIP' ||
                eligibilityCode === 'UNKNOWN' ||
                eligibilityCode === 'CACHED'
            );

            if (needsEligibilityRecheck) {
                dispatchEligibility = await driverEligibilityService.isDriverEligibleForRide(
                    driverId,
                    null,
                    existingDriverState || {}
                );

                if (!dispatchEligibility.eligible) {
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                    await redis.hset(driverHashKey, {
                        isOnline: 'false',
                        status: 'OFFLINE',
                        dispatchEligible: 'false',
                        dispatchEligibilityCode: dispatchEligibility.code || 'NOT_ELIGIBLE',
                        dispatchEligibilityCheckedAt: new Date().toISOString()
                    });
                    socket.emit('driverStatusError', {
                        error: 'Cadastro pendente de aprovação para receber corridas.',
                        reason: dispatchEligibility.code || 'NOT_ELIGIBLE',
                        code: 'driverNotEligible',
                        eligibilityRequired: true
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

            const normalizedHeading = Number.isFinite(Number(heading)) ? Number(heading) : 0;
            const normalizedSpeed = Number.isFinite(Number(speed)) ? Number(speed) : 0;
            const normalizedTimestamp = Number.isFinite(Number(capturedAt))
                ? Number(capturedAt)
                : (
                    Number.isFinite(Number(data.timestamp))
                        ? Number(data.timestamp)
                        : Date.now()
                );

            await saveDriverLocation(
                driverId,
                latNum,
                lngNum,
                normalizedHeading,
                normalizedSpeed,
                normalizedTimestamp,
                true,
                isInTripState
            );

            if (isInTripState) {
                await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                await redis.hset(driverHashKey, {
                    dispatchEligible: 'false',
                    dispatchEligibilityCode: 'IN_TRIP',
                    dispatchEligibilityCheckedAt: new Date().toISOString()
                });
            } else {
                const shouldJoinEligiblePool = dispatchEligibility.eligible === true;
                if (shouldJoinEligiblePool) {
                    await redis.geoadd(ELIGIBLE_DRIVER_GEO_KEY, lngNum, latNum, driverId);
                    await redis.hset(driverHashKey, {
                        dispatchEligible: 'true',
                        dispatchEligibilityCode: dispatchEligibility.code || 'ELIGIBLE',
                        dispatchEligibilityCheckedAt: new Date().toISOString()
                    });
                } else {
                    await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                }
            }

            // Verificar se foi salvo corretamente no GEO
            const isInGeo = await redis.zscore('driver_locations', driverId);
            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Verificação pós-salvamento de localização', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    isInGeo: isInGeo !== null,
                    geoScore: isInGeo
                });
            }

            // ✅ NOVO: Se motorista está em uma corrida ativa, enviar localização para o passageiro
            let activeTripId = null;
            let customerId = null;
            const parsedSeq = Number(seq);
            const seqIsValid = Number.isInteger(parsedSeq) && parsedSeq >= 0;

            if (isInTripState) {
                try {
                    const capturedAtValue = Number.isFinite(Number(capturedAt)) ? Number(capturedAt) : Date.now();
                    let orderStatus = 'no_seq';
                    let lastAcceptedSeq = null;
                    activeTripId = tripIdFromClient || sharedRouteBookingId;
                    const indexedTrip = ENABLE_ACTIVE_TRIP_INDEX
                        ? await resolveActiveTripForDriver(redis, driverId)
                        : { tripId: null, customerId: null };
                    if (!activeTripId && ENABLE_ACTIVE_TRIP_INDEX) {
                        activeTripId = indexedTrip.tripId;
                    }

                    // Fallback sem KEYS: usar hash de corridas ativas se índice ainda não estiver populado
                    if (!activeTripId) {
                        const activeBookings = await redis.hgetall('bookings:active');
                        for (const [bookingId, bookingRaw] of Object.entries(activeBookings || {})) {
                            try {
                                const bookingData = JSON.parse(bookingRaw);
                                if (String(bookingData?.driverId || '') === String(driverId)) {
                                    activeTripId = bookingId;
                                    customerId = bookingData?.customerId || bookingData?.customer || null;
                                    break;
                                }
                            } catch (parseError) {
                                continue;
                            }
                        }
                    }

                    if (activeTripId) {
                        const bookingData = await redis.hgetall(`booking:${activeTripId}`);
                        const bookingDriverId = bookingData?.driverId;
                        const bookingStatus = String(bookingData?.status || '').toUpperCase();
                        const validStatuses = new Set(['ACCEPTED', 'SEARCHING', 'STARTED', 'IN_PROGRESS']);

                        if (bookingDriverId === driverId && validStatuses.has(bookingStatus)) {
                            customerId = bookingData.customerId || bookingData.customer || indexedTrip.customerId || null;
                            const tripChanged = String(indexedTrip.tripId || '') !== String(activeTripId || '');
                            const customerChanged = String(indexedTrip.customerId || '') !== String(customerId || '');
                            if (ENABLE_ACTIVE_TRIP_INDEX && (tripChanged || customerChanged)) {
                                await setActiveTripForDriver(redis, driverId, activeTripId, customerId);
                            }

                            await pricingH3ReadModelService.applyBookingSnapshot(redis, {
                                bookingId: activeTripId,
                                ...bookingData,
                                currentLocation: {
                                    lat: latNum,
                                    lng: lngNum
                                },
                                driverLocation: {
                                    lat: latNum,
                                    lng: lngNum
                                }
                            }).catch(() => null);
                        } else {
                            activeTripId = null;
                            customerId = null;
                        }
                    }

                    if (activeTripId && seqIsValid) {
                        const seqStateKey = `trip_loc_seq_state:${activeTripId}:${driverId}`;
                        const rawLastSeq = await redis.get(seqStateKey);
                        lastAcceptedSeq = Number.isInteger(Number(rawLastSeq)) ? Number(rawLastSeq) : null;

                        if (lastAcceptedSeq === null || parsedSeq > lastAcceptedSeq) {
                            orderStatus = 'in_order';
                            lastAcceptedSeq = parsedSeq;
                            await redis.set(seqStateKey, String(parsedSeq), 'EX', TRIP_LOCATION_DEDUP_TTL_SECONDS);
                        } else if (parsedSeq >= (lastAcceptedSeq - TRIP_LOCATION_OUT_OF_ORDER_WINDOW)) {
                            orderStatus = parsedSeq === lastAcceptedSeq ? 'duplicate_seq' : 'out_of_order';
                        } else {
                            orderStatus = 'stale_ignored';
                            socket.emit('locationUpdated', {
                                message: 'Localização fora da janela de aceitação',
                                driverId,
                                tripId: activeTripId,
                                seq: parsedSeq,
                                stale: true,
                                orderStatus,
                                lastAcceptedSeq,
                                outOfOrderWindow: TRIP_LOCATION_OUT_OF_ORDER_WINDOW
                            });
                            return;
                        }

                        const dedupeKey = `trip_loc_dedupe:${activeTripId}:${driverId}:${parsedSeq}`;
                        const dedupeResult = await redis.set(dedupeKey, '1', 'EX', TRIP_LOCATION_DEDUP_TTL_SECONDS, 'NX');
                        if (!dedupeResult) {
                            socket.emit('locationUpdated', {
                                message: 'Localização duplicada ignorada',
                                driverId,
                                tripId: activeTripId,
                                seq: parsedSeq,
                                orderStatus: 'duplicate_dedupe',
                                lastAcceptedSeq,
                                duplicate: true
                            });
                            return;
                        }
                    }

                    if (activeTripId && ENABLE_TRIP_LOCATION_STREAM) {
                        const locationEventData = {
                            tripId: String(activeTripId),
                            driverId: String(driverId),
                            customerId: customerId ? String(customerId) : null,
                            seq: seqIsValid ? parsedSeq : null,
                            lat: latNum,
                            lng: lngNum,
                            capturedAt: capturedAtValue,
                            receivedAt: Date.now(),
                            accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
                            heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
                            speed: Number.isFinite(Number(speed)) ? Number(speed) : null
                        };
                        if (seqIsValid) {
                            locationEventData.orderStatus = orderStatus;
                            locationEventData.outOfOrderWindow = TRIP_LOCATION_OUT_OF_ORDER_WINDOW;
                            locationEventData.lastAcceptedSeq = lastAcceptedSeq;
                        }
                        await redis.xadd(
                            'trip_location_events',
                            '*',
                            'type', 'trip.location.v1',
                            'data', JSON.stringify(locationEventData),
                            'bookingId', String(activeTripId),
                            'tripId', String(activeTripId),
                            'driverId', String(driverId),
                            'customerId', customerId ? String(customerId) : '',
                            'seq', seqIsValid ? String(parsedSeq) : '',
                            'lat', String(latNum),
                            'lng', String(lngNum),
                            'capturedAt', String(capturedAtValue),
                            'receivedAt', String(Date.now()),
                            'accuracy', accuracy !== undefined && accuracy !== null ? String(accuracy) : '',
                            'heading', heading !== undefined && heading !== null ? String(heading) : '',
                            'speed', speed !== undefined && speed !== null ? String(speed) : '',
                            'orderStatus', seqIsValid ? String(orderStatus) : '',
                            'lastAcceptedSeq', seqIsValid && lastAcceptedSeq !== null ? String(lastAcceptedSeq) : '',
                            'outOfOrderWindow', seqIsValid ? String(TRIP_LOCATION_OUT_OF_ORDER_WINDOW) : ''
                        );

                        if (customerId) {
                            const sharedRoutePlan = normalizeSharedRoutePlan(data.routePlan);
                            const driverLocationPayload = {
                                bookingId: activeTripId,
                                driverId,
                                seq: seqIsValid ? parsedSeq : null,
                                orderStatus: seqIsValid ? orderStatus : null,
                                location: {
                                    lat: latNum,
                                    lng: lngNum,
                                    heading: Number.isFinite(Number(heading)) ? Number(heading) : 0,
                                    speed: Number.isFinite(Number(speed)) ? Number(speed) : 0,
                                    accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
                                    timestamp: Date.now()
                                }
                            };

                            if (sharedRoutePlan) {
                                driverLocationPayload.routePlan = sharedRoutePlan;
                                driverLocationPayload.routePlanPhase =
                                    String(data.routePlanPhase || '').trim() || null;
                                driverLocationPayload.routePlanSharedAt =
                                    String(data.routePlanSharedAt || '').trim() || null;
                                driverLocationPayload.pickupCoordinate =
                                    normalizeSharedRouteCoordinate(data.pickupCoordinate);
                                driverLocationPayload.destinationCoordinate =
                                    normalizeSharedRouteCoordinate(data.destinationCoordinate);
                                driverLocationPayload.pickupAddress =
                                    String(data.pickupAddress || '').trim();
                                driverLocationPayload.destinationAddress =
                                    String(data.destinationAddress || '').trim();
                                logStructured('info', 'RoutePlan compartilhado com passageiro', {
                                    service: 'websocket',
                                    operation: 'updateLocation',
                                    driverId,
                                    customerId,
                                    bookingId: activeTripId,
                                    pickupPoints: Array.isArray(sharedRoutePlan.pickupCoordinates)
                                        ? sharedRoutePlan.pickupCoordinates.length
                                        : 0,
                                    destinationPoints: Array.isArray(sharedRoutePlan.destinationCoordinates)
                                        ? sharedRoutePlan.destinationCoordinates.length
                                        : 0
                                });
                            }

                            io.to(`customer_${customerId}`).emit('driverLocation', driverLocationPayload);
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
                success: true,
                message: 'Localização atualizada',
                location: { lat: latNum, lng: lngNum },
                driverId: driverId,
                tripId: activeTripId,
                seq: seqIsValid ? parsedSeq : null,
                data: {
                    driverId,
                    location: { lat: latNum, lng: lngNum },
                    heading: normalizedHeading,
                    speed: normalizedSpeed,
                    timestamp: normalizedTimestamp
                }
            });
            scheduleMapH3Refresh(io, {
                reason: 'location_updated',
                driverId,
                bookingId: activeTripId || null
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

        } catch (error) {
            logStructured('error', 'Erro ao atualizar localização (updateLocation)', {
                service: 'websocket',
                operation: 'updateLocation',
                driverId: socket.userId,
                error: error.message,
                stack: error.stack
            });
            // Stack já está incluído no logStructured acima
            emitLocationError({ message: 'Erro ao atualizar localização' });
        }
    };

    socket.on('updateLocation', (data) => {
        handleUpdateLocation(data, 'updateLocation');
    });

    // Compatibilidade com clientes legados: usa o mesmo pipeline de validação/elegibilidade.
    if (ENABLE_LEGACY_UPDATE_DRIVER_LOCATION_EVENT) {
        socket.on('updateDriverLocation', (data) => {
            handleUpdateLocation(data, 'updateDriverLocation');
        });
    }
}

module.exports = registerSocketUpdateLocationHandler;
