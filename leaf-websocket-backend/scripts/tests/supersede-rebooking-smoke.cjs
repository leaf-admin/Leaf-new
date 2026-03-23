#!/usr/bin/env node

const axios = require('axios');
const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://api.147.182.204.181.sslip.io';
const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'iDiAKrLjeDWbIOYFEqkHLS3JBGN2';
const DRIVER_UID = process.env.TEST_DRIVER_UID || '5zgeX92yleYa2wH8JnMvqOU76fX2';
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

function httpBaseFromWsUrl(input) {
  if (input.startsWith('ws://')) return `http://${input.replace(/^ws:\/\//, '')}`;
  if (input.startsWith('wss://')) return `https://${input.replace(/^wss:\/\//, '')}`;
  return input;
}

async function waitDriverReady(httpBase, driverId, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await axios.get(`${httpBase}/api/driver-status/${driverId}`, { timeout: 5000 });
      const canReceiveRequests = response?.data?.canReceiveRequests === true;
      const inDriverGeo = response?.data?.details?.isOnlineInRedis === true;
      if (canReceiveRequests && inDriverGeo) return true;
    } catch (_error) {
      // retry
    }
    await sleep(700);
  }
  return false;
}

async function run() {
  const httpBase = httpBaseFromWsUrl(WS_URL);
  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });

  let heartbeatTimer = null;

  try {
    await driver.connect();
    await passenger.connect();
    await driver.authenticate(DRIVER_UID, 'driver');
    await passenger.authenticate(PASSENGER_UID, 'customer');

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

    const ready = await waitDriverReady(httpBase, DRIVER_UID, 40000);
    if (!ready) {
      throw new Error('driver_not_ready');
    }

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
      const booking = await createBookingWithTimeout({
        customerId: PASSENGER_UID,
        pickupLocation: PICKUP,
        destinationLocation: DESTINATION,
        estimatedFare: 27.5,
        paymentMethod: 'pix',
        paymentStatus: 'confirmed',
        paymentData: {
          chargeId: `charge_${Date.now()}_${label}`,
          rideId: `ride_${Date.now()}_${label}`,
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

    console.log(JSON.stringify({ ok: true, first, second }, null, 2));
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
