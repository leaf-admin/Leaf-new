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
        this.defaultJoinWaitMs = 1500;
        this.defaultPollIntervalMs = 75;
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

            const operation = this.extractOperationFromKey(key);
            
            const idempotencyKey = `idempotency:${key}`;
            const ttlToUse = ttl || this.defaultTTL;
            
            // Tentar criar a chave (SETNX)
            const result = await this.redis.set(idempotencyKey, '1', 'EX', ttlToUse, 'NX');
            
            if (result === 'OK' || result === true) {
                // Chave criada = primeira vez (não é duplicado)
                logger.debug(`✅ [Idempotency] Nova requisição: ${key}`);
                metrics.recordIdempotency(operation, false); // miss
                return { isNew: true, cachedResult: null };
            } else {
                // Chave já existe = requisição duplicada
                logger.warn(`⚠️ [Idempotency] Requisição duplicada detectada: ${key}`);
                
                // Tentar buscar resultado cached (se existir)
                const cachedResult = await this.redis.get(`idempotency:result:${key}`);
                
                if (cachedResult) {
                    logger.debug(`✅ [Idempotency] Retornando resultado cached para: ${key}`);
                    metrics.recordIdempotency(operation, true); // hit
                    return { 
                        isNew: false, 
                        cachedResult: JSON.parse(cachedResult) 
                    };
                }
                
                metrics.recordIdempotency(operation, true); // hit (duplicado sem cache)
                return { isNew: false, cachedResult: null };
            }
        } catch (error) {
            logger.error(`❌ [Idempotency] Erro ao verificar idempotency: ${error.message}`);
            // Fail-open: se Redis falhar, permitir requisição (melhor que bloquear)
            return { isNew: true, cachedResult: null };
        }
    }

    getIdempotencyStorageKeys(key) {
        return {
            idempotencyKey: `idempotency:${key}`,
            cacheKey: `idempotency:result:${key}`
        };
    }

    async getCachedResult(key) {
        await this.ensureConnection();
        const { cacheKey } = this.getIdempotencyStorageKeys(key);
        const cachedResult = await this.redis.get(cacheKey);
        if (!cachedResult) {
            return null;
        }

        try {
            return JSON.parse(cachedResult);
        } catch (_parseError) {
            return null;
        }
    }

    async waitForCachedResult(key, {
        waitMs = this.defaultJoinWaitMs,
        pollIntervalMs = this.defaultPollIntervalMs
    } = {}) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < waitMs) {
            const cachedResult = await this.getCachedResult(key);
            if (cachedResult) {
                return cachedResult;
            }

            const { idempotencyKey } = this.getIdempotencyStorageKeys(key);
            const stillInFlight = await this.redis.exists(idempotencyKey);
            if (!stillInFlight) {
                return null;
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        return null;
    }

    async beginRequest(key, options = {}) {
        const {
            ttl = null,
            joinWaitMs = this.defaultJoinWaitMs,
            pollIntervalMs = this.defaultPollIntervalMs,
            allowJoin = true
        } = options || {};

        try {
            await this.ensureConnection();

            const operation = this.extractOperationFromKey(key);
            const ttlToUse = ttl || this.defaultTTL;
            const { idempotencyKey } = this.getIdempotencyStorageKeys(key);
            const marker = JSON.stringify({
                status: 'processing',
                startedAt: new Date().toISOString(),
                pid: process.pid
            });

            const result = await this.redis.set(idempotencyKey, marker, 'EX', ttlToUse, 'NX');
            if (result === 'OK' || result === true) {
                metrics.recordIdempotency(operation, 'miss');
                return {
                    isNew: true,
                    disposition: 'started',
                    cachedResult: null
                };
            }

            const cachedResult = await this.getCachedResult(key);
            if (cachedResult) {
                metrics.recordIdempotency(operation, 'hit');
                return {
                    isNew: false,
                    disposition: 'cached',
                    cachedResult
                };
            }

            if (allowJoin) {
                const joinedResult = await this.waitForCachedResult(key, {
                    waitMs: joinWaitMs,
                    pollIntervalMs
                });

                if (joinedResult) {
                    metrics.recordIdempotency(operation, 'joined');
                    return {
                        isNew: false,
                        disposition: 'joined',
                        cachedResult: joinedResult
                    };
                }
            }

            metrics.recordIdempotency(operation, 'inflight');
            return {
                isNew: false,
                disposition: 'inflight',
                cachedResult: null
            };
        } catch (error) {
            logger.error(`❌ [Idempotency] Erro ao iniciar requisição idempotente: ${error.message}`);
            return {
                isNew: true,
                disposition: 'started',
                cachedResult: null
            };
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
            
            const { cacheKey, idempotencyKey } = this.getIdempotencyStorageKeys(key);
            const ttlToUse = ttl || this.defaultTTL;
            
            await this.redis.setex(
                cacheKey,
                ttlToUse,
                JSON.stringify(result)
            );
            await this.redis.expire(idempotencyKey, ttlToUse).catch(() => null);
            
            logger.debug(`✅ [Idempotency] Resultado cached para: ${key}`);
        } catch (error) {
            logger.error(`❌ [Idempotency] Erro ao cachear resultado: ${error.message}`);
            // Não falhar se cache falhar
        }
    }

    async releaseInflight(key) {
        try {
            await this.ensureConnection();
            const { idempotencyKey } = this.getIdempotencyStorageKeys(key);
            await this.redis.del(idempotencyKey);
            logger.debug(`✅ [Idempotency] Lock em voo liberado: ${key}`);
        } catch (error) {
            logger.error(`❌ [Idempotency] Erro ao liberar lock em voo: ${error.message}`);
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

    normalizeOperationLabel(value) {
        const safe = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!safe) return 'unknown';
        if (safe.length > 40) {
            return safe.slice(0, 40);
        }
        return safe;
    }

    extractOperationFromKey(key) {
        if (!key || typeof key !== 'string') {
            return 'unknown';
        }

        const parts = key.split(':');
        if (parts.length >= 2 && parts[1]) {
            return this.normalizeOperationLabel(parts[1]);
        }

        const lower = key.toLowerCase();
        if (lower.startsWith('sustain_')) return 'sustain';
        if (lower.startsWith('capacity_')) return 'capacity';
        if (lower.startsWith('system')) return 'system';

        const firstToken = lower.split('_')[0];
        return this.normalizeOperationLabel(firstToken || 'custom');
    }

    /**
     * Limpar chave de idempotency (útil para testes ou casos especiais)
     * @param {string} key - Chave de idempotency
     */
    async clearKey(key) {
        try {
            await this.ensureConnection();
            
            const { idempotencyKey, cacheKey } = this.getIdempotencyStorageKeys(key);
            
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
