function registerSocketUpdateLocationHandler({
    socket,
    io,
    rateLimiterService,
    logStructured,
    redisPool,
    enforceSubscriptionForOnline,
    enforceDailyKYCForOnline,
    saveDriverLocation
}) {
    socket.on('updateLocation', async (data) => {
        try {
            // Obter driverId do socket (autenticado) ou dos dados
            const driverId = socket.userId || data.uid || data.driverId;

            // ✅ NOVO: Rate Limiting (leve para não afetar GPS)
            const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'updateLocation');

            if (!rateLimitCheck.allowed) {
                // Para GPS, apenas logar mas não bloquear (fail-open para não afetar rastreamento)
                logStructured('warn', 'updateLocation excedido por rate limiter, mas permitindo (GPS crítico)', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    limit: rateLimitCheck.limit
                });
                // Continuar processamento (GPS é crítico)
            }

            const { lat, lng, tripStatus, isInTrip } = data;

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'updateLocation recebido do cliente', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    socketUserId: socket.userId,
                    dataUid: data.uid,
                    dataDriverId: data.driverId,
                    userType: socket.userType,
                    lat,
                    lng,
                    tripStatus,
                    isInTrip
                });
            }

            if (!driverId || !lat || !lng) {
                logStructured('error', 'Dados incompletos para updateLocation', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    lat,
                    lng,
                    socketUserId: socket.userId,
                    dataUid: data.uid,
                    dataDriverId: data.driverId
                });
                socket.emit('error', { message: 'Dados de localização incompletos ou motorista não autenticado' });
                return;
            }

            // Verificar se é motorista
            if (socket.userType !== 'driver') {
                logStructured('error', 'Usuário não é motorista tentando updateLocation', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    userType: socket.userType,
                    driverId,
                    socketId: socket.id
                });
                socket.emit('error', { message: 'Apenas motoristas podem atualizar localização' });
                return;
            }

            // ✅ OTIMIZAÇÃO 4: TTL diferenciado por estado
            // - Em viagem: 30 segundos (dados críticos, precisa ser muito atualizado)
            // - Online disponível: 90 segundos (balanceia responsividade e tolerância a falhas)
            const isInTripState = isInTrip || tripStatus === 'started' || tripStatus === 'accepted';
            const redis = redisPool.getConnection();

            // Aplicar validação KYC diária na transição offline -> online via updateLocation
            const existingDriverState = await redis.hgetall(`driver:${driverId}`);
            const wasOnline = existingDriverState?.isOnline === 'true';
            if (!wasOnline) {
                const subscriptionGate = await enforceSubscriptionForOnline(driverId);
                if (!subscriptionGate.allowed) {
                    socket.emit('driverStatusError', {
                        error: 'Assinatura pendente. Regularize para ficar online.',
                        reason: subscriptionGate.reason,
                        code: subscriptionGate.code,
                        subscriptionRequired: true
                    });
                    return;
                }

                try {
                    const dailyKYC = await enforceDailyKYCForOnline(driverId);
                    if (!dailyKYC.allowed) {
                        socket.emit('driverStatusError', {
                            error: 'Verificação facial diária necessária para ficar online.',
                            reason: dailyKYC.reason,
                            code: dailyKYC.code,
                            kycRequired: true
                        });
                        return;
                    }
                } catch (kycError) {
                    socket.emit('driverStatusError', {
                        error: 'Não foi possível validar KYC agora. Tente novamente.',
                        reason: kycError.message,
                        code: 'kycCheckFailed',
                        kycRequired: true
                    });
                    return;
                }
            }

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Salvando localização do driver no Redis', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    lat,
                    lng,
                    isInTrip: isInTripState,
                    tripStatus: tripStatus,
                    isOnline: true
                });
            }

            await saveDriverLocation(driverId, lat, lng, 0, 0, Date.now(), true, isInTripState);

            // Verificar se foi salvo corretamente no GEO
            const isInGeo = await redis.zscore('driver_locations', driverId);
            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Verificação pós-salvamento de localização', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    isInGeo: isInGeo !== null,
                    geoScore: isInGeo
                });
            }

            // ✅ NOVO: Se motorista está em uma corrida ativa, enviar localização para o passageiro
            if (isInTripState) {
                try {
                    // Buscar booking ativo do motorista no Redis
                    const driverBookings = await redis.keys(`booking:*`);
                    for (const bookingKey of driverBookings) {
                        const bookingData = await redis.hgetall(bookingKey);
                        const bookingDriverId = bookingData.driverId;
                        const bookingStatus = bookingData.status;

                        // Verificar se é uma corrida ativa deste motorista
                        if (bookingDriverId === driverId &&
                            (bookingStatus === 'ACCEPTED' || bookingStatus === 'SEARCHING' || bookingStatus === 'STARTED')) {
                            const bookingId = bookingKey.replace('booking:', '');
                            const customerId = bookingData.customerId || bookingData.customer;

                            if (customerId) {
                                // ✅ Enviar localização do motorista para o passageiro via room
                                io.to(`customer_${customerId}`).emit('driverLocation', {
                                    bookingId,
                                    driverId,
                                    location: {
                                        lat: parseFloat(lat),
                                        lng: parseFloat(lng),
                                        heading: 0,
                                        speed: 0,
                                        timestamp: Date.now()
                                    }
                                });
                                if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                                    logStructured('debug', 'Localização do motorista enviada para passageiro', {
                                        service: 'websocket',
                                        operation: 'updateLocation',
                                        driverId,
                                        customerId,
                                        bookingId
                                    });
                                }
                                break; // Encontrou a corrida ativa, não precisa continuar
                            }
                        }
                    }
                } catch (locationError) {
                    logStructured('warn', 'Erro ao buscar booking ativo para enviar localização', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        driverId,
                        error: locationError.message
                    });
                }
            }

            // Emitir confirmação
            socket.emit('locationUpdated', {
                message: 'Localização atualizada',
                location: { lat, lng },
                driverId: driverId
            });

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Localização do driver salva no Redis', {
                    service: 'websocket',
                    operation: 'updateLocation',
                    driverId,
                    lat,
                    lng,
                    status: isInTripState ? 'em viagem' : 'online'
                });
            }

        } catch (error) {
            logStructured('error', 'Erro ao atualizar localização (updateLocation)', {
                service: 'websocket',
                operation: 'updateLocation',
                driverId: socket.userId,
                error: error.message,
                stack: error.stack
            });
            // Stack já está incluído no logStructured acima
            socket.emit('error', { message: 'Erro ao atualizar localização' });
        }
    });
}

module.exports = registerSocketUpdateLocationHandler;
