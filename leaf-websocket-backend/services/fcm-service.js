const admin = require('firebase-admin');
const Redis = require('ioredis');
const { logger, logStructured } = require('../utils/logger');
const path = require('path');
const circuitBreakerService = require('./circuit-breaker-service');
const traceContext = require('../utils/trace-context');

class FCMService {
    constructor(redis = null) {
        this.redis = redis;
        this.isInitialized = false;
        this.rateLimitCounts = new Map();
        this.lastResetTime = Date.now();
    }

    setRedis(redis) {
        this.redis = redis;
    }

    // Inicializar o serviço FCM
    async initialize() {
        const startTime = Date.now();
        try {
            // Verificar se Firebase Admin já foi inicializado
            if (!admin.apps.length) {
                // Inicializar Firebase Admin se não estiver
                const serviceAccountPath = path.join(__dirname, '..', '..', 'mobile-app', 'config', 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');

                try {
                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccountPath),
                        databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://leaf-reactnative-default-rtdb.firebaseio.com'
                    });
                    logger.info(`✅ Firebase Admin inicializado em ${Date.now() - startTime}ms`);
                } catch (initError) {
                    logger.error('❌ Erro ao inicializar Firebase Admin:', initError);
                    this.isInitialized = false;
                    return;
                }
            }

            this.isInitialized = true;
            logger.info(`✅ FCM Service inicializado com sucesso em ${Date.now() - startTime}ms`);

        } catch (error) {
            logger.error('❌ Erro ao inicializar FCM Service:', error);
            this.isInitialized = false;
        }
    }

    // Verificar se o serviço está funcionando
    isServiceAvailable() {
        return this.isInitialized && admin.apps.length > 0;
    }

    // Salvar token FCM de um usuário
    async saveUserFCMToken(userId, userType, fcmToken, deviceInfo = {}) {
        try {
            if (!fcmToken) {
                logStructured('warn', 'Token FCM vazio', {
                    service: 'fcm',
                    operation: 'saveUserFCMToken',
                    userId
                });
                return false;
            }

            const tokenData = {
                userId,
                userType,
                fcmToken,
                deviceInfo,
                lastUpdated: new Date().toISOString(),
                isActive: true,
                // ✅ Informações adicionais para token personalizado
                authenticated: deviceInfo.authenticated || false,
                authenticatedAt: deviceInfo.authenticatedAt || null,
                socketId: deviceInfo.socketId || null,
                isTemporary: deviceInfo.isTemporary || false
            };

            // Salvar no Redis
            await this.redis.hset(
                `fcm_tokens:${userId}`,
                fcmToken,
                JSON.stringify(tokenData)
            );

            // Adicionar à lista de tokens ativos
            await this.redis.sadd('active_fcm_tokens', fcmToken);

            // Definir TTL para o token (30 dias)
            await this.redis.expire(`fcm_tokens:${userId}`, 2592000);

            logStructured('info', 'Token FCM salvo', {
                service: 'fcm',
                operation: 'saveUserFCMToken',
                userId,
                userType
            });
            return true;

        } catch (error) {
            logStructured('error', 'Erro ao salvar token FCM', {
                service: 'fcm',
                operation: 'saveUserFCMToken',
                userId,
                error: error.message
            });
            return false;
        }
    }

    // Obter tokens FCM de um usuário
    async getUserFCMTokens(userId) {
        try {
            const tokens = await this.redis.hgetall(`fcm_tokens:${userId}`);
            const activeTokens = [];

            for (const [token, data] of Object.entries(tokens)) {
                try {
                    const tokenData = JSON.parse(data);
                    if (tokenData.isActive) {
                        activeTokens.push(tokenData);
                    }
                } catch (parseError) {
                    logger.warn(`Erro ao fazer parse do token ${token}:`, parseError);
                }
            }

            return activeTokens;

        } catch (error) {
            logger.error(`❌ Erro ao obter tokens FCM para usuário ${userId}:`, error);
            return [];
        }
    }

    // Remover token FCM de um usuário
    async removeUserFCMToken(userId, fcmToken) {
        try {
            // Remover do hash do usuário
            await this.redis.hdel(`fcm_tokens:${userId}`, fcmToken);

            // Remover da lista de tokens ativos
            await this.redis.srem('active_fcm_tokens', fcmToken);

            logStructured('info', 'Token FCM removido', {
                service: 'fcm',
                operation: 'removeUserFCMToken',
                userId
            });
            return true;

        } catch (error) {
            logStructured('error', 'Erro ao remover token FCM', {
                service: 'fcm',
                operation: 'removeUserFCMToken',
                userId,
                error: error.message
            });
            return false;
        }
    }

    // Enviar notificação para um usuário específico
    async sendNotificationToUser(userId, notification) {
        try {
            if (!this.isServiceAvailable()) {
                logStructured('warn', 'FCM Service não disponível', {
                    service: 'fcm',
                    operation: 'sendNotificationToUser',
                    userId
                });
                return { success: false, error: 'FCM Service não disponível' };
            }

            // Verificar rate limiting
            if (!this.checkRateLimit(userId)) {
                logStructured('warn', 'Rate limit excedido', {
                    service: 'fcm',
                    operation: 'sendNotificationToUser',
                    userId
                });
                return { success: false, error: 'Rate limit excedido' };
            }

            // Obter tokens FCM do usuário
            const userTokens = await this.getUserFCMTokens(userId);

            if (userTokens.length === 0) {
                logStructured('warn', 'Usuário não possui tokens FCM ativos', {
                    service: 'fcm',
                    operation: 'sendNotificationToUser',
                    userId
                });
                return { success: false, error: 'Nenhum token FCM encontrado' };
            }

            // Enviar para todos os dispositivos do usuário
            const results = [];
            for (const tokenData of userTokens) {
                try {
                    const result = await this.sendToToken(tokenData.fcmToken, notification);
                    results.push({
                        token: tokenData.fcmToken,
                        success: result.success,
                        messageId: result.messageId,
                        error: result.error
                    });
                } catch (error) {
                    logStructured('error', 'Erro ao enviar para token', {
                        service: 'fcm',
                        operation: 'sendNotificationToUser',
                        userId,
                        error: error.message
                    });
                    results.push({
                        token: tokenData.fcmToken,
                        success: false,
                        error: error.message
                    });
                }
            }

            const successCount = results.filter(r => r.success).length;
            logStructured('info', 'Notificação enviada para usuário', {
                service: 'fcm',
                operation: 'sendNotificationToUser',
                userId,
                successCount,
                totalTokens: userTokens.length
            });

            return {
                success: successCount > 0,
                results,
                summary: {
                    total: userTokens.length,
                    success: successCount,
                    failed: userTokens.length - successCount
                }
            };

        } catch (error) {
            logStructured('error', 'Erro ao enviar notificação para usuário', {
                service: 'fcm',
                operation: 'sendNotificationToUser',
                userId,
                error: error.message
            });
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação para múltiplos usuários
    async sendNotificationToUsers(userIds, notification) {
        try {
            const results = [];

            for (const userId of userIds) {
                const result = await this.sendNotificationToUser(userId, notification);
                results.push({ userId, result });
            }

            const totalSuccess = results.filter(r => r.result.success).length;
            logger.info(`📤 Notificações enviadas para ${userIds.length} usuários: ${totalSuccess} com sucesso`);

            return {
                success: true,
                results,
                summary: {
                    total: userIds.length,
                    success: totalSuccess,
                    failed: userIds.length - totalSuccess
                }
            };

        } catch (error) {
            logger.error('❌ Erro ao enviar notificações para múltiplos usuários:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação para um token específico
    async sendToToken(fcmToken, notification) {
        try {
            if (!this.isServiceAvailable()) {
                throw new Error('FCM Service não disponível');
            }

            const message = {
                token: fcmToken,
                notification: {
                    title: notification.title,
                    body: notification.body
                },
                data: {
                    ...notification.data,
                    timestamp: new Date().toISOString()
                },
                android: {
                    priority: 'high',
                    notification: {
                        channelId: notification.channelId || 'default',
                        priority: 'high',
                        defaultSound: true,
                        defaultVibrateTimings: true,
                        // ✅ Adicionar ações interativas (botões) se fornecidas
                        ...(notification.actions && notification.actions.length > 0 && {
                            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                            // Ações aparecem como botões na notificação
                            actions: notification.actions.map(action => ({
                                action: action.id,
                                title: action.title,
                                icon: action.icon || 'ic_notification'
                            }))
                        })
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: notification.badge || 1,
                            // ✅ Adicionar categoria para ações no iOS
                            ...(notification.category && {
                                category: notification.category
                            })
                        }
                    }
                }
            };

            // Enviar com circuit breaker
            const response = await circuitBreakerService.execute(
                'fcm_send',
                async () => {
                    return await admin.messaging().send(message);
                },
                async () => {
                    // Fallback: retornar erro se circuit breaker aberto
                    throw new Error('Serviço de notificações temporariamente indisponível');
                },
                {
                    failureThreshold: 5,
                    timeout: 60000
                }
            );

            logger.info(`✅ Notificação enviada para token ${fcmToken}: ${response}`);

            return {
                success: true,
                messageId: response
            };

        } catch (error) {
            logger.error(`❌ Erro ao enviar notificação para token ${fcmToken}:`, error);

            // Se o token for inválido, removê-lo
            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                await this.removeInvalidToken(fcmToken);
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Enviar notificação interativa com botões de ação
     * @param {string} fcmToken - Token FCM do dispositivo
     * @param {Object} notification - Dados da notificação
     * @param {Array} actions - Array de ações (botões) [{id, title, icon?}]
     * @param {string} category - Categoria para iOS (opcional)
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async sendInteractiveNotification(fcmToken, notification, actions = [], category = null) {
        try {
            if (!this.isServiceAvailable()) {
                throw new Error('FCM Service não disponível');
            }

            // Preparar dados com informações das ações
            const dataWithActions = {
                ...notification.data,
                timestamp: new Date().toISOString(),
                hasActions: 'true',
                actions: JSON.stringify(actions),
                ...(category && { category })
            };

            const message = {
                token: fcmToken,
                notification: {
                    title: notification.title,
                    body: notification.body
                },
                data: dataWithActions,
                android: {
                    priority: 'high',
                    notification: {
                        channelId: notification.channelId || 'driver_actions',
                        priority: 'high',
                        defaultSound: true,
                        defaultVibrateTimings: true,
                        // ✅ Ações interativas para Android
                        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                        // Incluir ações no payload de dados para processamento no app
                        ...(actions.length > 0 && {
                            actions: actions.map(action => ({
                                action: action.id,
                                title: action.title,
                                icon: action.icon || 'ic_notification'
                            }))
                        })
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: notification.badge || 1,
                            // ✅ Categoria para ações no iOS
                            ...(category && {
                                category: category
                            })
                        }
                    }
                }
            };

            // Enviar com circuit breaker
            const response = await circuitBreakerService.execute(
                'fcm_send',
                async () => {
                    return await admin.messaging().send(message);
                },
                async () => {
                    // Fallback: retornar erro se circuit breaker aberto
                    throw new Error('Serviço de notificações temporariamente indisponível');
                },
                {
                    failureThreshold: 5,
                    timeout: 60000
                }
            );

            logger.info(`✅ Notificação interativa enviada para token ${fcmToken}: ${response}`);

            return {
                success: true,
                messageId: response
            };

        } catch (error) {
            logger.error(`❌ Erro ao enviar notificação interativa para token ${fcmToken}:`, error);

            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                await this.removeInvalidToken(fcmToken);
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    // Enviar notificação para um tópico
    async sendToTopic(topic, notification) {
        try {
            if (!this.isServiceAvailable()) {
                throw new Error('FCM Service não disponível');
            }

            const message = {
                topic,
                notification: {
                    title: notification.title,
                    body: notification.body
                },
                data: {
                    ...notification.data,
                    timestamp: new Date().toISOString()
                },
                android: {
                    priority: 'high'
                }
            };

            const response = await admin.messaging().send(message);

            logger.info(`✅ Notificação enviada para tópico ${topic}: ${response}`);

            return {
                success: true,
                messageId: response
            };

        } catch (error) {
            logger.error(`❌ Erro ao enviar notificação para tópico ${topic}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // =========================================================================
    // ✅ NOVO: Enviar atualização persistente de status de corrida (Silent Push)
    // =========================================================================
    async sendRideStatusUpdate(userId, rideData) {
        try {
            if (!this.isServiceAvailable()) return { success: false, error: 'FCM indisponível' };

            // Buscar tokens
            const fcmTokensObj = await this.redis.hgetall(`fcm_tokens:${userId}`);
            let fcmTokens = Object.keys(fcmTokensObj);

            if (fcmTokens.length === 0) {
                let tokenStr = await this.redis.get(`user:${userId}`) || await this.redis.get(`driver:${userId}`);
                if (tokenStr) {
                    const userData = JSON.parse(tokenStr);
                    if (userData && userData.fcmToken) fcmTokens = [userData.fcmToken];
                }
            }

            if (fcmTokens.length === 0) {
                logger.warn(`⚠️ [FCMService] sendRideStatusUpdate ignorado: Sem token para ${userId}`);
                return { success: false, error: 'Token FCM não encontrado' };
            }

            const dataPayload = {
                type: 'ride_status_update',
                bookingId: String(rideData.bookingId || ''),
                status: String(rideData.status || ''),
                userType: String(rideData.userType || ''),
                driverName: String(rideData.driverName || ''),
                customerName: String(rideData.customerName || ''),
                estimatedTime: String(rideData.estimatedTime || ''),
                distance: String(rideData.distance || ''),
                fare: String(rideData.fare || ''),
                timestamp: new Date().toISOString()
            };

            if (rideData.pickup) dataPayload.pickup = JSON.stringify(rideData.pickup);
            if (rideData.destination) dataPayload.destination = JSON.stringify(rideData.destination);

            let successCount = 0;
            for (const fcmToken of fcmTokens) {
                const message = {
                    token: fcmToken,
                    data: dataPayload,
                    android: { priority: 'high' },
                    apns: { payload: { aps: { 'content-available': 1 } } }
                };

                try {
                    await circuitBreakerService.execute(
                        'fcm_send',
                        async () => admin.messaging().send(message),
                        async () => { throw new Error('Fallback Timeout'); },
                        { failureThreshold: 5, timeout: 60000 }
                    );
                    successCount++;
                } catch (err) {
                    logger.warn(`⚠️ Erro push silencioso fcm=${fcmToken.slice(0, 10)}...: ${err.message}`);
                    if (err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/registration-token-not-registered') {
                        await this.removeInvalidToken(fcmToken);
                    }
                }
            }
            logger.info(`✅ [FCMService] sendRideStatusUpdate enviado para ${userId} (Status: ${rideData.status})`);
            return { success: true, count: successCount };

        } catch (error) {
            logger.error(`❌ [FCMService] Erro em sendRideStatusUpdate param ${userId}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação de viagem
    async sendTripNotification(userId, tripData, notificationType) {
        try {
            const notification = this.createTripNotification(tripData, notificationType);
            return await this.sendNotificationToUser(userId, notification);

        } catch (error) {
            logger.error('❌ Erro ao enviar notificação de viagem:', error);
            return { success: false, error: error.message };
        }
    }

    // Criar notificação de viagem
    createTripNotification(tripData, notificationType) {
        const baseData = {
            tripId: tripData.id || tripData.tripId,
            type: 'trip_update',
            ...tripData
        };

        switch (notificationType) {
            case 'driver_found':
                return {
                    title: '🚗 Motorista encontrado!',
                    body: 'Seu motorista está a caminho. Prepare-se para a viagem.',
                    data: { ...baseData, action: 'driver_found' },
                    channelId: 'trip_updates',
                    badge: 1
                };

            case 'driver_arrived':
                return {
                    title: '📍 Motorista chegou!',
                    body: 'Seu motorista chegou ao local de embarque.',
                    data: { ...baseData, action: 'driver_arrived' },
                    channelId: 'trip_updates',
                    badge: 1
                };

            case 'trip_started':
                return {
                    title: '🚀 Viagem iniciada!',
                    body: 'Sua viagem começou. Aproveite o trajeto!',
                    data: { ...baseData, action: 'trip_started' },
                    channelId: 'trip_updates',
                    badge: 1
                };

            case 'trip_completed':
                return {
                    title: '✅ Viagem concluída!',
                    body: 'Sua viagem foi finalizada. Avalie sua experiência!',
                    data: { ...baseData, action: 'trip_completed' },
                    channelId: 'trip_updates',
                    badge: 1
                };

            case 'payment_confirmed':
                return {
                    title: '💳 Pagamento confirmado!',
                    body: 'Seu pagamento foi processado com sucesso.',
                    data: { ...baseData, action: 'payment_confirmed' },
                    channelId: 'payments',
                    badge: 1
                };

            default:
                return {
                    title: '🚗 Atualização da viagem',
                    body: 'Você recebeu uma atualização sobre sua viagem.',
                    data: { ...baseData, action: notificationType },
                    channelId: 'trip_updates',
                    badge: 1
                };
        }
    }

    // Enviar notificação de avaliação
    async sendRatingNotification(userId, ratingData) {
        try {
            const notification = {
                title: '⭐ Nova avaliação recebida!',
                body: 'Alguém avaliou sua viagem. Veja os detalhes!',
                data: {
                    type: 'rating_received',
                    ratingId: ratingData.id,
                    tripId: ratingData.tripId,
                    rating: ratingData.rating,
                    comment: ratingData.comment,
                    timestamp: new Date().toISOString()
                },
                channelId: 'ratings',
                badge: 1
            };

            return await this.sendNotificationToUser(userId, notification);

        } catch (error) {
            logger.error('❌ Erro ao enviar notificação de avaliação:', error);
            return { success: false, error: error.message };
        }
    }

    // Verificar rate limiting
    checkRateLimit(userId) {
        const now = Date.now();
        const resetInterval = 60000; // 1 minuto

        // Reset contadores se necessário
        if (now - this.lastResetTime > resetInterval) {
            this.rateLimitCounts.clear();
            this.lastResetTime = now;
        }

        // Obter contador atual
        const currentCount = this.rateLimitCounts.get(userId) || 0;
        const maxNotificationsPerMinute = 10; // Máximo 10 notificações por minuto

        if (currentCount >= maxNotificationsPerMinute) {
            return false;
        }

        // Incrementar contador
        this.rateLimitCounts.set(userId, currentCount + 1);
        return true;
    }

    // Remover token inválido
    async removeInvalidToken(fcmToken) {
        try {
            // Remover da lista de tokens ativos
            await this.redis.srem('active_fcm_tokens', fcmToken);

            // Encontrar e remover de todos os usuários
            const keys = await this.redis.keys('fcm_tokens:*');

            for (const key of keys) {
                const tokens = await this.redis.hgetall(key);
                for (const [token, data] of Object.entries(tokens)) {
                    if (token === fcmToken) {
                        await this.redis.hdel(key, token);
                        logger.info(`Token inválido removido de ${key}`);
                        break;
                    }
                }
            }

        } catch (error) {
            logger.error('❌ Erro ao remover token inválido:', error);
        }
    }

    // Obter estatísticas do serviço
    async getServiceStats() {
        try {
            const activeTokensCount = await this.redis.scard('active_fcm_tokens');
            const totalUsers = await this.redis.keys('fcm_tokens:*').length;

            return {
                activeTokens: activeTokensCount,
                totalUsers,
                isServiceAvailable: this.isServiceAvailable(),
                rateLimitCounts: Object.fromEntries(this.rateLimitCounts)
            };

        } catch (error) {
            logger.error('❌ Erro ao obter estatísticas do serviço:', error);
            return {
                activeTokens: 0,
                totalUsers: 0,
                isServiceAvailable: false,
                error: error.message
            };
        }
    }

    // Limpar dados antigos
    async cleanupOldData() {
        try {
            const now = Date.now();
            const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

            const keys = await this.redis.keys('fcm_tokens:*');

            for (const key of keys) {
                const tokens = await this.redis.hgetall(key);
                const updatedTokens = {};

                for (const [token, data] of Object.entries(tokens)) {
                    try {
                        const tokenData = JSON.parse(data);
                        const lastUpdated = new Date(tokenData.lastUpdated).getTime();

                        if (lastUpdated > thirtyDaysAgo) {
                            updatedTokens[token] = data;
                        }
                    } catch (parseError) {
                        // Manter token se não conseguir fazer parse
                        updatedTokens[token] = data;
                    }
                }

                // Atualizar hash com tokens válidos
                if (Object.keys(updatedTokens).length > 0) {
                    await this.redis.del(key);
                    await this.redis.hset(key, updatedTokens);
                } else {
                    await this.redis.del(key);
                }
            }

            logger.info('🧹 Limpeza de dados FCM concluída');

        } catch (error) {
            logger.error('❌ Erro ao limpar dados antigos:', error);
        }
    }

    // Destruir serviço
    destroy() {
        try {
            this.redis.disconnect();
            this.isInitialized = false;
            logger.info('✅ FCM Service destruído');
        } catch (error) {
            logger.error('❌ Erro ao destruir FCM Service:', error);
        }
    }
}

module.exports = FCMService;
