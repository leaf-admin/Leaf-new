const admin = require('firebase-admin');
const Redis = require('ioredis');
const { logger, logStructured } = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const circuitBreakerService = require('./circuit-breaker-service');
const traceContext = require('../utils/trace-context');

const FCM_METRICS_TTL_SECONDS = 35 * 24 * 60 * 60;

function getDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function isInvalidFcmTokenError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return code === 'messaging/invalid-registration-token'
        || code === 'messaging/registration-token-not-registered'
        || /requested entity was not found/i.test(message)
        || /registration token.*not registered/i.test(message);
}

function isThirdPartyAuthError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return code === 'messaging/third-party-auth-error'
        || /missing required authentication credential/i.test(message)
        || /APNS_AUTH_ERROR|THIRD_PARTY_AUTH_ERROR/i.test(message);
}

function redactFcmToken(token) {
    const value = String(token || '').trim();
    if (!value) return '<empty>';
    if (value.length <= 16) return `${value.slice(0, 4)}...`;
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function normalizeTokenTimestamp(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveServiceAccountPath() {
    const candidates = [
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        path.join(__dirname, '..', 'firebase-credentials.json'),
        path.join(__dirname, '..', '..', 'mobile-app', 'config', 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json')
    ]
        .map((candidate) => String(candidate || '').trim())
        .filter(Boolean);

    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || null;
}

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

    async getRedisClient(operation = 'unknown') {
        if (!this.redis) {
            logStructured('warn', 'Redis não configurado no FCM Service', {
                service: 'fcm',
                operation
            });
            return null;
        }

        // Em testes unitários/mocks o client pode não expor `status`.
        if (typeof this.redis.status === 'undefined') {
            return this.redis;
        }

        if (this.redis.status !== 'ready' && this.redis.status !== 'connect') {
            if (typeof this.redis.connect !== 'function') {
                logStructured('warn', 'Redis client sem metodo connect no FCM Service', {
                    service: 'fcm',
                    operation,
                    status: this.redis.status
                });
                return null;
            }
            try {
                await this.redis.connect();
            } catch (connectError) {
                const message = String(connectError?.message || '');
                if (!message.includes('already connecting') && !message.includes('already connected')) {
                    logStructured('error', 'Erro ao conectar Redis no FCM Service', {
                        service: 'fcm',
                        operation,
                        error: message
                    });
                    return null;
                }
            }
        }

        return this.redis;
    }

    // Inicializar o serviço FCM
    async initialize() {
        const startTime = Date.now();
        try {
            // Verificar se Firebase Admin já foi inicializado
            const initializedApps = Array.isArray(admin.apps) ? admin.apps : [];
            if (!initializedApps.length) {
                const serviceAccountPath = resolveServiceAccountPath();

                try {
                    if (typeof admin.initializeApp !== 'function') {
                        throw new Error('Firebase Admin initializeApp indisponível');
                    }
                    if (!serviceAccountPath) {
                        throw new Error('Firebase service account path nao configurado');
                    }
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
        return (this.isInitialized || (Array.isArray(admin.apps) && admin.apps.length > 0)) &&
            typeof admin.messaging === 'function';
    }

    async scanKeys(redis, pattern, count = 100) {
        if (!redis) return [];

        if (typeof redis.scan === 'function') {
            const keys = [];
            let cursor = '0';
            do {
                const reply = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
                cursor = String(reply?.[0] || '0');
                keys.push(...(reply?.[1] || []));
            } while (cursor !== '0');
            return keys;
        }

        if (typeof redis.keys === 'function') {
            logStructured('warn', 'Redis SCAN indisponível; usando KEYS como fallback em mock/cliente legado', {
                service: 'fcm',
                operation: 'scanKeys',
                pattern
            });
            return redis.keys(pattern);
        }

        return [];
    }

    async incrementDailyMetric(metric, increment = 1, operation = 'metric') {
        const metricName = String(metric || '').trim();
        if (!metricName) return;

        try {
            const redis = await this.getRedisClient(operation);
            if (!redis) return;
            const key = `fcm_metrics:${getDayKey()}`;
            const amount = Math.max(1, Math.trunc(Number(increment) || 1));

            if (typeof redis.hincrby === 'function') {
                await redis.hincrby(key, metricName, amount);
            } else {
                const current = typeof redis.hget === 'function'
                    ? toNumber(await redis.hget(key, metricName), 0)
                    : 0;
                await redis.hset(key, metricName, String(current + amount));
            }

            if (typeof redis.expire === 'function') {
                await redis.expire(key, FCM_METRICS_TTL_SECONDS);
            }
        } catch (error) {
            logStructured('warn', 'Falha ao registrar metrica FCM', {
                service: 'fcm',
                operation,
                metric: metricName,
                error: error.message
            });
        }
    }

    async incrementDailyMetrics(metrics = {}, operation = 'metrics') {
        const entries = Object.entries(metrics)
            .map(([metric, value]) => [metric, Math.trunc(Number(value) || 0)])
            .filter(([, value]) => value > 0);

        for (const [metric, value] of entries) {
            await this.incrementDailyMetric(metric, value, operation);
        }
    }

    async getDeliveryMetrics(date = getDayKey()) {
        try {
            const redis = await this.getRedisClient('getDeliveryMetrics');
            if (!redis?.hgetall) {
                return {
                    date,
                    totalSent: 0,
                    successful: 0,
                    failed: 0,
                    successRate: null
                };
            }

            const rawMetrics = await redis.hgetall(`fcm_metrics:${date}`);
            const metrics = Object.fromEntries(
                Object.entries(rawMetrics || {}).map(([key, value]) => [key, toNumber(value, 0)])
            );
            const totalSent = toNumber(metrics.totalSent, 0);
            const successful = toNumber(metrics.successful, 0);
            const failed = toNumber(metrics.failed, 0);

            return {
                date,
                totalSent,
                successful,
                failed,
                successRate: totalSent > 0 ? Number(((successful / totalSent) * 100).toFixed(1)) : null,
                tokenRegistrations: toNumber(metrics.tokenRegistrations, 0),
                temporaryTokenRegistrations: toNumber(metrics.temporaryTokenRegistrations, 0),
                authenticatedTokenRegistrations: toNumber(metrics.authenticatedTokenRegistrations, 0),
                tokenRegistrationFailures: toNumber(metrics.tokenRegistrationFailures, 0),
                noTokenUsers: toNumber(metrics.noTokenUsers, 0),
                rateLimited: toNumber(metrics.rateLimited, 0),
                serviceUnavailable: toNumber(metrics.serviceUnavailable, 0),
                invalidTokensRemoved: toNumber(metrics.invalidTokensRemoved, 0),
                rideStatusPushes: toNumber(metrics.rideStatusPushes, 0)
            };
        } catch (error) {
            logger.error('❌ Erro ao obter métricas de entrega FCM:', error);
            return {
                date,
                totalSent: 0,
                successful: 0,
                failed: 0,
                successRate: null,
                error: error.message
            };
        }
    }

    // Salvar token FCM de um usuário
    async saveUserFCMToken(userId, userType, fcmToken, deviceInfo = {}) {
        try {
            const redis = await this.getRedisClient('saveUserFCMToken');
            if (!redis) return false;

            if (!fcmToken) {
                logStructured('warn', 'Token FCM vazio', {
                    service: 'fcm',
                    operation: 'saveUserFCMToken',
                    userId
                });
                await this.incrementDailyMetric('tokenRegistrationFailures', 1, 'saveUserFCMToken');
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
            await redis.hset(
                `fcm_tokens:${userId}`,
                fcmToken,
                JSON.stringify(tokenData)
            );

            // Adicionar à lista de tokens ativos
            await redis.sadd('active_fcm_tokens', fcmToken);
            if (typeof redis.sadd === 'function') {
                await redis.sadd(`fcm_token_users:${fcmToken}`, userId);
                if (typeof redis.expire === 'function') {
                    await redis.expire(`fcm_token_users:${fcmToken}`, 2592000);
                }
            }

            // Definir TTL para o token (30 dias)
            await redis.expire(`fcm_tokens:${userId}`, 2592000);

            logStructured('info', 'Token FCM salvo', {
                service: 'fcm',
                operation: 'saveUserFCMToken',
                userId,
                userType
            });
            await this.incrementDailyMetrics({
                tokenRegistrations: 1,
                temporaryTokenRegistrations: deviceInfo.isTemporary ? 1 : 0,
                authenticatedTokenRegistrations: deviceInfo.authenticated ? 1 : 0
            }, 'saveUserFCMToken');
            return true;

        } catch (error) {
            logStructured('error', 'Erro ao salvar token FCM', {
                service: 'fcm',
                operation: 'saveUserFCMToken',
                userId,
                error: error.message
            });
            await this.incrementDailyMetric('tokenRegistrationFailures', 1, 'saveUserFCMToken');
            return false;
        }
    }

    // Obter tokens FCM de um usuário
    async getUserFCMTokens(userId) {
        try {
            const redis = await this.getRedisClient('getUserFCMTokens');
            if (!redis) return [];

            const tokens = await redis.hgetall(`fcm_tokens:${userId}`);
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

    /**
     * Resolve tokens FCM ativos para um usuário.
     * 1) Fonte canônica atual: user:{userId}/driver:{userId} -> fcmToken
     * 2) Índice multi-device: fcm_tokens:{userId}
     *
     * A fonte canônica vem primeiro porque o app atual atualiza esse campo no
     * handshake. O índice pode conter aparelhos antigos e não deve esconder o
     * token mais recente do device logado.
     */
    async resolveUserTokens(userId) {
        const normalizedUserId = String(userId || '').trim();
        if (!normalizedUserId) return [];

        const redis = await this.getRedisClient('resolveUserTokens');
        const activeTokens = await this.getUserFCMTokens(normalizedUserId);
        if (!redis) return activeTokens;

        const activeTokenSet = new Set(
            activeTokens
                .map((tokenData) => String(tokenData?.fcmToken || '').trim())
                .filter(Boolean)
        );

        const candidates = [];
        const addCandidate = (tokenData, sourcePriority, source) => {
            const token = String(tokenData?.fcmToken || '').trim();
            if (!token) return;
            const timestamp = normalizeTokenTimestamp(
                tokenData.fcmTokenUpdated ||
                tokenData.lastUpdated ||
                tokenData.authenticatedAt
            );
            candidates.push({
                ...tokenData,
                fcmToken: token,
                isActive: tokenData.isActive !== false,
                source,
                sourcePriority,
                sortTimestamp: timestamp
            });
        };

        const canonicalSources = [
            { key: `driver:${normalizedUserId}`, userType: 'driver' },
            { key: `user:${normalizedUserId}`, userType: 'customer' }
        ];

        for (const source of canonicalSources) {
            let data = {};
            if (typeof redis.hgetall === 'function') {
                data = await redis.hgetall(source.key) || {};
            }

            let canonicalToken = String(data.fcmToken || '').trim();
            if (!canonicalToken && typeof redis.hget === 'function') {
                canonicalToken = String(await redis.hget(source.key, 'fcmToken') || '').trim();
            }
            if (!canonicalToken) continue;

            addCandidate({
                userId: normalizedUserId,
                userType: source.userType,
                fcmToken: canonicalToken,
                platform: data.fcmPlatform || null,
                socketId: data.socketId || null,
                isTemporary: data.isTemporary === 'true' || data.isTemporary === true,
                fcmTokenUpdated: data.fcmTokenUpdated || null,
                lastUpdated: data.fcmTokenUpdated || null,
                isActive: true,
                migratedFromCanonical: !activeTokenSet.has(canonicalToken),
                needsBackfill: !activeTokenSet.has(canonicalToken)
            }, 0, source.key);
        }

        for (const tokenData of activeTokens) {
            addCandidate(tokenData, 1, 'fcm_tokens');
        }

        candidates.sort((a, b) => {
            if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
            return b.sortTimestamp - a.sortTimestamp;
        });

        const dedupe = new Set();
        const resolved = [];

        for (const tokenData of candidates) {
            const token = String(tokenData?.fcmToken || '').trim();
            if (!token || dedupe.has(token) || tokenData.isActive === false) continue;

            dedupe.add(token);
            resolved.push({
                ...tokenData,
                sortTimestamp: undefined,
                sourcePriority: undefined,
                needsBackfill: undefined
            });

            if (tokenData.needsBackfill) {
                await this.saveUserFCMToken(normalizedUserId, tokenData.userType, token, {
                    migratedFromCanonical: true,
                    platform: tokenData.platform,
                    socketId: tokenData.socketId,
                    isTemporary: tokenData.isTemporary
                });
            }
        }

        return resolved;
    }

    // Remover token FCM de um usuário
    async removeUserFCMToken(userId, fcmToken) {
        try {
            const redis = await this.getRedisClient('removeUserFCMToken');
            if (!redis) return false;

            // Remover do hash do usuário
            await redis.hdel(`fcm_tokens:${userId}`, fcmToken);

            let shouldRemoveActiveToken = true;
            if (typeof redis.srem === 'function') {
                await redis.srem(`fcm_token_users:${fcmToken}`, userId);
                if (typeof redis.smembers === 'function') {
                    const remainingUsers = await redis.smembers(`fcm_token_users:${fcmToken}`);
                    shouldRemoveActiveToken = remainingUsers.length === 0;
                }
            }

            // Remover da lista de tokens ativos somente se nenhum usuário ainda usa o token.
            if (shouldRemoveActiveToken) {
                await redis.srem('active_fcm_tokens', fcmToken);
            }

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
                await this.incrementDailyMetric('serviceUnavailable', 1, 'sendNotificationToUser');
                return { success: false, error: 'FCM Service não disponível' };
            }

            // Verificar rate limiting
            if (!this.checkRateLimit(userId)) {
                logStructured('warn', 'Rate limit excedido', {
                    service: 'fcm',
                    operation: 'sendNotificationToUser',
                    userId
                });
                await this.incrementDailyMetric('rateLimited', 1, 'sendNotificationToUser');
                return { success: false, error: 'Rate limit excedido' };
            }

            // Obter tokens FCM do usuário (com fallback legado)
            const userTokens = await this.resolveUserTokens(userId);

            if (userTokens.length === 0) {
                logStructured('warn', 'Usuário não possui tokens FCM ativos', {
                    service: 'fcm',
                    operation: 'sendNotificationToUser',
                    userId
                });
                await this.incrementDailyMetric('noTokenUsers', 1, 'sendNotificationToUser');
                return { success: false, error: 'Nenhum token FCM encontrado' };
            }

            // Enviar para todos os dispositivos do usuário
            const results = [];
            for (const tokenData of userTokens) {
                try {
                    const result = await this.sendToToken(tokenData.fcmToken, notification);
                    results.push({
                        tokenPreview: redactFcmToken(tokenData.fcmToken),
                        tokenSource: tokenData.source || 'unknown',
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
                        tokenPreview: redactFcmToken(tokenData.fcmToken),
                        tokenSource: tokenData.source || 'unknown',
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
                null,
                {
                    failureThreshold: 5,
                    timeout: 60000
                }
            );

            logger.info(`✅ Notificação enviada para token ${redactFcmToken(fcmToken)}: ${response}`);
            await this.incrementDailyMetrics({
                totalSent: 1,
                successful: 1
            }, 'sendToToken');

            return {
                success: true,
                messageId: response
            };

        } catch (error) {
            logger.error(`❌ Erro ao enviar notificação para token ${redactFcmToken(fcmToken)}:`, error);

            if (isThirdPartyAuthError(error)) {
                logStructured('error', 'Erro de autenticacao third-party no FCM/APNs', {
                    service: 'fcm',
                    operation: 'sendToToken',
                    tokenPreview: redactFcmToken(fcmToken),
                    code: error.code || null,
                    hint: 'Configurar APNs Authentication Key no Firebase para o bundle iOS correto'
                });
            }

            // Se o token for inválido, removê-lo
            if (isInvalidFcmTokenError(error)) {
                await this.removeInvalidToken(fcmToken);
            }
            await this.incrementDailyMetrics({
                totalSent: 1,
                failed: 1
            }, 'sendToToken');

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
                null,
                {
                    failureThreshold: 5,
                    timeout: 60000
                }
            );

            logger.info(`✅ Notificação interativa enviada para token ${redactFcmToken(fcmToken)}: ${response}`);
            await this.incrementDailyMetrics({
                totalSent: 1,
                successful: 1
            }, 'sendInteractiveNotification');

            return {
                success: true,
                messageId: response
            };

        } catch (error) {
            logger.error(`❌ Erro ao enviar notificação interativa para token ${redactFcmToken(fcmToken)}:`, error);

            if (isThirdPartyAuthError(error)) {
                logStructured('error', 'Erro de autenticacao third-party no FCM/APNs', {
                    service: 'fcm',
                    operation: 'sendInteractiveNotification',
                    tokenPreview: redactFcmToken(fcmToken),
                    code: error.code || null,
                    hint: 'Configurar APNs Authentication Key no Firebase para o bundle iOS correto'
                });
            }

            if (isInvalidFcmTokenError(error)) {
                await this.removeInvalidToken(fcmToken);
            }
            await this.incrementDailyMetrics({
                totalSent: 1,
                failed: 1
            }, 'sendInteractiveNotification');

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

            const redis = await this.getRedisClient('sendRideStatusUpdate');
            if (!redis) return { success: false, error: 'Redis indisponível' };

            const resolvedTokens = await this.resolveUserTokens(userId);
            const fcmTokens = resolvedTokens
                .map((tokenData) => String(tokenData?.fcmToken || '').trim())
                .filter(Boolean);

            if (fcmTokens.length === 0) {
                logger.warn(`⚠️ [FCMService] sendRideStatusUpdate ignorado: Sem token para ${userId}`);
                return { success: false, error: 'Token FCM não encontrado' };
            }

            const nowIso = new Date().toISOString();
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
                timestamp: String(rideData.timestamp || nowIso),
                phaseStartedAt: String(
                    rideData.phaseStartedAt ||
                    rideData.acceptedAt ||
                    rideData.arrivedAt ||
                    rideData.startedAt ||
                    nowIso
                )
            };

            if (rideData.pickup) dataPayload.pickup = JSON.stringify(rideData.pickup);
            if (rideData.destination) dataPayload.destination = JSON.stringify(rideData.destination);

            [
                'pickupEstimatedTime',
                'pickupEtaMinutes',
                'estimatedPickupTime',
                'tripEstimatedTime',
                'tripEstimatedMinutes',
                'estimatedTripTime',
                'tripEtaMinutes',
                'durationMinutes',
                'estimatedDuration',
                'duration',
                'acceptedAt',
                'arrivedAt',
                'startedAt'
            ].forEach((field) => {
                if (rideData[field] !== null && typeof rideData[field] !== 'undefined') {
                    dataPayload[field] = String(rideData[field]);
                }
            });

            let successCount = 0;
            for (const fcmToken of fcmTokens) {
                const message = {
                    token: fcmToken,
                    data: dataPayload,
                    android: { priority: 'high' },
                    apns: { payload: { aps: { 'content-available': 1 } } }
                };

                try {
                    await admin.messaging().send(message);
                    successCount++;
                    await this.incrementDailyMetrics({
                        totalSent: 1,
                        successful: 1,
                        rideStatusPushes: 1
                    }, 'sendRideStatusUpdate');
                } catch (err) {
                    logger.warn(`⚠️ Erro push silencioso fcm=${redactFcmToken(fcmToken)}: ${err.message}`);
                    if (isThirdPartyAuthError(err)) {
                        logStructured('error', 'Erro de autenticacao third-party no FCM/APNs', {
                            service: 'fcm',
                            operation: 'sendRideStatusUpdate',
                            tokenPreview: redactFcmToken(fcmToken),
                            code: err.code || null,
                            hint: 'Configurar APNs Authentication Key no Firebase para o bundle iOS correto'
                        });
                    }
                    if (isInvalidFcmTokenError(err)) {
                        await this.removeInvalidToken(fcmToken);
                    }
                    await this.incrementDailyMetrics({
                        totalSent: 1,
                        failed: 1,
                        rideStatusPushes: 1
                    }, 'sendRideStatusUpdate');
                }
            }
            logger.info(`✅ [FCMService] sendRideStatusUpdate enviado para ${userId} (Status: ${rideData.status})`);
            return {
                success: successCount > 0,
                count: successCount,
                ...(successCount > 0 ? {} : { error: 'Nenhum push FCM entregue' })
            };

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
            const redis = await this.getRedisClient('removeInvalidToken');
            if (!redis) return;
            const removeLegacyTokenForUser = async (userId) => {
                for (const key of [`user:${userId}`, `driver:${userId}`]) {
                    const legacyToken = await redis.hget(key, 'fcmToken');
                    if (legacyToken === fcmToken) {
                        await redis.hdel(key, 'fcmToken');
                        logger.info(`Token FCM legado inválido removido de ${key}`);
                    }
                }
            };

            // Remover da lista de tokens ativos
            await redis.srem('active_fcm_tokens', fcmToken);

            const indexedUserIds = typeof redis.smembers === 'function'
                ? await redis.smembers(`fcm_token_users:${fcmToken}`)
                : [];

            for (const userId of indexedUserIds) {
                await redis.hdel(`fcm_tokens:${userId}`, fcmToken);
                await removeLegacyTokenForUser(userId);
                logger.info(`Token inválido removido de fcm_tokens:${userId}`);
            }

            if (typeof redis.del === 'function') {
                await redis.del(`fcm_token_users:${fcmToken}`);
            }
            await this.incrementDailyMetric('invalidTokensRemoved', 1, 'removeInvalidToken');

            if (indexedUserIds.length > 0) {
                return;
            }

            // Fallback para tokens antigos que ainda não têm índice.
            const keys = await this.scanKeys(redis, 'fcm_tokens:*');

            for (const key of keys) {
                const tokens = await redis.hgetall(key);
                for (const [token, data] of Object.entries(tokens)) {
                    if (token === fcmToken) {
                        await redis.hdel(key, token);
                        await removeLegacyTokenForUser(key.replace('fcm_tokens:', ''));
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
            const redis = await this.getRedisClient('getServiceStats');
            if (!redis) {
                return {
                    activeTokens: 0,
                    totalUsers: 0,
                    isServiceAvailable: this.isServiceAvailable(),
                    error: 'Redis não configurado'
                };
            }

            const activeTokensCount = typeof redis.scard === 'function'
                ? await redis.scard('active_fcm_tokens')
                : 0;
            const totalUsers = (await this.scanKeys(redis, 'fcm_tokens:*')).length;
            const delivery = await this.getDeliveryMetrics();

            return {
                activeTokens: activeTokensCount,
                totalUsers,
                isServiceAvailable: this.isServiceAvailable(),
                rateLimitCounts: Object.fromEntries(this.rateLimitCounts),
                delivery,
                totalSent: delivery.totalSent,
                successful: delivery.successful,
                failed: delivery.failed,
                successRate: delivery.successRate
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
            const redis = await this.getRedisClient('cleanupOldData');
            if (!redis) return;

            const now = Date.now();
            const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

            const keys = await this.scanKeys(redis, 'fcm_tokens:*');

            for (const key of keys) {
                const tokens = await redis.hgetall(key);
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
                    await redis.del(key);
                    await redis.hset(key, updatedTokens);
                } else {
                    await redis.del(key);
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
            if (this.redis && typeof this.redis.disconnect === 'function') {
                this.redis.disconnect();
            }
            this.isInitialized = false;
            logger.info('✅ FCM Service destruído');
        } catch (error) {
            logger.error('❌ Erro ao destruir FCM Service:', error);
        }
    }
}

module.exports = FCMService;
