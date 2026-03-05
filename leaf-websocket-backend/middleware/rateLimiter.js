// Rate Limiting Middleware
// Data: 29/07/2025
// Status: ✅ RATE LIMITING

const rateLimit = require('express-rate-limit');
const { logSecurity } = require('../utils/logger');

// Rate limiters específicos
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // Máximo 100 requisições por minuto
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
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Máximo 5 tentativas de login por 15 minutos
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
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // Máximo 30 atualizações de localização por minuto
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
  windowMs: 60 * 1000, // 1 minuto
  max: 50, // Máximo 50 conexões WebSocket por minuto
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
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // Máximo 10 tentativas de pagamento por minuto
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
