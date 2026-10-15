jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));
jest.mock('../../../services/ride-state-manager', () => ({
  STATES: { SEARCHING: 'SEARCHING' },
  getBookingState: jest.fn(async (_redis, bookingId) => (bookingId === 'stale_state' ? 'COMPLETED' : 'SEARCHING'))
}));
jest.mock('../../../utils/redis-pool', () => ({ getConnection: jest.fn(() => ({})) }));
jest.mock('../../../services/gradual-radius-expander', () => jest.fn());
jest.mock('../../../services/driver-notification-dispatcher', () => jest.fn());

const RadiusExpansionManager = require('../../../services/radius-expansion-manager');
const bookingSearchIndex = require('../../../services/booking-search-index');

describe('RadiusExpansionManager.findSearchingBookings with the search index', () => {
  beforeEach(() => bookingSearchIndex.resetReconcileClockForTests());

  test('reads indexed searches, keeps SEARCHING ones and prunes gone hashes', async () => {
    const hashes = {
      'booking_search:live': { state: 'SEARCHING' },
      'booking_search:stale_state': { state: 'SEARCHING' },
      'booking_search:stopped': { state: 'STOPPED' }
    };
    const index = new Set(['live', 'stale_state', 'stopped', 'gone']);
    const redis = {
      scan: jest.fn(async () => ['0', Object.keys(hashes)]),
      sadd: jest.fn(async (_key, ...ids) => ids.forEach((id) => index.add(id))),
      srem: jest.fn(async (_key, ...ids) => ids.forEach((id) => index.delete(id))),
      smembers: jest.fn(async () => [...index]),
      hgetall: jest.fn(async (key) => hashes[key] || {})
    };
    const fakeThis = { redis, config: { maxBookingsPerCycle: 300 } };

    const found = await RadiusExpansionManager.prototype.findSearchingBookings.call(fakeThis);

    expect(found).toEqual(['live']);
    expect(index.has('gone')).toBe(false);

    // Next cycle inside the reconcile interval: no keyspace scan.
    redis.scan.mockClear();
    await RadiusExpansionManager.prototype.findSearchingBookings.call(fakeThis);
    expect(redis.scan).not.toHaveBeenCalled();
  });
});
