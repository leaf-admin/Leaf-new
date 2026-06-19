jest.mock('../../../bootstrap/active-ride-sync-utils', () => ({
  buildActiveRideSnapshotForUser: jest.fn()
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
      connect: jest.fn()
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
});
