function registerSocketCreateBookingHandler({
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
    findAvailableDriversForPickup
}) {
    socket.on('createBooking', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);

        // ✅ CORRELATION ID: Usar bookingId se disponível, senão gerar
        // correlationId é de negócio (estável por fluxo de corrida)
        const correlationId = data.bookingId || `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // ✅ FASE 1.3: Criar span root para socket handler
        const tracer = getTracer();
        const socketSpan = createSocketSpan(tracer, 'createBooking', {
            'user.id': socket.userId || data.customerId || socket.id,
            'user.type': socket.userType || 'customer',
            'correlation.id': correlationId, // ✅ Adicionar correlationId
            'booking.id': data.bookingId || correlationId
        });

        await traceContext.runWithTraceId(traceId, async () => {
            try {
                return await runInSpan(socketSpan, async () => {
                    logStructured('info', 'createBooking iniciado', {
                        userId: socket.userId || data.customerId || socket.id,
                        eventType: 'createBooking'
                    });

                    const startTime = Date.now();

                    // ✅ NOVO: Rate Limiting
                    const userId = socket.userId || data.customerId || socket.id;
                    const metadata = getSocketMetadata(socket);
                    const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'createBooking', {
                        ip: metadata.ip
                    });

                    if (!rateLimitCheck.allowed) {
                        // ✅ NOVO: Log de auditoria para rate limit excedido
                        await auditService.logSecurityAction(userId, 'rateLimitExceeded', 'createBooking', {
                            limit: rateLimitCheck.limit,
                            remaining: rateLimitCheck.remaining,
                            resetAt: rateLimitCheck.resetAt
                        }, metadata);

                        socket.emit('bookingError', {
                            error: 'Muitas requisições',
                            message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                            code: 'RATE_LIMIT_EXCEEDED',
                            limit: rateLimitCheck.limit,
                            remaining: rateLimitCheck.remaining,
                            resetAt: rateLimitCheck.resetAt
                        });
                        logStructured('warn', 'Rate limit excedido', {
                            userId,
                            eventType: 'createBooking',
                            limit: rateLimitCheck.limit
                        });
                        return;
                    }

                    logStructured('info', 'Solicitação de corrida recebida', {
                        socketId: socket.id,
                        userId,
                        eventType: 'createBooking'
                    });

                    // ✅ NOVO: Validação e sanitização de dados
                    const validation = validationService.validateEndpoint('createBooking', data);

                    if (!validation.valid) {
                        const metadata = getSocketMetadata(socket);
                        await auditService.logRideAction(userId, 'createBooking', null, {
                            error: 'Validação falhou',
                            validationErrors: validation.errors
                        }, false, 'Dados de entrada inválidos', metadata);

                        logStructured('warn', 'Validação falhou', {
                            userId,
                            eventType: 'createBooking',
                            validationErrors: validation.errors
                        });

                        socket.emit('bookingError', {
                            error: 'Dados inválidos',
                            message: 'Os dados fornecidos não são válidos',
                            details: validation.errors,
                            code: 'VALIDATION_ERROR'
                        });
                        return;
                    }

                    // Usar dados sanitizados
                    const { customerId, pickupLocation, destinationLocation, estimatedFare, paymentMethod } = validation.sanitized;
                    const normalizedPaymentStatus = (data?.paymentStatus || 'pending_payment').toString().toLowerCase();
                    const hasConfirmedPayment = ['confirmed', 'paid', 'in_holding'].includes(normalizedPaymentStatus);
                    const requestedCarType = data?.carType || null;

                    // Backpressure no início do fluxo: evita empilhar corrida quando fila regional já está saturada.
                    const queueBackpressureEnabled = process.env.ENABLE_QUEUE_BACKPRESSURE !== 'false';
                    if (queueBackpressureEnabled) {
                        try {
                            const regionHashForGuard = GeoHashUtils.getRegionHash(
                                pickupLocation.lat,
                                pickupLocation.lng
                            );
                            const queueKey = `ride_queue:${regionHashForGuard}:pending`;
                            const redis = redisPool.getConnection();
                            const pendingRides = await redis.zcard(queueKey);
                            const pendingLimit = Number.parseInt(process.env.QUEUE_PENDING_LIMIT_PER_REGION || '5000', 10);
                            const onlineDrivers = await redis.sCard('online_drivers');
                            const minOnlineDriversBypass = Number.parseInt(process.env.QUEUE_BACKPRESSURE_MIN_ONLINE_DRIVERS_BYPASS || '200', 10);

                            if (pendingRides >= pendingLimit && onlineDrivers < minOnlineDriversBypass) {
                                const retryAfterSec = Number.parseInt(process.env.QUEUE_BACKPRESSURE_RETRY_AFTER_SEC || '3', 10);
                                socket.emit('bookingError', {
                                    error: 'Sistema temporariamente congestionado',
                                    message: 'Estamos com alta demanda na sua região. Tente novamente em alguns segundos.',
                                    code: 'QUEUE_BACKPRESSURE',
                                    retryAfterSec,
                                    pendingRides,
                                    pendingLimit,
                                    onlineDrivers,
                                    minOnlineDriversBypass,
                                    regionHash: regionHashForGuard
                                });

                                logStructured('warn', 'createBooking bloqueado por backpressure', {
                                    userId,
                                    regionHash: regionHashForGuard,
                                    pendingRides,
                                    pendingLimit,
                                    onlineDrivers,
                                    minOnlineDriversBypass,
                                    retryAfterSec
                                });
                                return;
                            }
                        } catch (backpressureError) {
                            logStructured('warn', 'Falha na validação de backpressure (seguindo fluxo)', {
                                userId,
                                error: backpressureError.message
                            });
                        }
                    }

                    // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                    const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                        userId,
                        'createBooking',
                        `${pickupLocation.lat}_${pickupLocation.lng}_${destinationLocation.lat}_${destinationLocation.lng}_${Date.now()}`
                    );

                    const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey);

                    if (!idempotencyCheck.isNew) {
                        // Requisição duplicada - retornar resultado cached ou erro
                        if (idempotencyCheck.cachedResult) {
                            logStructured('info', 'Resultado cached retornado (idempotency)', {
                                userId,
                                eventType: 'createBooking',
                                idempotencyKey,
                                action: 'return_cached'
                            });
                            // ✅ Garantir que traceId esteja no resultado cached
                            const cachedResult = {
                                ...idempotencyCheck.cachedResult,
                                traceId: idempotencyCheck.cachedResult.traceId || traceId || traceContext.getCurrentTraceId() || 'CACHED-TRACE-ID'
                            };
                            // ✅ FORÇAR traceId também em data se não estiver
                            if (cachedResult.data && !cachedResult.data.traceId) {
                                cachedResult.data.traceId = cachedResult.traceId;
                            }
                            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                                logStructured('debug', 'cachedResult antes de emit', {
                                    service: 'websocket',
                                    operation: 'createBooking',
                                    cachedResult
                                });
                            }
                            socket.emit('bookingCreated', cachedResult);
                            return;
                        } else {
                            // Requisição duplicada mas sem resultado cached (ainda processando)
                            logStructured('warn', 'Requisição duplicada detectada', {
                                userId,
                                eventType: 'createBooking',
                                idempotencyKey
                            });
                            socket.emit('bookingError', {
                                error: 'Requisição duplicada',
                                message: 'Esta requisição já está sendo processada. Aguarde...',
                                code: 'DUPLICATE_REQUEST',
                                retryAfterSec: 1
                            });
                            return;
                        }
                    }

                    // ✅ REFATORAÇÃO: Usar RequestRideCommand
                    logStructured('info', 'Executando RequestRideCommand', {
                        customerId,
                        eventType: 'createBooking'
                    });

                    // ✅ NOVO: Validação de Geofence - Verificar se origem e destino estão dentro da região permitida
                    const geofenceService = require('../services/geofence-service');
                    if (geofenceService.isActive()) {
                        const geofenceValidation = geofenceService.validateRideLocations(pickupLocation, destinationLocation);

                        if (!geofenceValidation.valid) {
                            const metadata = getSocketMetadata(socket);
                            await auditService.logRideAction(userId, 'createBooking', null, {
                                error: 'Geofence validation failed',
                                geofenceError: geofenceValidation.error,
                                code: geofenceValidation.code,
                                details: geofenceValidation.details
                            }, false, geofenceValidation.error, metadata);

                            logStructured('warn', 'Geofence validation falhou', {
                                userId,
                                eventType: 'createBooking',
                                geofenceError: geofenceValidation.error
                            });

                            socket.emit('bookingError', {
                                error: geofenceValidation.error,
                                message: geofenceValidation.error,
                                code: geofenceValidation.code,
                                details: geofenceValidation.details
                            });
                            return;
                        }

                        logStructured('info', 'Geofence validado', {
                            userId,
                            eventType: 'createBooking'
                        });
                    }

                    // Guarda de negócio: se a corrida já está paga, validar disponibilidade real antes de criar booking.
                    if (hasConfirmedPayment) {
                        const availability = await findAvailableDriversForPickup(pickupLocation, {
                            carType: requestedCarType
                        });

                        if (!availability.success) {
                            socket.emit('bookingError', {
                                error: 'Não foi possível validar disponibilidade de motoristas',
                                message: 'Falha temporária ao validar disponibilidade. Tente novamente em instantes.',
                                code: 'AVAILABILITY_CHECK_FAILED'
                            });
                            return;
                        }

                        if ((availability.drivers || []).length === 0) {
                            socket.emit('bookingError', {
                                error: 'Não há motoristas disponíveis na sua região no momento',
                                message: 'Não foi possível iniciar a busca de corrida agora porque não há parceiros disponíveis.',
                                code: 'NO_DRIVERS_AVAILABLE'
                            });
                            return;
                        }
                    }

                    // ✅ FASE 1.3: Criar span para Command
                    const tracer = getTracer();
                    const { context, trace: otelTrace } = require('@opentelemetry/api');
                    const activeSpan = otelTrace.getActiveSpan();

                    const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
                        'command.customer_id': customerId,
                        'command.pickup_lat': pickupLocation.lat,
                        'command.pickup_lng': pickupLocation.lng,
                        'correlation.id': correlationId // ✅ Passar correlationId
                    });

                    // ✅ MÉTRICAS: Registrar corrida solicitada
                    const { metrics } = require('../utils/prometheus-metrics');
                    const city = data.city || 'unknown';
                    metrics.recordRideRequested(city, 'standard');

                    // Executar command dentro do span
                    const commandStartTime = Date.now();
                    let result;
                    let commandLatency;
                    try {
                        const command = new RequestRideCommand({
                            customerId,
                            pickupLocation,
                            destinationLocation,
                            estimatedFare: estimatedFare || 0,
                            carType: requestedCarType,
                            paymentMethod: paymentMethod || 'pix',
                            traceId, // ✅ Passar traceId para o command
                            correlationId // ✅ Passar correlationId para o command
                        });

                        result = await runInSpan(commandSpan, async () => {
                            return await command.execute();
                        });

                        // ✅ MÉTRICAS: Registrar latência do command
                        commandLatency = (Date.now() - commandStartTime) / 1000;
                        metrics.recordCommand('request_ride', commandLatency, result.success);
                    } catch (error) {
                        endSpanError(commandSpan, error);
                        commandLatency = (Date.now() - commandStartTime) / 1000;
                        metrics.recordCommand('request_ride', commandLatency, false);
                        throw error;
                    }

                    // ✅ Log de command
                    logCommand('RequestRideCommand', result.success, commandLatency, {
                        customerId,
                        bookingId: result.data?.bookingId
                    });

                    if (!result.success) {
                        // Erro no command
                        const metadata = getSocketMetadata(socket);
                        await auditService.logRideAction(userId, 'createBooking', null, {
                            error: result.error
                        }, false, result.error, metadata);

                        logStructured('error', 'RequestRideCommand falhou', {
                            userId,
                            eventType: 'createBooking',
                            error: result.error
                        });

                        socket.emit('bookingError', {
                            error: result.error,
                            message: result.error,
                            code: 'COMMAND_ERROR'
                        });
                        return;
                    }

                    // Command executado com sucesso
                    const { bookingId, bookingData: commandBookingData, event, regionHash } = result.data;

                    // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão notificar motoristas)
                    if (event) {
                        // ✅ FASE 1.3: Criar span para Event publish
                        const { trace: otelTrace } = require('@opentelemetry/api');
                        const activeSpan = otelTrace.getActiveSpan();
                        const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
                            'event.booking_id': bookingId,
                            'correlation.id': correlationId // ✅ Passar correlationId
                        });

                        const eventStartTime = Date.now();
                        try {
                            await runInSpan(eventSpan, async () => {
                                await eventBus.publish({
                                    eventType: 'ride.requested',
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
                            metrics.recordEventPublished('ride.requested');

                            endSpanSuccess(eventSpan, {
                                'event.latency_ms': Date.now() - eventStartTime
                            });
                        } catch (error) {
                            endSpanError(eventSpan, error);
                            throw error;
                        }

                        const eventLatency = Date.now() - eventStartTime;
                        logEvent('ride.requested', 'published', {
                            bookingId,
                            latency_ms: eventLatency
                        });
                    }

                    // Armazenar também em activeBookings (compatibilidade)
                    io.activeBookings.set(bookingId, {
                        bookingId,
                        customerId,
                        pickupLocation,
                        destinationLocation,
                        estimatedFare,
                        paymentMethod,
                        status: 'requested'
                    });

                    // FASE 10: Registrar início de match para métricas
                    await metricsCollector.recordMatchStart(bookingId, Date.now());

                    // ✅ NOVO: Log de auditoria para criação de corrida bem-sucedida
                    await auditService.logRideAction(userId, 'createBooking', bookingId, {
                        pickupLocation,
                        destinationLocation,
                        estimatedFare,
                        paymentMethod,
                        regionHash
                    }, true, null, metadata);

                    // Verificar demanda e notificar motoristas offline (em background)
                    setImmediate(async () => {
                        try {
                            const redis = redisPool.getConnection();
                            await redisPool.ensureConnection();

                            const queueKey = `ride_queue:${regionHash}:pending`;
                            const pendingRides = await redis.zcard(queueKey);

                            // Notificar motoristas offline se houver demanda
                            if (pendingRides >= 3) {
                                const demandNotificationService = require('../services/demand-notification-service');
                                await demandNotificationService.checkAndNotifyDemand(
                                    pickupLocation,
                                    pendingRides
                                );
                            }
                        } catch (error) {
                            logStructured('error', 'Erro ao verificar demanda', {
                                error: error.message,
                                eventType: 'createBooking'
                            });
                        }
                    });

                    // ✅ NOVO: Salvar corrida no Firestore
                    try {
                        const ridePersistenceService = require('../services/ride-persistence-service');
                        await ridePersistenceService.saveRide({
                            rideId: bookingId,
                            bookingId: bookingId,
                            passengerId: customerId,
                            pickupLocation: pickupLocation,
                            destinationLocation: destinationLocation,
                            estimatedFare: estimatedFare || 0,
                            paymentMethod: paymentMethod || 'pix',
                            paymentStatus: data.paymentStatus || 'pending_payment',
                            status: 'pending',
                            carType: data.carType || null
                        });
                    } catch (persistError) {
                        logStructured('error', 'Erro ao salvar corrida no Firestore', {
                            bookingId,
                            error: persistError.message,
                            eventType: 'createBooking'
                        });
                        // Não bloquear criação da corrida se persistência falhar
                    }

                    // Persistir metadados adicionais de pagamento/disponibilidade no booking para validações posteriores.
                    try {
                        const redis = redisPool.getConnection();
                        await redis.hset(`booking:${bookingId}`, {
                            paymentStatus: normalizedPaymentStatus,
                            carType: requestedCarType || '',
                            paymentChargeId: data?.paymentData?.chargeId || data?.paymentId || '',
                            paymentAmountInCents: data?.paymentData?.amountInCents ? String(data.paymentData.amountInCents) : ''
                        });
                    } catch (bookingMetaError) {
                        logStructured('warn', 'Falha ao persistir metadados no booking', {
                            bookingId,
                            error: bookingMetaError.message,
                            eventType: 'createBooking'
                        });
                    }

                    // Preparar resposta de sucesso
                    // ✅ Garantir que traceId esteja disponível (pode vir do contexto ou do handler)
                    let currentTraceId = traceId || traceContext.getCurrentTraceId() || extractTraceIdFromEvent(data, socket);

                    // ✅ Garantir que traceId nunca seja undefined ou null
                    if (!currentTraceId) {
                        currentTraceId = traceContext.generateTraceId('booking');
                        logStructured('warn', 'traceId não encontrado, gerando novo', {
                            bookingId,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ Criar objeto de resposta com traceId garantido
                    const finalTraceId = currentTraceId || traceContext.getCurrentTraceId() || traceContext.generateTraceId('booking');

                    const bookingResponse = {
                        success: true,
                        bookingId,
                        message: 'Corrida solicitada com sucesso',
                        traceId: finalTraceId, // ✅ Incluir traceId no nível raiz
                        data: {
                            bookingId,
                            customerId,
                            pickupLocation,
                            destinationLocation,
                            estimatedFare,
                            paymentMethod,
                            status: 'requested',
                            timestamp: new Date().toISOString(),
                            traceId: finalTraceId // ✅ SOLUÇÃO: Incluir também dentro de data (garantido)
                        }
                    };

                    // ✅ Debug: Log para confirmar traceId na resposta
                    logStructured('info', 'bookingResponse criado com traceId', {
                        bookingId,
                        traceId: finalTraceId,
                        eventType: 'createBooking'
                    });

                    // ✅ NOVO: Cachear resultado para idempotency (DEPOIS de garantir traceId)
                    await idempotencyService.cacheResult(idempotencyKey, bookingResponse);

                    // ✅ GARANTIR que traceId esteja presente antes de emitir (dupla verificação)
                    if (!bookingResponse.traceId) {
                        bookingResponse.traceId = finalTraceId;
                    }
                    if (bookingResponse.data && !bookingResponse.data.traceId) {
                        bookingResponse.data.traceId = finalTraceId;
                    }

                    // ✅ DEBUG: Log imediatamente antes de emitir para verificar conteúdo
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_TRACEID === 'true') {
                        logStructured('debug', 'bookingResponse antes de emitir', {
                            service: 'server',
                            bookingId: bookingResponse.bookingId,
                            traceId: bookingResponse.traceId,
                            traceIdInData: bookingResponse.data?.traceId,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ Criar uma cópia explícita do objeto para garantir que traceId não seja perdido
                    const responseToEmit = {
                        success: bookingResponse.success,
                        bookingId: bookingResponse.bookingId,
                        message: bookingResponse.message,
                        traceId: bookingResponse.traceId, // ✅ Forçar inclusão explícita
                        data: {
                            ...bookingResponse.data,
                            traceId: bookingResponse.data?.traceId || bookingResponse.traceId // ✅ Forçar inclusão explícita
                        }
                    };

                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                        logStructured('debug', 'responseToEmit criado', {
                            service: 'websocket',
                            operation: 'createBooking',
                            responseToEmit
                        });
                    }

                    // Emitir confirmação para o cliente
                    socket.emit('bookingCreated', responseToEmit);

                    // ✅ DEBUG: Log após emitir para confirmar
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                        logStructured('debug', 'bookingCreated emitido', {
                            service: 'websocket',
                            operation: 'createBooking',
                            traceId: responseToEmit.traceId
                        });
                    }

                    const totalLatency = Date.now() - startTime;
                    logStructured('info', 'createBooking concluído com sucesso', {
                        userId,
                        bookingId,
                        eventType: 'createBooking',
                        latency_ms: totalLatency
                    });
                });
            } catch (error) {
                endSpanError(socketSpan, error);
                console.error('🔥 ERRO CRÍTICO EM CREATE_BOOKING:', error); // ✅ DEBUG DIRETO
                logStructured('error', 'Erro ao criar corrida', {
                    userId: socket.userId || data?.customerId || socket.id,
                    eventType: 'createBooking',
                    error: error.message,
                    stack: error.stack
                });

                // ✅ NOVO: Log de auditoria para erro na criação de corrida
                const userId = socket.userId || data?.customerId || socket.id;
                const metadata = getSocketMetadata(socket);
                await auditService.logRideAction(userId, 'createBooking', null, {
                    error: error.message,
                    stack: error.stack
                }, false, error.message, metadata);

                socket.emit('bookingError', { error: 'Erro interno do servidor' });
            }
        });
    });
    // =========================================================================================
}

module.exports = registerSocketCreateBookingHandler;
