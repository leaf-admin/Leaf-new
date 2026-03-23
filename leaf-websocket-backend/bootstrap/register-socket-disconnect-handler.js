function registerSocketDisconnectHandler({
    socket,
    io,
    websocketRateLimiter,
    connectionMonitor,
    vehicleLockManager,
    redisPool,
    saveDriverLocation,
    logStructured,
    releaseAdmissionSlotIfNeeded
}) {
    const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
    const {
        resolveAcceptedBookingCandidatesForDriver,
        recoverAcceptedBooking
    } = require('../services/accepted-ride-recovery-service');

    const recoverAcceptedRideOnDriverDisconnect = async ({ redis, driverData }) => {
        try {
            const driverId = socket.userId;
            if (!driverId) {
                return;
            }

            const { bookingIds } = await resolveAcceptedBookingCandidatesForDriver(redis, driverId, {
                scanLimit: 300
            });

            if (!bookingIds || bookingIds.length === 0) {
                return;
            }

            const pickupFallback = (
                driverData && driverData.lat && driverData.lng
            )
                ? { lat: Number(driverData.lat), lng: Number(driverData.lng) }
                : null;

            for (const bookingId of bookingIds) {
                const recoveryResult = await recoverAcceptedBooking({
                    redis,
                    io,
                    bookingId,
                    expectedDriverId: driverId,
                    reason: 'driver_disconnect_before_start',
                    source: 'driver_disconnect_handler',
                    recoveryMetadata: {
                        recoveryTriggeredFrom: 'socket_disconnect'
                    },
                    pickupFallback
                });

                if (recoveryResult.recovered) {
                    logStructured('info', 'Recuperação de corrida executada após desconexão do motorista', {
                        service: 'websocket',
                        bookingId,
                        driverId,
                        reason: recoveryResult.reason,
                        dispatchReason: recoveryResult.dispatchResult?.reason || null
                    });
                } else if (!recoveryResult.skipped) {
                    logStructured('warn', 'Recuperação de corrida falhou após desconexão do motorista', {
                        service: 'websocket',
                        bookingId,
                        driverId,
                        reason: recoveryResult.reason || 'UNKNOWN_FAILURE'
                    });
                }
            }
        } catch (recoveryError) {
            logStructured('error', 'Erro na recuperação de corrida após desconexão do motorista', {
                service: 'websocket',
                driverId: socket.userId,
                error: recoveryError.message
            });
        }
    };

    // 1. Disconnect (crítico - deve estar sempre pronto)
    socket.on('disconnect', async (reason) => {
        releaseAdmissionSlotIfNeeded();
        if (process.env.DEBUG_WEBSOCKET === 'true') {
            logStructured('debug', 'Desconexão WebSocket', {
                service: 'websocket',
                socketId: socket.id,
                userId: socket.userId,
                userType: socket.userType,
                reason: reason, // ✅ Adicionado: motivo da desconexão
                totalConnections: io.engine.clientsCount
            });
        }

        // ✅ Remover conexão do rate limiter
        await websocketRateLimiter.unregisterConnection(socket);

        // ✅ Remover conexão do monitor centralizado
        await connectionMonitor.unregisterConnection(socket.id, socket.workerId);

        // Se for motorista, salvar última localização como offline e liberar lock de veículo
        if (socket.userId && socket.userType === 'driver') {
            try {
                // ✅ FASE 1: Liberar lock de veículo ao desconectar
                if (socket.vehiclePlate) {
                    logStructured('info', 'Liberando lock de veículo na desconexão', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: socket.userId,
                        vehiclePlate: socket.vehiclePlate
                    });
                    try {
                        await vehicleLockManager.releaseLock(socket.vehiclePlate, socket.userId);
                        logStructured('info', 'Lock de veículo liberado', {
                            service: 'websocket',
                            userId: socket.userId,
                            vehiclePlate: socket.vehiclePlate
                        });
                    } catch (lockError) {
                        logStructured('error', 'Erro ao liberar lock de veículo', {
                            service: 'websocket',
                            userId: socket.userId,
                            vehiclePlate: socket.vehiclePlate,
                            error: lockError.message
                        });
                        // Não bloquear desconexão por erro no lock
                    }
                }

                const redis = redisPool.getConnection();

                // Garantir conexão Redis
                if (redis.status !== 'ready' && redis.status !== 'connect') {
                    try {
                        await redis.connect();
                    } catch (connectError) {
                        if (!connectError.message.includes('already connecting') &&
                            !connectError.message.includes('already connected')) {
                            logStructured('error', 'Erro ao conectar Redis na desconexão', {
                                service: 'websocket',
                                socketId: socket.id,
                                userId: socket.userId,
                                error: connectError.message
                            });
                            return; // Continuar sem salvar como offline
                        }
                    }
                }

                // Buscar última localização conhecida
                const driverData = await redis.hgetall(`driver:${socket.userId}`);

                if (driverData && driverData.lat && driverData.lng) {
                    // Salvar como offline com última localização
                    await saveDriverLocation(
                        socket.userId,
                        parseFloat(driverData.lat),
                        parseFloat(driverData.lng),
                        parseFloat(driverData.heading || 0),
                        parseFloat(driverData.speed || 0),
                        Date.now(),
                        false // offline
                    );
                    logStructured('info', 'Motorista desconectado - salvo como OFFLINE com última localização', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: socket.userId
                    });
                } else {
                    // Se não tem localização, apenas remover do GEO ativo
                    try {
                        await redis.zrem('driver_locations', socket.userId);
                        logStructured('info', 'Motorista desconectado - removido do GEO ativo', {
                            service: 'websocket',
                            socketId: socket.id,
                            userId: socket.userId
                        });
                    } catch (error) {
                        // Ignorar erro se Redis não disponível
                        logStructured('warn', 'Erro ao remover do GEO', {
                            service: 'websocket',
                            socketId: socket.id,
                            userId: socket.userId,
                            error: error.message
                        });
                    }
                }

                await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, socket.userId);
                await redis.srem('online_drivers', socket.userId);
                await redis.hset(`driver:${socket.userId}`, {
                    dispatchEligible: 'false',
                    dispatchEligibilityCode: 'OFFLINE',
                    dispatchEligibilityCheckedAt: new Date().toISOString()
                });

                await recoverAcceptedRideOnDriverDisconnect({ redis, driverData });
            } catch (error) {
                logStructured('error', 'Erro ao processar desconexão do motorista', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: socket.userId,
                    error: error.message,
                    stack: error.stack
                });
            }
        }

        // Limpar registro de usuário conectado
        if (socket.userId && io.connectedUsers) {
            const existingSocket = io.connectedUsers.get(socket.userId);
            if (existingSocket && existingSocket.id === socket.id) {
                io.connectedUsers.delete(socket.userId);
                logStructured('info', 'Removido do registro de conexões', {
                    service: 'websocket',
                    userId: socket.userId,
                    socketId: socket.id,
                    action: 'cleanup_connection'
                });
            }
        }
    });
}

module.exports = registerSocketDisconnectHandler;
