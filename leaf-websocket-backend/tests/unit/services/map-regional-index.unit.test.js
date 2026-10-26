const region = require('../../../services/map-regional-index');

describe('regional map admission and readiness', () => {
  const previous = { writes: process.env.ENABLE_H3_REGIONAL_WRITES, reads: process.env.ENABLE_H3_REGIONAL_READS };
  beforeEach(() => {
    delete process.env.ENABLE_H3_REGIONAL_WRITES;
    delete process.env.ENABLE_H3_REGIONAL_READS;
  });
  afterAll(() => {
    for (const [name, value] of [['ENABLE_H3_REGIONAL_WRITES', previous.writes], ['ENABLE_H3_REGIONAL_READS', previous.reads]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  test('is additive and disabled until separately activated', async () => {
    const redis = { eval: jest.fn(), hmget: jest.fn() };
    await region.indexTrip(redis, { bookingId: 'a', status: 'STARTED', pickup: { lat: -23, lng: -46 } });
    await region.indexSearch(redis, 'a');
    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.hmget).not.toHaveBeenCalled();
    expect(region.enabledReads()).toBe(false);
  });

  test.each([null, '{}', '{"schema":1,"generation":"old"}'])('rejects unattested dataset %s', async raw => {
    process.env.ENABLE_H3_REGIONAL_WRITES = 'true';
    await expect(region.assertReady({ mget: async () => [raw, 'current'] })).rejects.toMatchObject({ statusCode: 503 });
  });

  test('requires writers even with a matching marker', async () => {
    const redis = { mget: async () => ['{"schema":1,"generation":"current"}', 'current'] };
    await expect(region.assertReady(redis)).rejects.toMatchObject({ statusCode: 503 });
    process.env.ENABLE_H3_REGIONAL_WRITES = 'true';
    await expect(region.assertReady(redis)).resolves.toBeUndefined();
  });

  test('failed projection invalidates readiness without claiming a canonical write', async () => {
    process.env.ENABLE_H3_REGIONAL_WRITES = 'true';
    const redis = { hmget: jest.fn().mockRejectedValue(new Error('redis error')), del: jest.fn().mockResolvedValue(1) };
    await expect(region.indexSearch(redis, 'a')).rejects.toThrow('redis error');
    expect(redis.del).toHaveBeenCalledWith(region.READY_KEY);
  });

  test('dense viewport is rejected before hydration', async () => {
    const redis = { geosearch: async () => Array.from({ length: 2001 }, (_, i) => String(i)), hmget: jest.fn() };
    await expect(region.read(redis, 'search', { centerLng: -46, centerLat: -23, widthKm: 1, heightKm: 1 }))
      .rejects.toMatchObject({ code: 'MAP_REGION_DENSE' });
    expect(redis.hmget).not.toHaveBeenCalled();
  });
});
