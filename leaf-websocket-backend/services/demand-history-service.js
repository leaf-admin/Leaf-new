'use strict';

// Mapa de demanda com histórico para o motorista.
//
// Cada pedido de corrida soma 1 na célula H3 do embarque, num contador por data e hora (horário
// do Rio). O job do pricing-baseline-worker soma, para a hora atual, o mesmo dia da semana nas
// últimas semanas mais as últimas horas de hoje, e publica um "calor" por célula. Nada aqui chama
// provedor pago, e nada aqui participa do pedido: falhar só deixa o mapa sem calor.
//
// Privacidade: a célula é grande (res 8, ~0,7 km²) e só aparece com um mínimo de pedidos, para não
// apontar o embarque de um passageiro específico.

const h3 = require('h3-js');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const RESOLUTION = toPositiveInt(process.env.DEMAND_HISTORY_H3_RESOLUTION, 8);
const TIME_ZONE = process.env.DEMAND_HISTORY_TIME_ZONE || 'America/Sao_Paulo';
const WEEKS_BACK = toPositiveInt(process.env.DEMAND_HISTORY_WEEKS_BACK, 4);
const RECENT_HOURS = toPositiveInt(process.env.DEMAND_HISTORY_RECENT_HOURS, 2);
const MIN_REQUESTS_PER_CELL = toPositiveInt(process.env.DEMAND_HISTORY_MIN_REQUESTS, 3);
const MAX_CELLS = toPositiveInt(process.env.DEMAND_HISTORY_MAX_CELLS, 200);
const BUCKET_TTL_SECONDS = (WEEKS_BACK * 7 + 3) * 24 * 3600;
const HEAT_TTL_SECONDS = toPositiveInt(process.env.DEMAND_HISTORY_HEAT_TTL_SECONDS, 30 * 60);

const HEAT_KEY = 'leaf:h3:demand-heat:current';
const bucketKey = (dateKey, hour) => `leaf:h3:demand-history:${dateKey}:${String(hour).padStart(2, '0')}`;
const seenKey = (bookingId) => `leaf:h3:demand-history:seen:${bookingId}`;

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Data e hora no fuso do Rio, sem depender do fuso do container.
function localParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { dateKey: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function toCell(location) {
  const lat = Number(location?.lat ?? location?.latitude);
  const lng = Number(location?.lng ?? location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    return h3.latLngToCell(lat, lng, RESOLUTION);
  } catch (_error) {
    return null;
  }
}

async function recordRideRequest(redis, { bookingId, pickupLocation, at = new Date() } = {}) {
  if (!redis) return { recorded: false, reason: 'no_redis' };
  const cell = toCell(pickupLocation);
  if (!cell) return { recorded: false, reason: 'no_location' };

  // A mesma corrida pode passar aqui de novo (retentativa do app): conta uma vez.
  if (bookingId) {
    const first = await redis.set(seenKey(bookingId), '1', 'EX', 2 * 24 * 3600, 'NX');
    if (first !== 'OK') return { recorded: false, reason: 'duplicate' };
  }

  const { dateKey, hour } = localParts(at);
  const key = bucketKey(dateKey, hour);
  await redis.hincrby(key, cell, 1);
  await redis.expire(key, BUCKET_TTL_SECONDS);
  return { recorded: true, cell, key };
}

// Quais contadores somar para "agora", com peso: mesma hora nas semanas anteriores pesa 1, a hora
// seguinte pesa meio (o motorista se posiciona antes), e as últimas horas de hoje pesam 1.
function buildSourceBuckets(now = new Date()) {
  const sources = [];
  for (let week = 1; week <= WEEKS_BACK; week += 1) {
    const base = now.getTime() - week * 7 * DAY_MS;
    const same = localParts(new Date(base));
    const next = localParts(new Date(base + HOUR_MS));
    sources.push({ key: bucketKey(same.dateKey, same.hour), weight: 1 / WEEKS_BACK });
    sources.push({ key: bucketKey(next.dateKey, next.hour), weight: 0.5 / WEEKS_BACK });
  }
  for (let back = 0; back < RECENT_HOURS; back += 1) {
    const recent = localParts(new Date(now.getTime() - back * HOUR_MS));
    sources.push({ key: bucketKey(recent.dateKey, recent.hour), weight: 1 });
  }
  return sources;
}

async function materializeDemandHeat(redis, { now = new Date() } = {}) {
  if (!redis) throw new Error('Redis é obrigatório para o mapa de demanda');
  const sources = buildSourceBuckets(now);
  const scores = new Map();
  const raw = new Map();

  for (const source of sources) {
    const counts = (await redis.hgetall(source.key)) || {};
    for (const [cell, value] of Object.entries(counts)) {
      const count = Number(value) || 0;
      if (count <= 0) continue;
      scores.set(cell, (scores.get(cell) || 0) + count * source.weight);
      raw.set(cell, (raw.get(cell) || 0) + count);
    }
  }

  const ranked = Array.from(scores.entries())
    .filter(([cell]) => (raw.get(cell) || 0) >= MIN_REQUESTS_PER_CELL)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CELLS);
  const top = ranked.length ? ranked[0][1] : 0;

  const cells = ranked.map(([cell, score]) => {
    const [lat, lng] = h3.cellToLatLng(cell);
    // Raiz para não deixar uma única célula muito forte apagar o resto do mapa.
    const intensity = top > 0 ? Math.sqrt(score / top) : 0;
    return {
      h3Index: cell,
      center: { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) },
      boundary: h3.cellToBoundary(cell).map(([bLat, bLng]) => ({
        lat: Number(bLat.toFixed(6)),
        lng: Number(bLng.toFixed(6)),
      })),
      intensity: Number(intensity.toFixed(3)),
      level: intensity >= 0.66 ? 'high' : intensity >= 0.33 ? 'medium' : 'low',
    };
  });

  const payload = {
    generatedAt: now.toISOString(),
    resolution: RESOLUTION,
    windowWeeks: WEEKS_BACK,
    cells,
  };
  await redis.set(HEAT_KEY, JSON.stringify(payload), 'EX', HEAT_TTL_SECONDS);
  return { cells: cells.length, sources: sources.length };
}

async function getDemandHeat(redis) {
  if (!redis) return null;
  const value = await redis.get(HEAT_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  recordRideRequest,
  materializeDemandHeat,
  getDemandHeat,
  helpers: {
    localParts,
    buildSourceBuckets,
    bucketKey,
    HEAT_KEY,
    RESOLUTION,
    MIN_REQUESTS_PER_CELL,
  },
};
