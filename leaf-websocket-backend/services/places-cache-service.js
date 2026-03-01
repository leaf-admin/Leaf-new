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

class PlacesCacheService {
  constructor() {
    // Usar Redis Pool (padrão do projeto)
    this.redis = redisPool.getConnection();
    this.isInitialized = false;
    
    // TTL do cache (30 dias)
    this.cacheTTL = 30 * 24 * 60 * 60; // 30 dias em segundos
    
    // TTL para flag "buscando" (evita requisições duplicadas)
    this.fetchingTTL = 30; // 30 segundos
    
    // Google Places API Key (do ambiente ou fallback)
    this.googleApiKey = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY';
    
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
      logger.info(`🌐 [PlacesCache] Buscando no Google Places: "${query}"`);

      // Construir URL da API Places Autocomplete
      let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${this.googleApiKey}&language=pt-BR&components=country:br`;

      // Adicionar location bias se disponível
      if (location && location.lat && location.lng) {
        url += `&locationbias=circle:50000@${location.lat},${location.lng}`;
      }

      const response = await fetch(url);
      const json = await response.json();

      if (json.status === 'OK' && json.predictions && json.predictions.length > 0) {
        // Pegar o primeiro resultado e buscar detalhes
        const placeId = json.predictions[0].place_id;
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
   * @returns {Promise<object|null>} - Dados completos do lugar
   */
  async getPlaceDetails(placeId) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${this.googleApiKey}&fields=geometry,formatted_address,name,place_id`;

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



