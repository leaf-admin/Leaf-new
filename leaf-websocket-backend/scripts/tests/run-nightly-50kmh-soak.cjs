#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const RedisDriverSimulator = require('../../tests/e2e/backend/__helpers__/redis-driver-simulator');

const backendDir = path.resolve(__dirname, '..', '..');
const rootDir = path.resolve(backendDir, '..');

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

const WS_SERVER_URL = process.env.REAL_CORE_WS_URL || process.env.WS_URL || process.env.REAL_CORE_SERVER_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = deriveApiBaseUrl(process.env.REAL_CORE_SERVER_URL || WS_SERVER_URL);
const METRICS_URL = process.env.REAL_CORE_METRICS_URL || process.env.PRELAUNCH_METRICS_URL || `${API_BASE_URL}/api/metrics/prometheus`;
const SPEED_KMH = Number.parseFloat(process.env.NIGHT_SOAK_SPEED_KMH || process.env.REAL_CORE_SIMULATION_SPEED_KMH || '50');
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.NIGHT_SOAK_CONCURRENCY || '3', 10) || 3);
const BATCH_SIZE = Math.max(1, Number.parseInt(process.env.NIGHT_SOAK_BATCH_SIZE || String(CONCURRENCY), 10) || CONCURRENCY);
const CLEANUP_STALE_DRIVERS_ON_START = String(
  process.env.NIGHT_SOAK_CLEANUP_STALE_DRIVERS_ON_START || 'true'
).toLowerCase() !== 'false';
const MIN_IDLE_MS = Math.max(0, Number.parseInt(process.env.NIGHT_SOAK_MIN_IDLE_MS || '20000', 10) || 20000);
const MAX_IDLE_MS = Math.max(MIN_IDLE_MS, Number.parseInt(process.env.NIGHT_SOAK_MAX_IDLE_MS || '90000', 10) || 90000);
const MAX_RIDES = Math.max(0, Number.parseInt(process.env.NIGHT_SOAK_MAX_RIDES || '0', 10) || 0);
const END_HOUR = Math.max(0, Math.min(23, Number.parseInt(process.env.NIGHT_SOAK_END_HOUR || '6', 10) || 6));
const END_MINUTE = Math.max(0, Math.min(59, Number.parseInt(process.env.NIGHT_SOAK_END_MINUTE || '0', 10) || 0));
const RUN_TAG = process.env.NIGHT_SOAK_RUN_TAG || `${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}_${crypto.randomBytes(3).toString('hex')}`;
const ROUTE_CATEGORY_FILTER = new Set(
  String(process.env.NIGHT_SOAK_ROUTE_CATEGORIES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const ROUTE_NAME_FILTER = new Set(
  String(process.env.NIGHT_SOAK_ROUTE_NAMES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const RUN_DIR = path.join(rootDir, 'reports', 'prelaunch', `nightly-50kmh-soak-${RUN_TAG}`);
const LOG_DIR = path.join(RUN_DIR, 'logs');
const EVENTS_FILE = path.join(RUN_DIR, 'events.jsonl');
const SUMMARY_FILE = path.join(RUN_DIR, 'summary.json');
const MARKDOWN_FILE = path.join(RUN_DIR, 'nightly-50kmh-soak-report.md');

const routes = [
  {
    category: 'short',
    name: 'Copacabana Palace -> Forte de Copacabana',
    pickup: { lat: -22.971964, lng: -43.182543, address: 'Copacabana Palace, Rio de Janeiro, RJ' },
    destination: { lat: -22.986496, lng: -43.189304, address: 'Forte de Copacabana, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9708, lng: -43.1819, address: 'Driver near Copacabana Palace' }
  },
  {
    category: 'short',
    name: 'General Osorio -> Arpoador',
    pickup: { lat: -22.984703, lng: -43.197407, address: 'Praca General Osorio, Rio de Janeiro, RJ' },
    destination: { lat: -22.988502, lng: -43.19156, address: 'Arpoador, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.98419, lng: -43.19711, address: 'Driver near Ipanema' }
  },
  {
    category: 'short',
    name: 'Leblon -> Jardim de Alah',
    pickup: { lat: -22.984843, lng: -43.221972, address: 'Leblon, Rio de Janeiro, RJ' },
    destination: { lat: -22.983612, lng: -43.214087, address: 'Jardim de Alah, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.98428, lng: -43.22138, address: 'Driver near Leblon' }
  },
  {
    category: 'short',
    name: 'Botafogo Praia Shopping -> Urca',
    pickup: { lat: -22.951912, lng: -43.182182, address: 'Botafogo Praia Shopping, Rio de Janeiro, RJ' },
    destination: { lat: -22.94851, lng: -43.16337, address: 'Urca, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.95242, lng: -43.18162, address: 'Driver near Botafogo' }
  },
  {
    category: 'medium',
    name: 'Copacabana Palace -> Leblon',
    pickup: { lat: -22.971964, lng: -43.182543, address: 'Copacabana Palace, Rio de Janeiro, RJ' },
    destination: { lat: -22.984843, lng: -43.221972, address: 'Leblon, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9708, lng: -43.1819, address: 'Driver near Copacabana Palace' }
  },
  {
    category: 'medium',
    name: 'Praia Vermelha -> Copacabana Posto 4',
    pickup: { lat: -22.9542, lng: -43.1654, address: 'Praia Vermelha, Rio de Janeiro, RJ' },
    destination: { lat: -22.971071, lng: -43.186829, address: 'Copacabana Posto 4, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9538, lng: -43.165, address: 'Driver near Praia Vermelha' }
  },
  {
    category: 'medium',
    name: 'Gavea -> Flamengo',
    pickup: { lat: -22.97986, lng: -43.232533, address: 'PUC Gavea, Rio de Janeiro, RJ' },
    destination: { lat: -22.932827, lng: -43.172896, address: 'Aterro do Flamengo, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9801, lng: -43.2319, address: 'Driver near Gavea' }
  },
  {
    category: 'medium',
    name: 'Lagoa -> Botafogo',
    pickup: { lat: -22.973001, lng: -43.213372, address: 'Lagoa Rodrigo de Freitas, Rio de Janeiro, RJ' },
    destination: { lat: -22.950726, lng: -43.184684, address: 'Botafogo, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.97252, lng: -43.21304, address: 'Driver near Lagoa' }
  },
  {
    category: 'long',
    name: 'Copacabana -> Barra Shopping',
    pickup: { lat: -22.971964, lng: -43.182543, address: 'Copacabana, Rio de Janeiro, RJ' },
    destination: { lat: -22.99922, lng: -43.36534, address: 'Barra Shopping, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9708, lng: -43.1819, address: 'Driver near Copacabana' }
  },
  {
    category: 'long',
    name: 'Leblon -> Tijuca',
    pickup: { lat: -22.984843, lng: -43.221972, address: 'Leblon, Rio de Janeiro, RJ' },
    destination: { lat: -22.92493, lng: -43.232907, address: 'Praca Saens Pena, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.98428, lng: -43.22138, address: 'Driver near Leblon' }
  },
  {
    category: 'long',
    name: 'Botafogo -> Maracana',
    pickup: { lat: -22.951912, lng: -43.182182, address: 'Botafogo, Rio de Janeiro, RJ' },
    destination: { lat: -22.912115, lng: -43.230182, address: 'Maracana, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.95242, lng: -43.18162, address: 'Driver near Botafogo' }
  },
  {
    category: 'long',
    name: 'Sao Conrado -> Recreio',
    pickup: { lat: -22.998602, lng: -43.256704, address: 'Sao Conrado, Rio de Janeiro, RJ' },
    destination: { lat: -23.018771, lng: -43.477446, address: 'Recreio dos Bandeirantes, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.99812, lng: -43.25618, address: 'Driver near Sao Conrado' }
  }
];

let stopRequested = false;
process.on('SIGINT', () => { stopRequested = true; });
process.on('SIGTERM', () => { stopRequested = true; });

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function localEndAt() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(END_HOUR, END_MINUTE, 0, 0);
  if (end <= now) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function cleanupStaleRealCoreDrivers() {
  const simulator = new RedisDriverSimulator();
  try {
    const keys = await simulator.keys('driver:real_driver_*');
    const driverIds = keys
      .map((key) => String(key || '').replace(/^driver:/, ''))
      .filter((driverId) => driverId.startsWith('real_driver_'));

    const chunkSize = 12;
    let removed = 0;
    const failed = [];
    for (let index = 0; index < driverIds.length; index += chunkSize) {
      const chunk = driverIds.slice(index, index + chunkSize);
      const results = await Promise.allSettled(chunk.map((driverId) => simulator.removeDriver(driverId)));
      results.forEach((result, resultIndex) => {
        if (result.status === 'fulfilled') {
          removed += 1;
        } else {
          failed.push({
            driverId: chunk[resultIndex],
            error: result.reason?.message || String(result.reason)
          });
        }
      });
    }

    return { ok: failed.length === 0, found: driverIds.length, removed, failed };
  } catch (error) {
    return { ok: false, found: 0, removed: 0, failed: [], error: error.message };
  }
}

function extractJsonObject(text) {
  const source = String(text || '');
  const starts = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{') starts.push(index);
  }

  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const candidate = source.slice(starts[i]).trim();
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_error) {
      // try previous object
    }
  }
  return null;
}

async function checkGeofence(route) {
  const url = `${API_BASE_URL}/api/geofence/check?lat=${encodeURIComponent(route.pickup.lat)}&lng=${encodeURIComponent(route.pickup.lng)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const body = await response.json().catch(() => ({}));
    const allowed = response.ok && body.success !== false && body.isAllowed !== false;
    return {
      route: route.name,
      pickup: route.pickup,
      allowed,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      route: route.name,
      pickup: route.pickup,
      allowed: true,
      warning: `geofence_check_unavailable:${error.message}`
    };
  }
}

async function resolveAllowedRoutes() {
  const checks = await Promise.all(routes.map(checkGeofence));
  fs.writeFileSync(path.join(RUN_DIR, 'geofence-checks.json'), `${JSON.stringify(checks, null, 2)}\n`);
  const allowedNames = new Set(checks.filter((check) => check.allowed).map((check) => check.route));
  const allowed = routes.filter((route) => {
    if (!allowedNames.has(route.name)) return false;
    if (ROUTE_CATEGORY_FILTER.size && !ROUTE_CATEGORY_FILTER.has(String(route.category || '').toLowerCase())) {
      return false;
    }
    if (ROUTE_NAME_FILTER.size && !ROUTE_NAME_FILTER.has(String(route.name || '').toLowerCase())) {
      return false;
    }
    return true;
  });
  if (!allowed.length) {
    throw new Error('no_allowed_pickup_routes_for_nightly_soak');
  }
  return allowed;
}

function routeForIndex(allowedRoutes, rideNumber) {
  const preferredCategory = ['short', 'medium', 'long', 'medium', 'short', 'long'][rideNumber % 6];
  const candidates = allowedRoutes.filter((route) => route.category === preferredCategory);
  const pool = candidates.length ? candidates : allowedRoutes;
  return pool[(rideNumber + randomBetween(0, pool.length - 1)) % pool.length];
}

function toMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function parseReceiptValue(value) {
  if (typeof value !== 'string') return toMoney(value);
  return toMoney(value.replace(/[^0-9,.-]/g, '').replace(',', '.'));
}

function readRideEvidence(childSummary) {
  const reportFile = childSummary?.reportFile;
  if (!reportFile || !fs.existsSync(reportFile)) return null;
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const booking = report.outputs?.booking?.data || {};
  const finalSnapshot = report.outputs?.finalSnapshot || {};
  const complete = report.outputs?.completeTrip || {};

  return {
    reportFile,
    status: report.meta?.status || childSummary.status,
    error: report.meta?.error || '',
    errorContext: report.debug?.errorContext || null,
    bookingId: childSummary.bookingId || report.outputs?.booking?.bookingId || booking.bookingId || '',
    passengerId: childSummary.passengerId || report.entities?.passengerId || '',
    driverId: childSummary.driverId || report.entities?.driverId || '',
    quote: toMoney(report.outputs?.lockedFare?.value || booking.estimatedFare),
    payment: toMoney(report.outputs?.payment?.data?.amount || report.outputs?.payment?.amount),
    finalFare: toMoney(complete.fare || complete.finalFare || finalSnapshot.fare),
    receipt: parseReceiptValue(report.outputs?.receipt?.totalPaid),
    operationalFee: toMoney(complete.operationalFee || booking.estimatedOperationalFee),
    wooviFee: toMoney(complete.paymentIntermediationFee || booking.estimatedPaymentIntermediationFee),
    totalFees: toMoney(complete.totalFees || booking.estimatedTotalFees),
    driverNet: toMoney(complete.driverNetAmount || booking.estimatedDriverNetAmount),
    distanceKm: toMoney(finalSnapshot.routeDistanceKm || finalSnapshot.distanceKm || report.outputs?.routeSnapshot?.routeDistanceKm),
    simulatedDurationSecs: Number(finalSnapshot.routeDurationSecs || report.outputs?.routeSnapshot?.routeDurationSecs || 0),
    durationSource: finalSnapshot.durationSource || report.outputs?.routeSnapshot?.durationSource || '',
    simulationSpeedKmh: Number(finalSnapshot.simulationSpeedKmh || report.outputs?.routeSnapshot?.simulationSpeedKmh || 0),
    chatMessages: Number(finalSnapshot.chatMessages || report.flow?.chatMessages?.length || 0),
    financialConsistency: Boolean(report.outputs?.financialConsistency?.ok),
    finalStatus: finalSnapshot.status || '',
    redisOps: Number(childSummary.redisOps || report.cost?.technicalConsumptionSummary?.redisSuccessfulOps || 0)
  };
}

function runRide(route, rideNumber) {
  return new Promise((resolve) => {
    const rideTag = `night50_${RUN_TAG}_${String(rideNumber).padStart(4, '0')}_${crypto.randomBytes(2).toString('hex')}`;
    const logFile = path.join(LOG_DIR, `ride_${String(rideNumber).padStart(4, '0')}.log`);
    const startedAt = new Date();
    let output = '';

    const child = spawn(process.execPath, ['scripts/tests/run-real-core-e2e-cost.cjs'], {
      cwd: backendDir,
      env: {
        ...process.env,
        WS_URL: WS_SERVER_URL,
        API_BASE_URL,
        REAL_CORE_WS_URL: WS_SERVER_URL,
        REAL_CORE_API_BASE_URL: API_BASE_URL,
        REAL_CORE_METRICS_URL: METRICS_URL,
        REAL_CORE_RUN_TAG: rideTag,
        REAL_CORE_ROUTE_JSON: JSON.stringify(route),
        REAL_CORE_SKIP_GLOBAL_DRIVER_CLEANUP: 'true',
        REAL_CORE_DRIVER_ONLINE_SETTLE_MS: process.env.REAL_CORE_DRIVER_ONLINE_SETTLE_MS || '1200',
        REAL_CORE_SIMULATION_SPEED_KMH: String(SPEED_KMH),
        REAL_CORE_USE_SPEED_DERIVED_DURATION: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });

    child.on('close', (code) => {
      fs.writeFileSync(logFile, output);
      const childSummary = extractJsonObject(output);
      const evidence = readRideEvidence(childSummary);
      const result = {
        rideNumber,
        routeName: route.name,
        category: route.category,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: code,
        status: code === 0 && childSummary?.status === 'success' && evidence?.financialConsistency ? 'passed' : 'failed',
        childSummary,
        evidence,
        logFile
      };
      fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(result)}\n`);
      resolve(result);
    });
  });
}

function summarize(results, startedAt, endAt) {
  const passed = results.filter((result) => result.status === 'passed');
  const failed = results.filter((result) => result.status !== 'passed');
  const evidenceRows = results.map((result) => result.evidence).filter(Boolean);
  const byCategory = {};

  for (const result of results) {
    byCategory[result.category] = byCategory[result.category] || { total: 0, passed: 0, failed: 0 };
    byCategory[result.category].total += 1;
    if (result.status === 'passed') byCategory[result.category].passed += 1;
    else byCategory[result.category].failed += 1;
  }

  const sum = (field) => Math.round(evidenceRows.reduce((acc, evidence) => acc + Number(evidence?.[field] || 0), 0) * 100) / 100;
  const summary = {
    runTag: RUN_TAG,
    status: failed.length === 0 ? 'passed_so_far' : 'has_failures',
    startedAt,
    updatedAt: new Date().toISOString(),
    plannedEndAt: endAt.toISOString(),
    apiBaseUrl: API_BASE_URL,
    wsUrl: WS_SERVER_URL,
    speedKmh: SPEED_KMH,
    totalRides: results.length,
    passed: passed.length,
    failed: failed.length,
    byCategory,
    totals: {
      quote: sum('quote'),
      payment: sum('payment'),
      finalFare: sum('finalFare'),
      receipt: sum('receipt'),
      operationalFee: sum('operationalFee'),
      wooviFee: sum('wooviFee'),
      totalFees: sum('totalFees'),
      driverNet: sum('driverNet'),
      distanceKm: sum('distanceKm'),
      simulatedDurationSecs: Math.round(evidenceRows.reduce((acc, evidence) => acc + Number(evidence?.simulatedDurationSecs || 0), 0)),
      redisOps: Math.round(evidenceRows.reduce((acc, evidence) => acc + Number(evidence?.redisOps || 0), 0))
    },
    results: results.map((result) => ({
      rideNumber: result.rideNumber,
      status: result.status,
      category: result.category,
      routeName: result.routeName,
      bookingId: result.evidence?.bookingId || '',
      passengerId: result.evidence?.passengerId || '',
      driverId: result.evidence?.driverId || '',
      quote: result.evidence?.quote || 0,
      finalFare: result.evidence?.finalFare || 0,
      distanceKm: result.evidence?.distanceKm || 0,
      simulatedDurationSecs: result.evidence?.simulatedDurationSecs || 0,
      chatMessages: result.evidence?.chatMessages || 0,
      error: result.evidence?.error || result.childSummary?.error || '',
      errorContext: result.evidence?.errorContext || null,
      reportFile: result.evidence?.reportFile ? path.relative(rootDir, result.evidence.reportFile) : '',
      logFile: path.relative(rootDir, result.logFile)
    }))
  };

  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  writeMarkdown(summary);
  return summary;
}

function writeMarkdown(summary) {
  const lines = [
    `# Nightly 50 km/h Soak - ${RUN_TAG}`,
    '',
    `- Status: **${summary.status}**`,
    `- API: ${summary.apiBaseUrl}`,
    `- Socket: ${summary.wsUrl}`,
    `- Speed model: ${summary.speedKmh} km/h`,
    `- Started: ${summary.startedAt}`,
    `- Planned end: ${summary.plannedEndAt}`,
    `- Updated: ${summary.updatedAt}`,
    `- Rides: ${summary.passed}/${summary.totalRides} passed, ${summary.failed} failed`,
    '',
    '## Totals',
    '',
    `- Gross quote: R$ ${summary.totals.quote.toFixed(2)}`,
    `- Final fare: R$ ${summary.totals.finalFare.toFixed(2)}`,
    `- Operational fee: R$ ${summary.totals.operationalFee.toFixed(2)}`,
    `- Woovi/intermediation fee: R$ ${summary.totals.wooviFee.toFixed(2)}`,
    `- Driver net: R$ ${summary.totals.driverNet.toFixed(2)}`,
    `- Distance: ${summary.totals.distanceKm.toFixed(2)} km`,
    `- Simulated driving time: ${Math.round(summary.totals.simulatedDurationSecs / 60)} min`,
    `- Redis successful ops: ${summary.totals.redisOps}`,
    '',
    '## Rides',
    '',
    '| # | Status | Type | Route | Booking | Fare | Km | Sim s | Chat | Error | Evidence |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |'
  ];

  for (const result of summary.results) {
    lines.push([
      result.rideNumber,
      result.status,
      result.category,
      result.routeName,
      result.bookingId,
      result.finalFare.toFixed(2),
      result.distanceKm.toFixed(2),
      result.simulatedDurationSecs,
      result.chatMessages,
      result.error || '',
      result.reportFile || result.logFile
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  fs.writeFileSync(MARKDOWN_FILE, `${lines.join('\n')}\n`);
}

async function main() {
  ensureDir(LOG_DIR);
  const startedAt = new Date().toISOString();
  const endAt = localEndAt();
  const startupCleanup = CLEANUP_STALE_DRIVERS_ON_START
    ? await cleanupStaleRealCoreDrivers()
    : { ok: true, found: 0, removed: 0, skipped: true };
  const allowedRoutes = await resolveAllowedRoutes();
  const results = [];
  let rideNumber = 1;

  fs.writeFileSync(path.join(RUN_DIR, 'run-config.json'), `${JSON.stringify({
    runTag: RUN_TAG,
    startedAt,
    plannedEndAt: endAt.toISOString(),
    apiBaseUrl: API_BASE_URL,
    wsUrl: WS_SERVER_URL,
    metricsUrl: METRICS_URL,
    speedKmh: SPEED_KMH,
    concurrency: CONCURRENCY,
    batchSize: BATCH_SIZE,
    minIdleMs: MIN_IDLE_MS,
    maxIdleMs: MAX_IDLE_MS,
    maxRides: MAX_RIDES || null,
    cleanupStaleDriversOnStart: CLEANUP_STALE_DRIVERS_ON_START,
    startupCleanup,
    routeCategoryFilter: Array.from(ROUTE_CATEGORY_FILTER),
    routeNameFilter: Array.from(ROUTE_NAME_FILTER),
    routes: allowedRoutes
  }, null, 2)}\n`);

  while (!stopRequested && Date.now() < endAt.getTime()) {
    if (MAX_RIDES > 0 && results.length >= MAX_RIDES) break;

    const remainingSlots = MAX_RIDES > 0 ? Math.max(0, MAX_RIDES - results.length) : BATCH_SIZE;
    const nextBatchSize = Math.min(BATCH_SIZE, remainingSlots || BATCH_SIZE);
    const batch = [];

    for (let i = 0; i < nextBatchSize && Date.now() < endAt.getTime(); i += 1) {
      const route = routeForIndex(allowedRoutes, rideNumber);
      batch.push(runRide(route, rideNumber));
      rideNumber += 1;
    }

    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
    summarize(results, startedAt, endAt);

    if (Date.now() >= endAt.getTime() || stopRequested) break;
    const idleMs = Math.min(randomBetween(MIN_IDLE_MS, MAX_IDLE_MS), Math.max(0, endAt.getTime() - Date.now()));
    await sleep(idleMs);
  }

  const summary = summarize(results, startedAt, endAt);
  summary.status = summary.failed === 0 ? 'passed' : 'failed';
  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  writeMarkdown(summary);

  console.log(JSON.stringify({
    status: summary.status,
    runDir: RUN_DIR,
    summaryFile: SUMMARY_FILE,
    markdownFile: MARKDOWN_FILE,
    totalRides: summary.totalRides,
    passed: summary.passed,
    failed: summary.failed,
    totals: summary.totals
  }, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  ensureDir(RUN_DIR);
  const failure = {
    status: 'failed',
    runTag: RUN_TAG,
    error: error.message,
    stack: error.stack,
    runDir: RUN_DIR,
    summaryFile: SUMMARY_FILE
  };
  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
