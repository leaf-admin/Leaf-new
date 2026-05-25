jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordIdempotency: jest.fn()
  }
}));

const redisPool = require('../../../utils/redis-pool');
const idempotencyService = require('../../../services/idempotency-service');

describe('idempotency-service beginRequest', () => {
  let redis;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      exists: jest.fn().mockResolvedValue(1),
      setex: jest.fn().mockResolvedValue('OK'),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1)
    };
    redisPool.getConnection.mockReturnValue(redis);
    idempotencyService.redis = null;
  });

  it('starts a new request when the lock does not exist', async () => {
    const result = await idempotencyService.beginRequest('customer:createBooking:test');

    expect(result.isNew).toBe(true);
    expect(result.disposition).toBe('started');
  });

  it('returns cached result for a duplicate request when cache already exists', async () => {
    redis.set.mockResolvedValueOnce(null);
    redis.get.mockResolvedValueOnce(JSON.stringify({ bookingId: 'booking_1' }));

    const result = await idempotencyService.beginRequest('customer:createBooking:test');

    expect(result.isNew).toBe(false);
    expect(result.disposition).toBe('cached');
    expect(result.cachedResult).toEqual({ bookingId: 'booking_1' });
  });

  it('waits for a cached result to appear while a matching request is still in flight', async () => {
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({ bookingId: 'booking_joined' }));
    redis.exists
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const result = await idempotencyService.waitForCachedResult('customer:createBooking:test', {
      waitMs: 250,
      pollIntervalMs: 1
    });

    expect(result).toEqual({ bookingId: 'booking_joined' });
  });

  it('releases an in-flight lock explicitly after a failed attempt', async () => {
    await idempotencyService.releaseInflight('customer:createBooking:test');

    expect(redis.del).toHaveBeenCalledWith('idempotency:customer:createBooking:test');
  });
});
