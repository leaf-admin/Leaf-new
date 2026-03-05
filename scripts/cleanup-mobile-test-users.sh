#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_ACCOUNT="$ROOT_DIR/leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json"

if [[ ! -f "$SERVICE_ACCOUNT" ]]; then
  echo "Service account não encontrada em: $SERVICE_ACCOUNT" >&2
  exit 1
fi

node <<'NODE'
const admin = require(process.cwd() + '/leaf-websocket-backend/node_modules/firebase-admin');
const serviceAccount = require(process.cwd() + '/leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');

const TEST_PHONES = ['+5511999001001', '+5511999001002'];

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'
  });
}

const db = admin.database();

async function findUserUidByPhone(phone) {
  try {
    const user = await admin.auth().getUserByPhoneNumber(phone);
    return user.uid;
  } catch (err) {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  }
}

async function cleanupUser(uid, phone) {
  if (!uid) {
    console.log(`skip phone=${phone} uid=not-found`);
    return;
  }

  try {
    await db.ref(`users/${uid}`).remove();
  } catch (err) {
    console.warn(`warn remove users/${uid}: ${err.message}`);
  }

  try {
    await db.ref(`drivers/${uid}`).remove();
  } catch (err) {
    console.warn(`warn remove drivers/${uid}: ${err.message}`);
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    console.warn(`warn delete auth user ${uid}: ${err.message}`);
  }

  console.log(`deleted phone=${phone} uid=${uid}`);
}

(async () => {
  for (const phone of TEST_PHONES) {
    const uid = await findUserUidByPhone(phone);
    await cleanupUser(uid, phone);
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
NODE
