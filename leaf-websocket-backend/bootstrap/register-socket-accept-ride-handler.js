const PaymentService = require('../services/payment-service');
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
const { resolveAcceptRidePayload, toFiniteNumber } = require('../utils/accept-ride-payload');
const { metrics } = require('../utils/prometheus-metrics');
const { recordDispatchWaveAcceptance } = require('../services/dispatch-wave-trace-service');
const rideNotificationLifecycleOrchestrator = require('../services/ride-notification-lifecycle-orchestrator-service');

const paymentService = new PaymentService();

function mapAcceptRideReason(errorMessage = '') {
    const normalized = String(errorMessage || '').toLowerCase();
    if (normalized.includes('outra corrida')) return 'driver_already_busy';
    if (normalized.includes('não encontrada') || normalized.includes('nao encontrada')) return 'booking_not_found';
    if (normalized.includes('já foi aceita') || normalized.includes('nao esta mais disponivel') || normalized.includes('não está mais disponível')) {
        return 'duplicate_rejected';
    }
    return 'command_error';
}

function registerSocketAcceptRideHandler({
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
    logError,
    fcmService = null
}) {
    socket.on('acceptRide', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        let outerIdempotencyKey = null;
        let outerIdempotencyOwner = false;
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                logStructured('info', 'acceptRide iniciado', {
                    driverId: socket.userId || socket.id,
                    eventType: 'acceptRide'
                });

                const startTime = Date.now();
                const hotpathPath = 'accept_ride';

                const driverId = socket.userId || socket.id;
                const correlationId = data?.correlationId || data?.bookingId;
                const metadata = getSocketMetadata(socket);

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
                outerIdempotencyKey = idempotencyKey;

                const idempotencyCheck = await idempotencyService.beginRequest(idempotencyKey, {
                    joinWaitMs: Number.parseInt(
                        process.env.IDEMPOTENCY_ACCEPT_RIDE_JOIN_WAIT_MS
                        || process.env.IDEMPOTENCY_JOIN_WAIT_MS
                        || '8000',
                        10
                    )
                });

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
                        metrics.recordHotpathReason(hotpathPath, 'duplicate_joined');
                        metrics.recordHotpathLatency(hotpathPath, Math.max(0, (Date.now() - startTime) / 1000), true);
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
                        metrics.recordHotpathReason(hotpathPath, 'duplicate_rejected');
                        metrics.recordHotpathLatency(hotpathPath, Math.max(0, (Date.now() - startTime) / 1000), false);
                        return;
                    }
                }
                outerIdempotencyOwner = true;

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
                    outerIdempotencyOwner = false;
                    await idempotencyService.releaseInflight(idempotencyKey);
                    return;
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
                    metrics.recordHotpathReason(hotpathPath, mapAcceptRideReason(result.error));
                    metrics.recordHotpathStageLatency(hotpathPath, 'command', Math.max(0, (Date.now() - acceptStartTime) / 1000), false);
                    metrics.recordHotpathLatency(hotpathPath, Math.max(0, (Date.now() - startTime) / 1000), false);
                    if (outerIdempotencyOwner && outerIdempotencyKey) {
                        outerIdempotencyOwner = false;
                        await idempotencyService.releaseInflight(outerIdempotencyKey);
                    }
                    return;
                }

                // Command executado com sucesso
                const { bookingId: resultBookingId, driverId: resultDriverId, customerId, event } = result.data;
                const {
                    pickupLocation,
                    destinationLocation,
                    estimatedFare,
                    driverAcceptedLocation,
                    driverDistanceToPickupKm,
                    estimatedArrivalToPickupMin
                } = await resolveAcceptRidePayload(redisPool.getConnection(), bookingIdToUse, result.data);

                // Encerrar imediatamente a busca desta corrida e liberar motoristas concorrentes.
                // Mantém o lock do motorista vencedor para evitar corrida com outras ofertas.
                setImmediate(async () => {
                    try {
                        const GradualRadiusExpander = require('../services/gradual-radius-expander');
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
                });

                let eventPublished = false;
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

                // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão notificar passageiro e motorista)
                if (event) {
                    // ✅ FASE 1.3: Criar span para Event publish
                    const eventSpan = createEventSpan(tracer, 'ride.accepted', activeSpan, {
                        'event.booking_id': resultBookingId || bookingIdToUse,
                        'correlation.id': correlationId // ✅ Passar correlationId
                    });

                    const eventStartTime = Date.now();
                    try {
                        await runInSpan(eventSpan, async () => {
                            await eventBus.publish({
                                eventType: 'ride.accepted',
                                data: event
                            });
                        });

                        // ✅ Salvar contexto do evento para linkar com listeners
                        const eventSpanContext = eventSpan.spanContext();
                        if (event.data) {
                            event.data._otelSpanContext = eventSpanContext;
                            // ✅ CRÍTICO: Serializar correlationId e traceId no evento
                            if (!event.data.metadata) {
                                event.data.metadata = {};
                            }
                            event.data.metadata.correlationId = correlationId;
                            event.data.metadata.traceId = eventSpanContext.traceId;
                            event.data.metadata.spanId = eventSpanContext.spanId;
                        }

                        eventPublished = true;

                        endSpanSuccess(eventSpan, {
                            'event.latency_ms': Date.now() - eventStartTime
                        });
                    } catch (error) {
                        endSpanError(eventSpan, error);
                        logStructured('warn', 'Falha ao publicar ride.accepted no EventBus (seguindo com fallback direto)', {
                            driverId,
                            bookingId: bookingIdToUse,
                            customerId,
                            eventType: 'acceptRide',
                            error: error.message
                        });
                    }

                    if (eventPublished) {
                        const eventLatency = Date.now() - eventStartTime;
                        logEvent('ride.accepted', 'published', {
                            bookingId: bookingIdToUse,
                            latency_ms: eventLatency
                        });
                    }
                }

                // ✅ NOVO: Atualizar motorista da corrida no Firestore
                try {
                    const ridePersistenceService = require('../services/ride-persistence-service');
                    await ridePersistenceService.updateRideDriver(bookingIdToUse, driverId);
                } catch (persistError) {
                    logStructured('error', 'Erro ao atualizar motorista da corrida no Firestore', {
                        bookingId: bookingIdToUse,
                        driverId,
                        eventType: 'acceptRide',
                        error: persistError.message
                    });
                    // Não bloquear aceitação se persistência falhar
                }

                let driverRedisProfile = {};
                try {
                    driverRedisProfile = await redisPool.getConnection().hgetall(`driver:${driverId}`);
                } catch (_driverProfileError) {
                    driverRedisProfile = {};
                }

                const driverNamePayload = String(
                    driverData?.driver?.name ||
                    driverData?.driverName ||
                    driverRedisProfile?.name ||
                    driverRedisProfile?.driverName ||
                    driverRedisProfile?.displayName ||
                    socket?.driverName ||
                    'Motorista Leaf'
                ).trim();
                const driverVehicleModel = String(
                    driverData?.driver?.vehicle?.model ||
                    driverData?.vehicle?.model ||
                    driverData?.driver?.vehicle?.type ||
                    driverData?.vehicle?.type ||
                    driverData?.carType ||
                    driverRedisProfile?.vehicleModel ||
                    driverRedisProfile?.model ||
                    driverRedisProfile?.carModel ||
                    driverRedisProfile?.carType ||
                    driverRedisProfile?.vehicleType ||
                    driverRedisProfile?.vehicleCategory ||
                    socket?.vehicleModel ||
                    ''
                ).trim();
                const driverVehiclePlate = String(
                    driverData?.driver?.vehicle?.plate ||
                    driverData?.vehicle?.plate ||
                    driverData?.vehiclePlate ||
                    driverData?.carPlate ||
                    driverRedisProfile?.vehiclePlate ||
                    driverRedisProfile?.vehicleNumber ||
                    driverRedisProfile?.carPlate ||
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

                let estimatedBreakdown = null;
                if (Number.isFinite(estimatedFare) && estimatedFare >= 0) {
                    estimatedBreakdown = paymentService.calculateFareBreakdownFromReais(estimatedFare, 0);
                }

                // Preparar resposta de sucesso para driver
                const acceptRideResponse = {
                    success: true,
                    bookingId: bookingIdToUse,
                    driverId: driverId,
                    message: 'Corrida aceita com sucesso',
                    timestamp: new Date().toISOString(),
                    pickupLocation: pickupLocation || null,
                    destinationLocation: destinationLocation || null,
                    estimatedFare: Number.isFinite(estimatedFare) ? estimatedFare : null,
                    driverDistanceToPickupKm: Number.isFinite(driverDistanceToPickupKm)
                        ? driverDistanceToPickupKm
                        : null,
                    estimatedArrivalToPickupMin: Number.isFinite(estimatedArrivalToPickupMin)
                        ? estimatedArrivalToPickupMin
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

                // ✅ Fallback direto para passageiro (garante transição de estado mesmo se listener falhar)
                if (customerId) {
                    io.to(`customer_${customerId}`).emit('rideAccepted', {
                        success: true,
                        bookingId: bookingIdToUse,
                        driverId,
                        customerId,
                        message: 'Motorista aceitou sua corrida',
                        timestamp: new Date().toISOString(),
                        pickupLocation: pickupLocation || null,
                        destinationLocation: destinationLocation || null,
                        driverDistanceToPickupKm: Number.isFinite(driverDistanceToPickupKm)
                            ? driverDistanceToPickupKm
                            : null,
                        estimatedArrivalToPickupMin: Number.isFinite(estimatedArrivalToPickupMin)
                            ? estimatedArrivalToPickupMin
                            : null,
                        driver: acceptRideResponse.driver,
                        ...(acceptedLocation ? { location: acceptedLocation } : {}),
                        vehicle: acceptRideResponse.vehicle,
                        source: eventPublished ? 'listener_plus_fallback' : 'direct_fallback'
                    });
                } else {
                    logStructured('warn', 'acceptRide sem customerId para notificar passageiro', {
                        driverId,
                        bookingId: bookingIdToUse,
                        eventType: 'acceptRide'
                    });
                }

                let activeBookingForNotification = null;

                // ✅ NOVO: Ativar corrida em bookings:active
                try {
                    if (!redisPool) {
                        throw new Error('redisPool indisponível no acceptRide');
                    }
                    const redis = redisPool.getConnection();
                    await recordDispatchWaveAcceptance(redis, bookingIdToUse, {
                        driverId,
                        timestampMs: Date.now()
                    });
                    const bookingData = await redis.hgetall(`booking:${bookingIdToUse}`);
                    if (bookingData && Object.keys(bookingData).length > 0) {
                        // Preparar dados para o Hash de corridas ativas (mantendo compatibilidade legada)
                        const activeBookingData = {
                            ...bookingData,
                            status: 'ACCEPTED',
                            driverId,
                            driverName: driverNamePayload,
                            vehicleModel: driverVehicleModel,
                            vehiclePlate: driverVehiclePlate
                        };
                        activeBookingForNotification = activeBookingData;

                        // Mapeamento para compatibilidade com handlers antigos (changeDestination, etc)
                        try {
                            if (bookingData.pickupLocation) activeBookingData.pickup = JSON.parse(bookingData.pickupLocation);
                            if (bookingData.destinationLocation) activeBookingData.drop = JSON.parse(bookingData.destinationLocation);
                            if (bookingData.estimatedFare) activeBookingData.estimate = parseFloat(bookingData.estimatedFare);
                        } catch (e) {
                            logStructured('warn', 'acceptRide: erro ao parsear campos para bookings:active', {
                                bookingId: bookingIdToUse,
                                eventType: 'acceptRide',
                                error: e.message
                            });
                        }

                        const bookingDataStr = JSON.stringify(activeBookingData);
                        const flowDebugEnabled = process.env.DEBUG_RIDE_FLOW === 'true';
                        if (flowDebugEnabled) {
                            logStructured('debug', 'acceptRide: persistindo booking ativo', {
                                service: 'acceptRide',
                                bookingId: bookingIdToUse
                            });
                        }

                        // Validar tipo de dado no Redis antes de inserir
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

                        await pricingH3ReadModelService.applyBookingSnapshot(redis, {
                            bookingId: bookingIdToUse,
                            ...activeBookingData
                        }).catch(() => null);

                        const driverState = await redis.hgetall(`driver:${driverId}`);
                        const driverLat = Number(driverState?.lat);
                        const driverLng = Number(driverState?.lng);
                        if (Number.isFinite(driverLat) && Number.isFinite(driverLng)) {
                            await pricingH3ReadModelService.applyDriverSnapshot(redis, {
                                driverId,
                                lat: driverLat,
                                lng: driverLng,
                                isOnline: String(driverState?.isOnline || 'true') === 'true',
                                available: false
                            }).catch(() => null);
                        }

                        // ✅ Sincronizar activeBookings
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
                } catch (e) {
                    logError(e, { context: 'Erro ao ativar corrida em bookings:active (hset)', bookingId: bookingIdToUse });
                }

                setImmediate(async () => {
                    try {
                        await rideNotificationLifecycleOrchestrator.dispatchRideStatusUpdate({
                            fcmService,
                            redis: redisPool?.getConnection?.() || null,
                            bookingId: bookingIdToUse,
                            status: 'accepted',
                            passengerId: customerId,
                            driverId,
                            bookingData: {
                                ...(activeBookingForNotification || {}),
                                pickupLocation,
                                destinationLocation,
                                estimatedFare: Number.isFinite(estimatedFare) ? estimatedFare : undefined,
                                driverDistanceToPickupKm,
                                estimatedArrivalToPickupMin,
                                driverName: driverNamePayload,
                                vehicleModel: driverVehicleModel,
                                vehiclePlate: driverVehiclePlate
                            },
                            passengerPayload: {
                                driverName: driverNamePayload,
                                vehicleModel: driverVehicleModel,
                                vehiclePlate: driverVehiclePlate
                            },
                            driverPayload: {
                                customerName: activeBookingForNotification?.customerName ||
                                    activeBookingForNotification?.passengerName ||
                                    'Passageiro'
                            },
                            logStructured
                        });
                    } catch (silentPushError) {
                        logStructured('warn', 'acceptRide: falha ao enviar notificacao persistente de aceite', {
                            service: 'acceptRide',
                            bookingId: bookingIdToUse,
                            driverId,
                            customerId,
                            error: silentPushError?.message || String(silentPushError)
                        });
                    }
                });

                // ✅ Cachear resultado para idempotency
                await idempotencyService.cacheResult(idempotencyKey, acceptRideResponse);
                outerIdempotencyOwner = false;

                try {
                    // FASE 10: Registrar fim de match e aceitação para métricas
                    await metricsCollector.recordMatchEnd(bookingIdToUse, driverId, Date.now());
                    await metricsCollector.recordDriverAcceptance(bookingIdToUse, driverId, Date.now());
                } catch (metErr) {
                    logStructured('warn', 'acceptRide: erro ao registrar métricas', {
                        bookingId: bookingIdToUse,
                        driverId,
                        eventType: 'acceptRide',
                        error: metErr.message
                    });
                }

                // ✅ NOTIFICAÇÃO JÁ FOI ENVIADA PARA PASSAGEIRO PELOS LISTENERS via EventBus
                const totalLatency = Date.now() - startTime;
                metrics.recordHotpathStageLatency(hotpathPath, 'command', Math.max(0, (Date.now() - acceptStartTime) / 1000), true);
                metrics.recordHotpathLatency(hotpathPath, Math.max(0, totalLatency / 1000), true);
                logStructured('info', 'acceptRide concluído com sucesso (Emissão Adiantada)', {
                    driverId,
                    bookingId: bookingIdToUse,
                    eventType: 'acceptRide',
                    latency_ms: totalLatency
                });

            } catch (error) {
                if (outerIdempotencyOwner && outerIdempotencyKey) {
                    outerIdempotencyOwner = false;
                    await idempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                }
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
                metrics.recordHotpathReason('accept_ride', 'unexpected_error');
                socket.emit('acceptRideError', { error: 'Erro ao processar aceitação' });
            }
        });
    });
}

module.exports = registerSocketAcceptRideHandler;
