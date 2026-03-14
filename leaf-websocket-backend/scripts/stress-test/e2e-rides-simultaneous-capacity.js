#!/usr/bin/env node
/**
 * E2E simultaneous rides capacity test
 *
 * Full flow per ride:
 * customer+driver auth -> createBooking -> confirmPayment -> acceptRide -> startTrip -> completeTrip
 */

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const io = require('socket.io-client');
const admin = require('firebase-admin');
const { createClient } = require('redis');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

const SERVER_URL = arg('--url', 'http://127.0.0.1:3001');
const RIDES = Number.parseInt(arg('--rides', '50'), 10);
const CONCURRENCY = Number.parseInt(arg('--concurrency', String(RIDES)), 10);
const TOKEN_CONCURRENCY = Number.parseInt(arg('--token-concurrency', '40'), 10);
const FIREBASE_API_KEY = arg(
  '--api-key',
  process.env.FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc'
);
const REDIS_URL = arg('--redis-url', process.env.REDIS_URL || 'redis://:leaf_redis_2024@localhost:6379/0');
const BASE_LAT = Number.parseFloat(arg('--base-lat', '-22.9068'));
const BASE_LNG = Number.parseFloat(arg('--base-lng', '-43.1729'));
const RADIUS = Number.parseFloat(arg('--radius', '0.01'));
const REPORT_PATH = path.join(__dirname, `../../stress-test-e2e-rides-${Date.now()}.json`);

function randomLocation() {
  return {
    lat: BASE_LAT + (Math.random() - 0.5) * RADIUS,
    lng: BASE_LNG + (Math.random() - 0.5) * RADIUS
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
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

function ensureFirebaseAdmin() {
  if (admin.apps.length) return;
  const credentialPath = path.join(__dirname, '../../leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
  admin.initializeApp({
    credential: admin.credential.cert(credentialPath)
  });
}

async function customToIdToken(customToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
  const res = await axios.post(url, {
    token: customToken,
    returnSecureToken: true
  }, { timeout: 20000 });
  if (!res.data?.idToken) throw new Error('No idToken returned by Firebase');
  return res.data.idToken;
}

async function generateUserTokens(userIds) {
  ensureFirebaseAdmin();
  const auth = admin.auth();
  return withConcurrency(userIds, TOKEN_CONCURRENCY, async (uid) => {
    const customToken = await auth.createCustomToken(uid);
    const idToken = await customToIdToken(customToken);
    return { uid, idToken, ok: true };
  });
}

function waitSocket(socket, okEvent, errEvents, timeoutMs, stage) {
  return new Promise((resolve, reject) => {
    const onOk = (payload) => {
      cleanup();
      resolve(payload);
    };
    const onErr = (payload) => {
      cleanup();
      reject(new Error(payload?.message || payload?.error || `${stage}_error`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${stage}_timeout`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off(okEvent, onOk);
      for (const e of errEvents) socket.off(e, onErr);
    }

    socket.once(okEvent, onOk);
    for (const e of errEvents) socket.once(e, onErr);
  });
}

async function connectAndAuthSocket(user, userType) {
  const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    timeout: 20000,
    reconnection: false,
    forceNew: true,
    auth: { token: user.idToken }
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect_timeout')), 20000);
    socket.on('connect', () => {
      clearTimeout(t);
      resolve();
    });
    socket.on('connect_error', (e) => {
      clearTimeout(t);
      reject(new Error(e?.message || 'connect_error'));
    });
  });

  socket.emit('authenticate', { uid: user.uid, userType, token: user.idToken });
  await waitSocket(socket, 'authenticated', ['auth_error', 'authentication_error'], 20000, 'authenticate');

  return socket;
}

async function seedDriverAvailability(redis, driverId, location) {
  if (!redis || !driverId || !location) return;

  const hSet = redis.hSet ? redis.hSet.bind(redis) : redis.hset?.bind(redis);
  const geoAdd = redis.geoAdd ? redis.geoAdd.bind(redis) : redis.geoadd?.bind(redis);
  if (!hSet || !geoAdd) {
    throw new Error('Redis client sem suporte a hSet/geoAdd');
  }

  await hSet(`driver:${driverId}`, {
    id: driverId,
    status: 'available',
    isOnline: 'true',
    userType: 'driver',
    carType: 'plus',
    lat: String(location.lat),
    lng: String(location.lng),
    lastUpdate: Date.now().toString(),
    updatedAt: Date.now().toString()
  });
  await geoAdd('driver_locations', {
    longitude: location.lng,
    latitude: location.lat,
    member: driverId
  });
}

async function runRideFlow(ride, redis) {
  const t0 = Date.now();
  let customer = null;
  let driver = null;
  const markers = {};
  try {
    markers.connectStart = Date.now();
    [customer, driver] = await Promise.all([
      connectAndAuthSocket(ride.passenger, 'customer'),
      connectAndAuthSocket(ride.driver, 'driver')
    ]);
    markers.connected = Date.now();

    const driverLoc = randomLocation();
    await seedDriverAvailability(redis, ride.driver.uid, driverLoc);
    driver.emit('setDriverStatus', { status: 'available', isOnline: true });
    driver.emit('updateDriverLocation', {
      lat: driverLoc.lat,
      lng: driverLoc.lng,
      heading: 0,
      speed: 0,
      isInTrip: false,
      tripStatus: null
    });

    const pickup = randomLocation();
    const destination = randomLocation();

    customer.emit('createBooking', {
      customerId: ride.passenger.uid,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: 20 + Math.random() * 20,
      paymentMethod: 'pix',
      carType: 'standard'
    });

    const bookingCreated = await waitSocket(customer, 'bookingCreated', ['bookingError'], 25000, 'createBooking');
    const bookingId = bookingCreated?.bookingId || bookingCreated?.data?.bookingId;
    if (!bookingId) throw new Error('booking_id_missing');
    markers.bookingCreated = Date.now();

    customer.emit('confirmPayment', {
      bookingId,
      paymentMethod: 'pix',
      paymentId: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      amount: 25,
      pickupLocation: pickup
    });
    await waitSocket(customer, 'paymentConfirmed', ['paymentError'], 20000, 'confirmPayment');
    markers.paymentConfirmed = Date.now();

    await redis.del(`driver_lock:${ride.driver.uid}`);
    driver.emit('acceptRide', { bookingId });
    await waitSocket(driver, 'rideAccepted', ['acceptRideError'], 25000, 'acceptRide');
    markers.rideAccepted = Date.now();

    driver.emit('startTrip', {
      bookingId,
      startLocation: pickup
    });
    await waitSocket(driver, 'tripStarted', ['tripStartError'], 25000, 'startTrip');
    markers.tripStarted = Date.now();

    driver.emit('completeTrip', {
      bookingId,
      endLocation: destination,
      distance: 2 + Math.random() * 8,
      fare: 25
    });
    await waitSocket(driver, 'tripCompleted', ['tripCompleteError'], 25000, 'completeTrip');
    markers.tripCompleted = Date.now();

    return {
      ok: true,
      bookingId,
      latencyMs: Date.now() - t0,
      stageLatencyMs: {
        auth: (markers.connected || t0) - (markers.connectStart || t0),
        createBooking: (markers.bookingCreated || t0) - (markers.connected || t0),
        confirmPayment: (markers.paymentConfirmed || t0) - (markers.bookingCreated || t0),
        acceptRide: (markers.rideAccepted || t0) - (markers.paymentConfirmed || t0),
        startTrip: (markers.tripStarted || t0) - (markers.rideAccepted || t0),
        completeTrip: (markers.tripCompleted || t0) - (markers.tripStarted || t0)
      }
    };
  } catch (error) {
    const msg = error?.message || String(error);
    let stage = 'unknown';
    if (msg.includes('createBooking') || msg.includes('booking')) stage = 'createBooking';
    else if (msg.includes('payment')) stage = 'confirmPayment';
    else if (msg.includes('acceptRide')) stage = 'acceptRide';
    else if (msg.includes('startTrip')) stage = 'startTrip';
    else if (msg.includes('completeTrip')) stage = 'completeTrip';
    else if (msg.includes('auth') || msg.includes('connect')) stage = 'connect/auth';
    return { ok: false, stage, error: msg, latencyMs: Date.now() - t0 };
  } finally {
    try { customer?.disconnect(); } catch (_) {}
    try { driver?.disconnect(); } catch (_) {}
  }
}

async function main() {
  const started = Date.now();
  const passengers = Array.from({ length: RIDES }, (_, i) => `e2e_p_${Date.now()}_${i}`);
  const drivers = Array.from({ length: RIDES }, (_, i) => `e2e_d_${Date.now()}_${i}`);

  const tokenStarted = Date.now();
  const [pTokens, dTokens] = await Promise.all([
    generateUserTokens(passengers),
    generateUserTokens(drivers)
  ]);
  const tokenDurationSec = (Date.now() - tokenStarted) / 1000;

  const validP = pTokens.filter((t) => t?.ok);
  const validD = dTokens.filter((t) => t?.ok);
  const pairs = [];
  for (let i = 0; i < Math.min(validP.length, validD.length, RIDES); i++) {
    pairs.push({ passenger: validP[i], driver: validD[i] });
  }

  const redis = createClient({ url: REDIS_URL });
  await redis.connect();

  let results = [];
  let runDurationSec = 0;
  try {
    const runStarted = Date.now();
    results = await withConcurrency(pairs, CONCURRENCY, (pair) => runRideFlow(pair, redis));
    runDurationSec = (Date.now() - runStarted) / 1000;
  } finally {
    await redis.quit().catch(() => {});
  }

  const ok = results.filter((r) => r?.ok);
  const failed = results.length - ok.length;
  const successRate = (ok.length / Math.max(results.length, 1)) * 100;
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const topErrors = {};
  for (const r of results) {
    if (!r?.ok) {
      const key = `${r.stage}:${r.error}`;
      topErrors[key] = (topErrors[key] || 0) + 1;
    }
  }

  const stageKeys = ['auth', 'createBooking', 'confirmPayment', 'acceptRide', 'startTrip', 'completeTrip'];
  const stageStats = {};
  for (const key of stageKeys) {
    const values = ok.map((r) => r.stageLatencyMs?.[key] || 0).filter((v) => v > 0).sort((a, b) => a - b);
    stageStats[key] = {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      max: values.length ? values[values.length - 1] : 0
    };
  }

  const report = {
    config: {
      serverUrl: SERVER_URL,
      rides: RIDES,
      concurrency: CONCURRENCY,
      tokenConcurrency: TOKEN_CONCURRENCY
    },
    tokenGeneration: {
      durationSec: Number(tokenDurationSec.toFixed(2)),
      passengersOk: validP.length,
      driversOk: validD.length
    },
    results: {
      total: results.length,
      success: ok.length,
      failed,
      successRate: Number(successRate.toFixed(2)),
      runDurationSec: Number(runDurationSec.toFixed(2)),
      ridesPerSec: Number((results.length / Math.max(runDurationSec, 0.001)).toFixed(2)),
      completedRidesPerSec: Number((ok.length / Math.max(runDurationSec, 0.001)).toFixed(2)),
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        max: latencies.length ? latencies[latencies.length - 1] : 0
      },
      stageLatencyMs: stageStats,
      topErrors: Object.entries(topErrors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([error, count]) => ({ error, count }))
    },
    totalDurationSec: Number((((Date.now() - started) / 1000)).toFixed(2)),
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath: REPORT_PATH, ...report }, null, 2));

  // Evita handles pendurados (firebase-admin) mantendo o processo vivo após terminar.
  await Promise.all(admin.apps.map((app) => app.delete().catch(() => {})));
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
