#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.62.169.31.231.sslip.io';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.62.169.31.231.sslip.io';
const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const DRIVER_UID = process.env.TEST_DRIVER_UID || '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const ONLINE_MAX_ATTEMPTS = Number(process.env.ONLINE_MAX_ATTEMPTS || 5);
const TEST_CAR_TYPE = String(process.env.TEST_CAR_TYPE || 'leaf_plus').trim() || 'leaf_plus';

const PICKUP = {
  lat: Number(process.env.TEST_PICKUP_LAT || -22.9075),
  lng: Number(process.env.TEST_PICKUP_LNG || -43.1736),
  address: process.env.TEST_PICKUP_ADDRESS || 'Centro - Rio de Janeiro'
};
const DESTINATION = {
  lat: Number(process.env.TEST_DEST_LAT || -22.9121),
  lng: Number(process.env.TEST_DEST_LNG || -43.1825),
  address: process.env.TEST_DEST_ADDRESS || 'Lapa - Rio de Janeiro'
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function nowIso() { return new Date().toISOString(); }
function buildReportPath() { return path.join(__dirname, '..', '..', 'reports', `normal-ride-smoke-vps-${Date.now()}.json`); }
function writeReport(report, reportPath) { fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); }
async function postJson(url, body, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}
function onceStatusAck(driverClient, payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      driverClient.socket.removeListener('driverStatusUpdated', successHandler);
      driverClient.socket.removeListener('driverStatusError', errorHandler);
    };
    const done = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const successHandler = (data) => done({ ok: true, data });
    const errorHandler = (error) => done({ ok: false, error });
    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      done({ ok: false, error: { code: 'STATUS_TIMEOUT', error: 'Timeout aguardando driverStatus ack' } });
    }, timeoutMs);
    driverClient.socket.once('driverStatusUpdated', (data) => { clearTimeout(timeout); successHandler(data); });
    driverClient.socket.once('driverStatusError', (error) => { clearTimeout(timeout); errorHandler(error); });
    driverClient.socket.emit('setDriverStatus', payload);
  });
}
async function ensureDriverOnline(driverClient) {
  for (let attempt = 1; attempt <= ONLINE_MAX_ATTEMPTS; attempt += 1) {
    const ack = await onceStatusAck(driverClient, {
      status: 'online',
      isOnline: true,
      lat: PICKUP.lat + (attempt * 0.00001),
      lng: PICKUP.lng + (attempt * 0.00001),
      heading: (Date.now() / 100) % 360,
      speed: 0
    });
    if (ack.ok) return { success: true, attempts: attempt, ack: ack.data };
    const code = String(ack.error?.code || '').toUpperCase();
    const retryAfter = Number(ack.error?.retryAfterSec || 1);
    if (code === 'LOCATION_REQUIRED' || code === 'ONLINE_NOT_READY') {
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
    return { success: false, attempts: attempt, error: ack.error || { code: 'UNKNOWN', error: 'Falha ao colocar driver online' } };
  }
  return { success: false, attempts: ONLINE_MAX_ATTEMPTS, error: { code: 'ONLINE_RETRY_EXHAUSTED', error: 'Tentativas para ficar online esgotadas' } };
}
function createBookingWithTimeout(passengerClient, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('create_booking_timeout')), timeoutMs);
    const successHandler = (response) => {
      clearTimeout(timeout);
      passengerClient.socket.removeListener('bookingError', errorHandler);
      resolve(response);
    };
    const errorHandler = (error) => {
      clearTimeout(timeout);
      passengerClient.socket.removeListener('bookingCreated', successHandler);
      reject(new Error(error?.error || error?.message || 'create_booking_error'));
    };
    passengerClient.socket.once('bookingCreated', successHandler);
    passengerClient.socket.once('bookingError', errorHandler);
    passengerClient.socket.emit('createBooking', payload);
  });
}
function emitAndWait(client, { emitEvent, emitPayload, successEvent, errorEvent, timeoutMs = 20000, predicate = null }) {
  const matches = typeof predicate === 'function' ? predicate : (() => true);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      client.socket.removeListener(successEvent, successHandler);
      if (errorEvent) client.socket.removeListener(errorEvent, errorHandler);
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`timeout_${emitEvent}`)); }, timeoutMs);
    const successHandler = (payload = {}) => {
      try { if (!matches(payload)) return; } catch (_error) { return; }
      clearTimeout(timeout);
      cleanup();
      resolve(payload);
    };
    const errorHandler = (error = {}) => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(error.error || error.message || `error_${emitEvent}`));
    };
    client.socket.on(successEvent, successHandler);
    if (errorEvent) client.socket.on(errorEvent, errorHandler);
    client.socket.emit(emitEvent, emitPayload);
  });
}
async function createPaymentAdvance(amountInCents = 2750) {
  const rideId = `ride_normal_${Date.now()}`;
  const paymentAdvance = await postJson(`${API_BASE_URL}/api/payment/advance`, {
    passengerId: PASSENGER_UID,
    amount: amountInCents,
    rideId,
    rideDetails: { origin: PICKUP.address, destination: DESTINATION.address },
    passengerName: 'Leaf Passageiro Teste',
    passengerEmail: 'qa@leaf.local'
  }, 20000);
  const chargeId = String(paymentAdvance?.data?.chargeId || '').trim();
  assert(paymentAdvance.ok, `payment_advance_failed:${paymentAdvance?.data?.message || paymentAdvance.status}`);
  assert(chargeId, 'payment_advance_missing_charge');
  return { rideId, chargeId, amountInCents };
}
async function confirmAdvancePaymentByWebhook({ rideId, chargeId, amountInCents, passengerId = PASSENGER_UID }) {
  const webhookPayload = {
    event: 'OPENPIX:CHARGE_COMPLETED',
    charge: {
      identifier: chargeId,
      correlationID: `ride_${rideId}_${Date.now()}_smoke`,
      value: amountInCents,
      status: 'COMPLETED',
      paidAt: nowIso(),
      additionalInfo: [
        { key: 'ride_id', value: rideId },
        { key: 'passenger_id', value: passengerId },
        { key: 'payment_type', value: 'advance_payment' }
      ]
    },
    pix: { status: 'COMPLETED' }
  };
  const webhookResponse = await postJson(`${API_BASE_URL}/api/woovi/webhook`, webhookPayload, 20000);
  assert(webhookResponse.ok, `advance_payment_webhook_failed:${webhookResponse.status}`);
  await sleep(400);
  return webhookResponse;
}

async function main() {
  const reportPath = buildReportPath();
  const report = {
    meta: {
      startedAt: new Date().toISOString(),
      wsUrl: WS_URL,
      baseUrl: API_BASE_URL,
      passengerUid: PASSENGER_UID,
      driverUid: DRIVER_UID,
      reportPath
    },
    flow: {},
    status: 'running'
  };

  const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  let heartbeatTimer = null;

  try {
    await passenger.connect();
    await driver.connect();
    await passenger.authenticate(PASSENGER_UID, 'customer');
    await driver.authenticate(DRIVER_UID, 'driver');

    const online = await ensureDriverOnline(driver);
    assert(online.success, `driver_online_failed:${online.error?.code || 'unknown'}`);
    report.meta.driverOnline = online;

    const sendDriverIdleLocation = () => {
      driver.socket.emit('updateLocation', {
        lat: PICKUP.lat + 0.0002,
        lng: PICKUP.lng + 0.0002,
        tripStatus: 'idle',
        isInTrip: false,
        seq: Date.now() % 100000
      });
    };

    sendDriverIdleLocation();
    heartbeatTimer = setInterval(sendDriverIdleLocation, 1200);
    await sleep(1000);

    const payment = await createPaymentAdvance(2750);
    await confirmAdvancePaymentByWebhook(payment);

    const booking = await createBookingWithTimeout(passenger, {
      customerId: PASSENGER_UID,
      pickupLocation: PICKUP,
      destinationLocation: DESTINATION,
      estimatedFare: 27.5,
      carType: TEST_CAR_TYPE,
      selectedVehicle: TEST_CAR_TYPE,
      paymentMethod: 'pix',
      paymentStatus: 'confirmed',
      paymentData: {
        chargeId: payment.chargeId,
        rideId: payment.rideId,
        amountInCents: payment.amountInCents
      },
      idempotencyKey: `normal_ride_${Date.now()}`
    });
    assert(booking?.bookingId, 'booking_id_missing');
    report.flow.booking = booking;

    const paymentConfirmed = await passenger.confirmPayment({
      bookingId: booking.bookingId,
      paymentMethod: 'pix',
      paymentId: payment.chargeId,
      chargeId: payment.chargeId,
      rideId: payment.rideId,
      amount: 27.5
    });
    report.flow.paymentConfirmed = paymentConfirmed;

    const newRideRequest = await driver.waitForEvent('newRideRequest', 45000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);
    const accepted = await driver.acceptRide(booking.bookingId);
    await passenger.waitForEvent('rideAccepted', 15000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);

    driver.socket.emit('updateLocation', { lat: PICKUP.lat, lng: PICKUP.lng, tripStatus: 'accepted', isInTrip: false, seq: Date.now() % 100000 });
    await sleep(250);
    const arrived = await emitAndWait(driver, {
      emitEvent: 'notificationAction',
      emitPayload: { action: 'arrived_at_pickup', bookingId: booking.bookingId, location: { lat: PICKUP.lat, lng: PICKUP.lng } },
      successEvent: 'notificationActionSuccess',
      errorEvent: 'notificationActionError',
      timeoutMs: 15000,
      predicate: (payload) => String(payload?.bookingId || '') === String(booking.bookingId)
    });
    await passenger.waitForEvent('driverArrived', 15000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId).catch(() => null);

    const started = await driver.startTrip({ bookingId: booking.bookingId, startLocation: { lat: PICKUP.lat, lng: PICKUP.lng } });
    const passengerStarted = await passenger.waitForEvent('tripStarted', 15000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);

    const completed = await driver.finishTrip({
      bookingId: booking.bookingId,
      endLocation: { lat: DESTINATION.lat, lng: DESTINATION.lng },
      fare: 27.5,
      distance: 6200,
      duration: 900,
      mockPayment: true,
      __mockPayment: true
    });
    const passengerCompleted = await passenger.waitForEvent('tripCompleted', 20000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);

    passenger.socket.emit('submitRating', { tripId: booking.bookingId, bookingId: booking.bookingId, customerId: PASSENGER_UID, driverId: DRIVER_UID, rating: 5, comment: 'ok' });
    const ratingResult = await Promise.race([
      passenger.waitForEvent('ratingSubmitted', 10000, (payload) => payload?.tripId === booking.bookingId || payload?.bookingId === booking.bookingId),
      passenger.waitForEvent('ratingError', 10000, () => true)
    ]).catch(() => null);

    report.flow = {
      ...report.flow,
      newRideRequest,
      accepted,
      arrived,
      started,
      passengerStarted,
      completed,
      passengerCompleted,
      ratingResult
    };
    report.status = 'success';
    report.meta.finishedAt = new Date().toISOString();
  } catch (error) {
    report.status = 'failed';
    report.meta.finishedAt = new Date().toISOString();
    report.meta.error = error.message;
    report.meta.stack = error.stack;
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    try { passenger.disconnect(); } catch (_error) {}
    try { driver.disconnect(); } catch (_error) {}
    writeReport(report, reportPath);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'success') process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
