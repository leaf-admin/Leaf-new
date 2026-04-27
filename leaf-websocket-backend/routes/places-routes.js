/**
 * Rotas para Places Cache
 * Endpoint: /api/places/search
 * 
 * Segue o padrão de routes/metrics.js
 */

const express = require('express');
const router = express.Router();
const placesCacheService = require('../services/places-cache-service');
const rideCostTelemetryService = require('../services/ride-cost-telemetry-service');
const { logger } = require('../utils/logger');

const AUTOCOMPLETE_CACHE_MIN_QUERY_LEN = 8;

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeTelemetry(telemetry = {}) {
  const bookingId = normalizeText(telemetry?.bookingId, null);
  const sourceKey = normalizeText(telemetry?.sourceKey, null);
  const sourceMeta = {
    userId: normalizeText(telemetry?.sourceMeta?.userId, null),
    userType: normalizeText(telemetry?.sourceMeta?.userType, null),
    platform: normalizeText(telemetry?.sourceMeta?.platform, null),
    flow: normalizeText(telemetry?.sourceMeta?.flow, null),
    scenario: normalizeText(telemetry?.sourceMeta?.scenario, null),
    surface: normalizeText(telemetry?.sourceMeta?.surface, null),
  };

  return {
    bookingId,
    sourceKey,
    sourceMeta,
    requestMeta: telemetry?.requestMeta && typeof telemetry.requestMeta === 'object'
      ? telemetry.requestMeta
      : null,
  };
}

function normalizeLocation(location = null) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return fallback;
}

function shouldTryAutocompleteCache(query = '') {
  const normalized = normalizeText(query, '').toLowerCase();
  if (normalized.length >= AUTOCOMPLETE_CACHE_MIN_QUERY_LEN) {
    return true;
  }
  return normalized.split(/\s+/).filter(Boolean).length >= 2;
}

async function captureBookingGoogleTelemetry({
  bookingId,
  sourceKey,
  sourceMeta,
  requestMeta,
  skuKey,
  requestCount = 1,
  billableUnits = 1,
  metadata = {},
}) {
  if (!bookingId) {
    return false;
  }

  try {
    await rideCostTelemetryService.ingestGoogleSkuUsage({
      bookingId,
      skuKey,
      sourceKey,
      sourceMeta,
      requestCount,
      billableUnits,
      metadata,
      requestMeta: {
        ...(requestMeta || {}),
        source: 'api/places',
        receivedAt: new Date().toISOString(),
      },
    });
    return true;
  } catch (telemetryError) {
    logger.warn(`⚠️ [PlacesRoute] Falha ao gravar telemetria de custo: ${telemetryError.message}`);
    return false;
  }
}

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
 * POST /api/places/autocomplete
 * Busca autocomplete com cache backend + fallback Google no servidor
 */
router.post('/api/places/autocomplete', async (req, res) => {
  try {
    const query = normalizeText(req.body?.query, '');
    const sessionToken = normalizeText(req.body?.sessionToken, null);
    const location = normalizeLocation(req.body?.location);
    const telemetry = normalizeTelemetry(req.body?.telemetry || {});

    if (query.length < 3) {
      return res.status(400).json({
        status: 'error',
        message: 'Query inválida. Mínimo 3 caracteres.',
      });
    }

    if (shouldTryAutocompleteCache(query)) {
      const cached = await placesCacheService.searchPlace(query, location);
      if (cached) {
        return res.json({
          status: 'success',
          source: 'cache',
          predictions: [{
            place_id: cached.place_id || null,
            description: cached.address || cached.name || query,
            structured_formatting: {
              main_text: cached.name || cached.address || query,
              secondary_text: cached.address || cached.name || query,
            },
            types: [],
            reference: cached.place_id || null,
            location: {
              lat: cached.lat,
              lng: cached.lng,
            },
          }],
          telemetryCaptured: false,
          cached: true,
        });
      }
    }

    const predictions = await placesCacheService.fetchAutocompletePredictions(query, {
      location,
      sessionToken,
      limit: 8,
    });

    const telemetryCaptured = await captureBookingGoogleTelemetry({
      bookingId: telemetry.bookingId,
      sourceKey: telemetry.sourceKey || 'backend:places:autocomplete',
      sourceMeta: {
        ...telemetry.sourceMeta,
        surface: telemetry.sourceMeta?.surface || 'places_autocomplete_backend',
      },
      requestMeta: telemetry.requestMeta,
      skuKey: 'autocompleteLegacyPerRequest',
      requestCount: 1,
      billableUnits: 1,
      metadata: {
        telemetrySurface: telemetry.sourceMeta?.surface || 'places_autocomplete_backend',
        routeScope: 'destination_search',
        cacheMode: 'none',
        predictionCount: predictions.length,
        sessionTokenUsed: Boolean(sessionToken),
        queryLength: query.length,
      },
    });

    return res.json({
      status: 'success',
      source: 'google',
      predictions,
      telemetryCaptured,
      cached: false,
    });
  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro em autocomplete backend: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Erro no autocomplete.',
      predictions: [],
      fallback: true,
    });
  }
});

/**
 * POST /api/places/details
 * Busca Place Details no backend e registra telemetria por booking quando aplicável
 */
router.post('/api/places/details', async (req, res) => {
  try {
    const placeId = normalizeText(req.body?.placeId || req.body?.place_id, '');
    const sessionToken = normalizeText(req.body?.sessionToken, null);
    const query = normalizeText(req.body?.query, null);
    const telemetry = normalizeTelemetry(req.body?.telemetry || {});

    if (!placeId) {
      return res.status(400).json({
        status: 'error',
        message: 'placeId é obrigatório.',
      });
    }

    const details = await placesCacheService.getPlaceDetails(placeId, { sessionToken });
    if (!details) {
      return res.status(404).json({
        status: 'not_found',
        message: 'Place não encontrado.',
      });
    }

    const telemetryCaptured = await captureBookingGoogleTelemetry({
      bookingId: telemetry.bookingId,
      sourceKey: telemetry.sourceKey || 'backend:places:details',
      sourceMeta: {
        ...telemetry.sourceMeta,
        surface: telemetry.sourceMeta?.surface || 'places_details_backend',
      },
      requestMeta: telemetry.requestMeta,
      skuKey: 'placeDetailsLegacy',
      requestCount: 1,
      billableUnits: 1,
      metadata: {
        telemetrySurface: telemetry.sourceMeta?.surface || 'places_details_backend',
        routeScope: 'destination_resolution',
        cacheMode: 'none',
        sessionTokenUsed: Boolean(sessionToken),
        placeId,
      },
    });

    if (query) {
      placesCacheService.savePlace(query, details).catch((cacheError) => {
        logger.warn(`⚠️ [PlacesRoute] Não foi possível salvar details no cache: ${cacheError.message}`);
      });
    }

    return res.json({
      status: 'success',
      data: details,
      telemetryCaptured,
    });
  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro em place details backend: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Erro ao buscar details do lugar.',
    });
  }
});

/**
 * POST /api/places/directions
 * Proxy backend para Google Directions (com cache Redis + telemetria por booking)
 */
router.post('/api/places/directions', async (req, res) => {
  try {
    const startLoc = normalizeText(req.body?.startLoc, '');
    const destLoc = normalizeText(req.body?.destLoc, '');
    const waypoints = req.body?.waypoints || null;
    const trafficEnabled = normalizeBoolean(req.body?.trafficEnabled, false);
    const alternativesEnabled = normalizeBoolean(req.body?.alternativesEnabled, false);
    const routeScope = normalizeText(req.body?.routeScope, 'unknown');
    const telemetry = normalizeTelemetry(req.body?.telemetry || {});

    if (!startLoc || !destLoc) {
      return res.status(400).json({
        status: 'error',
        message: 'startLoc e destLoc são obrigatórios no formato "lat,lng".',
      });
    }

    const result = await placesCacheService.fetchDirectionsRoute({
      startLoc,
      destLoc,
      waypoints,
      trafficEnabled,
      alternativesEnabled,
    });

    if (!result || !result.data) {
      return res.status(404).json({
        status: 'not_found',
        message: 'Não foi possível obter rota para os pontos informados.',
      });
    }

    const telemetryCaptured = result.cached !== true
      ? await captureBookingGoogleTelemetry({
        bookingId: telemetry.bookingId,
        sourceKey: telemetry.sourceKey || 'backend:places:directions',
        sourceMeta: {
          ...telemetry.sourceMeta,
          surface: telemetry.sourceMeta?.surface || 'places_directions_backend',
        },
        requestMeta: telemetry.requestMeta,
        skuKey: 'directionsLegacy',
        requestCount: 1,
        billableUnits: 1,
        metadata: {
          telemetrySurface: telemetry.sourceMeta?.surface || 'places_directions_backend',
          routeScope,
          cacheMode: 'none',
          trafficEnabled,
          alternativesEnabled,
          waypointsCount: result.waypointsCount || 0,
          routeCount: result.routeCount || 1,
        },
      })
      : false;

    return res.json({
      status: 'success',
      source: result.cached ? 'cache' : 'google',
      cached: result.cached === true,
      telemetryCaptured,
      routeCount: result.routeCount || 1,
      waypointsCount: result.waypointsCount || 0,
      data: result.data,
    });
  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro em directions backend: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Erro ao calcular rota.',
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

