jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('driver-lock-manager', () => {
  let redis;
  let driverLockManager;

  beforeEach(() => {
    jest.resetModules();

    redis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      hmget: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      keys: jest.fn(),
      ttl: jest.fn()
    };

    const redisPool = require('../../../utils/redis-pool');
    redisPool.getConnection.mockReturnValue(redis);

    driverLockManager = require('../../../services/driver-lock-manager');
  });

  it('returns the lock when the linked booking is still active', async () => {
    redis.get.mockResolvedValue('booking_active');
    redis.hmget.mockResolvedValue(['ACCEPTED', 'ACCEPTED']);

    const result = await driverLockManager.isDriverLocked('driver_active');

    expect(result).toEqual({
      isLocked: true,
      bookingId: 'booking_active'
    });
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('auto-releases stale locks that point to completed bookings', async () => {
    redis.get.mockResolvedValue('booking_completed');
    redis.hmget.mockResolvedValue(['COMPLETED', 'COMPLETED']);
    redis.del.mockResolvedValue(1);

    const result = await driverLockManager.isDriverLocked('driver_completed');

    expect(redis.del).toHaveBeenCalledWith('driver_lock:driver_completed');
    expect(result).toEqual({
      isLocked: false,
      bookingId: null,
      recovered: true,
      staleBookingId: 'booking_completed'
    });
  });

  it('auto-releases stale locks when the booking no longer exists', async () => {
    redis.get.mockResolvedValue('booking_missing');
    redis.hmget.mockResolvedValue([null, null]);
    redis.del.mockResolvedValue(1);

    const result = await driverLockManager.isDriverLocked('driver_missing');

    expect(redis.del).toHaveBeenCalledWith('driver_lock:driver_missing');
    expect(result).toEqual({
      isLocked: false,
      bookingId: null,
      recovered: true,
      staleBookingId: 'booking_missing'
    });
  });
});
