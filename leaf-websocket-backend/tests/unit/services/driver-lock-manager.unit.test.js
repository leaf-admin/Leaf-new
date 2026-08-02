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
      eval: jest.fn(),
      keys: jest.fn(),
      ttl: jest.fn()
    };

    const redisPool = require('../../../utils/redis-pool');
    redisPool.getConnection.mockReturnValue(redis);

    driverLockManager = require('../../../services/driver-lock-manager');
  });

  it('returns the lock when the linked booking is still active', async () => {
    redis.eval.mockResolvedValue([1, 'booking_active']);

    const result = await driverLockManager.isDriverLocked('driver_active');

    expect(result).toEqual({
      isLocked: true,
      bookingId: 'booking_active'
    });
    expect(redis.eval.mock.calls[0][0]).toContain("redis.call('HGET', bookingKey, 'state')");
  });

  it('auto-releases stale locks that point to completed bookings', async () => {
    redis.eval.mockResolvedValue([2, 'booking_completed']);

    const result = await driverLockManager.isDriverLocked('driver_completed');

    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'driver_lock:driver_completed');
    expect(result).toEqual({
      isLocked: false,
      bookingId: null,
      recovered: true,
      staleBookingId: 'booking_completed'
    });
  });

  it('auto-releases stale locks that point to alternate terminal bookings', async () => {
    redis.eval.mockResolvedValue([2, 'booking_review']);

    const result = await driverLockManager.isDriverLocked('driver_review');

    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'driver_lock:driver_review');
    expect(result).toEqual({
      isLocked: false,
      bookingId: null,
      recovered: true,
      staleBookingId: 'booking_review'
    });
  });

  it('auto-releases stale locks that point to no-driver bookings', async () => {
    redis.eval.mockResolvedValue([2, 'booking_no_driver']);

    const result = await driverLockManager.isDriverLocked('driver_no_driver');

    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'driver_lock:driver_no_driver');
    expect(result).toEqual({
      isLocked: false,
      bookingId: null,
      recovered: true,
      staleBookingId: 'booking_no_driver'
    });
  });

  it('auto-releases stale locks when the booking no longer exists', async () => {
    redis.eval.mockResolvedValue([2, 'booking_missing']);

    const result = await driverLockManager.isDriverLocked('driver_missing');

    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'driver_lock:driver_missing');
    expect(result).toEqual({
      isLocked: false,
      bookingId: null,
      recovered: true,
      staleBookingId: 'booking_missing'
    });
  });

  it('releases only the booking that still owns the driver lock', async () => {
    redis.eval.mockResolvedValue(-1);

    await expect(driverLockManager.releaseLock('driver_1', 'booking_old')).resolves.toBe(false);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("tostring(current) ~= tostring(ARGV[1])"),
      1,
      'driver_lock:driver_1',
      'booking_old'
    );
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('renews only the booking that still owns the driver lock', async () => {
    redis.eval.mockResolvedValue(-1);

    await expect(driverLockManager.renewLock('driver_1', 3600, 'booking_old')).resolves.toBe(false);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE', KEYS[1], ARGV[2])"),
      1,
      'driver_lock:driver_1',
      'booking_old',
      '3600'
    );
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('blocks an unbound release in production before touching Redis', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(driverLockManager.releaseLock('driver_1')).resolves.toBe(false);
      expect(redis.eval).not.toHaveBeenCalled();
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('blocks an unbound renewal in production before touching Redis', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(driverLockManager.renewLock('driver_1', 3600)).resolves.toBe(false);
      expect(redis.eval).not.toHaveBeenCalled();
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
