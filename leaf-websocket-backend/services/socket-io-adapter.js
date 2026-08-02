/**
 * Socket.IO Redis Adapter
 * 
 * Configura o Redis Adapter para Socket.IO, permitindo que múltiplos
 * servidores compartilhem conexões e eventos via Redis Pub/Sub.
 * 
 * Isso é ESSENCIAL para escalabilidade horizontal.
 */

const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const { logger } = require('../utils/logger');
const DockerDetector = require('../utils/docker-detector');

class SocketIORedisAdapter {
    constructor(redisUrl) {
        this.redisMode = DockerDetector.getRedisMode();
        this.redisConfig = this.redisMode === 'sentinel'
            ? DockerDetector.getRedisConfig()
            : null;
        this.redisUrl = this.redisMode === 'sentinel'
            ? null
            : (redisUrl || DockerDetector.getRedisUrl());
        this.pubClient = null;
        this.subClient = null;
        this.isInitialized = false;
        
        // Log do ambiente detectado
        DockerDetector.logEnvironment();
    }

    /**
     * Inicializar adapter
     * @param {Server} io - Instância do Socket.IO
     * @returns {Promise<void>}
     */
    async initialize(io) {
        if (this.isInitialized) {
            logger.warn('⚠️ [SocketIOAdapter] Já está inicializado');
            return;
        }

        try {
            logger.info('🚀 [SocketIOAdapter] Inicializando Redis Adapter...');

            // Criar clientes Redis
            this.pubClient = this.redisConfig
                ? new Redis({ ...this.redisConfig, lazyConnect: true })
                : new Redis(this.redisUrl, { lazyConnect: true });
            this.subClient = this.pubClient.duplicate();

            // Configurar event handlers
            this.setupEventHandlers();

            // Conectar clientes
            await Promise.all([
                this.pubClient.connect(),
                this.subClient.connect()
            ]);

            // Configurar adapter no Socket.IO
            io.adapter(createAdapter(this.pubClient, this.subClient));

            this.isInitialized = true;
            logger.info('✅ [SocketIOAdapter] Redis Adapter configurado com sucesso');
            const target = this.redisConfig
                ? DockerDetector.describeRedisConfig(this.redisConfig)
                : DockerDetector.describeRedisConfig(DockerDetector.getRedisConfig());
            logger.info(`   Pub/Sub target: ${target}`);

        } catch (error) {
            logger.error('❌ [SocketIOAdapter] Erro ao inicializar:', error);
            throw error;
        }
    }

    /**
     * Configurar event handlers dos clientes Redis
     */
    setupEventHandlers() {
        // Pub Client
        this.pubClient.on('error', (error) => {
            logger.error('❌ [SocketIOAdapter] Pub Client error:', error.message);
        });

        this.pubClient.on('connect', () => {
            logger.info('✅ [SocketIOAdapter] Pub Client conectado');
        });

        this.pubClient.on('ready', () => {
            logger.info('✅ [SocketIOAdapter] Pub Client pronto');
        });

        // Sub Client
        this.subClient.on('error', (error) => {
            logger.error('❌ [SocketIOAdapter] Sub Client error:', error.message);
        });

        this.subClient.on('connect', () => {
            logger.info('✅ [SocketIOAdapter] Sub Client conectado');
        });

        this.subClient.on('ready', () => {
            logger.info('✅ [SocketIOAdapter] Sub Client pronto');
        });
    }

    /**
     * Desconectar adapter
     * @returns {Promise<void>}
     */
    async disconnect() {
        try {
            if (this.pubClient) {
                await this.pubClient.quit();
            }
            if (this.subClient) {
                await this.subClient.quit();
            }
            this.isInitialized = false;
            logger.info('✅ [SocketIOAdapter] Desconectado');
        } catch (error) {
            logger.error('❌ [SocketIOAdapter] Erro ao desconectar:', error);
        }
    }

    /**
     * Health check do adapter
     * @returns {Promise<Object>}
     */
    async healthCheck() {
        try {
            const start = Date.now();
            
            // Testar pub client
            await this.pubClient.ping();
            const pubLatency = Date.now() - start;
            
            // Testar sub client
            const subStart = Date.now();
            await this.subClient.ping();
            const subLatency = Date.now() - subStart;
            
            return {
                status: 'healthy',
                pubClient: {
                    connected: this.pubClient.status === 'ready',
                    latency: pubLatency
                },
                subClient: {
                    connected: this.subClient.status === 'ready',
                    latency: subLatency
                },
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

module.exports = SocketIORedisAdapter;
