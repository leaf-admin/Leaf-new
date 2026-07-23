import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@leaf:ride-local-snapshots:v1';
const MAX_SNAPSHOTS = 8;

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'canceled', 'no_drivers', 'rejected']);
const LIFECYCLE_ORDER = Object.freeze({
  idle: 0,
  requesting: 1,
  searching: 2,
  searching_replacement: 2,
  accepted: 3,
  arrived: 4,
  started: 5,
  operational_interrupted: 6,
  completed: 100,
  cancelled: 100,
  canceled: 100,
  no_drivers: 100,
  rejected: 100,
});

const normalizeText = (value) => String(value || '').trim();
const normalizeRole = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'customer') return 'passenger';
  return normalized;
};

const parseTimestampMs = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const dateMs = value.getTime();
    return Number.isFinite(dateMs) ? dateMs : null;
  }

  const raw = normalizeText(value);
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasServerVersion = (snapshot = {}) =>
  snapshot.serverVersion !== null &&
  snapshot.serverVersion !== undefined &&
  Number.isFinite(Number(snapshot.serverVersion));

const isTruthyFlag = (value) => {
  if (value === true) return true;
  return ['1', 'true', 'yes', 'sim'].includes(normalizeText(value).toLowerCase());
};

const parseFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pickMoneyLike = (source = {}, keys = []) => {
  for (const key of keys) {
    const parsed = parseFiniteNumber(source?.[key]);
    if (parsed !== null) return parsed;
  }
  return null;
};

const sanitizeFinancialSnapshot = (financialSnapshot = null) => {
  if (!financialSnapshot || typeof financialSnapshot !== 'object') {
    return null;
  }

  const financialSnapshotSource = normalizeText(financialSnapshot.financialSnapshotSource);
  const authoritativeSnapshot = isTruthyFlag(financialSnapshot.authoritativeSnapshot);
  const backendFinal = authoritativeSnapshot && financialSnapshotSource === 'backend_final';
  const base = {
    paymentStatus: financialSnapshot.paymentStatus || null,
    paymentId: financialSnapshot.paymentId || null,
    chargeId: financialSnapshot.chargeId || null,
  };

  if (backendFinal) {
    return {
      ...financialSnapshot,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
    };
  }

  const fare = pickMoneyLike(financialSnapshot, [
    'fare',
    'grossAmount',
    'finalFare',
    'passengerPaid',
    'passengerPaidAmount',
  ]);

  return {
    ...base,
    ...(fare !== null ? { fare } : {}),
    authoritativeSnapshot: false,
    financialSnapshotSource: financialSnapshotSource || 'local_last_known',
  };
};

const sanitizeRouteSnapshot = (routeSnapshot = null) => {
  if (!routeSnapshot || typeof routeSnapshot !== 'object') {
    return null;
  }

  return {
    ...routeSnapshot,
    routeSynthetic: routeSnapshot.routeSynthetic === true,
    polylineSource: normalizeText(routeSnapshot.polylineSource || routeSnapshot.source || ''),
  };
};

export const normalizeRideSnapshotStatus = (status) => {
  const normalized = normalizeText(status).toLowerCase().replace(/-/g, '_');
  if (!normalized) return 'idle';
  if (normalized === 'cancelled') return 'canceled';
  if (normalized === 'driver_arrived') return 'arrived';
  if (normalized === 'in_trip' || normalized === 'trip_started') return 'started';
  if (
    normalized === 'finished' ||
    normalized === 'trip_completed' ||
    normalized === 'early_ended_by_rider' ||
    normalized === 'interrupted_operational_ended' ||
    normalized === 'early_ended_review'
  ) return 'completed';
  if (
    normalized === 'no_driver' ||
    normalized === 'no_drivers_found' ||
    normalized === 'no_drivers_available'
  ) return 'no_drivers';
  return normalized;
};

export const getRideSnapshotLifecycleOrder = (status) =>
  LIFECYCLE_ORDER[normalizeRideSnapshotStatus(status)] ?? -1;

const readRegistry = async () => {
  const rawValue = await AsyncStorage.getItem(STORAGE_KEY);
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
  } catch (_error) {
    return [];
  }
};

const writeRegistry = async (snapshots) => {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      snapshots: snapshots
        .filter((item) => normalizeText(item?.bookingId))
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
        .slice(0, MAX_SNAPSHOTS),
    }),
  );
};

const resolveSnapshotIdentity = (snapshot = {}) => ({
  bookingId: normalizeText(snapshot.bookingId || snapshot.activeBookingId || snapshot.id),
  userId: normalizeText(snapshot.userId || snapshot.profileUid || snapshot.actorId),
  role: normalizeRole(snapshot.role || snapshot.activeRole),
});

const sameSnapshotScope = (left = {}, right = {}) => {
  const leftIdentity = resolveSnapshotIdentity(left);
  const rightIdentity = resolveSnapshotIdentity(right);

  if (!leftIdentity.bookingId || leftIdentity.bookingId !== rightIdentity.bookingId) {
    return false;
  }

  if (leftIdentity.userId && rightIdentity.userId && leftIdentity.userId !== rightIdentity.userId) {
    return false;
  }

  if (leftIdentity.role && rightIdentity.role && leftIdentity.role !== rightIdentity.role) {
    return false;
  }

  return true;
};

const normalizeSnapshot = (snapshot = {}, now = Date.now()) => {
  const identity = resolveSnapshotIdentity(snapshot);
  if (!identity.bookingId) return null;

  const status = normalizeRideSnapshotStatus(snapshot.status || snapshot.bookingStatus);
  const lifecycleOrder = getRideSnapshotLifecycleOrder(status);

  return {
    ...snapshot,
    bookingId: identity.bookingId,
    userId: identity.userId || null,
    role: identity.role || null,
    status,
    lifecycleOrder,
    terminal: TERMINAL_STATUSES.has(status),
    source: normalizeText(snapshot.source || 'runtime'),
    serverVersion: Number.isFinite(Number(snapshot.serverVersion))
      ? Number(snapshot.serverVersion)
      : null,
    lastServerEventAt: snapshot.lastServerEventAt || null,
    lastServerEventAtMs: parseTimestampMs(snapshot.lastServerEventAt),
    lastLocalSeenAt: snapshot.lastLocalSeenAt || new Date(now).toISOString(),
    financialSnapshot: sanitizeFinancialSnapshot(snapshot.financialSnapshot),
    routeSnapshot: sanitizeRouteSnapshot(snapshot.routeSnapshot),
    updatedAt: now,
  };
};

export const shouldAcceptRideLocalSnapshot = (previous, incoming) => {
  const next = normalizeSnapshot(incoming);
  if (!next) return false;

  if (!previous) return true;

  const current = normalizeSnapshot(previous);
  if (!current) return true;

  const currentVersion = Number(current.serverVersion);
  const nextVersion = Number(next.serverVersion);
  if (
    hasServerVersion(current) &&
    hasServerVersion(next)
  ) {
    if (nextVersion > currentVersion) return true;
    if (nextVersion < currentVersion) return false;
  }

  if (
    Number.isFinite(Number(current.lastServerEventAtMs)) &&
    Number.isFinite(Number(next.lastServerEventAtMs))
  ) {
    if (Number(next.lastServerEventAtMs) > Number(current.lastServerEventAtMs)) {
      return true;
    }
    if (Number(next.lastServerEventAtMs) < Number(current.lastServerEventAtMs)) {
      return false;
    }
  }

  if (current.terminal && !next.terminal) return false;

  if (
    current.terminal &&
    next.terminal &&
    current.status !== next.status &&
    !(Number.isFinite(currentVersion) && Number.isFinite(nextVersion) && nextVersion > currentVersion)
  ) {
    return false;
  }

  return next.lifecycleOrder >= current.lifecycleOrder;
};

export const saveCanonicalRideLocalSnapshot = async (snapshot = {}) => {
  const incoming = normalizeSnapshot(snapshot);
  if (!incoming) {
    return {
      saved: false,
      reason: 'missing_booking_id',
      snapshot: null,
    };
  }

  const snapshots = await readRegistry();
  const previous = snapshots.find((item) => sameSnapshotScope(item, incoming)) || null;
  if (!shouldAcceptRideLocalSnapshot(previous, incoming)) {
    return {
      saved: false,
      reason: 'regression_rejected',
      snapshot: previous,
    };
  }

  const remaining = snapshots.filter((item) => !sameSnapshotScope(item, incoming));
  await writeRegistry([incoming, ...remaining]);

  return {
    saved: true,
    reason: previous ? 'advanced' : 'created',
    snapshot: incoming,
  };
};

export const loadCanonicalRideLocalSnapshot = async ({ bookingId, userId, role } = {}) => {
  const query = resolveSnapshotIdentity({ bookingId, userId, role });
  if (!query.bookingId) return null;

  const snapshots = await readRegistry();
  return snapshots.find((item) => sameSnapshotScope(item, query)) || null;
};

export const clearCanonicalRideLocalSnapshot = async ({ bookingId, userId, role } = {}) => {
  const query = resolveSnapshotIdentity({ bookingId, userId, role });
  if (!query.bookingId) return false;

  const snapshots = await readRegistry();
  const remaining = snapshots.filter((item) => !sameSnapshotScope(item, query));
  if (remaining.length === snapshots.length) return false;

  await writeRegistry(remaining);
  return true;
};

export default {
  clearCanonicalRideLocalSnapshot,
  getRideSnapshotLifecycleOrder,
  loadCanonicalRideLocalSnapshot,
  normalizeRideSnapshotStatus,
  saveCanonicalRideLocalSnapshot,
  shouldAcceptRideLocalSnapshot,
};
