jest.useFakeTimers();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn()
}));

jest.mock('../../../services/gradual-radius-expander', () => {
  return jest.fn().mockImplementation(() => ({
    stopSearch: jest.fn().mockResolvedValue(undefined)
  }));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    PENDING: 'PENDING',
    SEARCHING: 'SEARCHING',
    EXPANDED: 'EXPANDED',
    NOTIFIED: 'NOTIFIED',
    AWAITING_RESPONSE: 'AWAITING_RESPONSE',
    REASSIGNMENT_PENDING: 'REASSIGNMENT_PENDING'
  },
  getBookingState: jest.fn(),
  updateBookingState: jest.fn().mockResolvedValue(true),
  isTerminalStateValue: jest.fn((value) => [
    'COMPLETE',
    'COMPLETED',
    'CANCELED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED',
    'SUPERSEDED',
    'NO_DRIVERS_AVAILABLE',
    'NO_DRIVERS_FOUND',
    'EARLY_ENDED_BY_RIDER',
    'INTERRUPTED_OPERATIONAL_ENDED',
    'EARLY_ENDED_REVIEW'
  ].includes(String(value || '').trim().toUpperCase()))
}));

jest.mock('../../../services/ride-queue-manager', () => ({
  dequeueRide: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  releaseLock: jest.fn().mockResolvedValue(true)
}));

const mockClearActiveNotification = jest.fn().mockResolvedValue(undefined);
const mockCancelDriverTimeout = jest.fn();

jest.mock('../../../services/driver-notification-dispatcher', () => {
  return jest.fn().mockImplementation(() => ({
    clearActiveNotification: mockClearActiveNotification,
    cancelDriverTimeout: mockCancelDriverTimeout
  }));
});

jest.mock('../../../services/event-sourcing', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined),
  EVENT_TYPES: {
    RIDE_REJECTED: 'RIDE_REJECTED'
  }
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../../services/fcm-service', () => {
  return jest.fn().mockImplementation(() => ({}));
});

describe('response-handler rejection cooldown', () => {
  let ResponseHandler;
  let redis;
  let RideStateManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.DRIVER_REOFFER_COOLDOWN_SECONDS = '1';

    redis = {
      hincrby: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn().mockResolvedValue('SEARCHING'),
      hdel: jest.fn().mockResolvedValue(1)
    };

    require('../../../utils/redis-pool').getConnection.mockReturnValue(redis);
    RideStateManager = require('../../../services/ride-state-manager');
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.SEARCHING);

    ResponseHandler = require('../../../services/response-handler');
  });

  afterEach(() => {
    delete process.env.DRIVER_REOFFER_COOLDOWN_SECONDS;
    jest.clearAllTimers();
  });

  it('retries dispatch automatically after the first rejection cooldown ends', async () => {
    const handler = new ResponseHandler({
      to: jest.fn(() => ({ emit: jest.fn() }))
    });
    handler.sendNextRideToDriver = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ bookingId: 'booking_1' });

    const rejectionPromise = handler.handleRejectRide('driver_1', 'booking_1', 'Recusa QA');
    await jest.advanceTimersByTimeAsync(50);
    await rejectionPromise;

    expect(handler.sendNextRideToDriver).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'ride_reoffer_cooldown:booking_1:driver_1',
      '1',
      'EX',
      1
    );

    await jest.advanceTimersByTimeAsync(1000);

    expect(redis.srem).toHaveBeenCalledWith('ride_notifications:booking_1', 'driver_1');
    expect(handler.sendNextRideToDriver).toHaveBeenCalledTimes(2);
  });

  it('restores the previous search state when a driver rejects during awaiting response', async () => {
    const handler = new ResponseHandler({
      to: jest.fn(() => ({ emit: jest.fn() }))
    });
    handler.sendNextRideToDriver = jest.fn().mockResolvedValue(null);
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.AWAITING_RESPONSE);
    redis.hget.mockResolvedValue('EXPANDED');

    const rejectionPromise = handler.handleRejectRide('driver_1', 'booking_1', 'Recusa QA');
    await jest.advanceTimersByTimeAsync(50);
    await rejectionPromise;

    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      redis,
      'booking_1',
      RideStateManager.STATES.EXPANDED,
      expect.objectContaining({
        rejectedBy: 'driver_1'
      })
    );
    expect(redis.hdel).toHaveBeenCalledWith(
      'booking:booking_1',
      'awaitingResponseDriverId',
      'awaitingResponseAt'
    );
  });

  it('does not dispatch terminal alternate bookings to drivers', async () => {
    const handler = new ResponseHandler({
      to: jest.fn(() => ({ emit: jest.fn() }))
    });
    redis.get = jest.fn().mockResolvedValue(null);

    const current = await handler.isBookingCurrentForCustomer('booking_review', {
      customerId: 'customer_1',
      status: 'EARLY_ENDED_REVIEW'
    });

    expect(current).toBe(false);
  });
});
