import {
  normalizePassengerBookingStatus,
  resolvePassengerAutoRoute,
  shouldAutoSyncPassengerRoute
} from '../src/screens/prototype/passengerFlowRouting';

describe('passengerFlowRouting', () => {
  it('normalizes passenger runtime statuses', () => {
    expect(normalizePassengerBookingStatus(' STARTED ')).toBe('started');
    expect(normalizePassengerBookingStatus(null)).toBe('');
  });

  it('keeps pre-accept driver notification statuses on the passenger search surface', () => {
    [
      'NOTIFIED',
      'AWAITING_RESPONSE',
      'DRIVER_NOTIFIED',
      'OFFER_SENT',
      'PENDING_DRIVER_RESPONSE',
      'AWAITING_DRIVER_RESPONSE',
    ].forEach((status) => {
      expect(normalizePassengerBookingStatus(status)).toBe('searching');
      expect(resolvePassengerAutoRoute(status)).toBe('RobotaxiPrototypeDriverSearch');
    });

    expect(normalizePassengerBookingStatus('MATCHED')).toBe('accepted');
    expect(resolvePassengerAutoRoute('MATCHED')).toBe('RobotaxiPrototypeTrip');
  });

  it('maps active booking statuses to the canonical passenger surfaces', () => {
    expect(resolvePassengerAutoRoute('requesting')).toBe('RobotaxiPrototypeDriverSearch');
    expect(resolvePassengerAutoRoute('accepted')).toBe('RobotaxiPrototypeTrip');
    expect(resolvePassengerAutoRoute('operational_interrupted')).toBe('RobotaxiPrototypeTrip');
    expect(resolvePassengerAutoRoute('completed')).toBe('RobotaxiPrototypeReceipt');
    expect(resolvePassengerAutoRoute('no_drivers_available')).toBe('RobotaxiPrototypeNoDrivers');
    expect(resolvePassengerAutoRoute('NO_DRIVERS_FOUND')).toBe('RobotaxiPrototypeNoDrivers');
    expect(resolvePassengerAutoRoute('cancelled')).toBe('RobotaxiPrototypeCancellation');
    expect(resolvePassengerAutoRoute('idle')).toBeNull();
  });

  it('auto-syncs only the passenger ride-flow surfaces', () => {
    expect(shouldAutoSyncPassengerRoute('RobotaxiPrototype')).toBe(true);
    expect(shouldAutoSyncPassengerRoute('RobotaxiPrototypePaymentSuccess')).toBe(true);
    expect(shouldAutoSyncPassengerRoute('RobotaxiPrototypeNoDrivers')).toBe(true);
    expect(shouldAutoSyncPassengerRoute('RobotaxiPrototypeReceipt')).toBe(false);
    expect(shouldAutoSyncPassengerRoute('RobotaxiPrototypeMenu')).toBe(false);
  });
});
