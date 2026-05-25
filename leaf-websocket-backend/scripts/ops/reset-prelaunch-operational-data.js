#!/usr/bin/env node
/**
 * Reset operacional pré-go-live.
 *
 * Objetivo:
 * - preservar somente o que é administrativo / pré-cadastro
 * - zerar dados operacionais e financeiros de teste
 *
 * Uso:
 *   node scripts/ops/reset-prelaunch-operational-data.js
 *   node scripts/ops/reset-prelaunch-operational-data.js --apply
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const apply = process.argv.includes('--apply');
const verbose = process.argv.includes('--verbose') || apply;

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const serviceAccountPath = path.join(
  ROOT,
  'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json'
);

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`Service account nao encontrado: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    process.env.FIREBASE_DATABASE_URL ||
    'https://leaf-reactnative-default-rtdb.firebaseio.com'
});

const auth = admin.auth();
const rtdb = admin.database();
const firestore = admin.firestore();

const RTDB_PATHS_TO_RESET = [
  'users',
  'vehicles',
  'user_vehicles',
  'bookings',
  'payments',
  'subscriptions',
  'driverSubscriptions',
  'locations',
  'drivers',
  'usersOnline',
  'driverOnline',
  'promoUsage'
];

const FIRESTORE_COLLECTIONS_TO_RESET = [
  'users',
  'drivers',
  'rides',
  'bookings',
  'ride_payments',
  'payment_holdings',
  'payment_history',
  'payment_distributions',
  'driver_balances',
  'driver_withdrawals',
  'trip_location_chunks',
  'trip_location_summaries'
];

function logProgress(message) {
  if (verbose) {
    console.error(`[reset-prelaunch] ${message}`);
  }
}

function ensureReportDir() {
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (value.toDate && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return String(value);
}

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function getAdminUsers() {
  const snapshot = await firestore.collection('adminUsers').get();
  return snapshot.docs.map((doc) => ({
    uid: doc.id,
    ...doc.data()
  }));
}

async function getRtdbChildCount(pathName) {
  const snap = await rtdb.ref(pathName).once('value');
  if (!snap.exists()) return 0;
  const value = snap.val();
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).length;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length;
  }
  return 1;
}

async function getFirestoreCollectionCount(collectionName) {
  const collectionRef = firestore.collection(collectionName);

  if (typeof collectionRef.count === 'function') {
    const aggregateSnapshot = await collectionRef.count().get();
    const countValue =
      aggregateSnapshot?.data?.().count ??
      aggregateSnapshot?.data?.().count?.value ??
      aggregateSnapshot?._data?.count ??
      0;
    return Number(countValue || 0);
  }

  const snapshot = await collectionRef.get();
  return snapshot.size;
}

async function buildSummary() {
  logProgress('Lendo adminUsers preservados');
  const adminUsers = await getAdminUsers();
  const adminUidSet = new Set(adminUsers.map((row) => String(row.uid)));
  logProgress('Listando usuarios do Firebase Auth');
  const allAuthUsers = await listAllAuthUsers();
  const authDeleteCandidates = allAuthUsers
    .filter((user) => !adminUidSet.has(String(user.uid)))
    .map((user) => ({
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      createdAt: user.metadata?.creationTime || null,
      lastSignIn: user.metadata?.lastSignInTime || null
    }));

  const rtdbCounts = {};
  for (const pathName of RTDB_PATHS_TO_RESET) {
    logProgress(`Contando RTDB/${pathName}`);
    rtdbCounts[pathName] = await getRtdbChildCount(pathName);
  }

  const firestoreCounts = {};
  for (const collectionName of FIRESTORE_COLLECTIONS_TO_RESET) {
    logProgress(`Contando Firestore/${collectionName}`);
    firestoreCounts[collectionName] = await getFirestoreCollectionCount(collectionName);
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    preserved: {
      firestoreCollections: ['adminUsers', 'waitlist_landing', 'support_tickets', 'promos'],
      adminUsers: adminUsers.map((row) => ({
        uid: row.uid,
        email: row.email || null,
        role: row.role || null,
        displayName: row.displayName || row.name || null,
        createdAt: safeDate(row.createdAt)
      }))
    },
    targets: {
      authUsersToDelete: authDeleteCandidates.length,
      rtdbPaths: rtdbCounts,
      firestoreCollections: firestoreCounts
    },
    samples: {
      authUsersToDelete: authDeleteCandidates.slice(0, 25)
    },
    internal: {
      adminUidSet: Array.from(adminUidSet),
      authDeleteCandidates
    }
  };
}

async function deleteAuthUsers(authDeleteCandidates) {
  const results = {
    deleted: 0,
    errors: []
  };

  const batchSize = 1000;

  for (let index = 0; index < authDeleteCandidates.length; index += batchSize) {
    const slice = authDeleteCandidates.slice(index, index + batchSize);
    const uids = slice.map((row) => row.uid);
    logProgress(
      `Removendo lote Auth ${index + 1}-${index + slice.length} de ${authDeleteCandidates.length}`
    );

    const batchResult = await auth.deleteUsers(uids);
    results.deleted += Number(batchResult.successCount || 0);

    if (Array.isArray(batchResult.errors)) {
      for (const batchError of batchResult.errors) {
        const row = slice[batchError.index];
        results.errors.push({
          uid: row?.uid || null,
          email: row?.email || null,
          error: batchError.error?.message || 'deleteUsers batch error'
        });
      }
    }
  }

  return results;
}

async function resetRtdbPaths(rtdbCounts) {
  const results = {
    deletedChildren: 0,
    paths: {},
    errors: []
  };

  for (const pathName of RTDB_PATHS_TO_RESET) {
    const existingChildren = Number(rtdbCounts[pathName] || 0);
    try {
      logProgress(`Zerando RTDB/${pathName} (${existingChildren})`);
      await rtdb.ref(pathName).remove();
      results.paths[pathName] = {
        deletedChildren: existingChildren
      };
      results.deletedChildren += existingChildren;
    } catch (error) {
      results.paths[pathName] = {
        deletedChildren: 0,
        error: error.message
      };
      results.errors.push({
        path: pathName,
        error: error.message
      });
    }
  }

  return results;
}

async function deleteRtdbChildrenInBatches(pathName, batchSize = 250) {
  const ref = rtdb.ref(pathName);
  let deletedChildren = 0;

  while (true) {
    const snapshot = await ref.limitToFirst(batchSize).once('value');
    if (!snapshot.exists()) {
      break;
    }

    const value = snapshot.val() || {};
    const keys = Object.keys(value);
    if (keys.length === 0) {
      break;
    }

    const updates = {};
    for (const key of keys) {
      updates[key] = null;
    }

    logProgress(`Fallback batch RTDB/${pathName}: removendo ${keys.length} chaves`);
    await ref.update(updates);
    deletedChildren += keys.length;
  }

  return deletedChildren;
}

async function deleteCollectionFallback(collectionRef) {
  const batchSize = 200;

  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }

    for (const doc of snapshot.docs) {
      const subcollections = await doc.ref.listCollections();
      for (const subcollection of subcollections) {
        await deleteCollectionFallback(subcollection);
      }
      await doc.ref.delete();
    }
  }
}

async function resetFirestoreCollections(firestoreCounts) {
  const results = {
    deletedDocuments: 0,
    collections: {},
    errors: []
  };

  for (const collectionName of FIRESTORE_COLLECTIONS_TO_RESET) {
    const existingDocs = Number(firestoreCounts[collectionName] || 0);
    const collectionRef = firestore.collection(collectionName);

    try {
      logProgress(`Zerando Firestore/${collectionName} (${existingDocs})`);
      if (existingDocs > 0) {
        if (typeof firestore.recursiveDelete === 'function') {
          await firestore.recursiveDelete(collectionRef);
        } else {
          await deleteCollectionFallback(collectionRef);
        }
      }

      results.collections[collectionName] = {
        deletedDocuments: existingDocs
      };
      results.deletedDocuments += existingDocs;
    } catch (error) {
      results.collections[collectionName] = {
        deletedDocuments: 0,
        error: error.message
      };
      results.errors.push({
        collection: collectionName,
        error: error.message
      });
    }
  }

  return results;
}

async function buildPostCheck() {
  const rtdb = {};
  for (const pathName of RTDB_PATHS_TO_RESET) {
    logProgress(`Recontando RTDB/${pathName}`);
    rtdb[pathName] = await getRtdbChildCount(pathName);
  }

  const firestoreCollections = {};
  for (const collectionName of FIRESTORE_COLLECTIONS_TO_RESET) {
    logProgress(`Recontando Firestore/${collectionName}`);
    firestoreCollections[collectionName] = await getFirestoreCollectionCount(collectionName);
  }

  logProgress('Recontando usuarios do Firebase Auth');
  const adminUsers = await getAdminUsers();
  const adminUidSet = new Set(adminUsers.map((row) => String(row.uid)));
  const authUsers = await listAllAuthUsers();
  const remainingOperationalAuthUsers = authUsers.filter(
    (user) => !adminUidSet.has(String(user.uid))
  );

  return {
    authRemainingNonAdmin: remainingOperationalAuthUsers.length,
    rtdb,
    firestoreCollections
  };
}

async function main() {
  ensureReportDir();

  const fullSummary = await buildSummary();
  const summary = {
    ...fullSummary
  };
  delete summary.internal;

  if (apply) {
    const { authDeleteCandidates } = fullSummary.internal;
    logProgress('Aplicando limpeza no Firebase Auth');
    const authStats = await deleteAuthUsers(authDeleteCandidates);
    logProgress('Aplicando limpeza no RTDB');
    const rtdbStats = await resetRtdbPaths(fullSummary.targets.rtdbPaths);
    logProgress('Aplicando limpeza no Firestore');
    const firestoreStats = await resetFirestoreCollections(fullSummary.targets.firestoreCollections);
    summary.applyStats = {
      auth: authStats,
      rtdb: rtdbStats,
      firestore: firestoreStats
    };

    const usersPathError = Array.isArray(summary.applyStats.rtdb.errors)
      ? summary.applyStats.rtdb.errors.find((row) => row.path === 'users')
      : null;

    if (usersPathError && String(usersPathError.error || '').includes('TOO_MANY_TRIGGERS')) {
      logProgress('Aplicando fallback em lotes para RTDB/users');
      const deletedChildren = await deleteRtdbChildrenInBatches('users');
      summary.applyStats.rtdb.paths.users = {
        deletedChildren,
        fallbackApplied: true
      };
      summary.applyStats.rtdb.errors = summary.applyStats.rtdb.errors.filter(
        (row) => row.path !== 'users'
      );
      summary.applyStats.rtdb.deletedChildren += deletedChildren;
    }

    logProgress('Executando pos-check');
    summary.postCheck = await buildPostCheck();
  }

  const outPath = path.join(
    REPORT_DIR,
    `prelaunch-operational-reset-${ts()}-${apply ? 'apply' : 'dry-run'}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  summary.reportPath = outPath;

  console.log(JSON.stringify(summary, null, 2));
  await admin.app().delete();
}

main().catch(async (error) => {
  console.error('Erro no reset pre-launch:', error);
  try {
    await admin.app().delete();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
