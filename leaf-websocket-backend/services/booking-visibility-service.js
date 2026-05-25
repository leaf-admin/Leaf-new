const { logger } = require('../utils/logger');

const BOOKING_VISIBILITY_TTL_SEC = Math.max(
  300,
  Number.parseInt(process.env.BOOKING_VISIBILITY_TTL_SEC || String(4 * 60 * 60), 10) || (4 * 60 * 60)
);

function getVisibleBookingKey(bookingId) {
  return `booking_visible:${bookingId}`;
}

async function writeVisibleBookingSnapshot(redis, bookingId, snapshot = {}) {
  if (!redis || !bookingId || !snapshot || typeof snapshot !== 'object') {
    return false;
  }

  const visibleKey = getVisibleBookingKey(bookingId);
  await redis.hset(visibleKey, {
    ...snapshot,
    visibilityUpdatedAt: new Date().toISOString()
  });
  await Promise.resolve(redis.expire(visibleKey, BOOKING_VISIBILITY_TTL_SEC)).catch(() => null);
  return true;
}

async function loadVisibleBookingSnapshot(redis, bookingId) {
  if (!redis || !bookingId) return null;
  const snapshot = await redis.hgetall(getVisibleBookingKey(bookingId));
  if (!snapshot || Object.keys(snapshot).length === 0) {
    return null;
  }
  return snapshot;
}

async function rehydratePrimaryBooking(redis, bookingId, metadata = {}) {
  if (!redis || !bookingId) return null;

  const bookingKey = `booking:${bookingId}`;
  const current = await redis.hgetall(bookingKey);
  if (current && Object.keys(current).length > 0) {
    return current;
  }

  const visibleSnapshot = await loadVisibleBookingSnapshot(redis, bookingId);
  if (!visibleSnapshot) {
    return null;
  }

  const rehydrated = {
    ...visibleSnapshot,
    rehydratedFromVisibility: 'true',
    rehydratedAt: new Date().toISOString(),
    ...(metadata && typeof metadata === 'object'
      ? Object.fromEntries(
          Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null)
        )
      : {})
  };

  await redis.hset(bookingKey, rehydrated);
  logger.warn(`⚠️ [booking-visibility] Rehidratando booking primário ${bookingId} a partir do snapshot visível`);
  return rehydrated;
}

module.exports = {
  BOOKING_VISIBILITY_TTL_SEC,
  getVisibleBookingKey,
  writeVisibleBookingSnapshot,
  loadVisibleBookingSnapshot,
  rehydratePrimaryBooking
};
