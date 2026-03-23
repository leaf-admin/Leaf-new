#!/usr/bin/env node
/**
 * Isolated location/presence benchmark for websocket backend.
 *
 * Scenarios:
 * - update_location: emits updateLocation and waits for locationUpdated ack
 * - heartbeat: emits driverHeartbeat without ack dependency
 * - mixed: alternates between update_location and heartbeat
 */

const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const { createClient } = require('redis');
const { getIdTokenForUid } = require('../../tests/e2e/backend/__helpers__/firebase-id-token');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

const URL = arg('--url', 'http://127.0.0.1:3001');
const MODE = String(arg('--mode', 'update_location')).toLowerCase(); // update_location | heartbeat | mixed
const DRIVERS = Math.max(1, Number.parseInt(arg('--drivers', '120'), 10));
const UPDATES_PER_DRIVER = Math.max(1, Number.parseInt(arg('--updates-per-driver', '30'), 10));
const CONNECT_CONCURRENCY = Math.max(1, Number.parseInt(arg('--connect-concurrency', '30'), 10));
const TOKEN_CONCURRENCY = Math.max(1, Number.parseInt(arg('--token-concurrency', '60'), 10));
const INTERVAL_MS = Math.max(0, Number.parseInt(arg('--interval-ms', '120'), 10));
const ACK_TIMEOUT_MS = Math.max(1000, Number.parseInt(arg('--ack-timeout-ms', '5000'), 10));
const REDIS_URL = arg('--redis-url', process.env.REDIS_URL || 'redis://:leaf_redis_2024@redis:6379/0');
const REPORT_PATH = arg('--report', path.join(__dirname, `../../stress-test-location-presence-${Date.now()}.json`));
const ELIGIBLE_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
const UID_PREFIX = arg('--uid-prefix', `iso_loc_${Date.now()}`);
const BASE_LAT = Number.parseFloat(arg('--base-lat', '-22.9068'));
const BASE_LNG = Number.parseFloat(arg('--base-lng', '-43.1729'));
const SPREAD = Number.parseFloat(arg('--spread', '0.03'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

async function withConcurrency(items, concurrency, worker) {
  const out = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await worker(items[i], i);
      } catch (error) {
        out[i] = { ok: false, error: error?.message || String(error) };
      }
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(runners);
  return out;
}

function randomNear(baseLat, baseLng, spread) {
  return {
    lat: baseLat + (Math.random() - 0.5) * spread,
    lng: baseLng + (Math.random() - 0.5) * spread
  };
}

async function connectAndAuthDriver(entry) {
  const socket = io(URL, {
    transports: ['websocket', 'polling'],
    timeout: 20000,
    reconnection: false,
    forceNew: true,
    auth: { token: entry.idToken }
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect_timeout')), 20000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(error?.message || 'connect_error'));
    });
  });

  socket.emit('authenticate', { uid: entry.uid, userType: 'driver', token: entry.idToken });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('auth_timeout')), 20000);
    socket.once('authenticated', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('auth_error', (error) => {
      clearTimeout(timer);
      reject(new Error(error?.message || 'auth_error'));
    });
    socket.once('authentication_error', (error) => {
      clearTimeout(timer);
      reject(new Error(error?.message || 'authentication_error'));
    });
  });

  return socket;
}

async function preseedDriverState(redis, driverId, location) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const hashKey = `driver:${driverId}`;

  await redis.hSet(hashKey, {
    id: driverId,
    userType: 'driver',
    status: 'AVAILABLE',
    isOnline: 'true',
    lat: String(location.lat),
    lng: String(location.lng),
    heading: '0',
    speed: '0',
    lastUpdate: String(now),
    timestamp: String(now),
    lastSeen: nowIso,
    updatedAt: nowIso,
    driverApproved: 'true',
    vehicleApproved: 'true',
    dispatchEligible: 'true',
    dispatchEligibilityCode: 'ELIGIBLE',
    vehicleLockValidated: 'true',
    vehicleLockValidatedAt: nowIso,
    vehiclePlate: `ISO-${driverId.slice(-6).toUpperCase()}`,
    carType: 'leaf_plus'
  });

  await redis.geoAdd('driver_locations', {
    longitude: location.lng,
    latitude: location.lat,
    member: driverId
  });
  await redis.geoAdd(ELIGIBLE_GEO_KEY, {
    longitude: location.lng,
    latitude: location.lat,
    member: driverId
  });
  await redis.expire(hashKey, 120);
}

async function waitLocationAck(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location_ack_timeout')), ACK_TIMEOUT_MS);
    socket.once('locationUpdated', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error?.message || 'location_error'));
    });
    socket.once('locationError', (error) => {
      clearTimeout(timer);
      reject(new Error(error?.message || 'location_error'));
    });
  });
}

async function runDriverLoop(entry, socket) {
  const latencies = [];
  let sent = 0;
  let acked = 0;
  let failed = 0;
  let lastLocation = { ...entry.location };

  for (let i = 0; i < UPDATES_PER_DRIVER; i += 1) {
    const jitterLat = (Math.random() - 0.5) * 0.0008;
    const jitterLng = (Math.random() - 0.5) * 0.0008;
    lastLocation = {
      lat: Number((lastLocation.lat + jitterLat).toFixed(6)),
      lng: Number((lastLocation.lng + jitterLng).toFixed(6))
    };

    const now = Date.now();
    const useHeartbeat = MODE === 'heartbeat' || (MODE === 'mixed' && i % 2 === 1);

    try {
      if (useHeartbeat) {
        socket.emit('driverHeartbeat', {
          uid: entry.uid,
          lat: lastLocation.lat,
          lng: lastLocation.lng,
          tripStatus: 'available',
          isInTrip: false
        });
        sent += 1;
      } else {
        const t0 = Date.now();
        socket.emit('updateLocation', {
          uid: entry.uid,
          lat: lastLocation.lat,
          lng: lastLocation.lng,
          heading: 0,
          speed: 0,
          timestamp: now,
          tripStatus: 'available',
          isInTrip: false
        });
        sent += 1;
        await waitLocationAck(socket);
        acked += 1;
        latencies.push(Date.now() - t0);
      }
    } catch (_error) {
      failed += 1;
    }

    if (INTERVAL_MS > 0) {
      await sleep(INTERVAL_MS);
    }
  }

  return { sent, acked, failed, latencies };
}

async function main() {
  if (!['update_location', 'heartbeat', 'mixed'].includes(MODE)) {
    throw new Error(`invalid_mode:${MODE}`);
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const uids = Array.from({ length: DRIVERS }, (_, i) => `${UID_PREFIX}_driver_${i}`);

  const tokenStartedMs = Date.now();
  const tokenResults = await withConcurrency(uids, TOKEN_CONCURRENCY, async (uid) => {
    const idToken = await getIdTokenForUid(uid);
    return { ok: true, uid, idToken };
  });
  const tokenDurationSec = Number(((Date.now() - tokenStartedMs) / 1000).toFixed(2));

  const validEntries = tokenResults
    .filter((row) => row?.ok && row?.uid && row?.idToken)
    .map((row) => ({
      uid: row.uid,
      idToken: row.idToken,
      location: randomNear(BASE_LAT, BASE_LNG, SPREAD)
    }));

  const redis = createClient({ url: REDIS_URL });
  await redis.connect();

  await withConcurrency(validEntries, CONNECT_CONCURRENCY, async (entry) => {
    await preseedDriverState(redis, entry.uid, entry.location);
    return { ok: true };
  });

  const connectResults = await withConcurrency(validEntries, CONNECT_CONCURRENCY, async (entry) => {
    const socket = await connectAndAuthDriver(entry);
    return { ok: true, entry, socket };
  });

  const connected = connectResults.filter((row) => row?.ok && row?.socket);
  const connectedEntries = connected.map((row) => row.entry);

  const loopStartedMs = Date.now();
  const loopResults = await withConcurrency(connected, CONNECT_CONCURRENCY, async (row) => {
    const loopResult = await runDriverLoop(row.entry, row.socket);
    return { ok: true, ...loopResult };
  });
  const loopDurationSec = Number(((Date.now() - loopStartedMs) / 1000).toFixed(2));

  for (const row of connected) {
    try {
      row.socket.disconnect();
    } catch (_error) {
      // ignore
    }
  }

  // Cleanup best effort
  try {
    await withConcurrency(connectedEntries, CONNECT_CONCURRENCY, async (entry) => {
      await redis.del(`driver:${entry.uid}`);
      await redis.zRem('driver_locations', entry.uid);
      await redis.zRem(ELIGIBLE_GEO_KEY, entry.uid);
      await redis.zRem('driver_offline_locations', entry.uid);
      return { ok: true };
    });
  } catch (_error) {
    // ignore cleanup errors
  }

  await redis.quit().catch(() => {});

  const okLoops = loopResults.filter((row) => row?.ok);
  const totalSent = okLoops.reduce((acc, row) => acc + (row.sent || 0), 0);
  const totalAcked = okLoops.reduce((acc, row) => acc + (row.acked || 0), 0);
  const totalFailed = okLoops.reduce((acc, row) => acc + (row.failed || 0), 0);
  const latencyValues = okLoops.flatMap((row) => row.latencies || []).sort((a, b) => a - b);
  const totalAttempted = connected.length * UPDATES_PER_DRIVER;

  const report = {
    config: {
      mode: MODE,
      url: URL,
      driversRequested: DRIVERS,
      updatesPerDriver: UPDATES_PER_DRIVER,
      connectConcurrency: CONNECT_CONCURRENCY,
      tokenConcurrency: TOKEN_CONCURRENCY,
      intervalMs: INTERVAL_MS,
      ackTimeoutMs: ACK_TIMEOUT_MS,
      redisUrl: REDIS_URL,
      eligibleGeoKey: ELIGIBLE_GEO_KEY
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    tokenGeneration: {
      total: uids.length,
      success: validEntries.length,
      failed: uids.length - validEntries.length,
      durationSec: tokenDurationSec
    },
    results: {
      connectedDrivers: connected.length,
      failedConnections: validEntries.length - connected.length,
      attemptedUpdates: totalAttempted,
      sentUpdates: totalSent,
      ackedUpdates: totalAcked,
      failedUpdates: totalFailed,
      successRate: Number(((totalSent > 0 ? (totalSent - totalFailed) / totalSent : 0) * 100).toFixed(2)),
      durationSec: loopDurationSec,
      throughputUpdatesPerSec: Number((totalSent / Math.max(loopDurationSec, 0.001)).toFixed(2)),
      latencyMs: {
        p50: percentile(latencyValues, 0.5),
        p95: percentile(latencyValues, 0.95),
        p99: percentile(latencyValues, 0.99),
        max: latencyValues.length ? latencyValues[latencyValues.length - 1] : 0
      }
    },
    totalDurationSec: Number(((Date.now() - startedMs) / 1000).toFixed(2))
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ reportPath: REPORT_PATH, ...report }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
