'use strict';

// Native Firestore repository for the vehicle domain (RTDB exit). It replaces
// the `db.ref('vehicles' | 'user_vehicles' | 'vehicle_plate_index')` calls
// that went through rtdb-root-router, on the collections the router served:
// - vehicle_catalog/{vehicleId}: the catalog record.
// - driver_vehicle_links/{driverId}: one field per link ({ linkId: link }).
// - vehicle_plate_index/{plate}: the vehicleId, as a primitive record.
//
// Reads return the router's view (Timestamps as ISO strings, no nulls).
// commitUpdates takes the RTDB multi-root update the callers already build
// ({ 'vehicles/<id>/a': v, 'user_vehicles/<driver>/<link>': v, 'users/<id>/f': v })
// and applies it in one transaction; null deletes.
const { docView } = require('./rtdb-root-router');
const driverDocumentStore = require('./driver-document-store');

const { COLLECTIONS } = driverDocumentStore;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function requireFirestore(firestore) {
  if (!firestore?.collection) {
    throw fail('VEHICLE_STORE_UNAVAILABLE', 'Firestore indisponível para os veículos');
  }
  return firestore;
}

function docId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.includes('/') || /^__.*__$/.test(id)) {
    throw fail('VEHICLE_STORE_INVALID_ID', `Identificador inválido: ${id}`);
  }
  return id;
}

// `firestore` from the caller's options, else the process Firestore.
function resolveFirestore(options = {}) {
  if (options.firestore) return options.firestore;
  // Loaded lazily: firebase-config pulls in the Admin SDK.
  return require('../firebase-config').getFirestore?.() || null;
}

async function readView(firestore, collection, id) {
  const snapshot = await requireFirestore(firestore).collection(collection).doc(docId(id)).get();
  return snapshot.exists ? docView(snapshot.data()) : null;
}

async function listViews(firestore, collection) {
  const snapshot = await requireFirestore(firestore).collection(collection).get();
  const result = {};
  for (const doc of snapshot?.docs || []) {
    const view = docView(doc.data());
    if (view !== null) result[doc.id] = view;
  }
  return result;
}

const readVehicle = (firestore, vehicleId) => readView(firestore, COLLECTIONS.vehicles, vehicleId);
const listVehicles = firestore => listViews(firestore, COLLECTIONS.vehicles);
// { linkId: link } for one driver, or null.
const readVehicleLinks = (firestore, driverId) => readView(firestore, COLLECTIONS.vehicleLinks, driverId);
// { driverId: { linkId: link } } for every driver.
const listVehicleLinks = firestore => listViews(firestore, COLLECTIONS.vehicleLinks);

// The vehicleId indexed for a normalized plate, or null.
async function readPlateIndex(firestore, plate) {
  const value = await readView(firestore, COLLECTIONS.plateIndex, plate);
  return value === null || typeof value === 'object' ? null : value;
}

async function commitUpdates(firestore, updates) {
  const writes = driverDocumentStore.vehicleLinkWrites(updates);
  if (writes.length) await driverDocumentStore.commit(firestore, writes);
}

module.exports = {
  COLLECTIONS,
  resolveFirestore,
  readVehicle,
  listVehicles,
  readVehicleLinks,
  listVehicleLinks,
  readPlateIndex,
  commitUpdates
};
