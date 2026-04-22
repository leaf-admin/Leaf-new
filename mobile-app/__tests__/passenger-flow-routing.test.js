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

  it('maps active booking statuses to the canonical passenger surfaces', () => {
    expect(resolvePassengerAutoRoute('requesting')).toBe('RobotaxiPrototypeDriverSearch');
    expect(resolvePassengerAutoRoute('accepted')).toBe('RobotaxiPrototypeTrip');
    expect(resolvePassengerAutoRoute('operational_interrupted')).toBe('RobotaxiPrototypeTrip');
    expect(resolvePassengerAutoRoute('completed')).toBe('RobotaxiPrototypeReceipt');
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
