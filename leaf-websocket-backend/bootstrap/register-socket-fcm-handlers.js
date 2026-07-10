const RideLiveActivityService = require('../services/ride-live-activity-service');

function registerSocketFcmHandlers({ socket, redisPool, fcmService, rideLiveActivityService = null, logStructured, logError }) {
    const liveActivityService = rideLiveActivityService || new RideLiveActivityService();

    // ==================== NOVOS EVENTOS - NOTIFICAÇÕES FCM ====================
    // REGISTRAR IMEDIATAMENTE PARA NÃO PERDER EVENTOS DO CLIENTE
    socket.on('registerFCMToken', async (data) => {
        try {
            const payload = data || {};
            logStructured('info', `Token FCM registrado`, {
                service: 'registerFCMToken',
                socketId: socket.id,
                authenticated: Boolean(socket.userId),
                userId: socket.userId || null,
                userType: socket.userType || null,
                platform: payload.platform
            });

            const { fcmToken, platform, deviceId } = payload;

            if (!fcmToken) {
                logStructured('error', `Token FCM não fornecido`, { service: 'registerFCMToken' });
                socket.emit('fcmTokenError', { error: 'Token FCM é obrigatório' });
                return;
            }

            const isAuthenticated = Boolean(socket.userId);
            const effectiveUserId = isAuthenticated ? socket.userId : `temp_${socket.id}`;
            const effectiveUserType = isAuthenticated ? (socket.userType || 'customer') : 'temporary';
            const legacyKey = isAuthenticated && effectiveUserType === 'driver'
                ? `driver:${effectiveUserId}`
                : `user:${effectiveUserId}`;

            const redis = redisPool.getConnection();

            await redis.hset(legacyKey, {
                fcmToken: fcmToken,
                fcmTokenUpdated: new Date().toISOString(),
                fcmPlatform: platform || 'unknown',
                fcmDeviceId: String(deviceId || '').trim(),
                isTemporary: (!isAuthenticated).toString(),
                socketId: socket.id
            });

            try {
                if (!fcmService.isServiceAvailable()) {
                    logStructured('info', 'Inicializando FCMService para registro de token', { service: 'websocket' });
                    fcmService.setRedis(redis);
                    await fcmService.initialize();
                }

                await fcmService.saveUserFCMToken(effectiveUserId, effectiveUserType, fcmToken, {
                    platform,
                    deviceId: String(deviceId || '').trim() || null,
                    isTemporary: !isAuthenticated,
                    socketId: socket.id,
                    authenticated: isAuthenticated,
                    authenticatedAt: isAuthenticated ? new Date().toISOString() : null
                });
            } catch (fcmError) {
                logStructured('error', 'Erro ao salvar token no FCMService', { service: 'websocket', operation: 'registerFCMToken', error: fcmError.message });
            }

            socket.emit('fcmTokenRegistered', {
                success: true,
                userId: effectiveUserId,
                message: 'Token FCM registrado com sucesso'
            });
        } catch (error) {
            logError(error, 'Erro ao registrar token FCM', { service: 'registerFCMToken', userId: socket.userId || null });
            socket.emit('fcmTokenError', { error: 'Erro interno do servidor: ' + error.message });
        }
    });

    socket.on('unregisterFCMToken', async (data) => {
        try {
            const payload = data || {};
            const { fcmToken } = payload;
            if (!fcmToken) {
                socket.emit('fcmTokenError', { error: 'Token FCM não fornecido' });
                return;
            }

            const effectiveUserId = socket.userId || `temp_${socket.id}`;
            await fcmService.removeUserFCMToken(effectiveUserId, fcmToken);
            socket.emit('fcmTokenUnregistered', { success: true, userId: effectiveUserId });
        } catch (error) {
            logError(error, 'Erro ao desregistrar token FCM', { service: 'unregisterFCMToken' });
            socket.emit('fcmTokenError', { error: 'Erro interno do servidor: ' + error.message });
        }
    });

    socket.on('registerRideLiveActivityToken', async (data) => {
        try {
            const payload = data || {};
            const { pushToken, platform } = payload;

            if (!pushToken) {
                socket.emit('rideLiveActivityTokenError', { error: 'Token Live Activity é obrigatório' });
                return;
            }

            const isAuthenticated = Boolean(socket.userId);
            const effectiveUserId = isAuthenticated ? socket.userId : `temp_${socket.id}`;
            const effectiveUserType = isAuthenticated ? (socket.userType || 'customer') : 'temporary';
            const redis = redisPool.getConnection();
            liveActivityService.setRedis(redis);

            const result = await liveActivityService.saveToken(effectiveUserId, effectiveUserType, {
                ...payload,
                platform: platform || 'ios'
            });

            if (!result.success) {
                socket.emit('rideLiveActivityTokenError', { error: result.error || 'Falha ao registrar Live Activity' });
                return;
            }

            socket.emit('rideLiveActivityTokenRegistered', {
                success: true,
                userId: effectiveUserId,
                activityId: result.activityId,
                bookingId: result.bookingId
            });
        } catch (error) {
            logError(error, 'Erro ao registrar token Live Activity', { service: 'registerRideLiveActivityToken', userId: socket.userId || null });
            socket.emit('rideLiveActivityTokenError', { error: 'Erro interno do servidor: ' + error.message });
        }
    });
    // ==========================================================================
}

module.exports = registerSocketFcmHandlers;
