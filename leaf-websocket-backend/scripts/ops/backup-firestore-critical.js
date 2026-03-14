#!/usr/bin/env node
/**
 * Exporta colecoes criticas do Firestore para JSON gzip.
 *
 * Uso:
 *   node scripts/ops/backup-firestore-critical.js --out /var/backups/leaf/firestore/firestore-critical-20260306.json.gz
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

function resolveServiceAccountPath() {
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (fromEnv) return fromEnv;
  return path.join(__dirname, '../../leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
}

async function initFirebase() {
  if (admin.apps.length) {
    return admin.firestore();
  }

  const serviceAccountPath = resolveServiceAccountPath();
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Service account nao encontrada: ${serviceAccountPath}`);
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath))
  });

  return admin.firestore();
}

async function dumpCollection(firestore, collectionName, maxDocs) {
  const snapshot = await firestore.collection(collectionName).limit(maxDocs).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data()
  }));
}

async function main() {
  const outPath = arg('--out', '');
  if (!outPath) {
    throw new Error('Parametro --out obrigatorio');
  }

  const maxDocs = Number.parseInt(process.env.FIRESTORE_BACKUP_MAX_DOCS || '20000', 10);
  const collections = (process.env.FIRESTORE_BACKUP_COLLECTIONS ||
    'bookings,payment_holdings,payment_history,users,drivers')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const firestore = await initFirebase();

  const payload = {
    generatedAt: new Date().toISOString(),
    maxDocsPerCollection: maxDocs,
    collections: {}
  };

  for (const collectionName of collections) {
    try {
      const docs = await dumpCollection(firestore, collectionName, maxDocs);
      payload.collections[collectionName] = {
        count: docs.length,
        docs
      };
    } catch (error) {
      payload.collections[collectionName] = {
        count: 0,
        error: error.message,
        docs: []
      };
    }
  }

  const json = JSON.stringify(payload);
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, gz);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ok: true,
    outPath,
    collections: Object.keys(payload.collections).map((name) => ({
      name,
      count: payload.collections[name].count || 0,
      hasError: !!payload.collections[name].error
    }))
  }, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message || String(error));
  process.exit(1);
});

