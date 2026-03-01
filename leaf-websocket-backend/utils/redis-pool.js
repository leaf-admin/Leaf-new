const Redis = require('ioredis');
const { getTracer } = require('./tracer');
const { SpanStatusCode } = require('@opentelemetry/api');
const { logger, logRedis } = require('./logger');
const DockerDetector = require('./docker-detector');
const traceContext = require('./trace-context');
const { metrics } = require('./prometheus-metrics');

class RedisPool {
    constructor() {
        this.pool = null;
        this.initializePool();
    }

    initializePool() {
        try {
            // ✅ CORREÇÃO: Carregar dotenv se disponível (para carregar .env)
            try {
                require('dotenv').config();
            } catch (e) {
                // dotenv não disponível, continuar sem ele
            }
            
            // ✅ NOVO: Usar DockerDetector para obter configuração correta
            const redisConfig = DockerDetector.getRedisConfig();
            
            // Log do ambiente detectado
            DockerDetector.logEnvironment();

            logger.info(`🔧 Configurando Redis: ${redisConfig.host}:${redisConfig.port} ${redisConfig.password ? '(com senha)' : '(sem senha)'}`);

            // Configuração otimizada para connection pooling
            this.pool = new Redis({
                ...redisConfig,
                
                // Connection pooling configuration
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                maxLoadingTimeout: 10000,
                
                // Performance optimizations
                // ✅ CORREÇÃO: Conectar automaticamente na inicialização (não lazy)
                lazyConnect: false, // Conectar imediatamente
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
                showFriendlyErrorStack: true,
                
                // Retry strategy - tentar reconectar mais vezes
                retryStrategy: (times) => {
                    if (times > 10) {
                        logger.warn(`⚠️ Redis: Máximo de tentativas atingido (${times})`);
                        return null; // Para de tentar
                    }
                    const delay = Math.min(times * 200, 2000); // Backoff exponencial
                    logger.info(`🔄 Redis: Tentativa ${times}, aguardando ${delay}ms...`);
                    return delay;
                }
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
            logRedis('info', 'Redis Pool conectado', {
                operation: 'connect'
            });
        });

        this.pool.on('ready', () => {
            logRedis('info', 'Redis Pool pronto para operações', {
                operation: 'ready'
            });
        });

        this.pool.on('error', (error) => {
            logRedis('error', 'Erro no Redis Pool', {
                operation: 'error',
                error: error.message,
                errorCode: error.code,
                stack: error.stack
            });
            // ✅ CORREÇÃO: Tentar reconectar em caso de erro
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                logRedis('warn', 'Redis não está acessível', {
                    operation: 'connection_check',
                    errorCode: error.code
                });
            }
        });

        this.pool.on('close', () => {
            logRedis('warn', 'Redis Pool fechado, tentando reconectar', {
                operation: 'close'
            });
        });

        this.pool.on('reconnecting', (delay) => {
            logger.info(`🔄 Reconectando Redis Pool... (delay: ${delay}ms)`);
        });

        // ✅ NOVO: Evento quando a conexão falha
        this.pool.on('end', () => {
            logger.warn('⚠️ Redis Pool desconectado');
        });
    }

    // ✅ OBSERVABILIDADE: Wrapper para adicionar spans e métricas nas operações Redis
    _wrapRedisOperation(operation, originalMethod) {
        return async (...args) => {
            const startTime = Date.now();
            const tracer = getTracer();
            const { trace } = require('@opentelemetry/api');
            const activeSpan = trace.getActiveSpan();
            
            // Criar span para operação Redis
            const span = tracer.startSpan(`redis.${operation}`, {
                parent: activeSpan,
                attributes: {
                    'redis.operation': operation,
                    'redis.key': args[0] || 'unknown',
                    'db.system': 'redis'
                }
            });
            
            try {
                // Executar operação original
                const result = await originalMethod.apply(this.pool, args);
                
                // Registrar sucesso
                const duration = (Date.now() - startTime) / 1000;
                span.setStatus({ code: SpanStatusCode.OK });
                span.setAttribute('redis.duration_ms', duration * 1000);
                metrics.recordRedis(operation, duration, true);
                
                return result;
            } catch (error) {
                // Registrar erro
                const duration = (Date.now() - startTime) / 1000;
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.setAttribute('redis.duration_ms', duration * 1000);
                span.setAttribute('redis.error', error.message);
                metrics.recordRedis(operation, duration, false);
                
                throw error;
            } finally {
                span.end();
            }
        };
    }

    // Método para obter conexão do pool (instrumentada)
    getConnection() {
        // ✅ CORREÇÃO: Verificar se a conexão está ativa e tentar reconectar se necessário
        if (this.pool && (this.pool.status === 'end' || this.pool.status === 'close')) {
            logger.warn('⚠️ Redis desconectado, tentando reconectar...');
            this.pool.connect().catch(err => {
                logger.error(`❌ Erro ao reconectar Redis: ${err.message}`);
            });
        }
        
        // ✅ OBSERVABILIDADE: Retornar conexão instrumentada se ainda não foi instrumentada
        if (!this.pool._instrumented) {
            // Operações básicas
            const originalHget = this.pool.hget.bind(this.pool);
            const originalHgetall = this.pool.hgetall.bind(this.pool);
            const originalHset = this.pool.hset.bind(this.pool);
            const originalGet = this.pool.get.bind(this.pool);
            const originalSet = this.pool.set.bind(this.pool);
            const originalDel = this.pool.del.bind(this.pool);
            const originalGeoadd = this.pool.geoadd.bind(this.pool);
            const originalGeoradius = this.pool.georadius.bind(this.pool);
            const originalZadd = this.pool.zadd.bind(this.pool);
            const originalZrem = this.pool.zrem.bind(this.pool);
            const originalExpire = this.pool.expire.bind(this.pool);
            const originalXadd = this.pool.xadd.bind(this.pool);
            
            // Aplicar wrappers
            this.pool.hget = this._wrapRedisOperation('hget', originalHget);
            this.pool.hgetall = this._wrapRedisOperation('hgetall', originalHgetall);
            this.pool.hset = this._wrapRedisOperation('hset', originalHset);
            this.pool.get = this._wrapRedisOperation('get', originalGet);
            this.pool.set = this._wrapRedisOperation('set', originalSet);
            this.pool.del = this._wrapRedisOperation('del', originalDel);
            this.pool.geoadd = this._wrapRedisOperation('geoadd', originalGeoadd);
            this.pool.georadius = this._wrapRedisOperation('georadius', originalGeoradius);
            this.pool.zadd = this._wrapRedisOperation('zadd', originalZadd);
            this.pool.zrem = this._wrapRedisOperation('zrem', originalZrem);
            this.pool.expire = this._wrapRedisOperation('expire', originalExpire);
            this.pool.xadd = this._wrapRedisOperation('xadd', originalXadd);
            
            this.pool._instrumented = true;
        }
        
        return this.pool;
    }
    
    // ✅ NOVO: Método para garantir conexão antes de usar
    async ensureConnection() {
        try {
            if (!this.pool) {
                throw new Error('Redis pool não inicializado');
            }
            
            if (this.pool.status === 'ready') {
                return true;
            }
            
            if (this.pool.status === 'end' || this.pool.status === 'close') {
                logger.info('🔄 Reconectando Redis...');
                await this.pool.connect();
                return true;
            }
            
            // Se está conectando, aguardar
            if (this.pool.status === 'connecting' || this.pool.status === 'connect') {
                return new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout aguardando conexão Redis'));
                    }, 10000);
                    
                    this.pool.once('ready', () => {
                        clearTimeout(timeout);
                        resolve(true);
                    });
                    
                    this.pool.once('error', (err) => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                });
            }
            
            return false;
        } catch (error) {
            logger.error(`❌ Erro ao garantir conexão Redis: ${error.message}`);
            throw error;
        }
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
