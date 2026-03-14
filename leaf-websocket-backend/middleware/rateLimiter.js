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
    logSecurity('warn', 'Rate limit excedido - Geral', {
      ip: req.ip,
      url: req.url,
      userAgent: req.headers['user-agent']
    });
    res.status(429).json({
      error: 'Muitas requisições. Tente novamente em 1 minuto.',
      retryAfter: 60
    });
  }
});

const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_SEC * 1000,
  max: AUTH_LIMIT,
  message: {
    error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurity('warn', 'Rate limit excedido - Autenticação', {
      ip: req.ip,
      url: req.url
    });
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
    logSecurity('warn', 'Rate limit excedido - Localização', {
      ip: req.ip,
      url: req.url
    });
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
    logSecurity('warn', 'Rate limit excedido - WebSocket', {
      ip: req.ip,
      url: req.url
    });
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
    logSecurity('warn', 'Rate limit excedido - Pagamento', {
      ip: req.ip,
      url: req.url
    });
    res.status(429).json({
      error: 'Muitas tentativas de pagamento. Aguarde um momento.',
      retryAfter: 60
    });
  }
});

// Função para aplicar rate limiting baseado na rota
const applyRateLimit = (req, res, next) => {
  const url = req.url;

  // OTLP ingest interno não deve sofrer rate limiting para evitar queda de telemetria.
  if (url.includes('/otel/v1/traces') || url.includes('/otel/health')) {
    return next();
  }
  
  // Rate limiting específico por rota
  if (url.includes('/auth') || url.includes('/login') || url.includes('/register')) {
    return authLimiter(req, res, next);
  }
  
  if (url.includes('/location') || url.includes('/update_location')) {
    return locationLimiter(req, res, next);
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
  paymentLimiter
};
