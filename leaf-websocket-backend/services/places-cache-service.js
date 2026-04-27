/**
 * Places Cache Service
 * Serviço para cachear resultados do Google Places API
 * 
 * Fluxo:
 * 1. Buscar no Redis (cache rápido)
 * 2. Se não encontrar, buscar no PostgreSQL (persistência)
 * 3. Se não encontrar, buscar no Google Places (assíncrono)
 * 4. Salvar resultado no Redis + PostgreSQL
 */

const { logger } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const { normalizeQuery, isValidQuery } = require('../utils/places-normalizer');

const DIRECTIONS_CACHE_TTL_SECONDS = Number.parseInt(
  process.env.PLACES_DIRECTIONS_CACHE_TTL_SECONDS || process.env.DIRECTIONS_CACHE_TTL_SECONDS || '120',
  10,
);

function normalizeCoordinateNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Number(parsed.toFixed(6));
}

function parseLatLngPair(rawValue) {
  const [rawLat, rawLng] = String(rawValue || '').split(',');
  const lat = normalizeCoordinateNumber(rawLat);
  const lng = normalizeCoordinateNumber(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function serializeLatLngPair(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return null;
  }
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

function normalizeWaypointsInput(waypointsInput) {
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
    .map((item) => {
      if (typeof item === 'string') {
        return parseLatLngPair(item);
      }
      const lat = normalizeCoordinateNumber(item?.lat ?? item?.latitude);
      const lng = normalizeCoordinateNumber(item?.lng ?? item?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return { lat, lng };
    })
    .filter(Boolean);
}

class PlacesCacheService {
  constructor() {
    // Usar Redis Pool (padrão do projeto)
    this.redis = redisPool.getConnection();
    this.isInitialized = false;
    
    // TTL do cache (30 dias)
    this.cacheTTL = 30 * 24 * 60 * 60; // 30 dias em segundos
    
    // TTL para flag "buscando" (evita requisições duplicadas)
    this.fetchingTTL = 30; // 30 segundos
    
    // Google Places API Key (somente via ambiente)
    this.googleApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    
    // 📊 Métricas de cache (em memória + Redis para persistência)
    this.metrics = {
      hits: 0,           // Cache hits
      misses: 0,         // Cache misses
      saves: 0,          // Lugares salvos
      errors: 0,         // Erros
      totalRequests: 0   // Total de requisições
    };
    
    // Chave Redis para métricas persistentes
    this.metricsKey = 'places_cache:metrics';
  }

  /**
   * Inicializa o serviço
   */
  async initialize() {
    try {
      // Verificar conexão Redis
      await this.redis.ping();
      this.isInitialized = true;
      
      // Carregar métricas do Redis
      await this.loadMetrics();
      
      logger.info('✅ Places Cache Service inicializado');
    } catch (error) {
      logger.error('❌ Erro ao inicializar Places Cache Service:', error);
      // Não falhar - serviço pode funcionar sem Redis (com fallback)
      this.isInitialized = false;
    }
  }
  
  /**
   * Carrega métricas do Redis
   */
  async loadMetrics() {
    try {
      if (this.isInitialized) {
        const cached = await this.redis.get(this.metricsKey);
        if (cached) {
          this.metrics = JSON.parse(cached);
          logger.info('📊 Métricas carregadas do Redis');
        }
      }
    } catch (error) {
      logger.warn('⚠️ Erro ao carregar métricas:', error.message);
    }
  }
  
  /**
   * Salva métricas no Redis
   */
  async saveMetrics() {
    try {
      if (this.isInitialized) {
        await this.redis.setex(this.metricsKey, 86400 * 7, JSON.stringify(this.metrics)); // 7 dias
      }
    } catch (error) {
      logger.warn('⚠️ Erro ao salvar métricas:', error.message);
    }
  }
  
  /**
   * Incrementa contador de hits
   */
  incrementHit() {
    this.metrics.hits++;
    this.metrics.totalRequests++;
    this.saveMetrics().catch(() => {}); // Não bloquear
  }
  
  /**
   * Incrementa contador de misses
   */
  incrementMiss() {
    this.metrics.misses++;
    this.metrics.totalRequests++;
    this.saveMetrics().catch(() => {}); // Não bloquear
  }
  
  /**
   * Incrementa contador de saves
   */
  incrementSave() {
    this.metrics.saves++;
    this.saveMetrics().catch(() => {}); // Não bloquear
  }
  
  /**
   * Incrementa contador de erros
   */
  incrementError() {
    this.metrics.errors++;
    this.saveMetrics().catch(() => {}); // Não bloquear
  }

  /**
   * Busca um lugar no cache
   * @param {string} query - Query de busca
   * @param {object} location - Localização do usuário (opcional) { lat, lng }
   * @returns {Promise<object|null>} - Resultado do cache ou null
   */
  async searchPlace(query, location = null) {
    try {
      // Validar query
      if (!isValidQuery(query)) {
        logger.warn(`⚠️ [PlacesCache] Query inválida: ${query}`);
        return null;
      }

      const alias = normalizeQuery(query);
      const cacheKey = `place:${alias}`;

      logger.info(`🔍 [PlacesCache] Buscando: "${query}" → alias: "${alias}"`);

      // 1. Buscar no Redis (cache rápido)
      if (this.isInitialized) {
        try {
          const cached = await this.redis.get(cacheKey);
          if (cached) {
            const result = JSON.parse(cached);
            logger.info(`✅ [PlacesCache] Cache HIT: ${alias}`);
            this.incrementHit(); // 📊 Incrementar hit
            return {
              ...result,
              source: 'redis_cache',
              cached: true
            };
          }
        } catch (redisError) {
          logger.warn(`⚠️ [PlacesCache] Erro ao buscar Redis: ${redisError.message}`);
          // Continuar para buscar no banco
        }
      }

      // 2. Buscar no PostgreSQL (se implementado)
      // TODO: Implementar busca no PostgreSQL quando necessário
      // const dbResult = await this.searchDatabase(alias);
      // if (dbResult) {
      //   // Popular Redis para próxima vez
      //   await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(dbResult));
      //   return { ...dbResult, source: 'database', cached: true };
      // }

      // 3. Não encontrado - retornar null (frontend fará fallback para Google)
      logger.info(`❌ [PlacesCache] Cache MISS: ${alias}`);
      this.incrementMiss(); // 📊 Incrementar miss
      return null;

    } catch (error) {
      logger.error(`❌ [PlacesCache] Erro ao buscar place: ${error.message}`);
      this.incrementError(); // 📊 Incrementar erro
      return null; // Sempre retornar null em caso de erro (fallback seguro)
    }
  }

  /**
   * Salva resultado do Google Places no cache
   * @param {string} query - Query original
   * @param {object} placeData - Dados do lugar do Google Places
   * @returns {Promise<boolean>} - true se salvou com sucesso
   */
  async savePlace(query, placeData) {
    try {
      if (!isValidQuery(query) || !placeData) {
        return false;
      }

      const alias = normalizeQuery(query);
      const cacheKey = `place:${alias}`;

      // Preparar dados para cache
      const cacheData = {
        alias,
        query: query, // Query original
        place_id: placeData.place_id,
        name: placeData.name,
        address: placeData.address || placeData.formatted_address,
        lat: placeData.lat || placeData.geometry?.location?.lat,
        lng: placeData.lng || placeData.geometry?.location?.lng,
        cached_at: new Date().toISOString()
      };

      // Salvar no Redis
      if (this.isInitialized) {
        try {
          await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(cacheData));
          logger.info(`💾 [PlacesCache] Place salvo no cache: ${alias}`);
          this.incrementSave(); // 📊 Incrementar save
          
          // TODO: Salvar no PostgreSQL quando implementado
          // await this.saveToDatabase(alias, cacheData);
          
          return true;
        } catch (redisError) {
          logger.error(`❌ [PlacesCache] Erro ao salvar no Redis: ${redisError.message}`);
          return false;
        }
      }

      return false;
    } catch (error) {
      logger.error(`❌ [PlacesCache] Erro ao salvar place: ${error.message}`);
      return false;
    }
  }

  /**
   * Busca no Google Places API (para worker assíncrono)
   * @param {string} query - Query de busca
   * @param {object} location - Localização do usuário (opcional)
   * @returns {Promise<object|null>} - Dados do lugar ou null
   */
  async fetchFromGooglePlaces(query, location = null) {
    try {
      if (!this.googleApiKey) {
        logger.warn('⚠️ [PlacesCache] GOOGLE_MAPS_API_KEY ausente; fallback remoto desabilitado');
        return null;
      }

      logger.info(`🌐 [PlacesCache] Buscando no Google Places: "${query}"`);

      const predictions = await this.fetchAutocompletePredictions(query, {
        location,
        limit: 1,
      });

      if (Array.isArray(predictions) && predictions.length > 0) {
        const placeId = predictions[0]?.place_id;
        if (!placeId) {
          return null;
        }
        return await this.getPlaceDetails(placeId);
      }

      logger.warn(`⚠️ [PlacesCache] Nenhum resultado no Google Places para: "${query}"`);
      return null;
    } catch (error) {
      logger.error(`❌ [PlacesCache] Erro ao buscar Google Places: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca detalhes completos de um lugar (lat/lng)
   * @param {string} placeId - Place ID do Google Places
   * @param {object} options - Opções adicionais (sessionToken)
   * @returns {Promise<object|null>} - Dados completos do lugar
   */
  async getPlaceDetails(placeId, options = {}) {
    try {
      if (!this.googleApiKey) {
        return null;
      }

      const normalizedPlaceId = String(placeId || '').trim();
      if (!normalizedPlaceId) {
        return null;
      }
      const normalizedSessionToken = String(options?.sessionToken || '').trim();

      let url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(normalizedPlaceId)}&key=${this.googleApiKey}&fields=geometry,formatted_address,name,place_id&language=pt-BR`;
      if (normalizedSessionToken) {
        url += `&sessiontoken=${encodeURIComponent(normalizedSessionToken)}`;
      }

      const response = await fetch(url);
      const json = await response.json();

      if (json.status === 'OK' && json.result) {
        const location = json.result.geometry.location;
        return {
          place_id: placeId,
          name: json.result.name,
          address: json.result.formatted_address,
          lat: location.lat,
          lng: location.lng
        };
      }

      return null;
    } catch (error) {
      logger.error(`❌ [PlacesCache] Erro ao buscar detalhes: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca previsões no Google Places Autocomplete (Legacy)
   * @param {string} query - Texto de busca
   * @param {object} options - Opções adicionais (location, sessionToken, limit)
   * @returns {Promise<Array>} - Lista de previsões
   */
  async fetchAutocompletePredictions(query, options = {}) {
    try {
      if (!this.googleApiKey) {
        logger.warn('⚠️ [PlacesCache] GOOGLE_MAPS_API_KEY ausente para autocomplete');
        return [];
      }

      const normalizedQuery = String(query || '').trim();
      if (normalizedQuery.length < 3) {
        return [];
      }

      let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(normalizedQuery)}&key=${this.googleApiKey}&language=pt-BR&components=country:br`;

      const lat = Number(options?.location?.lat);
      const lng = Number(options?.location?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        url += `&location=${lat},${lng}&radius=50000`;
      }

      const normalizedSessionToken = String(options?.sessionToken || '').trim();
      if (normalizedSessionToken) {
        url += `&sessiontoken=${encodeURIComponent(normalizedSessionToken)}`;
      }

      const response = await fetch(url);
      const json = await response.json();
      if (!response.ok) {
        logger.warn(
          `⚠️ [PlacesCache] HTTP ${response.status} em autocomplete para "${normalizedQuery}"`,
        );
        return [];
      }

      if (json.status === 'ZERO_RESULTS') {
        return [];
      }

      if (json.status !== 'OK' || !Array.isArray(json.predictions)) {
        logger.warn(
          `⚠️ [PlacesCache] Google autocomplete retornou status ${json.status || 'unknown'}`,
        );
        return [];
      }

      const normalizedLimit = Math.max(
        1,
        Math.min(10, Number.parseInt(options?.limit || '8', 10) || 8),
      );
      return json.predictions.slice(0, normalizedLimit).map((prediction = {}) => ({
        place_id: prediction.place_id || null,
        description: prediction.description || '',
        structured_formatting: prediction.structured_formatting || null,
        types: Array.isArray(prediction.types) ? prediction.types : [],
        reference: prediction.reference || prediction.place_id || null,
      }));
    } catch (error) {
      logger.error(`❌ [PlacesCache] Erro em autocomplete Google: ${error.message}`);
      return [];
    }
  }

  buildDirectionsCacheKey({
    origin,
    destination,
    waypoints = [],
    trafficEnabled = false,
    alternativesEnabled = false,
  }) {
    const serializedOrigin = serializeLatLngPair(origin);
    const serializedDestination = serializeLatLngPair(destination);
    const serializedWaypoints = waypoints
      .map((waypoint) => serializeLatLngPair(waypoint))
      .filter(Boolean)
      .join('|') || 'none';

    return [
      'maps:directions',
      serializedOrigin || 'invalid-origin',
      serializedDestination || 'invalid-destination',
      serializedWaypoints,
      `traffic:${trafficEnabled ? '1' : '0'}`,
      `alternatives:${alternativesEnabled ? '1' : '0'}`,
    ].join(':');
  }

  async fetchDirectionsRoute(options = {}) {
    try {
      if (!this.googleApiKey) {
        logger.warn('⚠️ [PlacesCache] GOOGLE_MAPS_API_KEY ausente para directions');
        return null;
      }

      const origin = parseLatLngPair(options?.startLoc);
      const destination = parseLatLngPair(options?.destLoc);
      if (!origin || !destination) {
        return null;
      }

      const waypoints = normalizeWaypointsInput(options?.waypoints);
      const trafficEnabled = options?.trafficEnabled === true;
      const alternativesEnabled = options?.alternativesEnabled === true;
      const cacheKey = this.buildDirectionsCacheKey({
        origin,
        destination,
        waypoints,
        trafficEnabled,
        alternativesEnabled,
      });

      if (this.isInitialized) {
        try {
          const cached = await this.redis.get(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed?.data) {
              return {
                ...parsed,
                cached: true,
                cacheKey,
              };
            }
          }
        } catch (cacheError) {
          logger.warn(`⚠️ [PlacesCache] Falha ao ler cache de directions: ${cacheError.message}`);
        }
      }

      const originParam = serializeLatLngPair(origin);
      const destinationParam = serializeLatLngPair(destination);
      let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destinationParam)}&key=${this.googleApiKey}&language=pt-BR&units=metric`;
      if (trafficEnabled) {
        url += '&departure_time=now';
      }
      if (alternativesEnabled) {
        url += '&alternatives=true';
      }
      if (waypoints.length > 0) {
        const waypointsParam = waypoints
          .map((point) => serializeLatLngPair(point))
          .filter(Boolean)
          .join('|');
        if (waypointsParam) {
          url += `&waypoints=${encodeURIComponent(waypointsParam)}`;
        }
      }

      const response = await fetch(url);
      const json = await response.json();

      if (!response.ok) {
        logger.warn(`⚠️ [PlacesCache] HTTP ${response.status} em directions`);
        return null;
      }

      if (json.status !== 'OK' || !Array.isArray(json.routes) || json.routes.length === 0) {
        logger.warn(`⚠️ [PlacesCache] Directions retornou status ${json.status || 'unknown'}`);
        return {
          cached: false,
          routeCount: 0,
          data: null,
          status: json.status || 'unknown',
        };
      }

      let bestRoute = json.routes[0];
      let bestTime = null;
      if (json.routes.length > 1) {
        for (const route of json.routes) {
          const routeLegs = Array.isArray(route.legs) ? route.legs : [];
          const routeTime = routeLegs.reduce((total, currentLeg) => {
            const durationValue = Number(
              currentLeg?.duration_in_traffic?.value ??
              currentLeg?.duration?.value ??
              0,
            );
            return Number.isFinite(durationValue) ? total + durationValue : total;
          }, 0);
          if (bestTime === null || routeTime < bestTime) {
            bestRoute = route;
            bestTime = routeTime;
          }
        }
      }

      const route = bestRoute || {};
      const legs = Array.isArray(route.legs) ? route.legs : [];
      const normalizedLegs = legs.map((leg) => {
        const legDurationInTraffic = Number(leg?.duration_in_traffic?.value);
        const legDuration = Number(
          leg?.duration_in_traffic?.value ??
          leg?.duration?.value ??
          0,
        );
        return {
          distance_in_km: Number(leg?.distance?.value || 0) / 1000,
          time_in_secs: Number.isFinite(legDuration) ? legDuration : 0,
          duration_in_traffic: Number.isFinite(legDurationInTraffic) ? legDurationInTraffic : null,
          start_location:
            Number.isFinite(Number(leg?.start_location?.lat)) &&
            Number.isFinite(Number(leg?.start_location?.lng))
              ? {
                latitude: Number(leg.start_location.lat),
                longitude: Number(leg.start_location.lng),
              }
              : null,
          end_location:
            Number.isFinite(Number(leg?.end_location?.lat)) &&
            Number.isFinite(Number(leg?.end_location?.lng))
              ? {
                latitude: Number(leg.end_location.lat),
                longitude: Number(leg.end_location.lng),
              }
              : null,
          start_address: leg?.start_address || '',
          end_address: leg?.end_address || '',
        };
      });

      const distance_in_km = normalizedLegs.reduce(
        (acc, leg) => acc + (Number.isFinite(leg.distance_in_km) ? leg.distance_in_km : 0),
        0,
      );
      const time_in_secs = normalizedLegs.reduce(
        (acc, leg) => acc + (Number.isFinite(leg.time_in_secs) ? leg.time_in_secs : 0),
        0,
      );
      const trafficLegs = normalizedLegs.filter((leg) => Number.isFinite(leg.duration_in_traffic));
      const duration_in_traffic = trafficLegs.length === normalizedLegs.length && trafficLegs.length > 0
        ? trafficLegs.reduce((acc, leg) => acc + Number(leg.duration_in_traffic || 0), 0)
        : null;

      const data = {
        distance_in_km,
        time_in_secs,
        polylinePoints: route?.overview_polyline?.points || null,
        duration_in_traffic,
        legs: normalizedLegs,
      };

      const payload = {
        cached: false,
        routeCount: json.routes.length,
        waypointsCount: waypoints.length,
        data,
      };

      if (this.isInitialized) {
        try {
          await this.redis.setex(cacheKey, DIRECTIONS_CACHE_TTL_SECONDS, JSON.stringify(payload));
        } catch (cacheError) {
          logger.warn(`⚠️ [PlacesCache] Falha ao salvar cache de directions: ${cacheError.message}`);
        }
      }

      return payload;
    } catch (error) {
      logger.error(`❌ [PlacesCache] Erro em directions Google: ${error.message}`);
      return null;
    }
  }

  /**
   * Verifica se já está buscando (evita requisições duplicadas)
   * @param {string} alias - Alias normalizado
   * @returns {Promise<boolean>} - true se já está buscando
   */
  async isFetching(alias) {
    try {
      if (!this.isInitialized) return false;
      const fetchingKey = `place:fetching:${alias}`;
      const isFetching = await this.redis.get(fetchingKey);
      return !!isFetching;
    } catch (error) {
      return false;
    }
  }

  /**
   * Marca como "buscando" (evita requisições duplicadas)
   * @param {string} alias - Alias normalizado
   */
  async setFetching(alias) {
    try {
      if (!this.isInitialized) return;
      const fetchingKey = `place:fetching:${alias}`;
      await this.redis.setex(fetchingKey, this.fetchingTTL, '1');
    } catch (error) {
      // Ignorar erro - não crítico
    }
  }

  /**
   * Remove flag de "buscando"
   * @param {string} alias - Alias normalizado
   */
  async clearFetching(alias) {
    try {
      if (!this.isInitialized) return;
      const fetchingKey = `place:fetching:${alias}`;
      await this.redis.del(fetchingKey);
    } catch (error) {
      // Ignorar erro - não crítico
    }
  }

  /**
   * Health check do serviço
   * @returns {Promise<object>} - Status do serviço
   */
  async healthCheck() {
    try {
      const redisHealthy = this.isInitialized && await this.redis.ping();
      return {
        status: redisHealthy ? 'healthy' : 'degraded',
        redis: redisHealthy ? 'connected' : 'disconnected',
        initialized: this.isInitialized,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Obtém métricas do cache
   * @returns {Promise<object>} - Métricas completas
   */
  async getMetrics() {
    try {
      // Calcular hit rate
      const hitRate = this.metrics.totalRequests > 0
        ? ((this.metrics.hits / this.metrics.totalRequests) * 100).toFixed(2)
        : 0;
      
      // Calcular miss rate
      const missRate = this.metrics.totalRequests > 0
        ? ((this.metrics.misses / this.metrics.totalRequests) * 100).toFixed(2)
        : 0;
      
      return {
        ...this.metrics,
        hitRate: `${hitRate}%`,
        missRate: `${missRate}%`,
        timestamp: new Date().toISOString(),
        // Estatísticas adicionais
        stats: {
          totalRequests: this.metrics.totalRequests,
          hits: this.metrics.hits,
          misses: this.metrics.misses,
          saves: this.metrics.saves,
          errors: this.metrics.errors,
          hitRate: parseFloat(hitRate),
          missRate: parseFloat(missRate),
          efficiency: this.metrics.totalRequests > 0
            ? ((this.metrics.hits / this.metrics.totalRequests) * 100).toFixed(2) + '%'
            : '0%'
        }
      };
    } catch (error) {
      logger.error(`❌ Erro ao obter métricas: ${error.message}`);
      return {
        ...this.metrics,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Reseta métricas (útil para testes)
   */
  async resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      saves: 0,
      errors: 0,
      totalRequests: 0
    };
    await this.saveMetrics();
    logger.info('📊 Métricas resetadas');
  }
}

// Singleton instance
const placesCacheService = new PlacesCacheService();

module.exports = placesCacheService;
