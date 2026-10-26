// Index of open booking_search:{bookingId} hashes, so periodic readers (radius
// expansion every 10 s, the H3 map) do not scan the whole keyspace.
//
// - Writers add the bookingId when they create or update the search hash.
// - Readers prune ids whose hash is gone (deleted or expired), so the many
//   delete sites do not need to know about the index.
// - A keyspace SCAN still runs at most once per RECONCILE_INTERVAL_MS per
//   process to pick up any search written by a path that does not index it.
//
// The key lives outside the booking_search:* pattern on purpose: old readers
// that scan that pattern would otherwise read a SET as a search hash.
const RedisScan = require('../utils/redis-scan');
const mapRegionalIndex = require('./map-regional-index');
const { logger } = require('../utils/logger');

const INDEX_KEY = 'index:booking_search';
const KEY_PREFIX = 'booking_search:';
const RECONCILE_INTERVAL_MS = Math.max(
  0,
  Number.parseInt(process.env.BOOKING_SEARCH_INDEX_RECONCILE_MS || '60000', 10) || 0
);
const SCAN_COUNT = Number.parseInt(process.env.REDIS_SCAN_COUNT || '1000', 10) || 1000;

let lastReconcileAt = 0;

// Never fails the caller: a missed index write only delays discovery until the
// next reconcile, while throwing here would stop a ride search from starting.
async function addToIndex(redis, bookingId) {
  if (!redis || !bookingId) return;
  try {
    await redis.sadd(INDEX_KEY, String(bookingId));
    await mapRegionalIndex.indexSearch(redis, bookingId);
  } catch (error) {
    logger.warn(`⚠️ [BookingSearchIndex] Falha ao indexar busca ${bookingId}: ${error.message}`);
  }
}

async function removeFromIndex(redis, bookingIds) {
  const ids = (Array.isArray(bookingIds) ? bookingIds : [bookingIds]).filter(Boolean).map(String);
  if (!redis || ids.length === 0) return;
  await redis.srem(INDEX_KEY, ...ids);
  if (mapRegionalIndex.enabledWrites()) {
    for (const id of ids) await mapRegionalIndex.remove(redis, 'search', id);
  }
}

/**
 * Returns the booking_search keys to read. Callers must treat an empty hash as
 * "gone" and call removeFromIndex for it.
 */
async function listSearchKeys(redis, { maxKeys = null, now = Date.now(), bounded = false } = {}) {
  if (bounded) {
    const limit = Math.min(2000, Math.max(1, maxKeys || 200));
    const ids = await redis.eval(`if redis.call('SCARD', KEYS[1]) > tonumber(ARGV[1]) then
      return redis.error_reply('MAP_LEGACY_BUDGET_EXCEEDED') end
      return redis.call('SMEMBERS', KEYS[1])`, 1, INDEX_KEY, String(limit)).catch(error => {
        error.statusCode = 503; throw error;
      });
    return ids.map(id => `${KEY_PREFIX}${id}`);
  }
  let ids;
  if (RECONCILE_INTERVAL_MS === 0 || now - lastReconcileAt >= RECONCILE_INTERVAL_MS) {
    lastReconcileAt = now;
    const keys = await RedisScan.scanKeys(redis, `${KEY_PREFIX}*`, SCAN_COUNT);
    ids = keys.map((key) => key.slice(KEY_PREFIX.length));
    if (ids.length > 0) {
      await redis.sadd(INDEX_KEY, ...ids);
    }
    const indexed = await redis.smembers(INDEX_KEY);
    ids = Array.from(new Set([...ids, ...indexed]));
  } else {
    ids = await redis.smembers(INDEX_KEY);
  }
  const keys = ids.map((id) => `${KEY_PREFIX}${id}`);
  return Number.isFinite(maxKeys) && maxKeys > 0 ? keys.slice(0, maxKeys) : keys;
}

function resetReconcileClockForTests() {
  lastReconcileAt = 0;
}

module.exports = {
  INDEX_KEY,
  addToIndex,
  removeFromIndex,
  listSearchKeys,
  resetReconcileClockForTests
};
