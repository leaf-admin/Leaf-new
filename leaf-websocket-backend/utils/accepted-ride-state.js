const RideStateManager = require('../services/ride-state-manager');
const {
  writeVisibleBookingSnapshot
} = require('../services/booking-visibility-service');

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureAcceptedRideCanonicalState(redis, {
  bookingId,
  driverId,
  acceptedAt = new Date().toISOString(),
  extraPatch = {}
} = {}) {
  if (!redis) throw new Error('Redis connection is required');
  if (!bookingId) throw new Error('bookingId is required');
  if (!driverId) throw new Error('driverId is required');

  const bookingKey = `booking:${bookingId}`;
  const bookingData = await redis.hgetall(bookingKey);
  if (!bookingData || Object.keys(bookingData).length === 0) {
    throw new Error(`Booking not found: ${bookingId}`);
  }

  const ownershipToken = String(
    bookingData.bookingOwnershipToken ||
    `${bookingId}:${driverId}:${Date.now()}`
  );
  const patch = {
    ...extraPatch,
    state: RideStateManager.STATES.ACCEPTED,
    status: 'ACCEPTED',
    driverId,
    ownerDriverId: driverId,
    bookingOwnershipToken: ownershipToken,
    acceptedAt: bookingData.acceptedAt || acceptedAt,
    updatedAt: acceptedAt
  };
  Object.keys(patch).forEach((key) => {
    if (patch[key] === undefined) delete patch[key];
  });

  await redis.hset(bookingKey, patch);
  await writeVisibleBookingSnapshot(redis, bookingId, patch);

  const activeBookingData = {
    ...bookingData,
    ...patch
  };
  const pickup = parseJsonField(activeBookingData.pickupLocation);
  const destination = parseJsonField(activeBookingData.destinationLocation);
  const estimate = toFiniteNumber(
    activeBookingData.estimatedFare ??
    activeBookingData.fare ??
    activeBookingData.estimate
  );

  if (pickup) activeBookingData.pickup = pickup;
  if (destination) activeBookingData.drop = destination;
  if (estimate !== null) activeBookingData.estimate = estimate;

  const keyType = await redis.type('bookings:active');
  if (keyType !== 'hash' && keyType !== 'none') {
    await redis.del('bookings:active');
  }

  await redis.hset('bookings:active', bookingId, JSON.stringify(activeBookingData));

  return activeBookingData;
}

module.exports = {
  ensureAcceptedRideCanonicalState
};
