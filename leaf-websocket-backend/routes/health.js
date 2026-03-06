/**
 * 🏥 Health Check Routes
 * 
 * Rotas para health checks do sistema
 */

const express = require('express');
const router = express.Router();
const healthCheckService = require('../services/health-check-service');
const { logStructured, logError } = require('../utils/logger');

/**
 * GET /health
 * Health check completo (todos os componentes)
 */
async function fullHealthHandler(req, res) {
  try {
    // Obter io do contexto global
    const io = global.io || null;
    const health = await healthCheckService.runAllChecks(io);
    
    // Retornar status HTTP apropriado
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'warning' ? 200 : 
                      health.status === 'degraded' ? 503 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    logError(error, 'Erro ao executar health checks', {
      service: 'health-routes',
      operation: 'full-check'
    });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Erro ao verificar saúde do sistema'
    });
  }
}

router.get('/health', fullHealthHandler);
router.get('/api/health', fullHealthHandler);

/**
 * GET /health/quick
 * Health check rápido (apenas críticos)
 */
router.get('/health/quick', async (req, res) => {
  try {
    const health = await healthCheckService.quickCheck();
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logError(error, 'Erro ao executar health check rápido', {
      service: 'health-routes',
      operation: 'quick-check'
    });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Erro ao verificar saúde do sistema'
    });
  }
});

/**
 * GET /health/readiness
 * Readiness probe (Kubernetes/Docker)
 */
router.get('/health/readiness', async (req, res) => {
  try {
    const health = await healthCheckService.quickCheck();
    
    if (health.status === 'healthy') {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not-ready',
        timestamp: new Date().toISOString(),
        reason: 'Critical services are not healthy'
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not-ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * GET /health/liveness
 * Liveness probe (Kubernetes/Docker)
 */
router.get('/health/liveness', (req, res) => {
  // Liveness é sempre OK se o processo está rodando
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
