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
const rideQueueManager = require('../services/ride-queue-manager');
const metricsCollector = require('../services/metrics-collector');
const geospatialCache = require('../services/geospatial-cache');
const QueueWorker = require('../services/queue-worker');

// Instância do worker (será injetada)
let queueWorkerInstance = null;

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
        const redis = redisPool.getConnection();
        
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
        const hoursNum = parseInt(hours);
        
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
        const { limit = 50 } = req.query;
        const redis = redisPool.getConnection();
        
        // Buscar todas as chaves de notificações
        const notificationKeys = await redis.keys('ride_notifications:*');
        const notifiedDrivers = [];
        
        for (const key of notificationKeys.slice(0, parseInt(limit))) {
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
            totalNotifications: notificationKeys.length,
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
router.post('/api/queue/cache/clear', async (req, res) => {
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


