const fs = require('fs');
const vm = require('vm');

// Exercise the actual socket callback without starting the singleton runtime's
// Auth/location effects. It closes over these services rather than exporting a
// public mutation API just for tests.
const runtimeSource = fs.readFileSync(
  require.resolve('../src/screens/prototype/prototypeRideRuntime'), 'utf8',
);
const start = runtimeSource.indexOf('  const handleDriverArrived = (payload) => {');
const end = runtimeSource.indexOf('  const handleBoardingWindowExpired', start);
if (start < 0 || end < start) throw new Error('Arrival callback not found');
const callback = runtimeSource.slice(start, end);

function deliver(payload, role = 'driver') {
  const runtimeState = {
    activeBookingId: 'ride-1', bookingStatus: 'accepted', profile: { role },
    driverActiveRide: { bookingId: 'ride-1', status: 'accepted' },
  };
  const effects = {
    markRuntimeLifecycleIntentAcked: jest.fn(),
    startBoardingCountdown: jest.fn(),
    appendRuntimeNotification: jest.fn(),
    shouldIgnoreDuplicateLifecycleEvent: jest.fn(() => false),
  };
  vm.runInNewContext(`${callback}\nhandleDriverArrived(payload);`, {
    ...effects, runtimeState, payload,
    shouldIgnoreLifecycleRegression: (_event, id) => id !== 'ride-1',
    RIDE_EVENT_TYPES: { ARRIVED_AT_PICKUP: 'arrived_at_pickup' },
    resolveRuntimeRole: () => role,
    cloneDefaultRideLocalSyncState: () => ({}),
    createRuntimeNotification: value => value,
    setRuntimeState: update => Object.assign(runtimeState, update(runtimeState)),
  });
  return { runtimeState, effects };
}

describe('driver arrival socket events', () => {
  it.each([
    undefined,
    { bookingId: 'ride-1', success: false, code: 'PICKUP_TOLERANCE_NOT_REACHED' },
    { bookingId: 'ride-1', error: 'Aproxime-se do embarque.' },
    { success: false, error: 'Erro ao processar chegada no pickup' },
  ])('does not advance, ACK, deduplicate or notify for rejection %j', payload => {
    const { runtimeState, effects } = deliver(payload);
    expect(runtimeState.bookingStatus).toBe('accepted');
    expect(runtimeState.driverActiveRide.status).toBe('accepted');
    Object.values(effects).forEach(effect => expect(effect).not.toHaveBeenCalled());
  });

  it.each(['driver', 'passenger'])('accepts the confirmed arrival for %s', role => {
    const { runtimeState, effects } = deliver({
      bookingId: 'ride-1', success: true, boardingWindowSec: 120,
    }, role);
    expect(runtimeState.bookingStatus).toBe('arrived');
    expect(effects.markRuntimeLifecycleIntentAcked).toHaveBeenCalledTimes(1);
    expect(effects.startBoardingCountdown).toHaveBeenCalledTimes(1);
    expect(effects.appendRuntimeNotification).toHaveBeenCalledTimes(role === 'passenger' ? 1 : 0);
  });

  it('keeps the existing positive driverArrived event compatible', () => {
    expect(deliver({ bookingId: 'ride-1' }).runtimeState.bookingStatus).toBe('arrived');
  });

  it('does not apply an arrival from another ride', () => {
    expect(deliver({ bookingId: 'old-ride', success: true }).runtimeState.bookingStatus).toBe('accepted');
  });
});


describe('pickup command proximity', () => {
  const blockStart = runtimeSource.indexOf('  const pickupStraightLineMeters =', runtimeSource.indexOf('function buildDriverTripAssistModel'));
  const blockEnd = runtimeSource.indexOf('  const remainingDistanceLabel =', blockStart);
  const block = runtimeSource.slice(blockStart, blockEnd);
  it.each([
    [0, 50, false, 50],
    [90, 10, true, 10],
    [0, Infinity, false, 0],
  ])('uses pickup radius when route=%s and actual distance=%s', (remainingMeters, distance, enabled, displayed) => {
    const result = vm.runInNewContext(`${block}\n({ proximityReached, displayRemainingMeters });`, {
      currentCoordinate: {}, targetCoordinate: {}, status: 'accepted', remainingMeters,
      calculateDistanceMeters: () => distance, PICKUP_TOLERANCE_METERS: 20,
    });
    expect(result.proximityReached).toBe(enabled);
    expect(result.displayRemainingMeters).toBe(displayed);
  });
});
