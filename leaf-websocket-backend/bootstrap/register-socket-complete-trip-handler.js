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
    socket.on('completeTrip', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
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
                const redis = redisPool.getConnection();
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
                    metrics.recordCommand('complete_trip', commandLatency, result.success);
                } catch (error) {
                    endSpanError(commandSpan, error);
                    const commandLatency = (Date.now() - commandStartTime) / 1000;
                    metrics.recordCommand('complete_trip', commandLatency, false);
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
                    socket.emit('tripCompleteError', {
                        error: result.error || 'Erro ao finalizar viagem'
                    });
                    return;
                }

                // Command executado com sucesso (já processou pagamento e atualizou estado)
                const { bookingId: resultBookingId, driverId: resultDriverId, customerId, event, endLocation: resultEndLocation, finalFare, distance: resultDistance, duration: resultDuration, paymentDistribution } = result.data;

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

                const finalRideSnapshot = {
                    fare: fare,
                    netFare: null,
                    distance: distance,
                    duration: null,
                    endLocation: endLocation,
                    driverEarnings: null,
                    financialBreakdown: null
                };

                // ✅ NOVO: Processar distribuição de pagamento líquido para o motorista
                // Em modo mock de testes, evitar dependência de integrações externas.
                if (paymentMockEnabled) {
                    const mockedFare = parseFloat(fare) || 0;
                    const mockedNetAmount = Math.max(0, Math.round(mockedFare * 100));

                    finalRideSnapshot.netFare = mockedFare;
                    finalRideSnapshot.driverEarnings = mockedFare;
                    finalRideSnapshot.financialBreakdown = {
                        mode: 'mock',
                        grossAmount: mockedNetAmount,
                        netAmount: mockedNetAmount,
                        retainedFees: 0
                    };

                    logStructured('warn', 'completeTrip executado em modo mock de distribuição de pagamento', {
                        bookingId,
                        driverId,
                        eventType: 'completeTrip',
                        mockPayment: true
                    });

                    socket.emit('paymentDistributed', {
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
                    try {
                        const PaymentService = require('../services/payment-service');
                        const paymentService = new PaymentService();

                        // Buscar dados do booking para obter informações do motorista e pagamento
                        const bookingData = io.activeBookings?.get(bookingId);

                        if (bookingData && fare) {
                            // ✅ Buscar wooviAccountId do motorista (do booking ou do banco de dados)
                            let wooviAccountId = bookingData.driverWooviAccountId || bookingData.wooviAccountId;
                            let wooviClientId = bookingData.driverWooviClientId || bookingData.wooviClientId;

                            // Se não encontrou no booking, buscar do banco de dados
                            if (!wooviAccountId && driverId) {
                                try {
                                    const DriverApprovalService = require('../services/driver-approval-service');
                                    const driverApprovalService = new DriverApprovalService();
                                    const accountData = await driverApprovalService.getDriverWooviAccountId(driverId);

                                    if (accountData) {
                                        wooviAccountId = accountData.wooviAccountId;
                                        wooviClientId = accountData.wooviClientId;
                                        logStructured('info', 'wooviAccountId encontrado do banco de dados', {
                                            driverId,
                                            bookingId,
                                            eventType: 'completeTrip'
                                        });
                                    } else {
                                        logStructured('warn', 'wooviAccountId não encontrado', {
                                            driverId,
                                            bookingId,
                                            eventType: 'completeTrip'
                                        });
                                    }
                                } catch (accountError) {
                                    logStructured('error', 'Erro ao buscar wooviAccountId do banco', {
                                        driverId,
                                        bookingId,
                                        eventType: 'completeTrip',
                                        error: accountError.message
                                    });
                                }
                            }

                            // ✅ MVP: Sempre processar distribuição (usa saldo no Firestore)
                            // Converter fare para centavos
                            const fareInCents = Math.round(parseFloat(fare) * 100);

                            logStructured('info', 'Processando distribuição de pagamento', {
                                bookingId,
                                driverId,
                                fare: fareInCents,
                                eventType: 'completeTrip'
                            });

                            const distributionResult = await paymentService.processNetDistribution({
                                rideId: bookingId,
                                driverId: driverId, // ✅ Sempre disponível - usado para creditar saldo
                                wooviAccountId: wooviAccountId, // Opcional (para BaaS futuro)
                                wooviClientId: wooviClientId, // Opcional (para BaaS futuro)
                                totalAmount: fareInCents
                            });

                            if (distributionResult.success) {
                                finalRideSnapshot.netFare = distributionResult.netAmount ? (distributionResult.netAmount / 100) : null;
                                finalRideSnapshot.driverEarnings = distributionResult.netAmount ? (distributionResult.netAmount / 100) : null;
                                finalRideSnapshot.financialBreakdown = distributionResult.calculation || null;

                                logStructured('info', 'Pagamento distribuído com sucesso', {
                                    bookingId,
                                    driverId,
                                    netAmount: distributionResult.netAmount,
                                    eventType: 'completeTrip'
                                });

                                // Notificar motorista sobre o pagamento
                                socket.emit('paymentDistributed', {
                                    success: true,
                                    bookingId,
                                    netAmount: distributionResult.netAmount,
                                    netAmountInReais: (distributionResult.netAmount / 100).toFixed(2),
                                    transferId: distributionResult.transferId || null,
                                    balanceCreditId: distributionResult.balanceCreditId || driverId,
                                    retainedFees: distributionResult.retainedFees,
                                    message: 'Saldo creditado com sucesso'
                                });
                            } else {
                                logStructured('error', 'Erro ao distribuir pagamento', {
                                    bookingId,
                                    driverId,
                                    eventType: 'completeTrip',
                                    error: distributionResult.error
                                });
                                // Não bloquear finalização da viagem se distribuição falhar
                                // Mas logar o erro para investigação
                                socket.emit('paymentDistributed', {
                                    success: false,
                                    bookingId,
                                    error: distributionResult.error
                                });
                            }
                        } else {
                            logStructured('warn', 'Dados do booking ou fare não disponíveis', {
                                bookingId,
                                eventType: 'completeTrip'
                            });
                        }
                    } catch (paymentError) {
                        logStructured('error', 'Erro ao processar distribuição de pagamento', {
                            bookingId,
                            driverId,
                            eventType: 'completeTrip',
                            error: paymentError.message
                        });
                        // Não bloquear finalização da viagem se distribuição falhar
                    }
                }

                // Persistencia garantida: tenta Firestore primeiro e usa outbox se indisponivel.
                const ridePersistenceService = require('../services/ride-persistence-service');
                const persistFinalResult = await ridePersistenceService.persistFinalRideDataWithOutbox(
                    bookingId,
                    finalRideSnapshot
                );

                if (!persistFinalResult.success) {
                    logStructured('error', 'Falha ao persistir finalizacao da corrida', {
                        bookingId,
                        eventType: 'completeTrip',
                        error: persistFinalResult.error || 'persist_final_failed'
                    });
                    socket.emit('tripCompleteError', {
                        error: 'Falha ao persistir finalização da corrida. Tente novamente.',
                        code: 'FINAL_PERSISTENCE_FAILED',
                        retryAfterSec: 2
                    });
                    return;
                }

                if (persistFinalResult.deferred) {
                    logStructured('warn', 'Finalizacao enfileirada em outbox para retry', {
                        bookingId,
                        eventType: 'completeTrip'
                    });
                }

                // ✅ Gerar e salvar recibo da corrida em background
                setImmediate(async () => {
                    try {
                        const ReceiptService = require('../services/receipt-service');
                        const receiptService = new ReceiptService();

                        // Buscar dados completos da corrida
                        const bookingDataForReceipt = io.activeBookings?.get(bookingId);
                        if (bookingDataForReceipt) {
                            const receiptData = {
                                ...bookingDataForReceipt,
                                finalPrice: fare,
                                distance: distance,
                                endTime: new Date().toISOString(),
                                completedAt: new Date().toISOString(),
                                status: 'COMPLETED'
                            };

                            // Gerar e salvar recibo
                            const firebaseDb = firebaseConfig?.getRealtimeDB?.();
                            await receiptService.generateAndSaveReceipt(bookingId, receiptData, firebaseDb);
                            logStructured('info', 'Recibo gerado e salvo', {
                                bookingId,
                                eventType: 'completeTrip'
                            });
                        }
                    } catch (receiptError) {
                        logStructured('warn', 'Erro ao gerar recibo', {
                            bookingId,
                            eventType: 'completeTrip',
                            error: receiptError.message
                        });
                        // Não bloquear finalização se recibo falhar
                    }
                });

                // Emitir confirmação para o driver
                // ✅ Padronizar uso de rooms para alta escalabilidade
                const tripCompletedData = {
                    success: true,
                    bookingId,
                    message: 'Viagem finalizada com sucesso',
                    endLocation,
                    distance,
                    fare,
                    persistence: persistFinalResult.deferred ? 'deferred_outbox' : 'confirmed_firestore',
                    timestamp: new Date().toISOString()
                };

                // ✅ Notificar driver via room (escalável e confiável)
                io.to(`driver_${driverId}`).emit('tripCompleted', tripCompletedData);

                // ✅ Buscar customerId do booking para notificar o customer correto via room
                const bookingKey = `booking:${bookingId}`;
                const bookingDataRedis = await redis.hgetall(bookingKey);
                const customerIdToNotify = bookingDataRedis?.customerId || bookingDataRedis?.customer ||
                    io.activeBookings?.get(bookingId)?.customerId;

                // ✅ Notificar customer via room (escalável e confiável)
                if (customerIdToNotify) {
                    io.to(`customer_${customerIdToNotify}`).emit('tripCompleted', {
                        ...tripCompletedData,
                        message: 'Viagem finalizada'
                    });
                    logStructured('info', 'tripCompleted enviado para customer', {
                        bookingId,
                        customerId: customerIdToNotify,
                        eventType: 'completeTrip'
                    });
                } else {
                    logStructured('warn', 'CustomerId não encontrado', {
                        bookingId,
                        eventType: 'completeTrip'
                    });
                }

                // ✅ NOVO: Atualizar Live Activity/Foreground Service (Silent Push)
                try {
                    const payloadData = {
                        bookingId: bookingId,
                        status: 'completed',
                        distance: String(distance || '0'),
                        fare: String(fare || '0')
                    };

                    if (customerIdToNotify) {
                        await fcmService.sendRideStatusUpdate(customerIdToNotify, { ...payloadData, userType: 'customer' });
                    }
                    await fcmService.sendRideStatusUpdate(driverId, { ...payloadData, userType: 'driver' });
                } catch (silentPushError) {
                    logStructured('error', 'Erro ao enviar silent push em completeTrip', { error: silentPushError.message });
                }

                // ✅ NOVO: Limpar activeBookings (Memória)
                if (io.activeBookings) {
                    io.activeBookings.delete(bookingId);
                }

            } catch (error) {
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
