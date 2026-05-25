// Rotas para Notificações Push
const express = require('express');
const router = express.Router();
const FCMService = require('../services/fcm-service');
const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');
const RedisScan = require('../utils/redis-scan');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');

const fcmService = new FCMService();
const ADMIN_ROLES = ['admin', 'super-admin', 'manager', 'development'];
const ALLOW_PUBLIC_DIRECT_FCM_SEND = String(process.env.ALLOW_PUBLIC_DIRECT_FCM_SEND || 'false').toLowerCase() === 'true';

function bindRedisToFcmService() {
    try {
        if (fcmService.redis) return fcmService.redis;
        const redis = redisPool.getConnection();
        if (redis) {
            fcmService.setRedis(redis);
        }
        return redis || null;
    } catch (error) {
        logStructured('warn', 'Nao foi possivel vincular Redis ao FCM Service', {
            service: 'notifications-routes',
            error: error.message
        });
        return null;
    }
}

// Middleware para verificar autenticação (obrigatório)
const requireAuth = (req, res, next) => authenticateJWT(req, res, next);
const requireAdminManager = (req, res, next) =>
    authenticateJWT(req, res, () => requireRole(ADMIN_ROLES)(req, res, next));
const requireSuperAdmin = (req, res, next) =>
    authenticateJWT(req, res, () => requireRole(['super-admin'])(req, res, next));

function isDirectTokenOnlyRequest(body = {}) {
    const hasFcmToken = Boolean(body.fcmToken);
    const hasUserIds = Array.isArray(body.userIds) && body.userIds.length > 0;
    const hasUserTypes = Array.isArray(body.userTypes) && body.userTypes.length > 0;
    return hasFcmToken && !hasUserIds && !hasUserTypes;
}

const requireSendAuth = (req, res, next) => {
    if (isDirectTokenOnlyRequest(req.body) && ALLOW_PUBLIC_DIRECT_FCM_SEND) {
        return next();
    }

    return authenticateJWT(req, res, () => requireRole(ADMIN_ROLES)(req, res, next));
};

function normalizeUserType(value) {
    const raw = String(value || '').toLowerCase().trim();
    if (!raw) return '';
    if (raw === 'passenger') return 'customer';
    if (raw === 'user') return 'customer';
    return raw;
}

function normalizeUserTypes(userTypes = []) {
    if (!Array.isArray(userTypes)) return [];
    const normalized = userTypes
        .map((userType) => normalizeUserType(userType))
        .filter((userType) => userType === 'driver' || userType === 'customer');
    return [...new Set(normalized)];
}

function sanitizeIds(userIds = []) {
    if (!Array.isArray(userIds)) return [];
    return [...new Set(
        userIds
            .map((id) => String(id || '').trim())
            .filter(Boolean)
            .filter((id) => !id.includes(':'))
    )];
}

function parseDateValue(rawValue) {
    if (!rawValue) return null;

    if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
        return rawValue;
    }

    const rawText = String(rawValue).trim();
    if (!rawText) return null;

    const asNumber = Number(rawText);
    if (Number.isFinite(asNumber)) {
        // Heurística: timestamp em segundos vs milissegundos
        const millis = asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber;
        const dateFromNumber = new Date(millis);
        if (!Number.isNaN(dateFromNumber.getTime())) {
            return dateFromNumber;
        }
    }

    const dateFromText = new Date(rawText);
    if (!Number.isNaN(dateFromText.getTime())) {
        return dateFromText;
    }

    return null;
}

function getCreatedAtFromUserData(userData = {}) {
    const fields = [
        userData.createdAt,
        userData.created_at,
        userData.registrationDate,
        userData.registeredAt,
        userData.signUpAt
    ];

    for (const fieldValue of fields) {
        const parsed = parseDateValue(fieldValue);
        if (parsed) return parsed;
    }

    return null;
}

function matchesFilters(userData = {}, filters = {}) {
    if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
        return true;
    }

    const createdAt = getCreatedAtFromUserData(userData);
    const now = Date.now();

    const withinHours = Number(filters.registeredWithinHours);
    if (Number.isFinite(withinHours) && withinHours > 0) {
        if (!createdAt || (now - createdAt.getTime()) > withinHours * 60 * 60 * 1000) {
            return false;
        }
    }

    const withinDays = Number(filters.registeredWithinDays);
    if (Number.isFinite(withinDays) && withinDays > 0) {
        if (!createdAt || (now - createdAt.getTime()) > withinDays * 24 * 60 * 60 * 1000) {
            return false;
        }
    }

    const olderThanDays = Number(filters.registeredMoreThanDays);
    if (Number.isFinite(olderThanDays) && olderThanDays > 0) {
        if (!createdAt || (now - createdAt.getTime()) < olderThanDays * 24 * 60 * 60 * 1000) {
            return false;
        }
    }

    const olderThanMonths = Number(filters.registeredMoreThanMonths);
    if (Number.isFinite(olderThanMonths) && olderThanMonths > 0) {
        if (!createdAt || (now - createdAt.getTime()) < olderThanMonths * 30 * 24 * 60 * 60 * 1000) {
            return false;
        }
    }

    const registeredAfter = parseDateValue(filters.registeredAfter);
    if (registeredAfter) {
        if (!createdAt || createdAt.getTime() < registeredAfter.getTime()) {
            return false;
        }
    }

    const registeredBefore = parseDateValue(filters.registeredBefore);
    if (registeredBefore) {
        if (!createdAt || createdAt.getTime() > registeredBefore.getTime()) {
            return false;
        }
    }

    return true;
}

async function ensureRedisConnection(redis) {
    if (redis.status === 'ready' || redis.status === 'connect') {
        return;
    }

    try {
        await redis.connect();
    } catch (connectError) {
        if (!connectError.message.includes('already connecting') &&
            !connectError.message.includes('already connected')) {
            throw connectError;
        }
    }
}

async function getUserProfile(redis, userId) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) return null;

    const driverData = await redis.hgetall(`driver:${safeUserId}`);
    if (driverData && Object.keys(driverData).length > 0) {
        return {
            id: safeUserId,
            userType: 'driver',
            ...driverData
        };
    }

    const userData = await redis.hgetall(`user:${safeUserId}`);
    if (userData && Object.keys(userData).length > 0) {
        return {
            id: safeUserId,
            userType: normalizeUserType(userData.type || userData.userType || 'customer'),
            ...userData
        };
    }

    return null;
}

async function buildTargetsFromUserTypes(redis, userTypes = []) {
    const normalizedUserTypes = normalizeUserTypes(userTypes);
    const allUsers = [];

    for (const userType of normalizedUserTypes) {
        if (userType === 'driver') {
            const driverIds = await RedisScan.scanIds(redis, 'driver:*', 'driver:');
            allUsers.push(...sanitizeIds(driverIds));
            continue;
        }

        if (userType === 'customer') {
            const customerIds = await RedisScan.scanIds(redis, 'user:*', 'user:');
            allUsers.push(...sanitizeIds(customerIds));
        }
    }

    return sanitizeIds(allUsers);
}

async function filterUsersByType(redis, userIds = [], userTypes = []) {
    const allowedTypes = normalizeUserTypes(userTypes);
    if (allowedTypes.length === 0) {
        return sanitizeIds(userIds);
    }

    const sanitizedUserIds = sanitizeIds(userIds);
    const filteredUsers = [];

    for (const userId of sanitizedUserIds) {
        const profile = await getUserProfile(redis, userId);
        const profileType = normalizeUserType(profile?.userType);
        if (allowedTypes.includes(profileType)) {
            filteredUsers.push(userId);
        }
    }

    return sanitizeIds(filteredUsers);
}

async function applyFilters(redis, userIds = [], filters = {}) {
    if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
        return sanitizeIds(userIds);
    }

    const sanitizedUserIds = sanitizeIds(userIds);
    const filteredUsers = [];

    for (const userId of sanitizedUserIds) {
        const profile = await getUserProfile(redis, userId);
        if (!profile) continue;
        if (matchesFilters(profile, filters)) {
            filteredUsers.push(userId);
        }
    }

    return sanitizeIds(filteredUsers);
}

// Inicializar FCM Service
(async () => {
    try {
        const redis = bindRedisToFcmService();
        if (redis) {
            await ensureRedisConnection(redis);
        }
        await fcmService.initialize();
    } catch (error) {
        logError(error, 'Erro ao inicializar FCM Service', {
            service: 'notifications',
            operation: 'initialize'
        });
    }
})();

// GET - Página principal de notificações
router.get('/', requireAuth, async (req, res) => {
    try {
        const stats = await fcmService.getServiceStats();
        res.json({
            success: true,
            data: {
                stats,
                endpoints: {
                    sendNotification: '/api/notifications/send',
                    scheduleNotification: '/api/notifications/schedule',
                    getScheduled: '/api/notifications/scheduled',
                    getStats: '/api/notifications/stats'
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST - Enviar notificação imediata
// Requer autenticação administrativa para envios em lote.
// Envio direto por fcmToken pode ser público apenas quando ALLOW_PUBLIC_DIRECT_FCM_SEND=true.
router.post('/send', requireSendAuth, async (req, res) => {
    try {
        bindRedisToFcmService();
        const { userIds, title, body, data, imageUrl, priority, fcmToken, filters } = req.body;
        const normalizedUserTypes = normalizeUserTypes(req.body.userTypes || []);
        const safeFilters = (filters && typeof filters === 'object') ? filters : {};
        
        // Validar que temos pelo menos uma forma de identificar destinatários
        if (!userIds && !fcmToken && normalizedUserTypes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'userIds, fcmToken ou userTypes são obrigatórios'
            });
        }
        
        if (!title || !body) {
            return res.status(400).json({
                success: false,
                error: 'title e body são obrigatórios'
            });
        }
        
        // Se foi fornecido fcmToken direto, enviar para ele
        if (fcmToken && (!Array.isArray(userIds) || userIds.length === 0) && normalizedUserTypes.length === 0) {
            const notification = {
                title,
                body,
                data: data || {},
                imageUrl,
                priority: priority || 'normal'
            };
            
            const result = await fcmService.sendToToken(fcmToken, notification);
            
            return res.json({
                success: result.success,
                messageId: result.messageId,
                error: result.error
            });
        }

        // Se apenas userTypes foi fornecido (sem userIds), buscar todos os usuários daquele tipo
        let targetUsers = sanitizeIds(userIds || []);
        let filteredOutByType = 0;
        let filteredOutByRule = 0;

        const redis = redisPool.getConnection();
        await ensureRedisConnection(redis);

        if (targetUsers.length === 0 && normalizedUserTypes.length > 0) {
            targetUsers = await buildTargetsFromUserTypes(redis, normalizedUserTypes);
            logStructured('info', `📊 Encontrados ${targetUsers.length} usuários dos tipos: ${normalizedUserTypes.join(', ')}`, { service: 'notifications-routes' });
        } else if (targetUsers.length > 0 && normalizedUserTypes.length > 0) {
            const beforeTypeFilter = targetUsers.length;
            targetUsers = await filterUsersByType(redis, targetUsers, normalizedUserTypes);
            filteredOutByType = beforeTypeFilter - targetUsers.length;
        }

        if (targetUsers.length > 0 && Object.keys(safeFilters).length > 0) {
            const beforeRuleFilter = targetUsers.length;
            targetUsers = await applyFilters(redis, targetUsers, safeFilters);
            filteredOutByRule = beforeRuleFilter - targetUsers.length;
        }
        
        if (targetUsers.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum usuário encontrado com os critérios especificados'
            });
        }

        const notification = {
            title,
            body,
            data: data || {},
            imageUrl,
            priority: priority || 'normal'
        };

      const result = await fcmService.sendNotificationToUsers(targetUsers, notification);
      
        res.json({
        success: result.success !== false,
        data: {
          sentTo: targetUsers.length,
          userTypes: normalizedUserTypes,
          appliedFilters: safeFilters,
          filteredOutByType,
          filteredOutByRule,
          results: result.results || [],
          summary: result.summary || { total: targetUsers.length, success: 0, failed: 0 },
          notification
        }
      });

    } catch (error) {
      logError(error, '❌ Erro ao enviar notificação:', { service: 'notifications-routes' });
      res.status(500).json({ 
        success: false, 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
});

// POST - Programar notificação
router.post('/schedule', requireAdminManager, async (req, res) => {
    try {
        const { 
            userIds, 
            userTypes, 
            title, 
            body, 
            data, 
            schedule, 
            recurrence,
            endDate 
        } = req.body;

        if (!userIds || !title || !body || !schedule) {
            return res.status(400).json({
                success: false,
                error: 'userIds, title, body e schedule são obrigatórios'
            });
        }

        if (recurrence && recurrence !== 'none') {
            return res.status(501).json({
                success: false,
                status: 'not_implemented',
                code: 'RECURRING_NOTIFICATIONS_NOT_IMPLEMENTED',
                error: 'Notificações recorrentes ainda não possuem worker/scheduler ativo'
            });
        }

        const scheduledNotification = {
            id: `scheduled_${Date.now()}`,
            userIds,
            userTypes,
            title,
            body,
            data: data || {},
            schedule: new Date(schedule),
            recurrence: recurrence || 'none', // none, daily, weekly, monthly
            endDate: endDate ? new Date(endDate) : null,
            createdAt: new Date(),
            status: 'scheduled'
        };

        // Salvar no Redis
        const redis = redisPool.getConnection();
        if (redis.status !== 'ready' && redis.status !== 'connect') {
            try {
                await redis.connect();
            } catch (connectError) {
                if (!connectError.message.includes('already connecting') && 
                    !connectError.message.includes('already connected')) {
                    logStructured('error', '❌ Erro ao conectar Redis:', connectError, { service: 'notifications-routes' });
                }
            }
        }
        await redis.hset(
            `scheduled_notifications:${scheduledNotification.id}`,
            scheduledNotification
        );

        res.json({
            success: true,
            data: {
                scheduledNotification,
                message: 'Notificação programada com sucesso'
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET - Listar notificações programadas
router.get('/scheduled', requireAdminManager, async (req, res) => {
    try {
        const redis = redisPool.getConnection();
        if (redis.status !== 'ready' && redis.status !== 'connect') {
            try {
                await redis.connect();
            } catch (connectError) {
                if (!connectError.message.includes('already connecting') && 
                    !connectError.message.includes('already connected')) {
                    logStructured('error', '❌ Erro ao conectar Redis:', connectError, { service: 'notifications-routes' });
                }
            }
        }
        const keys = await redis.keys('scheduled_notifications:*');
        const scheduledNotifications = [];

        for (const key of keys) {
            const notification = await redis.hgetall(key);
            if (notification.id) {
                scheduledNotifications.push(notification);
            }
        }

        res.json({
            success: true,
            data: scheduledNotifications
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE - Cancelar notificação programada
router.delete('/scheduled/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const key = `scheduled_notifications:${id}`;
        
        const redis = redisPool.getConnection();
        if (redis.status !== 'ready' && redis.status !== 'connect') {
            try {
                await redis.connect();
            } catch (connectError) {
                if (!connectError.message.includes('already connecting') && 
                    !connectError.message.includes('already connected')) {
                    logStructured('error', '❌ Erro ao conectar Redis:', connectError, { service: 'notifications-routes' });
                }
            }
        }
        const exists = await redis.exists(key);
        if (!exists) {
            return res.status(404).json({
                success: false,
                error: 'Notificação programada não encontrada'
            });
        }
        await redis.del(key);
        
        res.json({
            success: true,
            message: 'Notificação programada cancelada com sucesso'
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET - Estatísticas de notificações
router.get('/stats', requireAuth, async (req, res) => {
    try {
        bindRedisToFcmService();
        const stats = await fcmService.getServiceStats();
        const redis = redisPool.getConnection();
        await ensureRedisConnection(redis);
        const scheduledKeys = await redis.keys('scheduled_notifications:*');
        const scheduledCount = scheduledKeys ? scheduledKeys.length : 0;
        
        res.json({
            success: true,
            data: {
                fcm: stats,
                scheduled: scheduledCount,
                total: stats.activeTokens + scheduledCount
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
