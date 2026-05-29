#!/usr/bin/env node

/**
 * Real core end-to-end simulation with cost accounting.
 *
 * Flow:
 * 1) Create passenger + driver records in Redis (and Firebase when available)
 * 2) createBooking -> confirmPayment (mock) -> notify driver
 * 3) Simulate driver movement to pickup (persist coordinates)
 * 4) Chat exchange (6 messages)
 * 5) startTrip -> trip movement coordinates (persist)
 * 6) completeTrip (mock payment distribution)
 * 7) Persist final ride snapshot
 * 8) Generate receipt + PDF
 * 9) Submit and receive rating
 * 10) Collect before/after metrics and compute deltas
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../../tests/e2e/backend/__helpers__/redis-driver-simulator');

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function deriveApiBaseUrl(value) {
  const explicit = trimTrailingSlash(process.env.REAL_CORE_API_BASE_URL || process.env.API_BASE_URL || '');
  if (explicit) return explicit;

  try {
    const parsed = new URL(String(value || ''));
    if (parsed.hostname.startsWith('socket.')) {
      parsed.hostname = parsed.hostname.replace(/^socket\./, 'api.');
    }
    return trimTrailingSlash(parsed.toString());
  } catch (_error) {
    return 'https://api.leaf.app.br';
  }
}

const WS_SERVER_URL = process.env.REAL_CORE_WS_URL || process.env.WS_URL || process.env.REAL_CORE_SERVER_URL || 'http://127.0.0.1:3001';
const API_BASE_URL = deriveApiBaseUrl(process.env.REAL_CORE_SERVER_URL || WS_SERVER_URL);
const METRICS_URL = process.env.REAL_CORE_METRICS_URL || process.env.PRELAUNCH_METRICS_URL || `${API_BASE_URL}/api/metrics/prometheus`;
const REPORT_DIR = path.join(__dirname, '../../reports');
const nowTag = process.env.REAL_CORE_RUN_TAG || `${Date.now()}_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const CHAT_CREATION_ATTEMPTS = Math.max(1, Number.parseInt(process.env.REAL_CORE_CHAT_ATTEMPTS || '2', 10) || 2);
const RATING_EVENT_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.REAL_CORE_RATING_TIMEOUT_MS || '5000', 10) || 5000);
const DRIVER_ONLINE_SETTLE_MS = Math.max(0, Number.parseInt(process.env.REAL_CORE_DRIVER_ONLINE_SETTLE_MS || '0', 10) || 0);
const SIMULATION_SPEED_KMH = Number.parseFloat(process.env.REAL_CORE_SIMULATION_SPEED_KMH || '');
const USE_SPEED_DERIVED_DURATION = String(process.env.REAL_CORE_USE_SPEED_DERIVED_DURATION || 'false').toLowerCase() === 'true' && Number.isFinite(SIMULATION_SPEED_KMH) && SIMULATION_SPEED_KMH > 0;
const SKIP_DIRECT_REDIS_EVIDENCE_WRITES =
  String(process.env.REAL_CORE_SKIP_DIRECT_REDIS_EVIDENCE_WRITES || 'false').toLowerCase() === 'true';
let metricsBearerToken = process.env.PRELAUNCH_METRICS_TOKEN || process.env.AUTH_TOKEN || process.env.LEAF_ADMIN_BEARER_TOKEN || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function formatBrl(value) {
  const amount = toMoney(value) ?? 0;
  return `R$ ${amount.toFixed(2).replace('.', ',')}`;
}

function resolveLockedFare(bookingResponse = {}) {
  return toMoney(
    bookingResponse?.data?.estimatedFare ??
    bookingResponse?.estimatedFare ??
    bookingResponse?.data?.pricingPayload?.final_price
  );
}

function assertFareConsistency({ quote, payment, finalFare, context }) {
  const values = {
    quote: toMoney(quote),
    payment: toMoney(payment),
    finalFare: toMoney(finalFare)
  };
  const missing = Object.entries(values)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`financial_consistency_missing_${missing.join('_')}:${context || ''}`);
  }

  const tolerance = 0.01;
  const paymentDiff = Math.abs(values.quote - values.payment);
  const finalDiff = Math.abs(values.quote - values.finalFare);
  if (paymentDiff > tolerance || finalDiff > tolerance) {
    throw new Error(
      `financial_consistency_failed:${context || ''}:quote=${values.quote}:payment=${values.payment}:final=${values.finalFare}`
    );
  }

  return values;
}

async function tryWaitForEvent(client, eventName, timeout, predicate = null) {
  try {
    const data = await client.waitForEvent(eventName, timeout, predicate);
    return { ok: true, event: eventName, data };
  } catch (error) {
    return { ok: false, event: eventName, error: error.message };
  }
}

async function waitForTripCompletedOrStateFallback({ passengerClient, driverClient, redis, bookingId, timeoutMs = 20000 }) {
  const [passengerEvent, driverEvent] = await Promise.all([
    tryWaitForEvent(passengerClient, 'tripCompleted', timeoutMs, (evt) => evt?.bookingId === bookingId || evt?.rideId === bookingId),
    tryWaitForEvent(driverClient, 'tripCompleted', timeoutMs, (evt) => evt?.bookingId === bookingId || evt?.rideId === bookingId)
  ]);

  if (passengerEvent.ok && driverEvent.ok) {
    return {
      passenger: passengerEvent.data,
      driver: driverEvent.data,
      source: 'socket'
    };
  }

  await sleep(700);
  const bookingHash = await redis.hgetall(`booking:${bookingId}`);
  const activeBookingRaw = await redis.hget('bookings:active', bookingId);
  let activeBooking = null;
  try {
    activeBooking = activeBookingRaw ? JSON.parse(activeBookingRaw) : null;
  } catch (_error) {
    activeBooking = null;
  }

  const status = String(
    bookingHash.status ||
    bookingHash.state ||
    bookingHash.tripStatus ||
    activeBooking?.status ||
    activeBooking?.state ||
    ''
  ).toUpperCase();
  const paymentStatus = String(bookingHash.paymentStatus || activeBooking?.paymentStatus || '').toLowerCase();
  const completedStatuses = new Set(['COMPLETED', 'COMPLETE', 'FINISHED', 'FINALIZED', 'DONE']);

  if (completedStatuses.has(status) || paymentStatus === 'completed') {
    return {
      passenger: passengerEvent.ok ? passengerEvent.data : null,
      driver: driverEvent.ok ? driverEvent.data : null,
      source: 'redis_state_fallback',
      status,
      paymentStatus,
      passengerEvent,
      driverEvent,
      bookingHash
    };
  }

  throw new Error(
    `trip_completed_not_observed:${bookingId}:passenger=${passengerEvent.error || 'ok'}:driver=${driverEvent.error || 'ok'}:status=${status || 'missing'}:payment=${paymentStatus || 'missing'}`
  );
}

function buildLinePoints(start, end, count) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 1 : i / (count - 1);
    const lat = start.lat + (end.lat - start.lat) * t;
    const lng = start.lng + (end.lng - start.lng) * t;
    points.push({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
  }
  return points;
}

function haversineDistanceKm(a, b) {
  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;

  const toRad = (deg) => deg * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return Number((earthKm * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))).toFixed(3));
}

function deriveDurationSecsAtSpeed(distanceKm, speedKmh = SIMULATION_SPEED_KMH) {
  const distance = Number(distanceKm);
  const speed = Number(speedKmh);
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(speed) || speed <= 0) {
    return null;
  }
  return Math.max(1, Math.round((distance / speed) * 3600));
}

function timedCoordinatePayload({ basePayload, index, total, durationSecs, startedAtMs }) {
  if (!durationSecs || !Number.isFinite(durationSecs) || total <= 1) {
    return {
      ...basePayload,
      timestamp: Date.now()
    };
  }

  const offsetMs = Math.round((durationSecs * 1000 * index) / (total - 1));
  return {
    ...basePayload,
    timestamp: startedAtMs + offsetMs,
    simulatedElapsedSeconds: Math.round(offsetMs / 1000)
  };
}

function parseLabelString(raw = '') {
  if (!raw) return {};
  const labels = {};
  const re = /(\w+)="((?:\\.|[^"])*)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    labels[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return labels;
}

function parsePrometheusText(text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const withLabels = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+([-+eE0-9.]+)$/);
    if (withLabels) {
      rows.push({
        metric: withLabels[1],
        labels: parseLabelString(withLabels[2]),
        value: Number(withLabels[3])
      });
      continue;
    }

    const plain = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([-+eE0-9.]+)$/);
    if (plain) {
      rows.push({ metric: plain[1], labels: {}, value: Number(plain[2]) });
    }
  }
  return rows;
}

function sumMetric(rows, metricName, matchLabels = {}) {
  return rows
    .filter((row) => row.metric === metricName)
    .filter((row) => Object.entries(matchLabels).every(([k, v]) => row.labels[k] === v))
    .reduce((acc, row) => acc + (Number.isFinite(row.value) ? row.value : 0), 0);
}

function metricDelta(beforeRows, afterRows, metricName, labels = {}) {
  const before = sumMetric(beforeRows, metricName, labels);
  const after = sumMetric(afterRows, metricName, labels);
  return Number((after - before).toFixed(6));
}

function shouldWriteFirebaseEvidence() {
  return String(process.env.REAL_CORE_WRITE_FIREBASE || 'false').toLowerCase() === 'true';
}

function getRealtimeDbSafe() {
  if (!shouldWriteFirebaseEvidence()) return null;

  try {
    // Lazy-load para evitar bootstrap de serviços locais durante a validação remota.
    // eslint-disable-next-line global-require
    const firebaseConfig = require('../../firebase-config');
    return firebaseConfig.getRealtimeDB ? firebaseConfig.getRealtimeDB() : null;
  } catch (_error) {
    return null;
  }
}

function createReceiptHash(bookingId, rideData) {
  const raw = [
    bookingId,
    rideData.customer,
    rideData.driver,
    rideData.finalPrice,
    rideData.completedAt
  ].join(':');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32).toUpperCase();
}

function generateReceiptPdfBuffer(receipt) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text('Recibo Leaf', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11);
    doc.text(`Corrida: ${receipt.bookingId}`);
    doc.text(`Passageiro: ${receipt.customer}`);
    doc.text(`Motorista: ${receipt.driver}`);
    doc.text(`Origem: ${receipt.pickup?.add || ''}`);
    doc.text(`Destino: ${receipt.drop?.add || ''}`);
    doc.text(`Total: ${receipt.financial.totalPaid.formatted}`);
    doc.text(`Hash: ${receipt.hash}`);
    doc.end();
  });
}

async function cleanupRealCoreDrivers(simulator) {
  try {
    const keys = await simulator.keys('driver:real_driver_*');
    const driverIds = keys
      .map((key) => String(key || '').replace(/^driver:/, ''))
      .filter((driverId) => driverId.startsWith('real_driver_'));
    await Promise.allSettled(driverIds.map((driverId) => simulator.removeDriver(driverId)));
  } catch (_error) {
    // Limpeza é best-effort para não mascarar a falha principal da corrida.
  }
}

function shouldSkipGlobalDriverCleanup() {
  return String(process.env.REAL_CORE_SKIP_GLOBAL_DRIVER_CLEANUP || '').toLowerCase() === 'true';
}

async function cleanupOwnDriver(simulator, driverId) {
  try {
    if (driverId) {
      await simulator.removeDriver(driverId);
    }
  } catch (_error) {
    // Limpeza individual é best-effort.
  }
}

async function safeRedisEvidenceWrite(report, operation, fn) {
  if (SKIP_DIRECT_REDIS_EVIDENCE_WRITES) {
    report.debug.redisWarnings = report.debug.redisWarnings || [];
    report.debug.redisWarnings.push({
      operation,
      skipped: true,
      reason: 'REAL_CORE_SKIP_DIRECT_REDIS_EVIDENCE_WRITES=true'
    });
    return null;
  }

  try {
    return await fn();
  } catch (error) {
    report.debug.redisWarnings = report.debug.redisWarnings || [];
    report.debug.redisWarnings.push({
      operation,
      error: error.message
    });
    return null;
  }
}

function defaultRoute() {
  return {
    name: 'Copacabana Palace -> Leblon',
    pickup: { lat: -22.971964, lng: -43.182543, address: 'Copacabana Palace, Rio de Janeiro, RJ' },
    destination: { lat: -22.984843, lng: -43.221972, address: 'Leblon, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9708, lng: -43.1819 }
  };
}

function normalizeRoutePoint(point, fallbackAddress) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    address: point?.address || point?.add || fallbackAddress
  };
}

function resolveRouteFromEnv() {
  const fallback = defaultRoute();
  if (!process.env.REAL_CORE_ROUTE_JSON) return fallback;

  try {
    const parsed = JSON.parse(process.env.REAL_CORE_ROUTE_JSON);
    const pickup = normalizeRoutePoint(parsed.pickup, fallback.pickup.address);
    const destination = normalizeRoutePoint(parsed.destination, fallback.destination.address);
    const driverStart = normalizeRoutePoint(parsed.driverStart || parsed.pickup, pickup?.address || fallback.driverStart.address);

    if (!pickup || !destination || !driverStart) {
      throw new Error('pickup_destination_driverStart_required');
    }

    return {
      name: parsed.name || `${pickup.address} -> ${destination.address}`,
      pickup,
      destination,
      driverStart
    };
  } catch (error) {
    throw new Error(`invalid_REAL_CORE_ROUTE_JSON:${error.message}`);
  }
}

function redactAuthPayload(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.error || parsed.message || '';
  } catch (_error) {
    return String(text || '').slice(0, 200);
  }
}

async function loginForMetricsBearer() {
  const autoLogin = String(process.env.AUTO_LOGIN_ADMIN_TOKEN || 'true').toLowerCase() !== 'false';
  if (!autoLogin) return '';

  const email = process.env.ADMIN_AUTH_EMAIL || process.env.TEST_ADMIN_EMAIL || process.env.SMOKE_ADMIN_EMAIL || 'admin@leaf.com';
  const password = process.env.ADMIN_AUTH_PASSWORD || process.env.TEST_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || 'admin123';
  const res = await fetch(`${API_BASE_URL}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Falha ao obter token admin para metricas: ${res.status} ${redactAuthPayload(text)}`);
  }

  const parsed = JSON.parse(text);
  return parsed.accessToken || '';
}

async function fetchMetricsRows() {
  const headers = metricsBearerToken ? { Authorization: `Bearer ${metricsBearerToken}` } : {};
  let res = await fetch(METRICS_URL, {
    headers,
    signal: AbortSignal.timeout(20000)
  });

  if ((res.status === 401 || res.status === 403) && !metricsBearerToken) {
    metricsBearerToken = await loginForMetricsBearer();
    res = await fetch(METRICS_URL, {
      headers: metricsBearerToken ? { Authorization: `Bearer ${metricsBearerToken}` } : {},
      signal: AbortSignal.timeout(20000)
    });
  }

  if (!res.ok) {
    throw new Error(`Falha ao ler metricas Prometheus: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parsePrometheusText(text);
}

async function fetchMetricsRowsSafely(report, phase) {
  const attempts = Math.max(1, Number.parseInt(process.env.REAL_CORE_METRICS_RETRIES || '3', 10) || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchMetricsRows();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(750 * attempt);
      }
    }
  }

  report.debug.metricsWarnings = report.debug.metricsWarnings || [];
  report.debug.metricsWarnings.push({
    phase,
    error: lastError?.message || 'metrics_unavailable',
    attempts
  });
  return [];
}

function normalizeBookingLocation(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function firstMoneyValue(...values) {
  for (const value of values) {
    const parsed = toMoney(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function firstPositiveInteger(...values) {
  for (const value of values) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function resolveRouteSnapshot(bookingResponse = {}, bookingHash = {}) {
  const data = bookingResponse?.data || {};
  const routeMetrics = data.routeMetrics || bookingResponse?.routeMetrics || {};
  const routeDistanceKm = firstMoneyValue(
    data.routeDistanceKm,
    bookingResponse.routeDistanceKm,
    routeMetrics.distanceKm,
    bookingHash.routeDistanceKm,
    bookingHash.estimatedTripDistanceKm
  );
  let routeDurationSecs = firstPositiveInteger(
    data.routeDurationSecs,
    bookingResponse.routeDurationSecs,
    routeMetrics.durationSecs,
    bookingHash.routeDurationSecs
  );
  const fallbackDistanceKm = routeDistanceKm || haversineDistanceKm(
    normalizeBookingLocation(data.pickupLocation || data.pickup) || null,
    normalizeBookingLocation(data.destinationLocation || data.destination || data.drop) || null
  );

  if (USE_SPEED_DERIVED_DURATION) {
    const speedDerivedDurationSecs = deriveDurationSecsAtSpeed(routeDistanceKm || fallbackDistanceKm);
    if (speedDerivedDurationSecs) {
      routeDurationSecs = speedDerivedDurationSecs;
    }
  }

  return {
    routeDistanceKm: routeDistanceKm || fallbackDistanceKm,
    routeDurationSecs,
    durationMinutes: routeDurationSecs ? Math.max(1, Math.round(routeDurationSecs / 60)) : null,
    simulationSpeedKmh: USE_SPEED_DERIVED_DURATION ? SIMULATION_SPEED_KMH : null,
    durationSource: USE_SPEED_DERIVED_DURATION ? 'speed_derived' : 'booking_route_metrics'
  };
}

function toIsoTimestamp(value, fallbackIso) {
  if (!value) return fallbackIso;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const str = String(value).trim();
  if (!str) return fallbackIso;

  const asNumber = Number.parseInt(str, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === str) {
    const fromMs = new Date(asNumber);
    if (!Number.isNaN(fromMs.getTime())) return fromMs.toISOString();
  }

  const fromText = new Date(str);
  if (!Number.isNaN(fromText.getTime())) return fromText.toISOString();
  return fallbackIso;
}

async function main() {
  const report = {
    meta: {
      scenario: 'real_core_e2e_cost',
      startedAt: new Date().toISOString(),
      serverUrl: WS_SERVER_URL,
      apiBaseUrl: API_BASE_URL,
      metricsUrl: METRICS_URL,
      mode: 'staging_real_execution',
      paymentMode: 'mock_bypass_only'
    },
    entities: {},
    flow: {
      steps: [],
      chatMessages: [],
      pickupCoordinates: [],
      tripCoordinates: []
    },
    outputs: {},
    debug: {},
    metrics: {},
    cost: {}
  };

  const passengerId = `real_passenger_${nowTag}`;
  const driverId = `real_driver_${nowTag}`;

  const route = resolveRouteFromEnv();
  const { pickup, destination, driverStart } = route;

  report.entities = {
    passengerId,
    driverId,
    routeName: route.name,
    pickup,
    destination,
    driverStart
  };

  const simulator = new RedisDriverSimulator();
  const redis = simulator;
  if (!shouldSkipGlobalDriverCleanup()) {
    await cleanupRealCoreDrivers(simulator);
  }
  const metricsBefore = await fetchMetricsRowsSafely(report, 'before');

  const passengerClient = new WebSocketTestClient(WS_SERVER_URL);
  const driverClient = new WebSocketTestClient(WS_SERVER_URL);

  let bookingId = null;

  try {
    // 1) Create users in DB (Redis + optional Firebase)
    await redis.hset(`user:${passengerId}`, {
      id: passengerId,
      firstName: 'Passageiro',
      lastName: 'Core',
      userType: 'customer',
      isActive: 'true',
      createdAt: new Date().toISOString()
    });

    await redis.hset(`driver:${driverId}`, {
      id: driverId,
      firstName: 'Motorista',
      lastName: 'Core',
      userType: 'driver',
      status: 'AVAILABLE',
      isOnline: 'true',
      createdAt: new Date().toISOString(),
      rating: '5.0'
    });

    const realtimeDb = getRealtimeDbSafe();
    if (realtimeDb) {
      await realtimeDb.ref(`users/${passengerId}`).set({
        id: passengerId,
        firstName: 'Passageiro',
        lastName: 'Core',
        userType: 'customer',
        createdAt: new Date().toISOString()
      });
      await realtimeDb.ref(`drivers/${driverId}`).set({
        id: driverId,
        firstName: 'Motorista',
        lastName: 'Core',
        userType: 'driver',
        status: 'AVAILABLE',
        createdAt: new Date().toISOString()
      });
    }
    report.flow.steps.push({ step: 'create_users', ok: true });

    // 2) Connect/auth
    await passengerClient.connect();
    await driverClient.connect();

    await passengerClient.authenticate(passengerId, 'customer');
    await driverClient.authenticate(driverId, 'driver');

    await simulator.setDriverOnline(driverId, driverStart.lat, driverStart.lng, 0, 0, true, false);
    if (DRIVER_ONLINE_SETTLE_MS > 0) {
      await sleep(DRIVER_ONLINE_SETTLE_MS);
    }
    report.flow.steps.push({ step: 'connect_and_auth', ok: true });

    // 3) Create booking + confirm payment mock
    const bookingResponse = await passengerClient.createBooking({
      customerId: passengerId,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: 0,
      paymentMethod: 'pix',
      carType: 'leafplus',
      selectedVehicle: 'leafplus'
    });

    bookingId = bookingResponse.bookingId;
    report.outputs.booking = bookingResponse;
    const lockedFare = resolveLockedFare(bookingResponse);
    if (lockedFare === null || lockedFare <= 0) {
      throw new Error(`locked_fare_missing:${bookingId}`);
    }
    report.outputs.lockedFare = {
      source: 'booking.data.estimatedFare',
      value: lockedFare,
      formatted: formatBrl(lockedFare)
    };

    const paymentResponse = await passengerClient.confirmPayment({
      bookingId,
      paymentMethod: 'pix',
      paymentId: `mock_payment_${nowTag}`,
      amount: lockedFare,
      enforceFareLock: true,
      mockPayment: true,
      __mockPayment: true
    });
    report.outputs.payment = paymentResponse;

    const rideRequestForDriver = await tryWaitForEvent(
      driverClient,
      'newRideRequest',
      15000,
      (evt) => (evt?.bookingId || evt?.rideId) === bookingId
    );
    report.outputs.rideRequestForDriver = rideRequestForDriver.ok ? rideRequestForDriver.data : null;
    report.debug.newRideRequest = rideRequestForDriver;
    if (!rideRequestForDriver.ok) {
      throw new Error(`ride_request_not_received:${bookingId}:${rideRequestForDriver.error || 'unknown'}`);
    }
    report.flow.steps.push({ step: 'booking_and_payment', ok: true, bookingId });

    await driverClient.acceptRide(bookingId);
    await passengerClient.waitForEvent('rideAccepted', 15000, (evt) => (evt?.bookingId || evt?.rideId) === bookingId);

    // 4) Driver displacement to pickup + persist coords
    const pickupPoints = buildLinePoints(driverStart, pickup, 6);
    const pickupDistanceKm = haversineDistanceKm(driverStart, pickup);
    const pickupDurationSecs = USE_SPEED_DERIVED_DURATION ? deriveDurationSecsAtSpeed(pickupDistanceKm) : null;
    const pickupStartedAtMs = Date.now();
    for (let i = 0; i < pickupPoints.length; i += 1) {
      const point = pickupPoints[i];
      const payload = timedCoordinatePayload({
        index: i,
        total: pickupPoints.length,
        durationSecs: pickupDurationSecs,
        startedAtMs: pickupStartedAtMs,
        basePayload: {
          driverId,
          lat: point.lat,
          lng: point.lng,
          heading: 90,
          speed: i === pickupPoints.length - 1 ? 0 : (USE_SPEED_DERIVED_DURATION ? SIMULATION_SPEED_KMH : 28),
          bookingId
        }
      });

      driverClient.socket.emit('updateDriverLocation', payload);
      await safeRedisEvidenceWrite(report, 'pickup_coordinate_rpush', () =>
        redis.rpush(`trip:coords:${bookingId}:pickup`, JSON.stringify(payload))
      );
      report.flow.pickupCoordinates.push(payload);
      await sleep(350);
    }

    const arrivedAtPickupAck = await (async () => {
      try {
        const data = await driverClient.arrivedAtPickup(bookingId, { location: pickup, timeoutMs: 15000 });
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    })();
    report.debug.arrivedAtPickup = arrivedAtPickupAck;
    const activeBookingAfterAccept = await redis.hget('bookings:active', bookingId);
    const bookingHashAfterAccept = await redis.hgetall(`booking:${bookingId}`);
    report.debug.bookingStateAfterAccept = {
      bookingHash: bookingHashAfterAccept,
      activeBooking: activeBookingAfterAccept ? JSON.parse(activeBookingAfterAccept) : null
    };
    const routeSnapshot = resolveRouteSnapshot(bookingResponse, bookingHashAfterAccept);
    if (!routeSnapshot.routeDistanceKm) {
      throw new Error(`route_distance_missing:${bookingId}`);
    }
    report.outputs.routeSnapshot = {
      ...routeSnapshot,
      pickup,
      destination
    };
    report.flow.steps.push({ step: 'accept_and_driver_to_pickup', ok: true });

    // Open trip chat with retries, because chat policy may lag a few seconds after acceptRide.
    let chatCreationAck = null;
    for (let attempt = 1; attempt <= CHAT_CREATION_ATTEMPTS; attempt += 1) {
      passengerClient.socket.emit('createChat', {
        bookingId,
        participants: [passengerId, driverId],
        type: 'trip_chat'
      });

      // Allow socket handlers to process and populate event history before waiting.
      await sleep(120);

      const created = await tryWaitForEvent(
        passengerClient,
        'chatCreated',
        1200,
        (evt) => evt?.bookingId === bookingId || evt?.chatId === bookingId
      );
      if (created.ok) {
        chatCreationAck = { ...created, attempt };
        break;
      }

      const chatError = await tryWaitForEvent(
        passengerClient,
        'chatError',
        500,
        (evt) => (evt?.bookingId || evt?.chatId) === bookingId || !evt?.bookingId
      );
      chatCreationAck = { ...chatError, attempt };
      await sleep(700);
    }
    report.debug.chatCreation = chatCreationAck;
    const tripChatAvailable = Boolean(chatCreationAck?.ok && chatCreationAck?.event === 'chatCreated');

    // 5) 6 chat messages (real socket events)
    const chatScript = [
      { from: 'passenger', text: 'Oi! Estou no portão principal.' },
      { from: 'driver', text: 'Perfeito, chego em 2 minutos.' },
      { from: 'passenger', text: 'Vou ficar de camisa azul.' },
      { from: 'driver', text: 'Vi você no mapa, já estou na esquina.' },
      { from: 'passenger', text: 'Beleza, te vi chegando.' },
      { from: 'driver', text: 'Pode entrar, estou de Civic prata.' }
    ];

    if (tripChatAvailable) {
      for (const msg of chatScript) {
        const senderClient = msg.from === 'passenger' ? passengerClient : driverClient;
        const senderId = msg.from === 'passenger' ? passengerId : driverId;
        const receiverId = msg.from === 'passenger' ? driverId : passengerId;
        const senderType = msg.from === 'passenger' ? 'passenger' : 'driver';

        senderClient.socket.emit('sendMessage', {
          bookingId,
          senderId,
          receiverId,
          senderType,
          message: msg.text
        });

        const receiverClient = msg.from === 'passenger' ? driverClient : passengerClient;
        const sendAck = await Promise.race([
          tryWaitForEvent(senderClient, 'messageSent', 12000, (evt) => evt?.bookingId === bookingId && evt?.text === msg.text),
          tryWaitForEvent(senderClient, 'messageError', 12000, () => true),
          tryWaitForEvent(receiverClient, 'newMessage', 12000, (evt) => evt?.bookingId === bookingId && evt?.message === msg.text)
        ]);

        if (!sendAck?.ok && sendAck?.event !== 'newMessage') {
          throw new Error(`Falha ao enviar mensagem de chat: ${sendAck?.error || 'ack ausente'}`);
        }
        if (sendAck?.ok && sendAck?.event === 'messageError') {
          throw new Error(`Falha ao enviar mensagem de chat: ${sendAck.data?.error || 'messageError'}`);
        }

        report.flow.chatMessages.push({ from: msg.from, text: msg.text, at: new Date().toISOString() });
        await sleep(200);
      }
    }

    report.flow.steps.push({
      step: 'chat_6_messages',
      ok: tripChatAvailable,
      skipped: !tripChatAvailable,
      total: report.flow.chatMessages.length,
      reason: tripChatAvailable ? '' : (chatCreationAck?.error || 'chatCreated ausente')
    });

    // 6) Start trip + ride coordinates
    await driverClient.startTrip({ bookingId, startLocation: pickup });
    await passengerClient.waitForEvent('tripStarted', 15000, (evt) => (evt?.bookingId || evt?.rideId) === bookingId);

    const tripPoints = buildLinePoints(pickup, destination, 9);
    const tripStartedAtMs = Date.now();
    for (let i = 0; i < tripPoints.length; i += 1) {
      const point = tripPoints[i];
      const payload = timedCoordinatePayload({
        index: i,
        total: tripPoints.length,
        durationSecs: USE_SPEED_DERIVED_DURATION ? routeSnapshot.routeDurationSecs : null,
        startedAtMs: tripStartedAtMs,
        basePayload: {
          bookingId,
          driverId,
          lat: point.lat,
          lng: point.lng,
          heading: 95,
          speed: i === tripPoints.length - 1 ? 0 : (USE_SPEED_DERIVED_DURATION ? SIMULATION_SPEED_KMH : 36)
        }
      });

      driverClient.socket.emit('updateTripLocation', payload);
      driverClient.socket.emit('updateDriverLocation', payload);
      await safeRedisEvidenceWrite(report, 'trip_coordinate_rpush', () =>
        redis.rpush(`trip:coords:${bookingId}:trip`, JSON.stringify(payload))
      );
      report.flow.tripCoordinates.push(payload);
      await sleep(300);
    }

    report.flow.steps.push({ step: 'trip_coordinates_persisted', ok: true, total: report.flow.tripCoordinates.length });

    // 7) Complete trip
    const completeResponse = await driverClient.finishTrip({
      bookingId,
      endLocation: destination,
      distance: routeSnapshot.routeDistanceKm,
      duration: routeSnapshot.durationMinutes,
      fare: lockedFare,
      mockPayment: true,
      __mockPayment: true
    });
    report.outputs.completeTrip = completeResponse;
    const tripCompleted = await waitForTripCompletedOrStateFallback({
      passengerClient,
      driverClient,
      redis,
      bookingId,
      timeoutMs: 20000
    });
    report.outputs.tripCompletedPassenger = tripCompleted.passenger;
    report.outputs.tripCompletedDriver = tripCompleted.driver;
    report.outputs.tripCompletedSource = tripCompleted.source;
    if (tripCompleted.bookingHash) {
      report.debug.bookingStateAfterComplete = tripCompleted.bookingHash;
    }
    const fareConsistency = assertFareConsistency({
      quote: lockedFare,
      payment: paymentResponse?.data?.amount ?? paymentResponse?.amount,
      finalFare:
        completeResponse?.fare ??
        completeResponse?.finalFare ??
        completeResponse?.data?.finalFare ??
        tripCompleted?.bookingHash?.finalFare,
      context: bookingId
    });
    report.outputs.financialConsistency = {
      ok: true,
      ...fareConsistency
    };
    report.flow.steps.push({ step: 'complete_trip', ok: true });

    // 8) Persist final ride snapshot
    const bookingHash = await redis.hgetall(`booking:${bookingId}`);
    const pickupSaved = normalizeBookingLocation(bookingHash.pickupLocation) || pickup;
    const dropSaved = normalizeBookingLocation(bookingHash.destinationLocation || bookingHash.drop) || destination;

    const finalSnapshot = {
      bookingId,
      passengerId,
      driverId,
      status: bookingHash.status || 'COMPLETED',
      fare: Number(bookingHash.finalFare || lockedFare),
      distanceKm: Number(bookingHash.distance || routeSnapshot.routeDistanceKm),
      routeDistanceKm: routeSnapshot.routeDistanceKm,
      routeDurationSecs: routeSnapshot.routeDurationSecs,
      simulationSpeedKmh: routeSnapshot.simulationSpeedKmh,
      durationSource: routeSnapshot.durationSource,
      chatMessages: report.flow.chatMessages.length,
      pickupCoordsCount: report.flow.pickupCoordinates.length,
      tripCoordsCount: report.flow.tripCoordinates.length,
      completedAt: new Date().toISOString()
    };

    await safeRedisEvidenceWrite(report, 'trip_summary_hset', () =>
      redis.hset(`trip:summary:${bookingId}`, Object.fromEntries(Object.entries(finalSnapshot).map(([k, v]) => [k, String(v)])))
    );

    const realtimeDb2 = getRealtimeDbSafe();
    if (realtimeDb2) {
      await realtimeDb2.ref(`rides/${bookingId}/simulation`).set(finalSnapshot);
    }

    report.outputs.finalSnapshot = finalSnapshot;
    report.flow.steps.push({ step: 'persist_final_ride_data', ok: true });

    // 9) Emit receipt evidence (generate local PDF artifact)
    const nowIso = new Date().toISOString();
    const bookingDateIso = toIsoTimestamp(
      bookingHash.createdAt || bookingHash.timestamp || bookingHash.created_at,
      nowIso
    );
    const tripStartIso = toIsoTimestamp(
      bookingHash.tripStartTime || bookingHash.startedAt || bookingHash.startTime || bookingHash.started_at || bookingDateIso,
      bookingDateIso
    );
    const tripEndIso = toIsoTimestamp(
      bookingHash.endTime || bookingHash.completedAt || bookingHash.endedAt || nowIso,
      nowIso
    );

    const receiptData = {
      ...bookingHash,
      pickup: {
        add: pickupSaved?.address || pickupSaved?.add || pickup.address,
        lat: pickupSaved?.lat || pickup.lat,
        lng: pickupSaved?.lng || pickup.lng
      },
      drop: {
        add: dropSaved?.address || dropSaved?.add || destination.address,
        lat: dropSaved?.lat || destination.lat,
        lng: dropSaved?.lng || destination.lng
      },
      customer: passengerId,
      driver: driverId,
      customer_name: 'Passageiro Core',
      driver_name: 'Motorista Core',
      finalPrice: lockedFare,
      distance: 6400,
      payment_mode: 'pix',
      payment_status: 'completed',
      bookingDate: bookingDateIso,
      tripStartTime: tripStartIso,
      endTime: tripEndIso,
      completedAt: tripEndIso,
      paymentDate: tripEndIso,
      status: 'COMPLETED'
    };

    const receipt = {
      receiptId: `receipt_${bookingId}`,
      bookingId,
      hash: createReceiptHash(bookingId, receiptData),
      pickup: receiptData.pickup,
      drop: receiptData.drop,
      customer: receiptData.customer,
      driver: receiptData.driver,
      financial: {
        totalPaid: {
          value: lockedFare,
          formatted: formatBrl(lockedFare)
        }
      }
    };
    const receiptPdf = await generateReceiptPdfBuffer(receipt);

    report.outputs.receipt = {
      receiptId: receipt.receiptId,
      hash: receipt.hash,
      totalPaid: receipt.financial?.totalPaid?.formatted || null,
      pdfBytes: receiptPdf.length
    };
    report.flow.steps.push({ step: 'receipt_generated', ok: true });

    // 10) Submit rating and verify receiving side
    passengerClient.socket.emit('submitRating', {
      tripId: bookingId,
      bookingId,
      rating: 5,
      comment: 'Corrida excelente, motorista muito atencioso.',
      driverId,
      userId: passengerId,
      userType: 'passenger'
    });

    const ratingSubmitted = await tryWaitForEvent(
      passengerClient,
      'ratingSubmitted',
      RATING_EVENT_TIMEOUT_MS,
      (evt) => evt?.tripId === bookingId && evt?.success === true
    );
    const ratingReceived = await tryWaitForEvent(
      driverClient,
      'ratingReceived',
      RATING_EVENT_TIMEOUT_MS,
      (evt) => evt?.tripId === bookingId && evt?.success === true
    );

    report.outputs.rating = {
      submitted: ratingSubmitted.ok ? ratingSubmitted.data : null,
      received: ratingReceived.ok ? ratingReceived.data : null,
      submittedAck: ratingSubmitted,
      receivedAck: ratingReceived
    };
    report.flow.steps.push({
      step: 'rating_submitted_and_received',
      ok: ratingSubmitted.ok,
      driverNotificationReceived: ratingReceived.ok,
      reason: ratingSubmitted.ok ? '' : ratingSubmitted.error
    });

    // 11) Metrics delta
    const metricsAfter = await fetchMetricsRowsSafely(report, 'after');

    const redisOps = ['hset', 'hgetall', 'geoadd', 'georadius', 'zrem', 'expire', 'set', 'get', 'del', 'xadd', 'zadd'];
    const redisDelta = redisOps
      .map((op) => ({
        operation: op,
        successCount: metricDelta(metricsBefore, metricsAfter, 'leaf_redis_duration_seconds_count', { operation: op, status: 'success' }),
        failureCount: metricDelta(metricsBefore, metricsAfter, 'leaf_redis_duration_seconds_count', { operation: op, status: 'failure' }),
        totalDurationSeconds: metricDelta(metricsBefore, metricsAfter, 'leaf_redis_duration_seconds_sum', { operation: op, status: 'success' })
      }))
      .filter((row) => row.successCount !== 0 || row.failureCount !== 0);

    const commands = ['request_ride', 'accept_ride', 'start_trip', 'complete_trip'];
    const commandDelta = commands
      .map((cmd) => ({
        command: cmd,
        successCount: metricDelta(metricsBefore, metricsAfter, 'leaf_command_total', { command_name: cmd, status: 'success' }),
        failureCount: metricDelta(metricsBefore, metricsAfter, 'leaf_command_total', { command_name: cmd, status: 'failure' }),
        durationSeconds: metricDelta(metricsBefore, metricsAfter, 'leaf_command_duration_seconds_sum', { command_name: cmd, status: 'success' })
      }))
      .filter((row) => row.successCount !== 0 || row.failureCount !== 0);

    const eventPublishedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_event_published_total', {});
    const eventConsumedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_event_consumed_total', {});

    const ridesRequestedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_rides_requested_total', {});
    const ridesAcceptedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_rides_accepted_total', {});
    const ridesCompletedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_rides_completed_total', {});

    report.metrics = {
      redis: redisDelta,
      commands: commandDelta,
      events: {
        publishedTotalDelta: eventPublishedDelta,
        consumedTotalDelta: eventConsumedDelta
      },
      rides: {
        requestedDelta: ridesRequestedDelta,
        acceptedDelta: ridesAcceptedDelta,
        completedDelta: ridesCompletedDelta
      },
      apiCalls: {
        websocket: {
          createBooking: 1,
          confirmPayment: 1,
          updateDriverLocation: report.flow.pickupCoordinates.length + report.flow.tripCoordinates.length,
          sendMessage: report.flow.chatMessages.length,
          startTrip: 1,
          updateTripLocation: report.flow.tripCoordinates.length,
          completeTrip: 1,
          submitRating: 1
        },
        http: {
          metricsScrapes: 2,
          otherCoreCalls: 0
        },
        externalProvidersObserved: {
          googlePlaces: 0,
          googleDirections: 0,
          woovi: 0,
          notes: 'Execucao usou coordenadas predefinidas + pagamento mock.'
        }
      }
    };

    // Local execution monetary cost is effectively zero for provider billing.
    report.cost = {
      executionCurrency: 'BRL',
      localExecution: {
        providerBillableCost: 0,
        description: 'Execucao em staging real com Redis remoto e pagamento mock.'
      },
      technicalConsumptionSummary: {
        redisSuccessfulOps: redisDelta.reduce((acc, item) => acc + item.successCount, 0),
        redisDurationSeconds: Number(redisDelta.reduce((acc, item) => acc + item.totalDurationSeconds, 0).toFixed(6)),
        commandSuccess: commandDelta.reduce((acc, item) => acc + item.successCount, 0),
        commandDurationSeconds: Number(commandDelta.reduce((acc, item) => acc + item.durationSeconds, 0).toFixed(6)),
        wsMessages: report.flow.chatMessages.length,
        pickupCoordinatesPersisted: report.flow.pickupCoordinates.length,
        tripCoordinatesPersisted: report.flow.tripCoordinates.length
      }
    };

    report.meta.finishedAt = new Date().toISOString();
    report.meta.status = 'success';
  } catch (error) {
    report.meta.finishedAt = new Date().toISOString();
    report.meta.status = 'failed';
    report.meta.error = error.message;
    report.meta.stack = error.stack;
    if (error.context && typeof error.context === 'object') {
      report.debug.errorContext = error.context;
    }
  } finally {
    try {
      if (bookingId) {
        await redis.expire(`trip:coords:${bookingId}:pickup`, 86400);
        await redis.expire(`trip:coords:${bookingId}:trip`, 86400);
        await redis.expire(`trip:summary:${bookingId}`, 86400);
      }
    } catch (_e) {
      // ignore cleanup errors
    }

    passengerClient.disconnect();
    driverClient.disconnect();
    await cleanupOwnDriver(simulator, driverId);
  }

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  const reportFile = path.join(REPORT_DIR, `real-core-e2e-cost-${nowTag}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    reportFile,
    status: report.meta.status,
    bookingId: report.outputs?.booking?.bookingId || null,
    passengerId: report.entities?.passengerId,
    driverId: report.entities?.driverId,
    redisOps: report.cost?.technicalConsumptionSummary?.redisSuccessfulOps || 0,
    commandSuccess: report.cost?.technicalConsumptionSummary?.commandSuccess || 0
  }, null, 2));

  if (report.meta.status !== 'success') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
