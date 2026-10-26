'use strict';

// Operational configs edited in the admin (city activation, geofence) moving
// from RTDB to Firestore `operational_configs` (RTDB exit, domain 2).
// Before the read switch RTDB is the source and Firestore gets a best-effort
// copy; after it Firestore is the source and RTDB keeps a best-effort mirror.
const { logStructured } = require('../utils/logger');

const COLLECTION = 'operational_configs';
const CONFIGS = Object.freeze({
  cityActivation: { rtdbPath: 'operations/geography/cityActivation', docId: 'city_activation' },
  geofenceAdmin: { rtdbPath: 'operations/geography/geofenceConfig', docId: 'geofence_admin' }
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
  const snapshot = await firestore.collection(COLLECTION).doc(definition(key).docId).get();
  return snapshot.exists ? clean(snapshot.data()) : null;
}

async function writeFirestore(firebaseConfig, key, value) {
  const firestore = firebaseConfig?.getFirestore?.();
  if (!firestore) throw new Error('Firestore indisponível para configuração operacional');
  await firestore.collection(COLLECTION).doc(definition(key).docId).set(clean(value));
}

// Returns the raw stored config (null when absent) and where it came from.
async function load(firebaseConfig, key) {
  if (enabledReads()) {
    const value = await readFirestore(firebaseConfig, key);
    if (value) return { raw: value, source: 'firestore' };
    logStructured('warn', 'Configuração operacional ausente no Firestore; lendo do RTDB', { service: 'ops-config-store', key });
  }
  return { raw: await firebaseConfig.getFromRealtimeDB(definition(key).rtdbPath), source: 'rtdb' };
}

async function persist(firebaseConfig, key, value) {
  const { rtdbPath } = definition(key);
  if (enabledReads()) {
    await writeFirestore(firebaseConfig, key, value);
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
