#!/usr/bin/env node
/**
 * Presence capacity test:
 * - Opens many authenticated sockets (drivers + passengers)
 * - Keeps them online for a hold window
 * - Reports auth/connect success and steady-state connected sockets
 *
 * Usage:
 *   node tmp/socket-presence-capacity-vps.cjs --url http://147.182.204.181:3001 --drivers 300 --passengers 300 --hold-ms 20000
 */

const WebSocketTestClient = require('../tests/e2e/backend/__helpers__/websocket-test-client');
const { getIdTokenForUid } = require('../tests/e2e/backend/__helpers__/firebase-id-token');

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
}

const WS_URL = arg('--url', process.env.WS_URL || 'http://147.182.204.181:3001');
const DRIVERS = Number.parseInt(arg('--drivers', process.env.DRIVERS || '100'), 10);
const PASSENGERS = Number.parseInt(arg('--passengers', process.env.PASSENGERS || '100'), 10);
const TOKEN_CONCURRENCY = Number.parseInt(arg('--token-concurrency', process.env.TOKEN_CONCURRENCY || '40'), 10);
const SOCKET_CONCURRENCY = Number.parseInt(arg('--socket-concurrency', process.env.SOCKET_CONCURRENCY || '80'), 10);
const HOLD_MS = Number.parseInt(arg('--hold-ms', process.env.HOLD_MS || '15000'), 10);
const BASE_LAT = Number.parseFloat(arg('--base-lat', '-22.9068'));
const BASE_LNG = Number.parseFloat(arg('--base-lng', '-43.1729'));

function nowMs() {
  return Date.now();
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
        results[i] = { ok: false, error: error.message || String(error) };
      }
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(runners);
  return results;
}

function randomLocation(i) {
  return {
    lat: BASE_LAT + ((i % 40) * 0.001),
    lng: BASE_LNG + (Math.floor(i / 40) * 0.001)
  };
}

async function main() {
  const started = nowMs();
  const driverUids = Array.from({ length: DRIVERS }, (_, i) => `cap_presence_d_${started}_${i}`);
  const passengerUids = Array.from({ length: PASSENGERS }, (_, i) => `cap_presence_p_${started}_${i}`);
  const users = driverUids.map((uid) => ({ uid, userType: 'driver' }))
    .concat(passengerUids.map((uid) => ({ uid, userType: 'customer' })));

  const tokenStarted = nowMs();
  const tokenResults = await withConcurrency(users, TOKEN_CONCURRENCY, async (entry) => {
    const token = await getIdTokenForUid(entry.uid);
    return { ok: true, uid: entry.uid, userType: entry.userType, token };
  });
  const tokenMs = nowMs() - tokenStarted;

  const okTokens = tokenResults.filter((r) => r?.ok);
  const tokenFail = tokenResults.length - okTokens.length;

  const tokenMap = new Map(okTokens.map((t) => [`${t.userType}:${t.uid}`, t.token]));
  const targets = users.filter((u) => tokenMap.has(`${u.userType}:${u.uid}`));

  const clients = [];
  const connectStarted = nowMs();
  const connectResults = await withConcurrency(targets, SOCKET_CONCURRENCY, async (entry, i) => {
    const token = tokenMap.get(`${entry.userType}:${entry.uid}`);
    const c = new WebSocketTestClient(WS_URL, {
      transports: ['websocket'],
      timeout: 30000,
      reconnection: false
    });

    const t0 = nowMs();
    await c.connect();
    await c.authenticate(entry.uid, entry.userType, { token });
    const authMs = nowMs() - t0;
    c.userType = entry.userType;

    if (entry.userType === 'driver') {
      const loc = randomLocation(i);
      c.socket.emit('setDriverStatus', { status: 'available', isOnline: true });
      c.socket.emit('updateLocation', {
        lat: loc.lat,
        lng: loc.lng,
        tripStatus: 'idle',
        isInTrip: false,
        seq: nowMs() % 100000
      });
    }

    clients.push(c);
    return { ok: true, userType: entry.userType, uid: entry.uid, authMs };
  });
  const connectMs = nowMs() - connectStarted;

  const okConnect = connectResults.filter((r) => r?.ok);
  const failedConnect = connectResults.length - okConnect.length;
  const authLat = okConnect.map((r) => r.authMs).sort((a, b) => a - b);
  const p = (q) => authLat.length ? authLat[Math.floor((authLat.length - 1) * q)] : 0;

  await sleep(HOLD_MS);

  let connectedNow = 0;
  let connectedDriversNow = 0;
  let connectedPassengersNow = 0;
  for (const c of clients) {
    if (c?.socket?.connected) {
      connectedNow += 1;
      if (c.userType === 'driver') connectedDriversNow += 1;
      else if (c.userType === 'customer') connectedPassengersNow += 1;
    }
  }

  for (const c of clients) {
    try { c.disconnect(); } catch (_) {}
  }

  const report = {
    config: {
      wsUrl: WS_URL,
      drivers: DRIVERS,
      passengers: PASSENGERS,
      totalRequested: DRIVERS + PASSENGERS,
      tokenConcurrency: TOKEN_CONCURRENCY,
      socketConcurrency: SOCKET_CONCURRENCY,
      holdMs: HOLD_MS
    },
    tokenGeneration: {
      requested: users.length,
      success: okTokens.length,
      failed: tokenFail,
      durationMs: tokenMs
    },
    socketPresence: {
      attempted: targets.length,
      success: okConnect.length,
      failed: failedConnect,
      successRate: Number(((okConnect.length / Math.max(targets.length, 1)) * 100).toFixed(2)),
      connectPhaseDurationMs: connectMs,
      authLatencyMs: {
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
        max: authLat.length ? authLat[authLat.length - 1] : 0
      },
      connectedAfterHold: {
        total: connectedNow,
        drivers: connectedDriversNow,
        passengers: connectedPassengersNow
      }
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
