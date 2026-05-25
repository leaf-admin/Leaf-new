const admin = require('firebase-admin');
const { logStructured } = require('./logger');

const positiveTtlMs = Number(process.env.ADMIN_USER_CACHE_TTL_MS || 60 * 1000);
const negativeTtlMs = Number(process.env.ADMIN_USER_CACHE_NEGATIVE_TTL_MS || 15 * 1000);

const cache = new Map();

function getCacheKey(userId) {
  return String(userId || '');
}

function readCache(userId, maxAgeMs = null) {
  const key = getCacheKey(userId);
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  if (Number.isFinite(Number(maxAgeMs))) {
    const safeMaxAgeMs = Math.max(0, Number(maxAgeMs));
    if (Date.now() - entry.cachedAt > safeMaxAgeMs) {
      cache.delete(key);
      return null;
    }
  }

  return entry;
}

function writeCache(userId, payload, ttlMs) {
  const now = Date.now();
  cache.set(getCacheKey(userId), {
    ...payload,
    cachedAt: now,
    expiresAt: now + Math.max(1000, Number(ttlMs) || 1000)
  });
}

async function getAdminUser(userId, { source = 'unknown', maxAgeMs = null } = {}) {
  const cached = readCache(userId, maxAgeMs);
  if (cached) {
    return {
      exists: cached.exists,
      data: cached.data,
      fromCache: true
    };
  }

  const normalizedUserId = getCacheKey(userId);
  const snapshot = await admin.firestore().collection('adminUsers').doc(normalizedUserId).get();

  if (!snapshot.exists) {
    writeCache(normalizedUserId, { exists: false, data: null }, negativeTtlMs);
    logStructured('warn', 'Firestore adminUsers doc ausente', {
      service: 'admin-user-cache',
      firestore_collection: 'adminUsers',
      firestore_result: 'NOT_FOUND',
      userId: normalizedUserId,
      source
    });
    return {
      exists: false,
      data: null,
      fromCache: false
    };
  }

  const data = snapshot.data() || {};
  writeCache(normalizedUserId, { exists: true, data }, positiveTtlMs);
  return {
    exists: true,
    data,
    fromCache: false
  };
}

function primeAdminUser(userId, data, ttlMs = positiveTtlMs) {
  writeCache(userId, { exists: true, data: data || {} }, ttlMs);
}

function invalidateAdminUser(userId) {
  cache.delete(getCacheKey(userId));
}

module.exports = {
  getAdminUser,
  primeAdminUser,
  invalidateAdminUser
};
