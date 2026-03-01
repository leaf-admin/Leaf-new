import { Platform } from 'react-native';

// Flags de migração
export const MIGRATION_FLAGS = {
    USE_REDIS_LOCATION: Platform.OS === 'web', // Apenas web usa Redis
    USE_REDIS_TRACKING: Platform.OS === 'web'
};

// Configurações do Redis
export const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0,
};

// Função para inicializar Redis (apenas no web)
export const initializeRedis = async () => {
    if (Platform.OS === 'web') {
        try {
            // No web, usar API em vez de acesso direto
            console.log('🌐 Redis inicializado via API (web)');
            return true;
        } catch (error) {
            console.error('❌ Erro ao inicializar Redis:', error);
            return false;
        }
    } else {
        console.log('📱 React Native detectado - Redis não disponível');
        return false;
    }
};

// Função para obter cliente Redis (apenas no web)
export const getRedisClient = async () => {
    if (Platform.OS === 'web') {
        try {
            // Retornar configuração da API em vez de cliente direto
            return {
                type: 'api',
                isAvailable: true
            };
        } catch (error) {
            console.error('❌ Erro ao obter cliente Redis:', error);
            return null;
        }
    } else {
        console.log('📱 Redis não disponível no React Native');
        return null;
    }
};

// Função para verificar se Redis está disponível
export const isRedisAvailable = () => {
    return Platform.OS === 'web' && MIGRATION_FLAGS.USE_REDIS_LOCATION;
};

// Função para verificar se deve usar Redis
export const shouldUseRedis = () => {
    return Platform.OS === 'web' && MIGRATION_FLAGS.USE_REDIS_LOCATION;
};

// Configuração para uso via API
export const REDIS_API_CONFIG = {
    baseUrl: 'http://localhost:3001/leaf-app-91dfdce0/us-central1',
    useRedis: Platform.OS === 'web',
    timeout: 5000,
};

// Função para obter configuração de fallback
export const getFallbackConfig = () => {
    return {
        useFirebase: Platform.OS !== 'web',
        useRedis: Platform.OS === 'web',
        platform: Platform.OS
    };
}; 