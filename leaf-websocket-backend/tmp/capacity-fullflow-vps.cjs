#!/usr/bin/env node
/**
 * Capacity test for full ride flow against VPS:
 * createBooking(payment already confirmed) -> newRideRequest -> acceptRide -> startTrip -> completeTrip
 *
 * Usage:
 *   node tmp/capacity-fullflow-vps.cjs --url http://147.182.204.181:3001 --rides 40 --concurrency 20
 */

const WebSocketTestClient = require('../tests/e2e/backend/__helpers__/websocket-test-client');
const { getIdTokenForUid } = require('../tests/e2e/backend/__helpers__/firebase-id-token');

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
}

const WS_URL = arg('--url', process.env.WS_URL || 'http://147.182.204.181:3001');
const RIDES = Number.parseInt(arg('--rides', process.env.RIDES || '20'), 10);
const CONCURRENCY = Number.parseInt(arg('--concurrency', process.env.CONCURRENCY || String(RIDES)), 10);
const TOKEN_CONCURRENCY = Number.parseInt(
  arg('--token-concurrency', process.env.TOKEN_CONCURRENCY || '20'),
  10
);
const BASE_LAT = Number.parseFloat(arg('--base-lat', '-22.9068'));
const BASE_LNG = Number.parseFloat(arg('--base-lng', '-43.1729'));

function nowMs() {
  return Date.now();
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (error) {
        results[i] = { ok: false, stage: 'worker', error: error.message || String(error) };
      }
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(runners);
  return results;
}

async function waitEvent(client, eventName, timeoutMs, predicate = null) {
  return client.waitForEvent(eventName, timeoutMs, predicate || undefined);
}

function locationForIndex(i) {
  const row = Math.floor(i / 20);
  const col = i % 20;
  const lat = BASE_LAT + col * 0.008;
  const lng = BASE_LNG + row * 0.008;
  return { lat, lng };
}

async function connectAndAuth(uid, userType, token) {
  const client = new WebSocketTestClient(WS_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnection: false
  });
  await client.connect();
  await client.authenticate(uid, userType, { token });
  return client;
}

async function runPair(pair, index) {
  const t0 = nowMs();
  let passengerClient = null;
  let driverClient = null;
  const marks = {};

  try {
    marks.connectStart = nowMs();
    [passengerClient, driverClient] = await Promise.all([
      connectAndAuth(pair.passenger.uid, 'customer', pair.passenger.token),
      connectAndAuth(pair.driver.uid, 'driver', pair.driver.token)
    ]);
    marks.authDone = nowMs();

    const base = locationForIndex(index);
    const pickup = {
      lat: base.lat,
      lng: base.lng,
      address: `Pickup ${index}`
    };
    const destination = {
      lat: base.lat + 0.004,
      lng: base.lng + 0.004,
      address: `Destination ${index}`
    };

    // Driver online/available signal (both legacy and canonical events)
    driverClient.socket.emit('setDriverStatus', { status: 'available', isOnline: true });
    driverClient.socket.emit('updateLocation', {
      lat: pickup.lat,
      lng: pickup.lng,
      tripStatus: 'idle',
      isInTrip: false,
      seq: nowMs() % 100000
    });
    driverClient.socket.emit('updateDriverLocation', {
      lat: pickup.lat,
      lng: pickup.lng,
      heading: 0,
      speed: 0,
      isInTrip: false,
      tripStatus: 'idle'
    });

    // Aguarda indexação de presença/localização no backend antes de criar corrida.
    await sleep(1200);

    const booking = await passengerClient.createBooking({
      customerId: pair.passenger.uid,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: 25 + (index % 10),
      paymentMethod: 'pix',
      paymentStatus: 'confirmed',
      paymentData: {
        chargeId: `charge_${nowMs()}_${index}`,
        rideId: `ride_${nowMs()}_${index}`,
        amountInCents: 2500 + (index % 10) * 100
      },
      idempotencyKey: `cap_${nowMs()}_${index}`
    });
    const bookingId = booking?.bookingId;
    if (!bookingId) throw new Error('booking_id_missing');
    marks.bookingCreated = nowMs();

    await waitEvent(
      driverClient,
      'newRideRequest',
      30000,
      (payload) => (payload?.bookingId || payload?.rideId) === bookingId
    );
    marks.newRideRequest = nowMs();

    await driverClient.acceptRide(bookingId);
    marks.accepted = nowMs();

    await driverClient.startTrip({
      bookingId,
      startLocation: pickup
    });
    marks.started = nowMs();

    await driverClient.finishTrip({
      bookingId,
      endLocation: destination,
      distance: 3.2 + (index % 3),
      fare: 29.9 + (index % 5)
    });
    marks.completed = nowMs();

    return {
      ok: true,
      bookingId,
      latencyMs: nowMs() - t0,
      stageLatencyMs: {
        auth: marks.authDone - marks.connectStart,
        createBooking: marks.bookingCreated - marks.authDone,
        dispatch: marks.newRideRequest - marks.bookingCreated,
        acceptRide: marks.accepted - marks.newRideRequest,
        startTrip: marks.started - marks.accepted,
        completeTrip: marks.completed - marks.started
      }
    };
  } catch (error) {
    const msg = error?.message || String(error);
    let stage = 'unknown';
    if (msg.includes('Timeout ao conectar') || msg.includes('authenticate') || msg.includes('auth')) stage = 'auth';
    else if (msg.includes('booking') || msg.includes('createBooking')) stage = 'createBooking';
    else if (msg.includes('newRideRequest')) stage = 'dispatch';
    else if (msg.includes('acceptRide')) stage = 'acceptRide';
    else if (msg.includes('startTrip')) stage = 'startTrip';
    else if (msg.includes('completeTrip')) stage = 'completeTrip';
    return { ok: false, stage, error: msg, latencyMs: nowMs() - t0 };
  } finally {
    try { passengerClient?.disconnect(); } catch (_) {}
    try { driverClient?.disconnect(); } catch (_) {}
  }
}

async function main() {
  const started = nowMs();
  const passengers = Array.from({ length: RIDES }, (_, i) => `cap_ff_passenger_${started}_${i}`);
  const drivers = Array.from({ length: RIDES }, (_, i) => `cap_ff_driver_${started}_${i}`);
  const users = passengers.map((uid) => ({ uid, kind: 'passenger' }))
    .concat(drivers.map((uid) => ({ uid, kind: 'driver' })));

  const tokenGenStarted = nowMs();
  const tokenResults = await withConcurrency(users, TOKEN_CONCURRENCY, async (entry) => {
    const token = await getIdTokenForUid(entry.uid);
    return { ok: true, uid: entry.uid, kind: entry.kind, token };
  });
  const tokenGenMs = nowMs() - tokenGenStarted;

  const okTokens = tokenResults.filter((r) => r?.ok);
  const tokenMap = new Map(okTokens.map((r) => [r.uid, r.token]));
  const pairs = [];
  for (let i = 0; i < RIDES; i += 1) {
    const p = passengers[i];
    const d = drivers[i];
    if (!tokenMap.has(p) || !tokenMap.has(d)) continue;
    pairs.push({
      passenger: { uid: p, token: tokenMap.get(p) },
      driver: { uid: d, token: tokenMap.get(d) }
    });
  }

  const runStarted = nowMs();
  const results = await withConcurrency(pairs, CONCURRENCY, runPair);
  const runMs = nowMs() - runStarted;

  const ok = results.filter((r) => r?.ok);
  const failed = results.length - ok.length;
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errors = {};
  for (const r of results) {
    if (!r?.ok) {
      const k = `${r.stage}:${r.error}`;
      errors[k] = (errors[k] || 0) + 1;
    }
  }

  const stageKeys = ['auth', 'createBooking', 'dispatch', 'acceptRide', 'startTrip', 'completeTrip'];
  const stageStats = {};
  for (const key of stageKeys) {
    const values = ok
      .map((r) => r.stageLatencyMs?.[key] || 0)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    stageStats[key] = {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      max: values.length ? values[values.length - 1] : 0
    };
  }

  const report = {
    config: {
      wsUrl: WS_URL,
      rides: RIDES,
      concurrency: CONCURRENCY,
      tokenConcurrency: TOKEN_CONCURRENCY
    },
    tokenGeneration: {
      requestedUsers: users.length,
      okUsers: okTokens.length,
      failedUsers: users.length - okTokens.length,
      durationMs: tokenGenMs
    },
    results: {
      total: results.length,
      success: ok.length,
      failed,
      successRate: Number(((ok.length / Math.max(results.length, 1)) * 100).toFixed(2)),
      runDurationMs: runMs,
      ridesPerSec: Number((results.length / Math.max(runMs / 1000, 0.001)).toFixed(2)),
      completedRidesPerSec: Number((ok.length / Math.max(runMs / 1000, 0.001)).toFixed(2)),
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        max: latencies.length ? latencies[latencies.length - 1] : 0
      },
      stageLatencyMs: stageStats,
      topErrors: Object.entries(errors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([error, count]) => ({ error, count }))
    },
    totalDurationMs: nowMs() - started,
    timestamp: new Date().toISOString()
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
