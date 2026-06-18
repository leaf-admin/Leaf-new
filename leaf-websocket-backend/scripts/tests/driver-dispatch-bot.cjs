#!/usr/bin/env node
const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const DRIVER_UID = process.env.TEST_DRIVER_UID || 'gl3uJkLwBjbeOtbbvVSryhziVBx1';
const PICKUP = {
  lat: Number(process.env.TEST_PICKUP_LAT || 37.779026),
  lng: Number(process.env.TEST_PICKUP_LNG || -122.419906)
};
const ESTIMATED_FARE = Number(process.env.TEST_FARE || 13.42);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
async function ensureDriverOnline(driverClient) {
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
      driverClient.socket.emit('updateLocation', {
        lat: PICKUP.lat + 0.0002,
        lng: PICKUP.lng + 0.0002,
        tripStatus: 'idle',
        isInTrip: false,
        seq: Date.now() % 100000
      });
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
    const request = await driver.waitForEvent('newRideRequest', 180000);
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
    await sleep(2000);
    const arrived = await driver.arrivedAtPickup(bookingId, { location: pickup, timeoutMs: 30000 });
    console.log('arrived_at_pickup', JSON.stringify(arrived || {}));
    await sleep(1000);
    const startWait = driver.waitForEvent('tripStarted', 30000, payload => (payload?.bookingId || payload?.rideId) === bookingId);
    driver.socket.emit('startTrip', { bookingId, startLocation: pickup });
    const started = await startWait;
    console.log('trip_started', JSON.stringify(started || {}));
    const steps = interpolatePoints(
      { lat: Number(pickup.lat || pickup.latitude), lng: Number(pickup.lng || pickup.longitude) },
      { lat: Number(destination.lat || destination.latitude), lng: Number(destination.lng || destination.longitude) },
      10
    );
    for (const [index, point] of steps.entries()) {
      driver.socket.emit('updateTripLocation', { bookingId, lat: point.lat, lng: point.lng, heading: 45, speed: 12 });
      console.log('trip_location_update', JSON.stringify({ step: index + 1, total: steps.length, point }));
      await sleep(1800);
    }
    const completeWait = driver.waitForEvent('tripCompleted', 30000, payload => (payload?.bookingId || payload?.rideId) === bookingId);
    driver.socket.emit('completeTrip', {
      bookingId,
      endLocation: destination,
      distance: 4.7,
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
