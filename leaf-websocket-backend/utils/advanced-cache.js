// utils/advanced-cache.js
// Sistema de Cache Redis Avançado para GraphQL

const redisPool = require('./redis-pool');
const crypto = require('crypto');

class AdvancedCache {
  constructor() {
    this.redis = redisPool.pool;
    this.defaultTTL = 300; // 5 minutos
    this.contextTTL = 600; // 10 minutos para contexto de usuário
    this.metricsTTL = 60; // 1 minuto para métricas
    this.spatialTTL = 180; // 3 minutos para dados espaciais
    
    // Configurações de cache por tipo
    this.cacheConfig = {
      'financialReport': { ttl: 300, prefix: 'fin' },
      'operationalMetrics': { ttl: 60, prefix: 'ops' },
      'userMetrics': { ttl: 180, prefix: 'usr' },
      'driverMetrics': { ttl: 180, prefix: 'drv' },
      'bookingMetrics': { ttl: 120, prefix: 'bkg' },
      'nearbyDrivers': { ttl: 30, prefix: 'geo' },
      'nearbyUsers': { ttl: 30, prefix: 'geo' },
      'popularRoutes': { ttl: 600, prefix: 'rte' },
      'dailyBookings': { ttl: 300, prefix: 'dly' },
      'userBookings': { ttl: 180, prefix: 'ubk' },
      'driverBookings': { ttl: 180, prefix: 'dbk' },
      'metrics': { ttl: 60, prefix: 'mtr' }
    };
  }

  // Gerar chave de cache baseada em query e parâmetros
  generateCacheKey(queryType, params = {}, context = {}) {
    const config = this.cacheConfig[queryType] || { prefix: 'def', ttl: this.defaultTTL };
    
    // Criar hash dos parâmetros para chave única
    const paramsHash = crypto
      .createHash('md5')
      .update(JSON.stringify({ ...params, ...context }))
      .digest('hex')
      .substring(0, 8);
    
    // Incluir contexto de usuário se disponível
    const userId = context.userId || 'anonymous';
    const userHash = crypto
      .createHash('md5')
      .update(userId)
      .digest('hex')
      .substring(0, 4);
    
    return `graphql:${config.prefix}:${queryType}:${userHash}:${paramsHash}`;
  }

  // Obter dados do cache
  async get(queryType, params = {}, context = {}) {
    try {
      const key = this.generateCacheKey(queryType, params, context);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`📊 Cache HIT: ${queryType} - ${key}`);
        return JSON.parse(cached);
      }
      
      console.log(`📊 Cache MISS: ${queryType} - ${key}`);
      return null;
    } catch (error) {
      console.error(`❌ Erro ao obter cache: ${error.message}`);
      return null;
    }
  }

  // Armazenar dados no cache
  async set(queryType, data, params = {}, context = {}) {
    try {
      const config = this.cacheConfig[queryType] || { prefix: 'def', ttl: this.defaultTTL };
      const key = this.generateCacheKey(queryType, params, context);
      const ttl = config.ttl;
      
      // Limpar dados de objetos circulares antes de armazenar
      const cleanData = this.cleanCircularReferences(data);
      
      await this.redis.setex(key, ttl, JSON.stringify(cleanData));
      console.log(`📊 Cache SET: ${queryType} - TTL: ${ttl}s - ${key}`);
      
      // Adicionar à lista de chaves para invalidação
      await this.addToInvalidationList(queryType, key);
      
      return true;
    } catch (error) {
      console.error(`❌ Erro ao armazenar cache: ${error.message}`);
      return false;
    }
  }

  // Invalidar cache por tipo de query
  async invalidate(queryType, context = {}) {
    try {
      const pattern = `graphql:*:${queryType}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`🗑️ Cache invalidado: ${queryType} - ${keys.length} chaves`);
      }
      
      return keys.length;
    } catch (error) {
      console.error(`❌ Erro ao invalidar cache: ${error.message}`);
      return 0;
    }
  }

  // Invalidar cache por contexto de usuário
  async invalidateUserContext(userId) {
    try {
      const userHash = crypto
        .createHash('md5')
        .update(userId)
        .digest('hex')
        .substring(0, 4);
      
      const pattern = `graphql:*:*:${userHash}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`🗑️ Cache de usuário invalidado: ${userId} - ${keys.length} chaves`);
      }
      
      return keys.length;
    } catch (error) {
      console.error(`❌ Erro ao invalidar cache de usuário: ${error.message}`);
      return 0;
    }
  }

  // Invalidar cache por padrão
  async invalidatePattern(pattern) {
    try {
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`🗑️ Cache invalidado por padrão: ${pattern} - ${keys.length} chaves`);
      }
      
      return keys.length;
    } catch (error) {
      console.error(`❌ Erro ao invalidar cache por padrão: ${error.message}`);
      return 0;
    }
  }

  // Adicionar chave à lista de invalidação
  async addToInvalidationList(queryType, key) {
    try {
      const listKey = `graphql:invalidation:${queryType}`;
      await this.redis.lpush(listKey, key);
      await this.redis.expire(listKey, 3600); // 1 hora
    } catch (error) {
      console.error(`❌ Erro ao adicionar à lista de invalidação: ${error.message}`);
    }
  }

  // Cache com fallback automático
  async getOrSet(queryType, fetchFunction, params = {}, context = {}) {
    try {
      // Tentar obter do cache primeiro
      let data = await this.get(queryType, params, context);
      
      if (data) {
        return data;
      }
      
      // Se não estiver no cache, buscar dados
      console.log(`📊 Buscando dados para cache: ${queryType}`);
      data = await fetchFunction();
      
      // Armazenar no cache (já limpa referências circulares)
      if (data) {
        await this.set(queryType, data, params, context);
      }
      
      return data;
    } catch (error) {
      console.error(`❌ Erro no getOrSet: ${error.message}`);
      // Em caso de erro, tentar buscar dados diretamente
      try {
        return await fetchFunction();
      } catch (fetchError) {
        console.error(`❌ Erro ao buscar dados: ${fetchError.message}`);
        throw fetchError;
      }
    }
  }

  // Cache de métricas em tempo real
  async getMetricsCache(metricType, params = {}) {
    try {
      const key = `graphql:metrics:${metricType}:${JSON.stringify(params)}`;
      const cached = await this.redis.get(key);
      
      if (cached) {
        const data = JSON.parse(cached);
        const now = Date.now();
        const age = now - data.timestamp;
        
        // Se os dados são muito antigos, invalidar
        if (age > this.metricsTTL * 1000) {
          await this.redis.del(key);
          return null;
        }
        
        console.log(`📊 Métricas cache HIT: ${metricType} - ${age}ms`);
        return data.value;
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Erro ao obter métricas do cache: ${error.message}`);
      return null;
    }
  }

  // Armazenar métricas em cache
  async setMetricsCache(metricType, data, params = {}) {
    try {
      const key = `graphql:metrics:${metricType}:${JSON.stringify(params)}`;
      const cacheData = {
        value: data,
        timestamp: Date.now()
      };
      
      await this.redis.setex(key, this.metricsTTL, JSON.stringify(cacheData));
      console.log(`📊 Métricas cache SET: ${metricType}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Erro ao armazenar métricas no cache: ${error.message}`);
      return false;
    }
  }

  // Cache espacial para dados de localização
  async getSpatialCache(queryType, location, radius, params = {}) {
    try {
      const locationKey = `${location.latitude},${location.longitude},${radius}`;
      const key = `graphql:spatial:${queryType}:${locationKey}`;
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`📊 Cache espacial HIT: ${queryType} - ${locationKey}`);
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Erro ao obter cache espacial: ${error.message}`);
      return null;
    }
  }

  // Armazenar cache espacial
  async setSpatialCache(queryType, location, radius, data, params = {}) {
    try {
      const locationKey = `${location.latitude},${location.longitude},${radius}`;
      const key = `graphql:spatial:${queryType}:${locationKey}`;
      
      await this.redis.setex(key, this.spatialTTL, JSON.stringify(data));
      console.log(`📊 Cache espacial SET: ${queryType} - ${locationKey}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Erro ao armazenar cache espacial: ${error.message}`);
      return false;
    }
  }

  // Estatísticas do cache
  async getCacheStats() {
    try {
      const stats = {
        totalKeys: 0,
        byType: {},
        memoryUsage: 0,
        hitRate: 0
      };
      
      // Contar chaves por tipo
      for (const queryType in this.cacheConfig) {
        const pattern = `graphql:${this.cacheConfig[queryType].prefix}:${queryType}:*`;
        const keys = await this.redis.keys(pattern);
        stats.byType[queryType] = keys.length;
        stats.totalKeys += keys.length;
      }
      
      // Informações de memória
      const info = await this.redis.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      if (memoryMatch) {
        stats.memoryUsage = parseInt(memoryMatch[1]);
      }
      
      return stats;
    } catch (error) {
      console.error(`❌ Erro ao obter estatísticas do cache: ${error.message}`);
      return null;
    }
  }

  // Limpar todo o cache
  async clearAll() {
    try {
      const pattern = 'graphql:*';
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`🗑️ Cache limpo: ${keys.length} chaves removidas`);
      }
      
      return keys.length;
    } catch (error) {
      console.error(`❌ Erro ao limpar cache: ${error.message}`);
      return 0;
    }
  }

  // Limpar referências circulares dos dados
  cleanCircularReferences(obj, seen = new WeakSet()) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (seen.has(obj)) {
      return '[Circular Reference]';
    }
    
    seen.add(obj);
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.cleanCircularReferences(item, seen));
    }
    
    const cleaned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        // Pular propriedades que podem causar referências circulares
        if (key === 'socket' || key === 'parser' || key === 'req' || key === 'res' || 
            key === 'connection' || key === 'client' || key === 'server') {
          continue;
        }
        
        try {
          cleaned[key] = this.cleanCircularReferences(obj[key], seen);
        } catch (error) {
          cleaned[key] = '[Error serializing]';
        }
      }
    }
    
    return cleaned;
  }

  // Health check do cache
  async healthCheck() {
    try {
      const testKey = 'graphql:health:test';
      const testValue = { timestamp: Date.now(), test: true };
      
      // Testar escrita
      await this.redis.setex(testKey, 10, JSON.stringify(testValue));
      
      // Testar leitura
      const cached = await this.redis.get(testKey);
      const parsed = JSON.parse(cached);
      
      // Limpar chave de teste
      await this.redis.del(testKey);
      
      return {
        status: 'healthy',
        readWrite: true,
        latency: Date.now() - parsed.timestamp
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        readWrite: false,
        error: error.message
      };
    }
  }
}

// Singleton instance
const advancedCache = new AdvancedCache();

module.exports = advancedCache;
