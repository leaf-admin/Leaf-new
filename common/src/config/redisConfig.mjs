// Redis Configuration and Feature Flags for LEAF ReactNative Project

export const REDIS_CONFIG = {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                console.error('Redis connection failed after 10 retries');
                return false;
            }
            return Math.min(retries * 100, 3000);
        }
    },
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
};

// Feature Flags for gradual migration
export const FEATURE_FLAGS = {
    // Location services
    USE_REDIS_LOCATION: true,
    USE_REDIS_TRACKING: true,
    USE_REDIS_DRIVER_STATUS: process.env.USE_REDIS_DRIVER_STATUS === 'true' || false,
    
    // Real-time features
    USE_REDIS_PUBSUB: process.env.USE_REDIS_PUBSUB === 'true' || false,
    USE_REDIS_STREAMS: process.env.USE_REDIS_STREAMS === 'true' || false,
    
    // Performance features
    USE_REDIS_CACHE: process.env.USE_REDIS_CACHE === 'true' || false,
    USE_REDIS_SESSION: process.env.USE_REDIS_SESSION === 'true' || false,
    
    // Fallback settings
    FALLBACK_TO_FIREBASE: true,
    LOG_REDIS_OPERATIONS: process.env.LOG_REDIS_OPERATIONS === 'true' || false,
    
    // TTL settings (in seconds)
    LOCATION_TTL: 1800, // 30 minutes
    TRACKING_TTL: 86400, // 24 hours
    
    // Stream settings
    MAX_TRACKING_POINTS: 100,
    
    // Cleanup settings
    CLEANUP_INTERVAL: 60
};

// Redis key patterns
export const REDIS_KEYS = {
    // Location keys
    USER_LOCATION: (uid) => `locations:${uid}`,
    ONLINE_USERS: 'users:online',
    OFFLINE_USERS: 'users:offline',
    
    // Tracking keys
    TRACKING_STREAM: (bookingId) => `tracking:${bookingId}`,
    TRACKING_LAST: (bookingId) => `tracking:last:${bookingId}`,
    
    // Driver status keys
    DRIVER_STATUS: (uid) => `driver:status:${uid}`,
    DRIVERS_NEARBY: (lat, lng) => `drivers:nearby:${lat}:${lng}`,
    
    // Session keys
    USER_SESSION: (uid) => `session:${uid}`,
    DEVICE_TOKEN: (uid) => `device:${uid}`,
    
    // Cache keys
    BOOKING_CACHE: (bookingId) => `cache:booking:${bookingId}`,
    USER_CACHE: (uid) => `cache:user:${uid}`,
    SETTINGS_CACHE: 'cache:settings',
    
    // Pub/Sub channels
    LOCATION_CHANNEL: (uid) => `location:${uid}`,
    TRACKING_CHANNEL: (bookingId) => `tracking:${bookingId}`,
    DRIVER_CHANNEL: (uid) => `driver:${uid}`,
    BOOKING_CHANNEL: (bookingId) => `booking:${bookingId}`
};

// Redis operations configuration
export const REDIS_OPERATIONS = {
    // Batch operations
    BATCH_SIZE: 100,
    PIPELINE_SIZE: 50,
    
    // Timeout settings
    OPERATION_TIMEOUT: 5000,      // 5 seconds
    CONNECTION_TIMEOUT: 10000,    // 10 seconds
    
    // Retry settings
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    
    // Monitoring
    ENABLE_METRICS: true,
    METRICS_INTERVAL: 60000       // 1 minute
};

// Migration settings
export const MIGRATION_CONFIG = {
    // Dual write settings
    DUAL_WRITE_ENABLED: true,
    DUAL_WRITE_TIMEOUT: 2000,     // 2 seconds
    
    // Validation settings
    VALIDATE_DATA: true,
    COMPARE_RESULTS: true,
    
    // Rollback settings
    AUTO_ROLLBACK: true,
    ROLLBACK_THRESHOLD: 0.1,      // 10% error rate
    
    // Monitoring
    LOG_MIGRATION: true,
    MIGRATION_STATS: true
};

// Configurações de performance
export const PERFORMANCE_CONFIG = {
    // Pool de conexões
    connectionPool: {
        min: 2,
        max: 10
    },
    
    // Timeout de operações
    timeouts: {
        connect: 5000,
        operation: 3000,
        command: 1000
    },
    
    // Configurações de cache
    cache: {
        enabled: FEATURE_FLAGS.USE_REDIS_CACHE,
        ttl: 300, // 5 minutos
        maxSize: 1000
    }
};

// Configurações de monitoramento
export const MONITORING_CONFIG = {
    // Métricas básicas
    metrics: {
        enabled: true,
        interval: 60000, // 1 minuto
        retention: 24 * 60 * 60 * 1000 // 24 horas
    },
    
    // Alertas
    alerts: {
        connectionFailures: 5,
        operationFailures: 10,
        responseTimeThreshold: 1000 // ms
    },
    
    // Logs
    logging: {
        level: FEATURE_FLAGS.LOG_REDIS_OPERATIONS ? 'debug' : 'info',
        format: 'json',
        includeTimestamp: true
    }
};

// Configurações de segurança
export const SECURITY_CONFIG = {
    // Autenticação
    auth: {
        enabled: false,
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD
    },
    
    // TLS/SSL
    tls: {
        enabled: false,
        ca: process.env.REDIS_CA_CERT,
        cert: process.env.REDIS_CLIENT_CERT,
        key: process.env.REDIS_CLIENT_KEY
    },
    
    // Rate limiting
    rateLimit: {
        enabled: true,
        maxRequests: 1000,
        windowMs: 60000 // 1 minuto
    }
};

// Função para validar configuração
export const validateConfig = () => {
    const errors = [];
    
    // Validar URL do Redis
    if (!REDIS_CONFIG.url) {
        errors.push('REDIS_URL is required');
    }
    
    // Validar feature flags
    if (typeof FEATURE_FLAGS.USE_REDIS_LOCATION !== 'boolean') {
        errors.push('USE_REDIS_LOCATION must be a boolean');
    }
    
    if (typeof FEATURE_FLAGS.USE_REDIS_TRACKING !== 'boolean') {
        errors.push('USE_REDIS_TRACKING must be a boolean');
    }
    
    if (typeof FEATURE_FLAGS.FALLBACK_TO_FIREBASE !== 'boolean') {
        errors.push('FALLBACK_TO_FIREBASE must be a boolean');
    }
    
    // Validar TTLs
    if (FEATURE_FLAGS.LOCATION_TTL <= 0) {
        errors.push('LOCATION_TTL must be positive');
    }
    
    if (FEATURE_FLAGS.TRACKING_TTL <= 0) {
        errors.push('TRACKING_TTL must be positive');
    }
    
    if (errors.length > 0) {
        throw new Error(`Redis configuration validation failed: ${errors.join(', ')}`);
    }
    
    return true;
};

// Função para obter configuração baseada no ambiente
export const getConfigForEnvironment = (environment = 'development') => {
    const baseConfig = {
        ...REDIS_CONFIG,
        ...PERFORMANCE_CONFIG,
        ...MONITORING_CONFIG,
        ...SECURITY_CONFIG
    };
    
    switch (environment) {
        case 'production':
            return {
                ...baseConfig,
                socket: {
                    ...baseConfig.socket,
                    reconnectStrategy: (retries) => {
                        if (retries > 20) return false;
                        return Math.min(retries * 200, 5000);
                    }
                },
                timeouts: {
                    connect: 10000,
                    operation: 5000,
                    command: 2000
                }
            };
            
        case 'staging':
            return {
                ...baseConfig,
                timeouts: {
                    connect: 8000,
                    operation: 4000,
                    command: 1500
                }
            };
            
        case 'development':
        default:
            return baseConfig;
    }
};

// Função para habilitar/desabilitar features
export const updateFeatureFlags = (updates) => {
    Object.assign(FEATURE_FLAGS, updates);
    console.log('Feature flags updated:', FEATURE_FLAGS);
};

// Função para verificar se Redis está habilitado
export const isRedisEnabled = () => {
    return FEATURE_FLAGS.USE_REDIS_LOCATION || FEATURE_FLAGS.USE_REDIS_TRACKING;
};

// Função para obter status da migração
export const getMigrationStatus = () => {
    return {
        redisEnabled: isRedisEnabled(),
        locationEnabled: FEATURE_FLAGS.USE_REDIS_LOCATION,
        trackingEnabled: FEATURE_FLAGS.USE_REDIS_TRACKING,
        fallbackEnabled: FEATURE_FLAGS.FALLBACK_TO_FIREBASE,
        debugEnabled: FEATURE_FLAGS.LOG_REDIS_OPERATIONS,
        metricsEnabled: true
    };
};

// Exportar configuração padrão
export default {
    REDIS_CONFIG,
    FEATURE_FLAGS,
    PERFORMANCE_CONFIG,
    MONITORING_CONFIG,
    SECURITY_CONFIG,
    validateConfig,
    getConfigForEnvironment,
    updateFeatureFlags,
    isRedisEnabled,
    getMigrationStatus
};

// Helper function to get Redis key
export const getRedisKey = (pattern, ...params) => {
    if (typeof REDIS_KEYS[pattern] === 'function') {
        return REDIS_KEYS[pattern](...params);
    }
    return REDIS_KEYS[pattern];
};

// Helper function to get TTL value
export const getTTL = (type) => {
    return FEATURE_FLAGS[type] || FEATURE_FLAGS.LOCATION_TTL;
}; 