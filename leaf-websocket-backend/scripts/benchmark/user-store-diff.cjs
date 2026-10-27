'use strict';
// Differential check of services/user-store.js against the router it
// replaces, on the local Firestore emulator: the same users/{uid} operations
// run through rtdb-root-router (RTDB retired, users:users:merge) and through
// the store, from the same seed. Stored documents must be identical, raw
// Firestore values included (Timestamps kept, Firestore-only fields kept),
// and reads must return the router's view. Local emulator only (cached JAR).
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const withPrivateFirestore = require('./private-firestore.cjs');
const { createRouter, createRetiredRtdb } = require('../../services/rtdb-root-router');
const userStore = require('../../services/user-store');

const quiet = () => {};
const approval = { approved: true, status: 'approved', approvalAuditTrail: { evidence: { grid: [[1, 2]] }, by: 'system' }, rejectionReason: null };

async function seed(firestore) {
  await firestore.collection('users').doc('u1').set({
    name: 'Driver', usertype: 'driver', createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000), profileOnly: { nested: true },
    autoApproval: { status: 'old', reason: 'x', extra: 1 }, identityFraudBlock: { stale: true, caseId: 'c0' },
    rejectionReason: 'old reason'
  });
}

async function viaRouter(db) {
  await db.ref('users/u1').update({ ...approval, updatedAt: '2026-10-27T15:00:00.000Z', 'driverActivation/kyc': { ok: true } });
  await db.ref('users/u1/autoApproval').set({ status: 'needs_review', reason: 'cpf_missing' });
  await db.ref('users/u1/planType').set('plus');
  await db.ref('users/u1').update({ identityFraudBlock: { permanent: true, caseId: 'c1' }, kycBlocked: true });
  await db.ref('users/u1').transaction(current => ({ ...current, profileOnly: null, counter: (current.counter || 0) + 1 }));
  await db.ref('users/u1').transaction(() => undefined);
}

async function viaStore(firestore) {
  await userStore.updateUser(firestore, 'u1', { ...approval, updatedAt: '2026-10-27T15:00:00.000Z', 'driverActivation/kyc': { ok: true } });
  await userStore.setUserField(firestore, 'u1', ['autoApproval'], { status: 'needs_review', reason: 'cpf_missing' });
  await userStore.setUserField(firestore, 'u1', 'planType', 'plus');
  await userStore.updateUser(firestore, 'u1', { identityFraudBlock: { permanent: true, caseId: 'c1' }, kycBlocked: true });
  await userStore.transactUser(firestore, 'u1', current => ({ ...current, profileOnly: null, counter: (current.counter || 0) + 1 }));
  const aborted = await userStore.transactUser(firestore, 'u1', () => undefined);
  assert.equal(aborted.committed, false);
}

const raw = value => {
  if (value instanceof Timestamp) return { timestamp: value.toMillis() };
  if (Array.isArray(value)) return value.map(raw);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort().map(([k, v]) => [k, raw(v)]));
  return value;
};
const dump = async firestore => raw((await firestore.collection('users').doc('u1').get()).data());

withPrivateFirestore(async (firestore) => {
  await seed(firestore);
  const router = createRouter(createRetiredRtdb({ log: quiet }), {
    getFirestore: () => firestore, log: quiet,
    env: { RTDB_FIRESTORE_WRITE_ROOTS: 'users', RTDB_FIRESTORE_READ_ROOTS: 'users', RTDB_FIRESTORE_NATIVE_COLLECTIONS: 'users:users:merge', RTDB_RETIRED: 'true' }
  });
  await viaRouter(router);
  const expected = await dump(firestore);
  const routerView = (await router.ref('users/u1').once('value')).val();
  const routerField = (await router.ref('users/u1/driverActivation/kyc').once('value')).val();

  await firestore.collection('users').doc('u1').delete();
  await seed(firestore);
  await viaStore(firestore);
  const actual = await dump(firestore);

  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.createdAt, { timestamp: 1_700_000_000_000 });
  assert.equal(actual.rejectionReason, undefined);
  assert.deepEqual(actual.identityFraudBlock, { caseId: 'c1', permanent: true });
  assert.deepEqual(await userStore.readUser(firestore, 'u1'), routerView);
  assert.deepEqual(await userStore.readUserField(firestore, 'u1', 'driverActivation/kyc'), routerField);
  assert.equal(await userStore.readUser(firestore, 'missing'), null);
  console.log(`user-store diff: users/u1 identical to the router (${Object.keys(actual).length} fields)`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
