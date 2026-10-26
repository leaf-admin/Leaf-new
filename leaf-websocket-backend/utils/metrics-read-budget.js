'use strict';
let activeReads = 0;

async function admit(read) {
  if (activeReads >= 2) throw unavailable('Consultas administrativas temporariamente ocupadas');
  activeReads++;
  try { return await read(); }
  finally { activeReads--; }
}

function unavailable(message = 'Métricas temporariamente indisponíveis') {
  return Object.assign(new Error(message), { code: 'METRICS_READ_BUDGET', statusCode: 503 });
}

function assertPayload(value, size, limit) {
  if (size > limit || Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) {
    throw unavailable('Consulta excede orçamento; use o resumo conciliado');
  }
}

async function firestoreSnapshot(query, limit = 2000) {
  const snapshot = await admit(() => query.limit(limit + 1).get());
  assertPayload(snapshot.docs.map(doc => doc.data()), snapshot.docs.length, limit);
  return snapshot;
}

async function realtimeSnapshot(query, limit = 2000) {
  const snapshot = await admit(() => query.limitToFirst(limit + 1).once('value'));
  const value = snapshot.val() || {};
  assertPayload(value, Object.keys(value).length, limit);
  return snapshot;
}

const ACTIVE_HASH = `
if redis.call('HLEN', KEYS[1]) > 200 then return {0} end
local rows = redis.call('HGETALL', KEYS[1])
local bytes = 0
for _, value in ipairs(rows) do bytes = bytes + string.len(value) end
if bytes > 4194304 then return {0} end
table.insert(rows, 1, 1)
return rows
`;

async function activeRideHash(redis) {
  const [allowed, ...rows] = await redis.eval(ACTIVE_HASH, 1, 'bookings:active');
  if (Number(allowed) !== 1) throw unavailable();
  const result = {};
  for (let i = 0; i < rows.length; i += 2) Object.defineProperty(result, rows[i], { value: rows[i + 1], enumerable: true });
  return result;
}

function requireLegacyFallback() {
  // An outage must not automatically move a query to the historical root.
  if (process.env.ENABLE_LEGACY_METRICS_FALLBACK !== 'true') throw unavailable();
}

module.exports = { unavailable, assertPayload, firestoreSnapshot, realtimeSnapshot, requireLegacyFallback, admit, activeRideHash, ACTIVE_HASH };
