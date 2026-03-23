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
    const CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS = Number.parseInt(
        process.env.CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS || '21600',
        10
    );
    const CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH = process.env.CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH !== 'false';
    const SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS = process.env.SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS !== 'false';
    const INCLUDE_CREATE_BOOKING_PERF_DEBUG = process.env.INCLUDE_CREATE_BOOKING_PERF_DEBUG === 'true';

    const SEARCH_STATES = new Set(['PENDING', 'SEARCHING', 'NOTIFIED', 'AWAITING_RESPONSE', 'EXPANDED', 'REJECTED']);
    const BLOCKING_STATES = new Set(['MATCHED', 'ACCEPTED', 'IN_PROGRESS']);
    const FINAL_STATES = new Set(['COMPLETED', 'CANCELED']);

    const cleanupSupersededBookingSearch = async ({
        previousBookingId,
        customerId,
        replacementBookingId,
        redis,
        logStructured
    }) => {
        if (!previousBookingId || previousBookingId === replacementBookingId) {
            return;
        }

        try {
            const GradualRadiusExpander = require('../services/gradual-radius-expander');
            const rideQueueManager = require('../services/ride-queue-manager');
            const RideStateManager = require('../services/ride-state-manager');
            const expander = new GradualRadiusExpander(io);

            // Finaliza o booking anterior para evitar que siga sendo selecionado por monitores paralelos.
            const previousState = await RideStateManager.getBookingState(redis, previousBookingId);
            if (previousState && previousState !== RideStateManager.STATES.CANCELED && previousState !== RideStateManager.STATES.COMPLETED) {
                try {
                    await RideStateManager.updateBookingState(
                        redis,
                        previousBookingId,
                        RideStateManager.STATES.CANCELED,
                        {
                            canceledBy: customerId || 'system',
                            reason: 'SUPERSEDED_BY_NEW_REQUEST',
                            supersededByBookingId: replacementBookingId || '',
                            cancelledAt: new Date().toISOString()
                        }
                    );
                } catch (stateError) {
                    logStructured('warn', 'Falha ao finalizar estado do booking supersedido', {
                        customerId,
                        previousBookingId,
                        replacementBookingId: replacementBookingId || null,
                        eventType: 'createBooking',
                        error: stateError.message
                    });
                }
            }

            await expander.stopSearch(previousBookingId);
            await rideQueueManager.dequeueRide(previousBookingId);

            await redis.hset(`booking:${previousBookingId}`, {
                status: 'SUPERSEDED',
                supersededAt: new Date().toISOString(),
                supersededByBookingId: replacementBookingId || '',
                supersededByCustomerId: customerId || ''
            });

            logStructured('info', 'Busca de booking anterior encerrada por supersedência', {
                customerId,
                previousBookingId,
                replacementBookingId,
                eventType: 'createBooking'
            });
        } catch (supersedeError) {
            logStructured('warn', 'Falha ao encerrar booking anterior supersedido', {
                customerId,
                previousBookingId,
                replacementBookingId,
                eventType: 'createBooking',
                error: supersedeError.message
            });
        }
    };

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
                    const perfTrace = {
                        start: startTime
                    };

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
                    perfTrace.afterRateLimit = Date.now();

                    logStructured('info', 'Solicitação de corrida recebida', {
                        socketId: socket.id,
                        userId,
                        eventType: 'createBooking'
                    });

                    // ✅ Segurança: forçar customerId autenticado no payload antes da validação
                    const authCustomerId = socket.userId || null;
                    const validationPayload = authCustomerId
                        ? { ...data, customerId: authCustomerId }
                        : data;

                    // ✅ NOVO: Validação e sanitização de dados
                    const validation = validationService.validateEndpoint('createBooking', validationPayload);

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
                    perfTrace.afterValidation = Date.now();

                    // Usar dados sanitizados
                    const {
                        customerId: sanitizedCustomerId,
                        pickupLocation,
                        destinationLocation,
                        estimatedFare,
                        routeDistanceKm,
                        routeDurationSecs,
                        tollFee,
                        carType: sanitizedCarType,
                        paymentMethod
                    } = validation.sanitized;
                    const customerId = authCustomerId || sanitizedCustomerId;
                    const customerActiveBookingKey = customerId
                        ? `customer_active_booking:${customerId}`
                        : null;
                    let supersededBookingId = null;

                    if (authCustomerId && sanitizedCustomerId && sanitizedCustomerId !== authCustomerId) {
                        logStructured('warn', 'createBooking com customerId divergente do usuário autenticado', {
                            userId,
                            socketUserId: authCustomerId,
                            payloadCustomerId: sanitizedCustomerId,
                            eventType: 'createBooking'
                        });
                    }

                    if (customerActiveBookingKey) {
                        try {
                            const redis = redisPool.getConnection();
                            const activeBookingId = await redis.get(customerActiveBookingKey);

                            if (activeBookingId) {
                                const RideStateManager = require('../services/ride-state-manager');
                                const activeState = await RideStateManager.getBookingState(redis, activeBookingId);

                                if (BLOCKING_STATES.has(activeState)) {
                                    socket.emit('bookingError', {
                                        error: 'Você já possui uma corrida ativa',
                                        message: 'Finalize a corrida atual antes de solicitar uma nova.',
                                        code: 'ACTIVE_RIDE_EXISTS',
                                        activeBookingId
                                    });
                                    return;
                                }

                                if (FINAL_STATES.has(activeState)) {
                                    await redis.del(customerActiveBookingKey);
                                } else if (SEARCH_STATES.has(activeState)) {
                                    supersededBookingId = activeBookingId;
                                    await cleanupSupersededBookingSearch({
                                        previousBookingId: activeBookingId,
                                        customerId,
                                        replacementBookingId: null,
                                        redis,
                                        logStructured
                                    });
                                }
                            }
                        } catch (activeBookingGuardError) {
                            logStructured('warn', 'Falha ao validar/superseder booking ativo do cliente (seguindo fluxo)', {
                                customerId,
                                eventType: 'createBooking',
                                error: activeBookingGuardError.message
                            });
                        }
                    }
                    perfTrace.afterActiveGuard = Date.now();
                    const normalizedPaymentStatus = (data?.paymentStatus || 'pending_payment').toString().toLowerCase();
                    const hasConfirmedPayment = ['confirmed', 'paid', 'in_holding'].includes(normalizedPaymentStatus);
                    const requestedCarType = sanitizedCarType || data?.carType || null;

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
                            const onlineDrivers = await redis.scard('online_drivers');
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
                    perfTrace.afterBackpressure = Date.now();

                    // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                    const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                        userId,
                        'createBooking',
                        `${pickupLocation.lat}_${pickupLocation.lng}_${destinationLocation.lat}_${destinationLocation.lng}_${Date.now()}`
                    );

                    const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey);
                    perfTrace.afterIdempotency = Date.now();

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

                    // Guarda de negócio: validar disponibilidade quando pagamento já confirmado.
                    // Não bloquear a criação da corrida por falhas transitórias desta checagem.
                    if (hasConfirmedPayment) {
                        // Pré-check informativo: não deve bloquear criação de corrida.
                        setImmediate(async () => {
                            try {
                                const availability = await findAvailableDriversForPickup(pickupLocation, {
                                    carType: requestedCarType
                                });

                                if (!availability.success) {
                                    logStructured('warn', 'createBooking: validação de disponibilidade falhou, seguindo fluxo', {
                                        userId,
                                        eventType: 'createBooking',
                                        code: 'AVAILABILITY_CHECK_FAILED'
                                    });
                                } else if ((availability.drivers || []).length === 0) {
                                    logStructured('warn', 'createBooking: sem motoristas no pre-check, mantendo busca ativa', {
                                        userId,
                                        eventType: 'createBooking',
                                        code: 'NO_DRIVERS_AVAILABLE'
                                    });
                                }
                            } catch (availabilityError) {
                                logStructured('warn', 'createBooking: erro no pre-check de disponibilidade, seguindo fluxo', {
                                    userId,
                                    eventType: 'createBooking',
                                    error: availabilityError.message
                                });
                            }
                        });
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
                    perfTrace.commandStart = commandStartTime;
                    let result;
                    let commandLatency;
                    try {
                        const command = new RequestRideCommand({
                            customerId,
                            pickupLocation,
                            destinationLocation,
                            estimatedFare: estimatedFare || 0,
                            routeDistanceKm: routeDistanceKm || 0,
                            routeDurationSecs: routeDurationSecs || 0,
                            tollFee: tollFee || 0,
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
                    perfTrace.afterCommand = Date.now();

                    if (supersededBookingId && supersededBookingId !== bookingId) {
                        try {
                            const redis = redisPool.getConnection();
                            await redis.hset(`booking:${supersededBookingId}`, {
                                supersededByBookingId: bookingId,
                                supersededAt: new Date().toISOString()
                            });
                        } catch (supersededUpdateError) {
                            logStructured('warn', 'Falha ao atualizar vínculo de supersedência com booking final', {
                                bookingId,
                                supersededBookingId,
                                eventType: 'createBooking',
                                error: supersededUpdateError.message
                            });
                        }
                    }

                    // Persistir metadados de pagamento antes do dispatch.
                    // Isso evita janelas onde consumidores veem a corrida como "unpaid".
                    try {
                        const paymentDispatchService = require('../services/payment-dispatch-service');
                        const paymentChargeId = data?.paymentData?.chargeId || data?.paymentId || '';
                        const paymentAmountInCents = data?.paymentData?.amountInCents || '';
                        const temporaryRideId = data?.paymentData?.rideId || data?.rideId || '';

                        if (hasConfirmedPayment) {
                            await paymentDispatchService.markBookingPaymentConfirmed({
                                bookingId,
                                chargeId: paymentChargeId,
                                temporaryRideId,
                                amountInCents: paymentAmountInCents,
                                paymentStatus: 'in_holding',
                                source: 'createBooking'
                            });
                        } else {
                            await paymentDispatchService.linkPaymentToBooking({
                                bookingId,
                                chargeId: paymentChargeId,
                                temporaryRideId
                            });
                        }
                    } catch (bookingMetaError) {
                        logStructured('warn', 'Falha ao persistir metadados de pagamento antes do dispatch', {
                            bookingId,
                            error: bookingMetaError.message,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão notificar motoristas)
                    if (event) {
                        if (!event.data) {
                            event.data = {};
                        }
                        if (!event.data.metadata) {
                            event.data.metadata = {};
                        }
                        if (hasConfirmedPayment && SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS) {
                            // Corridas pagas usam dispatch imediato dedicado; evita notificação duplicada.
                            event.data.skipDriverNotify = true;
                            event.data.metadata.skipDriverNotify = true;
                            event.data.metadata.dispatchStrategy = 'payment_dispatch_only';
                        }

                        const publishRideRequestedEvent = async () => {
                            // ✅ FASE 1.3: Criar span para Event publish
                            const { trace: otelTrace } = require('@opentelemetry/api');
                            const activeSpan = otelTrace.getActiveSpan();
                            const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
                                'event.booking_id': bookingId,
                                'correlation.id': correlationId // ✅ Passar correlationId
                            });

                            const eventStartTime = Date.now();
                            await runInSpan(eventSpan, async () => {
                                await eventBus.publish({
                                    eventType: 'ride.requested',
                                    data: event
                                });
                            });

                            // ✅ Salvar contexto do evento para linkar com listeners
                            const eventSpanContext = eventSpan.spanContext();
                            event.data._otelSpanContext = eventSpanContext;
                            // ✅ CRÍTICO: Serializar correlationId e traceId no evento
                            event.data.metadata.correlationId = correlationId;
                            event.data.metadata.traceId = eventSpanContext.traceId;
                            event.data.metadata.spanId = eventSpanContext.spanId;

                            // ✅ MÉTRICAS: Registrar evento publicado
                            metrics.recordEventPublished('ride.requested');

                            endSpanSuccess(eventSpan, {
                                'event.latency_ms': Date.now() - eventStartTime
                            });

                            const eventLatency = Date.now() - eventStartTime;
                            logEvent('ride.requested', 'published', {
                                bookingId,
                                latency_ms: eventLatency
                            });
                        };

                        if (CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH) {
                            setImmediate(async () => {
                                try {
                                    await publishRideRequestedEvent();
                                } catch (publishError) {
                                    logStructured('warn', 'createBooking: falha ao publicar ride.requested em background', {
                                        bookingId,
                                        eventType: 'createBooking',
                                        error: publishError.message
                                    });
                                }
                            });
                        } else {
                            try {
                                await publishRideRequestedEvent();
                            } catch (error) {
                                endSpanError(socketSpan, error);
                                throw error;
                            }
                        }
                    }

                    // Armazenar também em activeBookings (compatibilidade)
                    io.activeBookings.set(bookingId, {
                        bookingId,
                        customerId,
                        pickupLocation,
                        destinationLocation,
                        estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                        paymentMethod,
                        status: 'requested'
                    });

                    // Persistir metadados essenciais no booking.
                    // Para corridas pagas, o bloco anterior já gravou status/chargeId/amount.
                    try {
                        const redis = redisPool.getConnection();
                        const bookingPatch = {
                            carType: requestedCarType || ''
                        };

                        if (!hasConfirmedPayment) {
                            const paymentChargeId = data?.paymentData?.chargeId || data?.paymentId || '';
                            const paymentReferenceRideId = data?.paymentData?.rideId || data?.rideId || '';
                            bookingPatch.paymentStatus = normalizedPaymentStatus;
                            bookingPatch.paymentChargeId = paymentChargeId;
                            bookingPatch.paymentAmountInCents = data?.paymentData?.amountInCents
                                ? String(data.paymentData.amountInCents)
                                : '';
                            bookingPatch.paymentReferenceRideId = paymentReferenceRideId;
                        }

                        await redis.hset(`booking:${bookingId}`, bookingPatch);

                        if (customerActiveBookingKey) {
                            await redis.set(
                                customerActiveBookingKey,
                                bookingId,
                                'EX',
                                CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS
                            );
                        }
                    } catch (bookingMetaError) {
                        logStructured('warn', 'Falha ao persistir metadados no booking', {
                            bookingId,
                            error: bookingMetaError.message,
                            eventType: 'createBooking'
                        });
                    }
                    perfTrace.beforeResponse = Date.now();

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
                            estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                            paymentMethod,
                            status: 'requested',
                            timestamp: new Date().toISOString(),
                            traceId: finalTraceId, // ✅ SOLUÇÃO: Incluir também dentro de data (garantido)
                            ...(INCLUDE_CREATE_BOOKING_PERF_DEBUG
                                ? {
                                    perfMs: {
                                        rateLimit: (perfTrace.afterRateLimit || Date.now()) - perfTrace.start,
                                        validation: (perfTrace.afterValidation || Date.now()) - (perfTrace.afterRateLimit || perfTrace.start),
                                        activeGuard: (perfTrace.afterActiveGuard || Date.now()) - (perfTrace.afterValidation || perfTrace.start),
                                        backpressure: (perfTrace.afterBackpressure || Date.now()) - (perfTrace.afterActiveGuard || perfTrace.start),
                                        idempotency: (perfTrace.afterIdempotency || Date.now()) - (perfTrace.afterBackpressure || perfTrace.start),
                                        preCommand: (perfTrace.afterIdempotency || Date.now()) - perfTrace.start,
                                        command: (perfTrace.afterCommand || Date.now()) - (perfTrace.commandStart || perfTrace.start),
                                        postCommandBeforeResponse: (perfTrace.beforeResponse || Date.now()) - (perfTrace.afterCommand || perfTrace.start),
                                        totalToResponse: Date.now() - perfTrace.start
                                    }
                                }
                                : {})
                        }
                    };

                    // ✅ Debug: Log para confirmar traceId na resposta
                    logStructured('info', 'bookingResponse criado com traceId', {
                        bookingId,
                        traceId: finalTraceId,
                        eventType: 'createBooking'
                    });

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

                    // Emitir confirmação para o cliente o quanto antes para evitar timeout no app.
                    socket.emit('bookingCreated', responseToEmit);

                    // Cache de idempotência fora do caminho síncrono da resposta.
                    setImmediate(async () => {
                        try {
                            await idempotencyService.cacheResult(idempotencyKey, bookingResponse);
                        } catch (idempotencyCacheError) {
                            logStructured('warn', 'Falha ao cachear resultado de idempotência (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: idempotencyCacheError.message
                            });
                        }
                    });

                    // Para corridas já pagas, acionar dispatch imediato e resiliente sem depender de fila/event bus.
                    if (hasConfirmedPayment) {
                        const paymentDispatchService = require('../services/payment-dispatch-service');
                        const paidDispatchMaxAttempts = Number.parseInt(
                            process.env.PAID_BOOKING_DISPATCH_MAX_ATTEMPTS || '120',
                            10
                        );
                        const paidDispatchRetryDelayMs = Number.parseInt(
                            process.env.PAID_BOOKING_DISPATCH_RETRY_DELAY_MS || '1000',
                            10
                        );

                        paymentDispatchService.triggerDispatchAfterPayment({
                            bookingId,
                            io,
                            pickupLocation,
                            source: 'createBooking_paid_immediate',
                            force: true,
                            maxAttempts: paidDispatchMaxAttempts,
                            retryDelayMs: paidDispatchRetryDelayMs
                        }).then((dispatchResult) => {
                            logStructured('info', 'createBooking: dispatch imediato para corrida paga processado', {
                                bookingId,
                                eventType: 'createBooking',
                                success: Boolean(dispatchResult?.success),
                                skipped: Boolean(dispatchResult?.skipped),
                                reason: dispatchResult?.reason || null,
                                attempts: dispatchResult?.attempts || 1
                            });
                        }).catch((dispatchError) => {
                            logStructured('warn', 'createBooking: falha ao acionar dispatch imediato para corrida paga', {
                                bookingId,
                                eventType: 'createBooking',
                                error: dispatchError.message
                            });
                        });
                    }

                    // ✅ DEBUG: Log após emitir para confirmar
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                        logStructured('debug', 'bookingCreated emitido', {
                            service: 'websocket',
                            operation: 'createBooking',
                            traceId: responseToEmit.traceId
                        });
                    }

                    // Pós-processamentos em background (não bloquear bookingCreated / dispatch para motorista).
                    setImmediate(async () => {
                        try {
                            await metricsCollector.recordMatchStart(bookingId, Date.now());
                        } catch (metricsError) {
                            logStructured('warn', 'Falha ao registrar match start (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: metricsError.message
                            });
                        }

                        try {
                            await auditService.logRideAction(userId, 'createBooking', bookingId, {
                                pickupLocation,
                                destinationLocation,
                                estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                                paymentMethod,
                                regionHash
                            }, true, null, metadata);
                        } catch (auditError) {
                            logStructured('warn', 'Falha ao registrar auditoria createBooking (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: auditError.message
                            });
                        }

                        try {
                            const redis = redisPool.getConnection();
                            await redisPool.ensureConnection();
                            const queueKey = `ride_queue:${regionHash}:pending`;
                            const pendingRides = await redis.zcard(queueKey);

                            if (pendingRides >= 3) {
                                const demandNotificationService = require('../services/demand-notification-service');
                                await demandNotificationService.checkAndNotifyDemand(
                                    pickupLocation,
                                    pendingRides
                                );
                            }
                        } catch (demandError) {
                            logStructured('error', 'Erro ao verificar demanda (background)', {
                                bookingId,
                                error: demandError.message,
                                eventType: 'createBooking'
                            });
                        }

                        try {
                            const ridePersistenceService = require('../services/ride-persistence-service');
                            await ridePersistenceService.saveRide({
                                rideId: bookingId,
                                bookingId: bookingId,
                                passengerId: customerId,
                                pickupLocation: pickupLocation,
                                destinationLocation: destinationLocation,
                                estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                                paymentMethod: paymentMethod || 'pix',
                                paymentStatus: data.paymentStatus || 'pending_payment',
                                status: 'pending',
                                carType: data.carType || null
                            });
                        } catch (persistError) {
                            logStructured('error', 'Erro ao salvar corrida no Firestore (background)', {
                                bookingId,
                                error: persistError.message,
                                eventType: 'createBooking'
                            });
                        }
                    });

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
