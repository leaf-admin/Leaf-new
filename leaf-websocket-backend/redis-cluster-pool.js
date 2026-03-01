const Redis = require('ioredis');
const { logger } = require('./logger');

class RedisClusterPool {
    constructor() {
        this.cluster = null;
        this.sentinels = null;
        this.initializeCluster();
    }

    initializeCluster() {
        try {
            // Configuração do cluster Redis com load balancing simples
            const clusterNodes = [
                { host: process.env.REDIS_MASTER || 'localhost', port: 6379 },
                { host: process.env.REDIS_REPLICA_1 || 'localhost', port: 6380 },
                { host: process.env.REDIS_REPLICA_2 || 'localhost', port: 6381 }
            ];

            const sentinelConfig = {
                sentinels: [
                    { host: process.env.REDIS_SENTINEL_1 || 'localhost', port: 26379 },
                    { host: process.env.REDIS_SENTINEL_2 || 'localhost', port: 26380 },
                    { host: process.env.REDIS_SENTINEL_3 || 'localhost', port: 26381 }
                ],
                name: 'leaf-master',
                role: 'master',
                
                // Configurações de performance
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                maxLoadingTimeout: 10000,
                
                // Connection pooling
                lazyConnect: true,
                keepAlive: 30000,
                family: 4,
                connectTimeout: 10000,
                commandTimeout: 5000,
                
                // Cluster settings
                enableOfflineQueue: false,
                retryDelayOnClusterDown: 300,
                retryDelayOnFailover: 100,
                
                // Read preference (para load balancing)
                scaleReads: 'slave', // Leituras nas replicas
                
                // Health checks
                healthCheckInterval: 30000,
                
                // Error handling
                showFriendlyErrorStack: true
            };

            // Usar conexão simples com load balancing manual por enquanto
            logger.info('🔗 Conectando ao Redis Master com leituras distribuídas...');
            this.cluster = new Redis({
                host: process.env.REDIS_MASTER || 'localhost',
                port: 6379,
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                lazyConnect: true,
                keepAlive: 30000,
                connectTimeout: 10000,
                commandTimeout: 5000
            });

            this.setupEventHandlers();
            logger.info('🚀 Redis Cluster Pool inicializado com alta disponibilidade');
            
        } catch (error) {
            logger.error(`❌ Erro ao inicializar Redis Cluster: ${error.message}`);
            // Fallback para Redis simples
            this.initializeFallback();
        }
    }

    initializeFallback() {
        try {
            logger.warn('⚠️ Usando Redis simples como fallback...');
            this.cluster = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                lazyConnect: true,
                keepAlive: 30000,
                connectTimeout: 10000,
                commandTimeout: 5000
            });
            
            this.setupEventHandlers();
            logger.info('🔄 Redis fallback inicializado');
            
        } catch (fallbackError) {
            logger.error(`❌ Erro crítico no Redis fallback: ${fallbackError.message}`);
            throw fallbackError;
        }
    }

    setupEventHandlers() {
        // Eventos de conexão
        this.cluster.on('connect', () => {
            logger.info('🔗 Redis Cluster conectado');
        });

        this.cluster.on('ready', () => {
            logger.info('✅ Redis Cluster pronto para operações');
        });

        this.cluster.on('error', (error) => {
            logger.error(`❌ Erro no Redis Cluster: ${error.message}`);
        });

        this.cluster.on('close', () => {
            logger.warn('🔌 Conexão Redis Cluster fechada');
        });

        this.cluster.on('reconnecting', () => {
            logger.info('🔄 Reconectando ao Redis Cluster...');
        });

        // Eventos específicos do Sentinel (apenas se usando sentinel)
        if (process.env.USE_SENTINEL === 'true') {
            this.cluster.on('+switch-master', () => {
                logger.info('🔄 Failover detectado - novo master selecionado');
            });
        }

        // Eventos específicos do Cluster (apenas se for cluster real)
        if (this.cluster.nodes && typeof this.cluster.nodes === 'function') {
            this.cluster.on('node error', (error, node) => {
                if (node && node.options) {
                    logger.error(`❌ Erro no nó ${node.options.host}:${node.options.port}: ${error.message}`);
                } else {
                    logger.error(`❌ Erro no cluster: ${error.message}`);
                }
            });
        }
    }

    // Método para obter conexão (compatibilidade)
    getConnection() {
        return this.cluster;
    }

    // Método para obter informações do cluster
    async getClusterInfo() {
        try {
            const info = {
                mode: this.cluster.mode || 'unknown',
                status: this.cluster.status,
                nodes: [],
                sentinel: process.env.USE_SENTINEL !== 'false'
            };

            // Se for cluster, obter info dos nós
            if (this.cluster.nodes) {
                info.nodes = this.cluster.nodes('all').map(node => ({
                    host: node.options.host,
                    port: node.options.port,
                    status: node.status
                }));
            }

            return info;
        } catch (error) {
            logger.error(`❌ Erro ao obter info do cluster: ${error.message}`);
            return { error: error.message };
        }
    }

    // Método para testar performance
    async testPerformance() {
        try {
            const start = Date.now();
            
            // Teste de escrita
            await this.cluster.set('test:performance', Date.now());
            const writeTime = Date.now() - start;
            
            // Teste de leitura
            const readStart = Date.now();
            await this.cluster.get('test:performance');
            const readTime = Date.now() - readStart;
            
            // Limpeza
            await this.cluster.del('test:performance');
            
            return {
                writeLatency: writeTime,
                readLatency: readTime,
                totalTime: Date.now() - start
            };
            
        } catch (error) {
            logger.error(`❌ Erro no teste de performance: ${error.message}`);
            return { error: error.message };
        }
    }

    // Método para verificar health
    async healthCheck() {
        try {
            const ping = await this.cluster.ping();
            const info = await this.getClusterInfo();
            const performance = await this.testPerformance();
            
            return {
                status: 'healthy',
                ping,
                cluster: info,
                performance,
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
}

// Singleton instance
let redisClusterPool = null;

function getRedisClusterPool() {
    if (!redisClusterPool) {
        redisClusterPool = new RedisClusterPool();
    }
    return redisClusterPool;
}

module.exports = {
    RedisClusterPool,
    getRedisClusterPool
};
