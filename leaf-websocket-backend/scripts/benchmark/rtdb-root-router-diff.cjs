'use strict';
// Differential check of services/rtdb-root-router.js against the real RTDB
// emulator: the same operations run on plain RTDB (control) and through the
// router with the roots served by Firestore (and, separately, mirrored).
// Reads, queries and the RTDB mirror must match the control exactly.
// Local emulators only (cached JARs); no remote endpoint or credential.
const assert = require('node:assert/strict');
const withPrivateRealtime = require('./private-rtdb.cjs');
const withPrivateFirestore = require('./private-firestore.cjs');
const { createRouter } = require('../../services/rtdb-root-router');

const ROOTS = 'vehicles,user_vehicles,vehicle_plate_index,driver_activation,driver_documents_index_stats,driver_document_mutation_locks';
const quiet = () => {};

async function operations(db) {
  await db.ref().update({
    'vehicles/v1': { id: 'v1', plate: 'ABC1D23', status: 'idle', year: 2021, polygon: [[1, 2], [3, 4]] },
    'vehicle_plate_index/ABC1D23': 'v1',
    'user_vehicles/u1/l1': { id: 'l1', vehicleId: 'v1', status: 'pending', approved: false, isActive: false },
    'users/u1/activeVehicleId': 'v1'
  });
  await db.ref('user_vehicles/u1/l1').update({ isActive: true, 'review/by': 'admin', approved: true });
  await db.ref('vehicles/v2').set({ id: 'v2', plate: 'XYZ9K87', status: 'active', year: 2019 });
  await db.ref('vehicles/v2/status').set('idle');
  await db.ref('user_vehicles/u1/l1').update({ 'review/by': null });
  await db.ref().update({ 'user_vehicles/u1/l2': { id: 'l2', vehicleId: 'v2', isActive: false }, 'users/u1/updatedAt': 't1' });
  await db.ref('user_vehicles/u1/l2').remove();
  await db.ref('vehicles/v3').set({ id: 'v3', status: 'active', year: 2024 });
  await db.ref('vehicles/v1/counter').transaction(current => (current || 0) + 5);
  await db.ref('vehicles/v1/counter').transaction(current => (current || 0) + 1);
  await db.ref('vehicles/v3').transaction(() => undefined); // abort
  await db.ref('user_vehicles/u9/l9').set({ id: 'l9', isActive: true });
  await db.ref('user_vehicles/u9').remove();

  // Document mutation lease, as in driver-document-analysis-queue.
  const lock = db.ref('driver_document_mutation_locks/u1/cnh');
  const acquire = token => lock.transaction(current => (
    current?.token && current.token !== token && Number(current.expiresAtMs) > 1000 ? undefined
      : { token, driverId: 'u1', documentType: 'cnh', acquiredAtMs: 500, expiresAtMs: 2000 }
  ), undefined, false);
  const first = await acquire('t1');
  const second = await acquire('t2');
  const renewed = await lock.transaction(current => (current?.token === 't1' ? { ...current, renewedAtMs: 900, expiresAtMs: 3000 } : undefined), undefined, false);
  await db.ref().update({
    'driver_activation/u1/documents/cnh': { status: 'approved', submissionId: 's1', reviewedAt: 'r1' },
    'driver_activation/u1/documents_history/s1': { status: 'approved', submissionId: 's1' },
    'driver_activation/u1/biometrics/cnhFace': { embedding: [0.125, -0.5, 0.75], model: 'face-v1' },
    'driver_activation/u1/updatedAt': 'a1',
    'users/u1/driverActivationStatus': 'approved'
  });
  await db.ref('driver_activation/u1/consent/backgroundCheck').set({ accepted: true, at: 'c1' });
  await db.ref('driver_activation/u1/documents/cnh').update({ reviewedAt: null, note: 'ok' });
  const release = await lock.transaction(current => (current?.token === 't1' ? null : undefined), undefined, false);
  for (const delta of [1, 1, -1, 5]) {
    await db.ref('driver_documents_index_stats/cnh/approved').transaction(current => {
      const next = (Number.parseInt(current, 10) || 0) + delta;
      return next > 0 ? next : 0;
    });
  }
  await db.ref('driver_documents_index_stats/cnh/pending').transaction(current => Math.max(0, (Number(current) || 0) - 1) || null);
  return {
    first: [first.committed, first.snapshot.val()?.token],
    second: [second.committed, second.snapshot.val()?.token],
    renewed: [renewed.committed, renewed.snapshot.val()?.expiresAtMs],
    release: [release.committed, release.snapshot.val()]
  };
}

async function readAll(db) {
  const value = async path => (await db.ref(path).once('value')).val();
  const keys = async query => { const out = []; (await query.once('value')).forEach(child => { out.push(child.key); }); return out; };
  return {
    vehicles: await value('vehicles'),
    v1: await value('vehicles/v1'),
    v1Polygon: await value('vehicles/v1/polygon'),
    missing: await value('vehicles/none/x'),
    userVehicles: await value('user_vehicles'),
    links: await value('user_vehicles/u1'),
    plate: await value('vehicle_plate_index/ABC1D23'),
    users: await value('users'),
    idleKeys: await keys(db.ref('vehicles').orderByChild('status').equalTo('idle')),
    byYear: await keys(db.ref('vehicles').orderByChild('year').limitToFirst(2)),
    lastByKey: await keys(db.ref('vehicles').orderByKey().limitToLast(2)),
    afterKey: await keys(db.ref('vehicles').orderByKey().startAfter('v1')),
    exists: (await db.ref('vehicles/v2').once('value')).exists(),
    notExists: (await db.ref('vehicles/v9').once('value')).exists(),
    activation: await value('driver_activation/u1'),
    history: await value('driver_activation/u1/documents_history'),
    embedding: await value('driver_activation/u1/biometrics/cnhFace/embedding'),
    locks: await value('driver_document_mutation_locks'),
    stats: await value('driver_documents_index_stats')
  };
}

(async () => {
  const results = {};
  await withPrivateRealtime(async control => {
    results.controlTx = await operations(control);
    results.control = await readAll(control);
  });
  await withPrivateFirestore(async firestore => {
    await withPrivateRealtime(async raw => {
      const served = createRouter(raw, { getFirestore: () => firestore, log: quiet,
        env: { RTDB_FIRESTORE_WRITE_ROOTS: ROOTS, RTDB_FIRESTORE_READ_ROOTS: ROOTS } });
      results.servedTx = await operations(served);
      results.served = await readAll(served);
      results.servedMirror = await readAll(raw);
    });
    await withPrivateRealtime(async raw => {
      const mirrored = createRouter(raw, { getFirestore: () => firestore, log: quiet,
        env: { RTDB_FIRESTORE_WRITE_ROOTS: ROOTS } });
      for (const root of ROOTS.split(',')) {
        for (const doc of (await firestore.collection(`rtdb_${root}`).get()).docs) await doc.ref.delete();
      }
      results.mirroredTx = await operations(mirrored);
      results.mirrorRtdb = await readAll(raw);
      const reader = createRouter(raw, { getFirestore: () => firestore, log: quiet,
        env: { RTDB_FIRESTORE_WRITE_ROOTS: ROOTS, RTDB_FIRESTORE_READ_ROOTS: ROOTS } });
      results.mirrorFirestore = await readAll(reader);
    });
  });
  // `users` is not routed: through the served router it must still be plain RTDB.
  // Known RTDB quirk, not reproduced: RTDB runs the update first with a null
  // `current` (no local cache), so `token === mine ? null : undefined` aborts
  // and the lease is never released (it only expires). Firestore passes the
  // stored value, so the release commits and the lock disappears.
  assert.deepEqual(results.controlTx.release, [false, null], 'RTDB release quirk changed; review this check');
  assert.deepEqual(results.servedTx.release, [true, null], 'Firestore-served release must commit');
  const withoutRelease = ({ release, ...rest }) => rest;
  const withoutLocks = ({ locks, ...rest }) => rest;
  assert.deepEqual(withoutRelease(results.servedTx), withoutRelease(results.controlTx), 'Firestore-served transaction outcomes differ from RTDB');
  assert.deepEqual(results.mirroredTx, results.controlTx, 'Mirror-mode transaction outcomes differ from RTDB');
  assert.equal(results.control.locks?.u1?.cnh?.token, 't1', 'RTDB keeps the unreleased lease');
  assert.equal(results.served.locks, null, 'Firestore-served release removes the lease');
  assert.deepEqual(withoutLocks(results.served), withoutLocks(results.control), 'Firestore-served reads differ from RTDB');
  results.served = { ...results.served, locks: results.control.locks };
  results.servedMirror = { ...results.servedMirror, locks: results.servedMirror.locks === null ? results.control.locks : results.servedMirror.locks };
  assert.deepEqual(results.servedMirror, results.control, 'RTDB mirror of Firestore-served roots differs');
  assert.deepEqual(results.mirrorRtdb, results.control, 'Mirror mode changed RTDB results');
  assert.deepEqual(results.mirrorFirestore, results.control, 'Firestore copy in mirror mode differs from RTDB');
  console.log(JSON.stringify({ ok: true, checks: Object.keys(results.control).length, transactions: results.controlTx, control: results.control }));
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
