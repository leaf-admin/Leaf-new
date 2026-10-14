// Acesso às rotas /api/places/*: login + limite por usuário.
//
// O limite é por usuário (uid do token) e nunca global: o comportamento de um usuário não pode
// afetar outro. Enquanto PLACES_REQUIRE_AUTH não estiver ligado (versão antiga do app ainda sem
// token), quem chega sem token conta pelo IP. O contador fica no Redis para valer igual nos três
// gateways; se o Redis falhar, a consulta passa, porque um endereço que não carrega não pode
// impedir um pedido de corrida.

const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const WINDOW_SECONDS = toPositiveInt(process.env.PLACES_RATE_LIMIT_WINDOW_SECONDS, 60);
// O contador não pode atrasar a consulta: passou disso, libera.
const REDIS_TIMEOUT_MS = toPositiveInt(process.env.PLACES_RATE_LIMIT_REDIS_TIMEOUT_MS, 250);

const withTimeout = (promise) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), REDIS_TIMEOUT_MS);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

// Folgados de propósito: digitar um endereço, arrastar o pino e recalcular rota em sequência
// cabem com sobra. Só um cliente em loop chega perto.
const LIMITS = {
  autocomplete: toPositiveInt(process.env.PLACES_RATE_LIMIT_AUTOCOMPLETE, 120),
  'reverse-geocode': toPositiveInt(process.env.PLACES_RATE_LIMIT_REVERSE_GEOCODE, 120),
  details: toPositiveInt(process.env.PLACES_RATE_LIMIT_DETAILS, 60),
  search: toPositiveInt(process.env.PLACES_RATE_LIMIT_SEARCH, 60),
  directions: toPositiveInt(process.env.PLACES_RATE_LIMIT_DIRECTIONS, 60),
  save: toPositiveInt(process.env.PLACES_RATE_LIMIT_SAVE, 30),
};

const isAuthRequired = () => process.env.PLACES_REQUIRE_AUTH === 'true';

function extractBearerToken(req) {
  const header = String(req.headers?.authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice(7).trim() || null;
}

async function verifyUid(token) {
  try {
    firebaseConfig.initializeFirebase();
  } catch (_error) {
    // initializeFirebase já registra a falha e reaproveita um app existente.
  }
  const decoded = await admin.auth().verifyIdToken(token);
  return String(decoded?.uid || '').trim() || null;
}

async function consume(bucket, subject, limit) {
  let redis = null;
  try {
    redis = redisPool.getConnection();
  } catch (_error) {
    return { allowed: true, failOpen: true };
  }
  if (!redis || typeof redis.incr !== 'function' || (redis.status && redis.status !== 'ready')) {
    return { allowed: true, failOpen: true };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % WINDOW_SECONDS);
  const key = `rl:places:${bucket}:${subject}:${windowStart}`;
  try {
    const count = await withTimeout(redis.incr(key));
    if (count === 1) {
      redis.expire(key, WINDOW_SECONDS + 5).catch(() => null);
    }
    return {
      allowed: count <= limit,
      retryAfter: Math.max(1, windowStart + WINDOW_SECONDS - nowSeconds),
    };
  } catch (error) {
    logger.warn(`[PlacesAccess] limite indisponível, liberando: ${error.message}`);
    return { allowed: true, failOpen: true };
  }
}

function placesAccess(bucket) {
  const limit = LIMITS[bucket] || 60;

  return async (req, res, next) => {
    const token = extractBearerToken(req);
    let uid = null;

    if (token) {
      try {
        uid = await verifyUid(token);
      } catch (_error) {
        uid = null;
      }
    }

    if (!uid && isAuthRequired()) {
      return res.status(401).json({
        status: 'error',
        message: token ? 'Token inválido ou expirado.' : 'Token de autenticação ausente.',
      });
    }

    if (uid) {
      req.authenticatedUser = { ...(req.authenticatedUser || {}), uid, authSource: 'firebase' };
    }

    const subject = uid ? `u:${uid}` : `ip:${req.ip || 'unknown'}`;
    const result = await consume(bucket, subject, limit);
    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfter));
      return res.status(429).json({
        status: 'rate_limited',
        message: 'Muitas consultas de endereço em pouco tempo. Tente de novo em instantes.',
        retryAfter: result.retryAfter,
      });
    }

    return next();
  };
}

module.exports = {
  placesAccess,
  LIMITS,
  WINDOW_SECONDS,
};
