/**
 * Cache Inteligente com Redis
 * 
 * Estratégia de cache baseada em:
 * - TTL baseado em frequência de atualização
 * - Invalidação automática quando dados mudam
 * - Cache em camadas (Redis + memória)
 * 
 * Arquitetura:
 * - Redis: dados voláteis com TTL curto (minutos)
 * - Firestore: dados finais e persistentes apenas
 */

const redisPool = require('./redis-pool');
const { logger } = require('./logger');
const { getTTL, TTL_CONFIG } = require('../config/redis-ttl-config');

class IntelligentCache {
    constructor() {
        this.redis = redisPool.getConnection();
        this.memoryCache = new Map(); // Cache em memória para acesso ultra-rápido
        this.memoryCacheTTL = new Map(); // TTLs do cache em memória
    }

    /**
     * Obter ou definir valor no cache
     * @param {string} key - Chave do cache
     * @param {Function} fetchFn - Função para buscar dados se não estiver em cache
     * @param {string} type - Tipo de cache (ex: 'CACHE.USER_PROFILE', 'CACHE.NEARBY_DRIVERS')
     * @param {Object} options - Opções adicionais
     * @returns {Promise<any>}
     */
    async getOrSet(key, fetchFn, type = 'CACHE.USER_PROFILE', options = {}) {
        try {
            // 1. Tentar cache em memória primeiro (mais rápido)
            const memoryKey = `${type}:${key}`;
            if (this.memoryCache.has(memoryKey)) {
                const cached = this.memoryCache.get(memoryKey);
                const ttl = this.memoryCacheTTL.get(memoryKey);
                
                if (ttl && Date.now() < ttl) {
                    logger.debug(`✅ [IntelligentCache] Cache hit (memória): ${memoryKey}`);
                    return cached;
                } else {
                    // TTL expirado, remover
                    this.memoryCache.delete(memoryKey);
                    this.memoryCacheTTL.delete(memoryKey);
                }
            }

            // 2. Tentar cache no Redis
            const redisKey = `cache:${type}:${key}`;
            try {
                const cached = await this.redis.get(redisKey);
                if (cached) {
                    const data = JSON.parse(cached);
                    
                    // Armazenar também em memória para próximo acesso
                    const ttl = getTTL(type);
                    this.memoryCache.set(memoryKey, data);
                    this.memoryCacheTTL.set(memoryKey, Date.now() + (ttl * 1000));
                    
                    logger.debug(`✅ [IntelligentCache] Cache hit (Redis): ${redisKey}`);
                    return data;
                }
            } catch (redisError) {
                logger.warn(`⚠️ [IntelligentCache] Erro ao buscar do Redis: ${redisError.message}`);
            }

            // 3. Cache miss - buscar dados
            logger.debug(`❌ [IntelligentCache] Cache miss: ${redisKey}`);
            const data = await fetchFn();

            // 4. Armazenar no cache (Redis + memória)
            const ttl = getTTL(type);
            
            // Redis (persistente entre processos)
            try {
                await this.redis.setex(redisKey, ttl, JSON.stringify(data));
            } catch (redisError) {
                logger.warn(`⚠️ [IntelligentCache] Erro ao salvar no Redis: ${redisError.message}`);
            }
            
            // Memória (ultra-rápido)
            this.memoryCache.set(memoryKey, data);
            this.memoryCacheTTL.set(memoryKey, Date.now() + (ttl * 1000));

            return data;
        } catch (error) {
            logger.error(`❌ [IntelligentCache] Erro ao obter/definir cache:`, error);
            // Em caso de erro, buscar dados diretamente
            return await fetchFn();
        }
    }

    /**
     * Invalidar cache
     * @param {string} key - Chave do cache
     * @param {string} type - Tipo de cache
     */
    async invalidate(key, type = 'CACHE.USER_PROFILE') {
        try {
            const memoryKey = `${type}:${key}`;
            const redisKey = `cache:${type}:${key}`;

            // Remover do cache em memória
            this.memoryCache.delete(memoryKey);
            this.memoryCacheTTL.delete(memoryKey);

            // Remover do Redis
            await this.redis.del(redisKey);

            logger.debug(`🗑️ [IntelligentCache] Cache invalidado: ${redisKey}`);
        } catch (error) {
            logger.error(`❌ [IntelligentCache] Erro ao invalidar cache:`, error);
        }
    }

    /**
     * Invalidar cache por padrão (ex: todos os caches de um usuário)
     * @param {string} pattern - Padrão de busca (ex: 'user:*')
     * @param {string} type - Tipo de cache
     */
    async invalidatePattern(pattern, type = 'CACHE.USER_PROFILE') {
        try {
            const RedisScan = require('./redis-scan');
            const keys = await RedisScan.scanKeys(this.redis, `cache:${type}:${pattern}`);

            if (keys.length > 0) {
                await this.redis.del(...keys);
                logger.debug(`🗑️ [IntelligentCache] ${keys.length} caches invalidados por padrão: ${pattern}`);
            }

            // Limpar cache em memória também
            for (const [key, value] of this.memoryCache.entries()) {
                if (key.includes(pattern)) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                }
            }
        } catch (error) {
            logger.error(`❌ [IntelligentCache] Erro ao invalidar cache por padrão:`, error);
        }
    }

    /**
     * Limpar cache expirado em memória (chamado periodicamente)
     */
    cleanupMemoryCache() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, ttl] of this.memoryCacheTTL.entries()) {
            if (now >= ttl) {
                this.memoryCache.delete(key);
                this.memoryCacheTTL.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.debug(`🧹 [IntelligentCache] ${cleaned} entradas expiradas removidas do cache em memória`);
        }
    }

    /**
     * Obter estatísticas do cache
     * @returns {Object}
     */
    async getStats() {
        try {
            const memorySize = this.memoryCache.size;
            const redisInfo = await this.redis.info('memory');
            const usedMemory = redisInfo.match(/used_memory:(\d+)/)?.[1] || '0';

            return {
                memory: {
                    entries: memorySize,
                    maxSize: 1000 // Limite de 1000 entradas em memória
                },
                redis: {
                    usedMemory: parseInt(usedMemory),
                    usedMemoryHuman: `${(parseInt(usedMemory) / 1024 / 1024).toFixed(2)} MB`
                }
            };
        } catch (error) {
            logger.error(`❌ [IntelligentCache] Erro ao obter estatísticas:`, error);
            return {
                memory: { entries: 0, maxSize: 1000 },
                redis: { usedMemory: 0, usedMemoryHuman: '0 MB' }
            };
        }
    }
}

// Singleton instance
const intelligentCache = new IntelligentCache();

// Limpar cache em memória a cada 5 minutos
setInterval(() => {
    intelligentCache.cleanupMemoryCache();
}, 5 * 60 * 1000);

module.exports = intelligentCache;

