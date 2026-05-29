#!/usr/bin/env node

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'iDiAKrLjeDWbIOYFEqkHLS3JBGN2';
const DRIVER_UID = process.env.TEST_DRIVER_UID || '5zgeX92yleYa2wH8JnMvqOU76fX2';
const ONLINE_MAX_ATTEMPTS = Number(process.env.ONLINE_MAX_ATTEMPTS || 5);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const createBookingWithTimeout = (payload, timeoutMs = 60000) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('create_booking_timeout'));
        }, timeoutMs);

        const successHandler = (response) => {
          clearTimeout(timeout);
          passenger.socket.removeListener('bookingError', errorHandler);
          resolve(response);
        };

        const errorHandler = (error) => {
          clearTimeout(timeout);
          passenger.socket.removeListener('bookingCreated', successHandler);
          reject(new Error(error?.error || error?.message || 'create_booking_error'));
        };

        passenger.socket.once('bookingCreated', successHandler);
        passenger.socket.once('bookingError', errorHandler);
        passenger.socket.emit('createBooking', payload);
      });
    };

    const runBooking = async (label) => {
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

      const booking = await createBookingWithTimeout({
        customerId: PASSENGER_UID,
        pickupLocation: PICKUP,
        destinationLocation: DESTINATION,
        estimatedFare: 27.5,
        paymentMethod: 'pix',
        paymentStatus: 'confirmed',
        paymentData: {
          chargeId,
          rideId,
          amountInCents: 2750
        },
        idempotencyKey: `supersede_${Date.now()}_${label}`
      });

      const bookingId = booking?.bookingId;
      if (!bookingId) {
        throw new Error(`booking_id_missing_${label}`);
      }

      const ackAt = Date.now();
      await driver.waitForEvent(
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
    };

    const first = await runBooking('first');
    await sleep(1000);
    const second = await runBooking('second');

    console.log(JSON.stringify({ ok: true, online, first, second }, null, 2));
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
