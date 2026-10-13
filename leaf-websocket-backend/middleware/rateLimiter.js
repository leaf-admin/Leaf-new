// Rate Limiting Middleware
// Data: 29/07/2025
// Status: ✅ RATE LIMITING

const rateLimit = require('express-rate-limit');
const { logSecurity } = require('../utils/logger');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const GENERAL_WINDOW_SEC = toPositiveInt(process.env.RATE_LIMIT_HTTP_GENERAL_WINDOW_SECONDS, 60);
const GENERAL_LIMIT = toPositiveInt(process.env.RATE_LIMIT_HTTP_GENERAL, 200);
const AUTH_WINDOW_SEC = toPositiveInt(process.env.RATE_LIMIT_HTTP_AUTH_WINDOW_SECONDS, 900);
const AUTH_LIMIT = toPositiveInt(process.env.RATE_LIMIT_HTTP_AUTH, 8);
const LOCATION_WINDOW_SEC = toPositiveInt(process.env.RATE_LIMIT_HTTP_LOCATION_WINDOW_SECONDS, 60);
const LOCATION_LIMIT = toPositiveInt(process.env.RATE_LIMIT_HTTP_LOCATION, 240);
const WEBSOCKET_WINDOW_SEC = toPositiveInt(process.env.RATE_LIMIT_HTTP_WEBSOCKET_WINDOW_SECONDS, 60);
const WEBSOCKET_LIMIT = toPositiveInt(process.env.RATE_LIMIT_HTTP_WEBSOCKET, 220);
const PAYMENT_WINDOW_SEC = toPositiveInt(process.env.RATE_LIMIT_HTTP_PAYMENT_WINDOW_SECONDS, 60);
const PAYMENT_LIMIT = toPositiveInt(process.env.RATE_LIMIT_HTTP_PAYMENT, 80);
const DRIVER_STATUS_WINDOW_SEC = toPositiveInt(process.env.RATE_LIMIT_HTTP_DRIVER_STATUS_WINDOW_SECONDS, 60);
const DRIVER_STATUS_LIMIT = toPositiveInt(process.env.RATE_LIMIT_HTTP_DRIVER_STATUS, 1200);
const RATE_LIMIT_LOG_COOLDOWN_MS = toPositiveInt(process.env.RATE_LIMIT_HTTP_LOG_COOLDOWN_MS, 30000);
const rateLimitLogCache = new Map();

const logRateLimitWithCooldown = (scope, req) => {
  const ip = req.ip || 'unknown';
  const url = req.url || req.originalUrl || 'unknown';
  const key = `${scope}:${ip}:${url}`;
  const now = Date.now();
  const last = rateLimitLogCache.get(key) || 0;

  if (now - last < RATE_LIMIT_LOG_COOLDOWN_MS) {
    return;
  }

  rateLimitLogCache.set(key, now);
  logSecurity('warn', `Rate limit excedido - ${scope}`, {
    ip,
    url,
    userAgent: req.headers['user-agent']
  });
};

// Rate limiters específicos
const generalLimiter = rateLimit({
  windowMs: GENERAL_WINDOW_SEC * 1000,
  max: GENERAL_LIMIT,
  message: {
    error: 'Muitas requisições. Tente novamente em 1 minuto.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logRateLimitWithCooldown('Geral', req);
    res.status(429).json({
      error: 'Muitas requisições. Tente novamente em 1 minuto.',
      retryAfter: 60
    });
  }
});

const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_SEC * 1000,
  max: AUTH_LIMIT,
  skipSuccessfulRequests: true,
  message: {
    error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logRateLimitWithCooldown('Autenticação', req);
    res.status(429).json({
      error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
      retryAfter: 900
    });
  }
});

const locationLimiter = rateLimit({
  windowMs: LOCATION_WINDOW_SEC * 1000,
  max: LOCATION_LIMIT,
  message: {
    error: 'Muitas atualizações de localização. Aguarde um momento.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logRateLimitWithCooldown('Localização', req);
    res.status(429).json({
      error: 'Muitas atualizações de localização. Aguarde um momento.',
      retryAfter: 60
    });
  }
});

const websocketLimiter = rateLimit({
  windowMs: WEBSOCKET_WINDOW_SEC * 1000,
  max: WEBSOCKET_LIMIT,
  message: {
    error: 'Muitas conexões WebSocket. Tente novamente em 1 minuto.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logRateLimitWithCooldown('WebSocket', req);
    res.status(429).json({
      error: 'Muitas conexões WebSocket. Tente novamente em 1 minuto.',
      retryAfter: 60
    });
  }
});

const paymentLimiter = rateLimit({
  windowMs: PAYMENT_WINDOW_SEC * 1000,
  max: PAYMENT_LIMIT,
  message: {
    error: 'Muitas tentativas de pagamento. Aguarde um momento.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logRateLimitWithCooldown('Pagamento', req);
    res.status(429).json({
      error: 'Muitas tentativas de pagamento. Aguarde um momento.',
      retryAfter: 60
    });
  }
});

const driverStatusLimiter = rateLimit({
  windowMs: DRIVER_STATUS_WINDOW_SEC * 1000,
  max: DRIVER_STATUS_LIMIT,
  message: {
    error: 'Muitas consultas de status de motorista. Aguarde um momento.',
    retryAfter: DRIVER_STATUS_WINDOW_SEC
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logRateLimitWithCooldown('DriverStatus', req);
    res.status(429).json({
      error: 'Muitas consultas de status de motorista. Aguarde um momento.',
      retryAfter: DRIVER_STATUS_WINDOW_SEC
    });
  }
});

const getRequestPath = (req) => String(req.path || req.originalUrl || req.url || '').split('?')[0];

const shouldBypassRateLimit = (req) => {
  const requestPath = getRequestPath(req);

  return (
    requestPath === '/health' ||
    requestPath.startsWith('/health/') ||
    requestPath === '/api/health' ||
    requestPath.startsWith('/api/health/') ||
    requestPath === '/otel/health' ||
    requestPath === '/otel/v1/traces'
  );
};

// Função para aplicar rate limiting baseado na rota
const applyRateLimit = (req, res, next) => {
  const url = req.url;

  // Health/telemetria interna não devem sofrer rate limiting para evitar flapping operacional.
  if (shouldBypassRateLimit(req)) {
    return next();
  }
  
  // Rate limiting específico por rota
  const isAuthSensitiveEndpoint =
    url.includes('/auth/login') ||
    url.includes('/auth/register') ||
    url.includes('/auth/forgot') ||
    url.includes('/auth/reset-password') ||
    url.includes('/login') ||
    url.includes('/register');

  if (isAuthSensitiveEndpoint) {
    return authLimiter(req, res, next);
  }
  
  if (url.includes('/location') || url.includes('/update_location')) {
    return locationLimiter(req, res, next);
  }

  if (url.includes('/api/driver-status')) {
    return driverStatusLimiter(req, res, next);
  }
  
  if (url.includes('/websocket') || url.includes('/socket.io')) {
    return websocketLimiter(req, res, next);
  }
  
  if (url.includes('/payment') || url.includes('/woovi') || url.includes('/baas')) {
    return paymentLimiter(req, res, next);
  }
  
  // Rate limiting geral para outras rotas
  return generalLimiter(req, res, next);
};

module.exports = {
  applyRateLimit,
  generalLimiter,
  authLimiter,
  locationLimiter,
  websocketLimiter,
  paymentLimiter,
  driverStatusLimiter,
  shouldBypassRateLimit
};
