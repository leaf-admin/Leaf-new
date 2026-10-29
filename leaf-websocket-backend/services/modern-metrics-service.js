const projectionStore = require('./metrics-projection-store');
const projectionSummary = require('./metrics-projection-summary');
const admin = require('firebase-admin');
const readBudget = require('../utils/metrics-read-budget');
const redisPool = require('../utils/redis-pool');
const {
  countActiveRidesFromActiveHash,
  isRideRevenuePendingFinalSnapshot,
  resolveRideOperationalFee,
  resolveRideRevenue
} = require('./dashboard-ride-monitoring-service');

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (_) {
  firebaseConfig = null;
}

const COMPLETED_STATUSES = new Set(['COMPLETE', 'COMPLETED', 'PAID', 'completed']);
const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'cancelled', 'canceled']);
const USER_METRICS_RECENT_FALLBACK_LIMIT = Math.max(
  100,
  Number.parseInt(process.env.DASHBOARD_USER_METRICS_RECENT_FALLBACK_LIMIT || '1000', 10)
);

function getFirestore() {
  if (firebaseConfig && firebaseConfig.getFirestore) {
    return firebaseConfig.getFirestore();
  }

  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  return null;
}

function toNumber(value, fallback = 0) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseTimestamp(value) {
  if (!value) return null;

  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'object' && Number.isFinite(value._seconds)) {
    const nanos = Number.isFinite(value._nanoseconds) ? value._nanoseconds : 0;
    return value._seconds * 1000 + Math.floor(nanos / 1e6);
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && value.trim() !== '') {
      return asNum > 10_000_000_000 ? asNum : asNum * 1000;
    }

    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseObjectSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function pickFirstTimestamp(...values) {
  for (const value of values) {
    const ts = parseTimestamp(value);
    if (Number.isFinite(ts)) {
      return ts;
    }
  }
  return null;
}

function getWindow(period = 'today', startDate, endDate) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (period === 'custom' && startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
  } else if (period === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === 'week') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === '30d') {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (period === '7d') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

function inWindow(value, start, end) {
  const ts = parseTimestamp(value);
  if (!Number.isFinite(ts)) return false;
  return ts >= start.getTime() && ts <= end.getTime();
}

function toSaoPauloDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function getRideRevenue(ride) {
  return resolveRideRevenue(ride);
}

function getRideOperationalFee(ride) {
  return resolveRideOperationalFee(ride);
}

function roundMoney(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

async function getActiveRidesCount() {
  const redis = redisPool.getConnection();

  try {
    const activeHash = await readBudget.activeRideHash(redis);
    if (activeHash && typeof activeHash === 'object' && Object.keys(activeHash).length > 0) {
      return countActiveRidesFromActiveHash(activeHash);
    }
  } catch (error) { return null; }

  try {
    const activeSetCount = await redis.scard('active_bookings');
    if (Number.isFinite(activeSetCount)) {
      return activeSetCount;
    }
  } catch (_) {}

  throw readBudget.unavailable();
}

async function getReserveFundLosses() {
  const redis = redisPool.getConnection();

  try {
    const costStr = await redis.hget('metrics:financial', 'assumed_cancellation_costs');
    return costStr ? toNumber(costStr) : 0;
  } catch (_) {
    return null;
  }
}

async function runCountAggregate(query, fallback = 0) {
  try {
    const snapshot = await query.limit(10001).count().get();
    if (Number(snapshot?.data?.().count) > 10000) return null;
    return Number(snapshot?.data?.().count || 0);
  } catch (error) {
    console.warn('[modern-metrics-service] Firestore count aggregate failed:', error?.message || error);
    return fallback;
  }
}

async function countUsersByType(usersCollection, userType) {
  const primary = await runCountAggregate(usersCollection.where('usertype', '==', userType), null);
  if (primary !== null && primary > 0) return primary;

  const secondary = await runCountAggregate(usersCollection.where('userType', '==', userType), null);
  if (primary !== null && secondary !== null) {
    return Math.max(primary, secondary);
  }

  throw readBudget.unavailable();
}

async function countRecentUsersByType(usersCollection, userType, startIso) {
  const primary = await runCountAggregate(
    usersCollection.where('usertype', '==', userType).where('createdAt', '>=', startIso),
    null
  );
  if (primary !== null && primary > 0) return primary;

  const secondary = await runCountAggregate(
    usersCollection.where('userType', '==', userType).where('createdAt', '>=', startIso),
    null
  );
  if (primary !== null && secondary !== null) {
    return Math.max(primary, secondary);
  }

  try {
    const snapshot = await usersCollection
      .where('createdAt', '>=', startIso)
      .limit(Math.min(2000, USER_METRICS_RECENT_FALLBACK_LIMIT) + 1)
      .get();
    readBudget.assertPayload(snapshot.docs.map(doc => doc.data()), snapshot.docs.length, Math.min(2000, USER_METRICS_RECENT_FALLBACK_LIMIT));
    return snapshot.docs.reduce((count, doc) => {
      const raw = doc.data() || {};
      const type = String(raw.usertype || raw.userType || raw.role || '').trim().toLowerCase();
      return type === userType ? count + 1 : count;
    }, 0);
  } catch (error) {
    console.warn('[modern-metrics-service] Firestore recent users fallback failed:', error?.message || error);
    throw readBudget.unavailable();
  }
}

class ModernMetricsService {
  async getProjectedWindow(params = {}, kind = 'ride') {
    if (process.env.ENABLE_OPS_METRIC_READS !== 'true') return null;
    const firestore = getFirestore();
    if (!firestore) throw readBudget.unavailable();
    const window = projectionSummary.calendarWindow(params.period, params.startDate, params.endDate);
    const { metrics, ...metadata } = await projectionStore.readDays(firestore, kind, window.start, window.end);
    return { metrics, metadata: { ...metadata, calendarAligned: true }, ...window };
  }

  async getActiveRidesCount() { return getActiveRidesCount(); }
  async getRidesForWindow({ period = 'today', startDate, endDate } = {}) {
    const firestore = getFirestore();
    if (!firestore) throw readBudget.unavailable();

    const { start, end } = getWindow(period, startDate, endDate);
    const snapshot = await readBudget.firestoreSnapshot(firestore
      .collection('rides')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end));

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  // Last `days` calendar days (São Paulo), one row per day, oldest first:
  // requests, completed, cancelled and GMV of completed rides. One bounded read.
  async getRidesDailySeries({ days = 14, now = new Date() } = {}) {
    const span = Math.min(31, Math.max(1, Number.parseInt(days, 10) || 14));
    const keys = [];
    for (let offset = span - 1; offset >= 0; offset -= 1) {
      keys.push(toSaoPauloDateKey(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)));
    }
    const start = new Date(`${keys[0]}T00:00:00-03:00`);
    const end = new Date(`${keys[keys.length - 1]}T23:59:59.999-03:00`);
    const firestore = getFirestore();
    if (!firestore) throw readBudget.unavailable();
    const snapshot = await readBudget.firestoreSnapshot(firestore
      .collection('rides')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end));

    const rows = new Map(keys.map((date) => [date, { date, requests: 0, completed: 0, cancelled: 0, gmv: 0 }]));
    snapshot.docs.forEach((doc) => {
      const ride = doc.data() || {};
      const createdAt = pickFirstTimestamp(ride.createdAt, ride.tripdate, ride.timestamp);
      const row = Number.isFinite(createdAt) ? rows.get(toSaoPauloDateKey(new Date(createdAt))) : null;
      if (!row) return;
      row.requests += 1;
      if (COMPLETED_STATUSES.has(ride.status)) {
        row.completed += 1;
        row.gmv += getRideRevenue(ride);
      } else if (CANCELLED_STATUSES.has(ride.status)) {
        row.cancelled += 1;
      }
    });
    return {
      days: [...rows.values()].map((row) => ({ ...row, gmv: roundMoney(row.gmv) })),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      timeZone: 'America/Sao_Paulo'
    };
  }

  async getRidesDailyStats() {
    const projected = await this.getProjectedWindow({ period: 'today' });
    if (projected) {
      const m = projected.metrics;
      const average = key => m[`${key}Count`] ? Number((m[`${key}Ms`] / m[`${key}Count`] / 60000).toFixed(2)) : null;
      return { totalToday: m.requests || 0, completedToday: m.completed || 0,
        cancelledAfterAcceptance: m.cancelledAccepted || 0,
        cancellationRate: m.accepted ? Number(((m.cancelledAccepted || 0) / m.accepted * 100).toFixed(2)) : 0,
        activeRides: await getActiveRidesCount(), averageWaitMinutes: average('wait'), averagePickupMinutes: average('pickup'),
        averagePaymentApprovalToPickupMinutes: average('paidPickup'), metadata: projected.metadata };
    }
    const rides = await this.getRidesForWindow({ period: 'today' });
    const normalizedRides = rides.map((ride) => {
      const paymentData = parseObjectSafe(ride.paymentData);
      const payment = parseObjectSafe(ride.payment);

      return {
        ...ride,
        requestTs: pickFirstTimestamp(ride.createdAt, ride.tripdate, ride.timestamp, ride.activatedAt),
        acceptTs: pickFirstTimestamp(ride.acceptedAt, ride.driverAcceptedAt, ride.matchedAt),
        arrivedTs: pickFirstTimestamp(ride.driverArrivedAt, ride.arrivedAt, ride.pickupArrivedAt),
        paymentConfirmedTs: pickFirstTimestamp(
          ride.paymentConfirmedAt,
          ride.paymentApprovedAt,
          ride.confirmedAt,
          paymentData?.confirmedAt,
          payment?.confirmedAt
        )
      };
    });

    const totalToday = normalizedRides.length;
    const completedToday = normalizedRides.filter((ride) => COMPLETED_STATUSES.has(ride.status)).length;
    const cancelledAfterAcceptance = normalizedRides.filter((ride) => {
      if (!CANCELLED_STATUSES.has(ride.status)) return false;
      return Boolean(ride.driverId);
    }).length;

    const acceptedToday = normalizedRides.filter((ride) => Boolean(ride.driverId)).length;
    const activeRides = await getActiveRidesCount();
    const waitSamplesMin = normalizedRides
      .filter((ride) => Number.isFinite(ride.requestTs) && Number.isFinite(ride.acceptTs) && ride.acceptTs >= ride.requestTs)
      .map((ride) => (ride.acceptTs - ride.requestTs) / (1000 * 60));
    const pickupSamplesMin = normalizedRides
      .filter((ride) => Number.isFinite(ride.acceptTs) && Number.isFinite(ride.arrivedTs) && ride.arrivedTs >= ride.acceptTs)
      .map((ride) => (ride.arrivedTs - ride.acceptTs) / (1000 * 60));
    const paymentApprovalToPickupSamplesMin = normalizedRides
      .filter((ride) => Number.isFinite(ride.paymentConfirmedTs) && Number.isFinite(ride.arrivedTs) && ride.arrivedTs >= ride.paymentConfirmedTs)
      .map((ride) => (ride.arrivedTs - ride.paymentConfirmedTs) / (1000 * 60));

    const averageWaitMinutes = waitSamplesMin.length
      ? Number((waitSamplesMin.reduce((sum, value) => sum + value, 0) / waitSamplesMin.length).toFixed(2))
      : null;
    const averagePickupMinutes = pickupSamplesMin.length
      ? Number((pickupSamplesMin.reduce((sum, value) => sum + value, 0) / pickupSamplesMin.length).toFixed(2))
      : null;
    const averagePaymentApprovalToPickupMinutes = paymentApprovalToPickupSamplesMin.length
      ? Number((paymentApprovalToPickupSamplesMin.reduce((sum, value) => sum + value, 0) / paymentApprovalToPickupSamplesMin.length).toFixed(2))
      : null;

    return {
      totalToday,
      completedToday,
      cancelledAfterAcceptance,
      cancellationRate: acceptedToday > 0
        ? Number(((cancelledAfterAcceptance / acceptedToday) * 100).toFixed(2))
        : 0,
      activeRides,
      averageWaitMinutes,
      averagePickupMinutes,
      averagePaymentApprovalToPickupMinutes
    };
  }

  async getUsersStatusStats() {
    const firestore = getFirestore();
    if (!firestore) throw readBudget.unavailable();

    const usersCollection = firestore.collection('users');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const redis = redisPool.getConnection();
    const [onlineUsersSet, onlineDriversSet] = await Promise.all([
      redis.scard('online_users'),
      redis.scard('online_drivers')
    ]);

    const onlineUsers = Number(onlineUsersSet);
    const onlineDrivers = Number(onlineDriversSet);
    if (![onlineUsers, onlineDrivers].every(Number.isSafeInteger)) throw readBudget.unavailable();
    const [
      customersTotal,
      driversTotal,
      newCustomersToday,
      newDriversToday
    ] = await Promise.all([
      countUsersByType(usersCollection, 'customer'),
      countUsersByType(usersCollection, 'driver'),
      countRecentUsersByType(usersCollection, 'customer', todayIso),
      countRecentUsersByType(usersCollection, 'driver', todayIso)
    ]);

    const driversOnline = Math.min(driversTotal, onlineDrivers);
    const customersOnline = Math.min(
      customersTotal,
      Math.max(0, (onlineUsers) - driversOnline)
    );

    return {
      customers: {
        total: customersTotal,
        online: customersOnline,
        offline: Math.max(0, customersTotal - customersOnline)
      },
      drivers: {
        total: driversTotal,
        online: driversOnline,
        offline: Math.max(0, driversTotal - driversOnline)
      },
      newCustomersToday,
      newDriversToday
    };
  }

  async getFinancialRidesStats({ period = 'today', startDate, endDate } = {}) {
    const projected = await this.getProjectedWindow({ period, startDate, endDate });
    if (projected) {
      const m = projected.metrics; const totalValue = roundMoney((m.revenueUnits || 0) / 1000000);
      return { totalValue, totalRides: m.completed || 0, reconciledRides: m.reconciled || 0,
        pendingReconciliationRides: (m.completed || 0) - (m.reconciled || 0),
        averageValue: m.reconciled ? Number((totalValue / m.reconciled).toFixed(2)) : 0,
        reserveFundLosses: await getReserveFundLosses(), period,
        startDate: projected.start.toISOString(), endDate: projected.end.toISOString(), metadata: projected.metadata };
    }
    const rides = await this.getRidesForWindow({ period, startDate, endDate });
    const { start, end } = getWindow(period, startDate, endDate);
    const completedRides = rides.filter((ride) => COMPLETED_STATUSES.has(ride.status));
    const reconciledCompletedRides = completedRides.filter(
      (ride) => !isRideRevenuePendingFinalSnapshot(ride)
    );
    const totalValue = roundMoney(
      completedRides.reduce((sum, ride) => sum + getRideRevenue(ride), 0)
    );
    const totalRides = completedRides.length;
    const reconciledRides = reconciledCompletedRides.length;

    return {
      totalValue,
      totalRides,
      reconciledRides,
      pendingReconciliationRides: totalRides - reconciledRides,
      averageValue: reconciledRides > 0 ? Number((totalValue / reconciledRides).toFixed(2)) : 0,
      reserveFundLosses: await getReserveFundLosses(),
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }

  async getOperationalFeeStats({ period = 'today', startDate, endDate } = {}) {
    let projected = await this.getProjectedWindow({ period, startDate, endDate }, 'distribution');
    if (projected) {
      const fromDistributions = Boolean(projected.metrics.distributions);
      if (!fromDistributions) projected = await this.getProjectedWindow({ period, startDate, endDate });
      const m = projected.metrics;
      const totalRides = fromDistributions ? m.distributions : m.completed || 0;
      const reconciledRides = fromDistributions ? totalRides : m.reconciled || 0;
      const totalOperationalFee = roundMoney((m.feeUnits || 0) / 1000000);
      return { totalOperationalFee, totalRides, reconciledRides, pendingReconciliationRides: totalRides - reconciledRides,
        averageFee: reconciledRides ? Number((totalOperationalFee / reconciledRides).toFixed(2)) : 0, period,
        startDate: projected.start.toISOString(), endDate: projected.end.toISOString(), metadata: projected.metadata };
    }
    const firestore = getFirestore();
    if (!firestore) throw readBudget.unavailable();

    const { start, end } = getWindow(period, startDate, endDate);
    const distributionSnapshot = await readBudget.firestoreSnapshot(firestore
      .collection('payment_distributions')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end));

    let totalOperationalFee = 0;
    let totalRides = 0;

    if (!distributionSnapshot.empty) {
      distributionSnapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        totalRides += 1;
        totalOperationalFee +=
          toNumber(data?.retainedFees?.operationalFee) / 100 ||
          toNumber(data?.calculation?.operationalFee) / 100;
      });
    } else {
      const rides = await this.getRidesForWindow({ period, startDate, endDate });
      const completedRides = rides.filter((ride) => COMPLETED_STATUSES.has(ride.status));
      const reconciledCompletedRides = completedRides.filter(
        (ride) => !isRideRevenuePendingFinalSnapshot(ride)
      );
      totalRides = completedRides.length;
      totalOperationalFee = completedRides.reduce((sum, ride) => sum + getRideOperationalFee(ride), 0);
      return {
        totalOperationalFee: roundMoney(totalOperationalFee),
        totalRides,
        reconciledRides: reconciledCompletedRides.length,
        pendingReconciliationRides: totalRides - reconciledCompletedRides.length,
        averageFee: reconciledCompletedRides.length > 0
          ? Number((totalOperationalFee / reconciledCompletedRides.length).toFixed(2))
          : 0,
        period,
        startDate: start.toISOString(),
        endDate: end.toISOString()
      };
    }

    return {
      totalOperationalFee: roundMoney(totalOperationalFee),
      totalRides,
      reconciledRides: totalRides,
      pendingReconciliationRides: 0,
      averageFee: totalRides > 0 ? Number((totalOperationalFee / totalRides).toFixed(2)) : 0,
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }

  async getRidesStats({ period = 'today', startDate, endDate } = {}) {
    const projected = await this.getProjectedWindow({ period, startDate, endDate });
    if (projected) {
      const m = projected.metrics; const totalValue = roundMoney((m.revenueUnits || 0) / 1000000);
      return { totalRides: m.requests || 0, activeRides: await getActiveRidesCount(),
        completedToday: period === 'today' ? m.completed || 0 : 0, totalValue,
        averageValue: m.reconciled ? Number((totalValue / m.reconciled).toFixed(2)) : 0,
        reconciledRides: m.reconciled || 0, pendingReconciliationRides: (m.completed || 0) - (m.reconciled || 0),
        reserveFundLosses: await getReserveFundLosses(), growthRate: 0, metadata: projected.metadata };
    }
    const rides = await this.getRidesForWindow({ period, startDate, endDate });
    const completedRides = rides.filter((ride) => COMPLETED_STATUSES.has(ride.status));
    const reconciledCompletedRides = completedRides.filter(
      (ride) => !isRideRevenuePendingFinalSnapshot(ride)
    );
    const totalValue = roundMoney(
      completedRides.reduce((sum, ride) => sum + getRideRevenue(ride), 0)
    );

    return {
      totalRides: rides.length,
      activeRides: await getActiveRidesCount(),
      completedToday: period === 'today' ? completedRides.length : 0,
      averageValue: reconciledCompletedRides.length > 0
        ? Number((totalValue / reconciledCompletedRides.length).toFixed(2))
        : 0,
      totalValue,
      reconciledRides: reconciledCompletedRides.length,
      pendingReconciliationRides: completedRides.length - reconciledCompletedRides.length,
      reserveFundLosses: await getReserveFundLosses(),
      growthRate: 0
    };
  }
}

module.exports = new ModernMetricsService();
