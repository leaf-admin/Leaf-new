const service = require('../../../services/pricing-h3-read-model-service');

// Counts every Redis command, including the ones queued in pipelines.
function createCountingRedis() {
  const hashes = new Map();
  const strings = new Map();
  const calls = [];
  const hash = (key) => { if (!hashes.has(key)) hashes.set(key, {}); return hashes.get(key); };
  const ops = {
    hget: async (key, field) => hashes.get(key)?.[field] ?? null,
    hset: async (key, field, value) => { hash(key)[field] = String(value); },
    hdel: async (key, field) => { delete hash(key)[field]; },
    hincrby: async (key, field, delta) => { hash(key)[field] = String(Number(hash(key)[field] || 0) + delta); },
    expire: async () => 1,
    set: async (key, value) => { strings.set(key, value); }
  };
  const redis = { calls, hashes, strings };
  for (const [name, fn] of Object.entries(ops)) {
    redis[name] = async (...args) => { calls.push(name); return fn(...args); };
  }
  redis.pipeline = () => {
    const queued = [];
    const api = {};
    for (const [name, fn] of Object.entries(ops)) {
      api[name] = (...args) => { queued.push(() => { calls.push(name); return fn(...args); }); return api; };
    }
    api.exec = async () => { for (const step of queued) await step(); return []; };
    return api;
  };
  return redis;
}

const COPACABANA = { lat: -22.9711, lng: -43.1822 };
const IPANEMA = { lat: -22.9838, lng: -43.2096 };

describe('pricing H3 read model skips unchanged snapshots', () => {
  beforeEach(() => {
    service.resetSnapshotCachesForTests();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T20:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  test('a repeated driver location in the same cell issues no write, a move does', async () => {
    const redis = createCountingRedis();
    const payload = { driverId: 'd1', lat: COPACABANA.lat, lng: COPACABANA.lng, available: true };

    await service.applyDriverSnapshot(redis, payload);
    const firstWrite = redis.calls.length;
    expect(redis.calls).toEqual(expect.arrayContaining(['hget', 'hincrby', 'hset', 'expire', 'set']));

    jest.setSystemTime(new Date('2026-10-15T20:00:01.500Z'));
    await service.applyDriverSnapshot(redis, payload);
    expect(redis.calls.length).toBe(firstWrite); // nothing new: same cell, meta touched < 3 s ago

    jest.setSystemTime(new Date('2026-10-15T20:00:02.000Z'));
    await service.applyDriverSnapshot(redis, { ...payload, lat: IPANEMA.lat, lng: IPANEMA.lng });
    expect(redis.calls.length).toBeGreaterThan(firstWrite);
    const cells = [...redis.hashes.keys()].filter((key) => key.includes(':cell:'));
    const totals = cells.map((key) => Number(redis.hashes.get(key).availableDrivers || 0));
    expect(totals.reduce((a, b) => a + b, 0)).toBe(1); // moved, not double counted
  });

  test('an unchanged snapshot is refreshed after the refresh window and keeps meta fresh', async () => {
    const redis = createCountingRedis();
    const payload = { driverId: 'd1', lat: COPACABANA.lat, lng: COPACABANA.lng, available: true };
    await service.applyDriverSnapshot(redis, payload);

    jest.setSystemTime(new Date('2026-10-15T20:00:04.000Z'));
    redis.calls.length = 0;
    await service.applyDriverSnapshot(redis, payload);
    expect(redis.calls).toEqual(['set']); // meta only, every >= 3 s

    jest.setSystemTime(new Date('2026-10-15T20:00:11.000Z'));
    redis.calls.length = 0;
    await service.applyDriverSnapshot(redis, payload);
    expect(redis.calls).toContain('hget'); // re-validated against Redis after 10 s
  });

  test('a booking status change is never skipped and clearing forgets the cache', async () => {
    const redis = createCountingRedis();
    const booking = { bookingId: 'b1', status: 'IN_PROGRESS', currentLocation: COPACABANA };
    await service.applyBookingSnapshot(redis, booking);
    redis.calls.length = 0;
    await service.applyBookingSnapshot(redis, booking);
    expect(redis.calls).toEqual([]);

    await service.applyBookingSnapshot(redis, { ...booking, status: 'COMPLETED' });
    expect(redis.calls).toContain('hdel');

    await service.clearBookingSnapshot(redis, 'b1');
    redis.calls.length = 0;
    await service.applyBookingSnapshot(redis, booking);
    expect(redis.calls).toContain('hget');
  });
});
