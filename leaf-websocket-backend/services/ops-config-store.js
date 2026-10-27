'use strict';

// Operational configs edited in the admin (city activation, geofence) live in
// Firestore `operational_configs` (RTDB exit, domain 2). RTDB is retired: the
// former RTDB source and mirror are gone.
const COLLECTION = 'operational_configs';
// `json` encoding stores the config serialized: geofence polygons are nested
// arrays, which Firestore rejects. City activation stays as plain fields
// because the waitlist reads that document directly.
const CONFIGS = Object.freeze({
  cityActivation: { docId: 'city_activation', encoding: 'fields' },
  geofenceAdmin: { docId: 'geofence_admin', encoding: 'json' }
});
// Bookkeeping fields from the one-off legacy import; never part of the config.
const META_FIELDS = ['source', 'importedAt'];

function definition(key) {
  const config = CONFIGS[key];
  if (!config) throw new Error(`Configuração operacional desconhecida: ${key}`);
  return config;
}

function clean(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  const copy = JSON.parse(JSON.stringify(value));
  META_FIELDS.forEach(field => delete copy[field]);
  return copy;
}

async function readFirestore(firebaseConfig, key) {
  const firestore = firebaseConfig?.getFirestore?.();
  if (!firestore) throw new Error('Firestore indisponível para configuração operacional');
  const { docId, encoding } = definition(key);
  const snapshot = await firestore.collection(COLLECTION).doc(docId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return encoding === 'json' ? clean(JSON.parse(data.json)) : clean(data);
}

async function writeFirestore(firebaseConfig, key, value) {
  const firestore = firebaseConfig?.getFirestore?.();
  if (!firestore) throw new Error('Firestore indisponível para configuração operacional');
  const { docId, encoding } = definition(key);
  const body = encoding === 'json'
    ? { schema: 1, encoding: 'json', json: JSON.stringify(clean(value)), updatedAt: new Date().toISOString() }
    : clean(value);
  await firestore.collection(COLLECTION).doc(docId).set(body);
}

// Returns the raw stored config (null when absent) and where it came from.
async function load(firebaseConfig, key) {
  return { raw: await readFirestore(firebaseConfig, key), source: 'firestore' };
}

async function persist(firebaseConfig, key, value) {
  await writeFirestore(firebaseConfig, key, value);
}

module.exports = { COLLECTION, CONFIGS, clean, readFirestore, writeFirestore, load, persist };
