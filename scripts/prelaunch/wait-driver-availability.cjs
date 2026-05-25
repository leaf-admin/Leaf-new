#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const RedisDriverSimulator = require('../../leaf-websocket-backend/tests/e2e/backend/__helpers__/redis-driver-simulator');

function readArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function readNumberArg(flag, fallback) {
  const value = Number(readArg(flag, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function buildNearbyUrl({ apiBaseUrl, lat, lng, radiusKm, limit }) {
  const url = new URL('/api/drivers/nearby', apiBaseUrl);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radius', String(radiusKm));
  url.searchParams.set('limit', String(limit));
  return url;
}

function configureRemoteRuntimeFromApiBaseUrl(apiBaseUrl) {
  const normalizedApiBaseUrl = String(apiBaseUrl || '').trim();
  if (!process.env.WS_URL && /api\.[0-9.]+\.sslip\.io/i.test(normalizedApiBaseUrl)) {
    process.env.WS_URL = normalizedApiBaseUrl.replace(/api\./i, 'socket.');
  }

  const normalizedWsUrl = String(process.env.WS_URL || '').trim().toLowerCase();
  if (
    !process.env.E2E_DRIVER_SIM_MODE &&
    (normalizedWsUrl.includes('sslip.io') || normalizedWsUrl.startsWith('https://'))
  ) {
    process.env.E2E_DRIVER_SIM_MODE = 'remote_ssh';
  }
}

async function fetchNearbyDrivers(options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  const url = buildNearbyUrl(options);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      url: String(url),
      data,
      drivers: Array.isArray(data?.drivers) ? data.drivers : [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeDriver(driver) {
  return {
    id: driver?.id || null,
    distance: driver?.distance ?? null,
    carType: driver?.carType || null,
    source: driver?.source || null,
    geoKey: driver?.geoKey || null,
  };
}

function resolveMatch(drivers, driverUid) {
  if (!Array.isArray(drivers) || drivers.length === 0) {
    return null;
  }

  const normalizedDriverUid = String(driverUid || '').trim();
  if (!normalizedDriverUid) {
    return drivers[0];
  }

  return drivers.find((driver) => String(driver?.id || '') === normalizedDriverUid) || null;
}

async function repairDriverAvailability({ driverUid, lat, lng, outputEvents }) {
  if (!driverUid) {
    outputEvents.push({
      at: nowIso(),
      stage: 'repair_skipped',
      reason: 'missing_driver_uid',
    });
    return null;
  }

  const simulator = new RedisDriverSimulator();
  const result = await simulator.setDriverOnline(driverUid, lat, lng, 0, 0, true, false);
  const state = await simulator.isDriverOnline(driverUid).catch((error) => ({
    error: error?.message || String(error),
  }));
  outputEvents.push({
    at: nowIso(),
    stage: 'repair_driver_available',
    result,
    state: {
      exists: state?.exists,
      isOnline: state?.isOnline,
      dispatchEligible: state?.driverData?.dispatchEligible || null,
      status: state?.driverData?.status || null,
      carType: state?.driverData?.carType || null,
      vehicleCategory: state?.driverData?.vehicleCategory || null,
    },
  });
  return result;
}

async function main() {
  const apiBaseUrl = readArg('--api-base-url', process.env.API_BASE_URL || 'https://api.62.169.31.231.sslip.io');
  const driverUid = readArg('--driver-uid', process.env.TEST_DRIVER_UID || '');
  const lat = readNumberArg('--lat', Number.NaN);
  const lng = readNumberArg('--lng', Number.NaN);
  const driverLat = readNumberArg('--driver-lat', lat);
  const driverLng = readNumberArg('--driver-lng', lng);
  const radiusKm = readNumberArg('--radius-km', 10);
  const limit = readNumberArg('--limit', 12);
  const timeoutMs = readNumberArg('--timeout-ms', 90000);
  const intervalMs = readNumberArg('--interval-ms', 2500);
  const requestTimeoutMs = readNumberArg('--request-timeout-ms', 12000);
  const repairAfterMs = readNumberArg('--repair-after-ms', 15000);
  const repairEnabled = String(readArg('--repair', process.env.REPAIR_DRIVER_AVAILABILITY || 'true')).toLowerCase() !== 'false';
  const outputPath = readArg('--output', '');

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('lat/lng obrigatórios para validar disponibilidade do motorista.');
  }

  configureRemoteRuntimeFromApiBaseUrl(apiBaseUrl);

  const startedAt = Date.now();
  const events = [];
  let repaired = false;
  let lastSnapshot = null;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const snapshot = await fetchNearbyDrivers({
        apiBaseUrl,
        lat,
        lng,
        radiusKm,
        limit,
        requestTimeoutMs,
      });
      const match = resolveMatch(snapshot.drivers, driverUid);
      lastSnapshot = snapshot;
      events.push({
        at: nowIso(),
        stage: 'availability_poll',
        ok: snapshot.ok,
        status: snapshot.status,
        count: snapshot.drivers.length,
        matchedDriver: summarizeDriver(match),
        firstDrivers: snapshot.drivers.slice(0, 3).map(summarizeDriver),
        debug: snapshot.data?.debug || null,
      });

      if (match) {
        const summary = {
          ok: true,
          driverReady: true,
          repaired,
          driverUid,
          matchedDriver: summarizeDriver(match),
          count: snapshot.drivers.length,
          apiBaseUrl,
          lat,
          lng,
          radiusKm,
          driverLat,
          driverLng,
          events,
        };
        if (outputPath) {
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
        }
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        return;
      }

      const shouldRepair =
        repairEnabled &&
        !repaired &&
        Date.now() - startedAt >= repairAfterMs;

      if (shouldRepair) {
        repaired = true;
        try {
          await repairDriverAvailability({
            driverUid,
            lat: driverLat,
            lng: driverLng,
            outputEvents: events,
          });
        } catch (error) {
          events.push({
            at: nowIso(),
            stage: 'repair_driver_available_failed',
            error: error?.message || String(error),
          });
        }
      }
    } catch (error) {
      events.push({
        at: nowIso(),
        stage: 'availability_poll_error',
        error: error?.message || String(error),
      });
    }

    await sleep(intervalMs);
  }

  const summary = {
    ok: false,
    driverReady: false,
    repaired,
    driverUid,
    apiBaseUrl,
    lat,
    lng,
    radiusKm,
    driverLat,
    driverLng,
    lastCount: Array.isArray(lastSnapshot?.drivers) ? lastSnapshot.drivers.length : 0,
    lastDrivers: (lastSnapshot?.drivers || []).slice(0, 5).map(summarizeDriver),
    events,
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(1);
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error?.message || String(error),
    stack: error?.stack || null,
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
});
