const { assertRideParticipant } = require('../services/socket-scope-guard');
const {
    hasRideOfflineIntentPayload,
    markRideOfflineIntentProcessed,
    markRideOfflineIntentRejected,
    validateAndReserveRideOfflineIntent
} = require('../services/ride-offline-intent-validator');

function registerSocketCancelRideHandler({
    socket,
    io,
    extractTraceIdFromEvent,
    traceContext,
    logStructured,
    rateLimiterService,
    redisPool,
    RideStateManager,
    gradualExpander,
    GeoHashUtils,
    rideQueueManager,
    getTracer,
    createCommandSpan,
    runInSpan,
    endSpanError,
    logCommand,
    CancelRideCommand,
    createEventSpan,
    eventBus,
    logEvent,
    PaymentService,
    idempotencyService,
    fcmService,
    assertRideParticipant: assertRideParticipantForSocket = assertRideParticipant
}) {
    const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
    const rideIdempotencyService = idempotencyService || require('../services/idempotency-service');
    socket.on('cancelRide', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        let outerIdempotencyKey = null;
        let outerIdempotencyOwner = false;
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                const { bookingId, reason, cancellationFee } = data;
                let userId = socket.userId || socket.id;
                let canonicalUserType = socket.userType;

                logStructured('info', 'cancelRide iniciado', {
                    userId,
                    bookingId,
                    eventType: 'cancelRide'
                });

                // ✅ NOVO: Rate Limiting
                const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'cancelRide');

                if (!rateLimitCheck.allowed) {
                    socket.emit('rideCancellationError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        userId,
                        eventType: 'cancelRide',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Cancelamento de corrida recebido', {
                    userId,
                    bookingId,
                    eventType: 'cancelRide'
                });

                // ✅ GARANTIR conexão Redis antes de usar
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                if (!bookingId) {
                    socket.emit('rideCancellationError', { error: 'ID da corrida obrigatório' });
                    return;
                }

                const participant = await assertRideParticipantForSocket({
                    socket,
                    io,
                    redisPool,
                    bookingId,
                    allowedRoles: ['passenger', 'driver'],
                    allowSupport: false
                });
                if (!participant?.allowed) {
                    socket.emit('rideCancellationError', {
                        error: participant?.error || 'Usuário não autorizado para cancelar esta corrida',
                        code: participant?.code || 'RIDE_SCOPE_DENIED'
                    });
                    return;
                }
                userId = participant.identity?.userId || userId;
                canonicalUserType = participant.participantRole === 'passenger'
                    ? 'customer'
                    : 'driver';

                const idempotencyKey = data.idempotencyKey || rideIdempotencyService.generateKey(
                    userId,
                    'cancelRide',
                    bookingId
                );
                outerIdempotencyKey = idempotencyKey;

                const idempotencyCheck = await rideIdempotencyService.beginRequest(idempotencyKey, {
                    joinWaitMs: Number.parseInt(
                        process.env.IDEMPOTENCY_CANCEL_RIDE_JOIN_WAIT_MS
                        || process.env.IDEMPOTENCY_JOIN_WAIT_MS
                        || '10000',
                        10
                    )
                });

                if (!idempotencyCheck.isNew) {
                    if (idempotencyCheck.cachedResult) {
                        socket.emit('rideCancelled', idempotencyCheck.cachedResult);
                        return;
                    }

                    socket.emit('rideCancellationError', {
                        error: 'Requisição duplicada',
                        message: 'Esta ação já está sendo processada. Aguarde...',
                        code: 'DUPLICATE_REQUEST',
                        retryAfterSec: 1
                    });
                    return;
                }
                outerIdempotencyOwner = true;
                let offlineIntentValidation = null;

                if (hasRideOfflineIntentPayload(data)) {
                    offlineIntentValidation = await validateAndReserveRideOfflineIntent({
                        redis,
                        bookingId,
                        actorId: userId,
                        role: participant.participantRole,
                        eventType: 'cancel_ride',
                        idempotencyKey,
                        clientSequence: data.clientSequence,
                        clientCreatedAt: data.clientCreatedAt,
                        payload: {
                            reason,
                            cancellationFee
                        },
                        data
                    });

                    if (!offlineIntentValidation.accepted) {
                        socket.emit('rideCancellationError', {
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
                        socket.emit('rideCancelled', offlineIntentValidation.cachedResult);
                        return;
                    }
                }

                // 1. Buscar dados da corrida
                const bookingKey = `booking:${bookingId}`;
                const bookingData = await redis.hgetall(bookingKey);

                if (!bookingData || Object.keys(bookingData).length === 0) {
                    logStructured('error', 'Corrida não encontrada', {
                        bookingId,
                        eventType: 'cancelRide'
                    });
                    socket.emit('rideCancellationError', { error: 'Corrida não encontrada' });
                    if (outerIdempotencyOwner && outerIdempotencyKey) {
                        outerIdempotencyOwner = false;
                        await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                    }
                    return;
                }

                // 2. Parar busca gradual se ainda estiver em busca
                const currentState = await RideStateManager.getBookingState(redis, bookingId);
                if (currentState === RideStateManager.STATES.SEARCHING || currentState === RideStateManager.STATES.PENDING) {
                    await gradualExpander.stopSearch(bookingId);
                    logStructured('info', 'Busca parada para corrida cancelada', {
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // 3. Liberar locks de todos os motoristas notificados
                const notifiedDrivers = await redis.smembers(`ride_notifications:${bookingId}`);
                const notifiedDriverIds = new Set(
                    Array.isArray(notifiedDrivers)
                        ? notifiedDrivers.map(driverId => String(driverId || '').trim()).filter(Boolean)
                        : []
                );
                const driverLockManager = require('../services/driver-lock-manager');
                const DriverNotificationDispatcher = require('../services/driver-notification-dispatcher');
                const dispatcher = new DriverNotificationDispatcher(io);

                // ✅ NOVO: Identificar motorista que cancelou (se for motorista)
                const cancellingDriverId = socket.userId && socket.userType === 'driver' ? socket.userId : null;

                for (const driverId of notifiedDrivers) {
                    try {
                        await driverLockManager.releaseLock(driverId);
                        dispatcher.cancelDriverTimeout(driverId, bookingId);

                        // ✅ NOVO: Se este motorista cancelou, adicionar à lista de exclusão permanente
                        if (cancellingDriverId && driverId === cancellingDriverId) {
                            await redis.sadd(`ride_excluded_drivers:${bookingId}`, driverId);
                            await redis.expire(`ride_excluded_drivers:${bookingId}`, 3600); // Expirar após 1 hora
                            logStructured('info', 'Motorista adicionado à lista de exclusão', {
                                driverId,
                                bookingId,
                                eventType: 'cancelRide'
                            });
                        }
                    } catch (e) {
                        // Ignorar erros de lock não existente
                    }
                }

                // ✅ NOVO: Se motorista cancelou mas não estava na lista de notificados, adicionar à exclusão mesmo assim
                if (cancellingDriverId && !notifiedDrivers.includes(cancellingDriverId)) {
                    await redis.sadd(`ride_excluded_drivers:${bookingId}`, cancellingDriverId);
                    await redis.expire(`ride_excluded_drivers:${bookingId}`, 3600);
                    logStructured('info', 'Motorista (não notificado) adicionado à lista de exclusão', {
                        driverId: cancellingDriverId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // 4. Remover da fila regional (já feito pelo command, mas manter para compatibilidade)
                if (bookingData.pickupLocation) {
                    const pickupLocation = JSON.parse(bookingData.pickupLocation);
                    const regionHash = GeoHashUtils.getRegionHash(pickupLocation.lat, pickupLocation.lng, 5);
                    await rideQueueManager.dequeueRide(bookingId, regionHash);
                }

                // ✅ REFATORAÇÃO: Usar CancelRideCommand
                logStructured('info', 'Executando CancelRideCommand', {
                    userId,
                    bookingId,
                    eventType: 'cancelRide'
                });

                // ✅ FASE 1.3: Criar span para Command
                const tracer = getTracer();
                const { trace: otelTrace } = require('@opentelemetry/api');
                const activeSpan = otelTrace.getActiveSpan();
                const correlationId = bookingId; // Usar bookingId como correlationId

                const commandSpan = createCommandSpan(tracer, 'cancel_ride', activeSpan, {
                    'command.user_id': userId,
                    'command.booking_id': bookingId,
                    'correlation.id': correlationId
                });

                // ✅ MÉTRICAS: Preparar para registrar corrida cancelada
                const { metrics } = require('../utils/prometheus-metrics');
                const commandStartTime = Date.now();

                let result;
                try {
                    const command = new CancelRideCommand({
                        bookingId,
                        canceledBy: userId,
                        reason: reason || 'Cancelado pelo usuário',
                        cancellationFee: cancellationFee || 0,
                        traceId, // ✅ Passar traceId para o command
                        correlationId, // ✅ Passar correlationId para o command
                        userType: canonicalUserType // Papel canônico do participante
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
                logCommand('CancelRideCommand', result.success, commandLatency, {
                    userId,
                    bookingId
                });

                if (!result.success) {
                    // Erro no command
                    logStructured('error', 'CancelRideCommand falhou', {
                        userId,
                        bookingId,
                        eventType: 'cancelRide',
                        error: result.error
                    });
                    socket.emit('rideCancellationError', {
                        error: result.error || 'Erro ao cancelar corrida'
                    });
                    if (offlineIntentValidation && !offlineIntentValidation.skipped) {
                        await markRideOfflineIntentRejected({
                            redis,
                            bookingId,
                            idempotencyKey,
                            error: result.error || 'Erro ao cancelar corrida',
                            code: 'CANCEL_RIDE_COMMAND_FAILED'
                        }).catch(() => null);
                    }
                    if (outerIdempotencyOwner && outerIdempotencyKey) {
                        outerIdempotencyOwner = false;
                        await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                    }
                    return;
                }

                // A persistência espelha apenas uma transição canônica já confirmada.
                try {
                    const ridePersistenceService = require('../services/ride-persistence-service');
                    const cancelReason = reason || 'Cancelado pelo usuário';
                    await ridePersistenceService.markRideCancelled(bookingId, cancelReason);
                } catch (persistError) {
                    logStructured('error', 'Erro ao marcar corrida como cancelada no Firestore', {
                        bookingId,
                        eventType: 'cancelRide',
                        error: persistError.message
                    });
                    // A transição Redis/evento já foi confirmada; o espelho será reconciliado.
                }

                // Command executado com sucesso (já processou reembolso e atualizou estado)
                const { event } = result.data;

                // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão processar notificações)
                if (event) {
                    // ✅ FASE 1.3: Criar span para Event publish
                    const eventSpan = createEventSpan(tracer, 'ride.canceled', activeSpan, {
                        'event.booking_id': bookingId,
                        'correlation.id': correlationId
                    });

                    const eventStartTime = Date.now();
                    try {
                        await runInSpan(eventSpan, async () => {
                            await eventBus.publish({
                                eventType: 'ride.canceled',
                                data: event
                            });
                        });

                        // ✅ Salvar contexto do evento para linkar com listeners
                        const eventSpanContext = eventSpan.spanContext();
                        if (event.data) {
                            event.data._otelSpanContext = eventSpanContext;
                        }

                        const eventLatency = Date.now() - eventStartTime;
                        logEvent('ride.canceled', 'published', {
                            bookingId,
                            latency_ms: eventLatency
                        });
                    } catch (error) {
                        endSpanError(eventSpan, error);
                        throw error;
                    }
                }

                // ✅ Processar reembolso PIX real (já feito pelo command, mas manter compatibilidade para logs)
                const paymentService = new PaymentService();
                const parseSafeJson = (value) => {
                    if (!value) return null;
                    if (typeof value === 'object') return value;
                    try {
                        return JSON.parse(value);
                    } catch {
                        return null;
                    }
                };

                const passengerData = parseSafeJson(bookingData.passenger) || parseSafeJson(bookingData.customer);
                const passengerId = bookingData.passengerId
                    || bookingData.customerId
                    || passengerData?.uid
                    || passengerData?.id
                    || null;

                const paymentRecord = await paymentService.getStoredPayment(bookingId);
                const estimatedFare = parseFloat(bookingData.estimatedFare || bookingData.totalAmount || 0) || 0;
                const chargeId = paymentRecord?.chargeId || bookingData.paymentChargeId || null;
                const cancellationFeeValue = parseFloat(cancellationFee || 0) || 0;
                const cancellationFeeInCents = Math.max(0, Math.round(cancellationFeeValue * 100));

                let refundSummary = {
                    status: 'NO_PAYMENT_FOUND',
                    refundAmountInCents: 0,
                    refundAmountInReais: '0.00',
                    cancellationFeeInCents,
                    cancellationFeeInReais: (cancellationFeeInCents / 100).toFixed(2),
                    refundId: null,
                    chargeId
                };

                if (paymentRecord) {
                    if (paymentRecord.status === 'CREDITED' || paymentRecord.credited) {
                        socket.emit('rideCancellationError', { error: 'Pagamento já foi repassado ao motorista. Entre em contato com o suporte.' });
                        if (outerIdempotencyOwner && outerIdempotencyKey) {
                            outerIdempotencyOwner = false;
                            await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                        }
                        return;
                    }

                    const alreadyRefunded =
                        paymentRecord.refunded ||
                        (typeof PaymentService.isRefundedPaymentStatus === 'function'
                            ? PaymentService.isRefundedPaymentStatus(paymentRecord.status)
                            : ['REFUNDED', 'REFUNDED_FULL', 'REFUNDED_PARTIAL'].includes(
                                String(paymentRecord.status || '').trim().toUpperCase()
                            ));
                    if (alreadyRefunded) {
                        refundSummary.status = 'ALREADY_REFUNDED';
                    } else {
                        const totalPaidCents = Number(paymentRecord.amount) || Math.round(estimatedFare * 100);
                        const feeCents = Math.min(totalPaidCents, cancellationFeeInCents);
                        const refundAmountCents = Math.max(0, totalPaidCents - feeCents);
                        const refundReason = reason || 'Cancelado pelo passageiro';

                        if (refundAmountCents > 0 && chargeId) {
                            const refundResult = await paymentService.processRideRefund({
                                rideId: bookingId,
                                chargeId,
                                amount: refundAmountCents,
                                cancellationFee: feeCents,
                                reason: refundReason,
                                status: feeCents > 0 ? 'REFUNDED_PARTIAL' : 'REFUNDED_FULL',
                                passengerId,
                                metadata: {
                                    source: 'socket_cancel_ride',
                                    cancelledBy: socket.userType || 'unknown'
                                }
                            });
                            if (!refundResult.success) {
                                socket.emit('rideCancellationError', { error: 'Falha ao processar reembolso PIX' });
                                if (outerIdempotencyOwner && outerIdempotencyKey) {
                                    outerIdempotencyOwner = false;
                                    await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                                }
                                return;
                            }

                            refundSummary = {
                                status: refundResult.alreadyRefunded
                                    ? 'ALREADY_REFUNDED'
                                    : feeCents > 0
                                        ? 'REFUNDED_PARTIAL'
                                        : 'REFUNDED_FULL',
                                refundId: refundResult.refundId,
                                refundAmountInCents: refundAmountCents,
                                refundAmountInReais: (refundAmountCents / 100).toFixed(2),
                                cancellationFeeInCents: feeCents,
                                cancellationFeeInReais: (feeCents / 100).toFixed(2),
                                chargeId
                            };
                        } else {
                            await paymentService.markPaymentRefunded(bookingId, {
                                refundAmount: 0,
                                cancellationFee: feeCents,
                                reason: refundReason,
                                status: feeCents > 0 ? 'FEE_ONLY' : 'NO_REFUND_REQUIRED'
                            });

                            refundSummary = {
                                status: feeCents > 0 ? 'FEE_ONLY' : 'NO_REFUND_REQUIRED',
                                refundAmountInCents: 0,
                                refundAmountInReais: '0.00',
                                cancellationFeeInCents: feeCents,
                                cancellationFeeInReais: (feeCents / 100).toFixed(2),
                                chargeId
                            };
                        }
                    }
                }

                const refundWasProcessed = [
                    'REFUNDED',
                    'REFUNDED_FULL',
                    'REFUNDED_PARTIAL',
                    'ALREADY_REFUNDED'
                ].includes(String(refundSummary.status || '').toUpperCase());

                const cancellationData = {
                    bookingId,
                    reason: reason || 'Cancelado pelo usuário',
                    cancellationFee: parseFloat(refundSummary.cancellationFeeInReais),
                    refundAmount: parseFloat(refundSummary.refundAmountInReais),
                    refundStatus: refundSummary.status,
                    refundMethod: refundWasProcessed ? 'PIX' : null,
                    refundId: refundSummary.refundId,
                    chargeId: refundSummary.chargeId,
                    timestamp: new Date().toISOString()
                };

                const cancellationResponse = {
                    success: true,
                    bookingId,
                    message: refundWasProcessed
                        ? 'Corrida cancelada e reembolso processado'
                        : 'Corrida cancelada',
                    initiatedBy: socket.userType || 'unknown',
                    initiatedById: socket.userId || null,
                    data: cancellationData
                };
                await rideIdempotencyService.cacheResult(idempotencyKey, cancellationResponse);
                if (offlineIntentValidation && !offlineIntentValidation.skipped) {
                    await markRideOfflineIntentProcessed({
                        redis,
                        bookingId,
                        idempotencyKey,
                        result: cancellationResponse
                    }).catch(() => null);
                }
                outerIdempotencyOwner = false;

                // 8. Emitir confirmação
                // ✅ Padronizar uso de rooms para alta escalabilidade
                const initiatorId = socket.userId || socket.id;
                const initiatorType = socket.userType || 'unknown';
                const notifiedDriversAlreadyCancelled = new Set();

                // Emitir para quem iniciou o cancelamento via room
                if (initiatorType === 'driver') {
                    io.to(`driver_${initiatorId}`).emit('rideCancelled', cancellationResponse);
                    notifiedDriversAlreadyCancelled.add(String(initiatorId));
                    logStructured('info', 'rideCancelled enviado para driver', {
                        driverId: initiatorId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                } else if (initiatorType === 'customer' || initiatorType === 'passenger') {
                    io.to(`customer_${initiatorId}`).emit('rideCancelled', cancellationResponse);
                    logStructured('info', 'rideCancelled enviado para customer', {
                        customerId: initiatorId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // ✅ NOVO: Atualizar Live Activity/Foreground Service (Silent Push)
                try {
                    const payloadData = {
                        bookingId: bookingId,
                        status: 'cancelled',
                        distance: '0',
                        fare: String(refundSummary?.refundAmountInReais || '0')
                    };

                    const drvIdToNotify = bookingData.driverId || (initiatorType === 'driver' ? initiatorId : null);
                    if (passengerId) await fcmService.sendRideStatusUpdate(passengerId, { ...payloadData, userType: 'customer' });
                    if (drvIdToNotify) await fcmService.sendRideStatusUpdate(drvIdToNotify, { ...payloadData, userType: 'driver' });
                } catch (silentPushError) {
                    logStructured('error', 'Erro ao enviar silent push em cancelRide', { error: silentPushError.message });
                }

                // ✅ Também emitir para o passageiro se houver (e for diferente do iniciador)
                if (passengerId && passengerId !== initiatorId) {
                    io.to(`customer_${passengerId}`).emit('rideCancelled', cancellationResponse);
                    logStructured('info', 'rideCancelled enviado para customer (passageiro)', {
                        customerId: passengerId,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }

                // ✅ Também emitir para o motorista se houver (e for diferente do iniciador)
                const bookingKeyForDriver = `booking:${bookingId}`;
                const bookingDataForDriver = await redis.hgetall(bookingKeyForDriver);
                const driverIdFromBooking = bookingDataForDriver?.driverId;
                if (driverIdFromBooking && driverIdFromBooking !== initiatorId) {
                    io.to(`driver_${driverIdFromBooking}`).emit('rideCancelled', cancellationResponse);
                    notifiedDriversAlreadyCancelled.add(String(driverIdFromBooking));
                    logStructured('info', 'rideCancelled enviado para driver (motorista)', {
                        driverId: driverIdFromBooking,
                        bookingId,
                        eventType: 'cancelRide'
                    });
                }
                if (notifiedDriverIds.size > 0) {
                    const passengerCancelledMessage =
                        initiatorType === 'customer' || initiatorType === 'passenger'
                            ? 'Corrida cancelada pelo passageiro'
                            : cancellationResponse.message;
                    const notifiedDriverCancellationResponse = {
                        ...cancellationResponse,
                        message: passengerCancelledMessage,
                        data: {
                            ...(cancellationResponse.data || {}),
                            cancelledBy: initiatorType,
                            cancelledById: initiatorId,
                            reason: cancellationData.reason
                        }
                    };
                    for (const notifiedDriverId of notifiedDriverIds) {
                        if (
                            !notifiedDriverId ||
                            notifiedDriverId === String(initiatorId) ||
                            notifiedDriversAlreadyCancelled.has(String(notifiedDriverId))
                        ) {
                            continue;
                        }

                        await redis.del(`driver_active_notification:${notifiedDriverId}`).catch(() => null);
                        io.to(`driver_${notifiedDriverId}`).emit('rideCancelled', notifiedDriverCancellationResponse);
                        io.to(`driver_${notifiedDriverId}`).emit('clearRideRequest', {
                            success: true,
                            bookingId,
                            rideId: bookingId,
                            reason: 'passenger_cancelled',
                            message: passengerCancelledMessage,
                            timestamp: new Date().toISOString()
                        });
                        logStructured('info', 'rideCancelled enviado para driver notificado antes do aceite', {
                            driverId: notifiedDriverId,
                            bookingId,
                            eventType: 'cancelRide'
                        });
                    }
                }
                if (passengerId && refundSummary.status !== 'NO_PAYMENT_FOUND') {
                    const refundEventPayload = {
                        success: true,
                        rideId: bookingId,
                        chargeId: refundSummary.chargeId,
                        refundStatus: refundSummary.status,
                        refundAmount: parseFloat(refundSummary.refundAmountInReais),
                        cancellationFee: parseFloat(refundSummary.cancellationFeeInReais),
                        refundId: refundSummary.refundId,
                        initiatedBy: socket.userType || 'unknown',
                        initiatedById: socket.userId || null,
                        timestamp: new Date().toISOString()
                    };
                    io.to(`customer_${passengerId}`).emit('paymentRefunded', refundEventPayload);
                    logStructured('info', 'paymentRefunded emitido', {
                        bookingId,
                        passengerId,
                        refundStatus: refundSummary.status,
                        eventType: 'cancelRide'
                    });
                }

                scheduleMapH3Refresh(io, {
                    reason: 'ride_cancelled',
                    bookingId,
                    driverId: driverIdFromBooking || bookingData.driverId || null
                });

                // 9. Limpar dados de busca
                await redis.del(`booking_search:${bookingId}`);
                await redis.del(`ride_notifications:${bookingId}`);

                logStructured('info', 'Corrida cancelada - Reembolso automático processado', {
                    service: 'server',
                    bookingId,
                    eventType: 'cancelRide',
                    refundProcessed: true
                });

                // ✅ NOVO: Limpar activeBookings (Memória)
                if (io.activeBookings) {
                    io.activeBookings.delete(bookingId);
                }

            } catch (error) {
                if (outerIdempotencyOwner && outerIdempotencyKey) {
                    outerIdempotencyOwner = false;
                    await rideIdempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                }
                logStructured('error', 'Erro ao cancelar corrida', {
                    service: 'websocket',
                    operation: 'cancelRide',
                    bookingId: data.bookingId,
                    error: error.message,
                    stack: error.stack
                });
                socket.emit('rideCancellationError', { error: 'Erro interno do servidor' });
            }
        });
    });
}

module.exports = registerSocketCancelRideHandler;
