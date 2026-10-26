'use strict';
// Offline/explicit maintenance library. No credentials, provider clients,
// endpoints, scheduler or automatic readiness changes.
const { createHash } = require('node:crypto');
const receipts = require('../../services/receipt-history-index');
const projections = require('../../services/metrics-projection-store');
const budget = require('../../utils/metrics-read-budget');
const mapWithConcurrency = require('../../utils/map-with-concurrency');
const regional = require('../../services/map-regional-index');
const SOURCE_COLLECTIONS = new Set(['rides', 'sandbox_rides', 'payment_distributions', 'sandbox_payment_distributions', 'audit_logs', 'sandbox_audit_logs']);

function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const limitOf = value => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 50));

function cursorFor(checkpoint, source) {
  if (!checkpoint) return null;
  if (checkpoint.schema !== 1 || checkpoint.source !== source || (checkpoint.lastKey !== null &&
    (typeof checkpoint.lastKey !== 'string' || checkpoint.lastKey.length > 256))) throw new Error('Migration checkpoint scope mismatch');
  return checkpoint.lastKey;
}

function assertWrite(apply, authorization) {
  if (apply && (typeof authorization !== 'string' || !authorization.trim())) throw new Error('Explicit maintenance authorization reference required');
}

function checkpointFor(source, rows, hasMore, previous) {
  return { schema: 1, source, lastKey: rows.length ? rows[rows.length - 1].id : previous,
    passComplete: !hasMore, parityAttested: false };
}

async function metricBatch({ firestore, collection, checkpoint, limit, apply = false, authorization }) {
  if (!SOURCE_COLLECTIONS.has(collection)) throw new Error('Unsupported metric migration source');
  assertWrite(apply, authorization);
  if (apply && !projections.enabled()) throw new Error('Metric shadow writers must be enabled before backfill');
  const position = cursorFor(checkpoint, collection); const size = limitOf(limit);
  let query = firestore.collection(collection).orderBy('__name__');
  if (position) query = query.startAfter(position);
  const snapshot = await budget.admit(() => query.limit(size + 1).get());
  budget.assertPayload(snapshot.docs.map(doc => doc.data()), snapshot.docs.length, size + 1);
  const rows = snapshot.docs.slice(0, size);
  if (apply) await mapWithConcurrency(rows, 4, doc => projections.project(firestore, `${collection}/${doc.id}`, { backfill: true }));
  return { dryRun: !apply, rows: rows.length, estimatedProjectionTransactions: rows.length,
    checkpoint: checkpointFor(collection, rows, snapshot.docs.length > size, position), readinessChanged: false };
}

async function receiptBatch({ db, collection = 'receipts', checkpoint, limit, apply = false, authorization,
  resolveScope, assertRecord, ownerOf, timestampOf }) {
  if (!['receipts', 'sandbox_receipts'].includes(collection)) throw new Error('Unsupported receipt migration source');
  assertWrite(apply, authorization);
  if (apply && !receipts.enabledWrites()) throw new Error('Receipt shadow writers must be enabled before backfill');
  if (apply && receipts.enabledReads()) throw new Error('Disable receipt readers during backfill');
  const position = cursorFor(checkpoint, collection); const size = limitOf(limit);
  let query = db.ref(collection).orderByKey();
  if (position) query = query.startAfter(position);
  const snapshot = await query.limitToFirst(size + 1).once('value');
  const raw = snapshot.val() || {};
  budget.assertPayload(raw, Object.keys(raw).length, size + 1);
  const ordered = []; snapshot.forEach(child => { ordered.push([child.key, child.val()]); });
  const entries = ordered.slice(0, size);
  const options = { ownerOf, timestampOf };
  await mapWithConcurrency(entries, 4, async ([id, original]) => {
    if (original.rideId && String(original.rideId) !== id) throw new Error('Canonical receipt ID mismatch requires reconciliation');
    const receipt = { ...original, rideId: id };
    const scope = resolveScope(receipt);
    if (scope.collections.receipts !== collection) throw new Error('Receipt migration namespace mismatch');
    assertRecord(receipt, scope);
    const updates = receipts.buildUpdates(receipt, scope, options);
    if (!Object.keys(updates).length) throw new Error('Receipt owner missing; reconciliation required');
    for (const role of ['customer', 'driver']) {
      const owner = ownerOf(receipt, role);
      if (owner) updates[`${receipts.ownerBase(scope, role, owner)}/meta/ready`] = false;
    }
    if (!apply) return;
    const source = db.ref(`${collection}/${id}`);
    if (digest((await source.once('value')).val()) !== digest(original)) throw new Error('Receipt changed before migration; retry this batch');
    await receipts.claimIdentity(db, receipt, scope, options);
    // Derived keys only; original financial receipt/reference is untouched.
    await db.ref().update(updates);
    if (digest((await source.once('value')).val()) !== digest(original)) throw new Error('Receipt changed during migration; readiness remains false');
  });
  return { dryRun: !apply, rows: entries.length, estimatedApply: { canonicalReads: entries.length * 2,
    identityTransactions: entries.length, projectionRootUpdates: entries.length },
    checkpoint: checkpointFor(collection, entries.map(([id]) => ({ id })), Object.keys(raw).length > size, position), readinessChanged: apply ? 'invalidated-only' : false };
}

async function directoryBatch({ firestore, checkpoint, limit }) {
  const source = 'driver-directory-inspection'; const position = cursorFor(checkpoint, source); const size = limitOf(limit);
  let query = firestore.collection('users').orderBy('__name__').select('usertype', 'userType', 'role', 'createdAt');
  if (position) query = query.startAfter(position);
  const snapshot = await query.limit(size + 1).get();
  budget.assertPayload(snapshot.docs.map(doc => doc.data()), snapshot.docs.length, size + 1);
  const docs = snapshot.docs.slice(0, size); const issues = [];
  for (const doc of docs) {
    const user = doc.data();
    if (String(user.usertype || user.userType || user.role).toLowerCase() !== 'driver') continue;
    if (user.usertype !== 'driver') issues.push({ id: doc.id, reason: 'usertype_not_canonical' });
    if (typeof user.createdAt !== 'string' || !Number.isFinite(Date.parse(user.createdAt)) || new Date(user.createdAt).toISOString() !== user.createdAt) {
      issues.push({ id: doc.id, reason: 'createdAt_not_canonical_iso' });
    }
  }
  return { rows: docs.length, issues, readinessChanged: false,
    checkpoint: checkpointFor(source, docs, snapshot.docs.length > size, position) };
}

async function regionalBatch({ redis, kind, checkpoint, apply = false, authorization }) {
  if (!['trip', 'search'].includes(kind)) throw new Error('Unsupported regional source');
  assertWrite(apply, authorization);
  if (apply && regional.enabledReads()) throw new Error('Disable regional readers before seed');
  if (apply && !regional.enabledWrites()) throw new Error('Regional shadow writer must be enabled before seed');
  const source = `regional-${kind}`; const cursor = cursorFor(checkpoint, source) || '0';
  const generation = await redis.get('leaf:runtime:critical-dataset:generation');
  if (!generation || (checkpoint?.generation && checkpoint.generation !== generation)) throw new Error('Redis generation changed; restart reconciliation');
  const [next, values] = kind === 'trip' ? await redis.hscan('bookings:active', cursor, 'COUNT', 50)
    : await redis.scan(cursor, 'MATCH', 'booking_search:*', 'COUNT', 50);
  const count = kind === 'trip' ? values.length / 2 : values.length;
  budget.assertPayload(values, count, 1000);
  if (apply) {
    const work = kind === 'trip' ? Array.from({ length: count }, (_, i) => [values[i * 2], values[i * 2 + 1]]) : values;
    await mapWithConcurrency(work, 4, async item => {
      if (kind === 'search') return regional.indexSearch(redis, item.slice('booking_search:'.length));
      const [id, raw] = item;
      // Re-read that identity so an old scan sample cannot resurrect a terminal.
      const current = await redis.hget('bookings:active', id);
      if (!current) return regional.remove(redis, 'trip', id);
      return regional.indexTrip(redis, { ...JSON.parse(current), bookingId: id });
    });
  }
  if (generation !== await redis.get('leaf:runtime:critical-dataset:generation')) throw new Error('Redis generation changed during seed');
  return { dryRun: !apply, rows: count, readinessChanged: false,
    checkpoint: { schema: 1, source, lastKey: next, generation, passComplete: next === '0', parityAttested: false } };
}

function normalizeRealtimeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, child]) => [key, normalizeRealtimeValue(child)]).filter(([, child]) => child !== null);
  return entries.length ? Object.fromEntries(entries) : null;
}

function parityAccumulator() {
  let count = 0; let xor = 0n; let sum = 0n; const mask = (1n << 256n) - 1n;
  return { add(value) { const n = BigInt(`0x${digest(value)}`); count++; xor ^= n; sum = (sum + n) & mask; },
    result() { return { count, xor: xor.toString(16).padStart(64, '0'), sum: sum.toString(16).padStart(64, '0') }; } };
}

module.exports = { metricBatch, receiptBatch, directoryBatch, regionalBatch, parityAccumulator, normalizeRealtimeValue, cursorFor, digest };
