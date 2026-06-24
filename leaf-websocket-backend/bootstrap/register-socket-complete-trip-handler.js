function registerSocketCompleteTripHandler({
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
    getTracer,
    createCommandSpan,
    runInSpan,
    endSpanError,
    logCommand,
    CompleteTripCommand,
    createEventSpan,
    eventBus,
    logEvent,
    fcmService
}) {
    const { buildTripCompletedPayload } = require('../utils/trip-completion-payload');
    const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
    const {
        hasRideOfflineIntentPayload,
        markRideOfflineIntentProcessed,
        markRideOfflineIntentRejected,
        validateAndReserveRideOfflineIntent
    } = require('../services/ride-offline-intent-validator');
    const rideIdempotencyService = idempotencyService || require('../services/idempotency-service');
    const {
        recordDriverDestinationDailyRideCompletion
    } = require('../services/driver-destination-mode-service');

    socket.on('completeTrip', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        let outerIdempotencyKey = null;
        let outerIdempotencyOwner = false;
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                const driverId = socket.userId || socket.id;

                logStructured('info', 'completeTrip iniciado', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'completeTrip'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting
                const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'finishTrip');

                if (!rateLimitCheck.allowed) {
                    socket.emit('tripCompleteError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        driverId,
                        eventType: 'completeTrip',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Finalização de viagem recebida', {
                    driverId,
                    bookingId: data.bookingId,
                    eventType: 'completeTrip'
                });

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('finishTrip', data);

                if (!validation.valid) {
                    const metadata = getSocketMetadata(socket);
                    await auditService.logRideAction(driverId, 'finishTrip', data.bookingId || null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('tripCompleteError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { bookingId, endLocation, distance, fare } = validation.sanitized;
                const idempotencyKey = data.idempotencyKey || rideIdempotencyService.generateKey(
                    driverId,
                    'completeTrip',
                    bookingId
                );
                outerIdempotencyKey = idempotencyKey;

                const idempotencyCheck = await rideIdempotencyService.beginRequest(idempotencyKey, {
                    joinWaitMs: Number.parseInt(
                        process.env.IDEMPOTENCY_COMPLETE_TRIP_JOIN_WAIT_MS
                        || process.env.IDEMPOTENCY_JOIN_WAIT_MS
                        || '10000',
                        10
                    )
                });

                if (!idempotencyCheck.isNew) {
                    if (idempotencyCheck.cachedResult) {
                        socket.emit('tripCompleted', idempotencyCheck.cachedResult);
                        return;
                    }

                    socket.emit('tripCompleteError', {
                        error: 'Requisição duplicada',
                        message: 'Esta ação já está sendo processada. Aguarde...',
                        code: 'DUPLICATE_REQUEST',
                        retryAfterSec: 1
                    });
                    return;
                }
                outerIdempotencyOwner = true;
                const redis = redisPool.getConnection();
                let offlineIntentValidation = null;

                if (hasRideOfflineIntentPayload(data)) {
                    offlineIntentValidation = await validateAndReserveRideOfflineIntent({
                        redis,
                        bookingId,
                        actorId: driverId,
                        role: 'driver',
                        eventType: 'complete_trip',
                        idempotencyKey,
                        clientSequence: data.clientSequence,
                        clientCreatedAt: data.clientCreatedAt,
                        payload: {
                            endLocation,
                            distance,
                            fare
                        },
                        data
                    });

                    if (!offlineIntentValidation.accepted) {
                        socket.emit('tripCompleteError', {
                            error: offlineIntentValidation.message || 'Intencao offline rejeitada',
                            message: offlineIntentValidation.message || 'O backend rejeitou esta acao offline.',
                            code: offlineIntentValidation.code || 'OFFLINE_INTENT_REJECTED'
                        });
                        outerIdempotencyOwner = false;
                        await rideIdempotencyService.releaseInflight(idempotencyKey);
                        return;
                    }

                    if (offlineIntentValidation.replay && offlineIntentValidation.cachedResult) {
                        await rideIdempotencyService.cacheResult(idempotencyKey, offlineIntentValidation.cachedResult);
                        outerIdempotencyOwner = false;
                        socket.emit('tripCompleted', offlineIntentValidation.cachedResult);
                        return;
                    }
                }

                const paymentMockEnabled =
                    data?.mockPayment === true ||
                    data?.__mockPayment === true ||
                    String(process.env.MOCK_PAYMENT_FOR_TESTS || '').toLowerCase() === 'true';

                // ✅ REFATORAÇÃO: Usar CompleteTripCommand
                logStructured('info', 'Executando CompleteTripCommand', {
                    driverId,
                    bookingId,
                    eventType: 'completeTrip'
                });

                // Calcular duração se necessário (pode ser obtido do timer iniciado pelo listener)
                const timerKey = `trip_timer:${bookingId}`;
                const timerData = await redis.hgetall(timerKey);
                const duration = timerData.startTimestamp ?
                    Math.floor((Date.now() - parseInt(timerData.startTimestamp)) / 1000) : 0;

                // ✅ FASE 1.3: Criar span para Command
                const tracer = getTracer();
                const { trace: otelTrace } = require('@opentelemetry/api');
                const activeSpan = otelTrace.getActiveSpan();
                const correlationId = bookingId; // Usar bookingId como correlationId

                const commandSpan = createCommandSpan(tracer, 'complete_trip', activeSpan, {
                    'command.driver_id': driverId,
                    'command.booking_id': bookingId,
                    'correlation.id': correlationId
                });

                // ✅ MÉTRICAS: Preparar para registrar viagem finalizada
                const { metrics } = require('../utils/prometheus-metrics');
                const commandStartTime = Date.now();

                let result;
                try {
                    const command = new CompleteTripCommand({
                        driverId,
                        bookingId,
                        endLocation,
                        finalFare: parseFloat(fare) || 0,
                        distance: parseFloat(distance) || 0,
                        duration: duration,
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
                logCommand('CompleteTripCommand', result.success, commandLatency, {
                    driverId,
                    bookingId
                });

                if (!result.success) {
                    // Erro no command
                    logStructured('error', 'CompleteTripCommand falhou', {
                        driverId,
                        bookingId,
                        eventType: 'completeTrip',
                        error: result.error
                    });
                    if (outerIdempotencyOwner && outerIdempotencyKey) {
                        outerIdempotencyOwner = false;
                        await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                    }
                    if (offlineIntentValidation && !offlineIntentValidation.skipped) {
                        await markRideOfflineIntentRejected({
                            redis,
                            bookingId,
                            idempotencyKey,
                            error: result.error || 'Erro ao finalizar viagem',
                            code: 'COMPLETE_TRIP_COMMAND_FAILED'
                        }).catch(() => null);
                    }
                    socket.emit('tripCompleteError', {
                        error: result.error || 'Erro ao finalizar viagem'
                    });
                    return;
                }

                // Command executado com sucesso (já processou pagamento e atualizou estado)
                const {
                    bookingId: resultBookingId,
                    driverId: resultDriverId,
                    customerId,
                    city = 'unknown',
                    serviceType = 'standard',
                    event,
                    endLocation: resultEndLocation,
                    finalFare,
                    tollFee: resultTollFee,
                    distance: resultDistance,
                    duration: resultDuration,
                    paymentDistribution
                } = result.data;

                const PaymentService = require('../services/payment-service');
                const paymentService = new PaymentService();
                const fareReais = Number(finalFare || fare || 0);
                const tollFeeReais = Number(resultTollFee || 0);
                const calculatedFareBreakdown = paymentService.calculateFareBreakdownFromReais(fareReais, tollFeeReais);
                const fareBreakdown = {
                    ...calculatedFareBreakdown,
                    ...(Number.isFinite(Number(result.data?.operationalFee))
                        ? { operationalFee: Number(result.data.operationalFee) }
                        : {}),
                    ...(Number.isFinite(Number(result.data?.paymentIntermediationFee))
                        ? { paymentIntermediationFee: Number(result.data.paymentIntermediationFee) }
                        : {}),
                    ...(Number.isFinite(Number(result.data?.totalFees))
                        ? { totalFees: Number(result.data.totalFees) }
                        : {}),
                    ...(Number.isFinite(Number(result.data?.driverNetAmount))
                        ? { driverNetAmount: Number(result.data.driverNetAmount) }
                        : {}),
                    authoritativeSnapshot: result.data?.authoritativeSnapshot === true,
                    financialSnapshotSource: result.data?.financialSnapshotSource || 'backend_final',
                    financialSnapshot: result.data?.financialSnapshot || null
                };

                metrics.recordRideCompleted(city, serviceType || 'standard');
                if (Number.isFinite(Number(resultDuration)) && Number(resultDuration) >= 0) {
                    metrics.recordRideTotalDuration(Number(resultDuration), city);
                }

                try {
                    await recordDriverDestinationDailyRideCompletion({
                        redis,
                        driverId: resultDriverId || driverId,
                        bookingId: resultBookingId || bookingId,
                        now: new Date()
                    });
                } catch (destinationPolicyError) {
                    logStructured('warn', 'Falha ao atualizar contador diário de destino do motorista', {
                        bookingId,
                        driverId: resultDriverId || driverId,
                        eventType: 'completeTrip',
                        error: destinationPolicyError.message
                    });
                }

                // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão processar notificações)
                if (event) {
                    // ✅ FASE 1.3: Criar span para Event publish
                    const eventSpan = createEventSpan(tracer, 'ride.completed', activeSpan, {
                        'event.booking_id': bookingId,
                        'correlation.id': correlationId
                    });

                    const eventStartTime = Date.now();
                    try {
                        await runInSpan(eventSpan, async () => {
                            await eventBus.publish({
                                eventType: 'ride.completed',
                                data: event
                            });
                        });

                        // ✅ Salvar contexto do evento para linkar com listeners
                        const eventSpanContext = eventSpan.spanContext();
                        if (event.data) {
                            event.data._otelSpanContext = eventSpanContext;
                        }

                        const eventLatency = Date.now() - eventStartTime;
                        logEvent('ride.completed', 'published', {
                            bookingId,
                            latency_ms: eventLatency
                        });
                    } catch (error) {
                        endSpanError(eventSpan, error);
                        throw error;
                    }
                }

                // Emitir confirmação imediatamente para reduzir latência no caminho crítico
                const bookingSnapshot = await redis.hgetall(`booking:${bookingId}`);
                const tripCompletedData = buildTripCompletedPayload({
                    bookingId,
                    bookingData: bookingSnapshot,
                    resultEndLocation,
                    endLocation,
                    distance: resultDistance || distance,
                    duration: resultDuration,
                    fareBreakdown,
                    paymentDistribution,
                    rideLegs: bookingSnapshot?.rideLegs ? JSON.parse(bookingSnapshot.rideLegs) : null,
                    operationalContinuation: bookingSnapshot?.operationalContinuation
                        ? JSON.parse(bookingSnapshot.operationalContinuation)
                        : null,
                    persistence: 'accepted_background'
                });
                await rideIdempotencyService.cacheResult(idempotencyKey, tripCompletedData);
                if (offlineIntentValidation && !offlineIntentValidation.skipped) {
                    await markRideOfflineIntentProcessed({
                        redis,
                        bookingId,
                        idempotencyKey,
                        result: tripCompletedData
                    }).catch(() => null);
                }
                outerIdempotencyOwner = false;

                io.to(`driver_${driverId}`).emit('tripCompleted', tripCompletedData);
                scheduleMapH3Refresh(io, {
                    reason: 'trip_completed',
                    bookingId,
                    driverId
                });

                let customerIdToNotify = customerId || io.activeBookings?.get(bookingId)?.customerId || null;
                if (!customerIdToNotify) {
                    const bookingDataRedis = await redis.hgetall(`booking:${bookingId}`);
                    customerIdToNotify = bookingDataRedis?.customerId || bookingDataRedis?.customer || null;
                }

                if (customerIdToNotify) {
                    io.to(`customer_${customerIdToNotify}`).emit('tripCompleted', {
                        ...tripCompletedData,
                        message: 'Viagem finalizada'
                    });
                } else {
                    logStructured('warn', 'CustomerId não encontrado para tripCompleted', {
                        bookingId,
                        eventType: 'completeTrip'
                    });
                }

                // Pós-processamento assíncrono para não bloquear ack da finalização
                setImmediate(async () => {
                    try {
                        const finalRideSnapshot = {
                            fare: finalFare || fare,
                            tollFee: tollFeeReais,
                            netFare: null,
                            distance: resultDistance || distance,
                            duration: resultDuration || duration || null,
                            endLocation: resultEndLocation || endLocation,
                            driverEarnings: null,
                            fareBreakdown,
                            financialBreakdown: paymentDistribution || null,
                            authoritativeSnapshot: result.data?.authoritativeSnapshot === true,
                            financialSnapshotSource: result.data?.financialSnapshotSource || 'backend_final',
                            financialSnapshot: result.data?.financialSnapshot || null
                        };

                        if (paymentMockEnabled) {
                            const mockedFare = parseFloat(finalFare || fare) || 0;
                            const mockedNetAmount = Math.max(0, Math.round(mockedFare * 100));
                            finalRideSnapshot.netFare = mockedFare;
                            finalRideSnapshot.driverEarnings = mockedFare;
                            finalRideSnapshot.financialBreakdown = {
                                mode: 'mock',
                                grossAmount: mockedNetAmount,
                                netAmount: mockedNetAmount,
                                retainedFees: 0
                            };

                            io.to(`driver_${driverId}`).emit('paymentDistributed', {
                                success: true,
                                bookingId,
                                netAmount: mockedNetAmount,
                                netAmountInReais: mockedFare.toFixed(2),
                                transferId: null,
                                balanceCreditId: driverId,
                                retainedFees: 0,
                                mockPayment: true,
                                message: 'Distribuição mock aplicada para testes'
                            });
                        } else {
                            io.to(`driver_${driverId}`).emit('paymentDistributed', {
                                success: true,
                                bookingId,
                                pending: true,
                                message: 'Distribuição financeira em processamento assíncrono'
                            });
                        }

                        const ridePersistenceService = require('../services/ride-persistence-service');
                        const persistFinalResult = await ridePersistenceService.persistFinalRideDataWithOutbox(
                            bookingId,
                            finalRideSnapshot
                        );

                        if (!persistFinalResult.success) {
                            logStructured('error', 'Falha ao persistir finalizacao da corrida (background)', {
                                bookingId,
                                eventType: 'completeTrip',
                                error: persistFinalResult.error || 'persist_final_failed'
                            });
                        } else if (persistFinalResult.deferred) {
                            logStructured('warn', 'Finalizacao enfileirada em outbox para retry', {
                                bookingId,
                                eventType: 'completeTrip'
                            });
                        }

                        try {
                            const ReceiptService = require('../services/receipt-service');
                            const firebaseConfig = require('../firebase-config');
                            const receiptService = new ReceiptService();
                            const bookingDataForReceipt = {
                                ...(io.activeBookings?.get(bookingId) || {}),
                                ...(bookingSnapshot || {})
                            };
                            const completionTimestamp = new Date().toISOString();
                            const receiptData = {
                                ...bookingDataForReceipt,
                                bookingId,
                                driverId: resultDriverId || driverId || bookingDataForReceipt.driverId,
                                customerId: customerIdToNotify || customerId || bookingDataForReceipt.customerId,
                                finalPrice: finalFare || fare,
                                finalFare: finalFare || fare,
                                grossAmount: fareBreakdown.grossAmount,
                                operationalFee: fareBreakdown.operationalFee,
                                paymentIntermediationFee: fareBreakdown.paymentIntermediationFee,
                                totalFees: fareBreakdown.totalFees,
                                driverNetAmount: fareBreakdown.driverNetAmount,
                                tollFee: fareBreakdown.tollFee,
                                fareBreakdown,
                                financialBreakdown: paymentDistribution || bookingDataForReceipt.financialBreakdown || null,
                                paymentDistribution,
                                financialSnapshot: result.data?.financialSnapshot || bookingDataForReceipt.financialSnapshot || null,
                                financialSnapshotSource: result.data?.financialSnapshotSource || 'backend_final',
                                authoritativeSnapshot: result.data?.authoritativeSnapshot === true,
                                distance: resultDistance || distance,
                                duration: resultDuration || duration || null,
                                endLocation: resultEndLocation || endLocation,
                                endTime: completionTimestamp,
                                completedAt: completionTimestamp,
                                status: 'COMPLETED'
                            };
                            const firebaseDb = firebaseConfig?.getRealtimeDB?.();
                            await receiptService.generateAndSaveReceipt(bookingId, receiptData, firebaseDb);
                        } catch (receiptError) {
                            logStructured('warn', 'Erro ao gerar recibo', {
                                bookingId,
                                eventType: 'completeTrip',
                                error: receiptError.message
                            });
                        }

                        try {
                            const payloadData = {
                                bookingId: bookingId,
                                status: 'completed',
                                distance: String(resultDistance || distance || '0'),
                                fare: String(finalFare || fare || '0')
                            };

                            if (customerIdToNotify) {
                                await fcmService.sendRideStatusUpdate(customerIdToNotify, { ...payloadData, userType: 'customer' });
                            }
                            await fcmService.sendRideStatusUpdate(driverId, { ...payloadData, userType: 'driver' });
                        } catch (silentPushError) {
                            logStructured('error', 'Erro ao enviar silent push em completeTrip', { error: silentPushError.message });
                        }
                    } catch (backgroundError) {
                        logStructured('error', 'Erro no pós-processamento assíncrono do completeTrip', {
                            bookingId,
                            driverId,
                            eventType: 'completeTrip',
                            error: backgroundError.message
                        });
                    } finally {
                        if (io.activeBookings) {
                            io.activeBookings.delete(bookingId);
                        }
                    }
                });

            } catch (error) {
                if (outerIdempotencyOwner && outerIdempotencyKey) {
                    outerIdempotencyOwner = false;
                    await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                }
                logStructured('error', 'Erro ao finalizar viagem', {
                    service: 'websocket',
                    operation: 'completeTrip',
                    userId: socket.userId || socket.id,
                    error: error.message
                });
                socket.emit('tripCompleteError', { error: 'Erro ao finalizar viagem' });
            }
        }); // Fecha traceContext.runWithTraceId
    });
}

module.exports = registerSocketCompleteTripHandler;
