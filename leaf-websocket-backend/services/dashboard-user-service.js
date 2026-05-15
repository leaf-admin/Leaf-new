const admin = require('firebase-admin');
const { logError } = require('../utils/logger');

const USER_STATS_CACHE_TTL_MS = Math.max(
  15000,
  Number.parseInt(process.env.DASHBOARD_USER_STATS_CACHE_TTL_MS || '60000', 10)
);
const USERS_LIST_MAX_LIMIT = Math.max(
  20,
  Number.parseInt(process.env.DASHBOARD_USERS_LIST_MAX_LIMIT || '100', 10)
);
const USER_STATS_RECENT_FALLBACK_LIMIT = Math.max(
  100,
  Number.parseInt(process.env.DASHBOARD_USER_STATS_RECENT_FALLBACK_LIMIT || '1000', 10)
);

let userStatsCache = new Map();

function resetUsersCache() {
  userStatsCache = new Map();
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }
  if (typeof value === 'number') {
    const normalized = value > 1e12 ? value : value * 1000;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
}

function normalizeStatus(raw = {}, userType = 'customer') {
  if (raw.kycBlocked === true) return 'blocked';
  const explicitStatus = String(raw.status || '').trim().toLowerCase();
  if (explicitStatus) return explicitStatus;
  if (userType === 'driver') {
    return raw.approved === true ? 'approved' : 'pending';
  }
  return raw.approved === false ? 'inactive' : 'active';
}

function normalizeName(raw = {}) {
  const direct = String(raw.name || raw.displayName || '').trim();
  if (direct) return direct;
  return `${raw.firstName || ''} ${raw.lastName || ''}`.trim();
}

function normalizePhone(raw = {}) {
  return String(raw.mobile || raw.phone || raw.phoneNumber || '').trim();
}

function normalizeUserType(raw = {}) {
  return String(raw.usertype || raw.userType || raw.role || 'customer').trim().toLowerCase();
}

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizeUserTypeParam(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return null;
  if (normalized === 'passenger' || normalized === 'rider' || normalized === 'cliente') return 'customer';
  if (normalized === 'motorista') return 'driver';
  return normalized;
}

function normalizeStatusParam(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && normalized !== 'all' ? normalized : null;
}

function parseDateRange(dateRange) {
  if (!dateRange) return {};
  const [startRaw, endRaw] = String(dateRange).split(',');
  const start = startRaw ? new Date(startRaw) : null;
  const end = endRaw ? new Date(endRaw) : null;
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null
  };
}

function getPeriodStart(period = '24h') {
  const now = Date.now();
  if (period === '3d') return new Date(now - (3 * 24 * 60 * 60 * 1000));
  if (period === 'week') return new Date(now - (7 * 24 * 60 * 60 * 1000));
  if (period === 'month') return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  return new Date(now - (24 * 60 * 60 * 1000));
}

function getTodayStart() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return todayStart;
}

async function runCountAggregate(query, context = {}) {
  try {
    const snapshot = await query.count().get();
    return Number(snapshot?.data?.().count || 0);
  } catch (error) {
    logError(error, 'Erro ao executar count agregado de usuarios do dashboard', {
      service: 'dashboard-user-service',
      ...context
    });
    return Object.prototype.hasOwnProperty.call(context, 'fallback') ? context.fallback : 0;
  }
}

function buildBaseUsersQuery(params = {}) {
  const firestore = admin.firestore();
  let query = firestore.collection('users');
  const safeType = normalizeUserTypeParam(params.type);
  const { start, end } = parseDateRange(params.dateRange);

  if (safeType) {
    query = query.where('usertype', '==', safeType);
  }

  if (start) {
    query = query.where('createdAt', '>=', start.toISOString());
  }

  if (end) {
    query = query.where('createdAt', '<=', end.toISOString());
  }

  return query;
}

function normalizeUserRecord(doc) {
  const raw = doc.data() || {};
  const type = normalizeUserType(raw);
  const registrationDate = toIsoString(raw.createdAt);
  const lastActivity = toIsoString(raw.lastLogin || raw.updatedAt || raw.lastSeenAt);
  const ratingValue = Number.parseFloat(raw.driverRating || raw.rating);

  return {
    id: doc.id,
    uid: doc.id,
    name: normalizeName(raw),
    displayName: String(raw.displayName || '').trim(),
    email: String(raw.email || '').trim(),
    phone: normalizePhone(raw),
    mobile: normalizePhone(raw),
    phoneNumber: normalizePhone(raw),
    type,
    usertype: type,
    status: normalizeStatus(raw, type),
    registrationDate,
    lastActivity,
    totalTrips: Number(raw.totalTrips || 0),
    completedTrips: Number(raw.completedTrips || 0),
    totalSpent: Number(raw.totalSpent || 0).toFixed(2),
    totalEarned: Number(raw.totalEarned || 0).toFixed(2),
    rating: Number.isFinite(ratingValue) ? ratingValue.toFixed(1) : '0.0',
    location: {
      city: String(raw.city || '').trim(),
      state: String(raw.state || '').trim()
    },
    city: String(raw.city || '').trim(),
    state: String(raw.state || '').trim(),
    profileImage: String(raw.profile_image || raw.profileImage || '').trim(),
    referralCode: String(raw.referralId || raw.referralCode || '').trim(),
    walletBalance: Number(raw.walletBalance || 0).toFixed(2),
    vehicleInfo: String(
      raw.carType || raw.vehicleCategory || raw.vehicles?.current?.category || ''
    ).trim(),
    approved: raw.approved === true,
    raw
  };
}

async function searchUsersByExactFields(params = {}) {
  const firestore = admin.firestore();
  const collection = firestore.collection('users');
  const safeLimit = parsePositiveInt(params.limit, 50, USERS_LIST_MAX_LIMIT);
  const term = String(params.searchTerm || '').trim();
  if (!term) {
    return null;
  }

  const byId = new Map();
  const addSnapshotDocs = (snapshot) => {
    if (!snapshot) return;
    if (typeof snapshot.exists === 'boolean') {
      if (snapshot.exists) byId.set(snapshot.id, normalizeUserRecord(snapshot));
      return;
    }
    (snapshot.docs || []).forEach((doc) => {
      if (byId.size < safeLimit) byId.set(doc.id, normalizeUserRecord(doc));
    });
  };

  const tasks = [
    collection.doc(term).get(),
    collection.where('email', '==', term).limit(safeLimit).get(),
    collection.where('mobile', '==', term).limit(safeLimit).get(),
    collection.where('phone', '==', term).limit(safeLimit).get(),
    collection.where('phoneNumber', '==', term).limit(safeLimit).get()
  ];

  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === 'fulfilled') addSnapshotDocs(result.value);
  });

  const rows = applyUserFilters(Array.from(byId.values()), {
    ...params,
    searchTerm: null
  }).slice(0, safeLimit);

  return {
    users: rows,
    pagination: {
      page: 1,
      limit: safeLimit,
      total: rows.length,
      pages: rows.length > 0 ? 1 : 0,
      searchMode: 'exact'
    }
  };
}

function applyUserFilters(users, params = {}) {
  const {
    type,
    status,
    dateRange,
    searchTerm,
    sortBy = 'registrationDate',
    sortOrder = 'desc'
  } = params;

  let rows = [...users];

  if (type && type !== 'all') {
    const safeType = String(type).toLowerCase();
    rows = rows.filter((user) => user.type === safeType);
  }

  if (status && status !== 'all') {
    const safeStatus = String(status).toLowerCase();
    rows = rows.filter((user) => String(user.status || '').toLowerCase() === safeStatus);
  }

  if (searchTerm) {
    const needle = String(searchTerm).trim().toLowerCase();
    rows = rows.filter((user) => [
      user.id,
      user.name,
      user.email,
      user.phone,
      user.city,
      user.state
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }

  if (dateRange) {
    const [start, end] = String(dateRange).split(',');
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    rows = rows.filter((user) => {
      const iso = user.registrationDate;
      if (!iso) return false;
      const current = new Date(iso);
      if (Number.isNaN(current.getTime())) return false;
      if (startDate && current < startDate) return false;
      if (endDate && current > endDate) return false;
      return true;
    });
  }

  const direction = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const key = String(sortBy || 'registrationDate');
    const aVal = a[key] ?? a.raw?.[key] ?? null;
    const bVal = b[key] ?? b.raw?.[key] ?? null;

    if (key === 'registrationDate' || key === 'lastActivity' || key === 'createdAt' || key === 'updatedAt') {
      const aTs = aVal ? new Date(aVal).getTime() : 0;
      const bTs = bVal ? new Date(bVal).getTime() : 0;
      return (aTs - bTs) * direction;
    }

    if (key === 'rating' || key === 'totalTrips' || key === 'completedTrips') {
      return ((Number(aVal) || 0) - (Number(bVal) || 0)) * direction;
    }

    return String(aVal || '').localeCompare(String(bVal || '')) * direction;
  });

  return rows;
}

async function listUsers(params = {}) {
  const {
    page = 1,
    limit = 50
  } = params;

  if (params.searchTerm) {
    const exactSearch = await searchUsersByExactFields(params);
    if (exactSearch) return exactSearch;
  }

  const safePage = parsePositiveInt(page, 1);
  const safeLimit = parsePositiveInt(limit, 50, USERS_LIST_MAX_LIMIT);
  const start = (safePage - 1) * safeLimit;
  const safeStatus = normalizeStatusParam(params.status);
  const queryBase = buildBaseUsersQuery(params);
  let query = queryBase;

  if (start > 0) {
    query = query.offset(start);
  }
  query = query.limit(safeLimit);

  const snapshot = await query.get();
  let rows = snapshot.docs.map(normalizeUserRecord);

  if (safeStatus) {
    rows = rows.filter((user) => String(user.status || '').toLowerCase() === safeStatus);
  }

  const canUseAggregateTotal = !safeStatus;
  const total = canUseAggregateTotal
    ? await runCountAggregate(queryBase, { source: 'listUsers' })
    : start + rows.length;

  return {
    users: rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
      maxLimit: USERS_LIST_MAX_LIMIT,
      totalMode: canUseAggregateTotal ? 'aggregate' : 'page-estimate'
    }
  };
}

async function countUsersByType(collection, userType, context = {}) {
  const primary = await runCountAggregate(
    collection.where('usertype', '==', userType),
    { ...context, field: 'usertype', userType }
  );
  if (primary > 0) return primary;

  return runCountAggregate(
    collection.where('userType', '==', userType),
    { ...context, field: 'userType', userType }
  );
}

async function countNewUsersByType(collection, userType, startIso, context = {}) {
  const primary = await runCountAggregate(
    collection.where('usertype', '==', userType).where('createdAt', '>=', startIso),
    { ...context, field: 'usertype', userType, createdAt: 'gte', fallback: null }
  );
  if (primary !== null && primary > 0) return primary;

  const secondary = await runCountAggregate(
    collection.where('userType', '==', userType).where('createdAt', '>=', startIso),
    { ...context, field: 'userType', userType, createdAt: 'gte', fallback: null }
  );
  if (secondary !== null) {
    return Math.max(Number(primary || 0), secondary);
  }

  try {
    const snapshot = await collection
      .where('createdAt', '>=', startIso)
      .limit(USER_STATS_RECENT_FALLBACK_LIMIT)
      .get();
    return snapshot.docs.reduce((count, doc) => {
      const type = normalizeUserType(doc.data() || {});
      return type === userType ? count + 1 : count;
    }, 0);
  } catch (error) {
    logError(error, 'Erro no fallback limitado de usuarios recentes do dashboard', {
      service: 'dashboard-user-service',
      ...context,
      userType,
      limit: USER_STATS_RECENT_FALLBACK_LIMIT
    });
    return Math.max(Number(primary || 0), 0);
  }
}

async function getUserStats(redis, options = {}) {
  const period = String(options.period || '24h');
  const cacheKey = `period:${period}`;
  const cached = userStatsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < USER_STATS_CACHE_TTL_MS) {
    return cached.payload;
  }

  const firestore = admin.firestore();
  const collection = firestore.collection('users');
  const now = Date.now();
  const todayStart = getTodayStart();
  const weekStart = new Date(now - (7 * 24 * 60 * 60 * 1000));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const periodStart = getPeriodStart(period);
  const periodStartIso = periodStart.toISOString();

  const [
    total,
    customers,
    drivers,
    newToday,
    newThisWeek,
    newThisMonth,
    newDriversInPeriod,
    newCustomersInPeriod
  ] = await Promise.all([
    runCountAggregate(collection, { source: 'getUserStats.total' }),
    countUsersByType(collection, 'customer', { source: 'getUserStats.customers' }),
    countUsersByType(collection, 'driver', { source: 'getUserStats.drivers' }),
    runCountAggregate(collection.where('createdAt', '>=', todayStart.toISOString()), { source: 'getUserStats.newToday' }),
    runCountAggregate(collection.where('createdAt', '>=', weekStart.toISOString()), { source: 'getUserStats.newThisWeek' }),
    runCountAggregate(collection.where('createdAt', '>=', monthStart.toISOString()), { source: 'getUserStats.newThisMonth' }),
    countNewUsersByType(collection, 'driver', periodStartIso, { source: 'getUserStats.newDriversInPeriod' }),
    countNewUsersByType(collection, 'customer', periodStartIso, { source: 'getUserStats.newCustomersInPeriod' })
  ]);

  let activeToday = 0;
  let conversionRate = 0;
  if (redis) {
    try {
      activeToday = Number(await redis.scard('online_users')) || 0;
      const totalBookings = Number(await redis.hlen('bookings:active')) || 0;
      conversionRate = totalBookings > 0 && activeToday > 0
        ? Number(((totalBookings / activeToday) * 100).toFixed(1))
        : 0;
    } catch (error) {
      logError(error, 'Erro ao complementar stats de usuarios via Redis', {
        service: 'dashboard-user-service'
      });
    }
  }

  const payload = {
    total,
    customers,
    drivers,
    newToday,
    newThisWeek,
    newThisMonth,
    newDriversInPeriod,
    newCustomersInPeriod,
    period: {
      value: period,
      startDate: periodStart.toISOString(),
      newDrivers: newDriversInPeriod,
      newCustomers: newCustomersInPeriod
    },
    activeToday,
    growthRate: newThisMonth > 0
      ? Number(((newThisMonth / Math.max(total - newThisMonth, 1)) * 100).toFixed(1))
      : 0,
    conversionRate,
    cacheTtlMs: USER_STATS_CACHE_TTL_MS,
    countMode: 'firestore-aggregate'
  };

  userStatsCache.set(cacheKey, {
    timestamp: Date.now(),
    payload
  });

  return payload;
}

async function getUserDetails(userId) {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return null;

  const doc = await admin.firestore().collection('users').doc(safeUserId).get();
  return doc.exists ? normalizeUserRecord(doc) : null;
}

async function updateUserProfile(userId, payload = {}, options = {}) {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) {
    return null;
  }

  const firestore = admin.firestore();
  const userRef = firestore.collection('users').doc(safeUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    return null;
  }

  const updates = {};
  const setStringIfPresent = (fieldName, targetField) => {
    if (typeof payload[fieldName] === 'string' && payload[fieldName].trim()) {
      updates[targetField] = payload[fieldName].trim();
    }
  };

  setStringIfPresent('firstName', 'firstName');
  setStringIfPresent('lastName', 'lastName');
  setStringIfPresent('email', 'email');
  setStringIfPresent('mobile', 'mobile');
  setStringIfPresent('phone', 'mobile');
  setStringIfPresent('city', 'city');
  setStringIfPresent('state', 'state');
  setStringIfPresent('carType', 'carType');
  setStringIfPresent('usertype', 'usertype');

  if (typeof payload.name === 'string' && payload.name.trim()) {
    const parts = payload.name.trim().split(/\s+/);
    updates.firstName = parts.shift() || '';
    updates.lastName = parts.join(' ');
    updates.name = payload.name.trim();
  }

  if (typeof payload.approved === 'boolean') {
    updates.approved = payload.approved;
  }

  if (Object.keys(updates).length === 0) {
    return { skipped: true };
  }

  const nowIso = new Date().toISOString();
  updates.updatedAt = nowIso;
  await userRef.set(updates, { merge: true });

  if (options.mirrorToLegacyRtdb && options.legacyDb) {
    try {
      await options.legacyDb.ref(`users/${safeUserId}`).update(updates);
    } catch (error) {
      logError(error, 'Erro ao espelhar atualizacao de usuario no RTDB legado', {
        service: 'dashboard-user-service',
        userId: safeUserId
      });
    }
  }

  resetUsersCache();
  const updatedDoc = await userRef.get();
  return normalizeUserRecord(updatedDoc);
}

module.exports = {
  listUsers,
  getUserStats,
  getUserDetails,
  updateUserProfile,
  resetUsersCache
};
