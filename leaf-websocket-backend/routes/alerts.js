/**
 * 🚨 Alert Routes
 * 
 * Rotas para gerenciar e visualizar alertas
 */

const express = require('express');
const router = express.Router();
const alertService = require('../services/alert-service');
const { logStructured, logError } = require('../utils/logger');

/**
 * GET /
 * Listar alertas recentes
 */
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const severity = req.query.severity; // 'warning' | 'critical'
    
    let alerts = alertService.getAlertHistory(limit);
    
    // Filtrar por severidade se especificado
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }
    
    res.json({
      success: true,
      count: alerts.length,
      alerts: alerts
    });
  } catch (error) {
    logError(error, 'Erro ao listar alertas', {
      service: 'alerts-routes',
      operation: 'list'
    });
    res.status(500).json({
      success: false,
      error: 'Erro ao listar alertas'
    });
  }
});

/**
 * GET /stats
 * Obter estatísticas de alertas
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = alertService.getAlertStats();
    
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    logError(error, 'Erro ao obter estatísticas de alertas', {
      service: 'alerts-routes',
      operation: 'stats'
    });
    res.status(500).json({
      success: false,
      error: 'Erro ao obter estatísticas'
    });
  }
});

/**
 * POST /test
 * Testar envio de alerta (para desenvolvimento)
 */
router.post('/test', async (req, res) => {
  try {
    const { severity = 'warning', metric = 'test_metric', service = 'test-service' } = req.body;
    
    await alertService.sendAlert({
      severity,
      metric,
      value: 100,
      threshold: 80,
      unit: '%',
      message: `Teste de alerta ${severity}`,
      service
    });
    
    res.json({
      success: true,
      message: 'Alerta de teste enviado'
    });
  } catch (error) {
    logError(error, 'Erro ao enviar alerta de teste', {
      service: 'alerts-routes',
      operation: 'test'
    });
    res.status(500).json({
      success: false,
      error: 'Erro ao enviar alerta de teste'
    });
  }
});

module.exports = router;
