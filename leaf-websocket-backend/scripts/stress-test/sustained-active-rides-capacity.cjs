#!/usr/bin/env node
/**
 * Production-like sustained active rides capacity test.
 *
 * Goals:
 * - Keep a target number of ACTIVE rides per time window
 * - Respect real business gates (driver online/eligible in region, payment confirmation)
 * - Auto-handle common lock/failure scenarios (payment blocked by no partner, stale locks)
 * - Produce an actionable report for current infra sizing and future capacity planning
 *
 * Example:
 *   node scripts/stress-test/sustained-active-rides-capacity.cjs \
 *     --url https://api.147.182.204.181.sslip.io \
 *     --drivers 120 \
 *     --passengers 150 \
 *     --profile production
 *
 * Custom windows format:
 *   --windows "warmup:180:20:180:300,normal:300:35:240:420,peak:420:55:300:540,cooldown:180:20:180:300"
 *   Segment = name:durationSec:targetActive:rideMinSec:rideMaxSec
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');
const { getIdTokenForUid } = require('../../tests/e2e/backend/__helpers__/firebase-id-token');

const argv = process.argv.slice(2);

function arg(name, fallback = '') {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : fallback;
}

function argInt(name, fallback) {
  const value = Number.parseInt(arg(name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}

function argFloat(name, fallback) {
  const value = Number.parseFloat(arg(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function argBool(name, fallback = false) {
  const raw = String(arg(name, fallback ? 'true' : 'false')).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function usage() {
  const help = `
Sustained Active Rides Capacity

Required (recommended):
  --url <ws-url>                         WebSocket base URL

Pool setup:
  --drivers <n>                          Number of driver sessions (default: 40)
  --passengers <n>                       Number of passenger sessions (default: drivers)
  --driver-uids <csv>                    Optional fixed driver UIDs
  --passenger-uids <csv>                 Optional fixed passenger UIDs
  --driver-uids-file <path>              Optional text file (one UID per line) for drivers
  --passenger-uids-file <path>           Optional text file (one UID per line) for passengers
  --uid-prefix <prefix>                  Prefix for generated UIDs

Scenario profile:
  --profile <production|quick>           Window preset (default: production)
  --windows "<spec>"                     Override windows.
                                         Format: name:durationSec:targetActive:rideMinSec:rideMaxSec,...

Runtime controls:
  --token-concurrency <n>                Firebase token generation concurrency (default: 20)
  --connect-concurrency <n>              Socket connect/auth concurrency (default: 20)
  --readiness-concurrency <n>            Driver readiness checks concurrency (default: 16)
  --max-start-concurrency <n>            Max parallel ride starts (default: 12)
  --max-complete-concurrency <n>         Max parallel ride completes (default: 12)
  --loop-tick-ms <n>                     Main loop tick (default: 250)
  --heartbeat-ms <n>                     Driver location heartbeat (default: 1200)
  --payment-retries <n>                  confirmPayment retries (default: 4)
  --dispatch-timeout-ms <n>              Wait for newRideRequest (default: 45000)
  --readiness-timeout-ms <n>             Wait for canReceiveRequests (default: 30000)
  --pre-booking-readiness-recheck-ms <n> Revalidar readiness antes do booking quando stale (default: 0 = desabilitado)
  --drain-timeout-ms <n>                 End-of-test drain timeout (default: 300000)
  --strict-ready <true|false>            Exclude drivers that never become ready (default: true)
  --force-real-payment <true|false>      Enforce mockPayment=false (default: true)
  --mock-complete-payment <true|false>   Use mock on completeTrip only (default: true)
  --provision-driver-vehicles <bool>     Provision test drivers with active approved vehicle (default: true)
  --provision-concurrency <n>            Provision concurrency (default: 24)

Geo setup:
  --base-lat <value>                     Base latitude (default: -22.9068)
  --base-lng <value>                     Base longitude (default: -43.1729)
  --spread-lat <value>                   Driver pool spread in lat (default: 0.06)
  --spread-lng <value>                   Driver pool spread in lng (default: 0.08)

Output:
  --report-path <path>                   Optional report path (json)
  --quiet <true|false>                   Less console logs
`;
  process.stdout.write(help.trimStart());
}

if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}

const WS_URL = arg('--url', process.env.WS_URL || 'http://127.0.0.1:3001');
const HTTP_BASE = wsToHttp(WS_URL);
const DRIVER_COUNT = Math.max(1, argInt('--drivers', Number.parseInt(process.env.STRESS_DRIVERS || '40', 10)));
const PASSENGER_COUNT = Math.max(
  1,
  argInt('--passengers', Number.parseInt(process.env.STRESS_PASSENGERS || String(DRIVER_COUNT), 10))
);
const UID_PREFIX = arg('--uid-prefix', `capacity_${Date.now()}`);
const PROFILE = arg('--profile', 'production');
const TOKEN_CONCURRENCY = Math.max(1, argInt('--token-concurrency', 20));
const CONNECT_CONCURRENCY = Math.max(1, argInt('--connect-concurrency', 20));
const READINESS_CONCURRENCY = Math.max(1, argInt('--readiness-concurrency', 16));
const MAX_START_CONCURRENCY = Math.max(1, argInt('--max-start-concurrency', 12));
const MAX_COMPLETE_CONCURRENCY = Math.max(1, argInt('--max-complete-concurrency', 12));
const HEARTBEAT_MS = Math.max(500, argInt('--heartbeat-ms', 1200));
const LOOP_TICK_MS = Math.max(80, argInt('--loop-tick-ms', 250));
const PAYMENT_RETRIES = Math.max(1, argInt('--payment-retries', 4));
const DISPATCH_TIMEOUT_MS = Math.max(8000, argInt('--dispatch-timeout-ms', 45000));
const READINESS_TIMEOUT_MS = Math.max(5000, argInt('--readiness-timeout-ms', 30000));
const PRE_BOOKING_READINESS_RECHECK_MS = Math.max(0, argInt('--pre-booking-readiness-recheck-ms', 0));
const DRAIN_TIMEOUT_MS = Math.max(10000, argInt('--drain-timeout-ms', 300000));
const STRICT_READY = argBool('--strict-ready', true);
const FORCE_REAL_PAYMENT = argBool('--force-real-payment', true);
const MOCK_COMPLETE_PAYMENT = argBool('--mock-complete-payment', true);
const PROVISION_DRIVER_VEHICLES = argBool('--provision-driver-vehicles', true);
const PROVISION_CONCURRENCY = Math.max(1, argInt('--provision-concurrency', 24));
const BASE_LAT = argFloat('--base-lat', -22.9068);
const BASE_LNG = argFloat('--base-lng', -43.1729);
const SPREAD_LAT = argFloat('--spread-lat', 0.06);
const SPREAD_LNG = argFloat('--spread-lng', 0.08);
const QUIET = argBool('--quiet', false);

const windows = parseWindows(arg('--windows', ''), PROFILE);

const reportPath = arg(
  '--report-path',
  path.join(
    __dirname,
    '../../reports',
    `sustained-active-rides-${Date.now()}.json`
  )
);

const state = {
  drivers: [],
  passengers: [],
  activeRides: new Map(),
  inflightStarts: new Set(),
  inflightCompletes: new Set(),
  driverCursor: 0,
  passengerCursor: 0,
  runningWindow: null,
  httpClient: axios.create({
    baseURL: HTTP_BASE,
    timeout: 8000
  }),
  report: {
    startedAt: new Date().toISOString(),
    config: {
      wsUrl: WS_URL,
      httpBase: HTTP_BASE,
      profile: PROFILE,
      forceRealPayment: FORCE_REAL_PAYMENT,
      mockCompletePayment: MOCK_COMPLETE_PAYMENT,
      provisionDriverVehicles: PROVISION_DRIVER_VEHICLES,
      strictReady: STRICT_READY,
      loopTickMs: LOOP_TICK_MS,
      heartbeatMs: HEARTBEAT_MS,
      paymentRetries: PAYMENT_RETRIES,
      dispatchTimeoutMs: DISPATCH_TIMEOUT_MS,
      readinessTimeoutMs: READINESS_TIMEOUT_MS,
      preBookingReadinessRecheckMs: PRE_BOOKING_READINESS_RECHECK_MS,
      drainTimeoutMs: DRAIN_TIMEOUT_MS
    },
    pool: {
      requested: {
        drivers: DRIVER_COUNT,
        passengers: PASSENGER_COUNT
      },
      connected: {
        drivers: 0,
        passengers: 0
      },
      readyDrivers: 0
    },
    windows: [],
    metrics: {
      startedRides: 0,
      completedRides: 0,
      failedStarts: 0,
      failedCompletes: 0,
      paymentBlockedRetries: 0,
      paymentBlockedHardFails: 0,
      noDriverCapacityMisses: 0,
      noPassengerCapacityMisses: 0,
      latencyMs: {
        createBooking: [],
        confirmPayment: [],
        bookingToDispatch: [],
        acceptRide: [],
        startTrip: [],
        tripDuration: [],
        completeTrip: [],
        fullFlowToStart: []
      },
      errors: {},
      errorSamples: {}
    },
    notes: []
  }
};

function wsToHttp(raw) {
  if (raw.startsWith('ws://')) return `http://${raw.replace(/^ws:\/\//, '')}`;
  if (raw.startsWith('wss://')) return `https://${raw.replace(/^wss:\/\//, '')}`;
  return raw;
}

function canUseFirebaseProvisioning() {
  const hasJsonEnv =
    Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  if (hasJsonEnv) return true;
  const serviceAccountPath = path.join(
    __dirname,
    '../../leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json'
  );
  return fs.existsSync(serviceAccountPath);
}

function logLine(line) {
  if (!QUIET) {
    process.stdout.write(`${line}\n`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs() {
  return Date.now();
}

async function withTimeout(promise, timeoutMs, label = 'operation_timeout') {
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(label)), timeoutMs);
    timeoutHandle.unref?.();
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function waitAllSettledWithTimeout(promises, timeoutMs, label = 'inflight') {
  const list = Array.from(promises || []).filter(Boolean);
  if (!list.length) return { completed: true, total: 0 };

  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ timeout: true }), timeoutMs);
    timeoutHandle.unref?.();
  });

  const settlePromise = Promise.allSettled(list).then(() => ({ timeout: false }));
  const result = await Promise.race([settlePromise, timeoutPromise]);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (result?.timeout) {
    state.report.notes.push(
      `Timeout aguardando ${label} promises (${list.length}) após ${timeoutMs}ms; seguindo com finalização.`
    );
    return { completed: false, total: list.length };
  }

  return { completed: true, total: list.length };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function summarizeLatency(values) {
  if (!values.length) {
    return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    avg: Number((sum / sorted.length).toFixed(2))
  };
}

function topErrorPairs(errorMap, limit = 3) {
  return Object.entries(errorMap || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function formatErrorPairs(errorMap, limit = 3) {
  const pairs = topErrorPairs(errorMap, limit);
  if (!pairs.length) return 'none';
  return pairs.map(([key, count]) => `${key}:${count}`).join(', ');
}

function parseCsvList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function readUidFile(filePath) {
  if (!filePath) return [];
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`UID file not found: ${absolutePath}`);
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function buildUidPool(kind, requestedCount) {
  const listArg = kind === 'driver' ? '--driver-uids' : '--passenger-uids';
  const fileArg = kind === 'driver' ? '--driver-uids-file' : '--passenger-uids-file';
  const rawList = parseCsvList(arg(listArg, ''));
  const fileList = readUidFile(arg(fileArg, ''));
  const fixed = rawList.concat(fileList).filter(Boolean);
  const dedup = Array.from(new Set(fixed));

  if (dedup.length >= requestedCount) {
    return dedup.slice(0, requestedCount);
  }

  const generated = dedup.slice();
  const prefix = `${UID_PREFIX}_${kind}`;
  let index = 0;
  while (generated.length < requestedCount) {
    generated.push(`${prefix}_${index++}`);
  }
  return generated;
}

function parseWindows(rawWindows, profileName) {
  if (rawWindows) {
    return rawWindows
      .split(',')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk, index) => {
        const parts = chunk.split(':').map((item) => item.trim());
        if (parts.length !== 5) {
          throw new Error(`Invalid --windows segment #${index + 1}: "${chunk}"`);
        }

        const [name, durationRaw, targetRaw, minRaw, maxRaw] = parts;
        const durationSec = Number.parseInt(durationRaw, 10);
        const targetActive = Number.parseInt(targetRaw, 10);
        const rideMinSec = Number.parseInt(minRaw, 10);
        const rideMaxSec = Number.parseInt(maxRaw, 10);

        if (
          !name ||
          !Number.isFinite(durationSec) ||
          !Number.isFinite(targetActive) ||
          !Number.isFinite(rideMinSec) ||
          !Number.isFinite(rideMaxSec) ||
          durationSec <= 0 ||
          targetActive < 0 ||
          rideMinSec <= 0 ||
          rideMaxSec < rideMinSec
        ) {
          throw new Error(`Invalid --windows segment values: "${chunk}"`);
        }

        return { name, durationSec, targetActive, rideMinSec, rideMaxSec };
      });
  }

  if (profileName === 'quick') {
    return [
      { name: 'warmup', durationSec: 60, targetActive: 6, rideMinSec: 45, rideMaxSec: 90 },
      { name: 'normal', durationSec: 90, targetActive: 10, rideMinSec: 60, rideMaxSec: 120 },
      { name: 'peak', durationSec: 120, targetActive: 14, rideMinSec: 75, rideMaxSec: 150 },
      { name: 'cooldown', durationSec: 60, targetActive: 6, rideMinSec: 45, rideMaxSec: 90 }
    ];
  }

  return [
    { name: 'warmup', durationSec: 180, targetActive: 12, rideMinSec: 180, rideMaxSec: 300 },
    { name: 'base', durationSec: 300, targetActive: 20, rideMinSec: 240, rideMaxSec: 420 },
    { name: 'peak', durationSec: 420, targetActive: 30, rideMinSec: 300, rideMaxSec: 540 },
    { name: 'cooldown', durationSec: 180, targetActive: 14, rideMinSec: 180, rideMaxSec: 320 }
  ];
}

function gridLocation(index) {
  const cols = Math.ceil(Math.sqrt(Math.max(1, DRIVER_COUNT)));
  const row = Math.floor(index / cols);
  const col = index % cols;
  const rowFactor = cols > 1 ? (row / (cols - 1)) : 0.5;
  const colFactor = cols > 1 ? (col / (cols - 1)) : 0.5;
  const lat = BASE_LAT + (rowFactor - 0.5) * SPREAD_LAT;
  const lng = BASE_LNG + (colFactor - 0.5) * SPREAD_LNG;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

function nearbyLocation(base, delta = 0.0012) {
  return {
    lat: Number((base.lat + (Math.random() - 0.5) * delta).toFixed(6)),
    lng: Number((base.lng + (Math.random() - 0.5) * delta).toFixed(6))
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function classifyError(error) {
  const message = String(error?.message || error || '').trim();
  if (!message) return 'unknown';
  if (message.includes('confirmPayment_timeout') || message.includes('Timeout ao confirmar pagamento')) return 'payment_timeout';
  if (message.includes('booking')) return 'create_booking';
  if (message.includes('payment')) return 'payment';
  if (message.includes('veículo ativo') || message.includes('vehicle')) return 'driver_vehicle';
  if (message.includes('driverStatus')) return 'driver_status';
  if (message.includes('newRideRequest') || message.includes('dispatch')) return 'dispatch';
  if (message.includes('Timeout ao aceitar corrida')) return 'accept_ride';
  if (message.includes('Timeout ao iniciar viagem')) return 'start_trip';
  if (message.includes('Timeout ao finalizar viagem')) return 'complete_trip';
  if (message.includes('acceptRide')) return 'accept_ride';
  if (message.includes('startTrip')) return 'start_trip';
  if (message.includes('completeTrip') || message.includes('finishTrip')) return 'complete_trip';
  if (message.includes('driver_not_ready')) return 'driver_ready';
  return 'generic';
}

function addErrorMetric(key, error = null) {
  state.report.metrics.errors[key] = (state.report.metrics.errors[key] || 0) + 1;
  const message = String(error?.message || error || '').trim();
  if (!message) return;
  const sample = message.slice(0, 260);
  const samples = state.report.metrics.errorSamples[key] || [];
  if (!samples.includes(sample)) {
    samples.push(sample);
    while (samples.length > 6) samples.shift();
    state.report.metrics.errorSamples[key] = samples;
  }
}

function isPaymentBlockedNoPartner(errorPayload) {
  const raw = JSON.stringify(errorPayload || {}).toLowerCase();
  return (
    raw.includes('sem parceiro') ||
    raw.includes('no_partner') ||
    raw.includes('no drivers') ||
    raw.includes('no_driver') ||
    raw.includes('driver unavailable') ||
    raw.includes('no_drivers_available')
  );
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
        results[i] = { ok: false, error: error?.message || String(error) };
      }
    }
  }

  const runners = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    () => runOne()
  );
  await Promise.all(runners);
  return results;
}

async function connectAndAuthenticate(uid, userType, token) {
  const client = new WebSocketTestClient(WS_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnection: false
  });
  await client.connect();
  await client.authenticate(uid, userType, token ? { token } : {});
  return client;
}

function emitDriverStatusAndLocation(driverSession, isInTrip, options = {}) {
  const { forceStatus = false } = options;
  const tripStatus = isInTrip ? 'started' : 'idle';
  const status = isInTrip ? 'busy' : 'available';
  const heading = Number((Math.random() * 360).toFixed(2));
  const speed = isInTrip ? Number((25 + Math.random() * 35).toFixed(1)) : 0;
  const seq = Date.now() % 1000000;

  const locPayload = {
    lat: driverSession.location.lat,
    lng: driverSession.location.lng,
    tripStatus,
    isInTrip,
    seq,
    heading,
    speed
  };

  if (forceStatus || driverSession.lastDriverStatus !== status) {
    driverSession.client.socket.emit('setDriverStatus', {
      status,
      isOnline: true
    });
    driverSession.lastDriverStatus = status;
    driverSession.lastStatusEmitAt = nowMs();
  }

  driverSession.client.socket.emit('updateLocation', locPayload);
  driverSession.client.socket.emit('updateDriverLocation', {
    lat: driverSession.location.lat,
    lng: driverSession.location.lng,
    heading,
    speed,
    isInTrip,
    tripStatus
  });
}

function buildStressPlate(index) {
  const ts = String(Date.now()).slice(-3);
  const n = String(index % 1000).padStart(3, '0');
  return `S${ts}${n}`;
}

async function provisionDriverVehicle(driverSession, index) {
  const firebaseConfig = require('../../firebase-config');
  const db = firebaseConfig.getRealtimeDB();
  if (!db) {
    throw new Error('firebase_realtime_unavailable');
  }

  const nowIso = new Date().toISOString();
  const vehicleId = `${UID_PREFIX}_vehicle_${index}`;
  const userVehicleId = `${UID_PREFIX}_uv_${index}`;
  const plate = buildStressPlate(index);
  const uid = driverSession.uid;

  const updates = {};

  updates[`users/${uid}/approved`] = true;
  updates[`users/${uid}/status`] = 'approved';
  updates[`users/${uid}/driverActiveStatus`] = true;
  updates[`users/${uid}/carType`] = 'Leaf Plus';
  updates[`users/${uid}/carPlate`] = plate;
  updates[`users/${uid}/vehicleNumber`] = plate;
  updates[`users/${uid}/vehiclePlate`] = plate;
  updates[`users/${uid}/activeVehicleId`] = vehicleId;
  updates[`users/${uid}/updatedAt`] = nowIso;

  updates[`vehicles/${vehicleId}`] = {
    id: vehicleId,
    driverId: uid,
    vehicleNumber: plate,
    plate,
    vehicleMake: 'Tesla',
    vehicleModel: 'Model 3',
    vehicleYear: '2024',
    vehicleColor: 'White',
    carType: 'Leaf Plus',
    category: 'plus',
    manualCategory: 'plus',
    active: true,
    approved: true,
    carApproved: true,
    status: 'approved',
    isActive: true,
    updatedAt: nowIso,
    createdAt: nowIso
  };

  updates[`user_vehicles/${uid}/${userVehicleId}`] = {
    id: userVehicleId,
    userId: uid,
    vehicleId,
    status: 'approved',
    approved: true,
    carApproved: true,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  updates[`vehicle_active_assignment/${vehicleId}`] = {
    vehicleId,
    userId: uid,
    driverId: uid,
    userVehicleId,
    assignedAt: nowIso,
    updatedAt: nowIso
  };

  await db.ref().update(updates);
  driverSession.vehicleId = vehicleId;
  driverSession.vehiclePlate = plate;
}

async function readDriverStatus(driverId) {
  const response = await state.httpClient.get(`/api/driver-status/${driverId}`);
  return response?.data || {};
}

async function waitDriverReady(driverSession, timeoutMs = READINESS_TIMEOUT_MS) {
  const startedAt = nowMs();
  while (nowMs() - startedAt < timeoutMs) {
    emitDriverStatusAndLocation(driverSession, false);
    try {
      const status = await readDriverStatus(driverSession.uid);
      const canReceiveRequests = status?.canReceiveRequests === true;
      const inGeo = status?.details?.isOnlineInRedis === true;
      if (canReceiveRequests && inGeo) {
        driverSession.isReady = true;
        driverSession.lastReadyAt = nowMs();
        driverSession.lastReadyStatus = status;
        return true;
      }
      driverSession.lastReadyStatus = status;
    } catch (error) {
      driverSession.lastReadyError = error?.message || String(error);
    }
    await sleep(800);
  }
  driverSession.isReady = false;
  return false;
}

async function clearDriverLock(driverId) {
  try {
    await state.httpClient.post(`/api/driver-status/${driverId}/clear-lock`);
    return true;
  } catch (_) {
    return false;
  }
}

async function confirmPaymentDetailed(passengerSession, payload, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onSuccess = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: true, data });
    };

    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, error: error || {} });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('confirmPayment_timeout'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      passengerSession.client.socket.off('paymentConfirmed', onSuccess);
      passengerSession.client.socket.off('paymentError', onError);
    }

    passengerSession.client.socket.once('paymentConfirmed', onSuccess);
    passengerSession.client.socket.once('paymentError', onError);
    passengerSession.client.socket.emit('confirmPayment', payload);
  });
}

function pickIdleDriver() {
  const drivers = state.drivers;
  if (!drivers.length) return null;
  for (let i = 0; i < drivers.length; i += 1) {
    const idx = (state.driverCursor + i) % drivers.length;
    const candidate = drivers[idx];
    if (candidate.status === 'idle' && candidate.isReady === true) {
      state.driverCursor = (idx + 1) % drivers.length;
      return candidate;
    }
  }
  return null;
}

function pickIdlePassenger() {
  const passengers = state.passengers;
  if (!passengers.length) return null;
  for (let i = 0; i < passengers.length; i += 1) {
    const idx = (state.passengerCursor + i) % passengers.length;
    const candidate = passengers[idx];
    if (candidate.status === 'idle') {
      state.passengerCursor = (idx + 1) % passengers.length;
      return candidate;
    }
  }
  return null;
}

function registerDriverDispatchListener(driverSession) {
  if (driverSession.dispatchListenerRegistered) return;
  driverSession.dispatchListenerRegistered = true;
  driverSession.pendingRideRequests = new Map();

  driverSession.client.socket.on('newRideRequest', (payload = {}) => {
    const bookingId = payload?.bookingId || payload?.rideId;
    if (!bookingId) return;
    driverSession.pendingRideRequests.set(bookingId, {
      payload,
      receivedAt: nowMs()
    });
  });
}

function clearPendingDispatchSignals(bookingId) {
  for (const driver of state.drivers) {
    driver.pendingRideRequests?.delete?.(bookingId);
  }
}

function claimDispatchCandidate(bookingId) {
  let winner = null;

  for (const driver of state.drivers) {
    if (driver.status !== 'idle' || driver.isReady !== true) continue;
    const entry = driver.pendingRideRequests?.get?.(bookingId);
    if (!entry) continue;

    if (!winner || entry.receivedAt < winner.receivedAt) {
      winner = {
        driver,
        payload: entry.payload,
        receivedAt: entry.receivedAt
      };
    }
  }

  if (!winner) return null;
  winner.driver.status = 'reserved';
  winner.driver.activeBookingId = bookingId;
  clearPendingDispatchSignals(bookingId);
  return winner;
}

async function waitForDispatchCandidate(bookingId, timeoutMs = DISPATCH_TIMEOUT_MS) {
  const startedAt = nowMs();
  while (nowMs() - startedAt < timeoutMs) {
    const candidate = claimDispatchCandidate(bookingId);
    if (candidate) return candidate;
    await sleep(50);
  }
  throw new Error('dispatch_timeout_no_available_driver');
}

function createWindowReport(windowSpec, effectiveTarget) {
  return {
    name: windowSpec.name,
    durationSec: windowSpec.durationSec,
    targetActiveRequested: windowSpec.targetActive,
    targetActiveEffective: effectiveTarget,
    rideDurationSec: {
      min: windowSpec.rideMinSec,
      max: windowSpec.rideMaxSec
    },
    started: 0,
    completed: 0,
    failedStarts: 0,
    failedCompletes: 0,
    paymentBlockedRetries: 0,
    paymentBlockedHardFails: 0,
    noDriverCapacityMisses: 0,
    noPassengerCapacityMisses: 0,
    activeSamples: [],
    errors: {},
    latencyMs: {
      createBooking: [],
      confirmPayment: [],
      bookingToDispatch: [],
      acceptRide: [],
      startTrip: [],
      completeTrip: [],
      fullFlowToStart: [],
      tripDuration: []
    },
    startedAt: null,
    finishedAt: null
  };
}

function addWindowError(windowReport, key) {
  windowReport.errors[key] = (windowReport.errors[key] || 0) + 1;
}

async function launchRide(windowSpec, windowReport) {
  const seedDriver = pickIdleDriver();
  if (!seedDriver) {
    windowReport.noDriverCapacityMisses += 1;
    state.report.metrics.noDriverCapacityMisses += 1;
    return false;
  }
  const passenger = pickIdlePassenger();
  if (!passenger) {
    windowReport.noPassengerCapacityMisses += 1;
    state.report.metrics.noPassengerCapacityMisses += 1;
    return false;
  }

  passenger.status = 'reserved';

  const flowMarks = {};
  let bookingId = null;
  let pickup = null;
  let destination = null;
  let assignedDriver = null;

  try {
    const readinessStaleMs = nowMs() - (seedDriver.lastReadyAt || 0);
    const shouldRecheckByStale =
      PRE_BOOKING_READINESS_RECHECK_MS > 0 &&
      readinessStaleMs > PRE_BOOKING_READINESS_RECHECK_MS;

    if (seedDriver.isReady !== true || shouldRecheckByStale) {
      const ready = await waitDriverReady(seedDriver, Math.min(READINESS_TIMEOUT_MS, 12000));
      if (!ready) {
        throw new Error('driver_not_ready_before_booking');
      }
    }

    pickup = nearbyLocation(seedDriver.location, 0.0008);
    destination = nearbyLocation({
      lat: pickup.lat + 0.012 + Math.random() * 0.008,
      lng: pickup.lng + 0.012 + Math.random() * 0.008
    }, 0.0012);

    flowMarks.start = nowMs();
    const bookingResponse = await passenger.client.createBooking({
      customerId: passenger.uid,
      pickupLocation: {
        ...pickup,
        address: `Pickup ${windowSpec.name} ${flowMarks.start}`
      },
      destinationLocation: {
        ...destination,
        address: `Destination ${windowSpec.name} ${flowMarks.start}`
      },
      estimatedFare: Number((20 + Math.random() * 35).toFixed(2)),
      paymentMethod: 'pix',
      carType: 'plus',
      idempotencyKey: `sustain_${windowSpec.name}_${passenger.uid}_${flowMarks.start}`
    });
    flowMarks.bookingDone = nowMs();
    bookingId = bookingResponse?.bookingId;
    if (!bookingId) {
      throw new Error(`booking_id_missing:${JSON.stringify(bookingResponse)}`);
    }

    let paymentConfirmed = null;
    let lastPaymentError = null;

    for (let attempt = 1; attempt <= PAYMENT_RETRIES; attempt += 1) {
      const paymentStart = nowMs();
      const paymentPayload = {
        bookingId,
        paymentMethod: 'pix',
        paymentId: `pay_${windowSpec.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        amount: Number((20 + Math.random() * 35).toFixed(2)),
        pickupLocation: pickup
      };

      if (FORCE_REAL_PAYMENT) {
        paymentPayload.mockPayment = false;
        paymentPayload.__mockPayment = false;
      }

      const paymentResult = await confirmPaymentDetailed(passenger, paymentPayload);
      if (paymentResult.ok) {
        paymentConfirmed = paymentResult.data;
        flowMarks.paymentDone = nowMs();
        windowReport.latencyMs.confirmPayment.push(flowMarks.paymentDone - paymentStart);
        break;
      }

      lastPaymentError = paymentResult.error || {};
      const noPartnerBlocked = isPaymentBlockedNoPartner(lastPaymentError);

      if (noPartnerBlocked) {
        windowReport.paymentBlockedRetries += 1;
        state.report.metrics.paymentBlockedRetries += 1;
        await clearDriverLock(seedDriver.uid);
        await waitDriverReady(seedDriver, 10000);
        if (attempt < PAYMENT_RETRIES) {
          await sleep(450 * attempt);
          continue;
        }
        windowReport.paymentBlockedHardFails += 1;
        state.report.metrics.paymentBlockedHardFails += 1;
      }

      if (attempt < PAYMENT_RETRIES) {
        await sleep(350 * attempt);
      }
    }

    if (!paymentConfirmed) {
      throw new Error(`payment_failed:${JSON.stringify(lastPaymentError || {})}`);
    }

    flowMarks.dispatchWaitStart = nowMs();
    const dispatchCandidate = await waitForDispatchCandidate(bookingId, DISPATCH_TIMEOUT_MS);
    assignedDriver = dispatchCandidate.driver;
    flowMarks.dispatchDone = dispatchCandidate.receivedAt || nowMs();

    const acceptStart = nowMs();
    await assignedDriver.client.acceptRide(bookingId);
    flowMarks.acceptDone = nowMs();
    windowReport.latencyMs.acceptRide.push(flowMarks.acceptDone - acceptStart);

    const startStart = nowMs();
    await assignedDriver.client.startTrip({
      bookingId,
      startLocation: pickup
    });
    flowMarks.startTripDone = nowMs();
    windowReport.latencyMs.startTrip.push(flowMarks.startTripDone - startStart);

    assignedDriver.status = 'active';
    assignedDriver.activeBookingId = bookingId;
    passenger.status = 'active';
    passenger.activeBookingId = bookingId;

    emitDriverStatusAndLocation(assignedDriver, true);

    const holdSec = randomInt(windowSpec.rideMinSec, windowSpec.rideMaxSec);
    const dueAt = nowMs() + holdSec * 1000;
    const rideRecord = {
      bookingId,
      driverUid: assignedDriver.uid,
      passengerUid: passenger.uid,
      driverRef: assignedDriver,
      passengerRef: passenger,
      windowName: windowSpec.name,
      pickup,
      destination,
      createdAt: flowMarks.start,
      startedAt: flowMarks.startTripDone,
      dueAt,
      holdSec,
      marks: flowMarks
    };

    state.activeRides.set(bookingId, rideRecord);

    windowReport.started += 1;
    state.report.metrics.startedRides += 1;

    windowReport.latencyMs.createBooking.push(flowMarks.bookingDone - flowMarks.start);
    windowReport.latencyMs.bookingToDispatch.push(flowMarks.dispatchDone - flowMarks.bookingDone);
    windowReport.latencyMs.fullFlowToStart.push(flowMarks.startTripDone - flowMarks.start);
    state.report.metrics.latencyMs.createBooking.push(flowMarks.bookingDone - flowMarks.start);
    state.report.metrics.latencyMs.confirmPayment.push(
      (flowMarks.paymentDone || flowMarks.dispatchWaitStart) - flowMarks.bookingDone
    );
    state.report.metrics.latencyMs.bookingToDispatch.push(flowMarks.dispatchDone - flowMarks.bookingDone);
    state.report.metrics.latencyMs.acceptRide.push(flowMarks.acceptDone - flowMarks.dispatchDone);
    state.report.metrics.latencyMs.startTrip.push(flowMarks.startTripDone - flowMarks.acceptDone);
    state.report.metrics.latencyMs.fullFlowToStart.push(flowMarks.startTripDone - flowMarks.start);

    return true;
  } catch (error) {
    const key = classifyError(error);
    addErrorMetric(key, error);
    addWindowError(windowReport, key);
    state.report.metrics.failedStarts += 1;
    windowReport.failedStarts += 1;

    if (bookingId) {
      clearPendingDispatchSignals(bookingId);
      try {
        await passenger.client.cancelRide(bookingId, 'stress_flow_start_failure_cleanup');
      } catch (_) {
        // ignore cleanup failure
      }
    }

    passenger.status = 'idle';
    passenger.activeBookingId = null;

    if (assignedDriver) {
      await clearDriverLock(assignedDriver.uid);
      assignedDriver.status = 'idle';
      assignedDriver.activeBookingId = null;
      assignedDriver.isReady = false;

      const readyAgain = await waitDriverReady(assignedDriver, 10000);
      if (readyAgain) {
        assignedDriver.status = 'idle';
        assignedDriver.isReady = true;
        assignedDriver.readinessFailures = 0;
      } else {
        assignedDriver.isReady = false;
        assignedDriver.status = 'idle';
        assignedDriver.readinessFailures = (assignedDriver.readinessFailures || 0) + 1;
        if (STRICT_READY && assignedDriver.readinessFailures >= 3) {
          assignedDriver.status = 'quarantined';
        }
      }
    }

    return false;
  }
}

async function completeRide(ride, windowReport) {
  if (!ride || !state.activeRides.has(ride.bookingId)) return;

  const driver = ride.driverRef;
  const passenger = ride.passengerRef;

  try {
    const completeStartedAt = nowMs();
    const payload = {
      bookingId: ride.bookingId,
      endLocation: ride.destination,
      fare: Number((20 + Math.random() * 35).toFixed(2)),
      distance: Number((2 + Math.random() * 11).toFixed(2)),
      duration: Math.max(60, Math.round((nowMs() - ride.startedAt) / 1000))
    };

    if (MOCK_COMPLETE_PAYMENT) {
      payload.mockPayment = true;
      payload.__mockPayment = true;
    }

    await driver.client.finishTrip(payload);
    try {
      await passenger.client.waitForEvent(
        'tripCompleted',
        22000,
        (incoming) => {
          const incomingBookingId = incoming?.bookingId || incoming?.tripId || incoming?.rideId;
          return incomingBookingId === ride.bookingId;
        }
      );
    } catch (_) {
      // do not fail closeout if passenger ack is delayed
    }

    const completeDoneAt = nowMs();

    state.activeRides.delete(ride.bookingId);
    clearPendingDispatchSignals(ride.bookingId);
    driver.status = 'idle';
    driver.activeBookingId = null;
    passenger.status = 'idle';
    passenger.activeBookingId = null;

    emitDriverStatusAndLocation(driver, false);

    windowReport.completed += 1;
    state.report.metrics.completedRides += 1;
    windowReport.latencyMs.completeTrip.push(completeDoneAt - completeStartedAt);
    state.report.metrics.latencyMs.completeTrip.push(completeDoneAt - completeStartedAt);
    const tripDurationMs = Math.max(0, nowMs() - ride.startedAt);
    state.report.metrics.latencyMs.tripDuration.push(tripDurationMs);
    windowReport.latencyMs.tripDuration.push(tripDurationMs);
  } catch (error) {
    const key = `complete_${classifyError(error)}`;
    addErrorMetric(key, error);
    addWindowError(windowReport, key);
    windowReport.failedCompletes += 1;
    state.report.metrics.failedCompletes += 1;

    state.activeRides.delete(ride.bookingId);
    clearPendingDispatchSignals(ride.bookingId);
    driver.status = 'idle';
    driver.activeBookingId = null;
    passenger.status = 'idle';
    passenger.activeBookingId = null;

    await clearDriverLock(driver.uid);
    const readyAgain = await waitDriverReady(driver, 10000);
    if (readyAgain) {
      driver.readinessFailures = 0;
      driver.isReady = true;
      driver.status = 'idle';
    } else {
      driver.readinessFailures = (driver.readinessFailures || 0) + 1;
      driver.isReady = false;
      driver.status = 'idle';
      if (!readyAgain && STRICT_READY && driver.readinessFailures >= 3) {
        driver.status = 'quarantined';
      }
    }
  }
}

function scheduleStart(windowSpec, windowReport) {
  if (state.inflightStarts.size >= MAX_START_CONCURRENCY) return false;
  const promise = launchRide(windowSpec, windowReport)
    .catch((error) => {
      const key = `start_unhandled_${classifyError(error)}`;
      addErrorMetric(key, error);
      addWindowError(windowReport, key);
      state.report.metrics.failedStarts += 1;
      windowReport.failedStarts += 1;
    })
    .finally(() => {
      state.inflightStarts.delete(promise);
    });
  state.inflightStarts.add(promise);
  return true;
}

function scheduleDueCompletions(windowReport, forceAll = false) {
  let scheduled = 0;
  const now = nowMs();

  for (const ride of state.activeRides.values()) {
    if (state.inflightCompletes.size >= MAX_COMPLETE_CONCURRENCY) break;
    if (!forceAll && ride.dueAt > now) continue;
    if (ride.completing) continue;
    ride.completing = true;

    const promise = completeRide(ride, windowReport)
      .catch((error) => {
        const key = `complete_unhandled_${classifyError(error)}`;
        addErrorMetric(key, error);
        addWindowError(windowReport, key);
      })
      .finally(() => {
        ride.completing = false;
        state.inflightCompletes.delete(promise);
      });

    state.inflightCompletes.add(promise);
    scheduled += 1;
  }

  return scheduled;
}

function startHeartbeats() {
  for (const driver of state.drivers) {
    const timer = setInterval(() => {
      if (driver.status === 'quarantined') return;
      const isInTrip = driver.status === 'active';
      if (isInTrip) {
        driver.location = nearbyLocation(driver.location, 0.00025);
      } else {
        driver.location = nearbyLocation(driver.baseLocation, 0.00015);
      }
      emitDriverStatusAndLocation(driver, isInTrip);
    }, HEARTBEAT_MS);
    timer.unref?.();
    driver.heartbeat = timer;
  }
}

async function stopHeartbeats() {
  for (const driver of state.drivers) {
    if (driver.heartbeat) {
      clearInterval(driver.heartbeat);
      driver.heartbeat = null;
    }
  }
}

async function bootstrapPools() {
  const driverUids = buildUidPool('driver', DRIVER_COUNT);
  const passengerUids = buildUidPool('passenger', PASSENGER_COUNT);

  state.report.pool.uids = {
    drivers: driverUids.length,
    passengers: passengerUids.length
  };

  logLine(`[setup] generating Firebase idTokens for ${driverUids.length + passengerUids.length} users...`);
  const users = driverUids
    .map((uid) => ({ uid, type: 'driver' }))
    .concat(passengerUids.map((uid) => ({ uid, type: 'passenger' })));

  const tokenResults = await withConcurrency(users, TOKEN_CONCURRENCY, async (entry) => {
    const token = await withTimeout(
      getIdTokenForUid(entry.uid),
      15000,
      `token_generation_timeout:${entry.uid}`
    );
    return { ok: true, uid: entry.uid, type: entry.type, token };
  });

  const tokenMap = new Map();
  let tokenFailures = 0;
  for (const result of tokenResults) {
    if (result?.ok) {
      tokenMap.set(result.uid, result.token);
    } else {
      tokenFailures += 1;
    }
  }
  state.report.pool.tokenGeneration = {
    total: users.length,
    ok: tokenMap.size,
    failed: tokenFailures
  };

  const driverSessions = driverUids.map((uid, index) => ({
    uid,
    token: tokenMap.get(uid) || null,
    index,
    client: null,
    baseLocation: gridLocation(index),
    location: gridLocation(index),
    status: 'init',
    isReady: false,
    lastReadyAt: 0,
    lastReadyStatus: null,
    heartbeat: null,
    activeBookingId: null,
    vehicleId: null,
    vehiclePlate: null,
    lastDriverStatus: null,
    lastStatusEmitAt: 0,
    readinessFailures: 0,
    pendingRideRequests: new Map(),
    dispatchListenerRegistered: false
  }));

  const passengerSessions = passengerUids.map((uid) => ({
    uid,
    token: tokenMap.get(uid) || null,
    client: null,
    status: 'init',
    activeBookingId: null
  }));

  if (PROVISION_DRIVER_VEHICLES && canUseFirebaseProvisioning()) {
    logLine(`[setup] provisioning active vehicles for ${driverSessions.length} drivers...`);
    const provisionResults = await withConcurrency(
      driverSessions,
      PROVISION_CONCURRENCY,
      async (session, index) => {
        await withTimeout(
          provisionDriverVehicle(session, index),
          15000,
          `provision_driver_vehicle_timeout:${session.uid}`
        );
        return { ok: true };
      }
    );

    let provisioned = 0;
    let provisionFailed = 0;
    for (let i = 0; i < provisionResults.length; i += 1) {
      const result = provisionResults[i];
      if (result?.ok) {
        provisioned += 1;
      } else {
        provisionFailed += 1;
        state.report.notes.push(`Driver vehicle provisioning failed (${driverSessions[i].uid}): ${result?.error || 'unknown'}`);
      }
    }
    state.report.pool.provisioning = { attempted: driverSessions.length, ok: provisioned, failed: provisionFailed };
    logLine(`[setup] vehicle provisioning done ok=${provisioned} failed=${provisionFailed}`);
  } else if (PROVISION_DRIVER_VEHICLES) {
    state.report.pool.provisioning = { attempted: 0, ok: 0, failed: 0, skipped: true };
    state.report.notes.push('Driver vehicle provisioning skipped: firebase credentials unavailable in runner.');
    logLine('[setup] provisioning skipped (firebase credentials unavailable in local runner).');
  }

  logLine(`[setup] connecting/authenticating ${driverSessions.length} drivers...`);
  const connectedDrivers = await withConcurrency(
    driverSessions,
    CONNECT_CONCURRENCY,
    async (session) => {
      if (!session.token) {
        throw new Error(`missing_token_for_driver:${session.uid}`);
      }
      session.client = await withTimeout(
        connectAndAuthenticate(session.uid, 'driver', session.token),
        20000,
        `connect_auth_timeout_driver:${session.uid}`
      );
      session.status = 'idle';
      registerDriverDispatchListener(session);
      emitDriverStatusAndLocation(session, false, { forceStatus: true });
      return { ok: true, uid: session.uid };
    }
  );

  let connectedDriversCount = 0;
  state.drivers = [];
  for (let i = 0; i < connectedDrivers.length; i += 1) {
    const result = connectedDrivers[i];
    const session = driverSessions[i];
    if (result?.ok && session?.client) {
      connectedDriversCount += 1;
      state.drivers.push(session);
    } else {
      const key = 'driver_connect_or_auth_failed';
      addErrorMetric(key);
      state.report.notes.push(`Driver session skipped (${session.uid}): ${result?.error || 'unknown'}`);
    }
  }

  logLine(`[setup] connecting/authenticating ${passengerSessions.length} passengers...`);
  const connectedPassengers = await withConcurrency(
    passengerSessions,
    CONNECT_CONCURRENCY,
    async (session) => {
      if (!session.token) {
        throw new Error(`missing_token_for_passenger:${session.uid}`);
      }
      session.client = await withTimeout(
        connectAndAuthenticate(session.uid, 'customer', session.token),
        20000,
        `connect_auth_timeout_passenger:${session.uid}`
      );
      session.status = 'idle';
      return { ok: true, uid: session.uid };
    }
  );

  let connectedPassengersCount = 0;
  state.passengers = [];
  for (let i = 0; i < connectedPassengers.length; i += 1) {
    const result = connectedPassengers[i];
    const session = passengerSessions[i];
    if (result?.ok && session?.client) {
      connectedPassengersCount += 1;
      state.passengers.push(session);
    } else {
      const key = 'passenger_connect_or_auth_failed';
      addErrorMetric(key);
      state.report.notes.push(`Passenger session skipped (${session.uid}): ${result?.error || 'unknown'}`);
    }
  }

  state.report.pool.connected.drivers = connectedDriversCount;
  state.report.pool.connected.passengers = connectedPassengersCount;

  if (!state.drivers.length || !state.passengers.length) {
    throw new Error(
      `Insufficient sessions after connect/auth (drivers=${state.drivers.length}, passengers=${state.passengers.length})`
    );
  }

  logLine(`[setup] validating driver readiness (canReceiveRequests + inGeo)...`);
  const readinessResults = await withConcurrency(
    state.drivers,
    READINESS_CONCURRENCY,
    async (driver) => {
      const ready = await waitDriverReady(driver, READINESS_TIMEOUT_MS);
      return { ok: true, uid: driver.uid, ready };
    }
  );

  let readyCount = 0;
  for (let i = 0; i < readinessResults.length; i += 1) {
    const result = readinessResults[i];
    const driver = state.drivers[i];
    if (!result?.ok || result.ready !== true) {
      driver.isReady = false;
      driver.readinessFailures = (driver.readinessFailures || 0) + 1;
      if (STRICT_READY) {
        driver.status = 'quarantined';
      } else {
        driver.status = 'idle';
      }
      state.report.notes.push(
        `Driver not ready at bootstrap (${driver.uid}) - canReceiveRequests=${driver.lastReadyStatus?.canReceiveRequests || false}`
      );
      continue;
    }
    driver.status = 'idle';
    driver.isReady = true;
    driver.readinessFailures = 0;
    readyCount += 1;
  }

  state.report.pool.readyDrivers = readyCount;
  logLine(`[setup] connected drivers=${connectedDriversCount}, ready=${readyCount}, connected passengers=${connectedPassengersCount}`);

  startHeartbeats();
}

async function runWindows() {
  const maxActiveByPool = Math.min(
    state.drivers.filter((driver) => driver.status !== 'quarantined').length,
    state.passengers.length
  );

  if (maxActiveByPool <= 0) {
    throw new Error('No usable pool to run scenario (0 effective active capacity)');
  }

  state.report.pool.maxActiveByPool = maxActiveByPool;

  for (const spec of windows) {
    const effectiveTarget = Math.min(spec.targetActive, maxActiveByPool);
    const windowReport = createWindowReport(spec, effectiveTarget);
    windowReport.startedAt = new Date().toISOString();
    state.report.windows.push(windowReport);
    state.runningWindow = windowReport;

    const startedAt = nowMs();
    const endsAt = startedAt + spec.durationSec * 1000;
    let nextProgressLogAt = startedAt + 5000;

    logLine(
      `[window:${spec.name}] start duration=${spec.durationSec}s targetActive=${effectiveTarget} (requested=${spec.targetActive})`
    );

    while (nowMs() < endsAt) {
      const activeNow = state.activeRides.size;
      windowReport.activeSamples.push(activeNow);

      scheduleDueCompletions(windowReport, false);

      const inflight = state.inflightStarts.size;
      const deficit = Math.max(0, effectiveTarget - (activeNow + inflight));

      for (let i = 0; i < deficit; i += 1) {
        const scheduled = scheduleStart(spec, windowReport);
        if (!scheduled) break;
      }

      if (nowMs() >= nextProgressLogAt) {
        logLine(
          `[window:${spec.name}] active=${state.activeRides.size} inflightStart=${state.inflightStarts.size} inflightComplete=${state.inflightCompletes.size} started=${windowReport.started} failedStart=${windowReport.failedStarts} wErr=[${formatErrorPairs(windowReport.errors)}] gErr=[${formatErrorPairs(state.report.metrics.errors)}]`
        );
        nextProgressLogAt += 5000;
      }

      await sleep(LOOP_TICK_MS);
    }

    windowReport.finishedAt = new Date().toISOString();
    logLine(`[window:${spec.name}] finished activeNow=${state.activeRides.size}`);
  }
}

async function drainAndFinalize() {
  const drainStarted = nowMs();
  const fakeWindow = state.runningWindow || createWindowReport(
    { name: 'drain', durationSec: 0, targetActive: 0, rideMinSec: 0, rideMaxSec: 0 },
    0
  );

  while (
    nowMs() - drainStarted < DRAIN_TIMEOUT_MS &&
    (state.activeRides.size > 0 || state.inflightStarts.size > 0 || state.inflightCompletes.size > 0)
  ) {
    scheduleDueCompletions(fakeWindow, true);
    await sleep(LOOP_TICK_MS);
  }

  if (state.activeRides.size > 0) {
    state.report.notes.push(
      `Drain timeout reached with ${state.activeRides.size} rides still active. Forced local cleanup applied.`
    );
    for (const ride of state.activeRides.values()) {
      ride.driverRef.status = 'idle';
      ride.driverRef.activeBookingId = null;
      ride.passengerRef.status = 'idle';
      ride.passengerRef.activeBookingId = null;
    }
    state.activeRides.clear();
  }

  await waitAllSettledWithTimeout(state.inflightStarts, 15000, 'inflightStarts');
  await waitAllSettledWithTimeout(state.inflightCompletes, 15000, 'inflightCompletes');
}

async function disconnectAll() {
  await stopHeartbeats();
  const sessions = state.drivers.map((driver) => driver.client).concat(state.passengers.map((p) => p.client));
  for (const client of sessions) {
    try {
      client?.disconnect();
    } catch (_) {
      // ignore
    }
  }
}

function finalizeReportAndPrint() {
  const finishedAt = new Date().toISOString();
  state.report.finishedAt = finishedAt;
  state.report.durationMs = Date.parse(finishedAt) - Date.parse(state.report.startedAt);

  const overall = state.report.metrics;
  const started = overall.startedRides;
  const completed = overall.completedRides;

  state.report.summary = {
    startedRides: started,
    completedRides: completed,
    activeRidesAtEnd: state.activeRides.size,
    completionRatePct: Number(((completed / Math.max(started, 1)) * 100).toFixed(2)),
    failedStarts: overall.failedStarts,
    failedCompletes: overall.failedCompletes,
    paymentBlockedRetries: overall.paymentBlockedRetries,
    paymentBlockedHardFails: overall.paymentBlockedHardFails,
    noDriverCapacityMisses: overall.noDriverCapacityMisses,
    noPassengerCapacityMisses: overall.noPassengerCapacityMisses,
    latencyMs: {
      createBooking: summarizeLatency(overall.latencyMs.createBooking),
      confirmPayment: summarizeLatency(overall.latencyMs.confirmPayment),
      bookingToDispatch: summarizeLatency(overall.latencyMs.bookingToDispatch),
      acceptRide: summarizeLatency(overall.latencyMs.acceptRide),
      startTrip: summarizeLatency(overall.latencyMs.startTrip),
      completeTrip: summarizeLatency(overall.latencyMs.completeTrip),
      tripDuration: summarizeLatency(overall.latencyMs.tripDuration),
      fullFlowToStart: summarizeLatency(overall.latencyMs.fullFlowToStart)
    },
    topErrors: Object.entries(overall.errors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([error, count]) => ({ error, count })),
    errorSamples: overall.errorSamples || {}
  };

  state.report.windows = state.report.windows.map((windowReport) => {
    const samples = windowReport.activeSamples;
    const avgActive = samples.length
      ? Number((samples.reduce((acc, value) => acc + value, 0) / samples.length).toFixed(2))
      : 0;
    const maxActive = samples.length ? Math.max(...samples) : 0;
    const target = windowReport.targetActiveEffective;
    const targetHitPct = target > 0 ? Number(((avgActive / target) * 100).toFixed(2)) : 0;

    return {
      ...windowReport,
      activeStats: {
        avg: avgActive,
        max: maxActive,
        target,
        targetHitPct
      },
      latencyMs: {
        createBooking: summarizeLatency(windowReport.latencyMs.createBooking),
        confirmPayment: summarizeLatency(windowReport.latencyMs.confirmPayment),
        bookingToDispatch: summarizeLatency(windowReport.latencyMs.bookingToDispatch),
        acceptRide: summarizeLatency(windowReport.latencyMs.acceptRide),
        startTrip: summarizeLatency(windowReport.latencyMs.startTrip),
        completeTrip: summarizeLatency(windowReport.latencyMs.completeTrip),
        fullFlowToStart: summarizeLatency(windowReport.latencyMs.fullFlowToStart),
        tripDuration: summarizeLatency(windowReport.latencyMs.tripDuration)
      }
    };
  });

  const supportedActiveEstimate = state.report.windows
    .filter((windowReport) => windowReport.activeStats?.targetHitPct >= 90 && windowReport.failedStarts <= Math.max(2, Math.round(windowReport.started * 0.05)))
    .reduce((acc, windowReport) => Math.max(acc, windowReport.activeStats?.avg || 0), 0);

  state.report.capacityEstimate = {
    sustainedActiveRidesEstimated: Number(supportedActiveEstimate.toFixed(2)),
    interpretation:
      supportedActiveEstimate > 0
        ? 'Highest average active rides in windows with >=90% target hit and low start failures.'
        : 'No window met the >=90% target-hit + low-failure criteria. Check errors and pool readiness.'
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(state.report, null, 2));

  const shortSummary = {
    reportPath,
    startedRides: state.report.summary.startedRides,
    completedRides: state.report.summary.completedRides,
    completionRatePct: state.report.summary.completionRatePct,
    sustainedActiveRidesEstimated: state.report.capacityEstimate.sustainedActiveRidesEstimated,
    readyDrivers: state.report.pool.readyDrivers,
    connectedPassengers: state.report.pool.connected.passengers
  };

  process.stdout.write(`${JSON.stringify(shortSummary, null, 2)}\n`);
}

async function main() {
  logLine(`[run] ws=${WS_URL}`);
  logLine(`[run] windows=${windows.map((w) => `${w.name}:${w.durationSec}s@${w.targetActive}`).join(', ')}`);

  await bootstrapPools();
  await runWindows();
  await drainAndFinalize();
  finalizeReportAndPrint();
}

let runExitCode = 0;
let reportWritten = false;

main()
  .then(() => {
    runExitCode = 0;
    reportWritten = true;
  })
  .catch(async (error) => {
    runExitCode = 1;
    addErrorMetric('fatal');
    state.report.notes.push(`Fatal: ${error?.message || String(error)}`);
    try {
      await drainAndFinalize();
    } catch (_) {
      // ignore
    }
    try {
      finalizeReportAndPrint();
      reportWritten = true;
    } catch (_) {
      // ignore
    }
    process.stderr.write(`FATAL: ${error?.stack || error?.message || String(error)}\n`);
  })
  .finally(async () => {
    try {
      await Promise.race([
        disconnectAll(),
        sleep(4000)
      ]);
    } catch (_) {
      // ignore
    }

    // Deterministic end: avoid orphan stress runners holding open sockets.
    if (!reportWritten) {
      try {
        finalizeReportAndPrint();
      } catch (_) {
        // ignore
      }
    }

    process.exit(runExitCode);
  });
