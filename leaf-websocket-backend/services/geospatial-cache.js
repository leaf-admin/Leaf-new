/**
 * GEOSPATIAL CACHE
 * 
 * Cache de resultados de busca geoespacial para evitar queries repetidas.
 * 
 * Funcionalidades:
 * - Cache de motoristas próximos por coordenada e raio
 * - Invalidação automática quando motoristas se movem
 * - TTL baseado em distância (raios maiores = cache mais longo)
 * - Limpeza automática de cache expirado
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

class GeospatialCache {
    constructor() {
        this.redis = redisPool.getConnection();
        
        // Configurações
        this.config = {
            // TTL baseado em raio (em segundos)
            // Raios menores = mais frequentes atualizações = cache menor
            ttlByRadius: {
                0.5: 10,   // 10 segundos para 0.5km
                1.0: 15,   // 15 segundos para 1.0km
                1.5: 20,   // 20 segundos para 1.5km
                2.0: 25,   // 25 segundos para 2.0km
                2.5: 30,   // 30 segundos para 2.5km
                3.0: 35,   // 35 segundos para 3.0km
                5.0: 60    // 60 segundos para 5.0km
            },
            
            // Prefixo das chaves
            prefix: 'geo_cache',
            
            // Precisão de cache (em graus, ~111km por grau)
            // Grid de 0.01 grau ≈ 1.1km
            gridPrecision: 0.01
        };
    }

    /**
     * Gerar chave de cache baseada em localização e raio
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} radius - Raio em km
     * @returns {string} Chave de cache
     */
    generateCacheKey(lat, lng, radius) {
        // Arredondar coordenadas para grid (reduz precisão para cache)
        const gridLat = Math.round(lat / this.config.gridPrecision) * this.config.gridPrecision;
        const gridLng = Math.round(lng / this.config.gridPrecision) * this.config.gridPrecision;
        
        // Arredondar raio para chave mais consistente
        const roundedRadius = Math.round(radius * 10) / 10; // 1 casa decimal
        
        return `${this.config.prefix}:${gridLat.toFixed(4)}:${gridLng.toFixed(4)}:${roundedRadius}km`;
    }

    /**
     * Obter TTL baseado no raio
     * @param {number} radius - Raio em km
     * @returns {number} TTL em segundos
     */
    getTTL(radius) {
        const roundedRadius = Math.round(radius * 10) / 10;
        
        // Buscar TTL exato ou próximo
        if (this.config.ttlByRadius[roundedRadius]) {
            return this.config.ttlByRadius[roundedRadius];
        }
        
        // Interpolar TTL se não encontrado
        const radii = Object.keys(this.config.ttlByRadius).map(r => parseFloat(r)).sort((a, b) => a - b);
        
        if (radius < radii[0]) {
            return this.config.ttlByRadius[radii[0]];
        }
        
        if (radius > radii[radii.length - 1]) {
            return this.config.ttlByRadius[radii[radii.length - 1]];
        }
        
        // Interpolar entre dois valores
        for (let i = 0; i < radii.length - 1; i++) {
            if (radius >= radii[i] && radius <= radii[i + 1]) {
                const ttl1 = this.config.ttlByRadius[radii[i]];
                const ttl2 = this.config.ttlByRadius[radii[i + 1]];
                const ratio = (radius - radii[i]) / (radii[i + 1] - radii[i]);
                return Math.round(ttl1 + (ttl2 - ttl1) * ratio);
            }
        }
        
        return 30; // Padrão
    }

    /**
     * Buscar motoristas do cache
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} radius - Raio em km
     * @returns {Promise<Array|null>} Array de motoristas ou null se não encontrado
     */
    async get(lat, lng, radius) {
        try {
            const cacheKey = this.generateCacheKey(lat, lng, radius);
            const cached = await this.redis.get(cacheKey);
            
            if (cached) {
                const data = JSON.parse(cached);
                logger.debug(`✅ [GeoCache] Cache HIT para ${cacheKey} (${data.drivers.length} motoristas)`);
                return data.drivers;
            }
            
            logger.debug(`❌ [GeoCache] Cache MISS para ${cacheKey}`);
            return null;
        } catch (error) {
            logger.error(`❌ [GeoCache] Erro ao buscar do cache:`, error);
            return null;
        }
    }

    /**
     * Armazenar motoristas no cache
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} radius - Raio em km
     * @param {Array} drivers - Array de motoristas
     */
    async set(lat, lng, radius, drivers) {
        try {
            const cacheKey = this.generateCacheKey(lat, lng, radius);
            const ttl = this.getTTL(radius);
            
            const data = {
                lat,
                lng,
                radius,
                drivers,
                cachedAt: Date.now(),
                expiresAt: Date.now() + (ttl * 1000)
            };
            
            await this.redis.setex(cacheKey, ttl, JSON.stringify(data));
            
            logger.debug(`💾 [GeoCache] Cache SET para ${cacheKey} (TTL: ${ttl}s, ${drivers.length} motoristas)`);
        } catch (error) {
            logger.error(`❌ [GeoCache] Erro ao armazenar no cache:`, error);
        }
    }

    /**
     * Invalidar cache de uma região específica
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} maxRadius - Raio máximo a invalidar
     */
    async invalidate(lat, lng, maxRadius = 5.0) {
        try {
            const gridLat = Math.round(lat / this.config.gridPrecision) * this.config.gridPrecision;
            const gridLng = Math.round(lng / this.config.gridPrecision) * this.config.gridPrecision;
            
            // Buscar todas as chaves de cache para esta região
            const pattern = `${this.config.prefix}:${gridLat.toFixed(4)}:${gridLng.toFixed(4)}:*`;
            const keys = await this.redis.keys(pattern);
            
            // Deletar apenas chaves com raio <= maxRadius
            let deleted = 0;
            for (const key of keys) {
                const match = key.match(/:([\d.]+)km$/);
                if (match) {
                    const radius = parseFloat(match[1]);
                    if (radius <= maxRadius) {
                        await this.redis.del(key);
                        deleted++;
                    }
                }
            }
            
            if (deleted > 0) {
                logger.debug(`🗑️ [GeoCache] ${deleted} chave(s) invalidada(s) para região ${gridLat}, ${gridLng}`);
            }
        } catch (error) {
            logger.error(`❌ [GeoCache] Erro ao invalidar cache:`, error);
        }
    }

    /**
     * Limpar todo o cache geoespacial
     */
    async clear() {
        try {
            const keys = await this.redis.keys(`${this.config.prefix}:*`);
            if (keys.length > 0) {
                await Promise.all(keys.map(key => this.redis.del(key)));
                logger.info(`🗑️ [GeoCache] ${keys.length} chave(s) deletada(s)`);
            }
        } catch (error) {
            logger.error(`❌ [GeoCache] Erro ao limpar cache:`, error);
        }
    }

    /**
     * Obter estatísticas do cache
     * @returns {Promise<Object>} Estatísticas
     */
    async getStats() {
        try {
            const keys = await this.redis.keys(`${this.config.prefix}:*`);
            
            let totalDrivers = 0;
            let oldestCache = null;
            let newestCache = null;
            
            for (const key of keys) {
                try {
                    const data = await this.redis.get(key);
                    if (data) {
                        const parsed = JSON.parse(data);
                        totalDrivers += parsed.drivers.length;
                        
                        const cachedAt = parsed.cachedAt;
                        if (!oldestCache || cachedAt < oldestCache) {
                            oldestCache = cachedAt;
                        }
                        if (!newestCache || cachedAt > newestCache) {
                            newestCache = cachedAt;
                        }
                    }
                } catch (e) {
                    // Ignorar erros de parse
                }
            }
            
            return {
                totalKeys: keys.length,
                totalDrivers: totalDrivers,
                oldestCache: oldestCache ? new Date(oldestCache).toISOString() : null,
                newestCache: newestCache ? new Date(newestCache).toISOString() : null
            };
        } catch (error) {
            logger.error(`❌ [GeoCache] Erro ao obter estatísticas:`, error);
            return {
                totalKeys: 0,
                totalDrivers: 0,
                oldestCache: null,
                newestCache: null
            };
        }
    }
}

module.exports = new GeospatialCache();


