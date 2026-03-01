// Rotas para Notificações Push
const express = require('express');
const router = express.Router();
const FCMService = require('../services/fcm-service');
const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');

const fcmService = new FCMService();

// Middleware para verificar autenticação (obrigatório)
const requireAuth = (req, res, next) => {
    // Implementar verificação de autenticação
    // Por enquanto, permite todas as requisições
    next();
};

// Middleware para autenticação opcional (permite requisições sem autenticação)
const optionalAuth = (req, res, next) => {
    // Tenta verificar autenticação, mas não bloqueia se não houver
    // Útil para permitir envio de notificações via fcmToken direto
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        // Se houver token, pode validar aqui (opcional)
        // Por enquanto, apenas passa adiante
    }
    next();
};

// Inicializar FCM Service
fcmService.initialize().catch((error) => {
    logError(error, 'Erro ao inicializar FCM Service', {
        service: 'notifications',
        operation: 'initialize'
    });
});

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

// POST - Enviar notificação imediata (NÃO REQUER AUTENTICAÇÃO)
// O token FCM já identifica o usuário, mesmo sem login
router.post('/send', optionalAuth, async (req, res) => {
    try {
        const { userIds, userTypes, title, body, data, imageUrl, priority, fcmToken } = req.body;
        
        // Validar que temos pelo menos uma forma de identificar destinatários
        if (!userIds && !fcmToken && (!userTypes || userTypes.length === 0)) {
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
        if (fcmToken && !userIds && (!userTypes || userTypes.length === 0)) {
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
        let targetUsers = userIds || [];
        if ((!userIds || userIds.length === 0) && userTypes && userTypes.length > 0) {
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
            
            // ✅ CORRIGIDO: Usar SCAN ao invés de KEYS() (não bloqueante)
            const RedisScan = require('../utils/redis-scan');
            const allUsers = [];
            for (const userType of userTypes) {
                if (userType === 'driver') {
                    // Buscar motoristas
                    const driverIds = await RedisScan.scanIds(redis, 'driver:*', 'driver:');
                    allUsers.push(...driverIds);
                } else if (userType === 'customer') {
                    // Buscar passageiros
                    const userIds = await RedisScan.scanIds(redis, 'user:*', 'user:');
                    for (const userId of userIds) {
                        // Verificar se não é um motorista
                        const type = await redis.hget(`user:${userId}`, 'type');
                        if (type === 'customer' || !type) {
                            allUsers.push(userId);
                        }
                    }
                }
            }
            targetUsers = [...new Set(allUsers)]; // Remover duplicatas
            logStructured('info', `📊 Encontrados ${targetUsers.length} usuários dos tipos: ${userTypes.join(', ')}`, { service: 'notifications-routes' });
        } else if (userIds && userTypes && userTypes.length > 0) {
            // Se ambos foram fornecidos, filtrar userIds por tipo
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
            const filteredUsers = [];
            for (const userId of userIds) {
                const userType = await redis.hget(`users:${userId}`, 'type') || 
                                await redis.hget(`user:${userId}`, 'type') ||
                                (await redis.exists(`driver:${userId}`) ? 'driver' : 'customer');
                if (userTypes.includes(userType)) {
                    filteredUsers.push(userId);
                }
            }
            targetUsers = filteredUsers;
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

// POST - Programar notificação recorrente
router.post('/schedule', requireAuth, async (req, res) => {
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

        // Se for recorrente, configurar cron job
        if (recurrence !== 'none') {
            await setupRecurringNotification(scheduledNotification);
        }

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
router.get('/scheduled', requireAuth, async (req, res) => {
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
router.delete('/scheduled/:id', requireAuth, async (req, res) => {
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
        const stats = await fcmService.getServiceStats();
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

// Função para configurar notificação recorrente
async function setupRecurringNotification(notification) {
    // Implementar lógica de cron job para notificações recorrentes
    // Pode usar node-cron ou similar
    logStructured('info', `🔔 Configurando notificação recorrente: ${notification.id}`, { service: 'notifications-routes' });
}

module.exports = router;
