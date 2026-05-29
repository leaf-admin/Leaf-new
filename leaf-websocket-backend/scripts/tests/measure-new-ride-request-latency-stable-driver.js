#!/usr/bin/env node

/**
 * Mede latência createBooking -> newRideRequest com motorista estável online.
 * Evita ruído de corrida entre "subir online" e "disparo de booking".
 *
 * Uso:
 *   WS_URL=https://socket.leaf.app.br API_BASE_URL=https://api.leaf.app.br RUNS=10 node scripts/tests/measure-new-ride-request-latency-stable-driver.js
 */

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
const RUNS = Number(process.env.RUNS || 10);
const ONLINE_MAX_ATTEMPTS = Number(process.env.ONLINE_MAX_ATTEMPTS || 5);
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

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const k = (sorted.length - 1) * (p / 100);
  const f = Math.floor(k);
  const c = Math.ceil(k);
  if (f === c) return sorted[k];
  return sorted[f] * (c - k) + sorted[c] * (k - f);
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

    const online = await ensureDriverOnline(driver);
    if (!online.success) {
      throw new Error(`Driver não ficou online: ${online.error?.code || 'unknown'}`);
    }

    for (let i = 1; i <= RUNS; i += 1) {
      process.stdout.write(`Run ${i}/${RUNS} ... `);
      let bookingId = null;
      try {
        const onlineRound = await ensureDriverOnline(driver);
        if (!onlineRound.success) {
          throw new Error(`Driver não ficou pronto antes da rodada (${onlineRound.error?.code || 'unknown'})`);
        }

        const startedAt = Date.now();
        const rideId = `ride_${Date.now()}_${i}`;
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

        const booking = await passenger.createBooking({
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
