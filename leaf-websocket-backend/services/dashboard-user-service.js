const admin = require('firebase-admin');
const { logError } = require('../utils/logger');

const RAW_USERS_CACHE_TTL_MS = Math.max(
  5000,
  Number.parseInt(process.env.DASHBOARD_USERS_CACHE_TTL_MS || '30000', 10)
);

let rawUsersCache = {
  timestamp: 0,
  users: null
};

function cacheIsValid() {
  return Array.isArray(rawUsersCache.users) && (Date.now() - rawUsersCache.timestamp) < RAW_USERS_CACHE_TTL_MS;
}

function resetUsersCache() {
  rawUsersCache = {
    timestamp: 0,
    users: null
  };
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

async function loadRawUsersFromFirestore() {
  if (cacheIsValid()) {
    return rawUsersCache.users;
  }

  const snapshot = await admin.firestore().collection('users').get();
  const users = snapshot.docs.map(normalizeUserRecord);
  rawUsersCache = {
    timestamp: Date.now(),
    users
  };
  return users;
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

  const users = await loadRawUsersFromFirestore();
  const filtered = applyUserFilters(users, params);
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 50);
  const start = (safePage - 1) * safeLimit;
  const paginated = filtered.slice(start, start + safeLimit);

  return {
    users: paginated,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: filtered.length,
      pages: Math.ceil(filtered.length / safeLimit)
    }
  };
}

async function getUserStats(redis) {
  const users = await loadRawUsersFromFirestore();
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = now - (7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  const customers = users.filter((user) => user.type === 'customer');
  const drivers = users.filter((user) => user.type === 'driver');
  const newToday = users.filter((user) => {
    const ts = user.registrationDate ? new Date(user.registrationDate).getTime() : 0;
    return Number.isFinite(ts) && ts >= todayStart.getTime();
  }).length;
  const newThisWeek = users.filter((user) => {
    const ts = user.registrationDate ? new Date(user.registrationDate).getTime() : 0;
    return Number.isFinite(ts) && ts >= weekStart;
  }).length;
  const newThisMonth = users.filter((user) => {
    const ts = user.registrationDate ? new Date(user.registrationDate).getTime() : 0;
    return Number.isFinite(ts) && ts >= monthStart;
  }).length;

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

  return {
    total: users.length,
    customers: customers.length,
    drivers: drivers.length,
    newToday,
    newThisWeek,
    newThisMonth,
    activeToday,
    growthRate: newThisMonth > 0
      ? Number(((newThisMonth / Math.max(users.length - newThisMonth, 1)) * 100).toFixed(1))
      : 0,
    conversionRate
  };
}

async function getUserDetails(userId) {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return null;

  const users = await loadRawUsersFromFirestore();
  return users.find((user) => user.id === safeUserId) || null;
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
  resetUsersCache,
  loadRawUsersFromFirestore
};
