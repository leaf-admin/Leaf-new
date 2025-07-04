const redis = require('redis');

// Configuração do Redis
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0,
    retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            console.error('Redis server refused connection');
            return new Error('Redis server refused connection');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            console.error('Redis retry time exhausted');
            return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
            console.error('Redis max retry attempts reached');
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
};

// Feature flags para estratégia híbrida otimizada
const MIGRATION_FLAGS = {
    ENABLE_REDIS: process.env.ENABLE_REDIS === 'true' || false,
    REDIS_PRIMARY: process.env.REDIS_PRIMARY === 'true' || true, // Redis como fonte primária
    FIREBASE_FALLBACK: process.env.FIREBASE_FALLBACK === 'true' || true, // Fallback para Firebase RT
    FIRESTORE_PERSISTENCE: process.env.FIRESTORE_PERSISTENCE === 'true' || true, // Persistência no Firestore
    DUAL_WRITE: process.env.DUAL_WRITE === 'true' || false, // Não duplicar mais
    AUTO_MIGRATE: process.env.AUTO_MIGRATE === 'true' || true, // Migrar para Firestore automaticamente
    USE_GEO_COMMANDS: process.env.USE_GEO_COMMANDS === 'true' || true
};

// Cliente Redis singleton
let redisClient = null;
let isConnected = false;

// Função para criar cliente Redis
const createRedisClient = async () => {
    if (redisClient && isConnected) {
        return redisClient;
    }

    try {
        redisClient = redis.createClient(REDIS_CONFIG);
        
        redisClient.on('connect', () => {
            console.log('✅ Redis conectado com sucesso');
            isConnected = true;
        });

        redisClient.on('error', (err) => {
            console.error('❌ Erro na conexão Redis:', err);
            isConnected = false;
        });

        redisClient.on('end', () => {
            console.log('🔌 Conexão Redis encerrada');
            isConnected = false;
        });

        redisClient.on('reconnecting', () => {
            console.log('🔄 Reconectando ao Redis...');
        });

        // Conectar ao Redis
        await redisClient.connect();
        
        return redisClient;
    } catch (error) {
        console.error('❌ Erro ao criar cliente Redis:', error);
        return null;
    }
};

// Função para testar comandos GEO
const testGeoCommands = async () => {
    const client = await createRedisClient();
    if (!client) return false;

    try {
        // Teste básico de GEOADD
        const result = await client.geoAdd('test-geo', {
            longitude: -43.1729,
            latitude: -22.9068,
            member: 'Rio de Janeiro'
        });
        
        // Limpar teste
        await client.del('test-geo');
        
        console.log('✅ Comandos GEO funcionando corretamente');
        return true;
    } catch (error) {
        console.log('⚠️ Comandos GEO não disponíveis:', error.message);
        return false;
    }
};

// Função para inicializar Redis
const initializeRedis = async () => {
    if (!MIGRATION_FLAGS.ENABLE_REDIS) {
        console.log('🚫 Redis desabilitado por configuração');
        return false;
    }

    const client = await createRedisClient();
    if (!client) {
        console.log('❌ Não foi possível criar cliente Redis');
        return false;
    }

    try {
        // Testar conexão
        await client.ping();
        console.log('✅ Redis inicializado com sucesso');
        
        // Testar comandos GEO
        const geoSupported = await testGeoCommands();
        MIGRATION_FLAGS.USE_GEO_COMMANDS = geoSupported;
        
        return true;
    } catch (error) {
        console.error('❌ Erro ao inicializar Redis:', error);
        return false;
    }
};

// Função para obter cliente Redis
const getRedisClient = async () => {
    if (!MIGRATION_FLAGS.ENABLE_REDIS) {
        return null;
    }
    return await createRedisClient();
};

// Função para verificar se Redis está disponível
const isRedisAvailable = () => {
    return MIGRATION_FLAGS.ENABLE_REDIS && isConnected;
};

// Função para fechar conexão
const closeRedisConnection = async () => {
    if (redisClient) {
        try {
            await redisClient.quit();
            console.log('🔌 Conexão Redis fechada');
        } catch (error) {
            console.error('❌ Erro ao fechar conexão Redis:', error);
        }
    }
};

module.exports = {
    REDIS_CONFIG,
    MIGRATION_FLAGS,
    createRedisClient,
    getRedisClient,
    initializeRedis,
    isRedisAvailable,
    closeRedisConnection,
    testGeoCommands
}; 