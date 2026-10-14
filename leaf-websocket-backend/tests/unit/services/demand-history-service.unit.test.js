const demandHistoryService = require('../../../services/demand-history-service');

const { helpers } = demandHistoryService;

function memoryRedis() {
  const hashes = new Map();
  const strings = new Map();
  return {
    hashes,
    strings,
    async set(key, value, ...args) {
      if (args.includes('NX') && strings.has(key)) return null;
      strings.set(key, value);
      return 'OK';
    },
    async get(key) {
      return strings.has(key) ? strings.get(key) : null;
    },
    async hincrby(key, field, by) {
      const hash = hashes.get(key) || {};
      hash[field] = String(Number(hash[field] || 0) + by);
      hashes.set(key, hash);
      return Number(hash[field]);
    },
    async hgetall(key) {
      return hashes.get(key) || {};
    },
    async expire() {
      return 1;
    },
  };
}

const COPACABANA = { lat: -22.9711, lng: -43.1822 };
const BARRA = { lat: -23.0004, lng: -43.3659 };

describe('demand history service', () => {
  it('buckets by Rio local date and hour', () => {
    // 02:30 UTC is 23:30 of the previous day in Rio.
    expect(helpers.localParts(new Date('2026-10-14T02:30:00Z'))).toEqual({ dateKey: '2026-10-13', hour: 23 });
  });

  it('counts a booking once even when it is retried', async () => {
    const redis = memoryRedis();
    const at = new Date('2026-10-14T15:00:00Z');
    const first = await demandHistoryService.recordRideRequest(redis, { bookingId: 'b1', pickupLocation: COPACABANA, at });
    const again = await demandHistoryService.recordRideRequest(redis, { bookingId: 'b1', pickupLocation: COPACABANA, at });
    expect(first.recorded).toBe(true);
    expect(again).toEqual({ recorded: false, reason: 'duplicate' });
    expect(Object.values(redis.hashes.get(first.key))).toEqual(['1']);
  });

  it('builds heat from the same hour in previous weeks and hides sparse cells', async () => {
    const redis = memoryRedis();
    const now = new Date('2026-10-14T15:10:00Z');
    const lastWeek = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    for (let i = 0; i < 6; i += 1) {
      await demandHistoryService.recordRideRequest(redis, { bookingId: `c${i}`, pickupLocation: COPACABANA, at: lastWeek });
    }
    // Two requests are not enough to show a cell (privacy floor).
    for (let i = 0; i < helpers.MIN_REQUESTS_PER_CELL - 1; i += 1) {
      await demandHistoryService.recordRideRequest(redis, { bookingId: `b${i}`, pickupLocation: BARRA, at: lastWeek });
    }

    const result = await demandHistoryService.materializeDemandHeat(redis, { now });
    expect(result.cells).toBe(1);

    const heat = await demandHistoryService.getDemandHeat(redis);
    expect(heat.cells).toHaveLength(1);
    expect(heat.cells[0].intensity).toBe(1);
    expect(heat.cells[0].level).toBe('high');
    expect(heat.cells[0].boundary.length).toBeGreaterThanOrEqual(6);
  });

  it('ignores requests without a pickup location', async () => {
    const redis = memoryRedis();
    await expect(demandHistoryService.recordRideRequest(redis, { bookingId: 'x', pickupLocation: null }))
      .resolves.toEqual({ recorded: false, reason: 'no_location' });
  });
});
