const { H3MapService } = require('../../../services/h3-map-service');

const BBOX = { minLat: -23.1, maxLat: -22.8, minLng: -43.6, maxLng: -43.1 };

function createRedis(searches) {
  const scan = jest.fn(async () => ['0', Object.keys(searches)]);
  return {
    scan,
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

describe('H3MapService open search key cache', () => {
  afterEach(() => jest.useRealTimers());

  test('reuses the key list between polls but reads each search fresh', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T16:00:00.000Z'));
    const searches = { 'booking_search:b1': search('SEARCHING'), 'booking_search:b2': search('SEARCHING') };
    const redis = createRedis(searches);
    const service = new H3MapService();

    expect((await service.collectOpenRequests(redis, BBOX)).map((r) => r.bookingId)).toEqual(['b1', 'b2']);

    // b2 finished (hash deleted) and b3 started: b2 disappears at once, b3 waits for the next scan.
    delete searches['booking_search:b2'];
    searches['booking_search:b3'] = search('SEARCHING');
    jest.setSystemTime(new Date('2026-10-15T16:00:10.000Z'));
    expect((await service.collectOpenRequests(redis, BBOX)).map((r) => r.bookingId)).toEqual(['b1']);
    expect(redis.scan).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-10-15T16:00:31.000Z'));
    expect((await service.collectOpenRequests(redis, BBOX)).map((r) => r.bookingId)).toEqual(['b1', 'b3']);
    expect(redis.scan).toHaveBeenCalledTimes(2);
  });

  test('concurrent polls share one scan', async () => {
    const redis = createRedis({ 'booking_search:b1': search('SEARCHING') });
    const service = new H3MapService();

    await Promise.all([1, 2, 3].map(() => service.collectOpenRequests(redis, BBOX)));

    expect(redis.scan).toHaveBeenCalledTimes(1);
  });
});
