'use strict';

// Operational configs edited in the admin (city activation, geofence) moving
// from RTDB to Firestore `operational_configs` (RTDB exit, domain 2).
// Before the read switch RTDB is the source and Firestore gets a best-effort
// copy; after it Firestore is the source and RTDB keeps a best-effort mirror.
const { logStructured } = require('../utils/logger');
const { mirrorWritesEnabled } = require('./rtdb-root-router');

const COLLECTION = 'operational_configs';
// `json` encoding stores the config serialized: geofence polygons are nested
// arrays, which Firestore rejects. City activation stays as plain fields
// because the waitlist reads that document directly.
const CONFIGS = Object.freeze({
  cityActivation: { rtdbPath: 'operations/geography/cityActivation', docId: 'city_activation', encoding: 'fields' },
  geofenceAdmin: { rtdbPath: 'operations/geography/geofenceConfig', docId: 'geofence_admin', encoding: 'json' }
});
// Bookkeeping fields from the one-off legacy import; never part of the config.
const META_FIELDS = ['source', 'importedAt'];

const enabledWrites = () => process.env.ENABLE_OPS_CONFIG_FIRESTORE_WRITES === 'true';
const enabledReads = () => enabledWrites() && process.env.ENABLE_OPS_CONFIG_FIRESTORE_READS === 'true';

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
  if (enabledReads()) {
    const value = await readFirestore(firebaseConfig, key);
    if (value || !mirrorWritesEnabled()) return { raw: value, source: 'firestore' };
    logStructured('warn', 'Configuração operacional ausente no Firestore; lendo do RTDB', { service: 'ops-config-store', key });
  }
  return { raw: await firebaseConfig.getFromRealtimeDB(definition(key).rtdbPath), source: 'rtdb' };
}

async function persist(firebaseConfig, key, value) {
  const { rtdbPath } = definition(key);
  if (enabledReads()) {
    await writeFirestore(firebaseConfig, key, value);
    if (!mirrorWritesEnabled()) return;
    await firebaseConfig.setRealtimeDB(rtdbPath, value).catch(error => logStructured('warn',
      'Espelho RTDB da configuração operacional falhou', { service: 'ops-config-store', key, error: error.message }));
    return;
  }
  await firebaseConfig.setRealtimeDB(rtdbPath, value);
  if (enabledWrites()) {
    await writeFirestore(firebaseConfig, key, value).catch(error => logStructured('warn',
      'Cópia Firestore da configuração operacional falhou; será reparada pela cópia com paridade',
      { service: 'ops-config-store', key, error: error.message }));
  }
}

module.exports = { COLLECTION, CONFIGS, enabledWrites, enabledReads, clean, readFirestore, writeFirestore, load, persist };
