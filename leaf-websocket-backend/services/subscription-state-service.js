const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const driverSubscriptionService = require('./driver-subscription-service');
const { logStructured } = require('../utils/logger');

const COLLECTION = 'subscriptions';

function cleanObject(value) {
  if (Array.isArray(value)) {
    return value.map(cleanObject);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, cleanObject(entryValue)])
  );
}

class SubscriptionStateService {
  getFirestore() {
    return firebaseConfig?.getFirestore?.() || (admin.apps.length > 0 ? admin.firestore() : null);
  }

  getRealtimeDB() {
    return firebaseConfig?.getRealtimeDB?.() || (admin.apps.length > 0 ? admin.database() : null);
  }

  nowIso() {
    return new Date().toISOString();
  }

  normalizeStatus(value, fallback = 'active') {
    const normalized = String(value || fallback).trim().toLowerCase();
    return normalized || fallback;
  }

  normalizeCollectionMode(value, fallback = 'withdrawal') {
    return String(value || fallback).trim().toLowerCase() === 'balance' ? 'balance' : 'withdrawal';
  }

  deriveBillingStatus(subscription = {}, userData = {}) {
    const explicit = String(
      subscription.billingStatus ||
      userData.billing_status ||
      userData.billingStatus ||
      ''
    ).trim().toLowerCase();

    if (explicit) {
      if (['active', 'overdue', 'suspended'].includes(explicit)) {
        return explicit;
      }
      return 'active';
    }

    const subscriptionStatus = this.normalizeStatus(
      subscription.status || userData.subscriptionStatus,
      'active'
    );
    const pendingFeeCents = Math.max(
      0,
      Number(subscription.pendingFeeCents || userData.subscription_pending_fee_cents || 0) || 0
    );

    if (['blocked', 'cancelled', 'suspended'].includes(subscriptionStatus)) {
      return 'suspended';
    }

    if (subscriptionStatus === 'grace_period' || subscriptionStatus === 'overdue' || pendingFeeCents > 0) {
      return 'overdue';
    }

    return 'active';
  }

  buildUserShadowPatch(subscription = {}, userData = {}) {
    const subscriptionStatus = this.normalizeStatus(
      subscription.status || userData.subscriptionStatus,
      'active'
    );
    const billingStatus = this.deriveBillingStatus(subscription, userData);
    const patch = {
      billing_status: billingStatus,
      subscriptionStatus,
      subscription_pending_fee_cents: Math.max(0, Number(subscription.pendingFeeCents || 0) || 0),
      subscription_daily_fee_cents: Math.max(0, Number(subscription.dailyFeeCents || subscription.dailyFeeOverrideCents || 0) || 0),
      subscription_collection_mode: this.normalizeCollectionMode(
        subscription.collectionMode || subscription.billingCollectionMode || userData.subscription_collection_mode,
        'withdrawal'
      ),
      subscription_grace_period_ends_at: subscription.gracePeriodEndsAt || null
    };

    if (Object.prototype.hasOwnProperty.call(subscription, 'waveId')) {
      patch.subscription_wave_id = subscription.waveId || null;
    }

    if (Object.prototype.hasOwnProperty.call(subscription, 'planType')) {
      patch.planType = subscription.planType ? String(subscription.planType).toLowerCase() : null;
    }

    if (Object.prototype.hasOwnProperty.call(subscription, 'isFeeExempt')) {
      patch.subscription_fee_exempt = subscription.isFeeExempt === true;
    }

    if (Object.prototype.hasOwnProperty.call(subscription, 'feeExemptUntil')) {
      patch.subscription_fee_exempt_until = subscription.feeExemptUntil || null;
    }

    if (billingStatus === 'suspended') {
      patch.driverActiveStatus = false;
    }

    return cleanObject(patch);
  }

  async loadLegacyState(driverId, { db } = {}) {
    const realtimeDb = db || this.getRealtimeDB();
    if (!realtimeDb || !driverId) {
      return { subscription: {}, userData: {} };
    }

    const [subscriptionSnapshot, userSnapshot] = await Promise.all([
      realtimeDb.ref(`subscriptions/${driverId}`).once('value'),
      realtimeDb.ref(`users/${driverId}`).once('value')
    ]);

    return {
      subscription: subscriptionSnapshot.val() || {},
      userData: userSnapshot.val() || {}
    };
  }

  async getState(driverId, { db, firestore, syncIfMissing = true } = {}) {
    if (!driverId) {
      return { exists: false, source: 'none', subscription: {}, userData: {} };
    }

    const realtimeDb = db || this.getRealtimeDB();
    const firestoreInstance = firestore || this.getFirestore();
    let userData = {};

    if (realtimeDb) {
      const userSnapshot = await realtimeDb.ref(`users/${driverId}`).once('value').catch(() => null);
      userData = userSnapshot?.val?.() || {};
    }

    if (!firestoreInstance) {
      const legacy = await this.loadLegacyState(driverId, { db: realtimeDb });
      return {
        exists: Object.keys(legacy.subscription || {}).length > 0,
        source: 'rtdb',
        subscription: cleanObject({ ...legacy.subscription, driverId }),
        userData: legacy.userData || userData || {}
      };
    }

    const docRef = firestoreInstance.collection(COLLECTION).doc(driverId);
    const docSnapshot = await docRef.get();
    if (docSnapshot.exists) {
      return {
        exists: true,
        source: 'firestore',
        subscription: cleanObject({ ...(docSnapshot.data() || {}), driverId }),
        userData: userData || {}
      };
    }

    const legacy = await this.loadLegacyState(driverId, { db: realtimeDb });
    const legacySubscription = cleanObject({ ...(legacy.subscription || {}), driverId });
    const exists = Object.keys(legacySubscription).length > 1 || Boolean(legacySubscription.driverId && legacy.subscription && Object.keys(legacy.subscription).length > 0);

    if (exists && syncIfMissing) {
      await docRef.set({
        ...legacySubscription,
        migratedFrom: 'rtdb',
        syncedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return {
      exists,
      source: exists ? 'rtdb' : 'none',
      subscription: legacySubscription,
      userData: legacy.userData || userData || {}
    };
  }

  async syncMirrors(driverId, subscription, { db, userData, syncReadModel = true } = {}) {
    const realtimeDb = db || this.getRealtimeDB();
    const sanitizedSubscription = cleanObject({ ...subscription, driverId });

    if (realtimeDb) {
      const subscriptionPatch = cleanObject({ ...sanitizedSubscription });
      delete subscriptionPatch.syncedAt;
      await realtimeDb.ref(`subscriptions/${driverId}`).update(subscriptionPatch);

      const shadowPatch = this.buildUserShadowPatch(sanitizedSubscription, userData || {});
      if (Object.keys(shadowPatch).length > 0) {
        await realtimeDb.ref(`users/${driverId}`).update(shadowPatch);
      }
    }

    if (syncReadModel) {
      try {
        await driverSubscriptionService.syncDriverSubscription(driverId, { db: realtimeDb });
      } catch (error) {
        logStructured('warn', 'Falha ao sincronizar read-model de subscription', {
          service: 'subscription-state-service',
          driverId,
          error: error.message
        });
      }
    }
  }

  async legacyTransaction(driverId, updater, { db, syncReadModel = true } = {}) {
    const realtimeDb = db || this.getRealtimeDB();
    if (!realtimeDb) {
      return { success: false, error: 'Realtime DB não disponível' };
    }

    const { userData } = await this.loadLegacyState(driverId, { db: realtimeDb });
    const subscriptionRef = realtimeDb.ref(`subscriptions/${driverId}`);
    let committedSubscription = null;

    const txResult = await subscriptionRef.transaction((current) => {
      const base = cleanObject(current || {});
      const next = updater({ ...base }) || base;
      committedSubscription = cleanObject({
        ...base,
        ...next,
        driverId,
        updatedAt: next?.updatedAt || this.nowIso(),
        createdAt: base.createdAt || next?.createdAt || userData?.createdAt || this.nowIso()
      });
      return committedSubscription;
    });

    if (!txResult.committed) {
      return { success: false, error: 'Falha ao atualizar assinatura' };
    }

    committedSubscription = cleanObject({ ...(txResult.snapshot.val() || {}), driverId });
    const shadowPatch = this.buildUserShadowPatch(committedSubscription, userData || {});
    if (Object.keys(shadowPatch).length > 0) {
      await realtimeDb.ref(`users/${driverId}`).update(shadowPatch);
    }

    if (syncReadModel) {
      try {
        await driverSubscriptionService.syncDriverSubscription(driverId, { db: realtimeDb });
      } catch (error) {
        logStructured('warn', 'Falha ao sincronizar read-model de subscription via fallback legado', {
          service: 'subscription-state-service',
          driverId,
          error: error.message
        });
      }
    }

    return {
      success: true,
      subscription: committedSubscription,
      billingStatus: this.deriveBillingStatus(committedSubscription, userData || {})
    };
  }

  async runTransaction(driverId, updater, { db, firestore, syncReadModel = true } = {}) {
    const firestoreInstance = firestore || this.getFirestore();
    if (!firestoreInstance) {
      return this.legacyTransaction(driverId, updater, { db, syncReadModel });
    }

    const realtimeDb = db || this.getRealtimeDB();
    const { subscription: seedSubscription, userData } = await this.getState(driverId, {
      db: realtimeDb,
      firestore: firestoreInstance,
      syncIfMissing: true
    });

    const docRef = firestoreInstance.collection(COLLECTION).doc(driverId);
    let committedSubscription = null;

    try {
      await firestoreInstance.runTransaction(async (transaction) => {
        const docSnapshot = await transaction.get(docRef);
        const base = cleanObject(docSnapshot.exists ? (docSnapshot.data() || {}) : (seedSubscription || {}));
        const next = updater({ ...base }) || base;
        committedSubscription = cleanObject({
          ...base,
          ...next,
          driverId,
          updatedAt: next?.updatedAt || this.nowIso(),
          createdAt: base.createdAt || next?.createdAt || userData?.createdAt || this.nowIso()
        });

        transaction.set(docRef, {
          ...committedSubscription,
          syncedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
    } catch (error) {
      logStructured('warn', 'Falha em transação Firestore de subscription; usando fallback legado', {
        service: 'subscription-state-service',
        driverId,
        error: error.message
      });
      return this.legacyTransaction(driverId, updater, { db: realtimeDb, syncReadModel });
    }

    await this.syncMirrors(driverId, committedSubscription, {
      db: realtimeDb,
      userData,
      syncReadModel
    });

    return {
      success: true,
      subscription: committedSubscription,
      billingStatus: this.deriveBillingStatus(committedSubscription, userData || {})
    };
  }

  async getBillingData(driverId, { db, firestore } = {}) {
    const defaultResult = {
      pendingFeeCents: 0,
      subscriptionStatus: 'active',
      billingStatus: 'active',
      collectionMode: 'withdrawal',
      dailyFeeCents: 0,
      waveId: null
    };

    try {
      const { subscription, userData } = await this.getState(driverId, {
        db,
        firestore,
        syncIfMissing: true
      });

      return {
        pendingFeeCents: Math.max(
          0,
          Number(subscription.pendingFeeCents || userData.subscription_pending_fee_cents || 0) || 0
        ),
        subscriptionStatus: this.normalizeStatus(
          subscription.status || userData.subscriptionStatus,
          'active'
        ),
        billingStatus: this.deriveBillingStatus(subscription, userData || {}),
        collectionMode: this.normalizeCollectionMode(
          subscription.collectionMode || subscription.billingCollectionMode || userData.subscription_collection_mode,
          'withdrawal'
        ),
        dailyFeeCents: Math.max(
          0,
          Number(subscription.dailyFeeCents || subscription.dailyFeeOverrideCents || 0) || 0
        ),
        waveId: subscription.waveId || userData.subscription_wave_id || null
      };
    } catch (error) {
      logStructured('warn', 'Falha ao obter dados modernos de assinatura', {
        service: 'subscription-state-service',
        driverId,
        error: error.message
      });
      return defaultResult;
    }
  }

  async settlePendingOnWithdrawal(driverId, settlementCents, { db, firestore } = {}) {
    const settledAmount = Math.max(0, Number(settlementCents || 0));
    if (!driverId || settledAmount <= 0) {
      return {
        success: true,
        settledCents: 0,
        remainingCents: 0,
        status: null,
        billingStatus: null
      };
    }

    const result = await this.runTransaction(driverId, (current) => {
      const pending = Math.max(0, Number(current.pendingFeeCents || 0));
      const debit = Math.min(pending, settledAmount);
      const nextPending = Math.max(0, pending - debit);
      const status = this.normalizeStatus(current.status, 'active');
      const isHardSuspended = ['blocked', 'cancelled', 'suspended'].includes(status);
      const resolvedStatus = isHardSuspended ? status : 'active';
      const resolvedBilling = resolvedStatus === 'active'
        ? (nextPending > 0 ? 'overdue' : 'active')
        : 'suspended';
      const nowIso = this.nowIso();

      return {
        pendingFeeCents: nextPending,
        status: resolvedStatus,
        billingStatus: resolvedBilling,
        collectionMode: 'withdrawal',
        lastSettlementAt: nowIso,
        lastSettlementAmountCents: debit,
        updatedAt: nowIso
      };
    }, { db, firestore, syncReadModel: true });

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      settledCents: Math.max(0, Number(result.subscription?.lastSettlementAmountCents || 0) || 0),
      remainingCents: Math.max(0, Number(result.subscription?.pendingFeeCents || 0) || 0),
      status: result.subscription?.status || 'active',
      billingStatus: result.subscription?.billingStatus || result.billingStatus || 'active'
    };
  }
}

module.exports = new SubscriptionStateService();
