'use strict';
// Differential check of services/ride-annotation-store.js against the router
// it replaces, on the local Firestore emulator: the same bookings /
// sandbox_bookings operations run through rtdb-root-router (RTDB retired,
// bookings:ride_annotations, sandbox_bookings:sandbox_ride_annotations) and
// through the store, from the same seed. Stored documents must be identical
// (raw values) and reads must return the router's view. Local emulator only.
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const withPrivateFirestore = require('./private-firestore.cjs');
const { createRouter, createRetiredRtdb } = require('../../services/rtdb-root-router');
const store = require('../../services/ride-annotation-store');

const quiet = () => {};
const COLLECTIONS = ['ride_annotations', 'sandbox_ride_annotations'];
const pointer = { receiptId: 'LEAF-1', hash: 'h', generatedAt: '2026-10-27T20:00:00.000Z', path: 'receipts/r1' };
const review = { opsReviewRequired: true, opsReviewIncidentId: 'inc-1', opsReviewReason: 'safety', opsReviewUpdatedAt: 't1' };

async function seed(firestore) {
  await firestore.collection('ride_annotations').doc('r1').set({
    ratings: { passenger: 5 }, createdAt: Timestamp.fromMillis(1_700_000_000_000), receipt: { receiptId: 'OLD', stale: true }
  });
  await firestore.collection('sandbox_ride_annotations').doc('s1').set({ opsReviewRequired: false });
}

async function viaRouter(db) {
  await db.ref('bookings/r1/receipt').set(pointer);
  await db.ref('bookings/r2').update(review);
  await db.ref('sandbox_bookings/s1').update({ ...review, opsReviewReason: null });
}

async function viaStore(firestore) {
  await store.updateAnnotation(firestore, 'bookings', 'r1', { receipt: pointer });
  await store.updateAnnotation(firestore, 'bookings', 'r2', review);
  await store.updateAnnotation(firestore, 'sandbox_bookings', 's1', { ...review, opsReviewReason: null });
}

const raw = value => {
  if (value instanceof Timestamp) return { timestamp: value.toMillis() };
  if (Array.isArray(value)) return value.map(raw);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort().map(([k, v]) => [k, raw(v)]));
  return value;
};

async function dump(firestore) {
  const result = {};
  for (const name of COLLECTIONS) {
    for (const doc of (await firestore.collection(name).get()).docs) result[`${name}/${doc.id}`] = raw(doc.data());
  }
  return result;
}

async function wipe(firestore) {
  for (const name of COLLECTIONS) {
    const docs = await firestore.collection(name).get();
    await Promise.all(docs.docs.map(doc => doc.ref.delete()));
  }
}

withPrivateFirestore(async (firestore) => {
  await seed(firestore);
  const router = createRouter(createRetiredRtdb({ log: quiet }), {
    getFirestore: () => firestore, log: quiet,
    env: {
      RTDB_FIRESTORE_WRITE_ROOTS: 'bookings,sandbox_bookings',
      RTDB_FIRESTORE_READ_ROOTS: 'bookings,sandbox_bookings',
      RTDB_FIRESTORE_NATIVE_COLLECTIONS: 'bookings:ride_annotations,sandbox_bookings:sandbox_ride_annotations',
      RTDB_RETIRED: 'true'
    }
  });
  await viaRouter(router);
  const expected = await dump(firestore);
  const routerOne = (await router.ref('bookings/r1').once('value')).val();
  const routerAll = (await router.ref('bookings').once('value')).val();

  await wipe(firestore);
  await seed(firestore);
  await viaStore(firestore);
  const actual = await dump(firestore);

  assert.deepEqual(actual, expected);
  assert.deepEqual(actual['ride_annotations/r1'].receipt, raw(pointer));
  assert.deepEqual(await store.readAnnotation(firestore, 'bookings', 'r1'), routerOne);
  assert.deepEqual(await store.listAnnotations(firestore, 'bookings'), routerAll);
  assert.equal(await store.readAnnotation(firestore, 'bookings', 'missing'), null);
  assert.equal(Object.keys(await store.listAnnotations(firestore, 'bookings', { limit: 1 })).length, 1);
  await assert.rejects(store.readAnnotation(firestore, 'rides', 'r1'), { code: 'RIDE_ANNOTATION_STORE_INVALID_ROOT' });
  console.log(`ride-annotation-store diff: ${Object.keys(actual).length} documents identical to the router`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
