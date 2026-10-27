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

const ROOTS = 'vehicles,user_vehicles,vehicle_plate_index,driver_activation,driver_documents_index_stats,driver_document_mutation_locks,users,subscriptions,bookings,sandbox_bookings';
const NATIVE = 'vehicles:vehicle_catalog,user_vehicles:driver_vehicle_links,vehicle_plate_index:vehicle_plate_index,'
  + 'driver_activation:driver_activation,driver_documents_index_stats:driver_document_stats,'
  + 'driver_document_mutation_locks:driver_document_locks,users:users:merge,subscriptions:subscriptions:merge,'
  + 'bookings:ride_annotations,sandbox_bookings:sandbox_ride_annotations';
const quiet = () => {};

async function operations(db) {
  await db.ref().update({
    'vehicles/v1': { id: 'v1', plate: 'ABC1D23', status: 'idle', year: 2021, tags: ['a', 'b'], dims: { w: 1, h: [2, 3] },
      landmarks: [[1.5, 2], [3, [4, 5]]] },
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
  await db.ref().update({
    'users/u1/usertype': 'driver', 'users/u2/usertype': 'customer', 'users/u2/name': 'P',
    'users/u3/usertype': 'driver', 'users/u3/identityReverification': { challengeId: 'ch1', status: 'pending' },
    'subscriptions/u1/planType': 'plus', 'subscriptions/u1/status': 'active', 'subscriptions/u1/dailyCents': 1490
  });
  // KYC-style transaction on the user record (challenge must match). As in
  // kyc-policy-service: on plain RTDB a value listener pins the cache before
  // the transaction; a Firestore-served root reads the stored value directly.
  const userRef = db.ref('users/u3');
  const pin = () => {};
  const servedUsers = db.__rtdbRootRouter?.servedByFirestore?.('users') === true;
  if (!servedUsers) { userRef.on('value', pin); await userRef.once('value'); }
  await userRef.transaction(current => (
    current?.identityReverification?.challengeId === 'ch1'
      ? { ...current, identityReverification: { ...current.identityReverification, status: 'passed' } } : undefined
  ), undefined, false);
  if (!servedUsers) userRef.off('value', pin);
  await db.ref('subscriptions/u1').update({ status: 'paused', 'history/p1': 'x' });
  await db.ref('driver_activation/u1/documents/cnh').update({ reviewedAt: null, note: 'ok' });
  const release = await lock.transaction(current => (current?.token === 't1' ? null : undefined), undefined, false);
  for (const delta of [1, 1, -1, 5]) {
    await db.ref('driver_documents_index_stats/cnh/approved').transaction(current => {
      const next = (Number.parseInt(current, 10) || 0) + delta;
      return next > 0 ? next : 0;
    });
  }
  // Ride annotations (domain 6): receipt pointer, ratings in a multi-root
  // update, safety review flags, as in receipt/rating/safety services.
  await db.ref().update({
    'receipts_probe/r1': { ok: true },
    'bookings/b1/receipt': { receiptId: 'LEAF-b1', hash: 'H1', savedAt: 's1' }
  });
  await db.ref('bookings/b2/receipt').set({ receiptId: 'LEAF-b2', hash: 'H2', savedAt: 's2' });
  await db.ref().update({ 'bookings/b1/rating': 5, 'bookings/b1/feedback': null, 'bookings/b2/driver_rating': 4, 'bookings/b2/driver_feedback': 'ok' });
  await db.ref('sandbox_bookings/b3').update({ opsReviewRequired: true, opsReviewReason: 'sos', opsReviewUpdatedAt: 'o1' });
  await db.ref('bookings/b4').update({ driver: 'd1', status: 'COMPLETED', rating: 3 });
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
    v1Tags: await value('vehicles/v1/tags'),
    v1Landmarks: await value('vehicles/v1/landmarks'),
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
    stats: await value('driver_documents_index_stats'),
    drivers: await keys(db.ref('users').orderByChild('usertype').equalTo('driver')),
    subscriptions: await value('subscriptions'),
    bookings: await value('bookings'),
    sandboxBookings: await value('sandbox_bookings'),
    b1: await value('bookings/b1'),
    b2Receipt: await value('bookings/b2/receipt/receiptId'),
    byDriver: await keys(db.ref('bookings').orderByChild('driver').equalTo('d1')),
    byRating: await keys(db.ref('bookings').orderByChild('rating').equalTo(5)),
    byStringRating: await keys(db.ref('bookings').orderByChild('rating').equalTo('5')),
    byReceipt: await keys(db.ref('bookings').orderByChild('receipt/hash').equalTo('H2')),
    noDriver: await keys(db.ref('bookings').orderByChild('driver').equalTo('nobody'))
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
        env: { RTDB_FIRESTORE_WRITE_ROOTS: ROOTS, RTDB_FIRESTORE_READ_ROOTS: ROOTS, RTDB_FIRESTORE_NATIVE_COLLECTIONS: NATIVE } });
      // Canonical users doc: a Timestamp and a Firestore-only field must survive
      // RTDB-shaped writes; reads through the router see the ISO string.
      const { Timestamp } = require('@google-cloud/firestore');
      const created = Timestamp.fromDate(new Date('2026-01-02T03:04:05.000Z'));
      await firestore.collection('users').doc('u1').set({ createdAt: created, firestoreOnly: 'keep' });
      results.servedTx = await operations(served);
      results.served = await readAll(served);
      results.servedMirror = await readAll(raw);
      const u1 = (await firestore.collection('users').doc('u1').get()).data();
      assert.ok(u1.createdAt instanceof Timestamp && u1.createdAt.isEqual(created), 'Timestamp was not preserved');
      assert.equal(u1.firestoreOnly, 'keep', 'Firestore-only field was dropped');
      assert.equal((await served.ref('users/u1/createdAt').once('value')).val(), '2026-01-02T03:04:05.000Z');
      await served.ref('users/u1/createdAt').set('2026-02-03T04:05:06.000Z');
      const updated = (await firestore.collection('users').doc('u1').get()).data().createdAt;
      assert.ok(updated instanceof Timestamp && updated.toDate().toISOString() === '2026-02-03T04:05:06.000Z', 'ISO write did not stay a Timestamp');
      // Nested arrays are stored natively as maps and read back unchanged.
      const nested = (await firestore.collection('vehicle_catalog').doc('v1').get()).data().landmarks;
      assert.deepEqual(nested[1], { rtdbNestedArray: [3, { rtdbNestedArray: [4, 5] }] });
      await assert.rejects(served.ref('users/u2').set({ usertype: 'x' }), { code: 'RTDB_ROUTER_CANONICAL_SET' });
      // Native documents carry real fields (queryable), not a JSON blob.
      const link = (await firestore.collection('driver_vehicle_links').doc('u1').get()).data();
      assert.equal(link.l1.vehicleId, 'v1');
      assert.equal('json' in link, false);
      // Remove the seeded Firestore-only fields so the read comparison matches RTDB.
      await firestore.collection('users').doc('u1').update({ firestoreOnly: require('@google-cloud/firestore').FieldValue.delete(), createdAt: require('@google-cloud/firestore').FieldValue.delete() });
      results.served = await readAll(served);
    });
    await withPrivateRealtime(async raw => {
      const mirrored = createRouter(raw, { getFirestore: () => firestore, log: quiet,
        env: { RTDB_FIRESTORE_WRITE_ROOTS: ROOTS, RTDB_FIRESTORE_NATIVE_COLLECTIONS: NATIVE } });
      for (const entry of NATIVE.split(',')) {
        for (const doc of (await firestore.collection(entry.split(':')[1]).get()).docs) await doc.ref.delete();
      }
      results.mirroredTx = await operations(mirrored);
      results.mirrorRtdb = await readAll(raw);
      const reader = createRouter(raw, { getFirestore: () => firestore, log: quiet,
        env: { RTDB_FIRESTORE_WRITE_ROOTS: ROOTS, RTDB_FIRESTORE_READ_ROOTS: ROOTS, RTDB_FIRESTORE_NATIVE_COLLECTIONS: NATIVE } });
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
