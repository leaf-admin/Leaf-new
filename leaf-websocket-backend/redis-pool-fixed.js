const Redis = require('ioredis');
const { logger } = require('./logger');

class RedisPool {
    constructor() {
        this.pool = null;
        this.initializePool();
    }

    initializePool() {
        try {
            // Usar REDIS_URL se disponível, senão fallback para configuração manual
            if (process.env.REDIS_URL) {
                this.pool = new Redis(process.env.REDIS_URL, {
                    maxRetriesPerRequest: 3,
                    retryDelayOnFailover: 100,
                    enableReadyCheck: true,
                    maxLoadingTimeout: 10000,
                    lazyConnect: true,
                    keepAlive: 30000,
                    family: 4,
                    connectTimeout: 10000,
                    commandTimeout: 5000,
                    retryDelayOnClusterDown: 300,
                    healthCheckInterval: 30000,
                    showFriendlyErrorStack: true
                });
            } else {
                // Fallback para configuração manual
                this.pool = new Redis({
                    host: process.env.REDIS_HOST || 'redis-master',
                    port: process.env.REDIS_PORT || 6379,
                    password: process.env.REDIS_PASSWORD,
                    db: process.env.REDIS_DB || 0,
                    maxRetriesPerRequest: 3,
                    retryDelayOnFailover: 100,
                    enableReadyCheck: true,
                    maxLoadingTimeout: 10000,
                    lazyConnect: true,
                    keepAlive: 30000,
                    family: 4,
                    connectTimeout: 10000,
                    commandTimeout: 5000,
                    retryDelayOnClusterDown: 300,
                    healthCheckInterval: 30000,
                    showFriendlyErrorStack: true
                });
            }
            
            this.setupEventHandlers();
            logger.info('Redis Pool inicializado com configuracoes otimizadas');
        } catch (error) {
            logger.error(`Erro ao inicializar Redis Pool: ${error.message}`);
            throw error;
        }
    }

    setupEventHandlers() {
        this.pool.on('connect', () => {
            logger.info('Redis Pool conectado com sucesso');
        });

        this.pool.on('error', (error) => {
            logger.error(`Redis Pool error: ${error.message}`);
        });

        this.pool.on('ready', () => {
            logger.info('Redis Pool pronto para uso');
        });
    }

    getConnection() {
        return this.pool;
    }

    async executeWithRetry(operation, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await this.delay(100 * Math.pow(2, i));
            }
        }
    }

    async setWithTTL(key, value, ttl = 3600) {
        return await this.executeWithRetry(async () => {
            return await this.pool.setex(key, ttl, JSON.stringify(value));
        });
    }

    async getWithFallback(key, fallbackOperation) {
        try {
            const cached = await this.pool.get(key);
            if (cached) return JSON.parse(cached);
        } catch (error) {
            logger.warn(`Cache miss para ${key}: ${error.message}`);
        }

        const result = await fallbackOperation();
        await this.setWithTTL(key, result);
        return result;
    }

    async batchSet(keyValuePairs, ttl = 3600) {
        const pipeline = this.pool.pipeline();
        keyValuePairs.forEach(([key, value]) => {
            pipeline.setex(key, ttl, JSON.stringify(value));
        });
        return await pipeline.exec();
    }

    async healthCheck() {
        try {
            const start = Date.now();
            await this.pool.ping();
            const latency = Date.now() - start;
            
            return {
                status: 'healthy',
                latency: `${latency}ms`,
                connected: this.pool.status === 'ready',
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

    async clearCache() {
        try {
            await this.pool.flushdb();
            logger.info('Cache Redis limpo com sucesso');
            return true;
        } catch (error) {
            logger.error(`Erro ao limpar cache: ${error.message}`);
            return false;
        }
    }

    getPoolStats() {
        return {
            status: this.pool ? this.pool.status : 'disconnected',
            connected: this.pool && this.pool.status === 'ready',
            timestamp: new Date().toISOString()
        };
    }

    async close() {
        if (this.pool) {
            await this.pool.quit();
            logger.info('Redis Pool fechado');
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const redisPool = new RedisPool();
module.exports = redisPool;
