function registerSocketRejectRideHandler({
    socket,
    rateLimiterService,
    logStructured,
    validationService,
    getSocketMetadata,
    auditService,
    responseHandler
}) {
    // 5. RejectRide (crítico - rejeitar corrida)
    socket.on('rejectRide', async (data) => {
        const driverId = socket.userId || socket.id;

        try {
            // ✅ NOVO: Rate Limiting
            const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'rejectRide');

            if (!rateLimitCheck.allowed) {
                socket.emit('rejectRideError', {
                    error: 'Muitas requisições',
                    message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                    code: 'RATE_LIMIT_EXCEEDED',
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt
                });
                logStructured('warn', 'rejectRide bloqueado por rate limiter', {
                    service: 'websocket',
                    driverId,
                    limit: rateLimitCheck.limit,
                    window: '1min'
                });
                return;
            }
        } catch (rateLimitError) {
            logStructured('error', 'Erro ao verificar rate limit para rejectRide', {
                service: 'websocket',
                driverId,
                error: rateLimitError.message,
                stack: rateLimitError.stack
            });
            // Continuar se rate limit falhar (fail-open)
        }

        try {
            // ✅ NOVO: Validação e sanitização de dados
            const validation = validationService.validateEndpoint('rejectRide', data);

            if (!validation.valid) {
                const metadata = getSocketMetadata(socket);
                await auditService.logRideAction(driverId, 'rejectRide', data.bookingId || null, {
                    error: 'Validação falhou',
                    validationErrors: validation.errors
                }, false, 'Dados de entrada inválidos', metadata);

                socket.emit('rejectRideError', {
                    error: 'Dados inválidos',
                    message: 'Os dados fornecidos não são válidos',
                    details: validation.errors,
                    code: 'VALIDATION_ERROR'
                });
                return;
            }

            // Usar dados sanitizados
            const { bookingId: sanitizedBookingId, reason: sanitizedReason } = validation.sanitized;

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                logStructured('debug', 'Rejeitar corrida', {
                    service: 'websocket',
                    driverId,
                    data
                });
            }

            const { rideId, bookingId, reason } = data;

            // Usar bookingId ou rideId (compatibilidade)
            const bookingIdToUse = sanitizedBookingId || bookingId || rideId;

            if (!bookingIdToUse) {
                socket.emit('rejectRideError', { error: 'ID da corrida obrigatório' });
                return;
            }

            if (!driverId) {
                socket.emit('rejectRideError', { error: 'Motorista não autenticado' });
                return;
            }

            // Usar ResponseHandler para processar rejeição
            const result = await responseHandler.handleRejectRide(
                driverId,
                bookingIdToUse,
                sanitizedReason || reason || 'Motorista indisponível'
            );

            if (result.success) {
                // Notificação já foi enviada pelo ResponseHandler
                socket.emit('rideRejected', {
                    success: true,
                    bookingId: bookingIdToUse,
                    rideId: rideId,
                    message: 'Corrida rejeitada com sucesso',
                    reason: reason || 'Motorista indisponível'
                });

                // Se há próxima corrida, ela já foi enviada pelo ResponseHandler
                if (result.nextRide) {
                    logStructured('info', 'Próxima corrida enviada para motorista', {
                        service: 'server',
                        driverId,
                        bookingId: result.nextRide?.bookingId,
                        eventType: 'rejectRide'
                    });
                }

                logStructured('info', 'Motorista rejeitou corrida', {
                    service: 'server',
                    driverId,
                    bookingId: bookingIdToUse,
                    eventType: 'rejectRide'
                });
            } else {
                socket.emit('rejectRideError', {
                    error: result.error || 'Erro ao processar rejeição'
                });
                logStructured('error', 'Falha ao rejeitar corrida', {
                    service: 'server',
                    driverId,
                    bookingId: bookingIdToUse,
                    error: result.error,
                    eventType: 'rejectRide'
                });
            }

        } catch (error) {
            logStructured('error', 'Erro ao rejeitar corrida', {
                service: 'websocket',
                driverId,
                bookingId: bookingIdToUse,
                error: error.message,
                stack: error.stack
            });
            socket.emit('rejectRideError', { error: 'Erro ao processar rejeição' });
        }
    });
}

module.exports = registerSocketRejectRideHandler;
