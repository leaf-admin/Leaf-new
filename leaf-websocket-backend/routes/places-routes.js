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
const DIRECTIONS_FALLBACK_SPEED_KMH = Number.parseFloat(
  process.env.PLACES_DIRECTIONS_FALLBACK_SPEED_KMH || '35',
);
const DIRECTIONS_FALLBACK_TRAFFIC_FACTOR = Number.parseFloat(
  process.env.PLACES_DIRECTIONS_FALLBACK_TRAFFIC_FACTOR || '1.2',
);
const DIRECTIONS_MAX_REQUESTS_PER_BOOKING = Number.parseInt(
  process.env.PLACES_DIRECTIONS_MAX_REQUESTS_PER_BOOKING ||
  process.env.RIDE_COST_DIRECTIONS_MAX_REQUESTS_PER_BOOKING ||
  '6',
  10,
);
const DIRECTIONS_HARD_CAP_USD = Number.parseFloat(
  process.env.PLACES_DIRECTIONS_HARD_CAP_USD ||
  process.env.RIDE_COST_DIRECTIONS_HARD_CAP_USD ||
  process.env.RIDE_COST_TELEMETRY_BUDGET_USD ||
  '0',
);
const EARTH_RADIUS_KM = 6371;

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function requiresCanonicalDirectionsRoute(routeScope = '') {
  const normalizedScope = normalizeText(routeScope, 'unknown').toLowerCase();
  return [
    'passenger_home_preview',
    'passenger_home_category_preview',
    'passenger_quote_preview',
    'pricing_quote',
    'payment_quote',
  ].includes(normalizedScope);
}

function isTrafficAwareRoutingEnabled() {
  return normalizeBoolean(process.env.ENABLE_TRAFFIC_AWARE_ROUTES, true);
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

function normalizeLatLng(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function parseCoordPair(rawValue) {
  const [rawLat, rawLng] = String(rawValue || '').split(',');
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function normalizeWaypoints(waypointsInput) {
  if (!waypointsInput) {
    return [];
  }

  const rawWaypoints = Array.isArray(waypointsInput)
    ? waypointsInput
    : String(waypointsInput)
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);

  return rawWaypoints
    .map((item) => (typeof item === 'string' ? parseCoordPair(item) : normalizeLatLng(item)))
    .filter(Boolean);
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function computeHaversineDistanceKm(startPoint, endPoint) {
  const latDelta = toRad(endPoint.lat - startPoint.lat);
  const lngDelta = toRad(endPoint.lng - startPoint.lng);
  const startLatRad = toRad(startPoint.lat);
  const endLatRad = toRad(endPoint.lat);
  const a = Math.sin(latDelta / 2) ** 2 +
    (Math.cos(startLatRad) * Math.cos(endLatRad) * Math.sin(lngDelta / 2) ** 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function encodePolylineCoordinate(value) {
  let coordinate = Math.round(value * 1e5);
  coordinate <<= 1;
  if (value < 0) {
    coordinate = ~coordinate;
  }
  let encoded = '';
  while (coordinate >= 0x20) {
    encoded += String.fromCharCode((0x20 | (coordinate & 0x1f)) + 63);
    coordinate >>= 5;
  }
  encoded += String.fromCharCode(coordinate + 63);
  return encoded;
}

function encodePolylinePath(points = []) {
  let encoded = '';
  let previousLat = 0;
  let previousLng = 0;

  points.forEach((point) => {
    const latitude = Number(point?.lat);
    const longitude = Number(point?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }
    const scaledLat = Math.round(latitude * 1e5);
    const scaledLng = Math.round(longitude * 1e5);
    const deltaLat = latitude - previousLat / 1e5;
    const deltaLng = longitude - previousLng / 1e5;
    encoded += encodePolylineCoordinate(deltaLat);
    encoded += encodePolylineCoordinate(deltaLng);
    previousLat = scaledLat;
    previousLng = scaledLng;
  });

  return encoded || null;
}

function sanitizePositiveInteger(value, fallback = 0) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function sanitizePositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function buildApproximateDirectionsPayload({
  startLoc,
  destLoc,
  waypoints = [],
  trafficEnabled = false,
}) {
  const origin = parseCoordPair(startLoc);
  const destination = parseCoordPair(destLoc);
  if (!origin || !destination) {
    return null;
  }

  const normalizedWaypoints = normalizeWaypoints(waypoints);
  const path = [origin, ...normalizedWaypoints, destination];
  if (path.length < 2) {
    return null;
  }

  const configuredSpeed = sanitizePositiveNumber(DIRECTIONS_FALLBACK_SPEED_KMH, 35);
  const trafficFactor = sanitizePositiveNumber(DIRECTIONS_FALLBACK_TRAFFIC_FACTOR, 1.2);
  const effectiveSpeed = trafficEnabled
    ? Math.max(8, configuredSpeed / Math.max(1, trafficFactor))
    : Math.max(8, configuredSpeed);

  const legs = [];
  const steps = [];
  let totalDistanceKm = 0;
  let totalTimeSecs = 0;
  let totalDurationWithoutTrafficSecs = 0;

  for (let index = 0; index < path.length - 1; index += 1) {
    const startPoint = path[index];
    const endPoint = path[index + 1];
    const distanceInKm = Number(computeHaversineDistanceKm(startPoint, endPoint).toFixed(3));
    const durationWithoutTrafficSecs = Math.max(
      60,
      Math.round((distanceInKm / Math.max(8, configuredSpeed)) * 3600),
    );
    const timeInSecs = Math.max(60, Math.round((distanceInKm / effectiveSpeed) * 3600));
    const step = {
      instruction: index === path.length - 2 ? 'Siga até o destino' : 'Siga até o próximo ponto da rota',
      startLocation: {
        lat: Number(startPoint.lat),
        lng: Number(startPoint.lng),
      },
      endLocation: {
        lat: Number(endPoint.lat),
        lng: Number(endPoint.lng),
      },
      distanceMeters: Math.round(distanceInKm * 1000),
      durationSeconds: timeInSecs,
      polylinePoints: encodePolylinePath([startPoint, endPoint]),
    };

    totalDistanceKm += distanceInKm;
    totalTimeSecs += timeInSecs;
    totalDurationWithoutTrafficSecs += durationWithoutTrafficSecs;
    steps.push(step);
    legs.push({
      distance_in_km: distanceInKm,
      time_in_secs: timeInSecs,
      duration_without_traffic: durationWithoutTrafficSecs,
      duration_in_traffic: trafficEnabled ? timeInSecs : null,
      start_location: {
        latitude: Number(startPoint.lat),
        longitude: Number(startPoint.lng),
      },
      end_location: {
        latitude: Number(endPoint.lat),
        longitude: Number(endPoint.lng),
      },
      start_address: '',
      end_address: '',
      steps: [step],
    });
  }

  return {
    distance_in_km: Number(totalDistanceKm.toFixed(3)),
    time_in_secs: totalTimeSecs,
    duration_without_traffic: totalDurationWithoutTrafficSecs,
    duration_in_traffic: trafficEnabled ? totalTimeSecs : null,
    polylinePoints: encodePolylinePath(path),
    legs,
    steps,
  };
}

function readDirectionsCountersFromReport(report = null) {
  const directionsTotals = report?.totals?.google?.directions || {};
  const requestCount = Math.max(
    0,
    Number.parseInt(
      directionsTotals?.requestCount ??
      report?.totals?.google?.skus?.directionsLegacy?.requestCount ??
      0,
      10,
    ) || 0,
  );
  const estimatedCostUsd = Math.max(
    0,
    Number(
      directionsTotals?.estimatedCostUsd ??
      report?.totals?.google?.skus?.directionsLegacy?.estimatedCostUsd ??
      0,
    ) || 0,
  );

  return {
    requestCount,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
  };
}

async function resolveDirectionsBudgetGuard(bookingId) {
  if (!bookingId) {
    return {
      enabled: false,
      blocked: false,
      reason: null,
      requestCount: 0,
      estimatedCostUsd: 0,
      maxRequests: sanitizePositiveInteger(DIRECTIONS_MAX_REQUESTS_PER_BOOKING, 0),
      hardCapUsd: sanitizePositiveNumber(DIRECTIONS_HARD_CAP_USD, 0),
    };
  }

  const maxRequests = sanitizePositiveInteger(DIRECTIONS_MAX_REQUESTS_PER_BOOKING, 0);
  const hardCapUsd = sanitizePositiveNumber(DIRECTIONS_HARD_CAP_USD, 0);
  const hasAnyLimit = maxRequests > 0 || hardCapUsd > 0;
  if (!hasAnyLimit) {
    return {
      enabled: false,
      blocked: false,
      reason: null,
      requestCount: 0,
      estimatedCostUsd: 0,
      maxRequests,
      hardCapUsd,
    };
  }

  try {
    const report = await rideCostTelemetryService.getReport(bookingId);
    const counters = readDirectionsCountersFromReport(report);
    const blockedByRequests = maxRequests > 0 && counters.requestCount >= maxRequests;
    const blockedByUsd = hardCapUsd > 0 && counters.estimatedCostUsd >= hardCapUsd;
    return {
      enabled: true,
      blocked: blockedByRequests || blockedByUsd,
      reason: blockedByRequests ? 'request_cap_reached' : blockedByUsd ? 'cost_cap_reached' : null,
      requestCount: counters.requestCount,
      estimatedCostUsd: counters.estimatedCostUsd,
      maxRequests,
      hardCapUsd,
    };
  } catch (error) {
    logger.warn(`⚠️ [PlacesRoute] Falha ao carregar telemetria para budget guard: ${error.message}`);
    return {
      enabled: true,
      blocked: false,
      reason: null,
      requestCount: 0,
      estimatedCostUsd: 0,
      maxRequests,
      hardCapUsd,
    };
  }
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

async function captureBookingOperationalTelemetry({
  bookingId,
  sourceKey,
  sourceMeta,
  requestMeta,
  backendCommand,
  backend = {},
  redis = {},
  firebase = {},
  database = {},
}) {
  if (!bookingId) {
    return false;
  }

  try {
    await rideCostTelemetryService.ingestOperationalUsage({
      bookingId,
      sourceKey,
      sourceMeta,
      backendCommand,
      backend,
      redis,
      firebase,
      database,
      requestMeta: {
        ...(requestMeta || {}),
        source: 'api/places',
        receivedAt: new Date().toISOString(),
      },
    });
    return true;
  } catch (telemetryError) {
    logger.warn(`⚠️ [PlacesRoute] Falha ao gravar telemetria operacional: ${telemetryError.message}`);
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
 * Ou se não encontrar resultado:
 * {
 *   "status": "not_found",
 *   "message": "Lugar não encontrado no backend."
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

    // Não encontrado no backend (cache + providers autorizados no servidor)
    return res.status(404).json({
      status: 'not_found',
      message: 'Lugar não encontrado no backend.',
      fallback: 'backend_not_found'
    });

  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro ao buscar place: ${error.message}`);
    
    // Sempre retornar erro controlado (nunca quebrar)
    return res.status(500).json({
      status: 'error',
      message: 'Erro ao buscar lugar no backend.',
      fallback: 'backend_error'
    });
  }
});

/**
 * POST /api/places/reverse-geocode
 * Resolve endereço por coordenada com cache backend.
 */
router.post('/api/places/reverse-geocode', async (req, res) => {
  try {
    const location = normalizeLatLng(req.body?.location || req.body);
    const forceFresh = normalizeBoolean(req.body?.forceFresh, false);
    const telemetry = normalizeTelemetry(req.body?.telemetry || {});

    if (!location) {
      return res.status(400).json({
        status: 'error',
        message: 'location.lat e location.lng são obrigatórios.',
      });
    }

    const result = await placesCacheService.reverseGeocode(location.lat, location.lng, {
      forceFresh,
    });

    if (!result) {
      return res.status(404).json({
        status: 'not_found',
        message: 'Não foi possível resolver o endereço para as coordenadas.',
      });
    }

    const billedGoogleRequest = Number(result?.stats?.googleRequests || 0) > 0;
    const telemetryCaptured = result.cached !== true && billedGoogleRequest
      ? await captureBookingGoogleTelemetry({
        bookingId: telemetry.bookingId,
        sourceKey: telemetry.sourceKey || 'backend:places:reverse-geocode',
        sourceMeta: {
          ...telemetry.sourceMeta,
          surface: telemetry.sourceMeta?.surface || 'places_reverse_geocode_backend',
        },
        requestMeta: telemetry.requestMeta,
        skuKey: 'geocoding',
        requestCount: 1,
        billableUnits: 1,
        metadata: {
          telemetrySurface: telemetry.sourceMeta?.surface || 'places_reverse_geocode_backend',
          routeScope: 'pickup_resolution',
          cacheMode: result.cached ? 'cache' : 'none',
          forceFresh,
          lat: Number(location.lat.toFixed(5)),
          lng: Number(location.lng.toFixed(5)),
        },
      })
      : false;

    return res.json({
      status: 'success',
      source: result.cached ? 'cache' : 'google',
      cached: result.cached === true,
      telemetryCaptured,
      data: {
        address: result.address,
        formatted_address: result.formatted_address || result.address,
        name: result.name || result.address,
        lat: result.lat,
        lng: result.lng,
        place_id: result.place_id || null,
      },
    });
  } catch (error) {
    logger.error(`❌ [PlacesRoute] Erro em reverse geocode backend: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      message: 'Erro ao resolver endereço por coordenada.',
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
            source: cached.source || 'redis_cache',
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
            locationSource: 'place_coordinates',
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
    const location = normalizeLocation(req.body?.location);
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

    const servedFromCache = details.cached === true;
    const telemetryCaptured = servedFromCache ? false : await captureBookingGoogleTelemetry({
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
      placesCacheService.savePlace(query, details, { location }).catch((cacheError) => {
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
    const trafficEnabled = isTrafficAwareRoutingEnabled();
    const alternativesEnabled = normalizeBoolean(req.body?.alternativesEnabled, false);
    const forceFresh = normalizeBoolean(req.body?.forceFresh, false);
    const routeScope = normalizeText(req.body?.routeScope, 'unknown');
    const telemetry = normalizeTelemetry(req.body?.telemetry || {});
    const telemetrySourceKey = telemetry.sourceKey || 'backend:places:directions';
    const telemetrySourceMeta = {
      ...telemetry.sourceMeta,
      surface: telemetry.sourceMeta?.surface || 'places_directions_backend',
    };
    const backendCommand = 'places_directions_route';

    if (!startLoc || !destLoc) {
      return res.status(400).json({
        status: 'error',
        message: 'startLoc e destLoc são obrigatórios no formato "lat,lng".',
      });
    }

    const budgetGuard = await resolveDirectionsBudgetGuard(telemetry.bookingId);
    let result = null;
    let budgetGuardFallbackUsed = false;

    if (budgetGuard.blocked) {
      const cacheOnlyResult = await placesCacheService.fetchDirectionsRoute({
        startLoc,
        destLoc,
        waypoints,
        trafficEnabled,
        alternativesEnabled,
        cacheOnly: true,
      });

      if (cacheOnlyResult?.data) {
        result = cacheOnlyResult;
      } else if (requiresCanonicalDirectionsRoute(routeScope)) {
        const operationalTelemetryCaptured = await captureBookingOperationalTelemetry({
          bookingId: telemetry.bookingId,
          sourceKey: telemetrySourceKey,
          sourceMeta: telemetrySourceMeta,
          requestMeta: telemetry.requestMeta,
          backendCommand,
          backend: {
            attempts: 1,
            errors: 1,
          },
          redis: {
            reads: Number(cacheOnlyResult?.stats?.redisReads || 0),
            writes: Number(cacheOnlyResult?.stats?.redisWrites || 0),
          },
        });

        return res.status(503).json({
          status: 'unavailable',
          code: 'canonical_route_required',
          message: 'Rota canônica indisponível para cotação. Tente novamente em instantes.',
          telemetryCaptured: false,
          operationalTelemetryCaptured,
          budgetGuard: {
            ...budgetGuard,
            fallback: 'blocked_for_canonical_route',
          },
        });
      } else {
        const approximateData = buildApproximateDirectionsPayload({
          startLoc,
          destLoc,
          waypoints,
          trafficEnabled,
        });
        if (approximateData) {
          budgetGuardFallbackUsed = true;
          const operationalTelemetryCaptured = await captureBookingOperationalTelemetry({
            bookingId: telemetry.bookingId,
            sourceKey: telemetrySourceKey,
            sourceMeta: telemetrySourceMeta,
            requestMeta: telemetry.requestMeta,
            backendCommand,
            backend: {
              attempts: 1,
              successes: 1,
            },
            redis: {
              reads: Number(cacheOnlyResult?.stats?.redisReads || 0),
              writes: Number(cacheOnlyResult?.stats?.redisWrites || 0),
            },
          });

          return res.json({
            status: 'success',
            source: 'budget_guard_estimated',
            cached: false,
            telemetryCaptured: false,
            operationalTelemetryCaptured,
            budgetGuard: {
              ...budgetGuard,
              fallback: 'estimated_route',
            },
            routeCount: 1,
            waypointsCount: normalizeWaypoints(waypoints).length,
            data: approximateData,
          });
        }
      }
    }

    if (!result) {
      result = await placesCacheService.fetchDirectionsRoute({
        startLoc,
        destLoc,
        waypoints,
        trafficEnabled,
        alternativesEnabled,
        forceFresh,
      });
    }

    if (!result || !result.data) {
      await captureBookingOperationalTelemetry({
        bookingId: telemetry.bookingId,
        sourceKey: telemetrySourceKey,
        sourceMeta: telemetrySourceMeta,
        requestMeta: telemetry.requestMeta,
        backendCommand,
        backend: {
          attempts: 1,
          errors: 1,
        },
        redis: {
          reads: Number(result?.stats?.redisReads || 0),
          writes: Number(result?.stats?.redisWrites || 0),
        },
      });
      return res.status(404).json({
        status: 'not_found',
        message: 'Não foi possível obter rota para os pontos informados.',
      });
    }

    const billedGoogleRequest = Number(result?.stats?.googleRequests || 0) > 0;
    const directionsSkuKey = result?.provider === 'routes_api'
      ? 'routesPreferredTrafficAwarePolyline'
      : trafficEnabled ? 'directionsAdvancedLegacy' : 'directionsLegacy';
    const telemetryCaptured = result.cached !== true && billedGoogleRequest
      ? await captureBookingGoogleTelemetry({
        bookingId: telemetry.bookingId,
        sourceKey: telemetrySourceKey,
        sourceMeta: telemetrySourceMeta,
        requestMeta: telemetry.requestMeta,
        skuKey: directionsSkuKey,
        requestCount: 1,
        billableUnits: 1,
        metadata: {
          telemetrySurface: telemetrySourceMeta.surface,
          routeScope,
          cacheMode: result.cached ? 'cache' : 'none',
          forceFresh: Boolean(result?.cachePolicy?.forceFresh || forceFresh),
          trafficEnabled,
          alternativesEnabled,
          waypointsCount: result.waypointsCount || 0,
          routeCount: result.routeCount || 1,
          budgetGuardActive: Boolean(budgetGuard.blocked),
          budgetGuardReason: budgetGuard.reason || null,
          budgetGuardFallbackUsed,
        },
      })
      : false;

    const operationalTelemetryCaptured = await captureBookingOperationalTelemetry({
      bookingId: telemetry.bookingId,
      sourceKey: telemetrySourceKey,
      sourceMeta: telemetrySourceMeta,
      requestMeta: telemetry.requestMeta,
      backendCommand,
      backend: {
        attempts: 1,
        successes: 1,
      },
      redis: {
        reads: Number(result?.stats?.redisReads || 0),
        writes: Number(result?.stats?.redisWrites || 0),
      },
    });

    return res.json({
      status: 'success',
      source: result.cached ? 'cache' : 'google',
      cached: result.cached === true,
      telemetryCaptured,
      operationalTelemetryCaptured,
      budgetGuard: budgetGuard.enabled
        ? {
          ...budgetGuard,
          fallback: budgetGuard.blocked ? 'cache_or_estimated' : null,
        }
        : null,
      routeCount: result.routeCount || 1,
      waypointsCount: result.waypointsCount || 0,
      cachePolicy: result.cachePolicy || {
        forceFresh,
        ttlSeconds: null,
      },
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
    const location = normalizeLocation(req.body?.location);

    if (!query || !placeData) {
      return res.status(400).json({
        status: 'error',
        message: 'Query e placeData são obrigatórios.'
      });
    }

    const saved = await placesCacheService.savePlace(query, placeData, { location });

    if (saved) {
      return res.json({
        status: 'success',
        message: 'Lugar salvo no cache com sucesso.'
      });
    }

    return res.status(202).json({
      status: 'skipped',
      message: 'Lugar sem coordenadas resolvidas; cache não atualizado.'
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
