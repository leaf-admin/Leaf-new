const { metrics } = require('../utils/prometheus-metrics');
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');

function mapStartTripReason(errorMessage = '') {
    const normalized = String(errorMessage || '').toLowerCase();
    if (normalized.includes('não encontrada') || normalized.includes('nao encontrada')) return 'booking_not_found';
    if (normalized.includes('após registrar chegada') || normalized.includes('arrival')) return 'arrival_not_registered';
    if (normalized.includes('pagamento não confirmado') || normalized.includes('pagamento não encontrado')) return 'payment_not_confirmed';
    return 'command_error';
}

function registerSocketStartTripHandler({
    socket,
    io,
    extractTraceIdFromEvent,
    traceContext,
    logStructured,
    rateLimiterService,
    validationService,
    getSocketMetadata,
    auditService,
    redisPool,
    idempotencyService,
    StartTripCommand,
    getTracer,
    createCommandSpan,
    runInSpan,
    endSpanError,
    logCommand,
    eventBus,
    createEventSpan,
    logEvent,
    fcmService
}) {
    const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
    socket.on('startTrip', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        let outerIdempotencyKey = null;
        let outerIdempotencyOwner = false;
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                // ✅ Obter driverId do socket (autenticado)
                const driverId = socket.userId || data.driverId || data.uid;

                logStructured('info', 'startTrip iniciado', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'startTrip'
                });

                const startTime = Date.now();
                const hotpathPath = 'start_trip';

                logStructured('info', 'Início de viagem recebido', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'startTrip'
                });

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('startTrip', data);

                if (!validation.valid) {
                    const metadata = getSocketMetadata(socket);
                    await auditService.logRideAction(driverId, 'startTrip', data.bookingId || null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('tripStartError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { bookingId, startLocation } = validation.sanitized;
                const paymentMockEnabled =
                    data?.mockPayment === true ||
                    data?.__mockPayment === true ||
                    String(process.env.MOCK_PAYMENT_FOR_TESTS || '').toLowerCase() === 'true';

                // ✅ Obter conexão Redis
                const redis = redisPool.getConnection();

                if (!driverId) {
                    socket.emit('tripStartError', { error: 'Motorista não autenticado' });
                    return;
                }

                const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                    driverId,
                    'startTrip',
                    bookingId
                );
                outerIdempotencyKey = idempotencyKey;

                const idempotencyCheck = await idempotencyService.beginRequest(idempotencyKey, {
                    joinWaitMs: Number.parseInt(
                        process.env.IDEMPOTENCY_START_TRIP_JOIN_WAIT_MS
                        || process.env.IDEMPOTENCY_JOIN_WAIT_MS
                        || '10000',
                        10
                    )
                });

                if (!idempotencyCheck.isNew) {
                    if (idempotencyCheck.cachedResult) {
                        socket.emit('tripStarted', idempotencyCheck.cachedResult);
                        metrics.recordHotpathReason(hotpathPath, 'duplicate_joined');
                        metrics.recordHotpathLatency(hotpathPath, Math.max(0, (Date.now() - startTime) / 1000), true);
                        return;
                    }

                    socket.emit('tripStartError', {
                        error: 'Requisição duplicada',
                        message: 'Esta ação já está sendo processada. Aguarde...',
                        code: 'DUPLICATE_REQUEST',
                        retryAfterSec: 1
                    });
                    metrics.recordHotpathReason(hotpathPath, 'duplicate_rejected');
                    metrics.recordHotpathLatency(hotpathPath, Math.max(0, (Date.now() - startTime) / 1000), false);
                    return;
                }
                outerIdempotencyOwner = true;

                const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'startTrip');

                if (!rateLimitCheck.allowed) {
                    socket.emit('tripStartError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        driverId,
                        eventType: 'startTrip',
                        limit: rateLimitCheck.limit
                    });
                    outerIdempotencyOwner = false;
                    await idempotencyService.releaseInflight(idempotencyKey);
                    return;
                }

                // ✅ VALIDAÇÃO CRÍTICA: Verificar se pagamento está confirmado
                // Primeiro tenta fast-path no Redis (booking hash), fallback para serviço externo.
                if (!paymentMockEnabled) {
                    try {
                        const normalizeStatus = (value) => String(value || '').trim().toLowerCase();
                        const parsePositiveAmount = (value) => {
                            const parsed = Number.parseFloat(value);
                            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
                        };
                        const validStatuses = new Set(['in_holding', 'confirmed', 'paid']);

                        let paymentStatus = null;
                        const bookingSnapshot = await redis.hgetall(`booking:${bookingId}`);
                        if (bookingSnapshot && Object.keys(bookingSnapshot).length > 0) {
                            const redisStatus = normalizeStatus(
                                bookingSnapshot.paymentStatus ||
                                bookingSnapshot.payment_status ||
                                bookingSnapshot.statusPagamento
                            );
                            if (validStatuses.has(redisStatus)) {
                                paymentStatus = {
                                    success: true,
                                    status: redisStatus,
                                    amount:
                                        parsePositiveAmount(bookingSnapshot.amount) ||
                                        parsePositiveAmount(bookingSnapshot.finalFare) ||
                                        parsePositiveAmount(bookingSnapshot.estimatedFare)
                                };
                            }
                        }

                        if (!paymentStatus) {
                            const PaymentService = require('../services/payment-service');
                            const paymentService = new PaymentService();
                            paymentStatus = await paymentService.getPaymentStatus(bookingId);
                        }

                        if (!paymentStatus?.success) {
                            const isNotFound = paymentStatus?.error && (
                                paymentStatus.error.includes('não encontrado') ||
                                paymentStatus.error.includes('not found') ||
                                paymentStatus.error.includes('não existe') ||
                                paymentStatus.status === null ||
                                paymentStatus.status === undefined
                            );

                            if (isNotFound) {
                                logStructured('warn', 'Tentativa de iniciar corrida sem pagamento', {
                                    driverId,
                                    bookingId,
                                    eventType: 'startTrip'
                                });

                                socket.emit('tripStartError', {
                                    error: 'Pagamento não encontrado',
                                    message: 'Nenhum pagamento foi encontrado para esta corrida. A corrida não pode ser iniciada sem pagamento confirmado.',
                                    code: 'PAYMENT_NOT_FOUND',
                                    paymentStatus: null
                                });
                                return;
                            }

                            logStructured('error', 'Erro ao verificar status do pagamento', {
                                driverId,
                                bookingId,
                                eventType: 'startTrip',
                                error: paymentStatus?.error || 'unknown_payment_validation_error'
                            });

                            socket.emit('tripStartError', {
                                error: 'Erro ao verificar pagamento',
                                message: 'Não foi possível verificar o status do pagamento. Tente novamente.',
                                code: 'PAYMENT_VERIFICATION_ERROR'
                            });
                            return;
                        }

                        const normalizedStatus = normalizeStatus(paymentStatus.status);
                        if (!normalizedStatus) {
                            logStructured('warn', 'Tentativa de iniciar corrida sem status de pagamento válido', {
                                driverId,
                                bookingId,
                                eventType: 'startTrip'
                            });

                            socket.emit('tripStartError', {
                                error: 'Pagamento não encontrado',
                                message: 'Nenhum pagamento foi encontrado para esta corrida. A corrida não pode ser iniciada sem pagamento confirmado.',
                                code: 'PAYMENT_NOT_FOUND',
                                paymentStatus: null
                            });
                            return;
                        }

                        if (!validStatuses.has(normalizedStatus)) {
                            logStructured('warn', 'Tentativa de iniciar corrida com pagamento em status inválido', {
                                driverId,
                                bookingId,
                                eventType: 'startTrip',
                                currentStatus: normalizedStatus,
                                requiredStatus: 'in_holding|confirmed|paid'
                            });

                            socket.emit('tripStartError', {
                                error: 'Pagamento não confirmado',
                                message: `A corrida só pode ser iniciada após confirmação do pagamento. Status atual: ${normalizedStatus}.`,
                                code: 'PAYMENT_NOT_CONFIRMED',
                                paymentStatus: normalizedStatus,
                                requiredStatus: 'in_holding|confirmed|paid',
                                amount: paymentStatus.amount || null
                            });
                            return;
                        }

                        if (paymentStatus.amount && Number(paymentStatus.amount) <= 0) {
                            logStructured('warn', 'Tentativa de iniciar corrida com valor de pagamento inválido', {
                                service: 'websocket',
                                operation: 'startTrip',
                                bookingId,
                                driverId,
                                amount: paymentStatus.amount
                            });

                            socket.emit('tripStartError', {
                                error: 'Valor de pagamento inválido',
                                message: 'O valor do pagamento é inválido. Entre em contato com o suporte.',
                                code: 'INVALID_PAYMENT_AMOUNT',
                                paymentStatus: normalizedStatus
                            });
                            return;
                        }

                        logStructured('info', 'Pagamento confirmado para corrida', {
                            service: 'websocket',
                            operation: 'startTrip',
                            bookingId,
                            driverId,
                            paymentStatus: normalizedStatus,
                            source: paymentStatus?.success ? 'redis_or_payment_service' : 'unknown',
                            amount: paymentStatus.amount || null
                        });
                    } catch (paymentCheckError) {
                        logStructured('error', 'Erro crítico ao verificar pagamento para corrida', {
                            service: 'websocket',
                            operation: 'startTrip',
                            bookingId,
                            driverId,
                            error: paymentCheckError.message,
                            stack: paymentCheckError.stack
                        });

                        socket.emit('tripStartError', {
                            error: 'Erro ao verificar pagamento',
                            message: 'Não foi possível verificar o status do pagamento. A corrida não pode ser iniciada por segurança.',
                            code: 'PAYMENT_VERIFICATION_CRITICAL_ERROR'
                        });
                        return;
                    }
                } else {
                    logStructured('warn', 'startTrip executado em modo mock de pagamento', {
                        bookingId,
                        driverId,
                        eventType: 'startTrip',
                        mockPayment: true
                    });
                }

                // ✅ REFATORAÇÃO: Usar StartTripCommand
                logStructured('info', 'Executando StartTripCommand', {
                    driverId,
                    bookingId,
                    eventType: 'startTrip'
                });

                // ✅ FASE 1.3: Criar span para Command
                const tracer = getTracer();
                const { trace: otelTrace } = require('@opentelemetry/api');
                const activeSpan = otelTrace.getActiveSpan();
                const correlationId = bookingId; // Usar bookingId como correlationId

                const commandSpan = createCommandSpan(tracer, 'start_trip', activeSpan, {
                    'command.driver_id': driverId,
                    'command.booking_id': bookingId,
                    'correlation.id': correlationId
                });

                // ✅ MÉTRICAS: Preparar para registrar viagem iniciada
                const commandStartTime = Date.now();

                let result;
                try {
                    const command = new StartTripCommand({
                        driverId,
                        bookingId,
                        startLocation,
                        traceId, // ✅ Passar traceId para o command
                        correlationId // ✅ Passar correlationId para o command
                    });

                    result = await runInSpan(commandSpan, async () => {
                        return await command.execute();
                    });

                    // ✅ MÉTRICAS: Registrar latência do command
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                } catch (error) {
                    endSpanError(commandSpan, error);
                    throw error;
                }

                const commandLatency = Date.now() - commandStartTime;

                // ✅ Log de command
                logCommand('StartTripCommand', result.success, commandLatency, {
                    driverId,
                    bookingId
                });

                if (!result.success) {
                    // Erro no command
                    logStructured('error', 'StartTripCommand falhou', {
                        driverId,
                        bookingId,
                        eventType: 'startTrip',
                        error: result.error
                    });
                    socket.emit('tripStartError', {
                        error: result.error || 'Erro ao iniciar viagem'
                    });
                    metrics.recordHotpathReason(hotpathPath, mapStartTripReason(result.error));
                    metrics.recordHotpathStageLatency(hotpathPath, 'command', Math.max(0, (Date.now() - commandStartTime) / 1000), false);
                    metrics.recordHotpathLatency(hotpathPath, Math.max(0, (Date.now() - startTime) / 1000), false);
                    if (outerIdempotencyOwner && outerIdempotencyKey) {
                        outerIdempotencyOwner = false;
                        await idempotencyService.releaseInflight(outerIdempotencyKey);
                    }
                    return;
                }

                // Command executado com sucesso
                const { bookingId: resultBookingId, driverId: resultDriverId, customerId, event, startLocation: resultStartLocation } = result.data;

                // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão iniciar timer)
                if (event) {
                    // ✅ FASE 1.3: Criar span para Event publish
                    const eventSpan = createEventSpan(tracer, 'ride.started', activeSpan, {
                        'event.booking_id': bookingId,
                        'correlation.id': correlationId
                    });

                    const eventStartTime = Date.now();
                    try {
                        await runInSpan(eventSpan, async () => {
                            await eventBus.publish({
                                eventType: 'ride.started',
                                data: event
                            });
                        });

                        // ✅ Salvar contexto do evento para linkar com listeners
                        const eventSpanContext = eventSpan.spanContext();
                        if (event.data) {
                            event.data._otelSpanContext = eventSpanContext;
                        }

                        const eventLatency = Date.now() - eventStartTime;
                        logEvent('ride.started', 'published', {
                            bookingId,
                            latency_ms: eventLatency
                        });
                    } catch (error) {
                        endSpanError(eventSpan, error);
                        throw error;
                    }
                }

                // ✅ NOVO: Marcar corrida como iniciada no Firestore
                try {
                    const ridePersistenceService = require('../services/ride-persistence-service');
                    await ridePersistenceService.markRideStarted(bookingId);

                    // ✅ NOVO: Atualizar estado em bookings:active e activeBookings
                    const bookingDataRaw = await redis.hgetall(`booking:${bookingId}`);
                    if (bookingDataRaw && Object.keys(bookingDataRaw).length > 0) {
                        const activeBookingData = {
                            ...bookingDataRaw,
                            status: 'IN_PROGRESS'
                        };

                        // Mapeamento para compatibilidade legada
                        try {
                            if (bookingDataRaw.pickupLocation) activeBookingData.pickup = JSON.parse(bookingDataRaw.pickupLocation);
                            if (bookingDataRaw.destinationLocation) activeBookingData.drop = JSON.parse(bookingDataRaw.destinationLocation);
                            if (bookingDataRaw.estimatedFare) activeBookingData.estimate = parseFloat(bookingDataRaw.estimatedFare);
                        } catch (e) {
                            // Erro silencioso no parse
                        }

                        const bookingDataStr = JSON.stringify(activeBookingData);
                        const flowDebugEnabled = process.env.DEBUG_RIDE_FLOW === 'true';
                        if (flowDebugEnabled) {
                            logStructured('debug', 'startTrip: persistindo booking ativo', {
                                service: 'startTrip',
                                bookingId
                            });
                        }

                        // Validar tipo de dado no Redis antes de inserir
                        const keyType = await redis.type('bookings:active');
                        if (keyType !== 'hash' && keyType !== 'none') {
                            logStructured('warn', 'startTrip: key bookings:active com tipo inválido, corrigindo', {
                                service: 'startTrip',
                                keyType
                            });
                            await redis.del('bookings:active');
                        }

                        await redis.hset('bookings:active', bookingId, bookingDataStr);
                        if (flowDebugEnabled) {
                            logStructured('debug', 'startTrip: booking ativo persistido', {
                                service: 'startTrip',
                                bookingId
                            });
                        }

                        await pricingH3ReadModelService.applyBookingSnapshot(redis, {
                            bookingId,
                            ...activeBookingData
                        }).catch(() => null);

                        if (io.activeBookings && io.activeBookings.has(bookingId)) {
                            io.activeBookings.set(bookingId, {
                                ...io.activeBookings.get(bookingId),
                                ...activeBookingData
                            });
                        }
                    }
                } catch (persistError) {
                    logStructured('error', 'Erro ao marcar corrida como iniciada no Firestore/Redis', {
                        bookingId,
                        eventType: 'startTrip',
                        error: persistError.message
                    });
                    // Não bloquear início da viagem se persistência falhar
                }

                // ✅ Padronizar uso de rooms para alta escalabilidade e confiabilidade
                const tripStartedData = {
                    success: true,
                    bookingId,
                    message: 'Viagem iniciada com sucesso',
                    startLocation: resultStartLocation,
                    timestamp: new Date().toISOString()
                };
                await idempotencyService.cacheResult(idempotencyKey, tripStartedData);
                outerIdempotencyOwner = false;

                // ✅ Notificar driver via room (escalável e confiável)
                io.to(`driver_${driverId}`).emit('tripStarted', tripStartedData);
                scheduleMapH3Refresh(io, {
                    reason: 'trip_started',
                    bookingId,
                    driverId
                });

                const totalLatency = Date.now() - startTime;
                metrics.recordHotpathStageLatency(hotpathPath, 'command', Math.max(0, (Date.now() - commandStartTime) / 1000), true);
                metrics.recordHotpathLatency(hotpathPath, Math.max(0, totalLatency / 1000), true);
                logStructured('info', 'startTrip concluído com sucesso', {
                    driverId,
                    bookingId,
                    eventType: 'startTrip',
                    latency_ms: totalLatency
                });

                // ✅ Buscar customerId do booking no Redis (para notificações adicionais se necessário)
                const bookingKey = `booking:${bookingId}`;
                const bookingDataRedis = await redis.hgetall(bookingKey);
                const customerIdToNotify = customerId || bookingDataRedis?.customerId || bookingDataRedis?.customer;

                // ✅ Debug: Log para verificar se customerId foi encontrado
                if (!customerIdToNotify) {
                    logStructured('warn', 'customerId não encontrado no Redis', {
                        bookingId,
                        eventType: 'startTrip'
                    });

                    // ✅ Fallback: Tentar buscar de activeBookings
                    const activeBooking = io.activeBookings?.get(bookingId);
                    if (activeBooking?.customerId) {
                        const fallbackCustomerId = activeBooking.customerId;
                        io.to(`customer_${fallbackCustomerId}`).emit('tripStarted', {
                            ...tripStartedData,
                            message: 'Viagem iniciada'
                        });
                        logStructured('info', 'customerId encontrado em activeBookings (fallback)', {
                            bookingId,
                            customerId: fallbackCustomerId,
                            eventType: 'startTrip'
                        });
                    } else {
                        logStructured('error', 'customerId não encontrado em nenhum lugar', {
                            bookingId,
                            eventType: 'startTrip'
                        });
                    }
                } else {
                    // ✅ Notificar customer via room (escalável e confiável)
                    io.to(`customer_${customerIdToNotify}`).emit('tripStarted', {
                        ...tripStartedData,
                        message: 'Viagem iniciada'
                    });
                    logStructured('info', 'tripStarted enviado para customer', {
                        bookingId,
                        customerId: customerIdToNotify,
                        eventType: 'startTrip'
                    });
                }

                // ✅ NOVO: Enviar notificação para motorista durante corrida
                try {
                    const destinationLocation = bookingDataRedis.destinationLocation ?
                        (typeof bookingDataRedis.destinationLocation === 'string' ? JSON.parse(bookingDataRedis.destinationLocation) : bookingDataRedis.destinationLocation)
                        : null;
                    const destinationAddress = destinationLocation?.address || destinationLocation?.add || 'destino';

                    // Buscar FCM token do motorista
                    const driverFcmToken = await redis.hget(`driver:${driverId}`, 'fcmToken');

                    if (driverFcmToken && destinationAddress) {
                        // Usar singleton
                        if (!fcmService.isServiceAvailable()) {
                            fcmService.setRedis(redisPool.getConnection());
                            await fcmService.initialize();
                        }

                        // Calcular estimativa de chegada (aproximada usando fórmula de Haversine)
                        let estimatedArrival = 'calculando...';
                        if (startLocation && destinationLocation && startLocation.lat && startLocation.lng && destinationLocation.lat && destinationLocation.lng) {
                            // Fórmula de Haversine para calcular distância
                            const R = 6371; // Raio da Terra em km
                            const dLat = (destinationLocation.lat - startLocation.lat) * Math.PI / 180;
                            const dLon = (destinationLocation.lng - startLocation.lng) * Math.PI / 180;
                            const a =
                                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                                Math.cos(startLocation.lat * Math.PI / 180) * Math.cos(destinationLocation.lat * Math.PI / 180) *
                                Math.sin(dLon / 2) * Math.sin(dLon / 2);
                            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                            const distanceKm = R * c;

                            // Velocidade média: 35 km/h = ~0.583 km/min
                            const speedKmPerMin = 0.583;
                            const estimatedMinutes = Math.max(1, Math.round(distanceKm / speedKmPerMin));
                            estimatedArrival = `${estimatedMinutes} ${estimatedMinutes === 1 ? 'minuto' : 'minutos'}`;
                        }

                        // Enviar notificação durante corrida
                        await fcmService.sendInteractiveNotification(
                            driverFcmToken,
                            {
                                title: '🚗 A caminho do destino',
                                body: `A caminho de ${destinationAddress} • Chegada em ${estimatedArrival}`,
                                data: {
                                    type: 'trip_in_progress',
                                    bookingId: bookingId,
                                    driverId: driverId,
                                    destinationAddress: destinationAddress,
                                    estimatedArrival: estimatedArrival,
                                    hasActions: 'true'
                                },
                                channelId: 'driver_actions',
                                badge: 1
                            },
                            [
                                {
                                    id: 'end_trip',
                                    title: 'Encerrar corrida',
                                    icon: 'ic_stop'
                                }
                            ],
                            'TRIP_IN_PROGRESS' // Nova categoria para corrida em andamento
                        );

                        logStructured('info', 'Notificação durante corrida enviada para motorista', {
                            service: 'server',
                            driverId,
                            bookingId: data?.bookingId,
                            eventType: 'startTrip',
                            notificationType: 'TRIP_IN_PROGRESS'
                        });
                    }
                } catch (notifError) {
                    logStructured('error', 'Erro ao enviar notificação durante corrida', {
                        service: 'websocket',
                        operation: 'startTrip',
                        driverId,
                        bookingId,
                        error: notifError.message,
                        stack: notifError.stack
                    });
                    // Não falhar o fluxo se a notificação falhar
                }

            } catch (error) {
                if (outerIdempotencyOwner && outerIdempotencyKey) {
                    outerIdempotencyOwner = false;
                    await idempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                }
                logStructured('error', 'Erro ao iniciar viagem', {
                    service: 'websocket',
                    operation: 'startTrip',
                    driverId,
                    bookingId: data.bookingId,
                    error: error.message,
                    stack: error.stack
                });
                metrics.recordHotpathReason('start_trip', 'unexpected_error');
                socket.emit('tripStartError', { error: 'Erro ao iniciar viagem' });
            }
        }); // Fecha traceContext.runWithTraceId
    });
}

module.exports = registerSocketStartTripHandler;
