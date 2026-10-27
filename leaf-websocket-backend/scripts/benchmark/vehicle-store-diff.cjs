'use strict';
// Differential check of services/vehicle-store.js against the router it
// replaces, on the local Firestore emulator: the vehicle writes of the account,
// dashboard and CRLV flows run through rtdb-root-router (RTDB retired, native
// collections) and through the store, from the same seed. Stored documents
// (raw values: Timestamps stay Timestamps) and reads must be identical.
// Local emulator only (cached JAR); no remote endpoint or credential.
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const withPrivateFirestore = require('./private-firestore.cjs');
const { createRouter, createRetiredRtdb } = require('../../services/rtdb-root-router');
const store = require('../../services/vehicle-store');

const ROOTS = 'vehicles,user_vehicles,vehicle_plate_index,users';
const NATIVE = 'vehicles:vehicle_catalog,user_vehicles:driver_vehicle_links,vehicle_plate_index:vehicle_plate_index,users:users:merge';
const COLLECTIONS = ['vehicle_catalog', 'driver_vehicle_links', 'vehicle_plate_index', 'users'];
const quiet = () => {};
const created = Timestamp.fromMillis(1_700_000_000_000);

async function seed(firestore) {
  await firestore.collection('users').doc('d1').set({ usertype: 'driver', createdAt: created, activeVehicleId: 'v1' });
  await firestore.collection('vehicle_catalog').doc('v1').set({ plate: 'ABC1D23', status: 'idle', createdAt: created, grid: [1, 2] });
  await firestore.collection('vehicle_plate_index').doc('ABC1D23').set({ rtdbValue: 'v1' });
  await firestore.collection('driver_vehicle_links').doc('d1').set({
    l1: { vehicleId: 'v1', isActive: true, status: 'approved', approved: true, createdAt: created },
    l2: { vehicleId: 'v9', isActive: false, status: 'pending' }
  });
  await firestore.collection('driver_vehicle_links').doc('d2').set({ only: { vehicleId: 'v1', status: 'pending' } });
}

// Each step is one multi-root update, as the callers build it.
const STEPS = [
  // account: add a new catalog vehicle and a pending link
  {
    'vehicles/v2': { id: 'v2', plate: 'DEF4G56', brand: 'Nissan', status: 'idle', createdAt: '2026-10-27T12:00:00.000Z' },
    'vehicle_plate_index/DEF4G56': 'v2',
    'user_vehicles/d1/l3': { id: 'l3', userId: 'd1', vehicleId: 'v2', status: 'pending', approved: false, isActive: false }
  },
  // account: edit a link (nulls delete), reset activeVehicleId
  {
    'user_vehicles/d1/l1/vehicleId': null,
    'user_vehicles/d1/l1/plate': 'GHI7J89',
    'user_vehicles/d1/l1/status': 'pending',
    'user_vehicles/d1/l1/reviewedAt': null,
    'users/d1/updatedAt': '2026-10-27T12:01:00.000Z',
    'users/d1/activeVehicleId': ''
  },
  // dashboard: activate one link, category on the catalog record
  {
    'user_vehicles/d1/l1/isActive': false,
    'user_vehicles/d1/l3/isActive': true,
    'user_vehicles/d1/l3/status': 'approved',
    'vehicles/v2/manualCategory': 'plus',
    'vehicles/v2/carType': 'Leaf Plus',
    'users/d1/activeVehicleId': 'v2',
    'users/d1/carType': 'Leaf Plus'
  },
  // CRLV: catalog fields on an existing record keep its Timestamp
  {
    'vehicles/v1/model': 'Leaf',
    'vehicles/v1/ocrData': { data: { plate: 'ABC1D23' }, source: 'pdf_text' },
    'user_vehicles/d1/l2/vehicleId': 'v1'
  },
  // account: delete links, including a driver's last one
  { 'user_vehicles/d1/l2': null },
  { 'user_vehicles/d2/only': null }
];

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
  for (const step of STEPS) await router.ref().update(step);
  const expected = await dump(firestore);
  const read = async path => (await router.ref(path).once('value')).val();
  const routerViews = {
    vehicle: await read('vehicles/v1'),
    links: await read('user_vehicles/d1'),
    emptyLinks: await read('user_vehicles/d2'),
    plate: await read('vehicle_plate_index/DEF4G56'),
    catalog: await read('vehicles'),
    allLinks: await read('user_vehicles')
  };

  await wipe(firestore);
  await seed(firestore);
  for (const step of STEPS) await store.commitUpdates(firestore, step);
  const actual = await dump(firestore);

  assert.deepEqual(actual, expected);
  assert.deepEqual(actual['vehicle_catalog/v1'].createdAt, { timestamp: 1_700_000_000_000 });
  assert.deepEqual(await store.readVehicle(firestore, 'v1'), routerViews.vehicle);
  assert.deepEqual(await store.readVehicleLinks(firestore, 'd1'), routerViews.links);
  assert.equal(await store.readVehicleLinks(firestore, 'd2'), routerViews.emptyLinks);
  assert.equal(await store.readPlateIndex(firestore, 'DEF4G56'), routerViews.plate);
  assert.deepEqual(await store.listVehicles(firestore), routerViews.catalog);
  assert.deepEqual(await store.listVehicleLinks(firestore), routerViews.allLinks);
  console.log(`vehicle-store diff: ${Object.keys(actual).length} documents identical to the router`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
