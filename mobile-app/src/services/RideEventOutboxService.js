import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@leaf:ride-event-outbox:v1';
const MAX_EVENTS = 20;
const RETAINED_ACKED_EVENTS = 6;

export const RIDE_EVENT_TYPES = Object.freeze({
  ARRIVED_AT_PICKUP: 'arrived_at_pickup',
  START_TRIP: 'start_trip',
  COMPLETE_TRIP: 'complete_trip',
  CANCEL_RIDE: 'cancel_ride',
});

const ALLOWED_EVENT_TYPES = new Set(Object.values(RIDE_EVENT_TYPES));

const normalizeText = (value) => String(value || '').trim();

const sanitizeKeyPart = (value, fallback = 'unknown') =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;

export const buildRideEventIdempotencyKey = ({
  bookingId,
  actorId,
  eventType,
} = {}) => {
  const normalizedEventType = sanitizeKeyPart(eventType);
  const normalizedBookingId = sanitizeKeyPart(bookingId);
  const normalizedActorId = sanitizeKeyPart(actorId, 'anonymous');
  return `mobile_lifecycle_${normalizedEventType}_${normalizedBookingId}_${normalizedActorId}`;
};

const normalizeEventType = (eventType) => {
  const normalized = normalizeText(eventType).toLowerCase();
  if (normalized === 'arrived' || normalized === 'driver_arrived') {
    return RIDE_EVENT_TYPES.ARRIVED_AT_PICKUP;
  }
  if (normalized === 'started' || normalized === 'start') {
    return RIDE_EVENT_TYPES.START_TRIP;
  }
  if (normalized === 'completed' || normalized === 'complete') {
    return RIDE_EVENT_TYPES.COMPLETE_TRIP;
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancel') {
    return RIDE_EVENT_TYPES.CANCEL_RIDE;
  }
  return normalized;
};

const readOutbox = async () => {
  const rawValue = await AsyncStorage.getItem(STORAGE_KEY);
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch (_error) {
    return [];
  }
};

const sortEvents = (events) =>
  [...events].sort((left, right) => {
    const leftCreated = Number(left.clientCreatedAt || 0);
    const rightCreated = Number(right.clientCreatedAt || 0);
    return leftCreated - rightCreated;
  });

const compactEvents = (events) => {
  const pendingOrRejected = events.filter((event) => event.status !== 'acked');
  const acked = events
    .filter((event) => event.status === 'acked')
    .sort((left, right) => Number(right.ackedAt || 0) - Number(left.ackedAt || 0))
    .slice(0, RETAINED_ACKED_EVENTS);

  return sortEvents([...pendingOrRejected, ...acked]).slice(-MAX_EVENTS);
};

const writeOutbox = async (events) => {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      events: compactEvents(events),
    }),
  );
};

export const enqueueRideEventIntent = async ({
  bookingId,
  actorId,
  role,
  eventType,
  payload,
  idempotencyKey,
  reason,
} = {}) => {
  const normalizedBookingId = normalizeText(bookingId);
  const normalizedActorId = normalizeText(actorId);
  const normalizedEventType = normalizeEventType(eventType);

  if (!normalizedBookingId || !normalizedEventType || !ALLOWED_EVENT_TYPES.has(normalizedEventType)) {
    throw new Error('Invalid ride event intent');
  }

  const resolvedIdempotencyKey =
    normalizeText(idempotencyKey) ||
    buildRideEventIdempotencyKey({
      bookingId: normalizedBookingId,
      actorId: normalizedActorId,
      eventType: normalizedEventType,
    });
  const events = await readOutbox();
  const existing = events.find((event) => event.idempotencyKey === resolvedIdempotencyKey);
  if (existing && existing.status !== 'rejected') {
    return existing;
  }

  const now = Date.now();
  const previousSequence = events.reduce(
    (max, event) => Math.max(max, Number(event.clientSequence || 0)),
    0,
  );
  const nextEvent = {
    id: resolvedIdempotencyKey,
    idempotencyKey: resolvedIdempotencyKey,
    bookingId: normalizedBookingId,
    actorId: normalizedActorId || null,
    role: normalizeText(role).toLowerCase() || null,
    eventType: normalizedEventType,
    status: 'pending',
    attempts: existing ? Number(existing.attempts || 0) + 1 : 0,
    clientSequence: previousSequence + 1,
    clientCreatedAt: existing?.clientCreatedAt || now,
    updatedAt: now,
    reason: normalizeText(reason) || null,
    payload: payload && typeof payload === 'object' ? payload : null,
    lastError: '',
  };

  await writeOutbox([nextEvent, ...events.filter((event) => event.idempotencyKey !== resolvedIdempotencyKey)]);
  return nextEvent;
};

export const listPendingRideEventIntents = async ({ bookingId, actorId } = {}) => {
  const events = await readOutbox();
  const normalizedBookingId = normalizeText(bookingId);
  const normalizedActorId = normalizeText(actorId);

  return sortEvents(
    events.filter((event) => {
      if (event.status !== 'pending') return false;
      if (normalizedBookingId && event.bookingId !== normalizedBookingId) return false;
      if (normalizedActorId && event.actorId !== normalizedActorId) return false;
      return true;
    }),
  );
};

const markRideEventIntent = async ({
  idempotencyKey,
  bookingId,
  actorId,
  eventType,
  status,
  error,
} = {}) => {
  const normalizedIdempotencyKey = normalizeText(idempotencyKey);
  const normalizedBookingId = normalizeText(bookingId);
  const normalizedActorId = normalizeText(actorId);
  const normalizedEventType = normalizeEventType(eventType);
  const events = await readOutbox();
  const now = Date.now();
  let didUpdate = false;
  const nextEvents = events.map((event) => {
    const matchesKey = normalizedIdempotencyKey && event.idempotencyKey === normalizedIdempotencyKey;
    const matchesScope =
      !normalizedIdempotencyKey &&
      normalizedBookingId &&
      event.bookingId === normalizedBookingId &&
      (!normalizedActorId || event.actorId === normalizedActorId) &&
      (!normalizedEventType || event.eventType === normalizedEventType);

    if (!matchesKey && !matchesScope) return event;

    didUpdate = true;
    return {
      ...event,
      status,
      updatedAt: now,
      ...(status === 'acked' ? { ackedAt: now, lastError: '' } : {}),
      ...(status === 'rejected'
        ? {
            rejectedAt: now,
            lastError: normalizeText(error) || 'Rejected by backend',
          }
        : {}),
    };
  });

  if (!didUpdate) return false;
  await writeOutbox(nextEvents);
  return true;
};

export const markRideEventIntentAcked = (options = {}) =>
  markRideEventIntent({ ...options, status: 'acked' });

export const markRideEventIntentRejected = (options = {}) =>
  markRideEventIntent({ ...options, status: 'rejected' });

export const clearRideEventOutbox = async () => {
  await AsyncStorage.removeItem(STORAGE_KEY);
};

export default {
  RIDE_EVENT_TYPES,
  buildRideEventIdempotencyKey,
  clearRideEventOutbox,
  enqueueRideEventIntent,
  listPendingRideEventIntents,
  markRideEventIntentAcked,
  markRideEventIntentRejected,
};
