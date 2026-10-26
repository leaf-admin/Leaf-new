'use strict';

// Additive read model. Writers/readers are separately gated; production must
// establish parity and a generation-bound readiness marker before switching.
const PREFIX = 'h3:map:regional:v1';
const READY_KEY = `${PREFIX}:ready`;
const MAX_MEMBERS = 2000;
const enabledWrites = () => process.env.ENABLE_H3_REGIONAL_WRITES === 'true';
const enabledReads = () => process.env.ENABLE_H3_REGIONAL_READS === 'true';
const ACTIVE = new Set(['MATCHED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'REASSIGNED_IN_PROGRESS', 'STARTED']);
const SEARCH = new Set(['SEARCHING', 'PENDING', 'EXPANDED', 'NOTIFIED', 'AWAITING_RESPONSE', 'REASSIGNMENT_PENDING']);

function location(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const lat = Number(value?.lat ?? value?.latitude);
    const lng = Number(value?.lng ?? value?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  } catch (_) { return null; }
}

const UPDATE = `
for i, expected in ipairs({'zset', 'hash', 'zset'}) do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= expected then return redis.error_reply('MAP_INDEX_WRONG_TYPE') end
end
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[6], 'LIMIT', 0, 50)
for _, id in ipairs(expired) do redis.call('ZREM', KEYS[1], id); redis.call('HDEL', KEYS[2], id); redis.call('ZREM', KEYS[3], id) end
if ARGV[2] == '' then
  redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('HDEL', KEYS[2], ARGV[1]); redis.call('ZREM', KEYS[3], ARGV[1])
else
  redis.call('GEOADD', KEYS[1], ARGV[3], ARGV[4], ARGV[1])
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[2]); redis.call('ZADD', KEYS[3], ARGV[5], ARGV[1])
end
return 1
`;

async function write(redis, kind, id, value, ttlMs) {
  if (!enabledWrites() || !id) return;
  const point = value?.location;
  try {
    const serialized = point ? JSON.stringify(value) : '';
    if (String(id).length > 256 || Buffer.byteLength(serialized) > 2048) throw new Error('Map projection exceeds byte budget');
    await redis.eval(UPDATE, 3, `${PREFIX}:${kind}:geo`, `${PREFIX}:${kind}:data`, `${PREFIX}:${kind}:expires`,
      String(id), serialized, String(point?.lng ?? ''), String(point?.lat ?? ''),
      String(Date.now() + ttlMs), String(Date.now()));
  } catch (error) {
    // A failed projection must disable its reader instead of serving partial
    // data under an old readiness attestation. Canonical ride actions continue.
    await redis.del(READY_KEY).catch(() => {});
    throw error;
  }
}

async function indexSearch(redis, bookingId) {
  if (!enabledWrites()) return;
  let fields;
  try { fields = await redis.hmget(`booking_search:${bookingId}`, 'state', 'pickupLocation', 'createdAt'); }
  catch (error) { await redis.del(READY_KEY).catch(() => {}); throw error; }
  const [state, pickup, createdAt] = fields;
  const point = location(pickup);
  const value = point && SEARCH.has(String(state).toUpperCase())
    ? { bookingId: String(bookingId), location: point, state, createdAt: Number(createdAt) || Date.now(), indexedAt: Date.now() } : null;
  return write(redis, 'search', bookingId, value, 60 * 60 * 1000);
}

async function indexTrip(redis, booking) {
  if (!enabledWrites()) return;
  const id = booking.bookingId || booking.id;
  const state = String(booking.status || booking.state || '').toUpperCase();
  const point = location(booking.currentLocation) || location(booking.driverLocation)
    || location(booking.pickupLocation) || location(booking.pickup) || location(booking.destinationLocation) || location(booking.drop);
  const value = ACTIVE.has(state) && point ? { bookingId: String(id), driverId: booking.driverId || null,
    location: point, status: state, indexedAt: Date.now() } : null;
  return write(redis, 'trip', id, value, 12 * 60 * 60 * 1000);
}

async function remove(redis, kind, id) { return write(redis, kind, id, null, 0); }

async function assertReady(redis) {
  if (!enabledWrites()) throw Object.assign(new Error('Escrita regional não habilitada'), { statusCode: 503, code: 'MAP_REGION_NOT_READY' });
  const [raw, generation] = await redis.mget(READY_KEY, 'leaf:runtime:critical-dataset:generation');
  let ready;
  try { ready = JSON.parse(raw); } catch (_) { /* unready */ }
  if (!generation || ready?.schema !== 1 || ready.generation !== generation) {
    throw Object.assign(new Error('Índice regional aguardando conciliação'), { statusCode: 503, code: 'MAP_REGION_NOT_READY' });
  }
}

async function read(redis, kind, window) {
  const ids = await redis.geosearch(`${PREFIX}:${kind}:geo`, 'FROMLONLAT', window.centerLng, window.centerLat,
    'BYBOX', window.widthKm, window.heightKm, 'km', 'COUNT', MAX_MEMBERS + 1);
  if (ids.length > MAX_MEMBERS) throw Object.assign(new Error('Região excede orçamento; aproxime o mapa'), { statusCode: 503, code: 'MAP_REGION_DENSE' });
  if (!ids.length) return [];
  const values = await redis.hmget(`${PREFIX}:${kind}:data`, ...ids);
  const expires = await redis.zmscore(`${PREFIX}:${kind}:expires`, ...ids);
  return values.flatMap((raw, i) => {
    if (Number(expires[i]) <= Date.now()) return [];
    if (!raw) throw Object.assign(new Error('Índice regional incompleto'), { statusCode: 503 });
    try { return [JSON.parse(raw)]; } catch (_) { throw Object.assign(new Error('Índice regional inválido'), { statusCode: 503 }); }
  });
}

module.exports = { PREFIX, READY_KEY, MAX_MEMBERS, UPDATE, enabledReads, enabledWrites,
  indexSearch, indexTrip, remove, assertReady, read };
