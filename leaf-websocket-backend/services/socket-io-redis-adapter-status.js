function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function resolveSocketIoRedisAdapterConfig(options = {}) {
    const env = options.env || process.env;
    const runtimeRole = String(env.RUNTIME_ROLE || 'gateway').trim().toLowerCase();
    const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
    const enabledDefault = Boolean(options.enabledDefault);
    const requiredDefault = nodeEnv === 'production' && runtimeRole === 'gateway';

    return {
        enabled: parseBoolean(env.ENABLE_SOCKETIO_REDIS_ADAPTER, enabledDefault),
        required: parseBoolean(env.REQUIRE_SOCKETIO_REDIS_ADAPTER, requiredDefault),
        runtimeRole
    };
}

function setSocketIoRedisAdapterStatus(state, metadata = {}, options = {}) {
    const config = resolveSocketIoRedisAdapterConfig(options);
    const status = {
        state,
        enabled: config.enabled,
        required: config.required,
        runtimeRole: config.runtimeRole,
        updatedAt: new Date().toISOString(),
        ...metadata
    };

    global.socketIoRedisAdapterStatus = status;
    return status;
}

module.exports = {
    parseBoolean,
    resolveSocketIoRedisAdapterConfig,
    setSocketIoRedisAdapterStatus
};
