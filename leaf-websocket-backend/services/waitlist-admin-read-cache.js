'use strict';

/**
 * Cache curto (Redis, compartilhado entre gateways) das leituras da página Waitlist do painel.
 *
 * As rotas de admin da fila leem coleções inteiras (waitList, waitlist_landing) e o painel
 * atualiza a cada minuto. Sem cache, cada atualização de cada aba aberta relê tudo do Firestore.
 * Quem altera a fila chama invalidate(): o contador de geração muda e as próximas leituras
 * buscam de novo. Sem Redis, as rotas leem direto, como antes.
 */
const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

const GENERATION_KEY = 'waitlist:admin:read:gen';
const KEY_PREFIX = 'waitlist:admin:read';
const DEFAULT_TTL_SECONDS = 120;

async function getRedis() {
  await redisPool.ensureConnection();
  return redisPool.getConnection();
}

function serializeParams(params = {}) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key] ?? ''}`)
    .join('&');
}

async function read(scope, params, loader, ttlSeconds = DEFAULT_TTL_SECONDS) {
  let redis = null;
  let cacheKey = null;
  try {
    redis = await getRedis();
    const generation = (await redis.get(GENERATION_KEY)) || '0';
    cacheKey = `${KEY_PREFIX}:${generation}:${scope}:${serializeParams(params)}`;
    const cached = await redis.get(cacheKey);
    if (cached) return { value: JSON.parse(cached), cache: 'HIT' };
  } catch (error) {
    logger.warn('Cache da waitlist indisponível; lendo direto', { scope, error: error.message });
    redis = null;
  }

  const value = await loader();
  if (redis && cacheKey) {
    try {
      await redis.set(cacheKey, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      logger.warn('Falha ao gravar cache da waitlist', { scope, error: error.message });
    }
  }
  return { value, cache: redis ? 'MISS' : 'BYPASS' };
}

async function invalidate() {
  try {
    const redis = await getRedis();
    await redis.incr(GENERATION_KEY);
  } catch (error) {
    logger.warn('Falha ao invalidar cache da waitlist', { error: error.message });
  }
}

module.exports = { read, invalidate, DEFAULT_TTL_SECONDS };
