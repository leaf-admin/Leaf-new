function shouldCaptureSignedWebhookRawBody(req) {
    const requestUrl = String(req.originalUrl || req.url || '');
    return requestUrl.includes('/api/woovi/webhook')
        || requestUrl.includes('/api/woovi-webhook')
        || requestUrl.includes('/api/webhooks/woovi')
        || requestUrl.includes('/api/ops/alerts/sentry')
        || requestUrl.split('?')[0].replace(/\/$/, '') === '/api/integrations/whatsapp/webhook';
}

function captureSignedWebhookRawBody(req, _res, buffer) {
    if (shouldCaptureSignedWebhookRawBody(req) && Buffer.isBuffer(buffer)) {
        req.rawBody = Buffer.from(buffer);
    }
}

const SECURITY_HEADERS = Object.freeze({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin'
});

function applySecurityHeaders(_req, res, next) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    next();
}

// The OTLP sink only serves this process's own exporter (loopback or the
// Docker network); the public edge must not reach it.
function isInternalAddress(address) {
    const ip = String(address || '').replace(/^::ffff:/, '');
    return ip === '127.0.0.1'
        || ip === '::1'
        || /^10\./.test(ip)
        || /^192\.168\./.test(ip)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

function requireInternalCaller(req, res, next) {
    // Behind nginx req.ip is the client; the socket is the proxy. Both must be internal.
    if (isInternalAddress(req.ip) && isInternalAddress(req.socket?.remoteAddress)) return next();
    return res.status(404).end();
}

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
    const URLENCODED_LIMITS = Object.freeze({
        extended: true,
        limit: '50mb',
        parameterLimit: 1000,
        depth: 5
    });

    // ✅ NOVO: Middleware para gerar traceId automaticamente em requisições HTTP
    app.use(traceIdExpressMiddleware);

    app.disable('x-powered-by');
    app.use(applySecurityHeaders);

    // A refused origin is a 403, not a 500 from the default error handler.
    const corsMiddleware = cors(corsOptions);
    app.use((req, res, next) => corsMiddleware(req, res, (error) => {
        if (!error) return next();
        return res.status(403).json({ success: false, error: 'Origem não permitida' });
    }));

    // OTLP ingest local para evitar exporter apontando para endpoint inválido (ECONNREFUSED)
    app.post('/otel/v1/traces', requireInternalCaller, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
        const bytesFromBody = Buffer.isBuffer(req.body) ? req.body.length : 0;
        const headerLength = Number.parseInt(req.headers['content-length'] || '0', 10);
        const bytes = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : bytesFromBody;
        recordIngest(bytes, 200);
        res.status(200).end();
    });

    app.get('/otel/health', requireInternalCaller, (_req, res) => {
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
    // Public signed webhook has a small parser before the general upload parser.
    app.use('/api/integrations/whatsapp/webhook', express.json({ limit: '1mb', verify: captureSignedWebhookRawBody }));
    app.use(express.json({ limit: '50mb', verify: captureSignedWebhookRawBody })); // Aumentado de 10mb para 50mb
    app.use(express.urlencoded(URLENCODED_LIMITS));

    // ✅ Timeout mais alto para OCR/extração via IA em PDFs grandes.
    // Mantém compatível com produção via variável de ambiente SERVER_TIMEOUT.
    const requestTimeoutMs = parseInt(process.env.SERVER_TIMEOUT, 10) || 300000; // 5 minutos
    server.timeout = requestTimeoutMs;
    server.keepAliveTimeout = requestTimeoutMs + 5000;
    server.headersTimeout = requestTimeoutMs + 10000;
    // Keep a single bounded parser. Multipart uploads use multer; this parser is
    // only for application/x-www-form-urlencoded requests.

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
module.exports.captureSignedWebhookRawBody = captureSignedWebhookRawBody;
module.exports.shouldCaptureSignedWebhookRawBody = shouldCaptureSignedWebhookRawBody;
module.exports.isInternalAddress = isInternalAddress;
module.exports.SECURITY_HEADERS = SECURITY_HEADERS;
