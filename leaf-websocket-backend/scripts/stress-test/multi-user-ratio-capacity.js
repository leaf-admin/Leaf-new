#!/usr/bin/env node
/**
 * Multi-user capacity test (10:1 drivers:passengers)
 *
 * Usage:
 *   node scripts/stress-test/multi-user-ratio-capacity.js --url http://127.0.0.1:3001 --drivers 1000 --passengers 100 --api-key <FIREBASE_API_KEY>
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
const DRIVERS = Number.parseInt(arg('--drivers', '1000'), 10);
const PASSENGERS = Number.parseInt(arg('--passengers', '100'), 10);
const FIREBASE_API_KEY = arg('--api-key', process.env.FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc');
const TOKEN_CONCURRENCY = Number.parseInt(arg('--token-concurrency', '40'), 10);
const SOCKET_CONCURRENCY = Number.parseInt(arg('--socket-concurrency', '120'), 10);
const PICKUP_BASE_LAT = Number.parseFloat(arg('--pickup-lat', '-22.9068'));
const PICKUP_BASE_LNG = Number.parseFloat(arg('--pickup-lng', '-43.1729'));
const RADIUS = Number.parseFloat(arg('--radius', '0.01'));
const REPORT_PATH = path.join(__dirname, `../../stress-test-multi-user-${Date.now()}.json`);

const DRIVER_PREFIX = `cap_driver_${Date.now()}_`;
const PASSENGER_PREFIX = `cap_passenger_${Date.now()}_`;

function randomLocation() {
  return {
    lat: PICKUP_BASE_LAT + (Math.random() - 0.5) * RADIUS,
    lng: PICKUP_BASE_LNG + (Math.random() - 0.5) * RADIUS
  };
}

async function withConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (error) {
        results[idx] = { ok: false, error: error.message || String(error) };
      }
    }
  }

  const threads = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(threads);
  return results;
}

function ensureFirebaseAdmin() {
  if (admin.apps.length) return;

  const credentialPath = path.join(__dirname, '../../leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
  admin.initializeApp({
    credential: admin.credential.cert(credentialPath)
  });
}

async function exchangeCustomTokenForIdToken(customToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
  const response = await axios.post(url, {
    token: customToken,
    returnSecureToken: true
  }, { timeout: 20000 });

  if (!response.data?.idToken) {
    throw new Error('No idToken returned by Firebase');
  }

  return response.data.idToken;
}

async function generatePassengerTokens(passengerUids) {
  ensureFirebaseAdmin();
  const auth = admin.auth();

  const startedAt = Date.now();
  const tokenResults = await withConcurrency(passengerUids, TOKEN_CONCURRENCY, async (uid) => {
    const customToken = await auth.createCustomToken(uid);
    const idToken = await exchangeCustomTokenForIdToken(customToken);
    return { ok: true, uid, idToken };
  });

  const ok = tokenResults.filter((r) => r?.ok);
  const failed = tokenResults.length - ok.length;
  const durationSec = (Date.now() - startedAt) / 1000;

  return {
    tokens: ok.map((r) => ({ uid: r.uid, idToken: r.idToken })),
    stats: {
      requested: passengerUids.length,
      ok: ok.length,
      failed,
      durationSec: Number(durationSec.toFixed(2)),
      perSec: Number((ok.length / Math.max(durationSec, 0.001)).toFixed(2))
    }
  };
}

async function seedDrivers(redis, driverIds) {
  const startedAt = Date.now();
  const multi = redis.multi();

  for (const driverId of driverIds) {
    const loc = randomLocation();
    multi.sAdd('online_drivers', driverId);
    multi.geoAdd('drivers:locations', { longitude: loc.lng, latitude: loc.lat, member: driverId });
    multi.hSet(`driver:${driverId}`, {
      status: 'online',
      updatedAt: new Date().toISOString(),
      location: JSON.stringify(loc),
      testSeed: 'true'
    });
  }

  await multi.exec();

  const durationSec = (Date.now() - startedAt) / 1000;
  return {
    seeded: driverIds.length,
    durationSec: Number(durationSec.toFixed(2)),
    perSec: Number((driverIds.length / Math.max(durationSec, 0.001)).toFixed(2))
  };
}

async function cleanupDrivers(redis, driverIds) {
  const multi = redis.multi();
  if (driverIds.length > 0) {
    multi.sRem('online_drivers', driverIds);
    multi.zRem('drivers:locations', driverIds);
    for (const id of driverIds) {
      multi.del(`driver:${id}`);
    }
  }
  await multi.exec();
}

async function runPassengerBookingFlow(entry) {
  const { uid, idToken } = entry;
  const pickup = randomLocation();
  const destination = randomLocation();
  const started = Date.now();

  return new Promise((resolve) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      reconnection: false,
      forceNew: true,
      auth: { token: idToken }
    });

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { socket.disconnect(); } catch (_) {}
      resolve({
        uid,
        latencyMs: Date.now() - started,
        ...result
      });
    };

    const t = setTimeout(() => finish({ ok: false, stage: 'timeout', error: 'timeout_30s' }), 30000);

    socket.on('connect_error', (err) => {
      clearTimeout(t);
      finish({ ok: false, stage: 'connect', error: err?.message || 'connect_error' });
    });

    socket.on('auth_error', (err) => {
      clearTimeout(t);
      finish({ ok: false, stage: 'auth', error: err?.message || 'auth_error' });
    });

    socket.on('authentication_error', (err) => {
      clearTimeout(t);
      finish({ ok: false, stage: 'auth', error: err?.message || 'authentication_error' });
    });

    socket.on('connect', () => {
      socket.emit('authenticate', { uid, userType: 'customer', token: idToken });
    });

    socket.on('authenticated', () => {
      socket.emit('createBooking', {
        customerId: uid,
        pickupLocation: pickup,
        destinationLocation: destination,
        estimatedFare: 25 + Math.random() * 20,
        paymentMethod: 'pix',
        carType: 'standard'
      });
    });

    socket.on('bookingCreated', () => {
      clearTimeout(t);
      finish({ ok: true, stage: 'bookingCreated' });
    });

    socket.on('bookingError', (err) => {
      clearTimeout(t);
      finish({ ok: false, stage: 'bookingError', error: err?.message || err?.error || 'booking_error' });
    });
  });
}

async function runScenario() {
  const scenarioStarted = Date.now();
  const driverIds = Array.from({ length: DRIVERS }, (_, i) => `${DRIVER_PREFIX}${i}`);
  const passengerUids = Array.from({ length: PASSENGERS }, (_, i) => `${PASSENGER_PREFIX}${i}`);

  const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379/0' });
  await redis.connect();

  let seedStats = null;
  let tokenStats = null;
  let flowResults = [];
  let flowDurationSec = 0;

  try {
    seedStats = await seedDrivers(redis, driverIds);

    const tokenGen = await generatePassengerTokens(passengerUids);
    tokenStats = tokenGen.stats;

    const flowStarted = Date.now();
    flowResults = await withConcurrency(tokenGen.tokens, SOCKET_CONCURRENCY, runPassengerBookingFlow);
    flowDurationSec = (Date.now() - flowStarted) / 1000;
  } finally {
    await cleanupDrivers(redis, driverIds);
    await redis.quit();
  }

  const ok = flowResults.filter((r) => r?.ok);
  const fail = flowResults.length - ok.length;
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p = (q) => latencies.length ? latencies[Math.floor((latencies.length - 1) * q)] : 0;
  const errorTop = {};
  for (const r of flowResults) {
    if (!r?.ok) {
      const key = `${r.stage || 'unknown'}:${r.error || 'unknown'}`;
      errorTop[key] = (errorTop[key] || 0) + 1;
    }
  }

  const report = {
    scenario: {
      drivers: DRIVERS,
      passengers: PASSENGERS,
      ratio: `${DRIVERS}:${PASSENGERS}`,
      serverUrl: SERVER_URL,
      tokenConcurrency: TOKEN_CONCURRENCY,
      socketConcurrency: SOCKET_CONCURRENCY
    },
    tokenStats,
    seedStats,
    flow: {
      total: flowResults.length,
      success: ok.length,
      failed: fail,
      successRate: Number(((ok.length / Math.max(flowResults.length, 1)) * 100).toFixed(2)),
      durationSec: Number(flowDurationSec.toFixed(2)),
      throughputReqPerSec: Number((flowResults.length / Math.max(flowDurationSec, 0.001)).toFixed(2)),
      latencyMs: {
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
        max: latencies.length ? latencies[latencies.length - 1] : 0
      },
      topErrors: Object.entries(errorTop)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => ({ error: k, count: v }))
    },
    totalDurationSec: Number((((Date.now() - scenarioStarted) / 1000)).toFixed(2)),
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath: REPORT_PATH, ...report }, null, 2));
}

runScenario().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});

