const admin = require('firebase-admin');
const { logStructured } = require('../utils/logger');

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (_) {
  firebaseConfig = null;
}

const COLLECTION = 'driver_subscriptions';
const RAW_COLLECTION = 'subscriptions';

function getFirestore() {
  if (firebaseConfig?.getFirestore) return firebaseConfig.getFirestore();
  if (admin.apps.length > 0) return admin.firestore();
  throw new Error('Firestore indisponível para subscriptions');
}

function getRealtimeDB() {
  if (firebaseConfig?.getRealtimeDB) return firebaseConfig.getRealtimeDB();
  throw new Error('Realtime Database indisponível para subscriptions');
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMoney(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class DriverSubscriptionService {
  constructor() {
    this.plusDefaultDailyCents = Number.parseInt(process.env.SUBSCRIPTION_PLUS_DAILY_CENTS || '1490', 10);
    this.eliteDefaultDailyCents = Number.parseInt(process.env.SUBSCRIPTION_ELITE_DAILY_CENTS || '0', 10);
    this.dailyBillingEnabled = String(process.env.SUBSCRIPTION_DAILY_BILLING_ENABLED || 'false').toLowerCase() === 'true';
    this.readModelMaxAgeMs = Number.parseInt(process.env.SUBSCRIPTION_READMODEL_MAX_AGE_MS || '60000', 10);
  }

  buildRow(driverId, driver = {}, subscription = {}, now = new Date()) {
    const rawPlanType = String(subscription.planType || driver.planType || 'plus').toLowerCase();
    const planType = rawPlanType === 'elite'
      ? 'elite'
      : (rawPlanType === 'none' ? 'none' : 'plus');
    const fallbackDailyCents = planType === 'elite'
      ? this.eliteDefaultDailyCents
      : (planType === 'none' ? 0 : this.plusDefaultDailyCents);
    const dailyFeeCents = Math.max(
      0,
      Number(subscription.dailyFeeCents ?? subscription.dailyFeeOverrideCents ?? fallbackDailyCents) || 0
    );
    const weeklyFeeCents = Math.max(
      0,
      Number(subscription.weeklyFeeCents || (dailyFeeCents * 7)) || 0
    );
    const pendingFeeCents = Math.max(
      0,
      Number(subscription.pendingFeeCents || driver.subscription_pending_fee_cents || 0) || 0
    );

    const subscriptionStatus = String(
      subscription.status ||
      driver.subscriptionStatus ||
      (driver.approved ? 'active' : 'pending')
    ).toLowerCase();

    const billingStatus = String(
      subscription.billingStatus ||
      driver.billing_status ||
      (pendingFeeCents > 0 ? 'overdue' : 'active')
    ).toLowerCase();

    const hardBlocked = ['blocked', 'cancelled', 'suspended'].includes(subscriptionStatus) || billingStatus === 'suspended';
    const isOverdue = pendingFeeCents > 0 && !hardBlocked;
    const paymentStatus = hardBlocked ? 'blocked' : (isOverdue ? 'overdue' : 'paid');

    const freeTrialEnd = toDate(driver.free_trial_end);
    const freeMonthsEnd = toDate(driver.free_months_end);
    const promotionFreeEnd = toDate(driver.promotion_free_end);
    const feeExemptUntil = toDate(subscription.feeExemptUntil);
    const freeEnds = [freeTrialEnd, freeMonthsEnd, promotionFreeEnd, feeExemptUntil]
      .filter((date) => date && date > now);
    const latestFreeEnd = freeEnds.length > 0
      ? new Date(Math.max(...freeEnds.map((date) => date.getTime())))
      : null;
    const isFree = subscription.isFeeExempt === true || latestFreeEnd !== null || !this.dailyBillingEnabled;
    const appliedDailyFeeCents = isFree ? 0 : dailyFeeCents;
    const driverName = String(
      driver.name ||
      `${driver.firstName || ''} ${driver.lastName || ''}`.trim()
    ).trim();

    return {
      id: driverId,
      driverId,
      driver: {
        id: driverId,
        name: driverName,
        email: driver.email || '',
        phone: driver.mobile || driver.phone || '',
        approved: driver.approved || false,
        joinDate: toIso(driver.createdAt)
      },
      subscription: {
        planType,
        status: subscriptionStatus,
        billingStatus,
        waveId: subscription.waveId || driver.subscription_wave_id || null,
        collectionMode: String(subscription.collectionMode || driver.subscription_collection_mode || 'withdrawal').toLowerCase(),
        dailyFeeCents: appliedDailyFeeCents,
        dailyFee: Number((appliedDailyFeeCents / 100).toFixed(2)),
        nominalDailyFeeCents: dailyFeeCents,
        nominalDailyFee: Number((dailyFeeCents / 100).toFixed(2)),
        dailyBillingEnabled: this.dailyBillingEnabled,
        dailyBillingSuspended: !this.dailyBillingEnabled,
        weeklyFeeCents,
        weeklyFee: Number((weeklyFeeCents / 100).toFixed(2)),
        pendingFeeCents,
        pendingFee: Number((pendingFeeCents / 100).toFixed(2)),
        isFree,
        freeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null,
        adminNotes: subscription.adminNotes || ''
      },
      currentPeriod: {
        paymentStatus,
        amount: Number((appliedDailyFeeCents / 100).toFixed(2)),
        amountCents: appliedDailyFeeCents,
        dueDate: null,
        daysOverdue: 0
      },
      financials: {
        totalPaid: '0.00',
        totalDue: Number((pendingFeeCents / 100).toFixed(2)).toFixed(2),
        outstandingBalance: Number((pendingFeeCents / 100).toFixed(2)).toFixed(2),
        paymentsCount: 0
      },
      lastPayment: subscription.lastPayment || null,
      source: 'rtdb_mirror',
      syncedAt: admin.firestore.FieldValue.serverTimestamp()
    };
  }

  async syncDriverSubscription(driverId, { db } = {}) {
    const realtimeDb = db || getRealtimeDB();
    const firestore = getFirestore();

    const [driverSnapshot, rawSubscriptionSnapshot, subscriptionSnapshot] = await Promise.all([
      realtimeDb.ref(`users/${driverId}`).once('value'),
      firestore.collection(RAW_COLLECTION).doc(driverId).get().catch(() => null),
      realtimeDb.ref(`subscriptions/${driverId}`).once('value')
    ]);

    if (!driverSnapshot.exists()) {
      await firestore.collection(COLLECTION).doc(driverId).delete().catch(() => {});
      return null;
    }

    const driver = driverSnapshot.val() || {};
    if (String(driver.usertype || driver.userType || '').toLowerCase() !== 'driver') {
      await firestore.collection(COLLECTION).doc(driverId).delete().catch(() => {});
      return null;
    }

    const subscription = rawSubscriptionSnapshot?.exists
      ? (rawSubscriptionSnapshot.data() || {})
      : (subscriptionSnapshot.val() || {});
    const row = this.buildRow(driverId, driver, subscription);
    await firestore.collection(COLLECTION).doc(driverId).set(row, { merge: true });
    return row;
  }

  async syncAllDriverSubscriptions({ db } = {}) {
    const realtimeDb = db || getRealtimeDB();
    const firestore = getFirestore();
    const [usersSnapshot, usersAltSnapshot, rawSubscriptionsSnapshot, subscriptionsSnapshot, existingReadModelSnapshot] = await Promise.all([
      realtimeDb.ref('users').orderByChild('usertype').equalTo('driver').once('value'),
      realtimeDb.ref('users').orderByChild('userType').equalTo('driver').once('value').catch(() => null),
      firestore.collection(RAW_COLLECTION).get().catch(() => null),
      realtimeDb.ref('subscriptions').once('value'),
      firestore.collection(COLLECTION).get().catch(() => null)
    ]);

    const users = {
      ...(usersSnapshot?.val() || {}),
      ...(usersAltSnapshot?.val() || {})
    };
    const rawSubscriptions = rawSubscriptionsSnapshot
      ? Object.fromEntries(rawSubscriptionsSnapshot.docs.map((doc) => [doc.id, doc.data() || {}]))
      : {};
    const subscriptions = subscriptionsSnapshot.val() || {};
    const existingReadModelDocIds = new Set(
      (existingReadModelSnapshot?.docs || []).map((doc) => doc.id)
    );
    const activeDriverIds = new Set();
    const rows = [];

    Object.keys(users).forEach((driverId) => {
      const driver = users[driverId] || {};
      const normalizedUserType = String(driver.usertype || driver.userType || '').toLowerCase();
      if (normalizedUserType !== 'driver') {
        return;
      }

      activeDriverIds.add(driverId);
      rows.push(this.buildRow(
        driverId,
        driver,
        rawSubscriptions[driverId] || subscriptions[driverId] || {}
      ));
    });
    const staleReadModelDocIds = Array.from(existingReadModelDocIds).filter((driverId) => !activeDriverIds.has(driverId));

    const batches = [];
    for (let index = 0; index < rows.length; index += 400) {
      const batch = firestore.batch();
      rows.slice(index, index + 400).forEach((row) => {
        batch.set(firestore.collection(COLLECTION).doc(row.driverId), row, { merge: true });
      });
      batches.push(batch.commit());
    }

    for (let index = 0; index < staleReadModelDocIds.length; index += 450) {
      const batch = firestore.batch();
      staleReadModelDocIds.slice(index, index + 450).forEach((driverId) => {
        batch.delete(firestore.collection(COLLECTION).doc(driverId));
      });
      batches.push(batch.commit());
    }

    await Promise.all(batches);
    logStructured('info', 'Espelho Firestore de subscriptions sincronizado', {
      service: 'driver-subscription-service',
      total: rows.length,
      staleRemoved: staleReadModelDocIds.length
    });

    return rows;
  }

  async ensureFreshMirror(maxAgeMs = this.readModelMaxAgeMs) {
    const firestore = getFirestore();
    const latestSnapshot = await firestore
      .collection(COLLECTION)
      .orderBy('syncedAt', 'desc')
      .limit(1)
      .get();

    if (latestSnapshot.empty) {
      return this.syncAllDriverSubscriptions({});
    }

    const latest = latestSnapshot.docs[0].data() || {};
    const syncedAt = latest.syncedAt?.toDate ? latest.syncedAt.toDate() : toDate(latest.syncedAt);
    if (!syncedAt || (Date.now() - syncedAt.getTime()) > maxAgeMs) {
      return this.syncAllDriverSubscriptions({});
    }

    return null;
  }

  async listDriverSubscriptions({ status, paymentStatus, page = 1, limit = 20 } = {}) {
    const firestore = getFirestore();
    await this.ensureFreshMirror();

    const snapshot = await firestore.collection(COLLECTION).get();
    let rows = snapshot.docs.map((doc) => doc.data() || {});

    if (status && status !== 'all') {
      rows = rows.filter((row) => row.subscription?.status === String(status).toLowerCase());
    }

    if (paymentStatus && paymentStatus !== 'all') {
      rows = rows.filter((row) => row.currentPeriod?.paymentStatus === String(paymentStatus).toLowerCase());
    }

    rows.sort((a, b) => {
      const order = { blocked: 0, overdue: 1, pending: 2, paid: 3 };
      return (order[a?.currentPeriod?.paymentStatus] ?? 99) - (order[b?.currentPeriod?.paymentStatus] ?? 99);
    });

    const totalCount = rows.length;
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 20, 500));
    const startIndex = (safePage - 1) * safeLimit;
    const paginated = rows.slice(startIndex, startIndex + safeLimit);

    return {
      subscriptions: paginated,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        pages: Math.ceil(totalCount / safeLimit)
      },
      summary: {
        total: totalCount,
        active: rows.filter((row) => row.subscription?.status === 'active').length,
        pending: rows.filter((row) => row.subscription?.status === 'pending').length,
        overdue: rows.filter((row) => row.currentPeriod?.paymentStatus === 'overdue').length,
        totalRevenue: rows.reduce((sum, row) => sum + toMoney(row?.financials?.totalPaid || 0), 0).toFixed(2),
        outstandingAmount: rows.reduce((sum, row) => sum + toMoney(row?.financials?.outstandingBalance || 0), 0).toFixed(2)
      }
    };
  }

  async getActiveSubscriptionMetrics() {
    const firestore = getFirestore();
    await this.ensureFreshMirror();

    const snapshot = await firestore.collection(COLLECTION).get();
    const rows = snapshot.docs.map((doc) => doc.data() || {});
    const stats = {
      totalActiveSubscriptions: 0,
      subscriptionsByPlan: {},
      totalWeeklyRevenue: 0,
      overdueSubscriptions: 0
    };

    rows.forEach((row) => {
      const isActive = row?.subscription?.status === 'active' || row?.subscription?.isFree === true;
      const planType = row?.subscription?.isFree === true && row?.subscription?.dailyFeeCents === 0 && row?.subscription?.freeUntil
        ? 'trial'
        : (row?.subscription?.planType || 'none');
      const weeklyFee = toMoney(row?.subscription?.weeklyFee || 0);

      if (row?.currentPeriod?.paymentStatus === 'overdue' || row?.subscription?.status === 'overdue') {
        stats.overdueSubscriptions += 1;
      }

      if (!isActive) return;

      stats.totalActiveSubscriptions += 1;
      stats.subscriptionsByPlan[planType] = (stats.subscriptionsByPlan[planType] || 0) + 1;
      stats.totalWeeklyRevenue += weeklyFee;
    });

    return stats;
  }
}

module.exports = new DriverSubscriptionService();
