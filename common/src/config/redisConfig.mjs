// Redis Configuration and Feature Flags for LEAF ReactNative Project

export const REDIS_CONFIG = {
    // Redis connection settings
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    retryAttempts: 10,
    retryDelay: 100,
    maxRetryDelay: 3000,
    
    // TTL settings (in seconds)
    ttl: {
        userLocation: 300,        // 5 minutes
        trackingLastPoint: 3600,  // 1 hour
        driverStatus: 600,        // 10 minutes
        onlineUsers: 300,         // 5 minutes
        tempData: 60              // 1 minute
    },
    
    // Stream settings
    streams: {
        maxTrackingPoints: 100,   // Max points per tracking stream
        maxHistoryPoints: 1000    // Max points for distance calculation
    },
    
    // Cleanup settings
    cleanup: {
        locationMaxAge: 600,      // 10 minutes
        trackingMaxAge: 86400,    // 24 hours
        interval: 300000          // 5 minutes
    }
};

// Feature flags for gradual migration
export const FEATURE_FLAGS = {
    // Location services
    USE_REDIS_LOCATION: process.env.USE_REDIS_LOCATION === 'true' || false,
    USE_REDIS_TRACKING: process.env.USE_REDIS_TRACKING === 'true' || false,
    USE_REDIS_DRIVER_STATUS: process.env.USE_REDIS_DRIVER_STATUS === 'true' || false,
    
    // Real-time features
    USE_REDIS_PUBSUB: process.env.USE_REDIS_PUBSUB === 'true' || false,
    USE_REDIS_STREAMS: process.env.USE_REDIS_STREAMS === 'true' || false,
    
    // Performance features
    USE_REDIS_CACHE: process.env.USE_REDIS_CACHE === 'true' || false,
    USE_REDIS_SESSION: process.env.USE_REDIS_SESSION === 'true' || false,
    
    // Fallback settings
    FALLBACK_TO_FIREBASE: process.env.FALLBACK_TO_FIREBASE === 'true' || true,
    LOG_REDIS_OPERATIONS: process.env.LOG_REDIS_OPERATIONS === 'true' || false
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

// Environment-specific settings
export const getRedisConfig = () => {
    const env = process.env.NODE_ENV || 'development';
    
    switch (env) {
        case 'production':
            return {
                ...REDIS_CONFIG,
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                ttl: {
                    ...REDIS_CONFIG.ttl,
                    userLocation: 600,        // 10 minutes in production
                    trackingLastPoint: 7200   // 2 hours in production
                }
            };
            
        case 'staging':
            return {
                ...REDIS_CONFIG,
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                ttl: {
                    ...REDIS_CONFIG.ttl,
                    userLocation: 300,        // 5 minutes in staging
                    trackingLastPoint: 3600   // 1 hour in staging
                }
            };
            
        default: // development
            return {
                ...REDIS_CONFIG,
                url: 'redis://localhost:6379',
                LOG_REDIS_OPERATIONS: true,
                FALLBACK_TO_FIREBASE: true
            };
    }
};

// Helper function to check if Redis feature is enabled
export const isRedisFeatureEnabled = (feature) => {
    return FEATURE_FLAGS[feature] === true;
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
    return REDIS_CONFIG.ttl[type] || REDIS_CONFIG.ttl.tempData;
}; 