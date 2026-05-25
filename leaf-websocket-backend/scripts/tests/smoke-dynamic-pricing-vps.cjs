#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');
const { runDynamicPricingEngine } = require('../../services/pricing');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const WS_URL = process.env.WS_URL || 'https://socket.62.169.31.231.sslip.io';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.62.169.31.231.sslip.io';
const VPS_IP = process.env.VPS_IP || '62.169.31.231';
const VPS_USER = process.env.VPS_USER || 'root';
const DEFAULT_SSH_KEY_CANDIDATES = [
  process.env.SSH_KEY_PATH,
  process.env.CONTABO_SSH_KEY_PATH,
  path.join(process.env.HOME || '', '.ssh/leaf_contabo_20260412_ed25519'),
  path.join(process.env.HOME || '', '.ssh/serafy_contabo_ed25519'),
  path.join(ROOT_DIR, '..', 'contabokey')
].filter(Boolean);
const SSH_KEY_PATH =
  process.env.SSH_KEY_PATH
  || DEFAULT_SSH_KEY_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_error) {
      return false;
    }
  })
  || path.join(process.env.HOME || '', '.ssh/leaf_contabo_20260412_ed25519');
const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const DRIVER_UID = process.env.TEST_DRIVER_UID || '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const ONLINE_MAX_ATTEMPTS = Number(process.env.ONLINE_MAX_ATTEMPTS || 5);

const PICKUP = { lat: -22.9075, lng: -43.1736, address: 'Centro - Rio de Janeiro' };
const DESTINATION = { lat: -22.9121, lng: -43.1825, address: 'Lapa - Rio de Janeiro' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function reportPath() {
  return path.join(REPORTS_DIR, `dynamic-pricing-smoke-vps-${Date.now()}.json`);
}

function writeReport(report, targetPath) {
  fs.writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`);
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

function sshCommand(script) {
  const args = [
    '-i', SSH_KEY_PATH,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=12',
    `${VPS_USER}@${VPS_IP}`,
    script
  ];
  return spawnSync('ssh', args, { encoding: 'utf8' });
}

function parseSshJsonResult(result) {
  if (result.error) {
    return { ok: false, error: result.error.message || String(result.error) };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || `ssh_exit_${result.status}`).trim()
    };
  }

  const raw = String(result.stdout || '').trim();
  if (!raw) return { ok: true };

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return { ok: true, raw };
  }
}

function cleanupRemotePassengerState({ bookingId = null, passengerId = PASSENGER_UID } = {}) {
  const remoteScript = `
container="$(docker ps --format '{{.Names}}' | grep -E 'leaf.*websocket|websocket' | head -n 1 || true)"
if [ -n "$container" ]; then
  docker exec "$container" node - '${passengerId}' '${bookingId || ''}' <<'NODE'
const redisPool = require('/app/utils/redis-pool');
(async () => {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const passengerId = process.argv[2];
  const explicitBookingId = process.argv[3] || null;

  async function scanKeys(pattern) {
    const keys = [];
    let cursor = '0';
    do {
      const reply = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = String(reply[0] || '0');
      for (const key of reply[1] || []) keys.push(key);
    } while (cursor !== '0');
    return keys;
  }

  async function cleanupBooking(bookingId) {
    if (!bookingId) return null;
    const bookingKey = 'booking:' + bookingId;
    const bookingData = await redis.hgetall(bookingKey);
    const searchKey = 'booking_search:' + bookingId;
    const searchData = await redis.hgetall(searchKey);
    const region = bookingData.region || bookingData.regionHash || searchData.region || searchData.regionHash || null;
    if (region) {
      await redis.zrem('ride_queue:' + region + ':pending', bookingId);
      await redis.hdel('ride_queue:' + region + ':active', bookingId);
    }
    await redis.hdel('bookings:active', bookingId);
    await redis.del(
      bookingKey,
      searchKey,
      'ride_notifications:' + bookingId,
      'ride_excluded_drivers:' + bookingId
    );
    return { bookingId, region };
  }

  const activeBookingId = await redis.get('customer_active_booking:' + passengerId);
  const candidateIds = new Set();
  if (explicitBookingId) candidateIds.add(explicitBookingId);
  if (activeBookingId) candidateIds.add(activeBookingId);

  const bookingKeys = await scanKeys('booking:*');
  for (const key of bookingKeys) {
    const customerId = await redis.hget(key, 'customerId');
    if (customerId === passengerId) {
      candidateIds.add(key.replace(/^booking:/, ''));
    }
  }

  const searchKeys = await scanKeys('booking_search:*');
  for (const key of searchKeys) {
    const customerId = await redis.hget(key, 'customerId');
    if (customerId === passengerId) {
      candidateIds.add(key.replace(/^booking_search:/, ''));
    }
  }

  const cleaned = [];
  for (const candidateId of candidateIds) {
    const result = await cleanupBooking(candidateId);
    if (result) cleaned.push(result);
  }

  await redis.del('customer_active_booking:' + passengerId);
  const remainingActiveBooking = await redis.get('customer_active_booking:' + passengerId);
  process.stdout.write(JSON.stringify({
    ok: true,
    via: 'container',
    passengerId,
    explicitBookingId,
    activeBookingId,
    cleaned,
    remainingActiveBooking
  }));
  process.exit(0);
})().catch((error) => {
  console.error(error && (error.stack || error.message) ? (error.stack || error.message) : String(error));
  process.exit(1);
});
NODE
else
  cd '/opt/leaf-app' && node - '${passengerId}' '${bookingId || ''}' <<'NODE'
const redisPool = require('./utils/redis-pool');
(async () => {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const passengerId = process.argv[2];
  const explicitBookingId = process.argv[3] || null;

  async function scanKeys(pattern) {
    const keys = [];
    let cursor = '0';
    do {
      const reply = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = String(reply[0] || '0');
      for (const key of reply[1] || []) keys.push(key);
    } while (cursor !== '0');
    return keys;
  }

  async function cleanupBooking(bookingId) {
    if (!bookingId) return null;
    const bookingKey = 'booking:' + bookingId;
    const bookingData = await redis.hgetall(bookingKey);
    const searchKey = 'booking_search:' + bookingId;
    const searchData = await redis.hgetall(searchKey);
    const region = bookingData.region || bookingData.regionHash || searchData.region || searchData.regionHash || null;
    if (region) {
      await redis.zrem('ride_queue:' + region + ':pending', bookingId);
      await redis.hdel('ride_queue:' + region + ':active', bookingId);
    }
    await redis.hdel('bookings:active', bookingId);
    await redis.del(
      bookingKey,
      searchKey,
      'ride_notifications:' + bookingId,
      'ride_excluded_drivers:' + bookingId
    );
    return { bookingId, region };
  }

  const activeBookingId = await redis.get('customer_active_booking:' + passengerId);
  const candidateIds = new Set();
  if (explicitBookingId) candidateIds.add(explicitBookingId);
  if (activeBookingId) candidateIds.add(activeBookingId);

  const bookingKeys = await scanKeys('booking:*');
  for (const key of bookingKeys) {
    const customerId = await redis.hget(key, 'customerId');
    if (customerId === passengerId) {
      candidateIds.add(key.replace(/^booking:/, ''));
    }
  }

  const searchKeys = await scanKeys('booking_search:*');
  for (const key of searchKeys) {
    const customerId = await redis.hget(key, 'customerId');
    if (customerId === passengerId) {
      candidateIds.add(key.replace(/^booking_search:/, ''));
    }
  }

  const cleaned = [];
  for (const candidateId of candidateIds) {
    const result = await cleanupBooking(candidateId);
    if (result) cleaned.push(result);
  }

  await redis.del('customer_active_booking:' + passengerId);
  const remainingActiveBooking = await redis.get('customer_active_booking:' + passengerId);
  process.stdout.write(JSON.stringify({
    ok: true,
    via: 'host',
    passengerId,
    explicitBookingId,
    activeBookingId,
    cleaned,
    remainingActiveBooking
  }));
  process.exit(0);
})().catch((error) => {
  console.error(error && (error.stack || error.message) ? (error.stack || error.message) : String(error));
  process.exit(1);
});
NODE
fi`;
  return parseSshJsonResult(sshCommand(remoteScript));
}

function onceStatusAck(driverClient, payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
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
    const ack = await onceStatusAck(driverClient, {
      status: 'online',
      isOnline: true,
      lat: PICKUP.lat + (attempt * 0.00001),
      lng: PICKUP.lng + (attempt * 0.00001),
      heading: (Date.now() / 100) % 360,
      speed: 0
    });

    if (ack.ok) return { success: true, attempts: attempt, ack: ack.data };

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

    return { success: false, attempts: attempt, error: ack.error };
  }

  return { success: false, attempts: ONLINE_MAX_ATTEMPTS, error: { code: 'ONLINE_RETRY_EXHAUSTED' } };
}

function createBookingWithTimeout(passengerClient, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('create_booking_timeout')), timeoutMs);

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

async function createBookingWithRetry(passengerClient, payload, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await createBookingWithTimeout(passengerClient, payload, 30000);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      const retriable = message.includes('Pagamento não confirmado') || message.includes('PAYMENT_NOT_CONFIRMED');
      if (!retriable || attempt === attempts) {
        throw error;
      }
      await sleep(2000);
    }
  }
  throw lastError || new Error('create_booking_retry_failed');
}

function nearlyEqual(left, right, epsilon = 0.01) {
  return Math.abs(Number(left) - Number(right)) <= epsilon;
}

async function cancelBooking(passengerClient, bookingId) {
  try {
    await passengerClient.cancelRide(bookingId, 'Smoke cleanup');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function createAuthenticatedClients() {
  const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });

  await passenger.connect();
  await driver.connect();
  await passenger.authenticate(PASSENGER_UID, 'customer');
  await driver.authenticate(DRIVER_UID, 'driver');

  return { passenger, driver };
}

function disconnectClients({ passenger, driver }) {
  try { passenger?.disconnect(); } catch (_error) {}
  try { driver?.disconnect(); } catch (_error) {}
}

function buildMockConfirmedPayment(finalPrice, scenarioKey) {
  const amountInCents = Math.round(Number(finalPrice) * 100);
  const rideId = `pricing_${scenarioKey}_${Date.now()}`;
  const chargeId = `mock_review_pricing_${scenarioKey}_${Date.now()}`;
  return { chargeId, rideId, amountInCents, mocked: true };
}

const SCENARIOS = [
  {
    key: 'normal',
    routeDistanceKm: 4,
    routeDurationSecs: 600,
    pricingContext: {
      trip: { eta_pickup_min: 3 },
      operational: {
        current: {
          active_requests_5m: 3,
          idle_drivers: 6,
          avg_pickup_eta_min: 3,
          trip_time_inflation: 1.05,
          cancel_rate: 0.04,
          accept_rate: 0.95,
          avg_speed_kmh: 26
        },
        baseline: {
          expected_requests_5m: 3,
          expected_idle_drivers: 6,
          expected_pickup_eta_min: 3,
          expected_speed_kmh: 26,
          expected_cancel_rate: 0.04
        },
        state_context: {
          now: '2026-03-29T09:00:00.000Z'
        }
      }
    }
  },
  {
    key: 'pressao',
    routeDistanceKm: 6,
    routeDurationSecs: 1080,
    pricingContext: {
      trip: { eta_pickup_min: 6 },
      operational: {
        current: {
          active_requests_5m: 8,
          idle_drivers: 4,
          avg_pickup_eta_min: 6,
          trip_time_inflation: 1.3,
          cancel_rate: 0.08,
          accept_rate: 0.82,
          avg_speed_kmh: 18
        },
        baseline: {
          expected_requests_5m: 6,
          expected_idle_drivers: 5,
          expected_pickup_eta_min: 4,
          expected_speed_kmh: 24,
          expected_cancel_rate: 0.05
        },
        state_context: {
          now: '2026-03-29T10:05:00.000Z',
          previous_state: 'NORMAL',
          recent_exception_history: [
            { timestamp: '2026-03-29T10:00:00.000Z', score_excecao: 0.36 },
            { timestamp: '2026-03-29T10:03:00.000Z', score_excecao: 0.41 }
          ]
        }
      }
    }
  },
  {
    key: 'excepcional',
    routeDistanceKm: 9,
    routeDurationSecs: 1800,
    pricingContext: {
      trip: { eta_pickup_min: 9 },
      operational: {
        current: {
          active_requests_5m: 25,
          idle_drivers: 2,
          avg_pickup_eta_min: 12,
          trip_time_inflation: 1.6,
          cancel_rate: 0.24,
          accept_rate: 0.45,
          avg_speed_kmh: 9
        },
        baseline: {
          expected_requests_5m: 10,
          expected_idle_drivers: 8,
          expected_pickup_eta_min: 4,
          expected_speed_kmh: 24,
          expected_cancel_rate: 0.08
        },
        state_context: {
          now: '2026-03-29T23:06:00.000Z',
          previous_state: 'PRESSAO',
          recent_exception_history: [
            { timestamp: '2026-03-29T23:00:00.000Z', score_excecao: 0.68 },
            { timestamp: '2026-03-29T23:03:00.000Z', score_excecao: 0.72 }
          ],
          degraded_neighbor_count: 4
        }
      }
    }
  }
];

async function runScenario({ scenario }) {
  const preCleanup = cleanupRemotePassengerState();
  assert(preCleanup.ok, `pre_cleanup_failed_${scenario.key}:${preCleanup.error || 'unknown'}`);

  const clients = await createAuthenticatedClients();
  const { passenger, driver } = clients;

  let bookingId = null;
  const online = await ensureDriverOnline(driver);
  assert(online.success, `driver_online_failed_${scenario.key}:${online.error?.code || 'unknown'}`);

  try {
    const expected = runDynamicPricingEngine({
      trip: {
        distance_km: scenario.routeDistanceKm,
        duration_min_traffic: scenario.routeDurationSecs / 60,
        eta_pickup_min: scenario.pricingContext.trip.eta_pickup_min
      },
      operational: scenario.pricingContext.operational
    }).pricingPayload;

    const payment = buildMockConfirmedPayment(expected.final_price, scenario.key);

    const bookingPayload = {
      customerId: PASSENGER_UID,
      pickupLocation: PICKUP,
      destinationLocation: DESTINATION,
      estimatedFare: expected.final_price,
      routeDistanceKm: scenario.routeDistanceKm,
      routeDurationSecs: scenario.routeDurationSecs,
      paymentMethod: 'pix',
      paymentStatus: 'confirmed',
      paymentData: {
        chargeId: payment.chargeId,
        rideId: payment.rideId,
        amountInCents: payment.amountInCents
      },
      idempotencyKey: `pricing_${scenario.key}_${Date.now()}`,
      pricingContext: scenario.pricingContext
    };

    const bookingResponse = await createBookingWithRetry(passenger, bookingPayload, 5);

    bookingId = bookingResponse?.bookingId || bookingResponse?.data?.bookingId;
    assert(bookingId, `booking_id_missing_${scenario.key}`);

    await sleep(600);
    const pricingPayload = bookingResponse?.data?.pricingPayload || {};

    assert(pricingPayload.final_price, `pricing_payload_missing_${scenario.key}`);
    assert(pricingPayload.operational_state === expected.operational_state, `state_mismatch_${scenario.key}`);
    assert(nearlyEqual(pricingPayload.final_price, expected.final_price), `final_price_mismatch_${scenario.key}`);
    assert(nearlyEqual(Number(bookingResponse?.data?.estimatedFare || 0), expected.final_price), `estimated_fare_mismatch_${scenario.key}`);
    assert(nearlyEqual(Number(bookingResponse?.data?.scorePressao || 0), expected.score_pressao, 0.001), `score_pressao_mismatch_${scenario.key}`);
    assert(nearlyEqual(Number(bookingResponse?.data?.scoreExcecao || 0), expected.score_excecao, 0.001), `score_excecao_mismatch_${scenario.key}`);

    const cleanup = await cancelBooking(passenger, bookingId);
    const remoteCleanup = cleanupRemotePassengerState({ bookingId });

    await sleep(1200);

    return {
      scenario: scenario.key,
      driverOnline: online,
      bookingId,
      bookingResponse,
      payment,
      emittedData: {
        estimatedFare: Number(bookingResponse?.data?.estimatedFare || 0),
        operationalState: bookingResponse?.data?.operationalState || null,
        scorePressao: Number(bookingResponse?.data?.scorePressao || 0),
        scoreExcecao: Number(bookingResponse?.data?.scoreExcecao || 0)
      },
      expected,
      actual: pricingPayload,
      cleanup: {
        local: cleanup,
        remote: remoteCleanup
      }
    };
  } finally {
    if (bookingId) {
      cleanupRemotePassengerState({ bookingId });
    } else {
      cleanupRemotePassengerState();
    }
    disconnectClients(clients);
  }
}

async function main() {
  const outputPath = reportPath();
  const report = {
    meta: {
      startedAt: new Date().toISOString(),
      wsUrl: WS_URL,
      apiBaseUrl: API_BASE_URL,
      passengerUid: PASSENGER_UID,
      driverUid: DRIVER_UID,
      outputPath
    },
    scenarios: [],
    status: 'running'
  };

  try {
    const initialCleanup = cleanupRemotePassengerState();
    assert(initialCleanup.ok, `initial_cleanup_failed:${initialCleanup.error || 'unknown'}`);
    report.meta.initialCleanup = initialCleanup;

    for (const scenario of SCENARIOS) {
      const scenarioReport = await runScenario({ scenario });
      report.scenarios.push(scenarioReport);
    }

    report.status = 'ok';
    report.meta.finishedAt = new Date().toISOString();
    writeReport(report, outputPath);
    console.log(JSON.stringify({
      ok: true,
      outputPath,
      scenarios: report.scenarios.map((item) => ({
        scenario: item.scenario,
        bookingId: item.bookingId,
        finalPrice: item.actual.final_price,
        state: item.actual.operational_state
      }))
    }, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    report.meta.finishedAt = new Date().toISOString();
    writeReport(report, outputPath);
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      outputPath
    }, null, 2));
    process.exitCode = 1;
  }
}

main();
