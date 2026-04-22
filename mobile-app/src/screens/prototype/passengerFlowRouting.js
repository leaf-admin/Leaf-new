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
  return String(rawStatus || '').trim().toLowerCase();
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
