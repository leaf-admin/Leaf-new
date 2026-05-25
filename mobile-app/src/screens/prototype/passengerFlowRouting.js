export const PASSENGER_RUNTIME_SYNC_ROUTES = new Set([
  'RobotaxiPrototype',
  'Map',
  'MapScreen',
  'TabRoot',
  'RobotaxiPrototypeDestination',
  'RobotaxiPrototypeBooking',
  'RobotaxiPrototypePayment',
  'RobotaxiPrototypePaymentSuccess',
  'RobotaxiPrototypePaymentFailed',
  'RobotaxiPrototypeNoDrivers',
  'RobotaxiPrototypeCancellation',
  'RobotaxiPrototypeDriverSearch',
  'RobotaxiPrototypeTrip'
]);

export function normalizePassengerBookingStatus(rawStatus) {
  const normalized = String(rawStatus || '').trim().toLowerCase();

  if (
    [
      'in_trip',
      'on_trip',
      'trip_started',
      'trip-started',
      'trip_in_progress',
      'trip-in-progress',
      'in-progress',
      'in_progress',
      'reassigned_in_progress',
      'reassigned_started',
      'replacement_driver_accepted',
    ].includes(normalized)
  ) {
    return 'started';
  }

  if (
    [
      'driver_arrived',
      'arrived_at_pickup',
      'at_pickup',
    ].includes(normalized)
  ) {
    return 'arrived';
  }

  if (
    [
      'matched',
      'driver_accepted',
      'accepted_by_driver',
    ].includes(normalized)
  ) {
    return 'accepted';
  }

  if (
    [
      'interrupted_operational',
      'passenger_decision_pending',
    ].includes(normalized)
  ) {
    return 'operational_interrupted';
  }

  if (
    [
      'reassignment_pending',
      'searching_replacement_driver',
      'replacement_driver_searching',
    ].includes(normalized)
  ) {
    return 'searching_replacement';
  }

  return normalized;
}

export function resolvePassengerAutoRoute(rawStatus) {
  const normalizedStatus = normalizePassengerBookingStatus(rawStatus);

  if (normalizedStatus === 'completed') {
    return 'RobotaxiPrototypeReceipt';
  }

  if (
    ['accepted', 'arrived', 'started', 'operational_interrupted', 'searching_replacement'].includes(
      normalizedStatus
    )
  ) {
    return 'RobotaxiPrototypeTrip';
  }

  if (['searching', 'requesting'].includes(normalizedStatus)) {
    return 'RobotaxiPrototypeDriverSearch';
  }

  return null;
}

export function shouldAutoSyncPassengerRoute(routeName) {
  return PASSENGER_RUNTIME_SYNC_ROUTES.has(String(routeName || '').trim());
}
