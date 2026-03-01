/**
 * Rotas para Places Cache
 * Endpoint: /api/places/search
 * 
 * Segue o padrão de routes/metrics.js
 */

const express = require('express');
const router = express.Router();
const placesCacheService = require('../services/places-cache-service');
const { logger } = require('../utils/logger');

/**
 * POST /api/places/search
 * Busca um lugar usando cache
 * 
 * Body:
 * {
 *   "query": "BarraShopping",
 *   "location": { "lat": -22.9708, "lng": -43.3656 } // opcional
 * }
 * 
 * Response:
 * {
 *   "status": "success",
 *   "data": {
 *     "place_id": "...",
 *     "name": "...",
 *     "address": "...",
 *     "lat": -22.9708,
 *     "lng": -43.3656,
 *     "source": "redis_cache",
 *     "cached": true
 *   }
 * }
 * 
 * Ou se não encontrar no cache:
 * {
 *   "status": "not_found",
 *   "message": "Lugar não encontrado no cache. Use Google Places diretamente."
 * }
 */
router.post('/api/places/search', async (req, res) => {
  try {
    const { query, location } = req.body;

    // Validar query
    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      return res.status(400).json({
        status: 'error',
        message: 'Query inválida. Mínimo 3 caracteres.'
      });
    }

    logger.info(`🔍 [PlacesRoute] Busca recebida: "${query}"`);

    // Buscar no cache
    const result = await placesCacheService.searchPlace(query, location);

    if (result) {
      // Encontrado no cache
      return res.json({
        status: 'success',
        data: result
      });
    }

    // Não encontrado no cache
    // Frontend deve usar Google Places diretamente (fallback)
    return res.status(404).json({
      status: 'not_found',
      message: 'Lugar não encontrado no cache. Use Google Places diretamente.',
      fallback: true
    });

  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro ao buscar place: ${error.message}`);
    
    // Sempre retornar erro controlado (nunca quebrar)
    return res.status(500).json({
      status: 'error',
      message: 'Erro ao buscar lugar. Use Google Places diretamente.',
      fallback: true
    });
  }
});

/**
 * POST /api/places/save
 * Salva resultado do Google Places no cache
 * (Usado pelo frontend após buscar no Google)
 * 
 * Body:
 * {
 *   "query": "BarraShopping",
 *   "placeData": {
 *     "place_id": "...",
 *     "name": "...",
 *     "address": "...",
 *     "lat": -22.9708,
 *     "lng": -43.3656
 *   }
 * }
 */
router.post('/api/places/save', async (req, res) => {
  try {
    const { query, placeData } = req.body;

    if (!query || !placeData) {
      return res.status(400).json({
        status: 'error',
        message: 'Query e placeData são obrigatórios.'
      });
    }

    const saved = await placesCacheService.savePlace(query, placeData);

    if (saved) {
      return res.json({
        status: 'success',
        message: 'Lugar salvo no cache com sucesso.'
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Erro ao salvar no cache.'
    });

  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro ao salvar place: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Erro ao salvar lugar.'
    });
  }
});

/**
 * GET /api/places/health
 * Health check do serviço de Places Cache
 */
router.get('/api/places/health', async (req, res) => {
  try {
    const health = await placesCacheService.healthCheck();
    return res.json(health);
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * GET /api/places/metrics
 * Obtém métricas do cache (hit rate, misses, etc.)
 */
router.get('/api/places/metrics', async (req, res) => {
  try {
    const metrics = await placesCacheService.getMetrics();
    return res.json({
      status: 'success',
      metrics
    });
  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro ao obter métricas: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * POST /api/places/metrics/reset
 * Reseta métricas (útil para testes)
 */
router.post('/api/places/metrics/reset', async (req, res) => {
  try {
    await placesCacheService.resetMetrics();
    return res.json({
      status: 'success',
      message: 'Métricas resetadas com sucesso'
    });
  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro ao resetar métricas: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

module.exports = router;



