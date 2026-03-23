function configureHttpMiddleware({
    app,
    server,
    express,
    cors,
    corsOptions,
    traceIdExpressMiddleware,
    recordIngest,
    getOtelIngestStatus,
    logStructured
}) {
    // ✅ NOVO: Middleware para gerar traceId automaticamente em requisições HTTP
    app.use(traceIdExpressMiddleware);

    app.use(cors(corsOptions));

    // OTLP ingest local para evitar exporter apontando para endpoint inválido (ECONNREFUSED)
    app.post('/otel/v1/traces', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
        const bytesFromBody = Buffer.isBuffer(req.body) ? req.body.length : 0;
        const headerLength = Number.parseInt(req.headers['content-length'] || '0', 10);
        const bytes = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : bytesFromBody;
        recordIngest(bytes, 200);
        res.status(200).end();
    });

    app.get('/otel/health', (_req, res) => {
        res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            otel: getOtelIngestStatus()
        });
    });

    // ✅ PROPRIEDADE DE SEGURANÇA: Rate Limiting Global
    if (process.env.NODE_ENV !== 'test') {
        const { applyRateLimit } = require('../middleware/rateLimiter');
        app.use(applyRateLimit);
    } else {
        logStructured('info', 'Rate Limiting desabilitado no ambiente de testes', { service: 'server' });
    }

    // ✅ LOG DE DEBUG: Capturar TODAS as requisições (apenas em desenvolvimento)
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_REQUESTS === 'true') {
        app.use((req, res, next) => {
            if (req.path.includes('socket.io')) {
                logStructured('debug', 'Requisição Socket.IO', { service: 'server', method: req.method, path: req.path, origin: req.headers.origin || 'N/A' });
            }
            // ✅ Debug para rotas de drivers
            if (req.path.includes('/api/drivers')) {
                logStructured('debug', 'Requisição Drivers', { service: 'server', method: req.method, path: req.path, query: req.query });
            }
            // ✅ Debug para waitlist
            if (req.path.includes('/api/waitlist/landing')) {
                logStructured('debug', 'Requisição Waitlist', { service: 'server', method: req.method, path: req.path, origin: req.headers.origin || 'N/A' });
            }
            // ✅ Debug para rotas OCR
            if (req.path.includes('/api/ocr')) {
                logStructured('debug', 'Requisição OCR', { service: 'server', method: req.method, path: req.path, origin: req.headers.origin || 'N/A', contentType: req.headers['content-type'] || 'N/A' });
            }
            next();
        });
    }

    // ✅ CORREÇÃO: Aumentar limite e timeout para uploads de CNH
    app.use(express.json({ limit: '50mb' })); // Aumentado de 10mb para 50mb
    app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Adicionado para multipart/form-data

    // ✅ Timeout mais alto para OCR/extração via IA em PDFs grandes.
    // Mantém compatível com produção via variável de ambiente SERVER_TIMEOUT.
    const requestTimeoutMs = parseInt(process.env.SERVER_TIMEOUT, 10) || 300000; // 5 minutos
    server.timeout = requestTimeoutMs;
    server.keepAliveTimeout = requestTimeoutMs + 5000;
    server.headersTimeout = requestTimeoutMs + 10000;
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // ✅ INICIALIZAR FIREBASE ANTES DE REGISTRAR ROTAS
    const firebaseConfig = require('../firebase-config');
    try {
        firebaseConfig.initializeFirebase();
        logStructured('info', 'Firebase inicializado com sucesso', { service: 'server' });
    } catch (error) {
        logStructured('error', 'Erro ao inicializar Firebase', { service: 'server', error: error.message, stack: error.stack });
        // Não quebra o servidor, mas algumas rotas podem não funcionar
    }
}

module.exports = configureHttpMiddleware;
