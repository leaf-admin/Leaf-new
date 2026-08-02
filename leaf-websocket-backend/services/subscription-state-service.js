const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const driverSubscriptionService = require('./driver-subscription-service');
const { logStructured } = require('../utils/logger');

const COLLECTION = 'subscriptions';
const GATE_CACHE_PREFIX = 'subscription:online-gate:v1:';
const DEFAULT_GATE_CACHE_TTL_SECONDS = 60;

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
    try {
      return firebaseConfig?.getRealtimeDB?.() || (admin.apps.length > 0 ? admin.database() : null);
    } catch (_) {
      return null;
    }
  }

  getRedis() {
    try {
      return require('../utils/redis-pool').getConnection();
    } catch (_) {
      return null;
    }
  }

  gateCacheKey(driverId) {
    return `${GATE_CACHE_PREFIX}${driverId}`;
  }

  gateCacheTtlSeconds() {
    const configured = Number.parseInt(process.env.SUBSCRIPTION_GATE_CACHE_TTL_SECONDS || '', 10);
    return Number.isFinite(configured) && configured >= 5
      ? Math.min(configured, 3600)
      : DEFAULT_GATE_CACHE_TTL_SECONDS;
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

  buildGateSnapshot(driverId, subscription = {}, userData = {}, authoritySource = 'firestore') {
    return cleanObject({
      driverId,
      subscriptionStatus: this.normalizeStatus(
        subscription.status || userData.subscriptionStatus,
        'active'
      ),
      billingStatus: this.deriveBillingStatus(subscription, userData),
      pendingFeeCents: Math.max(
        0,
        Number(subscription.pendingFeeCents || userData.subscription_pending_fee_cents || 0) || 0
      ),
      gracePeriodEndsAt: subscription.gracePeriodEndsAt || userData.subscription_grace_period_ends_at || null,
      authoritySource,
      cachedAt: this.nowIso()
    });
  }

  async readGateCache(driverId, { redis } = {}) {
    const redisClient = redis || this.getRedis();
    if (!redisClient?.get) return null;

    try {
      const raw = await redisClient.get(this.gateCacheKey(driverId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.driverId !== driverId || !parsed.subscriptionStatus || !parsed.billingStatus) {
        throw new Error('snapshot de assinatura inválido');
      }
      const cachedAtMs = Date.parse(parsed.cachedAt || '');
      const cacheAgeMs = Date.now() - cachedAtMs;
      if (
        !Number.isFinite(cachedAtMs)
        || cacheAgeMs < -5000
        || cacheAgeMs > (this.gateCacheTtlSeconds() * 1000)
      ) {
        throw new Error('snapshot de assinatura expirado');
      }
      return { ...parsed, source: 'redis_cache' };
    } catch (error) {
      logStructured('warn', 'Cache Redis de assinatura indisponível ou inválido', {
        service: 'subscription-state-service',
        driverId,
        error: error.message
      });
      return null;
    }
  }

  async writeGateCache(driverId, subscription, userData = {}, { redis, authoritySource = 'firestore' } = {}) {
    const redisClient = redis || this.getRedis();
    const snapshot = this.buildGateSnapshot(driverId, subscription, userData, authoritySource);
    if (!redisClient?.set) return snapshot;

    try {
      await redisClient.set(
        this.gateCacheKey(driverId),
        JSON.stringify(snapshot),
        'EX',
        this.gateCacheTtlSeconds()
      );
    } catch (error) {
      logStructured('warn', 'Falha ao atualizar cache Redis de assinatura', {
        service: 'subscription-state-service',
        driverId,
        error: error.message
      });
    }
    return snapshot;
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

  async loadRtdbMigrationSource(driverId, { db } = {}) {
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

    const firestoreInstance = firestore || this.getFirestore();

    if (!firestoreInstance) {
      throw new Error('Firestore indisponível para autoridade de assinatura');
    }

    const docRef = firestoreInstance.collection(COLLECTION).doc(driverId);
    const docSnapshot = await docRef.get();
    if (docSnapshot.exists) {
      return {
        exists: true,
        source: 'firestore',
        subscription: cleanObject({ ...(docSnapshot.data() || {}), driverId }),
        userData: {}
      };
    }

    const realtimeDb = db || this.getRealtimeDB();
    const rtdbState = await this.loadRtdbMigrationSource(driverId, { db: realtimeDb });
    const migratedSubscription = cleanObject({ ...(rtdbState.subscription || {}), driverId });
    const exists = Object.keys(migratedSubscription).length > 1 || Boolean(
      migratedSubscription.driverId
      && rtdbState.subscription
      && Object.keys(rtdbState.subscription).length > 0
    );

    if (exists && syncIfMissing) {
      await docRef.set({
        ...migratedSubscription,
        migratedFrom: 'rtdb',
        syncedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return {
      exists,
      source: exists ? 'rtdb' : 'none',
      subscription: migratedSubscription,
      userData: rtdbState.userData || {}
    };
  }

  async getGateState(driverId, { db, firestore, redis, bypassCache = false } = {}) {
    if (!driverId) {
      throw new Error('driverId ausente para gate de assinatura');
    }

    if (!bypassCache) {
      const cached = await this.readGateCache(driverId, { redis });
      if (cached) return cached;
    }

    const state = await this.getState(driverId, {
      db,
      firestore,
      syncIfMissing: true
    });
    const migrated = state.source === 'rtdb';
    const authoritativeUserData = migrated ? (state.userData || {}) : {};
    const snapshot = await this.writeGateCache(
      driverId,
      state.subscription || {},
      authoritativeUserData,
      {
        redis,
        authoritySource: migrated ? 'firestore_migrated' : 'firestore'
      }
    );

    return { ...snapshot, source: migrated ? 'firestore_migrated' : 'firestore' };
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

  async runTransaction(driverId, updater, { db, firestore, syncReadModel = true } = {}) {
    const firestoreInstance = firestore || this.getFirestore();
    if (!firestoreInstance) {
      return { success: false, error: 'Firestore indisponível para autoridade de assinatura' };
    }

    const realtimeDb = db || this.getRealtimeDB();
    const docRef = firestoreInstance.collection(COLLECTION).doc(driverId);
    let committedSubscription = null;
    let userData = {};

    try {
      const seedState = await this.getState(driverId, {
        db: realtimeDb,
        firestore: firestoreInstance,
        syncIfMissing: true
      });
      const seedSubscription = seedState.subscription || {};
      userData = seedState.source === 'rtdb' ? (seedState.userData || {}) : {};

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
      logStructured('warn', 'Falha em transação Firestore de subscription', {
        service: 'subscription-state-service',
        driverId,
        error: error.message
      });
      return { success: false, error: 'Falha na autoridade Firestore de assinatura' };
    }

    await this.writeGateCache(driverId, committedSubscription, {}, {
      authoritySource: 'firestore'
    });

    try {
      await this.syncMirrors(driverId, committedSubscription, {
        db: realtimeDb,
        userData,
        syncReadModel
      });
    } catch (error) {
      logStructured('warn', 'Autoridade Firestore confirmada; espelho RTDB de assinatura pendente', {
        service: 'subscription-state-service',
        driverId,
        error: error.message
      });
    }

    return {
      success: true,
      subscription: committedSubscription,
      billingStatus: this.deriveBillingStatus(committedSubscription, userData || {})
    };
  }

  async getBillingData(driverId, { db, firestore } = {}) {
    try {
      const { source, subscription, userData } = await this.getState(driverId, {
        db,
        firestore,
        syncIfMissing: true
      });
      const authoritativeUserData = source === 'rtdb' ? (userData || {}) : {};

      return {
        authorityAvailable: true,
        pendingFeeCents: Math.max(
          0,
          Number(subscription.pendingFeeCents || authoritativeUserData.subscription_pending_fee_cents || 0) || 0
        ),
        subscriptionStatus: this.normalizeStatus(
          subscription.status || authoritativeUserData.subscriptionStatus,
          'active'
        ),
        billingStatus: this.deriveBillingStatus(subscription, authoritativeUserData),
        collectionMode: this.normalizeCollectionMode(
          subscription.collectionMode || subscription.billingCollectionMode || authoritativeUserData.subscription_collection_mode,
          'withdrawal'
        ),
        dailyFeeCents: Math.max(
          0,
          Number(subscription.dailyFeeCents || subscription.dailyFeeOverrideCents || 0) || 0
        ),
        waveId: subscription.waveId || authoritativeUserData.subscription_wave_id || null
      };
    } catch (error) {
      logStructured('warn', 'Falha ao obter autoridade de assinatura', {
        service: 'subscription-state-service',
        driverId,
        error: error.message
      });
      throw error;
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
module.exports.SubscriptionStateService = SubscriptionStateService;
