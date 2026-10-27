'use strict';

// For maintenance/QA scripts that used to write RTDB paths: applies an
// RTDB-style multi-path update ({ 'users/<uid>/a/b': v, 'vehicles/<id>': v,
// 'user_vehicles/<uid>/<link>': v, 'vehicle_plate_index/<plate>': v,
// 'driver_activation/<uid>/documents/cnh': v }) to the native Firestore
// collections in one transaction, through the same repositories the backend
// uses. null deletes. Paths outside these roots are refused: the Realtime
// Database is retired and nothing else reads them.
const driverDocumentStore = require('../../services/driver-document-store');

function writesFor(updates = {}) {
  const writes = [];
  const vehicleAndUser = {};
  for (const [path, value] of Object.entries(updates)) {
    const [root, id, ...field] = String(path).split('/').filter(Boolean);
    if (root === 'driver_activation') {
      if (!id) throw new Error(`Caminho sem motorista: ${path}`);
      writes.push(driverDocumentStore.activationField(id, field, value));
    } else {
      vehicleAndUser[path] = value;
    }
  }
  return [...writes, ...driverDocumentStore.vehicleLinkWrites(vehicleAndUser)];
}

async function commitPaths(firestore, updates) {
  const writes = writesFor(updates);
  if (writes.length) await driverDocumentStore.commit(firestore, writes);
  return writes.length;
}

// Initialized Firestore from the backend config (same credentials resolution
// as the server: inline JSON, GOOGLE_APPLICATION_CREDENTIALS or local file).
function scriptFirestore() {
  const firebaseConfig = require('../../firebase-config');
  firebaseConfig.initializeFirebase();
  const firestore = firebaseConfig.getFirestore();
  if (!firestore) throw new Error('Firestore indisponível: configure as credenciais do Firebase Admin');
  return firestore;
}

module.exports = { writesFor, commitPaths, scriptFirestore };
