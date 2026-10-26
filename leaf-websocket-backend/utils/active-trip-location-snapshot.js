'use strict';

// Do not transfer route geometry, receipts or pricing blobs for every GPS fix.
// This projection retains the fields consumed by lease validation, the H3 read
// model and the sealed persistence envelope of trip.location.v1.
const LOCATION_BOOKING_FIELDS = Object.freeze([
  'bookingId', 'driverId', 'customerId', 'customer', 'status', 'state',
  'pickupLocation', 'pickup', 'currentLocation', 'driverLocation', 'createdAt', 'updatedAt',
  'financialContext', 'financialNamespace', 'financialContextId',
  'paymentProviderEnvironment', 'providerEnvironment', 'paymentProfileId', 'testUserSandbox'
]);

async function readLocationBooking(redis, bookingId) {
  if (typeof redis.hmget !== 'function') return redis.hgetall(`booking:${bookingId}`);
  const values = await redis.hmget(`booking:${bookingId}`, ...LOCATION_BOOKING_FIELDS);
  return Object.fromEntries(LOCATION_BOOKING_FIELDS.flatMap((field, i) =>
    values[i] == null ? [] : [[field, values[i]]]));
}

module.exports = { LOCATION_BOOKING_FIELDS, readLocationBooking };
