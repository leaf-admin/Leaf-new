function registerSocketAuthenticateHandler({
    socket,
    io,
    cluster,
    connectionMonitor,
    redisPool,
    fcmService,
    logStructured,
    authDebugEnabled,
    releaseAdmissionSlotIfNeeded,
    fingerprintToken,
    acquireAuthVerifySlot,
    verifyFirebaseTokenCached
}) {
    // ✅ REGISTRAR HANDLER ANTES DE QUALQUER OPERAÇÃO ASSÍNCRONA
    // Isso garante que o handler esteja pronto quando o evento chegar
    socket.on('authenticate', async (data) => {
        if (authDebugEnabled) {
            logStructured('debug', 'Evento authenticate recebido', {
                service: 'websocket',
                socketId: socket.id,
                hasData: !!data
            });
        }

        try {
            // Verificar token de autenticação (JWT)
            const isProd = process.env.NODE_ENV === 'production';
            const requestedUserType = data.userType || data.usertype || socket.userType;
            let verifiedUid = null;
            let releaseAuthSlot = () => { };

            const handshakeTokenRaw =
                socket.handshake?.auth?.token ||
                socket.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
                '';
            const authTokenRaw = data?.token || handshakeTokenRaw;
            const authToken = typeof authTokenRaw === 'string' ? authTokenRaw.trim() : '';
            const authTokenDigest = fingerprintToken(authToken);

            // Fast-path: mesma sessão/socket já autenticado com o mesmo token e tipo.
            if (
                socket.userId &&
                socket.userType === requestedUserType &&
                (
                    (authTokenDigest && socket.authTokenDigest === authTokenDigest) ||
                    (!authTokenDigest && socket.userId === data?.uid)
                )
            ) {
                socket.emit('authenticated', {
                    uid: socket.userId,
                    userId: socket.userId,
                    success: true,
                    userType: socket.userType,
                    socketId: socket.id,
                    reauthenticated: true
                });
                releaseAdmissionSlotIfNeeded();
                return;
            }

            if (isProd || authToken) {
                if (!authToken) {
                    socket.emit('authentication_error', { message: 'Token de autenticação ausente' });
                    socket.emit('auth_error', { message: 'Token de autenticação ausente' });
                    socket.disconnect();
                    releaseAdmissionSlotIfNeeded();
                    return;
                }

                try {
                    releaseAuthSlot = await acquireAuthVerifySlot();
                    verifiedUid = await verifyFirebaseTokenCached(authToken);
                } catch (authError) {
                    if (authError?.message === 'AUTH_BUSY_QUEUE_FULL' || authError?.message === 'AUTH_BUSY_TIMEOUT') {
                        const retryAfterSec = 2;
                        socket.emit('authentication_error', {
                            message: 'Sistema autenticando em alta carga. Tente novamente.',
                            code: 'AUTH_BUSY',
                            retryAfterSec
                        });
                        socket.emit('auth_error', {
                            message: 'Sistema autenticando em alta carga. Tente novamente.',
                            code: 'AUTH_BUSY',
                            retryAfterSec
                        });
                        releaseAdmissionSlotIfNeeded();
                        return;
                    }
                    logStructured('warn', `Token de autenticação inválido ou expirado: ${authError.message}`, {
                        service: 'websocket',
                        socketId: socket.id
                    });
                    socket.emit('authentication_error', { message: 'Token inválido ou expirado' });
                    socket.emit('auth_error', { message: 'Token inválido ou expirado' });
                    socket.disconnect();
                    releaseAdmissionSlotIfNeeded();
                    return;
                } finally {
                    releaseAuthSlot();
                }
            } else {
                // Modo dev/teste sem token
                verifiedUid = data.uid;

                if (!verifiedUid) {
                    socket.emit('authentication_error', { message: 'ID de usuário (uid) ausente' });
                    socket.disconnect();
                    releaseAdmissionSlotIfNeeded();
                    return;
                }
            }

            // A partir daqui, usar SOMENTE o uid validado pelo token
            const authUserId = verifiedUid;

            // ✅ Registrar conexão no monitor centralizado (não bloquear se falhar)
            const workerId = process.env.NODE_ENV === 'production'
                ? `worker-${cluster.worker?.id || 'main'}`
                : `dev-${process.pid}`;
            socket.workerId = workerId;

            connectionMonitor
                .registerConnection(socket.id, authUserId, data.userType || data.usertype || 'unknown', workerId)
                .catch((monitorError) => {
                    logStructured('error', 'Erro ao registrar no connectionMonitor (continuando)', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: authUserId,
                        error: monitorError.message
                    });
                });

            // Armazenar informações do usuário no socket
            socket.userId = authUserId;
            socket.userType = data.userType || data.usertype; // Armazenar tipo: driver ou customer/passenger
            socket.authTokenDigest = authTokenDigest;

            if (authDebugEnabled) {
                logStructured('debug', 'Usuário autenticado', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId,
                    userType: socket.userType
                });
            }

            // Inicializar rastreamento de conexões se não existir
            if (!io.connectedUsers) {
                io.connectedUsers = new Map();
            }

            // Política: Bloquear sessão simultânea (conforme PARAMETROS_DEFINIDOS.md)
            // ✅ DESABILITADO para testes - permitir múltiplas conexões de teste
            const SESSION_SIMULTANEA_BLOCKED = process.env.ALLOW_MULTIPLE_SESSIONS !== 'true'; // Permitir em testes

            // Verificar se usuário já está conectado em outro socket
            const existingSocket = io.connectedUsers.get(authUserId);
            if (existingSocket && existingSocket.id !== socket.id && SESSION_SIMULTANEA_BLOCKED) {
                // Desconectar sessão anterior
                existingSocket.emit('sessionTerminated', {
                    reason: 'Nova sessão iniciada em outro dispositivo',
                    timestamp: new Date().toISOString()
                });
                existingSocket.disconnect();
                logStructured('info', 'Desconectando sessão anterior', {
                    service: 'websocket',
                    userId: authUserId,
                    previousSocketId: existingSocket.id,
                    newSocketId: socket.id
                });
            } else if (existingSocket && existingSocket.id !== socket.id) {
                logStructured('warn', 'Múltiplas sessões permitidas (modo teste)', {
                    service: 'websocket',
                    userId: authUserId,
                    socketId: socket.id
                });
            }

            // Registrar nova conexão
            io.connectedUsers.set(authUserId, socket);

            // ✅ Atualizar tipo de conexão no monitor centralizado
            connectionMonitor
                .updateConnectionType(socket.id, authUserId, socket.userType)
                .catch((monitorError) => {
                    logStructured('error', 'Erro ao atualizar connectionMonitor (continuando)', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: authUserId,
                        error: monitorError.message
                    });
                });

            // Se for driver, adicionar ao room de drivers E room específico
            if (socket.userType === 'driver') {
                socket.join('drivers_room');
                socket.join(`driver_${authUserId}`); // ✅ Room específico para notificações diretas (usado pelo DriverNotificationDispatcher)
                if (authDebugEnabled) {
                    logStructured('debug', 'Driver adicionado aos rooms', {
                        service: 'websocket',
                        userId: authUserId,
                        socketId: socket.id
                    });
                }
            } else if (socket.userType === 'passenger' || socket.userType === 'customer') {
                socket.join('customers_room');
                socket.join(`customer_${authUserId}`); // ✅ Room específico para notificações diretas
                if (authDebugEnabled) {
                    logStructured('debug', 'Customer adicionado aos rooms', {
                        service: 'websocket',
                        userId: authUserId,
                        socketId: socket.id
                    });
                }
            }

            // Atualização de FCM não bloqueia mais o handshake de autenticação.
            const bindFCMTokenAsync = async () => {
                try {
                    await redisPool.ensureConnection();
                    const redis = redisPool.getConnection();
                    const tempUserId = `temp_${socket.id}`;

                    if (!fcmService.isServiceAvailable()) {
                        fcmService.setRedis(redis);
                        await fcmService.initialize();
                    }

                    let fcmToken = await redis.hget(`user:${tempUserId}`, 'fcmToken');
                    if (!fcmToken && socket.userType === 'driver') {
                        fcmToken = await redis.hget(`driver:${tempUserId}`, 'fcmToken');
                    }

                    if (!fcmToken) {
                        fcmToken = await redis.hget(`user:${authUserId}`, 'fcmToken');
                        if (!fcmToken && socket.userType === 'driver') {
                            fcmToken = await redis.hget(`driver:${authUserId}`, 'fcmToken');
                        }
                    }

                    if (!fcmToken) {
                        return;
                    }

                    const platform = await redis.hget(`user:${tempUserId}`, 'fcmPlatform') ||
                        await redis.hget(`user:${authUserId}`, 'fcmPlatform') ||
                        await redis.hget(`driver:${tempUserId}`, 'fcmPlatform') ||
                        await redis.hget(`driver:${authUserId}`, 'fcmPlatform') ||
                        'unknown';

                    if (socket.userType === 'driver') {
                        await redis.hset(`driver:${authUserId}`, {
                            fcmToken: fcmToken,
                            fcmTokenUpdated: new Date().toISOString(),
                            fcmPlatform: platform,
                            isTemporary: 'false',
                            authenticatedAt: new Date().toISOString(),
                            userId: authUserId
                        });
                    } else {
                        await redis.hset(`user:${authUserId}`, {
                            fcmToken: fcmToken,
                            fcmTokenUpdated: new Date().toISOString(),
                            fcmPlatform: platform,
                            isTemporary: 'false',
                            authenticatedAt: new Date().toISOString(),
                            userId: authUserId
                        });
                    }

                    await fcmService.saveUserFCMToken(authUserId, socket.userType, fcmToken, {
                        platform,
                        authenticated: true,
                        authenticatedAt: new Date().toISOString(),
                        userId: authUserId,
                        userType: socket.userType
                    });

                    if (await redis.exists(`user:${tempUserId}`) || await redis.exists(`driver:${tempUserId}`)) {
                        const tempTokens = await redis.hgetall(`fcm_tokens:${tempUserId}`);
                        for (const token of Object.keys(tempTokens)) {
                            await redis.hdel(`fcm_tokens:${tempUserId}`, token);
                        }
                        await redis.del(`user:${tempUserId}`);
                        await redis.del(`driver:${tempUserId}`);
                    }

                    socket.emit('fcmTokenUpdated', {
                        success: true,
                        userId: authUserId,
                        message: 'Token FCM vinculado ao usuário autenticado',
                        token: fcmToken.substring(0, 20) + '...'
                    });
                } catch (updateError) {
                    logStructured('error', 'Erro ao atualizar token FCM para usuário autenticado', {
                        service: 'websocket',
                        userId: authUserId,
                        error: updateError.message
                    });
                }
            };

            if (process.env.AUTH_SYNC_FCM === 'true') {
                await bindFCMTokenAsync();
            } else {
                setImmediate(() => {
                    bindFCMTokenAsync().catch(() => { });
                });
            }

            // Preparar payload de resposta
            const authResponse = {
                uid: authUserId,
                userId: authUserId, // ✅ Adicionar userId para compatibilidade
                success: true,
                userType: socket.userType || data.userType || data.usertype, // ✅ Incluir userType que o app espera
                socketId: socket.id // ✅ Adicionar socketId para debug
            };

            // Adicionar status inicial para drivers (conforme política: Status inicial = offline)
            if (socket.userType === 'driver') {
                authResponse.status = 'offline';
                authResponse.initialStatus = 'offline';
            }

            // ✅ GARANTIR que userId e userType estão setados no socket
            socket.userId = authUserId;
            socket.userType = socket.userType || data.userType || data.usertype;

            if (authDebugEnabled) {
                logStructured('debug', 'Autenticação confirmada', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId,
                    userType: socket.userType
                });
            }

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                logStructured('debug', 'Enviando evento authenticated', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId,
                    payload: authResponse
                });
            }

            // ✅ Emitir authenticated ANTES de qualquer outra coisa
            socket.emit('authenticated', authResponse);
            releaseAdmissionSlotIfNeeded();
            if (authDebugEnabled) {
                logStructured('debug', 'Evento authenticated emitido', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: authUserId
                });
            }
        } catch (error) {
            logStructured('error', 'Erro na autenticação', {
                service: 'websocket',
                socketId: socket.id,
                userId: data.uid || 'unknown',
                error: error.message,
                stack: error.stack
            });
            socket.emit('auth_error', { message: error.message });
            releaseAdmissionSlotIfNeeded();
        }
    });
}

module.exports = registerSocketAuthenticateHandler;
