import {
  normalizeRuntimeRideStatus,
  RUNTIME_RIDE_STATUSES,
} from './rideLifecycleContract';

export const RIDE_TERMINAL_STATUSES = new Set([
  RUNTIME_RIDE_STATUSES.COMPLETED,
  RUNTIME_RIDE_STATUSES.CANCELED,
  RUNTIME_RIDE_STATUSES.NO_DRIVERS,
  RUNTIME_RIDE_STATUSES.REJECTED,
]);

const RIDE_LIFECYCLE_ORDER = Object.freeze({
  idle: 0,
  requesting: 1,
  searching: 2,
  searching_replacement: 2,
  accepted: 3,
  arrived: 4,
  started: 5,
  operational_interrupted: 6,
  completed: 100,
  canceled: 100,
  no_drivers: 100,
  rejected: 100,
});

const EVENT_SCOPED_NON_MONOTONIC_TRANSITIONS = new Set([
  'rideOperationalContinuationSearching:operational_interrupted:searching_replacement',
  'rideAcceptedDriverRecovery:accepted:searching_replacement',
  'rideOperationalReleased:operational_interrupted:idle',
  'rideOperationalReleased:searching_replacement:idle',
]);

function normalizeStatus(value) {
  return normalizeRuntimeRideStatus(value);
}

export function getRideLifecycleOrder(status) {
  return RIDE_LIFECYCLE_ORDER[normalizeStatus(status)] ?? -1;
}

export function shouldIgnoreRideLifecycleEvent({
  eventName,
  currentStatus,
  nextStatus,
  activeBookingId,
  incomingBookingId,
  terminalStatus = '',
  allowMatchingTerminal = false,
} = {}) {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedCurrentStatus = normalizeStatus(currentStatus);
  const normalizedNextStatus = normalizeStatus(nextStatus);
  const normalizedActiveBookingId = String(activeBookingId || '').trim();
  const normalizedIncomingBookingId = String(incomingBookingId || '').trim();
  const normalizedTerminalStatus = normalizeStatus(terminalStatus);

  if (!normalizedNextStatus) {
    return { ignore: false, reason: null };
  }

  if (
    normalizedActiveBookingId &&
    normalizedIncomingBookingId &&
    normalizedActiveBookingId !== normalizedIncomingBookingId
  ) {
    return { ignore: true, reason: 'different_active_booking' };
  }

  if (RIDE_TERMINAL_STATUSES.has(normalizedTerminalStatus)) {
    if (
      allowMatchingTerminal &&
      normalizedTerminalStatus === normalizedNextStatus
    ) {
      return { ignore: false, reason: null };
    }

    return { ignore: true, reason: 'terminal_guard' };
  }

  if (!normalizedCurrentStatus || normalizedCurrentStatus === normalizedNextStatus) {
    return { ignore: false, reason: null };
  }

  const eventScopedTransition = [
    normalizedEventName,
    normalizedCurrentStatus,
    normalizedNextStatus,
  ].join(':');
  if (EVENT_SCOPED_NON_MONOTONIC_TRANSITIONS.has(eventScopedTransition)) {
    return { ignore: false, reason: null };
  }

  const currentOrder = getRideLifecycleOrder(normalizedCurrentStatus);
  const nextOrder = getRideLifecycleOrder(normalizedNextStatus);
  if (
    currentOrder > nextOrder &&
    !RIDE_TERMINAL_STATUSES.has(normalizedNextStatus)
  ) {
    return { ignore: true, reason: 'lifecycle_order_regression' };
  }

  return { ignore: false, reason: null };
}
