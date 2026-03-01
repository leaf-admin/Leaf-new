// routes/cache-monitoring.js
// Endpoint de monitoramento do cache Redis avançado

const express = require('express');
const router = express.Router();
const advancedCache = require('../utils/advanced-cache');

// Endpoint para estatísticas do cache
router.get('/stats', async (req, res) => {
  try {
    const stats = await advancedCache.getCacheStats();
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para health check do cache
router.get('/health', async (req, res) => {
  try {
    const health = await advancedCache.healthCheck();
    res.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para invalidar cache por tipo
router.post('/invalidate/:queryType', async (req, res) => {
  try {
    const { queryType } = req.params;
    const { context } = req.body;
    
    const invalidated = await advancedCache.invalidate(queryType, context);
    
    res.json({
      success: true,
      data: {
        queryType,
        invalidatedKeys: invalidated,
        message: `${invalidated} chaves invalidadas para ${queryType}`
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para invalidar cache por usuário
router.post('/invalidate-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const invalidated = await advancedCache.invalidateUserContext(userId);
    
    res.json({
      success: true,
      data: {
        userId,
        invalidatedKeys: invalidated,
        message: `${invalidated} chaves invalidadas para usuário ${userId}`
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para limpar todo o cache
router.post('/clear', async (req, res) => {
  try {
    const cleared = await advancedCache.clearAll();
    
    res.json({
      success: true,
      data: {
        clearedKeys: cleared,
        message: `${cleared} chaves removidas do cache`
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para invalidar cache por padrão
router.post('/invalidate-pattern', async (req, res) => {
  try {
    const { pattern } = req.body;
    
    if (!pattern) {
      return res.status(400).json({
        success: false,
        error: 'Pattern é obrigatório'
      });
    }
    
    const invalidated = await advancedCache.invalidatePattern(pattern);
    
    res.json({
      success: true,
      data: {
        pattern,
        invalidatedKeys: invalidated,
        message: `${invalidated} chaves invalidadas para padrão ${pattern}`
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;




