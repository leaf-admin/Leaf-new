import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = '@leaf:ride-payment-sessions:v1:';
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS_PER_PASSENGER = 5;

const normalizeText = (value) => String(value || '').trim();

const normalizeCoordinate = (value, precision = 4) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(precision) : '';
};

const buildStorageKey = (passengerId) =>
  `${STORAGE_PREFIX}${encodeURIComponent(normalizeText(passengerId))}`;

const createPaymentSessionId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12);
  return `pay_${timestamp}_${random}`;
};

const normalizeRegistry = (rawValue, now = Date.now()) => {
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch (_error) {
      parsed = null;
    }
  }

  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  return sessions
    .filter((session) => {
      const createdAt = Number(session?.createdAt);
      return (
        normalizeText(session?.paymentSessionId) &&
        normalizeText(session?.contextKey) &&
        Number.isFinite(createdAt) &&
        now - createdAt <= SESSION_TTL_MS
      );
    })
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, MAX_SESSIONS_PER_PASSENGER);
};

export const buildRidePaymentRouteContextKey = ({ tripData = {} } = {}) => {
  const pickup = tripData?.pickup || {};
  const drop = tripData?.drop || {};
  return [
    'ride-payment-v1',
    normalizeCoordinate(pickup.lat ?? pickup.latitude),
    normalizeCoordinate(pickup.lng ?? pickup.longitude),
    normalizeCoordinate(drop.lat ?? drop.latitude),
    normalizeCoordinate(drop.lng ?? drop.longitude),
    normalizeText(tripData?.carType).toLowerCase(),
  ].join('|');
};

export const buildRidePaymentContextKey = ({
  tripData = {},
  amountInCents,
  grossAmountInCents,
} = {}) => {
  const routeContextKey = buildRidePaymentRouteContextKey({ tripData });
  return [
    routeContextKey,
    String(Math.round(Number(amountInCents) || 0)),
    String(Math.round(Number(grossAmountInCents) || Number(amountInCents) || 0)),
  ].join('|');
};

const readSessions = async (passengerId) => {
  const storageKey = buildStorageKey(passengerId);
  const rawValue = await AsyncStorage.getItem(storageKey);
  const sessions = normalizeRegistry(rawValue);
  return { storageKey, sessions };
};

const writeSessions = async (storageKey, sessions) => {
  await AsyncStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      sessions: normalizeRegistry({ sessions }),
    }),
  );
};

export const getOrCreateRidePaymentSession = async ({ passengerId, contextKey }) => {
  const normalizedPassengerId = normalizeText(passengerId);
  const normalizedContextKey = normalizeText(contextKey);
  if (!normalizedPassengerId || !normalizedContextKey) {
    throw new Error('Contexto de pagamento incompleto');
  }

  const { storageKey, sessions } = await readSessions(normalizedPassengerId);
  const existing = sessions.find((session) => session.contextKey === normalizedContextKey);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const created = {
    passengerId: normalizedPassengerId,
    contextKey: normalizedContextKey,
    paymentSessionId: createPaymentSessionId(),
    createdAt: now,
    updatedAt: now,
    paymentData: null,
  };
  await writeSessions(storageKey, [created, ...sessions]);
  return created;
};

export const findRecoverableRidePaymentSession = async ({ passengerId, routeContextKey }) => {
  const normalizedPassengerId = normalizeText(passengerId);
  const normalizedRouteContextKey = normalizeText(routeContextKey);
  if (!normalizedPassengerId || !normalizedRouteContextKey) return null;

  const { sessions } = await readSessions(normalizedPassengerId);
  return sessions.find(
    (session) =>
      session.contextKey.startsWith(`${normalizedRouteContextKey}|`) &&
      normalizeText(session?.paymentData?.chargeId),
  ) || null;
};

export const saveRidePaymentSessionData = async ({
  passengerId,
  contextKey,
  paymentSessionId,
  paymentData,
}) => {
  const normalizedPassengerId = normalizeText(passengerId);
  const normalizedContextKey = normalizeText(contextKey);
  const normalizedSessionId = normalizeText(paymentSessionId);
  if (!normalizedPassengerId || !normalizedContextKey || !normalizedSessionId) {
    throw new Error('Sessão de pagamento inválida');
  }

  const { storageKey, sessions } = await readSessions(normalizedPassengerId);
  const now = Date.now();
  const nextSession = {
    passengerId: normalizedPassengerId,
    contextKey: normalizedContextKey,
    paymentSessionId: normalizedSessionId,
    createdAt:
      Number(sessions.find((session) => session.paymentSessionId === normalizedSessionId)?.createdAt) || now,
    updatedAt: now,
    paymentData: paymentData && typeof paymentData === 'object' ? paymentData : null,
  };
  const remaining = sessions.filter(
    (session) =>
      session.paymentSessionId !== normalizedSessionId &&
      session.contextKey !== normalizedContextKey,
  );
  await writeSessions(storageKey, [nextSession, ...remaining]);
  return nextSession;
};

export const clearRidePaymentSession = async ({
  passengerId,
  paymentSessionId,
  contextKey,
  chargeId,
} = {}) => {
  const normalizedPassengerId = normalizeText(passengerId);
  if (!normalizedPassengerId) return false;

  const normalizedSessionId = normalizeText(paymentSessionId);
  const normalizedContextKey = normalizeText(contextKey);
  const normalizedChargeId = normalizeText(chargeId);
  const { storageKey, sessions } = await readSessions(normalizedPassengerId);
  const remaining = sessions.filter((session) => {
    const matchesSession = normalizedSessionId && session.paymentSessionId === normalizedSessionId;
    const matchesContext = normalizedContextKey && session.contextKey === normalizedContextKey;
    const matchesCharge =
      normalizedChargeId && normalizeText(session?.paymentData?.chargeId) === normalizedChargeId;
    return !(matchesSession || matchesContext || matchesCharge);
  });

  if (remaining.length === sessions.length) return false;
  if (remaining.length === 0) {
    await AsyncStorage.removeItem(storageKey);
  } else {
    await writeSessions(storageKey, remaining);
  }
  return true;
};

export default {
  buildRidePaymentContextKey,
  buildRidePaymentRouteContextKey,
  findRecoverableRidePaymentSession,
  getOrCreateRidePaymentSession,
  saveRidePaymentSessionData,
  clearRidePaymentSession,
};
