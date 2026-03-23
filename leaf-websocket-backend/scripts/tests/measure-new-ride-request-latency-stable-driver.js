#!/usr/bin/env node

/**
 * Mede latência createBooking -> newRideRequest com motorista estável online.
 * Evita ruído de corrida entre "subir online" e "disparo de booking".
 *
 * Uso:
 *   WS_URL=https://api.147.182.204.181.sslip.io RUNS=10 node scripts/tests/measure-new-ride-request-latency-stable-driver.js
 */

const axios = require('axios');
const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://api.147.182.204.181.sslip.io';
const RUNS = Number(process.env.RUNS || 10);
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

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const k = (sorted.length - 1) * (p / 100);
  const f = Math.floor(k);
  const c = Math.ceil(k);
  if (f === c) return sorted[k];
  return sorted[f] * (c - k) + sorted[c] * (k - f);
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
    await sleep(800);
  }
  return false;
}

async function run() {
  const httpBase = httpBaseFromWsUrl(WS_URL);
  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });

  const latencies = [];
  const ackLatencies = [];
  const afterAckLatencies = [];
  const failures = [];
  let heartbeatTimer = null;
  const seenRideRequestAt = new Map();

  try {
    await driver.connect();
    await passenger.connect();
    await driver.authenticate(DRIVER_UID, 'driver');
    await passenger.authenticate(PASSENGER_UID, 'customer');

    // Captura contínua para evitar race: evento pode chegar antes do waitForEvent por rodada.
    driver.socket.on('newRideRequest', (payload) => {
      const id = payload?.bookingId || payload?.rideId;
      if (id && !seenRideRequestAt.has(id)) {
        seenRideRequestAt.set(id, Date.now());
      }
    });

    // Sobe motorista online e mantém heartbeat leve.
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
      throw new Error('Driver não ficou pronto para receber corridas em tempo hábil');
    }

    for (let i = 1; i <= RUNS; i += 1) {
      process.stdout.write(`Run ${i}/${RUNS} ... `);
      let bookingId = null;
      try {
        const driverReady = await waitDriverReady(httpBase, DRIVER_UID, 45000);
        if (!driverReady) {
          throw new Error('Driver não ficou pronto antes da rodada');
        }

        const startedAt = Date.now();

        const booking = await passenger.createBooking({
          customerId: PASSENGER_UID,
          pickupLocation: PICKUP,
          destinationLocation: DESTINATION,
          estimatedFare: 27.5,
          paymentMethod: 'pix',
          paymentStatus: 'confirmed',
          paymentData: {
            chargeId: `charge_${Date.now()}_${i}`,
            rideId: `ride_${Date.now()}_${i}`,
            amountInCents: 2750
          },
          idempotencyKey: `stable_latency_${Date.now()}_${i}`
        });

        bookingId = booking?.bookingId;
        if (!bookingId) throw new Error(`bookingId ausente: ${JSON.stringify(booking)}`);
        process.stdout.write(`booking=${bookingId} ... `);
        const ackElapsed = Date.now() - startedAt;

        let elapsed;
        const seenAt = seenRideRequestAt.get(bookingId);
        if (seenAt) {
          elapsed = seenAt - startedAt;
        } else {
          await driver.waitForEvent(
            'newRideRequest',
            45000,
            (payload) => (payload?.bookingId || payload?.rideId) === bookingId
          );
          elapsed = Date.now() - startedAt;
        }

        const afterAckMs = Math.max(0, elapsed - ackElapsed);
        latencies.push(elapsed);
        ackLatencies.push(ackElapsed);
        afterAckLatencies.push(afterAckMs);
        console.log(`${elapsed}ms (ack=${ackElapsed}ms, afterAck=${afterAckMs}ms)`);

        try {
          await passenger.cancelRide(bookingId, 'cleanup_after_stable_latency_measure');
        } catch (_cleanupError) {
          // ignore
        }

        await sleep(1200);
      } catch (error) {
        failures.push({
          run: i,
          bookingId,
          error: error.message
        });
        console.log(`failed(${error.message})`);
      }
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    driver.disconnect();
    passenger.disconnect();
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const sortedAck = [...ackLatencies].sort((a, b) => a - b);
  const sortedAfterAck = [...afterAckLatencies].sort((a, b) => a - b);
  const summary = {
    runsTotal: RUNS,
    runsSuccess: latencies.length,
    runsFail: RUNS - latencies.length,
    successRatePct: Number(((latencies.length / RUNS) * 100).toFixed(2)),
    elapsedMs: {
      min: sorted.length ? sorted[0] : null,
      p50: sorted.length ? Number(percentile(sorted, 50).toFixed(2)) : null,
      p95: sorted.length ? Number(percentile(sorted, 95).toFixed(2)) : null,
      p99: sorted.length ? Number(percentile(sorted, 99).toFixed(2)) : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      avg: sorted.length
        ? Number((sorted.reduce((acc, value) => acc + value, 0) / sorted.length).toFixed(2))
        : null
    },
    bookingAckMs: {
      min: sortedAck.length ? sortedAck[0] : null,
      p50: sortedAck.length ? Number(percentile(sortedAck, 50).toFixed(2)) : null,
      p95: sortedAck.length ? Number(percentile(sortedAck, 95).toFixed(2)) : null,
      max: sortedAck.length ? sortedAck[sortedAck.length - 1] : null,
      avg: sortedAck.length
        ? Number((sortedAck.reduce((acc, value) => acc + value, 0) / sortedAck.length).toFixed(2))
        : null
    },
    newRideAfterAckMs: {
      min: sortedAfterAck.length ? sortedAfterAck[0] : null,
      p50: sortedAfterAck.length ? Number(percentile(sortedAfterAck, 50).toFixed(2)) : null,
      p95: sortedAfterAck.length ? Number(percentile(sortedAfterAck, 95).toFixed(2)) : null,
      max: sortedAfterAck.length ? sortedAfterAck[sortedAfterAck.length - 1] : null,
      avg: sortedAfterAck.length
        ? Number((sortedAfterAck.reduce((acc, value) => acc + value, 0) / sortedAfterAck.length).toFixed(2))
        : null
    }
  };

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) {
    console.log('\n=== FAILURES (first 5) ===');
    failures.slice(0, 5).forEach((failure) => console.log(JSON.stringify(failure, null, 2)));
  }

  if (failures.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`stable_driver_latency_error: ${error.message}`);
  process.exitCode = 1;
});
