#!/usr/bin/env node
/**
 * Auditoria de dados de teste em produção (Firebase Auth + RTDB + Firestore).
 * Não remove nada, apenas gera relatório.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

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

const EMAIL_PATTERNS = [
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

const UID_PATTERNS = [
  /^test[-_]/i,
  /^qa[-_]/i,
  /^smoke[-_]/i,
  /^mock[-_]/i,
  /^stress[-_]/i,
  /^driver_test/i,
  /^passenger_test/i,
  /^smoke_driver/i
];

const PHONE_PATTERNS = [
  /^\+?5511999999999$/,
  /^\+?5511888888888$/,
  /^\+?5511888888899$/,
  /^\+?5511888888877$/
];

const NAME_PATTERN = /(teste|qa delete test user|support smoke|support audit|passenger audit)/i;
const KNOWN_TEST_TEXT = /(joao\.teste|maria\.teste|ana\.teste|carla\.teste)/i;

function isSuspicious({ uid, email, phone, displayName }) {
  const text = [uid, email, phone, displayName].filter(Boolean).join(' ');
  const emailHit = email && EMAIL_PATTERNS.some((re) => re.test(String(email)));
  const uidHit = uid && UID_PATTERNS.some((re) => re.test(String(uid)));
  const phoneHit = phone && PHONE_PATTERNS.some((re) => re.test(String(phone)));
  const nameHit = displayName && NAME_PATTERN.test(String(displayName));
  return Boolean(emailHit || uidHit || phoneHit || nameHit || KNOWN_TEST_TEXT.test(text));
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

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    collections: {
      auth: { total: 0, suspicious: [] },
      rtdbUsers: { total: 0, suspicious: [] },
      rtdbVehicles: { total: 0, suspicious: [] },
      firestoreUsers: { total: 0, suspicious: [] },
      firestoreAdminUsers: { total: 0, suspicious: [] }
    }
  };

  const authUsers = await listAllAuthUsers();
  report.collections.auth.total = authUsers.length;
  for (const u of authUsers) {
    const row = {
      uid: u.uid,
      email: u.email || null,
      phone: u.phoneNumber || null,
      displayName: u.displayName || null,
      createdAt: u.metadata?.creationTime || null,
      lastSignIn: u.metadata?.lastSignInTime || null
    };
    if (isSuspicious(row)) report.collections.auth.suspicious.push(row);
  }

  const usersSnap = await rtdb.ref('users').once('value');
  const usersVal = usersSnap.val() || {};
  const userEntries = Object.entries(usersVal);
  report.collections.rtdbUsers.total = userEntries.length;
  for (const [uid, v] of userEntries) {
    const row = {
      uid,
      email: v?.email || null,
      phone: v?.mobile || v?.phone || v?.phoneNumber || null,
      displayName: v?.name || [v?.firstName, v?.lastName].filter(Boolean).join(' ') || null,
      usertype: v?.usertype || v?.userType || null,
      createdAt: safeDate(v?.createdAt)
    };
    if (isSuspicious(row)) report.collections.rtdbUsers.suspicious.push(row);
  }

  const vehiclesSnap = await rtdb.ref('vehicles').once('value');
  const vehiclesVal = vehiclesSnap.val() || {};
  const vehicleEntries = Object.entries(vehiclesVal);
  report.collections.rtdbVehicles.total = vehicleEntries.length;
  for (const [id, v] of vehicleEntries) {
    const row = {
      id,
      driver: v?.driver || null,
      plate: v?.vehicleNumber || v?.carPlate || null,
      note: v?.other_info || null,
      createdAt: safeDate(v?.createdAt)
    };
    if (
      isSuspicious({ uid: row.driver, email: null, phone: null, displayName: row.note }) ||
      NAME_PATTERN.test(String(row.note || ''))
    ) {
      report.collections.rtdbVehicles.suspicious.push(row);
    }
  }

  const fsUsersSnap = await firestore.collection('users').get();
  report.collections.firestoreUsers.total = fsUsersSnap.size;
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
    if (isSuspicious(row)) report.collections.firestoreUsers.suspicious.push(row);
  });

  const fsAdminsSnap = await firestore.collection('adminUsers').get();
  report.collections.firestoreAdminUsers.total = fsAdminsSnap.size;
  fsAdminsSnap.forEach((doc) => {
    const v = doc.data() || {};
    const row = {
      id: doc.id,
      email: v?.email || null,
      role: v?.role || null,
      displayName: v?.displayName || v?.name || null,
      createdAt: safeDate(v?.createdAt)
    };
    if (isSuspicious({ uid: doc.id, email: row.email, phone: null, displayName: row.displayName })) {
      report.collections.firestoreAdminUsers.suspicious.push(row);
    }
  });

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(REPORT_DIR, `prod-test-data-audit-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const summary = {
    generatedAt: report.generatedAt,
    reportPath: outPath,
    totals: {
      authTotal: report.collections.auth.total,
      authSuspicious: report.collections.auth.suspicious.length,
      rtdbUsersTotal: report.collections.rtdbUsers.total,
      rtdbUsersSuspicious: report.collections.rtdbUsers.suspicious.length,
      rtdbVehiclesTotal: report.collections.rtdbVehicles.total,
      rtdbVehiclesSuspicious: report.collections.rtdbVehicles.suspicious.length,
      firestoreUsersTotal: report.collections.firestoreUsers.total,
      firestoreUsersSuspicious: report.collections.firestoreUsers.suspicious.length,
      firestoreAdminUsersTotal: report.collections.firestoreAdminUsers.total,
      firestoreAdminUsersSuspicious: report.collections.firestoreAdminUsers.suspicious.length
    },
    samples: {
      auth: report.collections.auth.suspicious.slice(0, 12),
      rtdbUsers: report.collections.rtdbUsers.suspicious.slice(0, 12),
      rtdbVehicles: report.collections.rtdbVehicles.suspicious.slice(0, 12),
      firestoreUsers: report.collections.firestoreUsers.suspicious.slice(0, 12),
      firestoreAdminUsers: report.collections.firestoreAdminUsers.suspicious.slice(0, 12)
    }
  };

  console.log(JSON.stringify(summary, null, 2));
  await admin.app().delete();
}

main().catch((error) => {
  console.error('❌ Erro na auditoria:', error);
  process.exit(1);
});
