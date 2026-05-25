/**
 * ROUTES: QUEUE MONITORING DASHBOARD
 * 
 * Endpoints para monitoramento do sistema de filas:
 * - Status de filas por região
 * - Corridas pendentes/ativas
 * - Motoristas notificados
 * - Métricas de performance
 * - Estatísticas do cache geoespacial
 */

const express = require('express');
const router = express.Router();
const redisPool = require('../utils/redis-pool');
const RedisScan = require('../utils/redis-scan');
const rideQueueManager = require('../services/ride-queue-manager');
const metricsCollector = require('../services/metrics-collector');
const geospatialCache = require('../services/geospatial-cache');
const { authenticateSupport, requireSupportRoles } = require('../middleware/support-auth');

const QUEUE_MONITORING_READ_ROLES = ['admin', 'manager', 'super-admin', 'viewer'];
const QUEUE_MONITORING_WRITE_ROLES = ['admin', 'manager', 'super-admin'];

// Instância do worker (será injetada)
let queueWorkerInstance = null;

// Hotfix de segurança: endpoints de monitoramento de fila exigem autenticação de suporte/admin.
router.use(
    '/api/queue',
    authenticateSupport,
    requireSupportRoles(QUEUE_MONITORING_READ_ROLES)
);

/**
 * Injetar instância do QueueWorker
 */
function setQueueWorker(worker) {
    queueWorkerInstance = worker;
}

/**
 * GET /api/queue/status
 * Status geral das filas
 */
router.get('/api/queue/status', async (req, res) => {
    try {
        // Buscar todas as regiões com filas
        const regions = await rideQueueManager.getActiveRegions();
        
        const status = {
            timestamp: new Date().toISOString(),
            totalRegions: regions.length,
            regions: [],
            totalPending: 0,
            totalActive: 0,
            worker: {
                isRunning: queueWorkerInstance ? queueWorkerInstance.isRunning : false,
                stats: queueWorkerInstance ? await queueWorkerInstance.getStats() : null
            }
        };
        
        // Status por região
        for (const regionHash of regions) {
            const stats = await rideQueueManager.getQueueStats(regionHash);
            status.regions.push({
                regionHash,
                pending: stats.pending,
                active: stats.active,
                total: stats.total
            });
            
            status.totalPending += stats.pending;
            status.totalActive += stats.active;
        }
        
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/queue/region/:regionHash
 * Detalhes de uma região específica
 */
router.get('/api/queue/region/:regionHash', async (req, res) => {
    try {
        const { regionHash } = req.params;
        
        const stats = await rideQueueManager.getQueueStats(regionHash);
        
        // Buscar corridas pendentes
        const pendingRides = await rideQueueManager.getPendingRides(regionHash, 20);
        
        // Buscar corridas ativas
        const redis = redisPool.getConnection();
        const activeQueueKey = `ride_queue:${regionHash}:active`;
        const activeBookings = await redis.hgetall(activeQueueKey);
        
        res.json({
            regionHash,
            stats,
            pendingRides: pendingRides.map(bookingId => ({
                bookingId,
                status: 'PENDING'
            })),
            activeRides: Object.keys(activeBookings).map(bookingId => ({
                bookingId,
                status: 'ACTIVE'
            })),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/queue/metrics
 * Métricas de performance do sistema de filas
 */
router.get('/api/queue/metrics', async (req, res) => {
    try {
        const { hours = 1 } = req.query;
        const parsedHours = Number.parseInt(hours, 10);
        const hoursNum = Number.isFinite(parsedHours)
            ? Math.min(Math.max(parsedHours, 1), 168)
            : 1;
        
        const metrics = await metricsCollector.getAllMetrics(hoursNum);
        
        // Adicionar métricas do cache geoespacial
        const cacheStats = await geospatialCache.getStats();
        
        res.json({
            ...metrics,
            cache: cacheStats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/queue/drivers/notified
 * Lista de motoristas notificados (últimas N corridas)
 */
router.get('/api/queue/drivers/notified', async (req, res) => {
    try {
        const { limit = 50, includeTotal = 'false' } = req.query;
        const redis = redisPool.getConnection();
        const parsedLimit = Number.parseInt(limit, 10);
        const safeLimit = Number.isFinite(parsedLimit)
            ? Math.min(Math.max(parsedLimit, 1), 200)
            : 50;
        const shouldIncludeTotal = String(includeTotal).toLowerCase() === 'true';

        // Hotfix de performance: SCAN com limite evita KEYS bloqueante e reduz custo de monitoramento.
        const scannedKeys = await RedisScan.scanKeys(
            redis,
            'ride_notifications:*',
            undefined,
            safeLimit + 1
        );
        const hasMore = scannedKeys.length > safeLimit;
        const notificationKeys = scannedKeys.slice(0, safeLimit);
        const notifiedDrivers = [];

        for (const key of notificationKeys) {
            const bookingId = key.replace('ride_notifications:', '');
            const driverIds = await redis.smembers(key);
            
            notifiedDrivers.push({
                bookingId,
                notifiedCount: driverIds.length,
                drivers: driverIds
            });
        }
        
        res.json({
            timestamp: new Date().toISOString(),
            totalNotifications: shouldIncludeTotal
                ? await RedisScan.countKeys(redis, 'ride_notifications:*')
                : notificationKeys.length,
            exactTotal: shouldIncludeTotal,
            hasMore,
            rides: notifiedDrivers
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/queue/cache/stats
 * Estatísticas do cache geoespacial
 */
router.get('/api/queue/cache/stats', async (req, res) => {
    try {
        const stats = await geospatialCache.getStats();
        
        res.json({
            timestamp: new Date().toISOString(),
            ...stats
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/queue/cache/clear
 * Limpar cache geoespacial
 */
router.post('/api/queue/cache/clear', requireSupportRoles(QUEUE_MONITORING_WRITE_ROLES), async (req, res) => {
    try {
        await geospatialCache.clear();
        
        res.json({
            success: true,
            message: 'Cache geoespacial limpo com sucesso',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/queue/worker/stats
 * Estatísticas do QueueWorker
 */
router.get('/api/queue/worker/stats', async (req, res) => {
    try {
        if (!queueWorkerInstance) {
            return res.status(404).json({ error: 'QueueWorker não encontrado' });
        }
        
        const stats = await queueWorkerInstance.getStats();
        
        res.json({
            timestamp: new Date().toISOString(),
            ...stats
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
module.exports.setQueueWorker = setQueueWorker;
