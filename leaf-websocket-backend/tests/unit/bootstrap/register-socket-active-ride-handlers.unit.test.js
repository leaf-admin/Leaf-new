const TERMINAL_STATUSES = new Set([
  'COMPLETE',
  'COMPLETED',
  'CANCELLED',
  'CANCELED',
  'REJECTED',
  'NO_DRIVERS_AVAILABLE',
  'EXPIRED',
  'SUPERSEDED'
]);

jest.mock('../../../bootstrap/active-ride-sync-utils', () => ({
  buildActiveRideSnapshotForUser: jest.fn(),
  isTerminalBookingStatus: jest.fn((value) => TERMINAL_STATUSES.has(String(value || '').trim().toUpperCase()))
}));

const {
  buildActiveRideSnapshotForUser
} = require('../../../bootstrap/active-ride-sync-utils');
const registerSocketActiveRideHandlers = require('../../../bootstrap/register-socket-active-ride-handlers');

describe('registerSocketActiveRideHandlers', () => {
  let handlers;
  let socket;
  let redis;
  let gradualExpander;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};
    socket = {
      id: 'socket_1',
      userId: 'customer_1',
      userType: 'customer',
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      emit: jest.fn()
    };
    redis = {
      status: 'ready',
      connect: jest.fn(),
      hget: jest.fn(),
      hgetall: jest.fn(),
      hset: jest.fn(),
      hdel: jest.fn(),
      del: jest.fn()
    };
    gradualExpander = {
      reconcileExpiredSearchForCustomer: jest.fn().mockResolvedValue({
        reconciled: true,
        bookingId: 'booking_1'
      })
    };
    buildActiveRideSnapshotForUser
      .mockResolvedValueOnce({
        hasActiveRide: true,
        bookingId: 'booking_1',
        status: 'SEARCHING'
      })
      .mockResolvedValueOnce({
        hasActiveRide: false,
        bookingId: null
      });

    registerSocketActiveRideHandlers({
      socket,
      io: { to: jest.fn() },
      redisPool: { getConnection: jest.fn(() => redis) },
      gradualExpander,
      logStructured: jest.fn(),
      logError: jest.fn()
    });
  });

  it('reconciles an expired passenger search before returning the active ride snapshot', async () => {
    await handlers.syncActiveRide({});

    expect(gradualExpander.reconcileExpiredSearchForCustomer).toHaveBeenCalledWith(
      'customer_1'
    );
    expect(buildActiveRideSnapshotForUser).toHaveBeenCalledWith(
      redis,
      'customer_1',
      'customer'
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'activeRideSync',
      expect.objectContaining({
        success: true,
        hasActiveRide: false
      })
    );
  });

  it('does not run search reconciliation for terminal active ride sync snapshots', async () => {
    buildActiveRideSnapshotForUser.mockReset();
    buildActiveRideSnapshotForUser.mockResolvedValue({
      hasActiveRide: false,
      bookingId: null,
      terminal: true,
      terminalBookingId: 'booking_completed',
      status: 'COMPLETED',
      terminalStatus: 'COMPLETED',
      clearedActiveIndex: true
    });
    gradualExpander.reconcileExpiredSearchForCustomer.mockClear();
    socket.emit.mockClear();

    await handlers.syncActiveRide({});

    expect(gradualExpander.reconcileExpiredSearchForCustomer).not.toHaveBeenCalled();
    expect(buildActiveRideSnapshotForUser).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith(
      'activeRideSync',
      expect.objectContaining({
        success: true,
        hasActiveRide: false,
        bookingId: null,
        terminal: true,
        terminalBookingId: 'booking_completed',
        terminalStatus: 'COMPLETED'
      })
    );
  });

  it('blocks legacy destination changes when the canonical booking is terminal', async () => {
    redis.hget.mockResolvedValue(JSON.stringify({
      bookingId: 'booking_completed',
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'STARTED',
      estimate: 87.5,
      distance: 10,
      pickup: { lat: -22.9, lng: -43.2 },
      currentLocation: { lat: -22.9, lng: -43.2 }
    }));
    redis.hgetall.mockResolvedValue({
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'COMPLETED'
    });
    socket.emit.mockClear();

    await handlers.changeDestination({
      bookingId: 'booking_completed',
      newDestination: { lat: -22.91, lng: -43.21, add: 'Destino' }
    });

    expect(redis.hdel).toHaveBeenCalledWith('bookings:active', 'booking_completed');
    expect(redis.hset).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'changeDestinationError',
      expect.objectContaining({
        success: false,
        code: 'RIDE_TERMINAL',
        terminalStatus: 'COMPLETED'
      })
    );
  });

  it('blocks legacy new-driver reassignment from a socket outside the ride scope', async () => {
    socket.userId = 'intruder_1';
    redis.hget.mockResolvedValue(JSON.stringify({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'STARTED'
    }));
    redis.hgetall.mockResolvedValue({
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'STARTED'
    });
    socket.emit.mockClear();

    await handlers.findNewDriver({
      bookingId: 'booking_1',
      problemType: 'vehicle_defect',
      partialPayment: 12.5
    });

    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.hset).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'findNewDriverError',
      expect.objectContaining({
        success: false,
        code: 'RIDE_SCOPE_DENIED'
      })
    );
  });

  it('blocks legacy partial-payment calculation for terminal rides before fee math runs', async () => {
    redis.hget.mockResolvedValue(JSON.stringify({
      bookingId: 'booking_canceled',
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'CANCELED',
      estimate: 80
    }));
    redis.hgetall.mockResolvedValue({
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'CANCELED'
    });
    socket.emit.mockClear();

    await handlers.calculatePartialPayment({ bookingId: 'booking_canceled' });

    expect(redis.hdel).toHaveBeenCalledWith('bookings:active', 'booking_canceled');
    expect(socket.emit).toHaveBeenCalledWith(
      'partialPaymentError',
      expect.objectContaining({
        success: false,
        code: 'RIDE_TERMINAL',
        terminalStatus: 'CANCELED'
      })
    );
  });
});
