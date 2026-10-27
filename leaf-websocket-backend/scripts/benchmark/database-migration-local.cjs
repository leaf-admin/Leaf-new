#!/usr/bin/env node
'use strict';
// Always creates private synthetic stores. No remote target/credential option.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const withFirestore = require('./private-firestore.cjs');
const withRedis = require('./private-redis.cjs');
const migration = require('../maintenance/database-read-models.cjs');
const store = require('../../services/metrics-projection-store');
const summary = require('../../services/metrics-projection-summary');
const regional = require('../../services/map-regional-index');
const newUsers = require('../../services/new-user-read-models');

withFirestore(firestore => withRedis(async redis => {
  process.env.ENABLE_OPS_METRIC_WRITES = 'true';
  process.env.ENABLE_OPS_METRIC_READS = 'false';
  process.env.ENABLE_H3_REGIONAL_WRITES = 'true';
  process.env.ENABLE_H3_REGIONAL_READS = 'false';
  const rideData = { status: 'COMPLETED', driverId: 'driver', createdAt: new Date('2026-10-26T14:00:00Z'),
    finalPrice: 30, driverNetAmount: 28.77, financialSnapshotSource: 'backend_final', authoritativeSnapshot: true };
  let checkpoint;
  let batch = firestore.batch();
  for (let i = 0; i < 45; i++) batch.set(firestore.doc(`rides/migrate-${String(i).padStart(4, '0')}`), rideData);
  await batch.commit();
  assert.equal((await migration.metricBatch({ firestore, collection: 'rides', limit: 10 })).rows, 10);
  let metricRows = 0;
  do {
    const result = await migration.metricBatch({ firestore, collection: 'rides', checkpoint, limit: 10, apply: true, authorization: 'local-emulator' });
    metricRows += result.rows; checkpoint = result.checkpoint;
  } while (!checkpoint.passComplete);
  assert.equal(metricRows, 45);
  const stats = (await firestore.doc(`ops_driver_stats_v1/${summary.hash('driver')}`).get()).data();
  assert.equal(stats.completedTrips, 45); assert.equal(stats.complete, false);
  assert.equal((await firestore.doc('ops_read_models/metrics_ride_v1').get()).exists, false);
  await firestore.doc('users/legacy-driver').set({ userType: 'driver', createdAt: new Date() });
  await firestore.doc('users/current-driver').set({ usertype: 'driver', createdAt: new Date().toISOString() });
  const inspection = await migration.directoryBatch({ firestore, limit: 10 });
  assert.equal(inspection.issues.length, 2); assert.equal(inspection.readinessChanged, false);

  await redis.set('leaf:runtime:critical-dataset:generation', 'synthetic-generation');
  await redis.hset('bookings:active', 'active', JSON.stringify({ status: 'IN_PROGRESS', driverId: 'driver', pickupLocation: { lat: -22.9, lng: -43.2 } }));
  await redis.hset('booking_search:not-in-legacy-index', { state: 'SEARCHING', pickupLocation: JSON.stringify({ lat: -22.9, lng: -43.2 }) });
  for (const kind of ['trip', 'search']) {
    checkpoint = undefined;
    do { checkpoint = (await migration.regionalBatch({ redis, kind, checkpoint, apply: true, authorization: 'local-emulator' })).checkpoint; }
    while (!checkpoint.passComplete);
  }
  assert.equal(await redis.zcard(`${regional.PREFIX}:trip:geo`), 1);
  assert.equal(await redis.zcard(`${regional.PREFIX}:search:geo`), 1, 'Seed covers search omitted from old set');
  assert.equal(await redis.exists(regional.READY_KEY), 0);
  await redis.set('leaf:runtime:critical-dataset:generation', 'changed');
  await assert.rejects(migration.regionalBatch({ redis, kind: 'search', checkpoint }), /generation/);

  process.env.ENABLE_NEW_USER_READ_MODEL_INIT = 'true';
  const config = { getFirestore: () => firestore };
  const fresh = { uid: 'fresh-auth-record-fixture', metadata: { creationTime: new Date().toISOString() } };
  const initialized = await newUsers.initialize(fresh, { config });
  assert.equal(initialized.initialized, 1); assert.equal(initialized.failed, 0);
  const statRef = firestore.doc(`ops_driver_stats_v1/${summary.hash(fresh.uid)}`);
  await statRef.update({ completedTrips: 3 }); await newUsers.initialize(fresh, { config });
  assert.equal((await statRef.get()).data().completedTrips, 3, 'Initialization retry never resets existing totals');
  assert.equal((await statRef.get()).data().complete, true);
  assert.equal((await newUsers.initialize({ uid: 'old', createdAt: new Date().toISOString(),
    metadata: { creationTime: '2020-01-01T00:00:00Z' } }, { config })).skipped, true);
  return { environment: 'Private Firestore emulator and Redis Unix socket; synthetic data only, no Auth provider',
    metricsRows: metricRows,
    checks: ['Dry-run writes nothing', 'Cursor resume/repeated batch idempotent', 'Historical readiness never automatically set',
      'Regional seed includes unindexed search and rejects generation switch', 'Trusted-new-user initializer preserves concurrent totals'],
    limitations: ['No production adapter or credentials executed; apply library requires an explicit maintenance reference',
      'Completed scan is not a readiness attestation; operator parity and homogeneous shadow writers are still required',
      'Auth UserRecord is a synthetic fixture; real Admin Auth response path only verified by code/tests',
      'Initializer only wired to newly-created users in backend custom OTP; other registration paths remain conservative until migrated'] };
})).then(result => {
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
