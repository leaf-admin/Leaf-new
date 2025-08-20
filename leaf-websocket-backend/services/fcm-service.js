const admin = require('firebase-admin');
const Redis = require('ioredis');
const { logger } = require('../utils/logger');
const path = require('path');

class FCMService {
    constructor() {
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.isInitialized = false;
        this.rateLimitCounts = new Map();
        this.lastResetTime = Date.now();
    }

    // Inicializar o serviço FCM
    async initialize() {
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
                    logger.info('✅ Firebase Admin inicializado pelo FCM Service');
                } catch (initError) {
                    logger.error('❌ Erro ao inicializar Firebase Admin:', initError);
                    this.isInitialized = false;
                    return;
                }
            }

            this.isInitialized = true;
            logger.info('✅ FCM Service inicializado com sucesso');

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
                logger.warn(`Token FCM vazio para usuário ${userId}`);
                return false;
            }

            const tokenData = {
                userId,
                userType,
                fcmToken,
                deviceInfo,
                lastUpdated: new Date().toISOString(),
                isActive: true
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

            logger.info(`✅ Token FCM salvo para usuário ${userId} (${userType})`);
            return true;

        } catch (error) {
            logger.error(`❌ Erro ao salvar token FCM para usuário ${userId}:`, error);
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

            logger.info(`✅ Token FCM removido para usuário ${userId}`);
            return true;

        } catch (error) {
            logger.error(`❌ Erro ao remover token FCM para usuário ${userId}:`, error);
            return false;
        }
    }

    // Enviar notificação para um usuário específico
    async sendNotificationToUser(userId, notification) {
        try {
            if (!this.isServiceAvailable()) {
                logger.warn('FCM Service não disponível');
                return { success: false, error: 'FCM Service não disponível' };
            }

            // Verificar rate limiting
            if (!this.checkRateLimit(userId)) {
                logger.warn(`Rate limit excedido para usuário ${userId}`);
                return { success: false, error: 'Rate limit excedido' };
            }

            // Obter tokens FCM do usuário
            const userTokens = await this.getUserFCMTokens(userId);
            
            if (userTokens.length === 0) {
                logger.warn(`Usuário ${userId} não possui tokens FCM ativos`);
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
                    logger.error(`Erro ao enviar para token ${tokenData.fcmToken}:`, error);
                    results.push({
                        token: tokenData.fcmToken,
                        success: false,
                        error: error.message
                    });
                }
            }

            const successCount = results.filter(r => r.success).length;
            logger.info(`📤 Notificação enviada para usuário ${userId}: ${successCount}/${userTokens.length} dispositivos`);

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
            logger.error(`❌ Erro ao enviar notificação para usuário ${userId}:`, error);
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
                        defaultVibrateTimings: true
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: notification.badge || 1
                        }
                    }
                }
            };

            const response = await admin.messaging().send(message);
            
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
