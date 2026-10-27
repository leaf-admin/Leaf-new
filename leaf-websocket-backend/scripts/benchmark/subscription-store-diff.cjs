'use strict';
// Differential check of the subscription reads that replaced the RTDB router,
// on the local Firestore emulator. With `subscriptions` served by the router
// from the canonical Firestore collection (subscriptions:subscriptions:merge),
// the router view of subscriptions/{id} must equal listSubscriptions(), and a
// driver without a Firestore record must read as absent through both (the
// RTDB "migration source" was that same document).
// Local emulator only (cached JAR); no remote endpoint or credential.
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const withPrivateFirestore = require('./private-firestore.cjs');
const { createRouter, createRetiredRtdb } = require('../../services/rtdb-root-router');
const { SubscriptionStateService } = require('../../services/subscription-state-service');

const quiet = () => {};

withPrivateFirestore(async (firestore) => {
  await firestore.collection('subscriptions').doc('d1').set({
    status: 'active', pendingFeeCents: 490, syncedAt: Timestamp.fromMillis(1_700_000_000_000),
    tiers: { a: { min: 0 } }, emptyMap: {}, note: null
  });
  await firestore.collection('subscriptions').doc('d2').set({ status: 'blocked', billingStatus: 'suspended' });
  const router = createRouter(createRetiredRtdb({ log: quiet }), {
    getFirestore: () => firestore, log: quiet,
    env: {
      RTDB_FIRESTORE_WRITE_ROOTS: 'subscriptions', RTDB_FIRESTORE_READ_ROOTS: 'subscriptions',
      RTDB_FIRESTORE_NATIVE_COLLECTIONS: 'subscriptions:subscriptions:merge', RTDB_RETIRED: 'true'
    }
  });
  const service = new SubscriptionStateService();

  const routerAll = (await router.ref('subscriptions').once('value')).val();
  assert.deepEqual(await service.listSubscriptions({ firestore }), routerAll);
  assert.equal(routerAll.d1.syncedAt, new Date(1_700_000_000_000).toISOString());

  assert.equal((await router.ref('subscriptions/missing').once('value')).val(), null);
  assert.deepEqual(await service.getState('missing', { firestore }), {
    exists: false, source: 'none', subscription: { driverId: 'missing' }, userData: {}
  });
  const state = await service.getState('d2', { firestore });
  assert.equal(state.source, 'firestore');
  assert.deepEqual(state.subscription, { status: 'blocked', billingStatus: 'suspended', driverId: 'd2' });
  console.log(`subscription-store diff: ${Object.keys(routerAll).length} subscriptions identical to the router view`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  // Loading the service opens the Redis pool; nothing else is pending here.
  process.exit();
});
