/**
 * ROUTES: Worker Health
 * 
 * Endpoints para monitorar saúde dos workers.
 */

const express = require('express');
const router = express.Router();
const WorkerHealthMonitor = require('../workers/health-monitor');
const { logStructured, logError } = require('../utils/logger');
const { authenticateSupport, requireSupportRoles } = require('../middleware/support-auth');

const healthMonitor = new WorkerHealthMonitor();
const WORKER_READ_ROLES = ['admin', 'manager', 'super-admin', 'viewer', 'development'];

// GET /api/workers/health - Health check dos workers
router.get('/api/workers/health', async (req, res) => {
    try {
        const health = await healthMonitor.getHealth();
        res.json(health);
    } catch (error) {
        logError(error, 'Erro ao obter health dos workers', {
            service: 'worker-health-routes'
        });
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// GET /api/workers/consumers - Listar consumers ativos
router.get('/api/workers/consumers', async (req, res) => {
    try {
        const consumers = await healthMonitor.getConsumers();
        res.json({
            success: true,
            consumers,
            count: consumers.length
        });
    } catch (error) {
        logError(error, 'Erro ao listar consumers', {
            service: 'worker-health-routes'
        });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/workers/lag - Obter lag do stream
router.get('/api/workers/lag', async (req, res) => {
    try {
        const lag = await healthMonitor.getStreamLag();
        res.json({
            success: true,
            lag
        });
    } catch (error) {
        logError(error, 'Erro ao obter lag', {
            service: 'worker-health-routes'
        });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/workers/pending - Obter eventos pendentes
router.get('/api/workers/pending', async (req, res) => {
    try {
        const { consumer, count = 10 } = req.query;
        const pending = await healthMonitor.getPendingEvents(consumer, parseInt(count));
        res.json({
            success: true,
            pending,
            count: pending.length
        });
    } catch (error) {
        logError(error, 'Erro ao obter eventos pendentes', {
            service: 'worker-health-routes'
        });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/workers/dlq - Obter tamanho da DLQ
router.get('/api/workers/dlq/events', authenticateSupport, requireSupportRoles(WORKER_READ_ROLES), async (req, res) => {
    try {
        const events = await healthMonitor.getDLQEvents({
            limit: req.query.limit,
            direction: req.query.direction,
            eventType: req.query.eventType,
            error: req.query.error
        });
        res.json({
            success: true,
            ...events
        });
    } catch (error) {
        logError(error, 'Erro ao listar eventos da DLQ', {
            service: 'worker-health-routes'
        });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/workers/dlq', async (req, res) => {
    try {
        const dlqSize = await healthMonitor.getDLQSize();
        res.json({
            success: true,
            dlqSize
        });
    } catch (error) {
        logError(error, 'Erro ao obter tamanho da DLQ', {
            service: 'worker-health-routes'
        });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
