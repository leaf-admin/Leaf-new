const mockRedis = { status: 'ready', eval: jest.fn(), get: jest.fn() };

jest.mock('../../../utils/redis-pool', () => ({ getConnection: jest.fn(() => mockRedis) }));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));

const rateLimiterService = require('../../../services/rate-limiter-service');

describe('rateLimiterService.checkRateLimit (single round trip)', () => {
  beforeEach(() => {
    mockRedis.eval.mockReset();
    mockRedis.get.mockReset();
  });

  test('allows and reports the remaining budget with one EVAL', async () => {
    mockRedis.eval.mockResolvedValue([1, 3, -2]);
    const limit = rateLimiterService.limits.updateLocation.limit;

    const result = await rateLimiterService.checkRateLimit('driver_1', 'updateLocation');

    expect(result).toMatchObject({ allowed: true, remaining: limit - 3 });
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    expect(mockRedis.eval.mock.calls[0].slice(1)).toEqual([
      1,
      expect.stringContaining('rate_limit:'),
      rateLimiterService.limits.updateLocation.window,
      limit
    ]);
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  test('denies with the reset time from the key TTL', async () => {
    const limit = rateLimiterService.limits.updateLocation.limit;
    mockRedis.eval.mockResolvedValue([0, limit, 42]);
    const before = Date.now();

    const result = await rateLimiterService.checkRateLimit('driver_1', 'updateLocation');

    expect(result).toMatchObject({ allowed: false, remaining: 0, limit });
    expect(result.resetAt).toBeGreaterThanOrEqual(before + 42000);
  });
});
