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
      .createHash('sha256')
      .update(JSON.stringify({ ...params, ...context }))
      .digest('hex');
    
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
      const key = await this.versionedKey(queryType, this.generateCacheKey(queryType, params, context), context);
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
      const key = await this.versionedKey(queryType, this.generateCacheKey(queryType, params, context), context);
      const ttl = config.ttl;
      
      // Limpar dados de objetos circulares antes de armazenar
      const cleanData = this.cleanCircularReferences(data);
      
      await this.redis.setex(key, ttl, JSON.stringify(cleanData));
      console.log(`📊 Cache SET: ${queryType} - TTL: ${ttl}s - ${key}`);
      
      
      return true;
    } catch (error) {
      console.error(`❌ Erro ao armazenar cache: ${error.message}`);
      return false;
    }
  }

  // Version invalidation is constant work. Old cache values expire naturally;
  // they are never enumerated or deleted as one unbounded Redis command.
  async versionedKey(queryType, baseKey, context = {}) {
    const user = crypto.createHash('sha256').update(String(context.userId || 'anonymous')).digest('hex');
    const versions = await this.redis.mget('graphql:version:all',
      `graphql:version:type:${queryType}`, `graphql:version:user:${user}`);
    const generation = crypto.createHash('sha256').update(JSON.stringify(versions)).digest('hex');
    return `graphql:v2:${generation}:${baseKey}`;
  }

  async rotateVersion(key) {
    await this.redis.set(key, crypto.randomUUID(), 'EX', 7200);
    // This is one logical invalidation, not a claim about how many keys existed.
    return { invalidated: true, strategy: 'namespace-version', deletedKeys: 0 };
  }

  async invalidate(queryType) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(queryType)) throw new Error('Invalid cache type');
    return this.rotateVersion(`graphql:version:type:${queryType}`);
  }

  async invalidateUserContext(userId) {
    const hash = crypto.createHash('sha256').update(String(userId)).digest('hex');
    return this.rotateVersion(`graphql:version:user:${hash}`);
  }

  async invalidatePattern(pattern) {
    if (pattern === 'graphql:*') return this.clearAll();
    const type = /^graphql:[a-zA-Z0-9_*]+:([a-zA-Z0-9_-]+):\*$/.exec(String(pattern));
    if (type) return this.invalidate(type[1]);
    const error = new Error('Use invalidação por tipo/usuário; padrões arbitrários não são suportados');
    error.statusCode = 400;
    throw error;
  }

  // Cache com fallback automático
  async getOrSet(queryType, fetchFunction, params = {}, context = {}) {
    let key = null;
    try {
      key = await this.versionedKey(queryType, this.generateCacheKey(queryType, params, context), context);
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch (_) { /* Cache failure must not amplify the upstream request. */ }
    const data = await fetchFunction();
    if (data && key) {
      try {
        // Pin the generation before fetching. An invalidation during the fetch
        // must not put an old result into the new namespace.
        const ttl = this.cacheConfig[queryType]?.ttl || this.defaultTTL;
        await this.redis.setex(key, ttl, JSON.stringify(this.cleanCircularReferences(data)));
      } catch (_) { /* Cache writes are optional. */ }
    }
    return data;
  }

  // Cache de métricas em tempo real
  async getMetricsCache(metricType, params = {}) {
    try {
      const key = await this.versionedKey(metricType, `graphql:metrics:${metricType}:${JSON.stringify(params)}`);
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
      const key = await this.versionedKey(metricType, `graphql:metrics:${metricType}:${JSON.stringify(params)}`);
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
      const key = await this.versionedKey(queryType, `graphql:spatial:${queryType}:${locationKey}`);
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
      const key = await this.versionedKey(queryType, `graphql:spatial:${queryType}:${locationKey}`);
      
      await this.redis.setex(key, this.spatialTTL, JSON.stringify(data));
      console.log(`📊 Cache espacial SET: ${queryType} - ${locationKey}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Erro ao armazenar cache espacial: ${error.message}`);
      return false;
    }
  }

  // Global occupancy by pattern is intentionally not computed on a request.
  // Unknown counts are explicit, rather than returning a fabricated zero.
  async getCacheStats() {
    const info = await this.redis.info('memory');
    const memory = /used_memory:(\d+)/.exec(info);
    return { totalKeys: null, byType: null, hitRate: null,
      memoryUsage: memory ? Number(memory[1]) : null,
      countsAvailable: false, invalidationStrategy: 'namespace-version' };
  }

  async clearAll() {
    return this.rotateVersion('graphql:version:all');
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
