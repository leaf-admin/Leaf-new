function registerSocketConfirmPaymentHandler({
    socket,
    io,
    extractTraceIdFromEvent,
    traceContext,
    logStructured,
    rateLimiterService,
    getSocketMetadata,
    auditService,
    validationService,
    redisPool,
    parseBookingLocation,
    findAvailableDriversForPickup,
    idempotencyService
}) {
    socket.on('confirmPayment', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                logStructured('info', 'confirmPayment iniciado', {
                    userId: socket.userId || data.customerId || socket.id,
                    eventType: 'confirmPayment'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting
                const userId = socket.userId || data.customerId || socket.id;
                const metadata = getSocketMetadata(socket);
                const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'confirmPayment', {
                    ip: metadata.ip
                });

                if (!rateLimitCheck.allowed) {
                    // ✅ NOVO: Log de auditoria para rate limit excedido
                    await auditService.logSecurityAction(userId, 'rateLimitExceeded', 'confirmPayment', {
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    }, metadata);

                    socket.emit('paymentError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        userId,
                        eventType: 'confirmPayment',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Confirmação de pagamento recebida', {
                    userId,
                    bookingId: data.bookingId,
                    eventType: 'confirmPayment'
                });

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('confirmPayment', data);

                if (!validation.valid) {
                    await auditService.logPaymentAction(userId, 'confirmPayment', data.bookingId || null, null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('paymentError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { bookingId, paymentMethod, paymentId, amount } = validation.sanitized;
                const paymentMockEnabled =
                    data?.mockPayment === true ||
                    data?.__mockPayment === true ||
                    String(process.env.MOCK_PAYMENT_FOR_TESTS || '').toLowerCase() === 'true';

                // Guarda de negócio: só confirma pagamento se houver motorista elegível no momento.
                let bookingPickupLocation = null;
                let bookingCarType = null;
                try {
                    const redis = redisPool.getConnection();
                    const bookingData = await redis.hgetall(`booking:${bookingId}`);
                    bookingPickupLocation = parseBookingLocation(bookingData?.pickupLocation);
                    bookingCarType = bookingData?.carType || null;
                } catch (bookingLookupError) {
                    logStructured('warn', 'confirmPayment: erro ao buscar booking para validação de disponibilidade', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: bookingLookupError.message
                    });
                }

                const payloadPickupLocation = data?.pickupLocation;
                const pickupLocationToValidate = bookingPickupLocation || payloadPickupLocation;

                const skipAvailabilityCheck =
                    String(process.env.CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK || 'true').toLowerCase() === 'true';

                if (!paymentMockEnabled && !skipAvailabilityCheck && pickupLocationToValidate?.lat && pickupLocationToValidate?.lng) {
                    try {
                        const availabilityTimeoutMs = Number.parseInt(
                            process.env.CONFIRM_PAYMENT_AVAILABILITY_TIMEOUT_MS || '800',
                            10
                        );
                        const availability = await Promise.race([
                            findAvailableDriversForPickup(pickupLocationToValidate, {
                                carType: bookingCarType
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('availability_check_timeout')), availabilityTimeoutMs))
                        ]);

                        if (!availability.success) {
                            logStructured('warn', 'confirmPayment: falha no pre-check de disponibilidade, seguindo fluxo', {
                                bookingId,
                                eventType: 'confirmPayment',
                                code: 'AVAILABILITY_CHECK_FAILED'
                            });
                        } else if ((availability.drivers || []).length === 0) {
                            logStructured('warn', 'confirmPayment: sem motoristas no pre-check, mantendo corrida em busca', {
                                bookingId,
                                eventType: 'confirmPayment',
                                code: 'NO_DRIVERS_AVAILABLE'
                            });
                        }
                    } catch (availabilityError) {
                        logStructured('warn', 'confirmPayment: erro no pre-check de disponibilidade, seguindo fluxo', {
                            bookingId,
                            eventType: 'confirmPayment',
                            error: availabilityError.message
                        });
                    }
                }

                if (paymentMockEnabled) {
                    logStructured('warn', 'confirmPayment executado em modo mock de testes', {
                        bookingId,
                        eventType: 'confirmPayment',
                        mockPayment: true
                    });
                }

                // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                    userId,
                    'confirmPayment',
                    `${bookingId}_${paymentId || Date.now()}`
                );

                const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey);

                if (!idempotencyCheck.isNew) {
                    // Requisição duplicada - retornar resultado cached ou erro
                    if (idempotencyCheck.cachedResult) {
                        logStructured('info', 'Resultado cached retornado', {
                            userId,
                            eventType: 'confirmPayment',
                            idempotencyKey
                        });
                        socket.emit('paymentConfirmed', idempotencyCheck.cachedResult);
                        return;
                    } else {
                        // Requisição duplicada mas sem resultado cached (ainda processando)
                        logStructured('warn', 'Requisição duplicada detectada', {
                            userId,
                            eventType: 'confirmPayment',
                            idempotencyKey
                        });
                        socket.emit('paymentError', {
                            error: 'Requisição duplicada',
                            message: 'Este pagamento já está sendo processado. Aguarde...',
                            code: 'DUPLICATE_REQUEST',
                            retryAfterSec: 1
                        });
                        return;
                    }
                }

                // ✅ NOVO: Salvar payment holding como "in_holding" para permitir startTrip
                try {
                    const PaymentService = require('../services/payment-service');
                    const paymentService = new PaymentService();
                    const paymentHoldingTimeoutMs = Number.parseInt(process.env.PAYMENT_HOLDING_TIMEOUT_MS || '2500', 10);

                    // Converter amount para centavos se necessário
                    const amountInCents = typeof amount === 'number' && amount < 1000 ? Math.round(amount * 100) : Math.round(amount);

                    await Promise.race([
                        paymentService.savePaymentHolding(bookingId, {
                            status: 'in_holding',
                            amount: amountInCents,
                            paymentMethod: paymentMethod,
                            paymentId: paymentId || `payment_${Date.now()}`,
                            paidAt: new Date().toISOString(),
                            confirmedAt: new Date().toISOString()
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('payment_holding_timeout')), paymentHoldingTimeoutMs))
                    ]);

                    logStructured('info', 'Payment holding salvo', {
                        bookingId,
                        eventType: 'confirmPayment'
                    });
                } catch (holdingError) {
                    logStructured('error', 'Erro ao salvar payment holding', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: holdingError.message
                    });
                    // Não bloquear confirmação se holding falhar
                }

                // Simular processamento do pagamento
                const paymentData = {
                    bookingId,
                    paymentMethod,
                    paymentId,
                    amount,
                    status: 'confirmed',
                    timestamp: new Date().toISOString()
                };

                const paymentDispatchService = require('../services/payment-dispatch-service');
                const amountInCents = typeof amount === 'number' && amount < 1000 ? Math.round(amount * 100) : Math.round(amount || 0);
                try {
                    await paymentDispatchService.markBookingPaymentConfirmed({
                        bookingId,
                        chargeId: paymentId || data?.chargeId || '',
                        temporaryRideId: data?.rideId || data?.temporaryRideId || '',
                        amountInCents,
                        paymentStatus: 'in_holding',
                        source: 'socket_confirmPayment'
                    });
                } catch (markPaymentError) {
                    logStructured('warn', 'confirmPayment: falha ao marcar booking como pago', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: markPaymentError.message
                    });
                }

                // Emitir confirmação
                socket.emit('paymentConfirmed', {
                    success: true,
                    bookingId,
                    message: 'Pagamento confirmado com sucesso',
                    data: paymentData
                });

                // Auditoria em background para não bloquear ACK de pagamento.
                setImmediate(async () => {
                    try {
                        const chargeId = paymentId || `payment_${Date.now()}`;
                        await auditService.logPaymentAction(userId, 'confirmPayment', bookingId, chargeId, {
                            paymentMethod,
                            amount,
                            amountInCents
                        }, true, null, metadata);
                    } catch (auditError) {
                        logStructured('warn', 'confirmPayment: falha ao gravar auditoria em background', {
                            bookingId,
                            eventType: 'confirmPayment',
                            error: auditError.message
                        });
                    }
                });

                // Disparar busca de motorista sem esperar o próximo tick para reduzir janela de corrida.
                paymentDispatchService.triggerDispatchAfterPayment({
                    bookingId,
                    io,
                    pickupLocation: pickupLocationToValidate,
                    source: 'socket_confirmPayment',
                    force: true
                }).then((dispatchResult) => {
                    logStructured('info', 'confirmPayment: dispatch pós-pagamento processado', {
                        bookingId,
                        eventType: 'confirmPayment',
                        success: Boolean(dispatchResult?.success),
                        skipped: Boolean(dispatchResult?.skipped),
                        reason: dispatchResult?.reason || null,
                        attempts: dispatchResult?.attempts || 1
                    });
                }).catch((dispatchError) => {
                    logStructured('warn', 'confirmPayment: falha ao acionar dispatch pós-pagamento', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: dispatchError.message
                    });
                });

                const totalLatency = Date.now() - startTime;
                logStructured('info', 'confirmPayment concluído com sucesso', {
                    userId,
                    bookingId,
                    eventType: 'confirmPayment',
                    amount,
                    latency_ms: totalLatency
                });

                // ======================== TESTE AUTOMÁTICO ========================
                // Simular fluxo completo automaticamente após pagamento confirmado
                if (process.env.AUTO_TEST_MODE === 'true') {
                    logStructured('info', 'TESTE AUTOMÁTICO: Simulando fluxo completo', {
                        service: 'server',
                        bookingId,
                        mode: 'auto_test'
                    });

                    // Aguardar 1 segundo e simular motorista aceitando
                    setTimeout(() => {
                        logStructured('info', 'Simulando motorista aceitando corrida', {
                            service: 'server',
                            bookingId,
                            mode: 'auto_test'
                        });

                        // Emitir evento de corrida aceita para o cliente
                        socket.emit('rideAccepted', {
                            success: true,
                            bookingId,
                            message: 'Motorista aceitou sua corrida',
                            driverId: 'simulated_driver',
                            timestamp: new Date().toISOString()
                        });

                        // Aguardar 2 segundos e simular início da viagem
                        setTimeout(() => {
                            logStructured('info', 'Simulando início da viagem', {
                                service: 'server',
                                bookingId,
                                mode: 'auto_test'
                            });

                            socket.emit('tripStarted', {
                                success: true,
                                bookingId,
                                message: 'Viagem iniciada',
                                startLocation: { lat: -23.5505, lng: -46.6333 },
                                timestamp: new Date().toISOString()
                            });

                            // Aguardar 3 segundos e simular finalização
                            setTimeout(() => {
                                logStructured('info', 'Simulando finalização da viagem', {
                                    service: 'server',
                                    bookingId,
                                    mode: 'auto_test'
                                });

                                socket.emit('tripCompleted', {
                                    success: true,
                                    bookingId,
                                    message: 'Viagem finalizada',
                                    endLocation: { lat: -23.5615, lng: -46.6553 },
                                    distance: 5.2,
                                    fare: amount,
                                    timestamp: new Date().toISOString()
                                });

                                if (process.env.AUTO_TEST_MODE === 'true') {
                                    logStructured('info', 'TESTE AUTOMÁTICO COMPLETO', {
                                        service: 'server',
                                        bookingId,
                                        mode: 'auto_test'
                                    });
                                }

                            }, 3000);

                        }, 2000);

                    }, 1000);
                }

            } catch (error) {
                logStructured('error', 'Erro ao confirmar pagamento', {
                    userId: socket.userId || data?.customerId || socket.id,
                    eventType: 'confirmPayment',
                    error: error.message,
                    stack: error.stack
                });
                socket.emit('paymentError', { error: 'Erro ao processar pagamento' });
            }
        });
    });
}

module.exports = registerSocketConfirmPaymentHandler;
