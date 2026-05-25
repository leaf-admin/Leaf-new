const {
    resolveSocketIoRedisAdapterConfig,
    setSocketIoRedisAdapterStatus
} = require('../services/socket-io-redis-adapter-status');

function createSocketServer({ server, socketIo, corsOptions, app, logStructured }) {
    const redisAdapterConfig = resolveSocketIoRedisAdapterConfig({ enabledDefault: false });
    const enableRedisAdapter = redisAdapterConfig.enabled;
    const updateRedisAdapterStatus = (state, metadata = {}) => setSocketIoRedisAdapterStatus(
        state,
        metadata,
        { enabledDefault: false }
    );
    // Configurações de Socket.IO alinhadas com a política CORS central do server.js
    const socketConnectTimeoutMs = Number.parseInt(process.env.SOCKET_CONNECT_TIMEOUT_MS || '60000', 10);
    const socketPingTimeoutMs = Number.parseInt(process.env.SOCKET_PING_TIMEOUT_MS || '45000', 10);
    const socketPingIntervalMs = Number.parseInt(process.env.SOCKET_PING_INTERVAL_MS || '20000', 10);
    const socketAllowPolling = process.env.SOCKET_ALLOW_POLLING
        ? process.env.SOCKET_ALLOW_POLLING === 'true'
        : process.env.NODE_ENV !== 'production';

    const io = socketIo(server, {
        // ✅ Expor io globalmente para health checks e workers
        // global.io será definido logo abaixo
        transports: socketAllowPolling ? ['websocket', 'polling'] : ['websocket'],
        pingTimeout: Number.isFinite(socketPingTimeoutMs) ? socketPingTimeoutMs : 45000,
        pingInterval: Number.isFinite(socketPingIntervalMs) ? socketPingIntervalMs : 20000,
        allowEIO3: true,
        allowEIO4: true, // ✅ Permitir Engine.IO v4
        connectTimeout: Number.isFinite(socketConnectTimeoutMs) ? socketConnectTimeoutMs : 60000,
        maxHttpBufferSize: 1e6, // 1MB limit para VPS
        cors: process.env.NODE_ENV === 'test' ? { origin: true } : corsOptions,
        // Configurações otimizadas para VPS
        compression: false, // Desabilitar compressão para reduzir overhead
        serveClient: false, // Desabilitar cliente para economizar recursos
        allowUpgrades: true,
        perMessageDeflate: false // Desabilitar compressão per-message
    });

    // ✅ DEBUG: Log de conexões e erros
    io.engine.on('connection_error', (err) => {
        logStructured('error', 'Socket.IO Engine - Erro de conexão', {
            service: 'websocket',
            error: err.message,
            reqUrl: err.req?.url,
            code: err.code,
            context: err.context,
            origin: err.req?.headers?.origin || 'null (React Native)',
            userAgent: err.req?.headers['user-agent'] || 'N/A',
            method: err.req?.method
        });
    });

    // ✅ DEBUG: Log de requisições de polling (apenas em desenvolvimento)
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
        io.engine.on('request', (req) => {
            if (req.url?.includes('socket.io') && req.url?.includes('polling')) {
                logStructured('debug', 'Socket.IO - Requisição polling', {
                    service: 'websocket',
                    method: req.method,
                    url: req.url,
                    origin: req.headers.origin || 'null (React Native)',
                    userAgent: req.headers['user-agent'] || 'N/A'
                });
            }
        });
    }

    io.engine.on('upgrade_error', (err) => {
        logStructured('error', 'Socket.IO Engine - Erro de upgrade', {
            service: 'websocket',
            error: err.message
        });
    });

    // ✅ Disponibilizar io para as rotas (após criação do io)
    app.set('io', io);

    // ✅ Expor io globalmente para health checks e workers
    global.io = io;

    updateRedisAdapterStatus(enableRedisAdapter ? 'pending' : 'disabled');

    if (enableRedisAdapter) {
        const SocketIORedisAdapter = require('../services/socket-io-adapter');
        const adapter = new SocketIORedisAdapter(process.env.REDIS_URL);
        updateRedisAdapterStatus('initializing');
        adapter.initialize(io).then(() => {
            app.locals.socketIoRedisAdapter = adapter;
            global.socketIoRedisAdapter = adapter;
            updateRedisAdapterStatus('ready');
            logStructured('info', 'Socket.IO Redis Adapter ativo no processo realtime', {
                service: 'websocket',
                runtimeRole: redisAdapterConfig.runtimeRole
            });
        }).catch((error) => {
            updateRedisAdapterStatus('failed', { error: error.message });
            logStructured(redisAdapterConfig.required ? 'error' : 'warn', 'Falha ao ativar Socket.IO Redis Adapter no processo realtime', {
                service: 'websocket',
                runtimeRole: redisAdapterConfig.runtimeRole,
                error: error.message
            });
        });
    } else {
        logStructured('info', 'Socket.IO Redis Adapter desabilitado por configuração', {
            service: 'websocket',
            runtimeRole: redisAdapterConfig.runtimeRole
        });
    }

    return io;
}

module.exports = createSocketServer;
