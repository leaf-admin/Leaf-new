function registerSocketFcmHandlers({ socket, redisPool, fcmService, logStructured, logError }) {
    // ==================== NOVOS EVENTOS - NOTIFICAÇÕES FCM ====================
    // REGISTRAR IMEDIATAMENTE PARA NÃO PERDER EVENTOS DO CLIENTE
    socket.on('registerFCMToken', async (data) => {
        try {
            logStructured('info', `Token FCM registrado`, { service: 'registerFCMToken', userId: data.userId, userType: data.userType, platform: data.platform });

            const { userId, userType, fcmToken, platform, timestamp } = data;

            if (!fcmToken) {
                logStructured('error', `Token FCM não fornecido`, { service: 'registerFCMToken' });
                socket.emit('fcmTokenError', { error: 'Token FCM é obrigatório' });
                return;
            }

            const effectiveUserId = userId || `temp_${socket.id}`;
            const effectiveUserType = userType || 'customer';

            if (!userId) {
                logStructured('warn', `Token FCM registrado sem userId, usando temporário`, { service: 'registerFCMToken', effectiveUserId });
            }

            const redis = redisPool.getConnection();

            if (effectiveUserType === 'driver') {
                await redis.hset(`driver:${effectiveUserId}`, {
                    fcmToken: fcmToken,
                    fcmTokenUpdated: new Date().toISOString(),
                    fcmPlatform: platform || 'unknown',
                    isTemporary: (!userId).toString()
                });
            } else {
                await redis.hset(`user:${effectiveUserId}`, {
                    fcmToken: fcmToken,
                    fcmTokenUpdated: new Date().toISOString(),
                    fcmPlatform: platform || 'unknown',
                    isTemporary: (!userId).toString()
                });
            }

            try {
                if (!fcmService.isServiceAvailable()) {
                    logStructured('info', 'Inicializando FCMService para registro de token', { service: 'websocket' });
                    fcmService.setRedis(redis);
                    await fcmService.initialize();
                }

                const saved = await fcmService.saveUserFCMToken(effectiveUserId, effectiveUserType, fcmToken, {
                    platform,
                    isTemporary: !userId,
                    socketId: socket.id
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
            logError(error, 'Erro ao registrar token FCM', { service: 'registerFCMToken', userId: data.userId });
            socket.emit('fcmTokenError', { error: 'Erro interno do servidor: ' + error.message });
        }
    });

    socket.on('unregisterFCMToken', async (data) => {
        try {
            const { userId, fcmToken } = data;
            if (!userId || !fcmToken) return;
            const redis = redisPool.getConnection();
            await fcmService.removeUserFCMToken(userId, fcmToken);
            socket.emit('fcmTokenUnregistered', { success: true });
        } catch (error) {
            logError(error, 'Erro ao desregistrar token FCM', { service: 'unregisterFCMToken' });
        }
    });
    // ==========================================================================
}

module.exports = registerSocketFcmHandlers;
