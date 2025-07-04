import { Platform } from 'react-native';

// Flags de migração
export const MIGRATION_FLAGS = {
    USE_REDIS_LOCATION: Platform.OS === 'web', // Apenas web usa Redis
    USE_GEO_COMMANDS: Platform.OS === 'web',
    USE_REDIS_TRACKING: Platform.OS === 'web'
};

// Configurações do Redis
export const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
};

// Função para inicializar Redis (apenas no web)
export const initializeRedis = async () => {
    if (Platform.OS !== 'web') {
        console.log('📱 React Native detectado - Redis não disponível');
        return null;
    }

    try {
        // Implementação web seria aqui
        console.log('🌐 Redis inicializado (web)');
        return true;
    } catch (error) {
        console.error('❌ Erro ao inicializar Redis:', error);
        return null;
    }
};

// Função para obter cliente Redis (apenas no web)
export const getRedisClient = async () => {
    if (Platform.OS !== 'web') {
        console.log('📱 Redis não disponível no React Native');
        return null;
    }

    try {
        // Implementação web seria aqui
        return null;
    } catch (error) {
        console.error('❌ Erro ao obter cliente Redis:', error);
        return null;
    }
};

// Função para verificar se Redis está disponível
export const isRedisAvailable = () => {
    return Platform.OS === 'web';
};

// Função para verificar se deve usar Redis
export const shouldUseRedis = () => {
    return Platform.OS === 'web' && MIGRATION_FLAGS.USE_REDIS_LOCATION;
};

// Função para obter configuração de fallback
export const getFallbackConfig = () => {
    return {
        useFirebase: Platform.OS !== 'web',
        useRedis: Platform.OS === 'web',
        platform: Platform.OS
    };
}; 