/**
 * IDEMPOTENCY SERVICE
 * 
 * Garante que requisições duplicadas não sejam processadas múltiplas vezes.
 * Usa Redis para armazenar chaves de idempotency com TTL.
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');

class IdempotencyService {
    constructor() {
        this.redis = null;
        this.defaultTTL = 60; // 60 segundos (ajustável)
    }

    /**
     * Garantir conexão Redis
     */
    async ensureConnection() {
        if (!this.redis) {
            await redisPool.ensureConnection();
            this.redis = redisPool.getConnection();
        }
    }

    /**
     * Verificar e registrar idempotency key
     * @param {string} key - Chave de idempotency (geralmente: userId:action:uniqueId)
     * @param {number} ttl - Time to live em segundos (opcional)
     * @returns {Promise<{isNew: boolean, cachedResult: any|null}>}
     */
    async checkAndSet(key, ttl = null) {
        try {
            await this.ensureConnection();
            
            const idempotencyKey = `idempotency:${key}`;
            const ttlToUse = ttl || this.defaultTTL;
            
            // Tentar criar a chave (SETNX)
            const result = await this.redis.set(idempotencyKey, '1', 'EX', ttlToUse, 'NX');
            
            if (result === 'OK' || result === true) {
                // Chave criada = primeira vez (não é duplicado)
                logger.debug(`✅ [Idempotency] Nova requisição: ${key}`);
                metrics.recordIdempotency(key.split(':')[0] || 'unknown', false); // miss
                return { isNew: true, cachedResult: null };
            } else {
                // Chave já existe = requisição duplicada
                logger.warn(`⚠️ [Idempotency] Requisição duplicada detectada: ${key}`);
                
                // Tentar buscar resultado cached (se existir)
                const cachedResult = await this.redis.get(`idempotency:result:${key}`);
                
                if (cachedResult) {
                    logger.debug(`✅ [Idempotency] Retornando resultado cached para: ${key}`);
                    metrics.recordIdempotency(key.split(':')[0] || 'unknown', true); // hit
                    return { 
                        isNew: false, 
                        cachedResult: JSON.parse(cachedResult) 
                    };
                }
                
                metrics.recordIdempotency(key.split(':')[0] || 'unknown', true); // hit (duplicado sem cache)
                return { isNew: false, cachedResult: null };
            }
        } catch (error) {
            logger.error(`❌ [Idempotency] Erro ao verificar idempotency: ${error.message}`);
            // Fail-open: se Redis falhar, permitir requisição (melhor que bloquear)
            return { isNew: true, cachedResult: null };
        }
    }

    /**
     * Armazenar resultado para requisição idempotente
     * @param {string} key - Chave de idempotency
     * @param {any} result - Resultado a ser cached
     * @param {number} ttl - Time to live em segundos (opcional)
     */
    async cacheResult(key, result, ttl = null) {
        try {
            await this.ensureConnection();
            
            const cacheKey = `idempotency:result:${key}`;
            const ttlToUse = ttl || this.defaultTTL;
            
            await this.redis.setex(
                cacheKey,
                ttlToUse,
                JSON.stringify(result)
            );
            
            logger.debug(`✅ [Idempotency] Resultado cached para: ${key}`);
        } catch (error) {
            logger.error(`❌ [Idempotency] Erro ao cachear resultado: ${error.message}`);
            // Não falhar se cache falhar
        }
    }

    /**
     * Gerar chave de idempotency
     * @param {string} userId - ID do usuário
     * @param {string} action - Ação sendo executada (ex: 'createBooking', 'acceptRide')
     * @param {string} uniqueId - ID único da requisição (opcional, será gerado se não fornecido)
     * @returns {string} Chave de idempotency
     */
    generateKey(userId, action, uniqueId = null) {
        if (uniqueId) {
            return `${userId}:${action}:${uniqueId}`;
        }
        // Se não fornecer uniqueId, usar timestamp (menos seguro, mas funciona)
        return `${userId}:${action}:${Date.now()}`;
    }

    /**
     * Limpar chave de idempotency (útil para testes ou casos especiais)
     * @param {string} key - Chave de idempotency
     */
    async clearKey(key) {
        try {
            await this.ensureConnection();
            
            const idempotencyKey = `idempotency:${key}`;
            const cacheKey = `idempotency:result:${key}`;
            
            await this.redis.del(idempotencyKey);
            await this.redis.del(cacheKey);
            
            logger.debug(`✅ [Idempotency] Chave limpa: ${key}`);
        } catch (error) {
            logger.error(`❌ [Idempotency] Erro ao limpar chave: ${error.message}`);
        }
    }
}

// Singleton
const idempotencyService = new IdempotencyService();
module.exports = idempotencyService;

