#!/usr/bin/env node
/**
 * Limpeza de dados de teste em produção.
 *
 * Uso:
 *   node scripts/ops/cleanup-prod-test-data.js            # dry-run
 *   node scripts/ops/cleanup-prod-test-data.js --apply    # aplica limpeza
 *   node scripts/ops/cleanup-prod-test-data.js --financial-only --apply
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const apply = process.argv.includes('--apply');
const financialOnly = process.argv.includes('--financial-only');
const identityOnly = process.argv.includes('--identity-only');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const serviceAccountPath = path.join(
  ROOT,
  'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json'
);

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`❌ Service account não encontrado: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://leaf-reactnative-default-rtdb.firebaseio.com'
});

const auth = admin.auth();
const rtdb = admin.database();
const firestore = admin.firestore();

const STRICT_TEST_EMAIL_PATTERNS = [
  /^joao\.teste@leaf\.com$/i,
  /^maria\.teste@leaf\.com$/i,
  /^ana\.teste@leaf\.com$/i,
  /^carla\.teste@leaf\.com$/i,
  /^driver\d+@leaf-test\.com$/i,
  /^latency\..*@leaf\.test$/i,
  /^supersede\..*@leaf\.test$/i,
  /^passenger\.audit\..*@leaf\.com$/i,
  /^qa[._-].*@leaf\.app(\.br)?$/i,
  /^qa-admin-.*@leaf\.app(\.br)?$/i,
  /^support\.(smoke|audit)\..*@leaf\.com$/i
];

const STRICT_TEST_UID_PATTERNS = [
  /^test[-_]/i,
  /^qa[-_]/i,
  /^smoke[-_]/i,
  /^smoke_driver/i,
  /^test-driver-kyc-/i
];

const STRICT_TEST_NAME_PATTERNS = [
  /\bteste\b/i,
  /^qa\b/i,
  /support smoke/i,
  /support audit/i
];

const STRICT_TEST_PHONE_PATTERNS = [
  /^\+?5521102938475$/,
  /^\+?5521123456789$/,
  /^\+?5511999999999$/,
  /^\+?5511888888888$/,
  /^\+?5511888888899$/,
  /^\+?5511888888877$/
];

const STRICT_VEHICLE_NOTE_PATTERNS = [
  /ve[ií]culo de teste/i,
  /\btest(e)?\b/i,
  /\bqa\b/i,
  /\bsmoke\b/i
];

const STRICT_TEST_RIDE_ID_PATTERN = /(^|_)ride_e2e_|^ride_normal_|dispatch_smoke|_smoke$|(^|_)test(_|$)|(^|_)mock(_|$)/i;

const FINANCIAL_TEST_COLLECTIONS = [
  'ride_payments',
  'payment_holdings',
  'payment_distributions',
  'payment_intents',
  'financial_reconciliation_reports',
  'financial_ledger_events',
  'financial_ledger_lines'
];

function matchesAny(value, patterns) {
  if (!value) return false;
  const text = String(value);
  return patterns.some((re) => re.test(text));
}

function isStrictTestIdentity({ uid, email, phone, displayName }) {
  return (
    matchesAny(uid, STRICT_TEST_UID_PATTERNS) ||
    matchesAny(email, STRICT_TEST_EMAIL_PATTERNS) ||
    matchesAny(phone, STRICT_TEST_PHONE_PATTERNS) ||
    matchesAny(displayName, STRICT_TEST_NAME_PATTERNS)
  );
}

function isStrictTestRideId(value) {
  return STRICT_TEST_RIDE_ID_PATTERN.test(String(value || ''));
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

function safeDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  return String(value);
}

function getAdditionalInfoValue(data = {}, key) {
  const rows = Array.isArray(data.metadata?.additionalInfo) ? data.metadata.additionalInfo : [];
  const match = rows.find((row) => String(row?.key || '').toLowerCase() === key);
  return match?.value || null;
}

function resolveRideIdFromFinancialDoc(id, data = {}, knownTestUIDs = new Set()) {
  const candidates = [
    data.rideId,
    data.bookingId,
    data.sourceRideId,
    data.metadata?.rideId,
    getAdditionalInfoValue(data, 'ride_id'),
    id
  ];
  const testRideId = candidates.find((candidate) => isStrictTestRideId(candidate));
  if (testRideId) return testRideId;

  const identityCandidates = [
    data.passengerId,
    data.customerId,
    data.driverId,
    data.userId,
    data.metadata?.passengerId,
    data.metadata?.customerId,
    data.metadata?.driverId,
    getAdditionalInfoValue(data, 'passenger_id'),
    getAdditionalInfoValue(data, 'customer_id'),
    getAdditionalInfoValue(data, 'driver_id')
  ];
  const hasKnownTestIdentity = identityCandidates
    .filter(Boolean)
    .some((value) => knownTestUIDs.has(String(value)));

  return hasKnownTestIdentity ? (data.rideId || data.bookingId || id) : null;
}

async function collectTargets() {
  const targets = {
    authUsers: [],
    rtdbUsers: [],
    rtdbVehicles: [],
    firestoreUsers: [],
    firestoreAdminUsers: [],
    firestoreFinancialDocs: []
  };
  const knownTestUIDs = new Set();

  const authUsers = await listAllAuthUsers();
  for (const u of authUsers) {
    const row = {
      uid: u.uid,
      email: u.email || null,
      phone: u.phoneNumber || null,
      displayName: u.displayName || null,
      createdAt: u.metadata?.creationTime || null,
      lastSignIn: u.metadata?.lastSignInTime || null
    };
    if (isStrictTestIdentity(row)) {
      knownTestUIDs.add(row.uid);
      if (!financialOnly) targets.authUsers.push(row);
    }
  }

  const usersSnap = await rtdb.ref('users').once('value');
  const usersVal = usersSnap.val() || {};
  for (const [uid, v] of Object.entries(usersVal)) {
    const row = {
      uid,
      email: v?.email || null,
      phone: v?.mobile || v?.phone || v?.phoneNumber || null,
      displayName: v?.name || [v?.firstName, v?.lastName].filter(Boolean).join(' ') || null,
      usertype: v?.usertype || v?.userType || null,
      createdAt: safeDate(v?.createdAt)
    };
    if (isStrictTestIdentity(row)) {
      knownTestUIDs.add(row.uid);
      if (!financialOnly) targets.rtdbUsers.push(row);
    }
  }

  const fsUsersSnap = await firestore.collection('users').get();
  fsUsersSnap.forEach((doc) => {
    const v = doc.data() || {};
    const row = {
      uid: doc.id,
      email: v?.email || null,
      phone: v?.mobile || v?.phone || v?.phoneNumber || null,
      displayName: v?.name || [v?.firstName, v?.lastName].filter(Boolean).join(' ') || null,
      usertype: v?.usertype || v?.userType || null,
      createdAt: safeDate(v?.createdAt)
    };
    if (isStrictTestIdentity(row)) {
      knownTestUIDs.add(row.uid);
      if (!financialOnly) targets.firestoreUsers.push(row);
    }
  });

  if (!financialOnly) {
    const fsAdminsSnap = await firestore.collection('adminUsers').get();
    fsAdminsSnap.forEach((doc) => {
      const v = doc.data() || {};
      const row = {
        id: doc.id,
        email: v?.email || null,
        role: v?.role || null,
        displayName: v?.displayName || v?.name || null,
        createdAt: safeDate(v?.createdAt)
      };
      if (
        matchesAny(row.id, STRICT_TEST_UID_PATTERNS) ||
        matchesAny(row.email, STRICT_TEST_EMAIL_PATTERNS) ||
        matchesAny(row.displayName, STRICT_TEST_NAME_PATTERNS)
      ) {
        targets.firestoreAdminUsers.push(row);
      }
    });
  }

  const deleteUIDs = new Set();
  for (const row of targets.authUsers) deleteUIDs.add(row.uid);
  for (const row of targets.rtdbUsers) deleteUIDs.add(row.uid);
  for (const row of targets.firestoreUsers) deleteUIDs.add(row.uid);

  if (!financialOnly) {
    const vehiclesSnap = await rtdb.ref('vehicles').once('value');
    const vehiclesVal = vehiclesSnap.val() || {};
    for (const [id, v] of Object.entries(vehiclesVal)) {
      const driver = v?.driver || null;
      const note = v?.other_info || null;
      const shouldDelete =
        (driver && deleteUIDs.has(driver)) ||
        matchesAny(note, STRICT_VEHICLE_NOTE_PATTERNS);
      if (shouldDelete) {
        targets.rtdbVehicles.push({
          id,
          driver,
          plate: v?.vehicleNumber || v?.carPlate || null,
          note,
          createdAt: safeDate(v?.createdAt)
        });
      }
    }
  }

  if (!identityOnly) {
    for (const collectionName of FINANCIAL_TEST_COLLECTIONS) {
      const snapshot = await firestore.collection(collectionName).get();
      snapshot.forEach((doc) => {
        const data = doc.data() || {};
        const rideId = resolveRideIdFromFinancialDoc(doc.id, data, knownTestUIDs);
        if (!rideId) return;

        targets.firestoreFinancialDocs.push({
          collection: collectionName,
          id: doc.id,
          rideId,
          amount: data.amount || data.amountCents || data.totalAmount || data.totalDebitCents || null,
          status: data.status || null,
          eventType: data.eventType || null,
          checkedAtIso: data.checkedAtIso || null,
          createdAt: safeDate(data.createdAt || data.createdAtIso)
        });
      });
    }
  }

  return { targets, deleteUIDs: Array.from(deleteUIDs) };
}

async function removeWithIgnore(fn) {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    const msg = String(error?.message || error);
    if (
      msg.includes('No user record found') ||
      msg.includes('No document to update') ||
      msg.includes('not found')
    ) {
      return { ok: true, ignored: true, message: msg };
    }
    return { ok: false, message: msg };
  }
}

async function applyCleanup({ targets, deleteUIDs }) {
  const stats = {
    authDeleted: 0,
    rtdbUsersDeleted: 0,
    rtdbVehiclesDeleted: 0,
    firestoreUsersDeleted: 0,
    firestoreAdminUsersDeleted: 0,
    firestoreFinancialDocsDeleted: 0,
    rtdbAuxDeleted: 0,
    errors: []
  };

  for (const uid of deleteUIDs) {
    const authRes = await removeWithIgnore(() => auth.deleteUser(uid));
    if (authRes.ok) stats.authDeleted += 1;
    else stats.errors.push({ scope: 'auth.deleteUser', uid, error: authRes.message });
  }

  for (const uid of deleteUIDs) {
    const r1 = await removeWithIgnore(() => rtdb.ref(`users/${uid}`).remove());
    if (r1.ok) stats.rtdbUsersDeleted += 1;
    else stats.errors.push({ scope: 'rtdb.users', uid, error: r1.message });

    const auxPaths = [
      `locations/${uid}`,
      `drivers/${uid}`,
      `subscriptions/${uid}`,
      `driverSubscriptions/${uid}`,
      `usersOnline/${uid}`,
      `driverOnline/${uid}`
    ];
    for (const p of auxPaths) {
      const rAux = await removeWithIgnore(() => rtdb.ref(p).remove());
      if (rAux.ok) stats.rtdbAuxDeleted += 1;
      else stats.errors.push({ scope: 'rtdb.aux', path: p, error: rAux.message });
    }
  }

  for (const v of targets.rtdbVehicles) {
    const r = await removeWithIgnore(() => rtdb.ref(`vehicles/${v.id}`).remove());
    if (r.ok) stats.rtdbVehiclesDeleted += 1;
    else stats.errors.push({ scope: 'rtdb.vehicles', id: v.id, error: r.message });
  }

  for (const uid of deleteUIDs) {
    const r = await removeWithIgnore(() => firestore.collection('users').doc(uid).delete());
    if (r.ok) stats.firestoreUsersDeleted += 1;
    else stats.errors.push({ scope: 'firestore.users', uid, error: r.message });
  }

  for (const row of targets.firestoreAdminUsers) {
    const r = await removeWithIgnore(() => firestore.collection('adminUsers').doc(row.id).delete());
    if (r.ok) stats.firestoreAdminUsersDeleted += 1;
    else stats.errors.push({ scope: 'firestore.adminUsers', id: row.id, error: r.message });
  }

  if (targets.firestoreFinancialDocs.length > 0 && typeof firestore.batch === 'function') {
    const batchSize = 400;
    for (let index = 0; index < targets.firestoreFinancialDocs.length; index += batchSize) {
      const rows = targets.firestoreFinancialDocs.slice(index, index + batchSize);
      const batch = firestore.batch();
      rows.forEach((row) => {
        batch.delete(firestore.collection(row.collection).doc(row.id));
      });

      const r = await removeWithIgnore(() => batch.commit());
      if (r.ok) {
        stats.firestoreFinancialDocsDeleted += rows.length;
      } else {
        stats.errors.push({
          scope: 'firestore.financialBatch',
          offset: index,
          count: rows.length,
          error: r.message
        });
      }
    }
  } else {
    for (const row of targets.firestoreFinancialDocs) {
      const r = await removeWithIgnore(() => firestore.collection(row.collection).doc(row.id).delete());
      if (r.ok) stats.firestoreFinancialDocsDeleted += 1;
      else {
        stats.errors.push({
          scope: `firestore.${row.collection}`,
          id: row.id,
          rideId: row.rideId,
          error: r.message
        });
      }
    }
  }

  return stats;
}

async function main() {
  const collected = await collectTargets();
  const { targets, deleteUIDs } = collected;

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    scope: financialOnly ? 'financial-only' : identityOnly ? 'identity-only' : 'all',
    targets: {
      authUsers: targets.authUsers.length,
      rtdbUsers: targets.rtdbUsers.length,
      rtdbVehicles: targets.rtdbVehicles.length,
      firestoreUsers: targets.firestoreUsers.length,
      firestoreAdminUsers: targets.firestoreAdminUsers.length,
      firestoreFinancialDocs: targets.firestoreFinancialDocs.length,
      distinctUIDs: deleteUIDs.length
    },
    samples: {
      authUsers: targets.authUsers.slice(0, 15),
      rtdbUsers: targets.rtdbUsers.slice(0, 15),
      rtdbVehicles: targets.rtdbVehicles.slice(0, 15),
      firestoreUsers: targets.firestoreUsers.slice(0, 15),
      firestoreAdminUsers: targets.firestoreAdminUsers.slice(0, 15),
      firestoreFinancialDocs: targets.firestoreFinancialDocs.slice(0, 20)
    },
    targetIds: {
      authUsers: targets.authUsers.map((row) => row.uid),
      rtdbUsers: targets.rtdbUsers.map((row) => row.uid),
      rtdbVehicles: targets.rtdbVehicles.map((row) => row.id),
      firestoreUsers: targets.firestoreUsers.map((row) => row.uid),
      firestoreAdminUsers: targets.firestoreAdminUsers.map((row) => row.id),
      firestoreFinancialDocs: targets.firestoreFinancialDocs.map((row) => ({
        collection: row.collection,
        id: row.id,
        rideId: row.rideId
      }))
    }
  };

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(REPORT_DIR, `prod-test-data-cleanup-${ts}-${apply ? 'apply' : 'dry-run'}.json`);

  if (apply) {
    summary.applyStats = await applyCleanup({ targets, deleteUIDs });
  }

  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  summary.reportPath = outPath;
  const consoleSummary = {
    generatedAt: summary.generatedAt,
    mode: summary.mode,
    scope: summary.scope,
    targets: summary.targets,
    applyStats: summary.applyStats || null,
    reportPath: summary.reportPath
  };
  console.log(JSON.stringify(consoleSummary, null, 2));
  await admin.app().delete();
}

main().catch((error) => {
  console.error('❌ Erro na limpeza:', error);
  process.exit(1);
});
