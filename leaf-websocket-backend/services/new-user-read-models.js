'use strict';
const { randomUUID } = require('node:crypto');
const receipts = require('./receipt-history-index');
const projections = require('./metrics-projection-store');
const { hash } = require('./metrics-projection-summary');

// Call only immediately after Admin Auth createUser succeeds, with its returned
// UserRecord. Never infer a new account from mutable profile.createdAt.
async function initialize(userRecord, adapters = {}) {
  if (process.env.ENABLE_NEW_USER_READ_MODEL_INIT !== 'true') return { skipped: true };
  const createdAt = Date.parse(userRecord?.metadata?.creationTime);
  if (!userRecord?.uid || !Number.isFinite(createdAt) || Date.now() - createdAt > 300000 || createdAt > Date.now() + 30000) {
    return { skipped: true, reason: 'trusted_new_auth_record_required' };
  }
  const config = adapters.config || require('../firebase-config');
  const work = [];
  if (receipts.enabledWrites()) {
    for (const role of ['customer', 'driver']) {
      const base = receipts.ownerBase({ namespace: 'operational' }, role, userRecord.uid);
      work.push(Promise.resolve().then(() => config.getRealtimeDB().ref(`${base}/meta`).transaction(current => {
        if (current && current.schema !== 1) return undefined;
        return { ...(current || {}), schema: 1, ready: true, revision: current?.revision || randomUUID(),
          initializationSource: 'admin_auth_create_user', authCreatedAt: new Date(createdAt).toISOString() };
      }, undefined, false)).then(result => { if (!result.committed) throw new Error('Receipt initialization conflict'); }));
    }
  }
  if (projections.enabled()) {
    work.push(Promise.resolve().then(() => {
      const firestore = config.getFirestore();
      const ref = firestore.collection('ops_driver_stats_v1').doc(hash(userRecord.uid));
      return firestore.runTransaction(async tx => {
        const doc = await tx.get(ref); const data = doc.exists ? doc.data() : null;
        if (data && (data.schema !== 1 || data.driverId !== userRecord.uid || data.namespace !== 'operational')) throw new Error('Driver initialization conflict');
        tx.set(ref, { ...(data || { completedTrips: 0, driverNetMinor: 0, pendingFinancialTrips: 0 }), schema: 1,
          namespace: 'operational', driverId: userRecord.uid, source: 'ride_finalization_v1', complete: true,
          initializationSource: 'admin_auth_create_user', authCreatedAt: new Date(createdAt), updatedAt: new Date() });
      });
    }));
  }
  const results = await Promise.allSettled(work);
  return { initialized: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length };
}

module.exports = { initialize };
