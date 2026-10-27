'use strict';

// Native Firestore repository for ride annotations (RTDB exit, domain 6).
// RTDB `bookings`/`sandbox_bookings` never held rides: only fragments attached
// to rides that live in rides/sandbox_rides (receipt pointer, ratings, ops
// review flags). The router served those roots from ride_annotations and
// sandbox_ride_annotations; this store reads and writes the same documents.
//
// Callers keep naming the persistence scope root (`collections.bookings`);
// reads return the router's view (Timestamps as ISO strings, no nulls).
const { docView } = require('./rtdb-root-router');
const { commit } = require('./driver-document-store');

const ROOT_COLLECTIONS = Object.freeze({
  bookings: 'ride_annotations',
  sandbox_bookings: 'sandbox_ride_annotations'
});

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function collectionFor(root) {
  const collection = ROOT_COLLECTIONS[String(root || '').trim()];
  if (!collection) throw fail('RIDE_ANNOTATION_STORE_INVALID_ROOT', `Raiz de anotações desconhecida: ${root}`);
  return collection;
}

function requireFirestore(firestore) {
  if (!firestore?.collection) {
    throw fail('RIDE_ANNOTATION_STORE_UNAVAILABLE', 'Firestore indisponível para as anotações de corrida');
  }
  return firestore;
}

function rideId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.includes('/') || /^__.*__$/.test(id)) {
    throw fail('RIDE_ANNOTATION_STORE_INVALID_ID', `Corrida inválida: ${id}`);
  }
  return id;
}

// `firestore` from the caller's options, else the process Firestore.
function resolveFirestore(options = {}) {
  if (options.firestore) return options.firestore;
  // Loaded lazily: firebase-config pulls in the Admin SDK.
  return require('../firebase-config').getFirestore?.() || null;
}

async function readAnnotation(firestore, root, id) {
  const snapshot = await requireFirestore(firestore).collection(collectionFor(root)).doc(rideId(id)).get();
  return snapshot.exists ? docView(snapshot.data()) : null;
}

// Every annotation of the root, keyed by ride id (the router's full-root read).
async function listAnnotations(firestore, root, { limit } = {}) {
  let query = requireFirestore(firestore).collection(collectionFor(root));
  if (Number.isInteger(limit) && limit > 0) query = query.limit(limit);
  const snapshot = await query.get();
  const result = {};
  for (const doc of snapshot?.docs || []) {
    const view = docView(doc.data());
    if (view !== null) result[doc.id] = view;
  }
  return result;
}

// RTDB `ref('<root>/<rideId>').update(patch)`: each key is replaced, null
// deletes it; one atomic commit. The document is created when missing.
async function updateAnnotation(firestore, root, id, patch) {
  const collection = collectionFor(root);
  const writes = Object.entries(patch || {}).map(([key, value]) => ({
    collection,
    id: rideId(id),
    field: String(key).split('/').filter(Boolean),
    value
  }));
  if (writes.length) await commit(requireFirestore(firestore), writes);
}

module.exports = {
  ROOT_COLLECTIONS,
  resolveFirestore,
  readAnnotation,
  listAnnotations,
  updateAnnotation
};
