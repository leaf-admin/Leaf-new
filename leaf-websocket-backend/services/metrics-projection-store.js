'use strict';
const { isDeepStrictEqual } = require('node:util');
const summary = require('./metrics-projection-summary');
const budget = require('../utils/metrics-read-budget');
const mapWithConcurrency = require('../utils/map-with-concurrency');
const BoundedTtlCache = require('../utils/bounded-ttl-cache');
const SOURCES = new Set(['rides', 'sandbox_rides', 'payment_distributions', 'sandbox_payment_distributions', 'audit_logs', 'sandbox_audit_logs']);
const PENDING = 'ops_projection_pending_v1';
const CHECKPOINTS = 'ops_projection_checkpoints_v1';
const BUCKETS = 'ops_metrics_buckets_v1';
let draining = false;
const makeReadCache = () => new BoundedTtlCache({ ttlMs: 60000, maxEntries: 64, maxBytes: 2 * 1024 * 1024 });
let readCache = makeReadCache();
const inFlight = new Map();
const resetReadCache = () => { readCache = makeReadCache(); };
const bucketsFor = vector => vector.kind === 'audit' ? [vector, { ...vector, day: 'all' }] : [vector];
const enabled = () => process.env.ENABLE_OPS_METRIC_WRITES === 'true';

function sourceIdentity(path) {
  const parts = path.split('/');
  if (parts.length !== 2 || !SOURCES.has(parts[0]) || !parts[1]) throw new Error('Unsupported projection source');
  const kind = parts[0].includes('payment_distributions') ? 'distribution' : parts[0].includes('audit_logs') ? 'audit' : 'ride';
  return { id: summary.hash(path), kind, namespace: parts[0].startsWith('sandbox_') ? 'sandbox' : 'operational' };
}

async function write(firestore, ref, data, { method = 'set', merge = false } = {}) {
  if (!enabled()) return method === 'update' ? ref.update(data) : ref.set(data, { merge });
  const identity = sourceIdentity(ref.path);
  const batch = firestore.batch();
  if (method === 'update') batch.update(ref, data);
  else batch.set(ref, data, { merge });
  // Canonical write and durable work are atomic. No crash window before enqueue.
  batch.set(firestore.collection(PENDING).doc(identity.id), {
    schema: 1, sourcePath: ref.path, namespace: identity.namespace, kind: identity.kind, nextAttemptAt: Date.now(), attempts: 0
  });
  const result = await batch.commit();
  resetReadCache();
  return result;
}

function driverRef(firestore, vector) {
  if (!vector?.driver) return null;
  const collection = vector.namespace === 'operational' ? 'ops_driver_stats_v1' : 'sandbox_ops_driver_stats_v1';
  const id = vector.namespace === 'operational' ? vector.driver.id : `${vector.scope}:${vector.driver.id}`;
  return firestore.collection(collection).doc(summary.hash(id));
}

async function project(firestore, path, { backfill = false } = {}) {
  const identity = sourceIdentity(path);
  const pendingRef = firestore.collection(PENDING).doc(identity.id);
  const checkpointRef = firestore.collection(CHECKPOINTS).doc(identity.id);
  return firestore.runTransaction(async tx => {
    const [pending, source, checkpoint] = await tx.getAll(pendingRef, firestore.doc(path), checkpointRef);
    if (!backfill && !pending.exists) return { processed: false };
    if (pending.exists && pending.data().sourcePath !== path) throw new Error('Projection task identity conflict');
    const previous = checkpoint.exists ? checkpoint.data().vector : null;
    const next = source.exists ? summary.contribution(path, source.data()) : null;
    if (isDeepStrictEqual(previous, next)) {
      if (pending.exists) tx.delete(pendingRef);
      return { processed: true, unchanged: true };
    }
    const refs = new Map();
    for (const vector of [previous, next]) if (vector) {
      for (const bucket of bucketsFor(vector)) {
        const ref = firestore.collection(BUCKETS).doc(summary.bucketId(bucket)); refs.set(ref.path, ref);
      }
      const stats = driverRef(firestore, vector); if (stats) refs.set(stats.path, stats);
    }
    const snapshots = refs.size ? await tx.getAll(...refs.values()) : [];
    const values = new Map(snapshots.map(doc => [doc.ref.path, doc.exists ? doc.data() : {}]));
    const now = new Date();
    for (const [vector, sign] of [[previous, -1], [next, 1]]) if (vector) {
      for (const bucket of bucketsFor(vector)) {
        const ref = firestore.collection(BUCKETS).doc(summary.bucketId(bucket));
        const base = values.get(ref.path);
        values.set(ref.path, { schema: 1, namespace: vector.namespace, scope: vector.scope, kind: vector.kind,
          day: bucket.day, shard: vector.shard, updatedAt: now,
          metrics: summary.mergeMetrics(base.metrics, vector.metrics, sign) });
      }
      const statsRef = driverRef(firestore, vector);
      if (statsRef) {
        const stats = values.get(statsRef.path);
        const counters = summary.mergeMetrics({ completedTrips: stats.completedTrips || 0,
          driverNetMinor: stats.driverNetMinor || 0, pendingFinancialTrips: stats.pendingFinancialTrips || 0 }, {
          completedTrips: vector.driver.completedTrips, driverNetMinor: vector.driver.driverNetMinor,
          pendingFinancialTrips: vector.driver.pendingFinancialTrips }, sign);
        values.set(statsRef.path, { schema: 1, namespace: vector.namespace, driverId: vector.driver.id,
          source: 'ride_finalization_v1', complete: stats.complete === true, updatedAt: now,
          completedTrips: counters.completedTrips || 0, driverNetMinor: counters.driverNetMinor || 0,
          pendingFinancialTrips: counters.pendingFinancialTrips || 0 });
      }
    }
    for (const [refPath, value] of values) tx.set(refs.get(refPath), value);
    tx.set(checkpointRef, { schema: 1, sourcePath: path, vector: next, updatedAt: now });
    if (pending.exists) tx.delete(pendingRef);
    return { processed: true };
  });
}

async function drain(firestore, limit = 20) {
  if (!enabled() || !firestore || draining) return { processed: 0, failed: 0, skipped: true };
  draining = true;
  const stats = { processed: 0, failed: 0 };
  try {
    const tasks = await firestore.collection(PENDING).where('nextAttemptAt', '<=', Date.now())
      .orderBy('nextAttemptAt').limit(Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20))).get();
    await mapWithConcurrency(tasks.docs, 4, async task => {
      try { const result = await project(firestore, task.data().sourcePath); if (result.processed) stats.processed++; }
      catch (error) {
        stats.failed++;
        const attempts = Number(task.data().attempts || 0) + 1;
        // Conditional retry never overwrites newer work enqueued for this source.
        await task.ref.update({ attempts, nextAttemptAt: Date.now() + Math.min(300000, 5000 * attempts),
          errorCode: 'PROJECTION_RETRY_REQUIRED' }, { lastUpdateTime: task.updateTime }).catch(() => {});
      }
    });
    return stats;
  } finally { draining = false; }
}

async function readDays(firestore, kind, start, end) {
  if (!['ride', 'distribution', 'audit'].includes(kind)) throw Object.assign(new Error('Resumo inválido'), { statusCode: 400 });
  if (process.env.ENABLE_OPS_METRIC_READS !== 'true' || !enabled()) throw budget.unavailable();
  const allTime = kind === 'audit' && !start && !end;
  const first = allTime ? 'all' : summary.dayKey(start); const last = allTime ? 'all' : summary.dayKey(end);
  const days = [];
  for (let date = new Date(`${first}T12:00:00Z`); !allTime && date.toISOString().slice(0, 10) <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(date.toISOString().slice(0, 10));
    if (days.length > 31) throw Object.assign(new Error('Use uma janela de até31 dias'), { statusCode: 400 });
  }
  if (allTime) days.push('all');
  if (!days.length) throw Object.assign(new Error('Período inválido'), { statusCode: 400 });
  const cacheKey = `${kind}:${first}:${last}`;
  const cached = readCache.get(cacheKey);
  if (cached) return { ...cached, cached: true, freshnessAgeMs: Date.now() - Date.parse(cached.generatedAt) };
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  if (inFlight.size >= 2) throw budget.unavailable();
  const cache = readCache;
  const work = budget.admit(() => firestore.runTransaction(async tx => {
    const readiness = await tx.get(firestore.collection('ops_read_models').doc(`metrics_${kind}_v1`));
    const marker = readiness.exists ? readiness.data() : null;
    if (marker?.schema !== 1 || marker.ready !== true || marker.timeZone !== summary.TIME_ZONE
      || marker.shards !== summary.SHARDS || (!allTime && (marker.coverageStart > first || marker.coverageEnd < last))
      || (!allTime && (typeof marker.coverageStart !== 'string' || typeof marker.coverageEnd !== 'string'))
      || (allTime && marker.allTime !== true)) throw budget.unavailable('Resumo aguardando conciliação');
    const pending = await tx.get(firestore.collection(PENDING).where('namespace', '==', 'operational').where('kind', '==', kind).limit(1));
    if (!pending.empty) throw budget.unavailable('Resumo em atualização');
    const refs = days.flatMap(day => Array.from({ length: summary.SHARDS }, (_, shard) =>
      firestore.collection(BUCKETS).doc(`operational_${kind}_${day}_${shard}`)));
    const snapshots = await tx.getAll(...refs);
    budget.assertPayload(snapshots.filter(doc => doc.exists).map(doc => doc.data()), snapshots.length, 512);
    let metrics = {};
    let updatedAt = null;
    for (const doc of snapshots) if (doc.exists) {
      const data = doc.data();
      if (data.schema !== 1 || data.namespace !== 'operational' || data.kind !== kind) throw budget.unavailable('Resumo incompatível');
      metrics = summary.mergeMetrics(metrics, data.metrics);
      const at = summary.timestamp(data.updatedAt);
      if (Number.isFinite(at)) updatedAt = Math.max(updatedAt || 0, at);
    }
    return { metrics, source: 'ops_metrics_buckets_v1', timeZone: summary.TIME_ZONE,
      calendarDays: allTime ? null : days.length, updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      generatedAt: new Date().toISOString(), cached: false, freshnessAgeMs: 0 };
  }, { readOnly: true })).then(result => { cache.set(cacheKey, result); return result; })
    .finally(() => { inFlight.delete(cacheKey); });
  inFlight.set(cacheKey, work);
  return work;
}

module.exports = { write, project, drain, readDays, enabled, sourceIdentity, resetReadCache, PENDING, CHECKPOINTS, BUCKETS };
