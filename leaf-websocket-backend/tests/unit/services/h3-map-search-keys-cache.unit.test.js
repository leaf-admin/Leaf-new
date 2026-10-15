const { H3MapService } = require('../../../services/h3-map-service');
const bookingSearchIndex = require('../../../services/booking-search-index');

const BBOX = { minLat: -23.1, maxLat: -22.8, minLng: -43.6, maxLng: -43.1 };

function createRedis(searches) {
  const index = new Set();
  return {
    index,
    scan: jest.fn(async () => ['0', Object.keys(searches)]),
    sadd: jest.fn(async (_key, ...ids) => { ids.forEach((id) => index.add(id)); }),
    srem: jest.fn(async (_key, ...ids) => { ids.forEach((id) => index.delete(id)); }),
    smembers: jest.fn(async () => [...index]),
    pipeline() {
      const keys = [];
      return {
        hmget(key) { keys.push(key); return this; },
        exec: async () => keys.map((key) => {
          const hash = searches[key];
          return [null, hash ? [hash.state, hash.pickupLocation, hash.createdAt] : [null, null, null]];
        })
      };
    }
  };
}

function search(state) {
  return {
    state,
    pickupLocation: JSON.stringify({ lat: -22.92, lng: -43.40 }),
    createdAt: String(Date.now())
  };
}

describe('H3MapService open search keys', () => {
  beforeEach(() => bookingSearchIndex.resetReconcileClockForTests());
  afterEach(() => jest.useRealTimers());

  test('reuses the key list for 30 s, reads each search fresh and prunes gone ones', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T16:00:00.000Z'));
    const searches = { 'booking_search:b1': search('SEARCHING'), 'booking_search:b2': search('SEARCHING') };
    const redis = createRedis(searches);
    const service = new H3MapService();

    expect((await service.collectOpenRequests(redis, BBOX)).map((r) => r.bookingId)).toEqual(['b1', 'b2']);
    expect(redis.scan).toHaveBeenCalledTimes(1); // first call reconciles the index

    // b2 finished (hash deleted); b3 started and was indexed by its writer.
    delete searches['booking_search:b2'];
    searches['booking_search:b3'] = search('SEARCHING');
    await bookingSearchIndex.addToIndex(redis, 'b3');

    jest.setSystemTime(new Date('2026-10-15T16:00:10.000Z'));
    expect((await service.collectOpenRequests(redis, BBOX)).map((r) => r.bookingId)).toEqual(['b1']);
    expect(redis.index.has('b2')).toBe(false);

    jest.setSystemTime(new Date('2026-10-15T16:00:31.000Z'));
    expect((await service.collectOpenRequests(redis, BBOX)).map((r) => r.bookingId)).toEqual(['b1', 'b3']);
    expect(redis.scan).toHaveBeenCalledTimes(1); // index read, no new scan inside the reconcile interval
  });

  test('concurrent polls share one lookup', async () => {
    const redis = createRedis({ 'booking_search:b1': search('SEARCHING') });
    const service = new H3MapService();

    await Promise.all([1, 2, 3].map(() => service.collectOpenRequests(redis, BBOX)));

    expect(redis.scan).toHaveBeenCalledTimes(1);
  });
});
