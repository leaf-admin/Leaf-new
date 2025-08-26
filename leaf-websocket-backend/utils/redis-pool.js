const Redis = require('ioredis');
const { logger } = require('./logger');

class RedisPool {
    constructor() {
        this.pool = null;
        this.initializePool();
    }

    initializePool() {
        try {
            // Configuração otimizada para connection pooling
            this.pool = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD,
                db: process.env.REDIS_DB || 0,
                
                // Connection pooling configuration
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                maxLoadingTimeout: 10000,
                
                // Performance optimizations
                lazyConnect: true,
                keepAlive: 30000,
                
                // Connection pool settings
                family: 4,
                connectTimeout: 10000,
                commandTimeout: 5000,
                
                // Auto-reconnection
                retryDelayOnClusterDown: 300,
                retryDelayOnFailover: 100,
                maxRetriesPerRequest: 3,
                
                // Health checks
                healthCheckInterval: 30000,
                
                // Error handling
                showFriendlyErrorStack: true
            });

            this.setupEventHandlers();
            logger.info('🚀 Redis Pool inicializado com configurações otimizadas');
            
        } catch (error) {
            logger.error(`❌ Erro ao inicializar Redis Pool: ${error.message}`);
            throw error;
        }
    }

    setupEventHandlers() {
        this.pool.on('connect', () => {
            logger.info('🚀 Redis Pool conectado');
        });

        this.pool.on('ready', () => {
            logger.info('✅ Redis Pool pronto para operações');
        });

        this.pool.on('error', (error) => {
            logger.error(`❌ Erro no Redis Pool: ${error.message}`);
        });

        this.pool.on('close', () => {
            logger.warn('⚠️ Redis Pool fechado, tentando reconectar...');
        });

        this.pool.on('reconnecting', () => {
            logger.info('🔄 Reconectando Redis Pool...');
        });
    }

    // Método para obter conexão do pool
    getConnection() {
        return this.pool;
    }

    // Método para health check
    async healthCheck() {
        try {
            const start = Date.now();
            await this.pool.ping();
            const latency = Date.now() - start;
            
            return {
                status: 'healthy',
                latency,
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

    // Método para obter estatísticas do pool
    getPoolStats() {
        return {
            status: this.pool.status,
            connected: this.pool.status === 'ready',
            options: {
                host: this.pool.options.host,
                port: this.pool.options.port,
                db: this.pool.options.db
            }
        };
    }
}

// Singleton instance
const redisPool = new RedisPool();

module.exports = redisPool;
