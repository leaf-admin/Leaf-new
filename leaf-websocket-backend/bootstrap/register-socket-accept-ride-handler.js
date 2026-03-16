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
    logError
}) {
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
                const { metrics } = require('../utils/prometheus-metrics');
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
                    metrics.recordCommand('accept_ride', commandLatency, result.success);

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
                    metrics.recordCommand('accept_ride', commandLatency, false);
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
                const { bookingId: resultBookingId, driverId: resultDriverId, customerId, event, pickupLocation } = result.data;

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

                        // ✅ MÉTRICAS: Registrar evento publicado
                        metrics.recordEventPublished('ride.accepted');

                        endSpanSuccess(eventSpan, {
                            'event.latency_ms': Date.now() - eventStartTime
                        });
                    } catch (error) {
                        endSpanError(eventSpan, error);
                        throw error;
                    }

                    const eventLatency = Date.now() - eventStartTime;
                    logEvent('ride.accepted', 'published', {
                        bookingId: bookingIdToUse,
                        latency_ms: eventLatency
                    });
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

                // Preparar resposta de sucesso para driver
                const acceptRideResponse = {
                    success: true,
                    bookingId: bookingIdToUse,
                    driverId: driverId,
                    message: 'Corrida aceita com sucesso',
                    timestamp: new Date().toISOString()
                };

                // ✅ Emitir confirmação IMEDIATAMENTE para o motorista que solicitou o aceite
                socket.emit('rideAccepted', acceptRideResponse);

                // ✅ NOVO: Ativar corrida em bookings:active
                try {
                    if (!redisPool) {
                        throw new Error('redisPool indisponível no acceptRide');
                    }
                    const redis = redisPool.getConnection();
                    const bookingData = await redis.hgetall(`booking:${bookingIdToUse}`);
                    if (bookingData && Object.keys(bookingData).length > 0) {
                        // Preparar dados para o Hash de corridas ativas (mantendo compatibilidade legada)
                        const activeBookingData = {
                            ...bookingData,
                            status: 'ACCEPTED',
                            driverId
                        };

                        // Mapeamento para compatibilidade com handlers antigos (changeDestination, etc)
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

                // ✅ Cachear resultado para idempotency
                await idempotencyService.cacheResult(idempotencyKey, acceptRideResponse);

                try {
                    // FASE 10: Registrar fim de match e aceitação para métricas
                    await metricsCollector.recordMatchEnd(bookingIdToUse, driverId, Date.now());
                    await metricsCollector.recordDriverAcceptance(bookingIdToUse, driverId, Date.now());
                } catch (metErr) {
                    logger.error(`❌ [acceptRide] Erro em métricas: ${metErr.message}`);
                }

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
}

module.exports = registerSocketAcceptRideHandler;
