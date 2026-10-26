#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const mapWithConcurrency = require('../../utils/map-with-concurrency');
const withFirestore = require('./private-firestore.cjs');
const store = require('../../services/metrics-projection-store');
const summary = require('../../services/metrics-projection-summary');

async function run() {
  process.env.ENABLE_OPS_METRIC_WRITES = 'true';
  process.env.ENABLE_OPS_METRIC_READS = 'true';
  return withFirestore(async firestore => {
    const window = summary.calendarWindow('custom', '2026-10-01', '2026-10-31');
    const data = { createdAt: new Date('2026-10-10T14:00:00Z'), acceptedAt: new Date('2026-10-10T14:02:00Z'),
      driverId: 'driver-a', status: 'COMPLETED', finalPrice: 81.17, driverNetAmount: 78.42, operationalFee: 1.49,
      financialSnapshotSource: 'backend_final', authoritativeSnapshot: true };
    const source = firestore.doc('rides/lifecycle');
    const taskRef = firestore.collection(store.PENDING).doc(summary.hash(source.path));
    const marker = { schema: 1, ready: true, timeZone: summary.TIME_ZONE, shards: summary.SHARDS,
      coverageStart: '2026-10-01', coverageEnd: '2026-10-31' };
    await assert.rejects(store.readDays(firestore, 'ride', window.start, window.end), /conciliação/);
    await firestore.doc('ops_read_models/metrics_ride_v1').set(marker);
    await store.write(firestore, source, data);
    assert.equal((await taskRef.get()).exists, true, 'Crash before worker leaves durable work');
    await assert.rejects(store.readDays(firestore, 'ride', window.start, window.end), /atualização/);
    assert.equal((await store.drain(firestore)).processed, 1);
    let result = await store.readDays(firestore, 'ride', window.start, window.end);
    assert.equal(result.metrics.revenueUnits, 81170000);
    assert.equal(result.metrics.waitMs, 120000);
    assert.equal((await store.project(firestore, source.path, { backfill: true })).unchanged, true);
    assert.equal((await firestore.doc(`ops_driver_stats_v1/${summary.hash('driver-a')}`).get()).data().complete, false,
      'Runtime cannot attest historical driver coverage');
    // Correction subtracts the old value before adding the new source, without
    // touching ledger/tariff/receipt or replaying any business effect.
    await store.write(firestore, source, { finalPrice: 55, driverId: 'driver-b', driverNetAmount: 52 }, { method: 'update' });
    await Promise.all([store.project(firestore, source.path), store.project(firestore, source.path)]);
    store.resetReadCache(); result = await store.readDays(firestore, 'ride', window.start, window.end);
    assert.equal(result.metrics.requests, 1); assert.equal(result.metrics.revenueUnits, 55000000);
    assert.equal((await firestore.doc(`ops_driver_stats_v1/${summary.hash('driver-a')}`).get()).data().completedTrips, 0);
    assert.equal((await firestore.doc(`ops_driver_stats_v1/${summary.hash('driver-b')}`).get()).data().completedTrips, 1);
    await store.write(firestore, source, { status: 'cancelled' }, { method: 'update' });
    await store.drain(firestore); store.resetReadCache();
    result = await store.readDays(firestore, 'ride', window.start, window.end);
    assert.equal(result.metrics.completed || 0, 0); assert.equal(result.metrics.cancelledAccepted, 1);
    assert.equal(result.metrics.revenueUnits || 0, 0);
    // Partial batch must not leave an orphan work item or a false canonical write.
    const missing = firestore.doc('rides/missing');
    await assert.rejects(store.write(firestore, missing, { status: 'completed' }, { method: 'update' }));
    assert.equal((await firestore.collection(store.PENDING).doc(summary.hash(missing.path)).get()).exists, false);
    const sandbox = firestore.doc('sandbox_rides/sandbox-case');
    await store.write(firestore, sandbox, { ...data, financialNamespace: 'sandbox', financialContextId: 'qa-case-1' });
    await store.drain(firestore); store.resetReadCache();
    assert.equal((await store.readDays(firestore, 'ride', window.start, window.end)).metrics.completed || 0, 0);
    const audit = firestore.doc('audit_logs/audit-case');
    await store.write(firestore, audit, { timestamp: data.createdAt, createdAt: data.createdAt,
      action: 'completeRide', resource: 'ride', severity: 'INFO', success: true });
    await store.drain(firestore);
    await firestore.doc('ops_read_models/metrics_audit_v1').set({ ...marker, allTime: true });
    assert.equal((await store.readDays(firestore, 'audit')).metrics.logs, 1);
    const distribution = firestore.doc('payment_distributions/distribution-case');
    await store.write(firestore, distribution, { createdAt: data.createdAt, retainedFees: { operationalFee: 99 } });
    await store.drain(firestore);
    await firestore.doc('ops_read_models/metrics_distribution_v1').set(marker);
    assert.equal((await store.readDays(firestore, 'distribution', window.start, window.end)).metrics.feeUnits, 990000);
    // Source changed while project is in flight: either serialization order must
    // leave the latest source represented or a durable pending task.
    await store.write(firestore, source, data);
    await Promise.all([store.project(firestore, source.path), store.write(firestore, source,
      { finalPrice: 99 }, { method: 'update' })]);
    await store.drain(firestore); store.resetReadCache();
    assert.equal((await store.readDays(firestore, 'ride', window.start, window.end)).metrics.revenueUnits, 99000000);

    const contention = [];
    for (const mode of ['single-hot-shard', 'balanced-16']) {
      const paths = []; let candidate = 0;
      for (let i = 0; i < 64; i++) {
        let path;
        do { path = `rides/contention-${mode}-${candidate++}`; }
        while (Number.parseInt(summary.hash(path).slice(0, 2), 16) % summary.SHARDS !== (mode === 'single-hot-shard' ? 0 : i % 16));
        paths.push(path);
      }
      await mapWithConcurrency(paths, 4, path => store.write(firestore, firestore.doc(path),
        { createdAt: new Date('2026-09-15T12:00:00Z'), status: 'pending', driverId: null }));
      let attempts = 0; const latencies = [];
      const observed = { doc: path => firestore.doc(path), collection: name => firestore.collection(name),
        runTransaction: fn => firestore.runTransaction(tx => { attempts++; return fn(tx); }) };
      const started = performance.now();
      await mapWithConcurrency(paths, 4, async path => {
        const at = performance.now(); await store.project(observed, path); latencies.push(performance.now() - at);
      });
      latencies.sort((a, b) => a - b);
      contention.push({ mode, events: paths.length, concurrency: 4, transactionAttempts: attempts,
        durationMs: performance.now() - started, p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1] });
    }

    const queryRows = [];
    const reads = [];
    const measured = { collection: name => firestore.collection(name), runTransaction: (fn, options) =>
      firestore.runTransaction(tx => fn({
        get: async ref => { reads.push({ path: ref.path || 'pending-query', records: 1 }); return tx.get(ref); },
        getAll: async (...refs) => { reads.push({ path: 'bucket-documents', records: refs.length }); return tx.getAll(...refs); }
      }), options) };
    for (const total of [100, 1000, 10000]) {
      // Large dataset seeds read-model buckets from a synthetic oracle. The
      // lifecycle scenarios above exercise the actual transactional writer.
      const buckets = new Map();
      for (let i = 0; i < total; i++) {
        const vector = summary.contribution(`rides/scale-${i}`, data);
        const id = summary.bucketId(vector);
        const current = buckets.get(id) || { schema: 1, namespace: 'operational', kind: 'ride', updatedAt: new Date(), metrics: {} };
        current.metrics = summary.mergeMetrics(current.metrics, vector.metrics); buckets.set(id, current);
      }
      let batch = firestore.batch();
      for (const [id, value] of buckets) batch.set(firestore.collection(store.BUCKETS).doc(id), value);
      await batch.commit();
      // Canonical historical documents exist but reader is prohibited from
      // accessing them; their payload is deliberately irrelevant to the query.
      for (let i = 0; i < total; i += 400) {
        batch = firestore.batch();
        for (let j = i; j < Math.min(total, i + 400); j++) batch.set(firestore.doc(`rides/scale-${j}`), data);
        await batch.commit();
      }
      store.resetReadCache(); reads.length = 0;
      const response = await store.readDays(measured, 'ride', window.start, window.end);
      assert.equal(response.metrics.completed, total);
      assert.equal(response.metrics.revenueUnits, 81170000 * total);
      const row = { historicalRides: total, calendarDays: 31, bucketDocuments: reads.filter(r => r.path === 'bucket-documents').reduce((n, r) => n + r.records, 0),
        controlReads: reads.filter(r => r.path !== 'bucket-documents').length, canonicalRideReads: 0 };
      assert.equal(row.bucketDocuments, 496); assert.equal(row.controlReads, 2);
      reads.length = 0;
      assert.equal((await store.readDays(measured, 'ride', window.start, window.end)).cached, true);
      assert.equal(reads.length, 0, 'Repeated refresh served from bounded cache');
      queryRows.push(row);
    }
    const resultEvidence = { environment: 'Private Firestore1.19.8 emulator, loopback,256MiB; no ADC/providers', queryRows, contention,
      checks: ['Canonical write + pending work atomic', 'Pending/missing readiness never returns fake zero', 'Replay and parallel project idempotent',
        'Financial correction/cancellation subtract old contribution', 'Driver reassignment preserves one completed trip', 'Historical stats remain incomplete until attested',
        'Sandbox context separate', 'Audit lifetime and distribution own-source buckets', 'Concurrent source update leaves newest contribution', 'Repeated read has zero database calls'],
      limitations: ['Large read-model fixture seeded from synthetic oracle; lifecycle writer tested separately',
        '496 bucket reads plus2 control reads per cold31-day window; missing docs may also be billed outside emulator',
        '60s/process cache explicitly reports freshness', 'Does not measure production capacity, actual bill or deployed indexes'] };
    return resultEvidence;
  });
}
run().then(result => {
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
