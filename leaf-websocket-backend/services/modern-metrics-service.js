const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const {
  countActiveRidesFromActiveHash
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

function getRideRevenue(ride) {
  return toNumber(
    ride?.finalPrice,
    toNumber(
      ride?.estimatedFare,
      toNumber(ride?.financialBreakdown?.totalAmount) / 100
    )
  );
}

function getRideOperationalFee(ride) {
  const cents = toNumber(ride?.financialBreakdown?.operationalFee);
  if (cents > 0) {
    return cents / 100;
  }

  return Math.max(0, toNumber(ride?.finalPrice) - toNumber(ride?.driverEarnings || ride?.netFare));
}

function roundMoney(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

async function getActiveRidesCount() {
  const redis = redisPool.getConnection();

  try {
    const activeHash = await redis.hgetall('bookings:active');
    if (activeHash && typeof activeHash === 'object' && Object.keys(activeHash).length > 0) {
      return countActiveRidesFromActiveHash(activeHash);
    }
  } catch (_) {}

  try {
    const activeSetCount = await redis.scard('active_bookings');
    if (Number.isFinite(activeSetCount)) {
      return activeSetCount;
    }
  } catch (_) {}

  return 0;
}

async function getReserveFundLosses() {
  const redis = redisPool.getConnection();

  try {
    const costStr = await redis.hget('metrics:financial', 'assumed_cancellation_costs');
    return costStr ? toNumber(costStr) : 0;
  } catch (_) {
    return 0;
  }
}

async function runCountAggregate(query, fallback = 0) {
  try {
    const snapshot = await query.count().get();
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
  if (secondary !== null) {
    return Math.max(Number(primary || 0), secondary);
  }

  return Math.max(Number(primary || 0), 0);
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
  if (secondary !== null) {
    return Math.max(Number(primary || 0), secondary);
  }

  try {
    const snapshot = await usersCollection
      .where('createdAt', '>=', startIso)
      .limit(USER_METRICS_RECENT_FALLBACK_LIMIT)
      .get();
    return snapshot.docs.reduce((count, doc) => {
      const raw = doc.data() || {};
      const type = String(raw.usertype || raw.userType || raw.role || '').trim().toLowerCase();
      return type === userType ? count + 1 : count;
    }, 0);
  } catch (error) {
    console.warn('[modern-metrics-service] Firestore recent users fallback failed:', error?.message || error);
    return Math.max(Number(primary || 0), 0);
  }
}

class ModernMetricsService {
  async getRidesForWindow({ period = 'today', startDate, endDate } = {}) {
    const firestore = getFirestore();
    if (!firestore) return [];

    const { start, end } = getWindow(period, startDate, endDate);
    const snapshot = await firestore
      .collection('rides')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async getRidesDailyStats() {
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
    if (!firestore) {
      return {
        customers: { total: 0, online: 0, offline: 0 },
        drivers: { total: 0, online: 0, offline: 0 },
        newCustomersToday: 0,
        newDriversToday: 0
      };
    }

    const usersCollection = firestore.collection('users');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const redis = redisPool.getConnection();
    const [onlineUsersSet, onlineDriversSet] = await Promise.all([
      redis.smembers('online_users').catch(() => []),
      redis.smembers('online_drivers').catch(() => [])
    ]);

    const onlineUsers = new Set(onlineUsersSet || []);
    const onlineDrivers = new Set(onlineDriversSet || []);
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

    const driversOnline = Math.min(driversTotal, onlineDrivers.size || 0);
    const customersOnline = Math.min(
      customersTotal,
      Math.max(0, (onlineUsers.size || 0) - driversOnline)
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
    const rides = await this.getRidesForWindow({ period, startDate, endDate });
    const { start, end } = getWindow(period, startDate, endDate);
    const completedRides = rides.filter((ride) => COMPLETED_STATUSES.has(ride.status));
    const totalValue = roundMoney(
      completedRides.reduce((sum, ride) => sum + getRideRevenue(ride), 0)
    );
    const totalRides = completedRides.length;

    return {
      totalValue,
      totalRides,
      averageValue: totalRides > 0 ? Number((totalValue / totalRides).toFixed(2)) : 0,
      reserveFundLosses: await getReserveFundLosses(),
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }

  async getOperationalFeeStats({ period = 'today', startDate, endDate } = {}) {
    const firestore = getFirestore();
    if (!firestore) {
      return {
        totalOperationalFee: 0,
        totalRides: 0,
        averageFee: 0,
        period,
        startDate: null,
        endDate: null
      };
    }

    const { start, end } = getWindow(period, startDate, endDate);
    const distributionSnapshot = await firestore
      .collection('payment_distributions')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

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
      totalRides = completedRides.length;
      totalOperationalFee = completedRides.reduce((sum, ride) => sum + getRideOperationalFee(ride), 0);
    }

    return {
      totalOperationalFee: roundMoney(totalOperationalFee),
      totalRides,
      averageFee: totalRides > 0 ? Number((totalOperationalFee / totalRides).toFixed(2)) : 0,
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }

  async getRidesStats({ period = 'today', startDate, endDate } = {}) {
    const rides = await this.getRidesForWindow({ period, startDate, endDate });
    const completedRides = rides.filter((ride) => COMPLETED_STATUSES.has(ride.status));
    const totalValue = roundMoney(
      completedRides.reduce((sum, ride) => sum + getRideRevenue(ride), 0)
    );

    return {
      totalRides: rides.length,
      activeRides: await getActiveRidesCount(),
      completedToday: period === 'today' ? completedRides.length : 0,
      averageValue: completedRides.length > 0 ? Number((totalValue / completedRides.length).toFixed(2)) : 0,
      totalValue,
      reserveFundLosses: await getReserveFundLosses(),
      growthRate: 0
    };
  }
}

module.exports = new ModernMetricsService();
