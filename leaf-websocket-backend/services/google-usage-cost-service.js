'use strict';

// Custo real das APIs Google a partir do que o próprio Google contou (Cloud Monitoring),
// não do que o app reporta. Roda no ride-health-monitor-worker (líder único).
// Ler esses contadores é grátis até 1 milhão de séries por mês; cada ciclo lê ~20.
const firebaseAdmin = require('firebase-admin');
const { logStructured } = require('../utils/logger');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RETENTION_SECONDS = 8 * 24 * 60 * 60;
// O Google publica os contadores com 3 a 5 min de atraso: cada ciclo relê esta janela.
const LOOKBACK_MINUTES = 15;

// Preço de tabela em US$ por 1.000 chamadas, sem a cota grátis (pior caso marginal).
const DEFAULT_PRICES_PER_1000 = Object.freeze({
  'routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRoutes': 10,
  'routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRouteMatrix': 10,
  'directions-backend.googleapis.com|google.routes.Directions.Http': 10,
  'distance-matrix-backend.googleapis.com|google.routes.DistanceMatrix.Http': 10,
  'geocoding-backend.googleapis.com|google.places.Geocoding.Http': 5,
  'places-backend.googleapis.com|google.places.Autocomplete.Http': 2.83,
  'places-backend.googleapis.com|google.places.Details.Http': 17,
  'places-backend.googleapis.com|google.places.FindPlaceFromText.Http': 17,
  'places-backend.googleapis.com|google.places.TextSearch.Http': 32,
  'places-backend.googleapis.com|google.places.NearbySearch.Http': 32,
  'places-backend.googleapis.com|google.places.GetPhoto.Http': 7,
  'places.googleapis.com|*': 17,
  'elevation-backend.googleapis.com|google.maps.Elevation.Http': 5,
  'timezone-backend.googleapis.com|google.maps.Timezone.Http': 5,
  'static-maps-backend.googleapis.com|google.maps.BaseMap.Http': 2,
  'street-view-image-backend.googleapis.com|google.maps.StreetView.Http': 7,
  'maps-backend.googleapis.com|google.maps.BaseMap.Javascript': 7,
  // SDK nativo de mapas é grátis.
  'maps-android-backend.googleapis.com|*': 0,
  'maps-ios-backend.googleapis.com|*': 0,
  // Firestore: US$ 0,06 / 0,18 / 0,02 por 100 mil leituras / gravações / exclusões.
  'firestore|read': 0.0006,
  'firestore|write': 0.0018,
  'firestore|delete': 0.0002
});

const GOOGLE_SERVICE_PATTERN = /maps|places|routes|geocod|direction|distance|elevation|timezone|street-view/i;

function minuteKey(ms) {
  return `google_usage:m:${new Date(Math.floor(ms / MINUTE_MS) * MINUTE_MS).toISOString().slice(0, 16)}`;
}

function hourId(ms) {
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString().slice(0, 13);
}

function hourKey(ms) {
  return `google_usage:h:${hourId(ms)}`;
}

const RIDES_KEY = 'google_cost:rides';

function priceFor(field, prices = DEFAULT_PRICES_PER_1000) {
  if (Object.prototype.hasOwnProperty.call(prices, field)) return prices[field];
  const wildcard = `${field.split('|')[0]}|*`;
  if (Object.prototype.hasOwnProperty.call(prices, wildcard)) return prices[wildcard];
  // Método pago desconhecido: conta como o mais caro da tabela para não esconder torneira.
  return 32;
}

function costUsd(counts = {}, prices = DEFAULT_PRICES_PER_1000) {
  return Object.entries(counts).reduce(
    (total, [field, count]) => total + (Number(count) || 0) * priceFor(field, prices) / 1000,
    0
  );
}

async function getAccessToken() {
  const credential = firebaseAdmin.apps.length
    ? firebaseAdmin.app().options.credential
    : firebaseAdmin.credential.applicationDefault();
  const token = await credential.getAccessToken();
  return token.access_token;
}

async function listTimeSeries({ projectId, token, filter, startMs, endMs, groupBy = [], fetchImpl = fetch }) {
  const params = new URLSearchParams({
    filter,
    'interval.startTime': new Date(startMs).toISOString(),
    'interval.endTime': new Date(endMs).toISOString(),
    'aggregation.alignmentPeriod': '60s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM'
  });
  groupBy.forEach((field) => params.append('aggregation.groupByFields', field));
  const response = await fetchImpl(
    `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`monitoring_http_${response.status}:${body.slice(0, 160)}`);
  }
  const data = await response.json();
  return data.timeSeries || [];
}

// Pure: turns Monitoring series into { minuteIso: { 'service|method': count } }.
function bucketSeries(series = [], fieldFor) {
  const buckets = {};
  for (const ts of series) {
    const field = fieldFor(ts);
    if (!field) continue;
    for (const point of ts.points || []) {
      const count = Number(point.value?.int64Value || 0);
      if (!count) continue;
      const startMs = Date.parse(point.interval?.startTime || point.interval?.endTime);
      const key = minuteKey(startMs);
      buckets[key] = buckets[key] || {};
      buckets[key][field] = (buckets[key][field] || 0) + count;
    }
  }
  return buckets;
}

async function fetchUsageBuckets({ projectId, startMs, endMs, token, fetchImpl }) {
  const api = await listTimeSeries({
    projectId, token, startMs, endMs, fetchImpl,
    filter: 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api"',
    groupBy: ['resource.label.service', 'resource.label.method']
  });
  const buckets = bucketSeries(api, (ts) => {
    const service = ts.resource?.labels?.service || '';
    if (!GOOGLE_SERVICE_PATTERN.test(service)) return null;
    return `${service}|${ts.resource?.labels?.method || '*'}`;
  });
  for (const kind of ['read', 'write', 'delete']) {
    const firestore = await listTimeSeries({
      projectId, token, startMs, endMs, fetchImpl,
      filter: `metric.type="firestore.googleapis.com/document/${kind}_count"`
    });
    const fsBuckets = bucketSeries(firestore, () => `firestore|${kind}`);
    for (const [key, fields] of Object.entries(fsBuckets)) {
      buckets[key] = { ...(buckets[key] || {}), ...fields };
    }
  }
  return buckets;
}

async function sumMinuteHashes(redis, keys) {
  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.hgetall(key));
  const results = await pipeline.exec();
  const total = {};
  for (const [, value] of results || []) {
    for (const [field, count] of Object.entries(value || {})) {
      total[field] = (total[field] || 0) + (Number(count) || 0);
    }
  }
  return total;
}

function minuteKeysForHour(hourStartMs) {
  return Array.from({ length: 60 }, (_, index) => minuteKey(hourStartMs + index * MINUTE_MS));
}

// Relê os últimos minutos (o Google atrasa), regrava os buckets por minuto e
// recompõe as horas tocadas. Idempotente: um ciclo repetido grava o mesmo valor.
async function collectGoogleUsage(redis, {
  projectId = process.env.FIREBASE_PROJECT_ID,
  nowMs = Date.now(),
  token = null,
  fetchImpl
} = {}) {
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente');
  const endMs = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const startMs = endMs - LOOKBACK_MINUTES * MINUTE_MS;
  const buckets = await fetchUsageBuckets({
    projectId, startMs, endMs, fetchImpl, token: token || await getAccessToken()
  });

  const pipeline = redis.pipeline();
  for (const [key, fields] of Object.entries(buckets)) {
    pipeline.del(key);
    pipeline.hset(key, fields);
    pipeline.expire(key, RETENTION_SECONDS);
  }
  await pipeline.exec();

  const hours = new Set([Math.floor(startMs / HOUR_MS) * HOUR_MS, Math.floor((endMs - 1) / HOUR_MS) * HOUR_MS]);
  for (const hourStartMs of hours) {
    const total = await sumMinuteHashes(redis, minuteKeysForHour(hourStartMs));
    const key = hourKey(hourStartMs);
    await redis.del(key);
    if (Object.keys(total).length) {
      await redis.hset(key, total);
      await redis.expire(key, RETENTION_SECONDS);
    }
  }
  return { minutes: Object.keys(buckets).length, startMs, endMs };
}

// Chamado quando uma corrida termina (normal ou antecipada). Conjunto ordenado pelo
// horário: a mesma corrida não conta duas vezes e qualquer janela sai exata.
async function recordRideCompletionForCost(redis, bookingId, nowMs = Date.now()) {
  if (!redis || !bookingId) return;
  await redis.zadd(RIDES_KEY, nowMs, String(bookingId));
  await redis.zremrangebyscore(RIDES_KEY, 0, nowMs - RETENTION_SECONDS * 1000);
}

// Janelas até 6 h somam os buckets por minuto (últimos N minutos de verdade);
// janelas maiores somam as horas fechadas.
async function readWindow(redis, { hours, nowMs = Date.now(), prices } = {}) {
  const endMs = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const startMs = endMs - hours * HOUR_MS;
  const keys = hours <= 6
    ? Array.from({ length: hours * 60 }, (_, index) => minuteKey(startMs + index * MINUTE_MS))
    : Array.from({ length: hours }, (_, index) => hourKey(startMs + index * HOUR_MS));
  const counts = await sumMinuteHashes(redis, keys);
  const rides = Number(await redis.zcount(RIDES_KEY, startMs, nowMs)) || 0;
  const usd = costUsd(counts, prices);
  const google = Object.fromEntries(Object.entries(counts).filter(([field]) => !field.startsWith('firestore|')));
  return {
    hours,
    rides,
    counts,
    costUsd: usd,
    googleCostUsd: costUsd(google, prices),
    costPerRideUsd: rides > 0 ? usd / rides : null,
    routesPerRide: rides > 0 ? sumMatching(counts, /Routes\.ComputeRoutes|Directions/) / rides : null,
    autocompletePerRide: rides > 0 ? sumMatching(counts, /Autocomplete/) / rides : null
  };
}

function sumMatching(counts, pattern) {
  return Object.entries(counts).reduce(
    (total, [field, count]) => (pattern.test(field) ? total + (Number(count) || 0) : total),
    0
  );
}

function readThreshold(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Pure: decides the alerts from the last hour and the last 6 hours.
function evaluateCostAlerts({ lastHour, last6h }) {
  const alerts = [];
  const idleRoutes = sumMatching(lastHour.counts, /Routes\.ComputeRoutes|Directions|DistanceMatrix/);
  const idleLimit = readThreshold('GOOGLE_COST_IDLE_ROUTES_PER_HOUR', 30);
  if (lastHour.rides === 0 && idleRoutes > idleLimit) {
    alerts.push({
      severity: 'critical',
      metric: 'google_routes_without_rides',
      value: idleRoutes,
      threshold: idleLimit,
      message: `${idleRoutes} rotas pagas na última hora sem nenhuma corrida concluída.`
    });
  }
  const hourlyLimit = readThreshold('GOOGLE_COST_HOURLY_USD_CRITICAL', 2);
  if (lastHour.costUsd > hourlyLimit) {
    alerts.push({
      severity: 'critical',
      metric: 'google_cost_hourly_usd',
      value: Number(lastHour.costUsd.toFixed(2)),
      threshold: hourlyLimit,
      message: `Google custou US$ ${lastHour.costUsd.toFixed(2)} na última hora.`
    });
  }
  const minRides = readThreshold('GOOGLE_COST_MIN_RIDES_FOR_RATIO', 3);
  if (last6h.rides >= minRides) {
    const perRideLimit = readThreshold('GOOGLE_COST_PER_RIDE_USD_WARNING', 0.06);
    if (last6h.costPerRideUsd > perRideLimit) {
      alerts.push({
        severity: 'warning',
        metric: 'google_cost_per_ride_usd',
        value: Number(last6h.costPerRideUsd.toFixed(4)),
        threshold: perRideLimit,
        message: `Custo Google por corrida em 6 h: US$ ${last6h.costPerRideUsd.toFixed(3)} (${last6h.rides} corridas).`
      });
    }
    const routesLimit = readThreshold('GOOGLE_COST_ROUTES_PER_RIDE_WARNING', 3);
    if (last6h.routesPerRide > routesLimit) {
      alerts.push({
        severity: 'warning',
        metric: 'google_routes_per_ride',
        value: Number(last6h.routesPerRide.toFixed(2)),
        threshold: routesLimit,
        message: `${last6h.routesPerRide.toFixed(1)} rotas por corrida em 6 h (esperado: 2).`
      });
    }
  }
  const readsLimit = readThreshold('GOOGLE_COST_FIRESTORE_READS_PER_HOUR_WARNING', 50000);
  const reads = Number(lastHour.counts['firestore|read'] || 0);
  if (reads > readsLimit) {
    alerts.push({
      severity: 'warning',
      metric: 'firestore_reads_hourly',
      value: reads,
      threshold: readsLimit,
      message: `${reads} leituras no Firestore na última hora.`
    });
  }
  return alerts.map((alert) => ({ service: 'google-cost', ...alert }));
}

async function runGoogleCostCycle(redis, { alertClient, nowMs = Date.now(), fetchImpl, token } = {}) {
  const collected = await collectGoogleUsage(redis, { nowMs, fetchImpl, token });
  const lastHour = await readWindow(redis, { hours: 1, nowMs });
  const last6h = await readWindow(redis, { hours: 6, nowMs });
  const alerts = evaluateCostAlerts({ lastHour, last6h });
  for (const alert of alerts) {
    await alertClient?.sendAlert?.(alert);
  }
  logStructured('info', 'Ciclo de custo Google concluído', {
    service: 'google-usage-cost',
    minutes: collected.minutes,
    lastHourUsd: Number(lastHour.costUsd.toFixed(4)),
    lastHourRides: lastHour.rides,
    alerts: alerts.length
  });
  return { collected, lastHour, last6h, alerts };
}

// Resumo para o dashboard: janelas de 1 h, 6 h, 24 h e 7 dias e as últimas 24 horas.
async function getCostSnapshot(redis, { nowMs = Date.now() } = {}) {
  const windows = {};
  for (const [label, hours] of [['1h', 1], ['6h', 6], ['24h', 24], ['7d', 168]]) {
    const window = await readWindow(redis, { hours, nowMs });
    windows[label] = {
      ...window,
      items: Object.entries(window.counts)
        .map(([field, count]) => ({
          field,
          count,
          costUsd: (Number(count) || 0) * priceFor(field) / 1000
        }))
        .sort((left, right) => right.costUsd - left.costUsd || right.count - left.count)
    };
  }
  const currentHourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const hourly = [];
  for (let index = 23; index >= 0; index -= 1) {
    const startMs = currentHourMs - index * HOUR_MS;
    const counts = await redis.hgetall(hourKey(startMs));
    const rides = Number(await redis.zcount(RIDES_KEY, startMs, startMs + HOUR_MS - 1)) || 0;
    hourly.push({ hour: new Date(startMs).toISOString(), costUsd: costUsd(counts || {}), rides });
  }
  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: 'google_cloud_monitoring',
    lagNote: 'O Google publica os contadores com 3 a 5 minutos de atraso.',
    pricesNote: 'Preço de tabela sem a cota grátis mensal.',
    windows,
    hourly
  };
}

module.exports = {
  getCostSnapshot,
  DEFAULT_PRICES_PER_1000,
  priceFor,
  costUsd,
  bucketSeries,
  collectGoogleUsage,
  recordRideCompletionForCost,
  readWindow,
  evaluateCostAlerts,
  runGoogleCostCycle,
  minuteKey,
  hourKey,
  RIDES_KEY
};
