'use strict';
// Differential check of services/driver-document-store.js against the router
// it replaces, on the local Firestore emulator: the same writes run through
// rtdb-root-router (RTDB retired, native collections) and through the store,
// from the same seed. The stored documents must be identical, raw Firestore
// values included (Timestamps stay Timestamps, nested arrays keep their
// encoding). Local emulator only (cached JAR); no remote endpoint or credential.
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const withPrivateFirestore = require('./private-firestore.cjs');
const { createRouter, createRetiredRtdb } = require('../../services/rtdb-root-router');
const store = require('../../services/driver-document-store');

const ROOTS = 'vehicles,user_vehicles,vehicle_plate_index,driver_activation,driver_documents_index_stats,driver_document_mutation_locks,users';
const NATIVE = 'vehicles:vehicle_catalog,user_vehicles:driver_vehicle_links,vehicle_plate_index:vehicle_plate_index,'
  + 'driver_activation:driver_activation,driver_documents_index_stats:driver_document_stats,'
  + 'driver_document_mutation_locks:driver_document_locks,users:users:merge';
const COLLECTIONS = Object.values(store.COLLECTIONS);
const quiet = () => {};

const documentV1 = {
  submissionId: 's1', filePath: 'driver-activation/u1/cnh/a.pdf', documentSha256: 'a'.repeat(64),
  storageGeneration: '1', status: 'in_review', reviewedAt: null, data: { nome: 'A', grid: [[1, 2], [3]] }, empty: {}
};
const documentV2 = { ...documentV1, status: 'approved', data: { nome: 'B' }, reason: '' };
const statusPayload = { checklist: { cnhEar: true }, canGoOnline: false, blockingReason: null, kyc: {}, updatedAt: '2026-10-27T12:00:00.000Z' };
const vehicleUpdates = {
  'vehicle_plate_index/ABC1D23': 'vehicle_crlv_ABC1D23',
  'user_vehicles/u1/crlv_ABC1D23/id': 'crlv_ABC1D23',
  'user_vehicles/u1/crlv_ABC1D23/status': 'pending',
  'user_vehicles/u1/crlv_ABC1D23/approved': false,
  'vehicles/vehicle_crlv_ABC1D23/id': 'vehicle_crlv_ABC1D23',
  'vehicles/vehicle_crlv_ABC1D23/createdAt': '2026-10-27T12:00:00.000Z'
};
const lockValue = { token: 't1', driverId: 'u1', documentType: 'cnh', expiresAtMs: 2 };

async function seed(firestore) {
  await firestore.collection('users').doc('u1').set({
    name: 'Driver', createdAt: Timestamp.fromMillis(1_700_000_000_000),
    documents: { cnh: { updatedAt: Timestamp.fromMillis(1_700_000_000_000), status: 'pending' }, crlv: { status: 'pending' } },
    driverActivation: { source: 'old', kyc: { approved: true } }
  });
  await firestore.collection('driver_activation').doc('u1').set({ documents: { crlv: { status: 'approved' } } });
  await firestore.collection('driver_document_stats').doc('cnh').set({ pending: 1, approved: 0 });
  await firestore.collection('driver_document_locks').doc('u1').set({ crlv: { token: 'other' } });
}

async function viaRouter(db) {
  await db.ref().update({
    'driver_activation/u1/documents/cnh': documentV1,
    'driver_activation/u1/documents_history/s1': documentV1,
    'driver_activation/u1/updatedAt': 't1',
    'users/u1/documents/cnh': { ...documentV1, updatedAt: '2026-10-27T10:00:00.000Z' }
  });
  await db.ref('driver_document_mutation_locks/u1/cnh').transaction(() => lockValue);
  await db.ref('driver_document_mutation_locks/u1/cnh').transaction(current => ({ ...current, expiresAtMs: 3 }));
  await db.ref().update({
    ...vehicleUpdates,
    'users/u1/biometrics/cnhFace': { submissionId: 's1', embedding: [0.1, 0.2] },
    'driver_activation/u1/documents/cnh': documentV2,
    'driver_activation/u1/documents_history/s1': { ...documentV2, createdAt: 't0' },
    'users/u1/documents/cnh': { status: 'approved', analysisData: { grid: [[1]] } },
    'driver_activation/u1/updatedAt': 't2'
  });
  for (const [status, delta] of [['pending', -1], ['approved', 1]]) {
    await db.ref(`driver_documents_index_stats/cnh/${status}`).transaction(current => Math.max(0, (Number(current) || 0) + delta));
  }
  await db.ref('driver_activation/u1/status').set(statusPayload);
  await db.ref('users/u1/driverActivation').update({ ...statusPayload, source: 'driver_activation_pipeline' });
  await db.ref('driver_activation/u1/consent/backgroundCheck').set({ acceptedAt: null, accepted: false, updatedAt: 't3' });
  await db.ref('users/u1/driverActivationConsent').update({ backgroundCheck: false, updatedAt: 't3' });
  await db.ref('driver_document_mutation_locks/u1/cnh').transaction(current => (current?.token === 't1' ? null : undefined));
  await db.ref('driver_document_mutation_locks/u1/crlv').transaction(() => null);
}

async function viaStore(firestore) {
  const activation = (field, value) => ({ collection: 'driver_activation', id: 'u1', field, value });
  const user = (field, value) => ({ collection: 'users', id: 'u1', field, value });
  await store.commit(firestore, [
    activation(['documents', 'cnh'], documentV1),
    activation(['documents_history', 's1'], documentV1),
    activation(['updatedAt'], 't1'),
    user(['documents', 'cnh'], { ...documentV1, updatedAt: '2026-10-27T10:00:00.000Z' })
  ]);
  const lock = { driverId: 'u1', documentType: 'cnh' };
  await store.transactLock(firestore, lock, () => lockValue);
  await store.transactLock(firestore, lock, current => ({ ...current, expiresAtMs: 3 }));
  await store.commit(firestore, [
    ...store.vehicleLinkWrites(vehicleUpdates),
    user(['biometrics', 'cnhFace'], { submissionId: 's1', embedding: [0.1, 0.2] }),
    activation(['documents', 'cnh'], documentV2),
    activation(['documents_history', 's1'], { ...documentV2, createdAt: 't0' }),
    user(['documents', 'cnh'], { status: 'approved', analysisData: { grid: [[1]] } }),
    activation(['updatedAt'], 't2')
  ]);
  await store.adjustStats(firestore, 'cnh', { pending: -1, approved: 1 });
  await store.commit(firestore, [
    activation(['status'], statusPayload),
    ...Object.entries({ ...statusPayload, source: 'driver_activation_pipeline' })
      .map(([field, value]) => user(['driverActivation', field], value))
  ]);
  await store.commit(firestore, [
    activation(['consent', 'backgroundCheck'], { acceptedAt: null, accepted: false, updatedAt: 't3' }),
    user(['driverActivationConsent', 'backgroundCheck'], false),
    user(['driverActivationConsent', 'updatedAt'], 't3')
  ]);
  await store.transactLock(firestore, lock, current => (current?.token === 't1' ? null : undefined));
  await store.transactLock(firestore, { driverId: 'u1', documentType: 'crlv' }, () => null);
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
    const docs = await firestore.collection(name).get();
    for (const doc of docs.docs) result[`${name}/${doc.id}`] = raw(doc.data());
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
    env: { RTDB_FIRESTORE_WRITE_ROOTS: ROOTS, RTDB_FIRESTORE_READ_ROOTS: ROOTS, RTDB_FIRESTORE_NATIVE_COLLECTIONS: NATIVE, RTDB_RETIRED: 'true' }
  });
  await viaRouter(router);
  const expected = await dump(firestore);
  const routerView = (await router.ref('driver_activation/u1').once('value')).val();

  await wipe(firestore);
  await seed(firestore);
  await viaStore(firestore);
  const actual = await dump(firestore);

  // The lock doc only differs in existence: the router deletes a record whose
  // last field went away, the store too (checked here explicitly).
  assert.deepEqual(actual, expected);
  assert.equal(actual['driver_document_locks/u1'], undefined);
  assert.deepEqual(actual['users/u1'].createdAt, { timestamp: 1_700_000_000_000 });
  assert.deepEqual(await store.readActivation(firestore, 'u1'), routerView);
  const binding = await store.readDocumentBinding(firestore, { driverId: 'u1', documentType: 'cnh', submissionId: 's1' });
  assert.equal(binding.activationDocument.status, 'approved');
  assert.equal(binding.historyDocument.createdAt, 't0');
  assert.deepEqual(binding.userDocument.analysisData, { grid: [[1]] });
  console.log(`driver-document-store diff: ${Object.keys(actual).length} documents identical to the router`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
