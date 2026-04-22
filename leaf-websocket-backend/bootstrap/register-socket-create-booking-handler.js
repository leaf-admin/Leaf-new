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
    findAvailableDriversForPickup,
    rideCostTelemetryService
}) {
    const { scheduleCreateBookingAvailabilityPrecheck } = require('../services/create-booking-availability-precheck');
    const { buildCanonicalCreateBookingIdempotencyKey } = require('../services/create-booking-idempotency-service');
    const { countNearbyEligibleDriversApprox } = require('../services/driver-availability-snapshot-service');
    const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
    const { metrics } = require('../utils/prometheus-metrics');
    const CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS = Number.parseInt(
        process.env.CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS || '21600',
        10
    );
    const CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH = process.env.CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH !== 'false';
    const SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS = process.env.SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS !== 'false';
    const INCLUDE_CREATE_BOOKING_PERF_DEBUG = process.env.INCLUDE_CREATE_BOOKING_PERF_DEBUG === 'true';
    const CREATE_BOOKING_JOIN_WAIT_MS = Number.parseInt(
        process.env.IDEMPOTENCY_CREATE_BOOKING_JOIN_WAIT_MS
        || process.env.IDEMPOTENCY_JOIN_WAIT_MS
        || '25000',
        10
    );
    const CREATE_BOOKING_INFLIGHT_FOLLOWUP_WAIT_MS = Number.parseInt(
        process.env.IDEMPOTENCY_CREATE_BOOKING_INFLIGHT_FOLLOWUP_WAIT_MS
        || process.env.IDEMPOTENCY_CREATE_BOOKING_FOLLOWUP_WAIT_MS
        || '20000',
        10
    );

    const SEARCH_STATES = new Set(['PENDING', 'AWAITING_PAYMENT', 'SEARCHING', 'NOTIFIED', 'AWAITING_RESPONSE', 'EXPANDED', 'REJECTED']);
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
        let outerStartTime = Date.now();
        let outerReleaseIdempotencyLock = null;

        await traceContext.runWithTraceId(traceId, async () => {
            try {
                return await runInSpan(socketSpan, async () => {
                    logStructured('info', 'createBooking iniciado', {
                        userId: socket.userId || data.customerId || socket.id,
                        eventType: 'createBooking'
                    });

                    const startTime = Date.now();
                    const hotpathPath = 'create_booking';
                    const includePerfBreakdown =
                        INCLUDE_CREATE_BOOKING_PERF_DEBUG ||
                        data?.debugPerf === true ||
                        data?.includePerfBreakdown === true;
                    const perfTrace = {
                        start: startTime
                    };
                    let hotpathCursor = startTime;
                    let idempotencyKey = null;
                    let idempotencyOwner = false;

                    const recordStage = (stage, checkpoint = Date.now(), success = true) => {
                        metrics.recordHotpathStageLatency(
                            hotpathPath,
                            stage,
                            Math.max(0, (checkpoint - hotpathCursor) / 1000),
                            success
                        );
                        hotpathCursor = checkpoint;
                    };

                    const recordFailure = (stage, reason) => {
                        const checkpoint = Date.now();
                        if (reason) {
                            metrics.recordHotpathReason(hotpathPath, reason);
                        }
                        metrics.recordHotpathStageLatency(
                            hotpathPath,
                            stage,
                            Math.max(0, (checkpoint - hotpathCursor) / 1000),
                            false
                        );
                        metrics.recordHotpathLatency(
                            hotpathPath,
                            Math.max(0, (checkpoint - startTime) / 1000),
                            false
                        );
                        hotpathCursor = checkpoint;
                    };

                    const recordSuccess = () => {
                        metrics.recordHotpathLatency(
                            hotpathPath,
                            Math.max(0, (Date.now() - startTime) / 1000),
                            true
                        );
                    };

                    const releaseIdempotencyLock = async () => {
                        if (!idempotencyKey || !idempotencyOwner) return;
                        idempotencyOwner = false;
                        await idempotencyService.releaseInflight(idempotencyKey);
                    };
                    outerStartTime = startTime;
                    outerReleaseIdempotencyLock = releaseIdempotencyLock;

                    const userId = socket.userId || data.customerId || socket.id;
                    const metadata = getSocketMetadata(socket);

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
                        recordFailure('validate', 'validation_error');
                        return;
                    }
                    perfTrace.afterValidation = Date.now();
                    recordStage('validate', perfTrace.afterValidation);

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

                    if (customerId) {
                        try {
                            const passengerTrustService = require('../services/passenger-trust-service');
                            const trustDecision = await passengerTrustService.checkEligibility(customerId);
                            if (!trustDecision.allowed) {
                                socket.emit('bookingError', {
                                    error: 'Solicitação bloqueada',
                                    message: trustDecision.reason,
                                    code: trustDecision.code,
                                    trustStatus: trustDecision.profile?.trustStatus || null,
                                    trustScore: trustDecision.profile?.trustScore ?? null
                                });

                                logStructured('warn', 'createBooking bloqueado por trust & safety', {
                                    customerId,
                                    trustStatus: trustDecision.profile?.trustStatus || null,
                                    trustScore: trustDecision.profile?.trustScore ?? null,
                                    trustCode: trustDecision.code,
                                    eventType: 'createBooking'
                                });
                                recordFailure('active_guard', 'passenger_trust_blocked');
                                return;
                            }
                        } catch (trustGuardError) {
                            logStructured('warn', 'Falha no guard de trust do passageiro (seguindo fluxo)', {
                                customerId,
                                eventType: 'createBooking',
                                error: trustGuardError.message
                            });
                        }
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
                                recordFailure('active_guard', 'queue_backpressure');
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
                    recordStage('active_guard', perfTrace.afterBackpressure);

                    let areaPolicyDecision = null;
                    const areaPolicyCity = String(
                        pickupLocation?.city
                        || pickupLocation?.cityName
                        || data?.city
                        || process.env.DEFAULT_OPERATIONS_CITY
                        || 'default'
                    ).trim();
                    const areaPolicyRegionHash = GeoHashUtils.getRegionHash(
                        pickupLocation.lat,
                        pickupLocation.lng
                    );

                    try {
                        const operationalAreaPolicyService = require('../services/operational-area-policy-service');
                        const redis = redisPool.getConnection();
                        const queueKey = `ride_queue:${areaPolicyRegionHash}:pending`;
                        const pendingRides = await redis.zcard(queueKey).catch(() => 0);
                        const availabilitySnapshot = await countNearbyEligibleDriversApprox(pickupLocation, {
                            regionHash: areaPolicyRegionHash,
                            limit: Number.parseInt(process.env.OPERATIONS_POLICY_DRIVER_LIMIT || '12', 10),
                            radiusKm: Number.parseFloat(process.env.OPERATIONS_POLICY_RADIUS_KM || '5')
                        }).catch(() => ({ success: false, availableDrivers: 0, source: 'error' }));

                        areaPolicyDecision = await operationalAreaPolicyService.evaluateCreateBooking({
                            city: areaPolicyCity,
                            regionHash: areaPolicyRegionHash,
                            openRequests: pendingRides,
                            availableDrivers: availabilitySnapshot?.availableDrivers || 0
                        });

                        if (!areaPolicyDecision.allowed) {
                            socket.emit('bookingError', {
                                error: 'Solicitações temporariamente restritas na sua área',
                                message: 'A operação está controlando novas corridas nesta região neste momento.',
                                code: 'AREA_POLICY_RESTRICTED',
                                dispatchMode: areaPolicyDecision.dispatchMode,
                                reasons: areaPolicyDecision.reasons,
                                policyId: areaPolicyDecision.policy?.policyId || null,
                                regionHash: areaPolicyRegionHash
                            });

                            logStructured('warn', 'createBooking bloqueado por política operacional', {
                                customerId,
                                city: areaPolicyCity,
                                regionHash: areaPolicyRegionHash,
                                dispatchMode: areaPolicyDecision.dispatchMode,
                                reasons: areaPolicyDecision.reasons,
                                policyId: areaPolicyDecision.policy?.policyId || null,
                                eventType: 'createBooking'
                            });
                            recordFailure('policy', 'policy_restricted');
                            return;
                        }
                    } catch (areaPolicyError) {
                        logStructured('warn', 'Falha na política operacional de área (seguindo fluxo)', {
                            customerId,
                            city: areaPolicyCity,
                            regionHash: areaPolicyRegionHash,
                            eventType: 'createBooking',
                            error: areaPolicyError.message
                        });
                    }
                    perfTrace.afterPolicy = Date.now();
                    recordStage('policy', perfTrace.afterPolicy);

                    // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                    const fallbackIdempotencyKey = String(
                        data.idempotencyKey ||
                        `${userId}:createBooking:route:${Number.parseFloat(pickupLocation.lat).toFixed(5)}:${Number.parseFloat(pickupLocation.lng).toFixed(5)}:${Number.parseFloat(destinationLocation.lat).toFixed(5)}:${Number.parseFloat(destinationLocation.lng).toFixed(5)}:${String(paymentMethod || 'unknown').trim().toLowerCase()}`
                    ).trim();
                    idempotencyKey = buildCanonicalCreateBookingIdempotencyKey({
                        userId,
                        data: {
                            ...data,
                            paymentMethod,
                            pickupLocation,
                            destinationLocation
                        },
                        fallbackIdempotencyKey
                    });

                    const idempotencyCheck = await idempotencyService.beginRequest(idempotencyKey, {
                        joinWaitMs: CREATE_BOOKING_JOIN_WAIT_MS
                    });
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
                            metrics.recordHotpathReason(hotpathPath, 'duplicate_joined');
                            recordStage('idempotency', perfTrace.afterIdempotency);
                            recordSuccess();
                            return;
                        } else {
                            // Requisição duplicada ainda em voo.
                            // Fazemos uma segunda espera para "grudar" no resultado da primeira
                            // tentativa em vez de devolver erro cedo demais sob carga.
                            const inflightJoinedResult = await idempotencyService.waitForCachedResult(idempotencyKey, {
                                waitMs: CREATE_BOOKING_INFLIGHT_FOLLOWUP_WAIT_MS,
                                pollIntervalMs: 100
                            });

                            if (inflightJoinedResult) {
                                logStructured('info', 'Resultado joined retornado após espera complementar', {
                                    userId,
                                    eventType: 'createBooking',
                                    idempotencyKey,
                                    action: 'return_joined_after_followup_wait'
                                });
                                const joinedResult = {
                                    ...inflightJoinedResult,
                                    traceId: inflightJoinedResult.traceId || traceId || traceContext.getCurrentTraceId() || 'JOINED-TRACE-ID'
                                };
                                if (joinedResult.data && !joinedResult.data.traceId) {
                                    joinedResult.data.traceId = joinedResult.traceId;
                                }
                                socket.emit('bookingCreated', joinedResult);
                                metrics.recordHotpathReason(hotpathPath, 'duplicate_joined');
                                recordStage('idempotency', Date.now());
                                recordSuccess();
                                return;
                            }

                            logStructured('warn', 'Requisição duplicada detectada sem resultado joined', {
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
                            recordFailure('idempotency', 'duplicate_rejected');
                            return;
                        }
                    }
                    idempotencyOwner = true;
                    recordStage('idempotency', perfTrace.afterIdempotency);

                    const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'createBooking', {
                        ip: metadata.ip
                    });

                    if (!rateLimitCheck.allowed) {
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
                        recordFailure('validate', 'rate_limit_exceeded');
                        await releaseIdempotencyLock();
                        return;
                    }
                    perfTrace.afterRateLimit = Date.now();

                    if (areaPolicyDecision?.policy) {
                        try {
                            const operationalAreaPolicyService = require('../services/operational-area-policy-service');
                            await operationalAreaPolicyService.recordAcceptedRequest(
                                areaPolicyDecision.policy,
                                areaPolicyRegionHash
                            );
                        } catch (areaPolicyRecordError) {
                            logStructured('warn', 'Falha ao registrar request em política operacional', {
                                customerId,
                                regionHash: areaPolicyRegionHash,
                                policyId: areaPolicyDecision.policy?.policyId || null,
                                eventType: 'createBooking',
                                error: areaPolicyRecordError.message
                            });
                        }
                    }

                    // ✅ REFATORAÇÃO: Usar RequestRideCommand
                    logStructured('info', 'Executando RequestRideCommand', {
                        customerId,
                        eventType: 'createBooking'
                    });

                    // Guarda de negócio: validar disponibilidade quando pagamento já confirmado.
                    // Não bloquear a criação da corrida por falhas transitórias desta checagem.
                    scheduleCreateBookingAvailabilityPrecheck({
                        hasConfirmedPayment,
                        pickupLocation,
                        requestedCarType,
                        checkAvailability: findAvailableDriversForPickup,
                        logStructured,
                        logContext: {
                            userId,
                            eventType: 'createBooking'
                        }
                    });

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
                            paymentStatus: data?.paymentStatus || 'pending_payment',
                            paymentId: data?.paymentId || null,
                            paymentData:
                                data?.paymentData && typeof data.paymentData === 'object'
                                    ? { ...data.paymentData }
                                    : null,
                            pricingContext: data.pricingContext || data.operational || null,
                            traceId, // ✅ Passar traceId para o command
                            correlationId // ✅ Passar correlationId para o command
                        });

                        result = await runInSpan(commandSpan, async () => {
                            return await command.execute();
                        });

                        // ✅ MÉTRICAS: Registrar latência do command
                        commandLatency = (Date.now() - commandStartTime) / 1000;
                    } catch (error) {
                        endSpanError(commandSpan, error);
                        commandLatency = (Date.now() - commandStartTime) / 1000;
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
                        recordFailure('command', 'command_error');
                        await releaseIdempotencyLock();
                        return;
                    }

                    // Command executado com sucesso
                    const {
                        bookingId,
                        bookingData: commandBookingData,
                        event,
                        regionHash,
                        perfBreakdownMs: commandPerfBreakdown = null
                    } = result.data;
                    perfTrace.afterCommand = Date.now();
                    recordStage('command', perfTrace.afterCommand);

                    setImmediate(async () => {
                        try {
                            const redis = redisPool.getConnection();
                            await pricingH3ReadModelService.applyBookingSnapshot(redis, {
                                bookingId,
                                ...(commandBookingData || {}),
                                status: commandBookingData?.status || (hasConfirmedPayment ? 'SEARCHING' : 'AWAITING_PAYMENT'),
                                state: commandBookingData?.state || (hasConfirmedPayment ? 'SEARCHING' : 'AWAITING_PAYMENT')
                            });
                        } catch (pricingReadModelError) {
                            logStructured('warn', 'Falha ao atualizar read-model H3 de pricing após createBooking', {
                                bookingId,
                                eventType: 'createBooking',
                                error: pricingReadModelError.message
                            });
                        }
                    });

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

                    // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão notificar motoristas)
                    if (event) {
                        if (!event.data) {
                            event.data = {};
                        }
                        if (!event.data.metadata) {
                            event.data.metadata = {};
                        }
                        if (!hasConfirmedPayment) {
                            event.data.skipDriverNotify = true;
                            event.data.metadata.skipDriverNotify = true;
                            event.data.metadata.dispatchStrategy = 'await_payment_webhook';
                        } else if (SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS) {
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

                    // O booking primário já sai autoritativo do command/queue manager.
                    // Aqui mantemos apenas o ponteiro rápido do passageiro para evitar
                    // reconsultas desnecessárias no guard de booking ativo.
                    try {
                        const redis = redisPool.getConnection();
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
                    recordStage('response_prepare', perfTrace.beforeResponse);

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
                            pricingPayload: commandBookingData?.pricingPayload || null,
                            operationalState: commandBookingData?.operationalState || null,
                            scorePressao: commandBookingData?.scorePressao ?? null,
                            scoreExcecao: commandBookingData?.scoreExcecao ?? null,
                            paymentMethod,
                            status: 'requested',
                            timestamp: new Date().toISOString(),
                            traceId: finalTraceId, // ✅ SOLUÇÃO: Incluir também dentro de data (garantido)
                            ...(includePerfBreakdown
                                ? {
                                    perfMs: {
                                        rateLimit: (perfTrace.afterRateLimit || Date.now()) - perfTrace.start,
                                        validation: (perfTrace.afterValidation || Date.now()) - (perfTrace.afterRateLimit || perfTrace.start),
                                        activeGuard: (perfTrace.afterActiveGuard || Date.now()) - (perfTrace.afterValidation || perfTrace.start),
                                        backpressure: (perfTrace.afterBackpressure || Date.now()) - (perfTrace.afterActiveGuard || perfTrace.start),
                                        policy: (perfTrace.afterPolicy || Date.now()) - (perfTrace.afterBackpressure || perfTrace.start),
                                        idempotency: (perfTrace.afterIdempotency || Date.now()) - (perfTrace.afterPolicy || perfTrace.afterBackpressure || perfTrace.start),
                                        preCommand: (perfTrace.afterIdempotency || Date.now()) - perfTrace.start,
                                        command: (perfTrace.afterCommand || Date.now()) - (perfTrace.commandStart || perfTrace.start),
                                        responsePrepare: (perfTrace.beforeResponse || Date.now()) - (perfTrace.afterCommand || perfTrace.start),
                                        postCommandBeforeResponse: (perfTrace.beforeResponse || Date.now()) - (perfTrace.afterCommand || perfTrace.start),
                                        totalToResponse: Date.now() - perfTrace.start,
                                        commandBreakdown: commandPerfBreakdown
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

                    // Cachear o resultado antes do emit para que retries benignos
                    // consigam "join" de forma estável no caminho quente.
                    try {
                        await idempotencyService.cacheResult(idempotencyKey, bookingResponse);
                    } catch (idempotencyCacheError) {
                        logStructured('warn', 'Falha ao cachear resultado de idempotência antes do emit', {
                            bookingId,
                            eventType: 'createBooking',
                            error: idempotencyCacheError.message
                        });
                    }

                    // Emitir confirmação para o cliente o quanto antes para evitar timeout no app.
                    socket.emit('bookingCreated', responseToEmit);
                    perfTrace.afterEmit = Date.now();
                    recordStage('response_emit', perfTrace.afterEmit);
                    recordSuccess();

                    // Telemetria de custo enviada junto com o createBooking entra em background
                    // para não disputar o tempo crítico de resposta ao cliente.
                    if (rideCostTelemetryService && data?.rideCostTelemetry?.snapshot) {
                        setImmediate(async () => {
                            try {
                                await rideCostTelemetryService.ingestSnapshot({
                                    bookingId,
                                    sourceMeta: {
                                        ...data?.rideCostTelemetry?.sourceMeta,
                                        userId: customerId,
                                        userType: socket.userType || 'customer',
                                        socketId: socket.id
                                    },
                                    snapshot: data.rideCostTelemetry.snapshot,
                                    pricingSheet: data?.rideCostTelemetry?.pricingSheet || null,
                                    requestMeta: {
                                        source: 'createBooking',
                                        socketId: socket.id,
                                        receivedAt: new Date().toISOString()
                                    }
                                });
                            } catch (telemetryError) {
                                logStructured('warn', 'Falha ao persistir telemetria inicial da corrida', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    error: telemetryError.message
                                });
                            }
                        });
                    }

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

                    // Link de charge/rideId fica em background. O booking primário já sai com
                    // status de pagamento consistente, então não precisamos bloquear a resposta.
                    if (data?.paymentData?.chargeId || data?.paymentId || data?.paymentData?.rideId || data?.rideId) {
                        setImmediate(async () => {
                            try {
                                const paymentDispatchService = require('../services/payment-dispatch-service');
                                await paymentDispatchService.linkPaymentToBooking({
                                    bookingId,
                                    chargeId: data?.paymentData?.chargeId || data?.paymentId || '',
                                    temporaryRideId: data?.paymentData?.rideId || data?.rideId || ''
                                });
                            } catch (paymentLinkError) {
                                logStructured('warn', 'Falha ao vincular referências de pagamento em background', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    error: paymentLinkError.message
                                });
                            }
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
                                status: hasConfirmedPayment ? 'pending' : 'awaiting_payment',
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
                try {
                    if (typeof outerReleaseIdempotencyLock === 'function') {
                        await outerReleaseIdempotencyLock();
                    }
                } catch (_releaseError) {
                    // ignore
                }
                endSpanError(socketSpan, error);
                console.error('🔥 ERRO CRÍTICO EM CREATE_BOOKING:', error); // ✅ DEBUG DIRETO
                logStructured('error', 'Erro ao criar corrida', {
                    userId: socket.userId || data?.customerId || socket.id,
                    eventType: 'createBooking',
                    error: error.message,
                    stack: error.stack
                });
                metrics.recordHotpathReason('create_booking', 'unexpected_error');
                metrics.recordHotpathLatency('create_booking', Math.max(0, (Date.now() - outerStartTime) / 1000), false);

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
