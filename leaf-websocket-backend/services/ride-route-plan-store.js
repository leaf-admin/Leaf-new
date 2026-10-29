'use strict';

// Rota da corrida (motorista -> embarque -> destino) calculada uma vez por corrida e
// guardada no servidor. O Google cobra por chamada, não por perna: com a cotação, são
// 2 chamadas por corrida. Motorista e passageiro, e qualquer reabertura do app, recebem
// esta mesma rota em vez de pedir outra (cada aparelho tem um GPS um pouco diferente,
// então a chave do cache de rotas nunca batia entre os dois).
const PLAN_TTL_SECONDS = 6 * 60 * 60;
const LOCK_TTL_SECONDS = 10;
const WAIT_MS = 4000;
const POLL_MS = 150;
const SAME_POINT_METERS = 80;

function planKey(bookingId) {
  return `ride_route_plan:v1:${bookingId}`;
}

function parsePoint(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const lat = Number(value.lat ?? value.latitude);
    const lng = Number(value.lng ?? value.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const [lat, lng] = String(value).split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function firstWaypoint(waypoints) {
  if (Array.isArray(waypoints)) return parsePoint(waypoints[0]);
  if (typeof waypoints === 'string') return parsePoint(waypoints.split('|')[0]);
  return parsePoint(waypoints);
}

function metersBetween(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

async function isRideParticipant(redis, bookingId, uid) {
  if (!uid || typeof redis?.hgetall !== 'function') return false;
  const booking = await redis.hgetall(`booking:${bookingId}`).catch(() => null);
  if (!booking || Object.keys(booking).length === 0) return false;
  const participants = [booking.customerId, booking.passengerId, booking.driverId].filter(Boolean);
  return participants.includes(uid);
}

function matchesRequest(plan, { pickup, destination }) {
  return metersBetween(plan?.pickup, pickup) <= SAME_POINT_METERS &&
    metersBetween(plan?.destination, destination) <= SAME_POINT_METERS;
}

async function readPlan(redis, { bookingId, pickup, destination }) {
  const raw = await redis.get(planKey(bookingId)).catch(() => null);
  if (!raw) return null;
  try {
    const plan = JSON.parse(raw);
    return plan?.data && matchesRequest(plan, { pickup, destination }) ? plan : null;
  } catch (_error) {
    return null;
  }
}

// Returns { plan } when it already exists (or another request finished it meanwhile),
// or { owner: true } when this request should compute and save it.
async function claimOrWait(redis, request) {
  const existing = await readPlan(redis, request);
  if (existing) return { plan: existing };
  if (typeof redis?.set !== 'function') return { owner: true };
  const acquired = await redis
    .set(`${planKey(request.bookingId)}:lock`, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
    .catch(() => 'OK');
  if (acquired === 'OK') return { owner: true };
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const plan = await readPlan(redis, request);
    if (plan) return { plan };
  }
  return { owner: true };
}

async function savePlan(redis, { bookingId, pickup, destination, data }) {
  if (!data || typeof redis?.setex !== 'function') return false;
  await redis.setex(
    planKey(bookingId),
    PLAN_TTL_SECONDS,
    JSON.stringify({ pickup, destination, data, savedAt: new Date().toISOString() }),
  ).catch(() => null);
  return true;
}

module.exports = {
  PLAN_TTL_SECONDS,
  planKey,
  parsePoint,
  firstWaypoint,
  isRideParticipant,
  claimOrWait,
  savePlan,
};
