const AUTH_VERIFY_BUSY_RETRY_ATTEMPTS = Math.max(
    0,
    Number.parseInt(process.env.AUTH_VERIFY_BUSY_RETRY_ATTEMPTS || '1', 10) || 1
);
const AUTH_VERIFY_BUSY_RETRY_DELAY_MS = Math.max(
    50,
    Number.parseInt(process.env.AUTH_VERIFY_BUSY_RETRY_DELAY_MS || '250', 10) || 250
);
const QA_SOCKET_BYPASS_UIDS = new Set(
    String(process.env.QA_SOCKET_BYPASS_UIDS || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2,8vg2kxxqi3TYKlpD6eBlWgYseIq2')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
);
const DRIVER_DISCONNECT_GRACE_TIMERS_KEY = '__driverDisconnectGraceTimers';

const sleepMs = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
const isTruthyFlag = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

function canUseQaSocketBypass(data, socket) {
    if (String(process.env.AUTO_TEST_MODE || '').trim().toLowerCase() !== 'true') {
        return false;
    }

    const requested = isTruthyFlag(data?.qaAuthBypass) || isTruthyFlag(data?.qaAutomation) ||
        isTruthyFlag(socket?.handshake?.auth?.qaAuthBypass) || isTruthyFlag(socket?.handshake?.auth?.qaAutomation) ||
        isTruthyFlag(socket?.handshake?.query?.qaAuthBypass) || isTruthyFlag(socket?.handshake?.query?.qaAutomation);

    if (!requested) {
        return false;
    }

    const requestedUid = String(
        data?.uid ||
        socket?.handshake?.auth?.uid ||
        socket?.handshake?.query?.uid ||
        ''
    ).trim();

    return !!requestedUid && QA_SOCKET_BYPASS_UIDS.has(requestedUid);
}

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
            const qaSocketBypassAllowed = !authToken && canUseQaSocketBypass(data, socket);

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

            if (qaSocketBypassAllowed) {
                verifiedUid = String(
                    data?.uid ||
                    socket?.handshake?.auth?.uid ||
                    socket?.handshake?.query?.uid ||
                    ''
                ).trim();
            } else if (isProd || authToken) {
                if (!authToken) {
                    socket.emit('authentication_error', { message: 'Token de autenticação ausente' });
                    socket.emit('auth_error', { message: 'Token de autenticação ausente' });
                    socket.disconnect();
                    releaseAdmissionSlotIfNeeded();
                    return;
                }

                try {
                    let verified = false;
                    let busyAuthError = null;
                    for (let attempt = 0; attempt <= AUTH_VERIFY_BUSY_RETRY_ATTEMPTS; attempt += 1) {
                        releaseAuthSlot = () => { };
                        try {
                            releaseAuthSlot = await acquireAuthVerifySlot();
                            verifiedUid = await verifyFirebaseTokenCached(authToken);
                            verified = true;
                            break;
                        } catch (authError) {
                            const authBusy = authError?.message === 'AUTH_BUSY_QUEUE_FULL' || authError?.message === 'AUTH_BUSY_TIMEOUT';
                            if (!authBusy) {
                                throw authError;
                            }

                            busyAuthError = authError;
                            if (attempt >= AUTH_VERIFY_BUSY_RETRY_ATTEMPTS) {
                                throw authError;
                            }

                            const backoffMs = AUTH_VERIFY_BUSY_RETRY_DELAY_MS * (attempt + 1);
                            await sleepMs(backoffMs);
                        } finally {
                            releaseAuthSlot();
                        }
                    }

                    if (!verified && busyAuthError) {
                        throw busyAuthError;
                    }
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

            if (socket.userType === 'driver') {
                const disconnectGraceTimers = io?.[DRIVER_DISCONNECT_GRACE_TIMERS_KEY];
                const pendingDisconnect = disconnectGraceTimers?.get?.(authUserId);
                if (pendingDisconnect?.timeout) {
                    clearTimeout(pendingDisconnect.timeout);
                    disconnectGraceTimers.delete(authUserId);
                    logStructured('info', 'Reconexão do motorista cancelou desligamento agendado por grace', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: authUserId,
                        graceMs: pendingDisconnect.graceMs || null
                    });
                }
            }

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
            const normalizedSessionUserType = String(socket.userType || '').trim().toLowerCase();
            const shouldEnforceSingleSession =
                SESSION_SIMULTANEA_BLOCKED &&
                ['driver', 'motorista', 'partner', 'parceiro'].includes(normalizedSessionUserType);

            // Verificar se usuário já está conectado em outro socket
            const existingSocket = io.connectedUsers.get(authUserId);
            if (existingSocket && existingSocket.id !== socket.id && shouldEnforceSingleSession) {
                // Avisar a sessão anterior antes de desconectar, para o app mostrar o modal de sessão encerrada.
                existingSocket.emit('sessionTerminated', {
                    code: 'SESSION_REPLACED',
                    reason: 'Nova sessão iniciada em outro dispositivo',
                    userId: authUserId,
                    userType: socket.userType,
                    newSocketId: socket.id,
                    previousSocketId: existingSocket.id,
                    timestamp: new Date().toISOString()
                });
                const disconnectTimer = setTimeout(() => {
                    existingSocket.disconnect();
                }, 250);
                if (typeof disconnectTimer.unref === 'function') {
                    disconnectTimer.unref();
                }
                logStructured('info', 'Desconectando sessão anterior', {
                    service: 'websocket',
                    userId: authUserId,
                    userType: socket.userType,
                    previousSocketId: existingSocket.id,
                    newSocketId: socket.id
                });
            } else if (existingSocket && existingSocket.id !== socket.id) {
                logStructured('info', 'Múltiplas sessões permitidas para este tipo de usuário', {
                    service: 'websocket',
                    userId: authUserId,
                    userType: socket.userType,
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
                        userType: socket.userType,
                        socketId: socket.id
                    });

                    if (await redis.exists(`user:${tempUserId}`) || await redis.exists(`driver:${tempUserId}`)) {
                        const tempTokens = await redis.hgetall(`fcm_tokens:${tempUserId}`);
                        await Promise.all(Object.keys(tempTokens).map((token) =>
                            fcmService.removeUserFCMToken(tempUserId, token)
                        ));
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
