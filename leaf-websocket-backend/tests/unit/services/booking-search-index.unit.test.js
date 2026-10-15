jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const bookingSearchIndex = require('../../../services/booking-search-index');

function createRedis(hashKeys) {
  const index = new Set();
  return {
    index,
    scan: jest.fn(async () => ['0', [...hashKeys]]),
    sadd: jest.fn(async (_key, ...ids) => { ids.forEach((id) => index.add(id)); return ids.length; }),
    srem: jest.fn(async (_key, ...ids) => { ids.forEach((id) => index.delete(id)); return ids.length; }),
    smembers: jest.fn(async () => [...index])
  };
}

describe('booking-search-index', () => {
  beforeEach(() => bookingSearchIndex.resetReconcileClockForTests());

  test('reconciles with one scan, then reads only the index until the interval passes', async () => {
    const redis = createRedis(['booking_search:b1']);
    const t0 = Date.parse('2026-10-15T17:00:00.000Z');

    await expect(bookingSearchIndex.listSearchKeys(redis, { now: t0 })).resolves.toEqual(['booking_search:b1']);
    expect(redis.scan).toHaveBeenCalledTimes(1);

    await bookingSearchIndex.addToIndex(redis, 'b2');
    await expect(bookingSearchIndex.listSearchKeys(redis, { now: t0 + 10000 })).resolves.toEqual(['booking_search:b1', 'booking_search:b2']);
    expect(redis.scan).toHaveBeenCalledTimes(1);

    await bookingSearchIndex.listSearchKeys(redis, { now: t0 + 61000 });
    expect(redis.scan).toHaveBeenCalledTimes(2);
  });

  test('the reconcile picks up searches that were never indexed and keeps indexed ones', async () => {
    const redis = createRedis(['booking_search:legacy']);
    await bookingSearchIndex.addToIndex(redis, 'fresh');

    const keys = await bookingSearchIndex.listSearchKeys(redis, { now: Date.now() });

    expect(keys.sort()).toEqual(['booking_search:fresh', 'booking_search:legacy']);
    expect(redis.index.has('legacy')).toBe(true);
  });

  test('removeFromIndex drops gone searches and ignores empty input', async () => {
    const redis = createRedis([]);
    await bookingSearchIndex.addToIndex(redis, 'b1');
    await bookingSearchIndex.removeFromIndex(redis, []);
    expect(redis.srem).not.toHaveBeenCalled();
    await bookingSearchIndex.removeFromIndex(redis, ['b1']);
    expect(redis.index.size).toBe(0);
  });

  test('the index key is outside the booking_search:* pattern', () => {
    expect(bookingSearchIndex.INDEX_KEY.startsWith('booking_search:')).toBe(false);
  });
});

describe('booking-search-index failure isolation', () => {
  test('addToIndex never throws, so a search still starts when the index write fails', async () => {
    const redis = { sadd: jest.fn().mockRejectedValue(new Error('redis busy')) };
    await expect(bookingSearchIndex.addToIndex(redis, 'b1')).resolves.toBeUndefined();
  });
});
