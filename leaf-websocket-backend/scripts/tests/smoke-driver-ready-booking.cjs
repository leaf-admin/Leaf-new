#!/usr/bin/env node

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.62.169.31.231.sslip.io';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.62.169.31.231.sslip.io';
const PASSENGER_UID = String(process.env.TEST_PASSENGER_UID || process.env.PASSENGER_UID || '').trim();
const DRIVER_UID = String(process.env.TEST_DRIVER_UID || process.env.DRIVER_UID || '').trim();
const LEGACY_PASSENGER_UID = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const LEGACY_DRIVER_UID = '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const TEST_CAR_TYPE = String(process.env.TEST_CAR_TYPE || 'leafplus').trim() || 'leafplus';

if (!PASSENGER_UID || !DRIVER_UID) {
  console.error(JSON.stringify({
    ok: false,
    error: 'missing_uids',
    message: 'Defina TEST_PASSENGER_UID e TEST_DRIVER_UID'
  }, null, 2));
  process.exit(1);
}

if (PASSENGER_UID === DRIVER_UID) {
  console.error(JSON.stringify({
    ok: false,
    error: 'uid_conflict',
    message: 'TEST_PASSENGER_UID e TEST_DRIVER_UID não podem ser iguais'
  }, null, 2));
  process.exit(1);
}

if (PASSENGER_UID === LEGACY_DRIVER_UID && DRIVER_UID === LEGACY_PASSENGER_UID) {
  console.error(JSON.stringify({
    ok: false,
    error: 'uids_swapped',
    message: 'Os UIDs parecem invertidos: passageiro recebeu UID legado de motorista e vice-versa'
  }, null, 2));
  process.exit(1);
}

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

const ONLINE_MAX_ATTEMPTS = Number(process.env.ONLINE_MAX_ATTEMPTS || 5);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

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

    driverClient.socket.once('driverStatusUpdated', (data) => {
      clearTimeout(timeout);
      successHandler(data);
    });
    driverClient.socket.once('driverStatusError', (error) => {
      clearTimeout(timeout);
      errorHandler(error);
    });

    driverClient.socket.emit('setDriverStatus', payload);
  });
}

async function ensureDriverOnline(driverClient) {
  for (let attempt = 1; attempt <= ONLINE_MAX_ATTEMPTS; attempt += 1) {
    const heading = (Date.now() / 100) % 360;
    const ack = await onceStatusAck(driverClient, {
      status: 'online',
      isOnline: true,
      lat: PICKUP.lat + (attempt * 0.00001),
      lng: PICKUP.lng + (attempt * 0.00001),
      heading,
      speed: 0
    }, 12000);

    if (ack.ok) {
      return { success: true, attempts: attempt, ack: ack.data };
    }

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

    return {
      success: false,
      attempts: attempt,
      error: ack.error || { code: 'UNKNOWN', error: 'Falha ao colocar driver online' }
    };
  }

  return {
    success: false,
    attempts: ONLINE_MAX_ATTEMPTS,
    error: {
      code: 'ONLINE_RETRY_EXHAUSTED',
      error: 'Tentativas para ficar online esgotadas'
    }
  };
}

async function createBookingWithTimeout(passengerClient, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('create_booking_timeout'));
    }, timeoutMs);

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
    pix: {
      status: 'COMPLETED'
    }
  };

  const webhookResponse = await postJson(`${API_BASE_URL}/api/woovi/webhook`, webhookPayload, 20000);
  if (!webhookResponse.ok) {
    throw new Error(`advance_payment_webhook_failed:${webhookResponse.status}`);
  }
  await sleep(400);
  return webhookResponse;
}

async function runBooking({ passengerClient, driverClient, label }) {
  const startedAt = Date.now();
  const rideId = `ride_${Date.now()}_${label}`;
  const paymentAdvance = await postJson(`${API_BASE_URL}/api/payment/advance`, {
    passengerId: PASSENGER_UID,
    amount: 2750,
    rideId,
    rideDetails: {
      origin: PICKUP.address,
      destination: DESTINATION.address
    },
    passengerName: 'Leaf Passageiro Teste',
    passengerEmail: 'qa@leaf.local'
  }, 20000);

  const chargeId = String(paymentAdvance?.data?.chargeId || '').trim();
  if (!paymentAdvance.ok || !chargeId) {
    throw new Error(paymentAdvance?.data?.message || 'payment_advance_failed');
  }

  await confirmAdvancePaymentByWebhook({
    rideId,
    chargeId,
    amountInCents: 2750
  });

  const booking = await createBookingWithTimeout(passengerClient, {
    customerId: PASSENGER_UID,
    pickupLocation: PICKUP,
    destinationLocation: DESTINATION,
    estimatedFare: 27.5,
    carType: TEST_CAR_TYPE,
    selectedVehicle: TEST_CAR_TYPE,
    paymentMethod: 'pix',
    paymentStatus: 'confirmed',
    paymentData: {
      chargeId,
      rideId,
      amountInCents: 2750
    },
    idempotencyKey: `smoke_${Date.now()}_${label}`
  });

  const bookingId = booking?.bookingId;
  if (!bookingId) {
    throw new Error(`booking_id_missing_${label}`);
  }

  await passengerClient.confirmPayment({
    bookingId,
    paymentMethod: 'pix',
    paymentId: chargeId,
    chargeId,
    rideId,
    amount: 27.5
  });

  const ackAt = Date.now();
  await driverClient.waitForEvent(
    'newRideRequest',
    45000,
    (payload) => (payload?.bookingId || payload?.rideId) === bookingId
  );
  const eventAt = Date.now();

  return {
    label,
    bookingId,
    ackMs: ackAt - startedAt,
    eventMs: eventAt - startedAt,
    afterAckMs: eventAt - ackAt
  };
}

async function run() {
  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });

  let heartbeatTimer = null;

  try {
    await driver.connect();
    await passenger.connect();

    await driver.authenticate(DRIVER_UID, 'driver');
    await passenger.authenticate(PASSENGER_UID, 'customer');

    const online = await ensureDriverOnline(driver);
    if (!online.success) {
      throw new Error(`driver_online_failed:${online.error?.code || 'unknown'}:${online.error?.error || 'unknown'}`);
    }

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

    await sleep(1000);

    const booking = await runBooking({ passengerClient: passenger, driverClient: driver, label: 'dispatch_smoke' });
    let cleanup = null;
    try {
      cleanup = await passenger.cancelRide(booking.bookingId, 'preflight_dispatch_cleanup');
    } catch (cleanupError) {
      cleanup = {
        success: false,
        error: cleanupError.message
      };
    }

    console.log(JSON.stringify({
      ok: true,
      wsUrl: WS_URL,
      passengerUid: PASSENGER_UID,
      driverUid: DRIVER_UID,
      online,
      booking,
      cleanup
    }, null, 2));
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    driver.disconnect();
    passenger.disconnect();
  }
}

run().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
