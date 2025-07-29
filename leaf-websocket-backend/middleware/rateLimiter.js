// Rate Limiting Middleware
// Data: 29/07/2025
// Status: ✅ RATE LIMITING

const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const { logSecurity } = require('../utils/logger');

// Configuração do Redis para rate limiting
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || null,
  db: process.env.REDIS_DB || 0,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
});

// Store personalizado para Redis
const RedisStore = {
  incr: async (key) => {
    try {
      const count = await redis.incr(key);
      await redis.expire(key, 60); // Expirar em 60 segundos
      return { totalHits: count };
    } catch (error) {
      logSecurity('error', 'Erro no Redis store', { error: error.message });
      return { totalHits: 1 };
    }
  },
  
  decrement: async (key) => {
    try {
      await redis.decr(key);
    } catch (error) {
      logSecurity('error', 'Erro ao decrementar no Redis', { error: error.message });
    }
  },
  
  resetKey: async (key) => {
    try {
      await redis.del(key);
    } catch (error) {
      logSecurity('error', 'Erro ao resetar chave no Redis', { error: error.message });
    }
  }
};

// Rate limiters específicos
const generalLimiter = rateLimit({
  store: RedisStore,
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
  store: RedisStore,
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
  store: RedisStore,
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
  store: RedisStore,
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
  store: RedisStore,
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
  paymentLimiter,
  redis
}; 