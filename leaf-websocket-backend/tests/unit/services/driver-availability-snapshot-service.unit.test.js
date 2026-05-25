jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

const redisPool = require('../../../utils/redis-pool');
const {
  buildApproxSnapshotCacheKey,
  countNearbyEligibleDriversApprox
} = require('../../../services/driver-availability-snapshot-service');

describe('driver-availability-snapshot-service', () => {
  let redis;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      georadius: jest.fn().mockResolvedValue(['driver_1', 'driver_2'])
    };
    redisPool.getConnection.mockReturnValue(redis);
  });

  it('builds a stable cache key for the operational snapshot', () => {
    expect(buildApproxSnapshotCacheKey({
      regionHash: 'abc123',
      radiusKm: 5,
      limit: 12
    })).toBe('driver_availability_snapshot:abc123:5:12');
  });

  it('uses redis geo count and caches the approximate availability', async () => {
    const result = await countNearbyEligibleDriversApprox(
      { lat: -23.55, lng: -46.63 },
      { regionHash: 'abc123', radiusKm: 5, limit: 12, cacheTtlSec: 2 }
    );

    expect(result.success).toBe(true);
    expect(result.availableDrivers).toBe(2);
    expect(result.source).toBe('geo_count');
    expect(redis.georadius).toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledWith(
      'driver_availability_snapshot:abc123:5:12',
      2,
      expect.any(String)
    );
  });

  it('returns the cached snapshot when it is still fresh', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify({
      availableDrivers: 4,
      regionHash: 'abc123',
      radiusKm: 5
    }));

    const result = await countNearbyEligibleDriversApprox(
      { lat: -23.55, lng: -46.63 },
      { regionHash: 'abc123', radiusKm: 5, limit: 12 }
    );

    expect(result.success).toBe(true);
    expect(result.availableDrivers).toBe(4);
    expect(result.source).toBe('cache');
    expect(redis.georadius).not.toHaveBeenCalled();
  });
});
