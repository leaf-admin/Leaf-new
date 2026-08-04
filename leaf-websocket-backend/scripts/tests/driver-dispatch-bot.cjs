#!/usr/bin/env node
const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');
let Redis = null;
try {
  Redis = require('ioredis');
} catch (_error) {
  Redis = null;
}

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const DRIVER_UID = process.env.TEST_DRIVER_UID || 'gl3uJkLwBjbeOtbbvVSryhziVBx1';
const PICKUP = {
  lat: Number(process.env.TEST_PICKUP_LAT || 37.779026),
  lng: Number(process.env.TEST_PICKUP_LNG || -122.419906)
};
const ESTIMATED_FARE = Number(process.env.TEST_FARE || 13.42);
const RIDE_REQUEST_TIMEOUT_MS = Math.max(
  180000,
  Number(process.env.DRIVER_RIDE_REQUEST_TIMEOUT_MS || 180000)
);
const ACCEPTED_HOLD_MS = Math.max(0, Number(process.env.DRIVER_ACCEPTED_HOLD_MS || 2000));
const ARRIVED_HOLD_MS = Math.max(0, Number(process.env.DRIVER_ARRIVED_HOLD_MS || 1000));
const TRIP_STEP_INTERVAL_MS = Math.max(250, Number(process.env.DRIVER_TRIP_STEP_INTERVAL_MS || 1800));
const TRIP_STEPS = Math.max(2, Number(process.env.DRIVER_TRIP_STEPS || 10));
const SEED_REDIS_ELIGIBLE = String(process.env.DRIVER_BOT_SEED_REDIS_ELIGIBLE || '').toLowerCase() === 'true';
const DRIVER_TTL_SECONDS = Math.max(60, Number(process.env.DRIVER_BOT_REDIS_TTL_SECONDS || 300));

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function buildRedisOptionsFromEnv() {
  if (!Redis) return null;
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL, maxRetriesPerRequest: 1 };
  }
  if (process.env.REDIS_HOST || process.env.REDIS_PORT || process.env.REDIS_PASSWORD) {
    return {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number.parseInt(process.env.REDIS_DB || '0', 10),
      maxRetriesPerRequest: 1
    };
  }
  return null;
}
function createRedisClient(options) {
  if (!options) return null;
  if (options.url) {
    return new Redis(options.url, { maxRetriesPerRequest: options.maxRetriesPerRequest || 1 });
  }
  return new Redis(options);
}
async function seedDriverEligibleInRedis() {
  if (!SEED_REDIS_ELIGIBLE) {
    return { requested: false, ok: null, skippedReason: 'disabled' };
  }
  const redisOptions = buildRedisOptionsFromEnv();
  if (!redisOptions) {
    return { requested: true, ok: null, skippedReason: 'redis_not_configured' };
  }
  const redis = createRedisClient(redisOptions);
  const timestamp = Date.now();
  const lat = PICKUP.lat + 0.0002;
  const lng = PICKUP.lng + 0.0002;
  const driverStatus = {
    id: DRIVER_UID,
    driverId: DRIVER_UID,
    name: process.env.DRIVER_BOT_NAME || 'Motorista Smoke Teste',
    phone: process.env.DRIVER_BOT_PHONE || '+5521999999999',
    photoUrl: '',
    isOnline: 'true',
    status: 'AVAILABLE',
    lat: String(lat),
    lng: String(lng),
    heading: '88',
    speed: '0',
    lastUpdate: String(timestamp),
    timestamp: String(timestamp),
    lastSeen: new Date(timestamp).toISOString(),
    rating: '5.0',
    acceptanceRate: '98.0',
    avgResponseTime: '3.0',
    totalTrips: '42',
    driverApproved: 'true',
    vehicleApproved: 'true',
    carType: 'leafplus',
    vehicleCategory: 'plus',
    acceptsPlusWithElite: 'true',
    dispatchEligible: 'true',
    dispatchEligibilityCode: 'QA_SMOKE_ELIGIBLE',
    dispatchEligibilityCheckedAt: new Date(timestamp).toISOString(),
    vehicleModel: process.env.DRIVER_BOT_VEHICLE_MODEL || 'Toyota Prius',
    vehiclePlate: process.env.DRIVER_BOT_VEHICLE_PLATE || 'TES8888',
    carColor: process.env.DRIVER_BOT_VEHICLE_COLOR || 'black'
  };

  try {
    await redis.del(
      `driver_lock:${DRIVER_UID}`,
      `driver_active_notification:${DRIVER_UID}`,
      `active_trip_by_driver:${DRIVER_UID}`,
      `active_trip_customer_by_driver:${DRIVER_UID}`
    );
    await redis.hset(`driver:${DRIVER_UID}`, driverStatus);
    await redis.geoadd('driver_locations', lng, lat, DRIVER_UID);
    await redis.geoadd(process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible', lng, lat, DRIVER_UID);
    await redis.sadd('online_drivers', DRIVER_UID);
    await redis.zrem('driver_offline_locations', DRIVER_UID);
    await redis.expire(`driver:${DRIVER_UID}`, DRIVER_TTL_SECONDS);
    return {
      requested: true,
      ok: true,
      driverId: DRIVER_UID,
      ttlSeconds: DRIVER_TTL_SECONDS,
      location: { lat, lng }
    };
  } catch (error) {
    return { requested: true, ok: false, error: error.message || String(error) };
  } finally {
    try {
      await redis.quit();
    } catch (_error) {
      // best-effort cleanup for QA redis client
    }
  }
}
function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
}
function interpolatePoints(start, end, steps = 10) {
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const f = i / steps;
    out.push({ lat: start.lat + (end.lat - start.lat) * f, lng: start.lng + (end.lng - start.lng) * f });
  }
  return out;
}
function distanceKmBetween(start, end) {
  const lat1 = Number(start?.lat ?? start?.latitude);
  const lng1 = Number(start?.lng ?? start?.longitude);
  const lat2 = Number(end?.lat ?? end?.latitude);
  const lng2 = Number(end?.lng ?? end?.longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const toRad = value => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function onceStatusAck(driverClient, payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      driverClient.socket.removeListener('driverStatusUpdated', successHandler);
      driverClient.socket.removeListener('driverStatusError', errorHandler);
      resolve(result);
    };
    const successHandler = (data) => done({ ok: true, data });
    const errorHandler = (error) => done({ ok: false, error });
    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      done({ ok: false, error: { code: 'STATUS_TIMEOUT', error: 'Timeout aguardando driverStatus ack' } });
    }, timeoutMs);
    driverClient.socket.once('driverStatusUpdated', data => { clearTimeout(timeout); successHandler(data); });
    driverClient.socket.once('driverStatusError', error => { clearTimeout(timeout); errorHandler(error); });
    driverClient.socket.emit('setDriverStatus', payload);
  });
}
function emitDriverLocationAndWait(driverClient, payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    const expectedSeq = Number(payload?.seq);
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      driverClient.socket.removeListener('locationUpdated', successHandler);
      driverClient.socket.removeListener('locationError', locationErrorHandler);
      driverClient.socket.removeListener('driverStatusError', statusErrorHandler);
      resolve(result);
    };
    const successHandler = (data = {}) => {
      const receivedSeq = Number(data?.seq);
      if (Number.isFinite(expectedSeq) && receivedSeq !== expectedSeq) return;
      done({ ok: true, data });
    };
    const locationErrorHandler = (error) => done({
      ok: false,
      event: 'locationError',
      error
    });
    const statusErrorHandler = (error) => done({
      ok: false,
      event: 'driverStatusError',
      error
    });

    timer = setTimeout(() => {
      done({
        ok: false,
        event: 'locationUpdatedTimeout',
        error: { code: 'LOCATION_SYNC_TIMEOUT', error: 'Timeout aguardando locationUpdated' }
      });
    }, timeoutMs);

    driverClient.socket.on('locationUpdated', successHandler);
    driverClient.socket.once('locationError', locationErrorHandler);
    driverClient.socket.once('driverStatusError', statusErrorHandler);
    driverClient.socket.emit('updateLocation', payload);
  });
}
async function primeDriverLocation(driverClient, attempt = 0) {
  const payload = {
    lat: PICKUP.lat + 0.0002 + attempt * 0.00001,
    lng: PICKUP.lng + 0.0002 + attempt * 0.00001,
    tripStatus: 'idle',
    isInTrip: false,
    seq: Date.now() % 100000
  };
  const result = await emitDriverLocationAndWait(driverClient, payload);
  console.log('driver_location_prime', JSON.stringify({
    attempt,
    ok: result.ok,
    event: result.event || 'locationUpdated',
    seq: payload.seq,
    error: result.error || null
  }));
  if (!result.ok) {
    const code = String(result.error?.code || result.error?.reason || result.event || 'LOCATION_SYNC_FAILED');
    throw new Error(`driver_location_sync_failed:${code}:${result.error?.error || result.error?.message || 'unknown'}`);
  }
  return result.data;
}
async function ensureDriverOnline(driverClient) {
  await primeDriverLocation(driverClient);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const ack = await onceStatusAck(driverClient, {
      status: 'online',
      isOnline: true,
      lat: PICKUP.lat + attempt * 0.00001,
      lng: PICKUP.lng + attempt * 0.00001,
      heading: (Date.now() / 100) % 360,
      speed: 0
    }, 12000);
    if (ack.ok) return ack.data;
    const code = String(ack.error?.code || '').toUpperCase();
    const retryAfter = Number(ack.error?.retryAfterSec || 1);
    console.log('driver_online_retry', JSON.stringify({ attempt, code, error: ack.error }));
    if (code === 'LOCATION_REQUIRED' || code === 'ONLINE_NOT_READY' || code === 'STATUS_TIMEOUT') {
      await primeDriverLocation(driverClient, attempt);
      await sleep(Math.max(700, retryAfter * 1000));
      continue;
    }
    throw new Error(`driver_online_failed:${code}:${ack.error?.error || 'unknown'}`);
  }
  throw new Error('driver_online_retry_exhausted');
}
async function main() {
  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  let heartbeatTimer = null;
  try {
    await driver.connect();
    await driver.authenticate(DRIVER_UID, 'driver');
    console.log('driver_authenticated', JSON.stringify({ driverUid: DRIVER_UID }));
    const redisSeed = await seedDriverEligibleInRedis();
    console.log('driver_redis_seed', JSON.stringify(redisSeed || {}));
    const online = await ensureDriverOnline(driver);
    console.log('driver_online', JSON.stringify(online || {}));
    const sendLocation = () => {
      driver.socket.emit('updateLocation', {
        lat: PICKUP.lat + 0.0002,
        lng: PICKUP.lng + 0.0002,
        tripStatus: 'idle',
        isInTrip: false,
        seq: Date.now() % 100000
      });
    };
    sendLocation();
    heartbeatTimer = setInterval(sendLocation, 1200);
    const request = await driver.waitForEvent('newRideRequest', RIDE_REQUEST_TIMEOUT_MS);
    const bookingId = request?.bookingId || request?.rideId;
    const pickup = request?.pickupLocation || PICKUP;
    const destination = request?.destinationLocation || { lat: PICKUP.lat - 0.01, lng: PICKUP.lng - 0.01 };
    console.log('new_ride_request', JSON.stringify({ bookingId, pickup, destination }));
    const accepted = await driver.acceptRide(bookingId);
    console.log('ride_accepted', JSON.stringify(accepted || {}));
    const completionFare = firstFiniteNumber(
      accepted?.estimatedFare,
      accepted?.fare,
      accepted?.totalFare,
      accepted?.grossAmount,
      request?.estimatedFare,
      request?.fare,
      request?.totalFare,
      ESTIMATED_FARE
    );
    await sleep(ACCEPTED_HOLD_MS);
    const arrived = await driver.arrivedAtPickup(bookingId, { location: pickup, timeoutMs: 30000 });
    console.log('arrived_at_pickup', JSON.stringify(arrived || {}));
    await sleep(ARRIVED_HOLD_MS);
    const startWait = driver.waitForEvent('tripStarted', 30000, payload => (payload?.bookingId || payload?.rideId) === bookingId);
    driver.socket.emit('startTrip', { bookingId, startLocation: pickup });
    const started = await startWait;
    console.log('trip_started', JSON.stringify(started || {}));
    const steps = interpolatePoints(
      { lat: Number(pickup.lat || pickup.latitude), lng: Number(pickup.lng || pickup.longitude) },
      { lat: Number(destination.lat || destination.latitude), lng: Number(destination.lng || destination.longitude) },
      TRIP_STEPS
    );
    for (const [index, point] of steps.entries()) {
      driver.socket.emit('updateLocation', {
        bookingId,
        tripId: bookingId,
        lat: point.lat,
        lng: point.lng,
        heading: 45,
        speed: 12,
        tripStatus: 'started',
        isInTrip: true,
        capturedAt: Date.now()
      });
      console.log('trip_location_update', JSON.stringify({ step: index + 1, total: steps.length, point }));
      await sleep(TRIP_STEP_INTERVAL_MS);
    }
    const simulatedDistanceKm = firstFiniteNumber(
      process.env.TEST_DISTANCE_KM,
      distanceKmBetween(pickup, destination)
    );
    const completeWait = driver.waitForEvent('tripCompleted', 30000, payload => (payload?.bookingId || payload?.rideId) === bookingId);
    driver.socket.emit('completeTrip', {
      bookingId,
      endLocation: destination,
      distance: simulatedDistanceKm,
      fare: completionFare ?? ESTIMATED_FARE
    });
    const completed = await completeWait;
    console.log('trip_completed', JSON.stringify(completed || {}));
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      await driver.disconnect();
    } catch (_disconnectError) {
      // best-effort cleanup for the QA bot
    }
  }
}
main().catch(error => { console.error('driver_dispatch_bot_failed', error?.stack || error?.message || String(error)); process.exit(2); });
