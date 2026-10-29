'use strict';
const MAX_ACTIVE_READS = 2;
// The overview page loads several cards at once: a few may wait briefly for a
// slot instead of failing. The queue stays bounded in size and in time.
const MAX_WAITING_READS = 6;
const MAX_WAIT_MS = 8000;
let activeReads = 0;
const waiting = [];

function waitForSlot() {
  if (waiting.length >= MAX_WAITING_READS) {
    return Promise.reject(unavailable('Consultas administrativas temporariamente ocupadas'));
  }
  return new Promise((resolve, reject) => {
    const entry = { resolve, timer: null };
    entry.timer = setTimeout(() => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(unavailable('Consultas administrativas temporariamente ocupadas'));
    }, MAX_WAIT_MS);
    waiting.push(entry);
  });
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) {
    // The slot passes straight to the next read: activeReads stays the same.
    clearTimeout(next.timer);
    next.resolve();
    return;
  }
  activeReads--;
}

async function admit(read) {
  if (activeReads >= MAX_ACTIVE_READS) await waitForSlot();
  else activeReads++;
  try { return await read(); }
  finally { releaseSlot(); }
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

// read(limit) -> { id: record }; one over the budget fails like realtimeSnapshot.
async function recordsSnapshot(read, limit = 2000) {
  const value = (await admit(() => read(limit + 1))) || {};
  assertPayload(value, Object.keys(value).length, limit);
  return value;
}

async function activeRideHash(redis) {
  const [allowed, ...rows] = await redis.eval(ACTIVE_HASH, 1, 'bookings:active');
  if (Number(allowed) !== 1) throw unavailable();
  const result = {};
  for (let i = 0; i < rows.length; i += 2) Object.defineProperty(result, rows[i], { value: rows[i + 1], enumerable: true });
  return result;
}

module.exports = { unavailable, assertPayload, firestoreSnapshot, realtimeSnapshot, recordsSnapshot, admit, activeRideHash, ACTIVE_HASH };
