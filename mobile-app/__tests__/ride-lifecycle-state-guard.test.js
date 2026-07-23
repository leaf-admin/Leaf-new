import {
  getRideLifecycleOrder,
  shouldIgnoreRideLifecycleEvent,
} from '../src/screens/prototype/rideLifecycleStateGuard';

describe('ride lifecycle state guard', () => {
  it('keeps terminal rides closed against late active or contradictory terminal events', () => {
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideAccepted',
      currentStatus: 'idle',
      nextStatus: 'accepted',
      incomingBookingId: 'booking_1',
      terminalStatus: 'completed',
    })).toEqual({ ignore: true, reason: 'terminal_guard' });

    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideCancelled',
      currentStatus: 'completed',
      nextStatus: 'canceled',
      incomingBookingId: 'booking_1',
      terminalStatus: 'completed',
    })).toEqual({ ignore: true, reason: 'terminal_guard' });
  });

  it('permits idempotent cancellation enrichment without reopening the ride', () => {
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideCancelled',
      currentStatus: 'idle',
      nextStatus: 'canceled',
      incomingBookingId: 'booking_1',
      terminalStatus: 'canceled',
      allowMatchingTerminal: true,
    })).toEqual({ ignore: false, reason: null });
  });

  it('normalizes cancelled spelling before applying terminal guards', () => {
    expect(getRideLifecycleOrder('cancelled')).toBe(getRideLifecycleOrder('canceled'));
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'activeRideSync',
      currentStatus: 'idle',
      nextStatus: 'accepted',
      incomingBookingId: 'booking_cancelled',
      terminalStatus: 'cancelled',
    })).toEqual({ ignore: true, reason: 'terminal_guard' });
  });

  it('normalizes terminal backend aliases before applying terminal guards', () => {
    expect(getRideLifecycleOrder('trip_completed')).toBe(getRideLifecycleOrder('completed'));
    expect(getRideLifecycleOrder('no_drivers_available')).toBe(getRideLifecycleOrder('no_drivers'));

    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideAccepted',
      currentStatus: 'idle',
      nextStatus: 'accepted',
      incomingBookingId: 'booking_completed_alias',
      terminalStatus: 'trip_completed',
    })).toEqual({ ignore: true, reason: 'terminal_guard' });

    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideAccepted',
      currentStatus: 'idle',
      nextStatus: 'accepted',
      incomingBookingId: 'booking_no_driver_alias',
      terminalStatus: 'no_drivers_available',
    })).toEqual({ ignore: true, reason: 'terminal_guard' });
  });

  it('rejects events for another booking while a ride is active', () => {
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideCancelled',
      currentStatus: 'started',
      nextStatus: 'canceled',
      activeBookingId: 'booking_active',
      incomingBookingId: 'booking_old',
    })).toEqual({ ignore: true, reason: 'different_active_booking' });
  });

  it('rejects completion for another booking while the current ride is active', () => {
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'tripCompleted',
      currentStatus: 'started',
      nextStatus: 'completed',
      activeBookingId: 'booking_active',
      incomingBookingId: 'booking_old',
    })).toEqual({ ignore: true, reason: 'different_active_booking' });
  });

  it('allows the explicit operational reassignment branch while rejecting ordinary backward movement', () => {
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideOperationalContinuationSearching',
      currentStatus: 'operational_interrupted',
      nextStatus: 'searching_replacement',
      activeBookingId: 'booking_1',
      incomingBookingId: 'booking_1',
    })).toEqual({ ignore: false, reason: null });

    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideAccepted',
      currentStatus: 'arrived',
      nextStatus: 'accepted',
      activeBookingId: 'booking_1',
      incomingBookingId: 'booking_1',
    })).toEqual({ ignore: true, reason: 'lifecycle_order_regression' });
  });

  it('rejects active-state regressions even when backend aliases are used', () => {
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideAccepted',
      currentStatus: 'trip_started',
      nextStatus: 'driver_accepted',
      activeBookingId: 'booking_alias',
      incomingBookingId: 'booking_alias',
    })).toEqual({ ignore: true, reason: 'lifecycle_order_regression' });
  });

  it('allows the server-authorized accepted-driver recovery without allowing a generic regression', () => {
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'rideAcceptedDriverRecovery',
      currentStatus: 'accepted',
      nextStatus: 'searching_replacement',
      activeBookingId: 'booking_1',
      incomingBookingId: 'booking_1',
    })).toEqual({ ignore: false, reason: null });

    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'activeRideSync',
      currentStatus: 'accepted',
      nextStatus: 'searching_replacement',
      activeBookingId: 'booking_1',
      incomingBookingId: 'booking_1',
    })).toEqual({ ignore: true, reason: 'lifecycle_order_regression' });
  });

  it('keeps the lifecycle order stable for normal forward transitions', () => {
    expect(getRideLifecycleOrder('accepted')).toBeLessThan(getRideLifecycleOrder('arrived'));
    expect(shouldIgnoreRideLifecycleEvent({
      eventName: 'tripStarted',
      currentStatus: 'arrived',
      nextStatus: 'started',
      activeBookingId: 'booking_1',
      incomingBookingId: 'booking_1',
    })).toEqual({ ignore: false, reason: null });
  });
});
