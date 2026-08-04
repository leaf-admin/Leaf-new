#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const {
  readBooleanLike,
  resolveAuditTarget,
  resolveCredentialJson
} = require('./preflight-firebase-runtime-iam.cjs');

const CANARY_CONFIRMATION = 'CONFIRM_FIREBASE_RUNTIME_DATA_PLANE_CANARY';

function buildRunId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function validateRunId(runId) {
  if (!/^[a-f0-9]{32}$/.test(runId)) {
    throw new Error('Run ID inválido para o canário Firebase runtime');
  }
  return runId;
}

async function runCanary({
  environment = process.env,
  adminImpl = admin,
  runIdFactory = buildRunId
} = {}) {
  if (!readBooleanLike(environment[CANARY_CONFIRMATION], false)) {
    throw new Error(`${CANARY_CONFIRMATION}=true é obrigatório`);
  }
  const databaseURL = String(environment.FIREBASE_DATABASE_URL || '').trim();
  if (!/^https:\/\/[a-z0-9.-]+(?:\.firebasedatabase\.app|\.firebaseio\.com)\/?$/.test(databaseURL)) {
    throw new Error('FIREBASE_DATABASE_URL inválida para o canário Firebase runtime');
  }

  const credentialJson = resolveCredentialJson(environment);
  const { projectId, bucketName } = resolveAuditTarget(credentialJson, environment);
  const runId = validateRunId(runIdFactory());
  const appName = `firebase-runtime-data-plane-canary-${process.pid}-${runId}`;
  const credential = adminImpl.credential.cert(credentialJson);
  const app = adminImpl.initializeApp({
    credential,
    projectId,
    databaseURL,
    storageBucket: bucketName
  }, appName);

  const firestoreDocument = adminImpl.firestore(app)
    .collection('_ops_runtime_canary')
    .doc(runId);
  const realtimeReference = adminImpl.database(app)
    .ref(`__ops_runtime_canary/${runId}`);
  const storageFile = adminImpl.storage(app)
    .bucket(bucketName)
    .file(`__ops_runtime_canary/${runId}.txt`);
  const authClient = adminImpl.auth(app);
  const authUid = `ops-canary-${runId}`;
  const created = {
    firestore: false,
    realtimeDatabase: false,
    storage: false,
    auth: false
  };
  const cleanupErrors = [];

  try {
    await firestoreDocument.set({ runId, state: 'created' });
    created.firestore = true;
    const firestoreSnapshot = await firestoreDocument.get();
    if (!firestoreSnapshot.exists || firestoreSnapshot.data()?.runId !== runId) {
      throw new Error('Firestore não confirmou a leitura do canário');
    }
    await firestoreDocument.update({ state: 'updated' });

    await realtimeReference.set({ runId, state: 'created' });
    created.realtimeDatabase = true;
    const realtimeSnapshot = await realtimeReference.once('value');
    if (realtimeSnapshot.val()?.runId !== runId) {
      throw new Error('Realtime Database não confirmou a leitura do canário');
    }
    await realtimeReference.update({ state: 'updated' });

    await storageFile.save(Buffer.from(runId, 'utf8'), {
      contentType: 'text/plain',
      resumable: false,
      metadata: { metadata: { leafRuntimeCanary: 'true' } }
    });
    created.storage = true;
    const [storageBytes] = await storageFile.download();
    if (storageBytes.toString('utf8') !== runId) {
      throw new Error('Storage não confirmou a leitura do canário');
    }
    await storageFile.setMetadata({ metadata: { leafRuntimeCanary: 'updated' } });

    await authClient.createUser({ uid: authUid, disabled: true });
    created.auth = true;
    const authUser = await authClient.getUser(authUid);
    if (authUser.uid !== authUid || authUser.disabled !== true) {
      throw new Error('Firebase Auth não confirmou a leitura do canário');
    }
    await authClient.updateUser(authUid, { displayName: 'Leaf Runtime Canary' });

    return {
      ok: true,
      runId,
      projectId,
      bucketName,
      checks: ['firestore', 'realtime_database', 'storage', 'firebase_auth'],
      fcm: 'covered_by_live_iam_preflight_without_sending_message'
    };
  } finally {
    if (created.auth) {
      try { await authClient.deleteUser(authUid); } catch (error) { cleanupErrors.push(`auth:${error.message}`); }
    }
    if (created.storage) {
      try { await storageFile.delete({ ignoreNotFound: true }); } catch (error) { cleanupErrors.push(`storage:${error.message}`); }
    }
    if (created.realtimeDatabase) {
      try { await realtimeReference.remove(); } catch (error) { cleanupErrors.push(`rtdb:${error.message}`); }
    }
    if (created.firestore) {
      try { await firestoreDocument.delete(); } catch (error) { cleanupErrors.push(`firestore:${error.message}`); }
    }
    try { await app.delete(); } catch (error) { cleanupErrors.push(`app:${error.message}`); }
    if (cleanupErrors.length > 0) {
      throw new Error(`Canário Firebase sem limpeza integral: ${cleanupErrors.join('; ')}`);
    }
  }
}

async function main() {
  try {
    const report = await runCanary();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CANARY_CONFIRMATION,
  buildRunId,
  runCanary,
  validateRunId
};
