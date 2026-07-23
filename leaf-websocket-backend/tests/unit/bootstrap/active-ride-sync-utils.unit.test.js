jest.mock('../../../utils/active-trip-index', () => ({
  clearActiveTripForDriver: jest.fn(),
  resolveActiveTripForDriver: jest.fn(),
}));

const {
  buildActiveRideSnapshotForUser,
  isTerminalBookingStatus,
} = require('../../../bootstrap/active-ride-sync-utils');
const {
  clearActiveTripForDriver,
  resolveActiveTripForDriver,
} = require('../../../utils/active-trip-index');

describe('active ride sync utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearActiveTripForDriver.mockResolvedValue(true);
    resolveActiveTripForDriver.mockResolvedValue({ tripId: null, customerId: null });
  });

  it('normalizes terminal status aliases used by socket replay guards', () => {
    expect(isTerminalBookingStatus('completed')).toBe(true);
    expect(isTerminalBookingStatus('complete')).toBe(true);
    expect(isTerminalBookingStatus('cancelled')).toBe(true);
    expect(isTerminalBookingStatus('canceled')).toBe(true);
    expect(isTerminalBookingStatus('early_ended_by_rider')).toBe(true);
    expect(isTerminalBookingStatus('interrupted_operational_ended')).toBe(true);
    expect(isTerminalBookingStatus('early_ended_review')).toBe(true);
    expect(isTerminalBookingStatus('started')).toBe(false);
  });

  it('preserves the accepted-driver reassignment contract for a passenger snapshot', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue('booking_1'),
      hgetall: jest.fn().mockResolvedValue({
        status: 'REASSIGNMENT_PENDING',
        state: 'SEARCHING',
        customerId: 'passenger_1',
        pickupLocation: JSON.stringify({ lat: -22.9, lng: -43.2, add: 'Origem' }),
        destinationLocation: JSON.stringify({ lat: -22.91, lng: -43.21, add: 'Destino' }),
        recoveryMode: 'accepted_driver_reassignment',
        operationalContinuation: JSON.stringify({
          status: 'SEARCHING_REPLACEMENT_DRIVER',
          previousDriverId: 'driver_1',
        }),
      }),
    };

    const snapshot = await buildActiveRideSnapshotForUser(
      redis,
      'passenger_1',
      'customer',
    );

    expect(snapshot).toMatchObject({
      hasActiveRide: true,
      bookingId: 'booking_1',
      status: 'REASSIGNMENT_PENDING',
      recoveryMode: 'accepted_driver_reassignment',
      operationalContinuation: {
        status: 'SEARCHING_REPLACEMENT_DRIVER',
        previousDriverId: 'driver_1',
      },
    });
  });

  it('clears a passenger active index that still points to a completed booking', async () => {
    const redis = {
      get: jest.fn(async (key) => {
        if (key === 'customer_active_booking:passenger_1') {
          return 'booking_done';
        }
        return null;
      }),
      del: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({
        status: 'COMPLETED',
        customerId: 'passenger_1',
        driverId: 'driver_1',
        completedAt: '2026-06-23T12:00:00.000Z',
      }),
    };

    const snapshot = await buildActiveRideSnapshotForUser(
      redis,
      'passenger_1',
      'customer',
    );

    expect(snapshot).toEqual(expect.objectContaining({
      hasActiveRide: false,
      bookingId: null,
      terminal: true,
      terminalBookingId: 'booking_done',
      terminalStatus: 'COMPLETED',
      clearedActiveIndex: true,
    }));
    expect(redis.del).toHaveBeenCalledWith('customer_active_booking:passenger_1');
  });

  it('treats bookingStatus as canonical terminal state during active sync', async () => {
    const redis = {
      get: jest.fn(async (key) => {
        if (key === 'customer_active_booking:passenger_1') {
          return 'booking_terminal_alias';
        }
        return null;
      }),
      del: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({
        bookingStatus: 'trip_completed',
        status: '',
        state: '',
        tripStatus: '',
        customerId: 'passenger_1',
        driverId: 'driver_1',
      }),
    };

    const snapshot = await buildActiveRideSnapshotForUser(
      redis,
      'passenger_1',
      'customer',
    );

    expect(snapshot).toEqual(expect.objectContaining({
      hasActiveRide: false,
      bookingId: null,
      terminal: true,
      terminalBookingId: 'booking_terminal_alias',
      terminalStatus: 'TRIP_COMPLETED',
      clearedActiveIndex: true,
    }));
    expect(redis.del).toHaveBeenCalledWith('customer_active_booking:passenger_1');
  });

  it('clears stale driver active trip indexes when the indexed booking is terminal', async () => {
    resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'booking_cancelled',
      customerId: 'passenger_1',
    });
    const redis = {
      get: jest.fn(async (key) => {
        if (key === 'driver_active_notification:driver_1') {
          return 'booking_cancelled';
        }
        return null;
      }),
      del: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({
        status: 'cancelled',
        customerId: 'passenger_1',
        driverId: 'driver_1',
      }),
    };

    const snapshot = await buildActiveRideSnapshotForUser(
      redis,
      'driver_1',
      'driver',
    );

    expect(snapshot).toEqual(expect.objectContaining({
      hasActiveRide: false,
      bookingId: null,
      terminal: true,
      terminalBookingId: 'booking_cancelled',
      terminalStatus: 'CANCELLED',
      clearedActiveIndex: true,
    }));
    expect(redis.del).toHaveBeenCalledWith('driver_active_notification:driver_1');
    expect(clearActiveTripForDriver).toHaveBeenCalledWith(
      redis,
      'driver_1',
      'booking_cancelled',
    );
  });

  it('clears stale passenger active index when an alternate terminal state is indexed', async () => {
    const redis = {
      get: jest.fn(async (key) => {
        if (key === 'customer_active_booking:passenger_1') {
          return 'booking_review';
        }
        return null;
      }),
      del: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({
        status: 'EARLY_ENDED_REVIEW',
        customerId: 'passenger_1',
        driverId: 'driver_1',
      }),
    };

    const snapshot = await buildActiveRideSnapshotForUser(
      redis,
      'passenger_1',
      'customer',
    );

    expect(snapshot).toEqual(expect.objectContaining({
      hasActiveRide: false,
      bookingId: null,
      terminal: true,
      terminalBookingId: 'booking_review',
      terminalStatus: 'EARLY_ENDED_REVIEW',
      clearedActiveIndex: true,
    }));
    expect(redis.del).toHaveBeenCalledWith('customer_active_booking:passenger_1');
  });
});
