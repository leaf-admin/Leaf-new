#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPORT_PREFIX = '@ride_cost_telemetry_report_';

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Number(safeNumber(value, 0).toFixed(6));
}

function normalizeUserType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  if (normalized === 'customer' || normalized === 'passenger') {
    return 'customer';
  }
  if (normalized === 'driver') {
    return 'driver';
  }
  return normalized;
}

function normalizeReportEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }

  const snapshot = entry?.snapshot && typeof entry.snapshot === 'object'
    ? entry.snapshot
    : {};
  const google = snapshot?.google && typeof snapshot.google === 'object'
    ? snapshot.google
    : {};
  const backend = snapshot?.backend && typeof snapshot.backend === 'object'
    ? snapshot.backend
    : {};
  const redis = snapshot?.redis && typeof snapshot.redis === 'object'
    ? snapshot.redis
    : {};
  const firebase = snapshot?.firebase && typeof snapshot.firebase === 'object'
    ? snapshot.firebase
    : {};
  const database = snapshot?.database && typeof snapshot.database === 'object'
    ? snapshot.database
    : {};
  const sourceMeta = snapshot?.sourceMeta && typeof snapshot.sourceMeta === 'object'
    ? snapshot.sourceMeta
    : (entry?.sourceMeta && typeof entry.sourceMeta === 'object' ? entry.sourceMeta : {});
  const normalizedUserType = normalizeUserType(sourceMeta?.userType);
  const googleSkus = google?.skus && typeof google.skus === 'object' ? google.skus : {};

  const lineItems = Object.values(googleSkus).map((skuEntry) => ({
    skuKey: skuEntry?.skuKey || null,
    label: skuEntry?.label || null,
    family: skuEntry?.family || null,
    unit: skuEntry?.unit || null,
    requestCount: Math.max(0, Math.round(safeNumber(skuEntry?.requestCount, 0))),
    billableUnits: safeNumber(skuEntry?.billableUnits, 0),
    unitCostUsd: safeNumber(skuEntry?.unitPriceUsd, 0),
    totalCostUsd: roundCurrency(skuEntry?.estimatedCostUsd),
    metadata: skuEntry?.lastMetadata || null,
    lastUpdatedAt: skuEntry?.lastUpdatedAt || null,
  }));

  const googleRequestCount = lineItems.reduce(
    (acc, item) => acc + Math.max(0, Math.round(safeNumber(item?.requestCount, 0))),
    0,
  );
  const googleBillableUnits = Number(
    lineItems.reduce((acc, item) => acc + safeNumber(item?.billableUnits, 0), 0).toFixed(3),
  );
  const googleEstimatedCostUsd = roundCurrency(
    lineItems.reduce((acc, item) => acc + safeNumber(item?.totalCostUsd, 0), 0),
  );
  const directionsLineItems = lineItems.filter((item) => item?.skuKey === 'directionsLegacy');
  const directionsRequestCount = directionsLineItems.reduce(
    (acc, item) => acc + Math.max(0, Math.round(safeNumber(item?.requestCount, 0))),
    0,
  );
  const directionsBillableUnits = Number(
    directionsLineItems.reduce((acc, item) => acc + safeNumber(item?.billableUnits, 0), 0).toFixed(3),
  );
  const directionsEstimatedCostUsd = roundCurrency(
    directionsLineItems.reduce((acc, item) => acc + safeNumber(item?.totalCostUsd, 0), 0),
  );
  const driverDirectionsRequests = normalizedUserType === 'driver' ? directionsRequestCount : 0;
  const passengerDirectionsRequests = normalizedUserType === 'customer' ? directionsRequestCount : 0;

  return {
    ...entry,
    google,
    backend,
    redis,
    firebase,
    database,
    sourceMeta,
    lineItems,
    counters: {
      googleRequestCount,
      googleBillableUnits,
      googleEstimatedCostUsd,
      driverDirectionsRequests,
      passengerDirectionsRequests,
      directionsRequests: directionsRequestCount,
      directionsBillableUnits,
      directionsEstimatedCostUsd,
      backendAttempts: Math.max(0, Math.round(safeNumber(backend?.totalAttempts, 0))),
      backendSuccesses: Math.max(0, Math.round(safeNumber(backend?.totalSuccesses, 0))),
      backendErrors: Math.max(0, Math.round(safeNumber(backend?.totalErrors, 0))),
      backendLatencyMs: Math.max(0, Math.round(safeNumber(backend?.totalLatencyMs, 0))),
      redisReads:
        Math.max(0, Math.round(safeNumber(redis?.reads, 0))) ||
        Math.max(0, Math.round(safeNumber(redis?.readOps, 0))) ||
        null,
      redisWrites:
        Math.max(0, Math.round(safeNumber(redis?.writes, 0))) ||
        Math.max(0, Math.round(safeNumber(redis?.writeOps, 0))) ||
        null,
      firebaseReads:
        Math.max(0, Math.round(safeNumber(firebase?.reads, 0))) ||
        Math.max(0, Math.round(safeNumber(firebase?.readOps, 0))) ||
        null,
      firebaseWrites:
        Math.max(0, Math.round(safeNumber(firebase?.writes, 0))) ||
        Math.max(0, Math.round(safeNumber(firebase?.writeOps, 0))) ||
        null,
      databaseReads:
        Math.max(0, Math.round(safeNumber(database?.reads, 0))) ||
        Math.max(0, Math.round(safeNumber(database?.readOps, 0))) ||
        null,
      databaseWrites:
        Math.max(0, Math.round(safeNumber(database?.writes, 0))) ||
        Math.max(0, Math.round(safeNumber(database?.writeOps, 0))) ||
        null,
    },
    costSummary: {
      currency: entry?.pricingSheet?.currency || 'USD',
      billableUnits: googleBillableUnits,
      estimatedGoogleCostUsd: googleEstimatedCostUsd,
      googleEstimatedCostUsd,
      googleBillableUnits,
      googleRequestCount,
      driverDirectionsRequests,
      passengerDirectionsRequests,
      directionsRequests: directionsRequestCount,
      directionsBillableUnits,
      directionsEstimatedCostUsd,
      routesCostUsd: directionsEstimatedCostUsd,
      backendProcessingCostUsd: null,
      firebaseCostUsd: null,
      databaseCostUsd: null,
    },
  };
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] || null;
}

function safeJsonParse(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function readAsyncStorageEntry(storageDir, key, manifestValue) {
  if (typeof manifestValue === 'string') {
    return manifestValue;
  }

  if (manifestValue !== null) {
    return null;
  }

  const hashedFile = crypto.createHash('md5').update(key).digest('hex');
  const hashedPath = path.join(storageDir, hashedFile);
  if (!fs.existsSync(hashedPath)) {
    return null;
  }

  try {
    return fs.readFileSync(hashedPath, 'utf8');
  } catch (_error) {
    return null;
  }
}

function main() {
  const udid = readArg('--udid');
  const appId = readArg('--app-id');
  const bookingId = String(readArg('--booking-id') || '').trim();
  const limit = Number.parseInt(readArg('--limit') || '10', 10);

  if (!udid || !appId) {
    console.error(
      'usage: read-sim-ride-cost-telemetry.cjs --udid <udid> --app-id <appId> [--booking-id <id>] [--limit <n>]',
    );
    process.exit(1);
  }

  let containerPath = '';
  try {
    containerPath = execFileSync(
      'xcrun',
      ['simctl', 'get_app_container', udid, appId, 'data'],
      { encoding: 'utf8' },
    ).trim();
  } catch (_error) {
    process.exit(2);
  }

  const storageDir = path.join(
    containerPath,
    'Library',
    'Application Support',
    appId,
    'RCTAsyncLocalStorage_V1',
  );
  const manifestPath = path.join(storageDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    process.exit(3);
  }

  const manifest = safeJsonParse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object') {
    process.exit(4);
  }

  const reports = Object.entries(manifest)
    .filter(([key]) => key.startsWith(REPORT_PREFIX))
    .map(([key, rawValue]) => {
      const entryRaw = readAsyncStorageEntry(storageDir, key, rawValue);
      if (typeof entryRaw === 'string') {
        return safeJsonParse(entryRaw);
      }
      return entryRaw;
    })
    .filter(Boolean)
    .map((entry) => normalizeReportEntry(entry))
    .filter((entry) => !bookingId || entry?.bookingId === bookingId)
    .sort((a, b) => {
      const left = Date.parse(a?.persistedAt || a?.snapshot?.updatedAt || 0) || 0;
      const right = Date.parse(b?.persistedAt || b?.snapshot?.updatedAt || 0) || 0;
      return right - left;
    })
    .slice(0, Math.max(1, Math.min(limit, 100)));

  process.stdout.write(JSON.stringify(reports, null, 2));
}

main();
