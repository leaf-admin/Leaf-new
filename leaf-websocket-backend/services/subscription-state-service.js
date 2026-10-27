const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const driverSubscriptionService = require('./driver-subscription-service');
const { logStructured } = require('../utils/logger');
const userStore = require('./user-store');
const { docView } = require('./native-record-view');

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

  // { driverId: subscription } for every driver, in the view the RTDB router
  // served (Timestamps as ISO strings, no nulls). Bulk reads (daily billing,
  // dashboard fallback).
  async listSubscriptions({ firestore } = {}) {
    const firestoreInstance = firestore || this.getFirestore();
    if (!firestoreInstance) {
      throw new Error('Firestore indisponível para autoridade de assinatura');
    }
    const snapshot = await firestoreInstance.collection(COLLECTION).get();
    const result = {};
    for (const doc of snapshot?.docs || []) {
      const view = docView(doc.data());
      if (view !== null) result[doc.id] = view;
    }
    return result;
  }

  // subscriptions/{driverId} in Firestore is the only record (the RTDB copy it
  // used to migrate from was served from this same document by the router).
  async getState(driverId, { firestore } = {}) {
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

    return {
      exists: false,
      source: 'none',
      subscription: { driverId },
      userData: {}
    };
  }

  async getGateState(driverId, { firestore, redis, bypassCache = false } = {}) {
    if (!driverId) {
      throw new Error('driverId ausente para gate de assinatura');
    }

    if (!bypassCache) {
      const cached = await this.readGateCache(driverId, { redis });
      if (cached) return cached;
    }

    const state = await this.getState(driverId, { firestore });
    const snapshot = await this.writeGateCache(
      driverId,
      state.subscription || {},
      {},
      {
        redis,
        authoritySource: 'firestore'
      }
    );

    return { ...snapshot, source: 'firestore' };
  }

  // Projections of the committed subscription: the users/{id} shadow fields
  // and the dashboard read model.
  async syncMirrors(driverId, subscription, { userData, syncReadModel = true } = {}) {
    const sanitizedSubscription = cleanObject({ ...subscription, driverId });

    const shadowPatch = this.buildUserShadowPatch(sanitizedSubscription, userData || {});
    const firestore = this.getFirestore();
    if (Object.keys(shadowPatch).length > 0 && firestore) {
      await userStore.updateUser(firestore, driverId, shadowPatch);
    }

    if (syncReadModel) {
      try {
        await driverSubscriptionService.syncDriverSubscription(driverId);
      } catch (error) {
        logStructured('warn', 'Falha ao sincronizar read-model de subscription', {
          service: 'subscription-state-service',
          driverId,
          error: error.message
        });
      }
    }
  }

  async runTransaction(driverId, updater, { firestore, syncReadModel = true } = {}) {
    const firestoreInstance = firestore || this.getFirestore();
    if (!firestoreInstance) {
      return { success: false, error: 'Firestore indisponível para autoridade de assinatura' };
    }

    const docRef = firestoreInstance.collection(COLLECTION).doc(driverId);
    let committedSubscription = null;
    const userData = {};

    try {
      const seedState = await this.getState(driverId, { firestore: firestoreInstance });
      const seedSubscription = seedState.subscription || {};

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
        userData,
        syncReadModel
      });
    } catch (error) {
      logStructured('warn', 'Autoridade Firestore confirmada; projeção de assinatura pendente', {
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

  async getBillingData(driverId, { firestore } = {}) {
    try {
      const { subscription } = await this.getState(driverId, { firestore });
      const authoritativeUserData = {};

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

  async settlePendingOnWithdrawal(driverId, settlementCents, { firestore } = {}) {
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
    }, { firestore, syncReadModel: true });

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
