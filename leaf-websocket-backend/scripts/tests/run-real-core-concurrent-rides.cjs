#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

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
    return 'https://api.62.169.31.231.sslip.io';
  }
}

const WS_SERVER_URL = process.env.REAL_CORE_WS_URL || process.env.WS_URL || process.env.REAL_CORE_SERVER_URL || 'https://socket.62.169.31.231.sslip.io';
const API_BASE_URL = deriveApiBaseUrl(process.env.REAL_CORE_SERVER_URL || WS_SERVER_URL);
const METRICS_URL = process.env.REAL_CORE_METRICS_URL || process.env.PRELAUNCH_METRICS_URL || `${API_BASE_URL}/api/metrics/prometheus`;
const SPEED_KMH = Number.parseFloat(process.env.REAL_CORE_SIMULATION_SPEED_KMH || process.env.NIGHT_SOAK_SPEED_KMH || '50');
process.env.WS_URL = process.env.WS_URL || WS_SERVER_URL;
process.env.API_BASE_URL = process.env.API_BASE_URL || API_BASE_URL;
const RedisDriverSimulator = require('../../tests/e2e/backend/__helpers__/redis-driver-simulator');
const RUN_TAG = process.env.REAL_CORE_CONCURRENT_RUN_TAG || `${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}_${crypto.randomBytes(3).toString('hex')}`;
const RUN_DIR = path.join(rootDir, 'reports', 'prelaunch', `concurrent-rides-${RUN_TAG}`);
const LOG_DIR = path.join(RUN_DIR, 'logs');

const routes = [
  {
    name: 'Copacabana Palace -> Leblon',
    pickup: { lat: -22.971964, lng: -43.182543, address: 'Copacabana Palace, Rio de Janeiro, RJ' },
    destination: { lat: -22.984843, lng: -43.221972, address: 'Leblon, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9708, lng: -43.1819, address: 'Driver near Copacabana Palace' }
  },
  {
    name: 'Botafogo Praia Shopping -> Aterro do Flamengo',
    pickup: { lat: -22.951912, lng: -43.182182, address: 'Botafogo Praia Shopping, Rio de Janeiro, RJ' },
    destination: { lat: -22.932827, lng: -43.172896, address: 'Aterro do Flamengo, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.95242, lng: -43.18162, address: 'Driver near Botafogo' }
  },
  {
    name: 'General Osorio -> Jardim Botanico',
    pickup: { lat: -22.984703, lng: -43.197407, address: 'Praca General Osorio, Rio de Janeiro, RJ' },
    destination: { lat: -22.967545, lng: -43.224472, address: 'Jardim Botanico, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.98419, lng: -43.19711, address: 'Driver near Ipanema' }
  },
  {
    name: 'Lagoa -> PUC Gavea',
    pickup: { lat: -22.973001, lng: -43.213372, address: 'Lagoa Rodrigo de Freitas, Rio de Janeiro, RJ' },
    destination: { lat: -22.97986, lng: -43.232533, address: 'PUC Gavea, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.97252, lng: -43.21304, address: 'Driver near Lagoa' }
  },
  {
    name: 'Leme -> Botafogo',
    pickup: { lat: -22.962487, lng: -43.166694, address: 'Leme, Rio de Janeiro, RJ' },
    destination: { lat: -22.950726, lng: -43.184684, address: 'Botafogo, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.96202, lng: -43.16627, address: 'Driver near Leme' }
  },
  {
    name: 'Catete -> Gloria',
    pickup: { lat: -22.9253, lng: -43.176, address: 'Catete, Rio de Janeiro, RJ' },
    destination: { lat: -22.9193, lng: -43.1735, address: 'Gloria, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.925, lng: -43.1757, address: 'Driver near Catete' }
  },
  {
    name: 'Saens Pena -> Maracana',
    pickup: { lat: -22.92493, lng: -43.232907, address: 'Praca Saens Pena, Rio de Janeiro, RJ' },
    destination: { lat: -22.912115, lng: -43.230182, address: 'Maracana, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.92452, lng: -43.23251, address: 'Driver near Tijuca' }
  },
  {
    name: 'Humaita -> Catete',
    pickup: { lat: -22.9541, lng: -43.1997, address: 'Humaita, Rio de Janeiro, RJ' },
    destination: { lat: -22.9253, lng: -43.176, address: 'Catete, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9537, lng: -43.1992, address: 'Driver near Humaita' }
  },
  {
    name: 'Praia Vermelha -> Copacabana Posto 4',
    pickup: { lat: -22.9542, lng: -43.1654, address: 'Praia Vermelha, Rio de Janeiro, RJ' },
    destination: { lat: -22.971071, lng: -43.186829, address: 'Copacabana Posto 4, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.9538, lng: -43.165, address: 'Driver near Praia Vermelha' }
  },
  {
    name: 'Sao Conrado -> Leblon',
    pickup: { lat: -22.998602, lng: -43.256704, address: 'Sao Conrado, Rio de Janeiro, RJ' },
    destination: { lat: -22.984843, lng: -43.221972, address: 'Leblon, Rio de Janeiro, RJ' },
    driverStart: { lat: -22.99812, lng: -43.25618, address: 'Driver near Sao Conrado' }
  }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
      // Try the previous opening brace.
    }
  }
  return null;
}

async function checkGeofencePoint(point, options = {}) {
  const required = options.required !== false;
  const url = `${API_BASE_URL}/api/geofence/check?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch (_error) {
    body = { raw: text.slice(0, 500) };
  }

  if (required && (!response.ok || body.success === false || body.isAllowed === false)) {
    throw new Error(`geofence_blocked:${point.address}:${response.status}:${body.reason || body.message || 'unknown'}`);
  }

  return body;
}

async function checkRouteGeofence(route) {
  const [pickup, destination, driverStart] = await Promise.all([
    checkGeofencePoint(route.pickup),
    checkGeofencePoint(route.destination, { required: false }),
    checkGeofencePoint(route.driverStart)
  ]);

  return { pickup, destination, driverStart };
}

function runRoute(route, index, geofence) {
  return new Promise((resolve) => {
    const rideTag = `concurrent_${RUN_TAG}_${String(index + 1).padStart(2, '0')}_${crypto.randomBytes(2).toString('hex')}`;
    const logFile = path.join(LOG_DIR, `ride_${String(index + 1).padStart(2, '0')}.log`);
    const startedAt = Date.now();
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
        REAL_CORE_USE_SPEED_DERIVED_DURATION: 'true',
        REAL_CORE_SKIP_DIRECT_REDIS_EVIDENCE_WRITES: process.env.REAL_CORE_SKIP_DIRECT_REDIS_EVIDENCE_WRITES || 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('close', (code) => {
      ensureDir(LOG_DIR);
      fs.writeFileSync(logFile, output);
      const parsed = extractJsonObject(output);
      resolve({
        index: index + 1,
        routeName: route.name,
        status: code === 0 && parsed?.status === 'success' ? 'passed' : 'failed',
        code,
        durationMs: Date.now() - startedAt,
        geofence,
        summary: parsed,
        logFile
      });
    });
  });
}

function toMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function readRideEvidence(result) {
  const reportFile = result.summary?.reportFile;
  if (!reportFile || !fs.existsSync(reportFile)) return null;

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const pricing = report.outputs?.booking?.data?.pricingPayload || {};
  return {
    reportFile,
    bookingId: result.summary?.bookingId || report.outputs?.booking?.bookingId || '',
    passengerId: result.summary?.passengerId || report.entities?.passengerId || '',
    driverId: result.summary?.driverId || report.entities?.driverId || '',
    quote: toMoney(report.outputs?.lockedFare?.value),
    payment: toMoney(report.outputs?.payment?.data?.amount ?? report.outputs?.payment?.amount),
    finalFare: toMoney(report.outputs?.completeTrip?.fare ?? report.outputs?.completeTrip?.finalFare),
    receipt: toMoney(report.outputs?.receipt?.totalPaid?.replace?.(/[^0-9,.-]/g, '').replace(',', '.')),
    distanceKm: toMoney(report.outputs?.finalSnapshot?.distanceKm),
    durationSecs: Number(report.outputs?.finalSnapshot?.routeDurationSecs || 0),
    status: report.outputs?.finalSnapshot?.status || '',
    financialConsistency: Boolean(report.outputs?.financialConsistency?.ok),
    pricingPayload: {
      baseFare: pricing.base_fare,
      distanceComponent: pricing.distance_component,
      timeComponent: pricing.time_component,
      fixedFee: pricing.fixed_fee,
      dynamicFactor: pricing.dynamic_factor,
      minimumFareApplied: pricing.minimum_fare_applied,
      finalPrice: pricing.final_price
    },
    fees: {
      operational: report.outputs?.booking?.data?.estimatedOperationalFee,
      intermediation: report.outputs?.booking?.data?.estimatedPaymentIntermediationFee,
      totalFees: report.outputs?.booking?.data?.estimatedTotalFees,
      driverNet: report.outputs?.booking?.data?.estimatedDriverNetAmount
    }
  };
}

function sum(rows, key) {
  return Math.round(rows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0) * 100) / 100;
}

function writeMarkdownReport(summary) {
  const lines = [
    `# Concurrent Real Core Rides - ${RUN_TAG}`,
    '',
    `- Status: **${summary.status === 'passed' ? 'GO' : 'NO-GO'}**`,
    `- API: ${API_BASE_URL}`,
    `- Socket: ${WS_SERVER_URL}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Successful rides: ${summary.successfulRides}/${summary.targetRides}`,
    `- Failed rides: ${summary.failedRides}`,
    `- Financial inconsistencies: ${summary.financialInconsistencies}`,
    '',
    '## Routes',
    '',
    '| # | Status | Route | Booking | Quote | Payment | Final | Distance km | Duration s | Evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];

  for (const result of summary.results) {
    const evidence = result.evidence || {};
    lines.push([
      result.index,
      result.status.toUpperCase(),
      result.routeName,
      evidence.bookingId || '',
      evidence.quote ?? '',
      evidence.payment ?? '',
      evidence.finalFare ?? '',
      evidence.distanceKm ?? '',
      evidence.durationSecs ?? '',
      evidence.reportFile ? path.relative(rootDir, evidence.reportFile) : path.relative(rootDir, result.logFile)
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push(
    '',
    '## Totals',
    '',
    `- Gross quote total: R$ ${summary.totals.quote.toFixed(2)}`,
    `- Payment total: R$ ${summary.totals.payment.toFixed(2)}`,
    `- Final fare total: R$ ${summary.totals.finalFare.toFixed(2)}`,
    `- Total distance: ${summary.totals.distanceKm.toFixed(2)} km`,
    `- Driver net total: R$ ${summary.totals.driverNet.toFixed(2)}`,
    `- Total fees: R$ ${summary.totals.totalFees.toFixed(2)}`
  );

  fs.writeFileSync(path.join(RUN_DIR, 'concurrent-rides-report.md'), `${lines.join('\n')}\n`);
}

async function cleanupStaleRealCoreDrivers() {
  const simulator = new RedisDriverSimulator();
  try {
    const keys = await simulator.keys('driver:real_driver_*');
    const driverIds = keys
      .map((key) => String(key || '').replace(/^driver:/, ''))
      .filter((driverId) => driverId.startsWith('real_driver_'));
    await Promise.allSettled(driverIds.map((driverId) => simulator.removeDriver(driverId)));
    return { ok: true, removed: driverIds.length };
  } catch (error) {
    return { ok: false, removed: 0, error: error.message };
  }
}

async function main() {
  ensureDir(LOG_DIR);
  const startedAt = new Date().toISOString();

  const cleanup = await cleanupStaleRealCoreDrivers();
  const geofenceChecks = await Promise.all(routes.map(checkRouteGeofence));
  const results = await Promise.all(routes.map((route, index) => runRoute(route, index, geofenceChecks[index])));
  const enrichedResults = results.map((result) => ({
    ...result,
    evidence: readRideEvidence(result)
  }));

  const passed = enrichedResults.filter((result) => result.status === 'passed');
  const evidences = enrichedResults.map((result) => result.evidence).filter(Boolean);
  const financialInconsistencies = enrichedResults.filter((result) => {
    const evidence = result.evidence;
    return !(
      result.status === 'passed' &&
      evidence?.financialConsistency === true &&
      evidence.quote === evidence.payment &&
      evidence.quote === evidence.finalFare &&
      evidence.quote === evidence.receipt &&
      evidence.status === 'completed'
    );
  }).length;

  const summary = {
    runTag: RUN_TAG,
    startedAt,
    finishedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    wsUrl: WS_SERVER_URL,
    speedKmh: SPEED_KMH,
    targetRides: routes.length,
    successfulRides: passed.length,
    failedRides: routes.length - passed.length,
    financialInconsistencies,
    status: passed.length === routes.length && financialInconsistencies === 0 ? 'passed' : 'failed',
    totals: {
      quote: sum(evidences, 'quote'),
      payment: sum(evidences, 'payment'),
      finalFare: sum(evidences, 'finalFare'),
      receipt: sum(evidences, 'receipt'),
      distanceKm: sum(evidences, 'distanceKm'),
      driverNet: Math.round(evidences.reduce((acc, evidence) => acc + Number(evidence?.fees?.driverNet || 0), 0) * 100) / 100,
      totalFees: Math.round(evidences.reduce((acc, evidence) => acc + Number(evidence?.fees?.totalFees || 0), 0) * 100) / 100
    },
    cleanup,
    results: enrichedResults
  };

  fs.writeFileSync(path.join(RUN_DIR, 'concurrent-rides-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeMarkdownReport(summary);

  console.log(JSON.stringify({
    status: summary.status,
    runDir: RUN_DIR,
    targetRides: summary.targetRides,
    successfulRides: summary.successfulRides,
    failedRides: summary.failedRides,
    financialInconsistencies: summary.financialInconsistencies,
    totals: summary.totals
  }, null, 2));

  if (summary.status !== 'passed') {
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
    runDir: RUN_DIR
  };
  fs.writeFileSync(path.join(RUN_DIR, 'concurrent-rides-summary.json'), `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
