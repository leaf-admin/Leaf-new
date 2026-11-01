const { getDriverIntroFeeReport, REPORT_LIMIT } = require('../../../services/driver-intro-fee-report-service');
const { buildSeedState } = require('../../../services/driver-intro-fee-state');
const { DRIVER_INTRO_FEE_POLICY } = require('../../../services/driver-intro-fee-policy');
const { keyForDriver } = require('../../../services/driver-intro-fee-service');
const { readDashboardRouteSource } = require('../../helpers/dashboard-route-source');

const seed = (driverId, rides = 0, extra = {}) => ({
  ...buildSeedState({
    driverId,
    qualifiedCompletedRides: rides,
    historySnapshotId: `history-${driverId}`,
    historyThrough: '2026-10-22T00:00:00.000Z'
  }),
  approvedGeneration: 'generation-1',
  ...extra
});

const docFor = (state) => ({
  id: `${DRIVER_INTRO_FEE_POLICY.policyId}__${encodeURIComponent(state.driverId)}`,
  data: () => state
});

function setup(docs, names = {}) {
  const stateCollection = {
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs })
  };
  const firestore = {
    collection: jest.fn((name) => (name === 'driver_intro_fee_states'
      ? stateCollection
      : { doc: (id) => ({ id }) })),
    getAll: jest.fn(async (...args) => args.slice(0, -1).map(({ id }) => ({
      id,
      data: () => names[id]
    })))
  };
  return { firestore, stateCollection };
}

describe('driver intro fee report', () => {
  it('registers the route before the promotion id route that would capture it', () => {
    const source = readDashboardRouteSource();
    const reportRoute = source.indexOf("router.get('/api/promotions/driver-intro-fee'");

    expect(reportRoute).toBeGreaterThan(-1);
    expect(reportRoute).toBeLessThan(source.indexOf("router.get('/api/promotions/:promotionId'"));
  });

  it('summarizes the operational counters without touching sandbox data', async () => {
    const { firestore } = setup(
      [docFor(seed('driver-1', 25)), docFor(seed('driver-2', 3))],
      { 'driver-2': { firstName: 'Ana', lastName: 'Lima' } }
    );
    const redis = { mget: jest.fn().mockResolvedValue([null, null]) };

    const report = await getDriverIntroFeeReport({ firestore, redis, env: { DRIVER_INTRO_FEE_ENABLED: 'true' } });

    expect(firestore.collection).not.toHaveBeenCalledWith('sandbox_driver_intro_fee_states');
    expect(report.policy).toEqual({ enabled: true, rideLimit: 25, feeCents: 99, paymentFeeIncluded: true });
    expect(report.summary).toEqual({ drivers: 2, active: 1, finished: 1, needsReview: 0, ridesUsed: 28 });
    expect(report.drivers[0]).toEqual({
      driverId: 'driver-2', name: 'Ana Lima', ridesUsed: 3, ridesRemaining: 22, inRide: false, status: 'active'
    });
    expect(report.drivers[1]).toMatchObject({ driverId: 'driver-1', name: null, ridesRemaining: 0, status: 'finished' });
  });

  it('prefers the live counter and shows a ride still being counted', async () => {
    const { firestore } = setup([docFor(seed('driver-1', 3))]);
    const live = seed('driver-1', 3);
    const ids = ['ride-1', 'ride-2'];
    const redis = {
      mget: jest.fn().mockResolvedValue([JSON.stringify({
        ...live,
        generation: 'generation-1',
        completedBookingIds: ids,
        qualifiedCompletedRides: 5,
        inflightBookingId: 'ride-3'
      })])
    };

    const report = await getDriverIntroFeeReport({ firestore, redis, env: {} });

    expect(redis.mget).toHaveBeenCalledWith(keyForDriver('driver-1'));
    expect(report.drivers[0]).toMatchObject({ ridesUsed: 5, ridesRemaining: 20, inRide: true });
  });

  it.each([
    ['another generation', { generation: 'generation-2', qualifiedCompletedRides: 4, completedBookingIds: ['ride-1'] }],
    ['a counter behind the checkpoint', { generation: 'generation-1', baselineCount: 0, completedBookingIds: [], qualifiedCompletedRides: 0 }],
    ['another driver', { generation: 'generation-1', driverId: 'driver-9' }]
  ])('ignores a live state from %s', async (_label, overrides) => {
    const { firestore } = setup([docFor(seed('driver-1', 3))]);
    const redis = { mget: jest.fn().mockResolvedValue([JSON.stringify({ ...seed('driver-1', 3), ...overrides })]) };

    const report = await getDriverIntroFeeReport({ firestore, redis, env: {} });

    expect(report.drivers[0].ridesUsed).toBe(3);
  });

  it('falls back to the checkpoint and says so when Redis fails', async () => {
    const { firestore } = setup([docFor(seed('driver-1', 3))]);
    const redis = { mget: jest.fn().mockRejectedValue(new Error('redis down')) };

    const report = await getDriverIntroFeeReport({ firestore, redis, env: {} });

    expect(report.liveCounters).toBe(false);
    expect(report.drivers[0].ridesUsed).toBe(3);
  });

  it('lists review and unreadable counters first and never invents a ride count', async () => {
    const { firestore } = setup([
      docFor(seed('driver-1', 10)),
      docFor(seed('driver-2', 4, { reviewRequiredBookingId: 'ride-9' })),
      { id: `${DRIVER_INTRO_FEE_POLICY.policyId}__driver-3`, data: () => ({ version: 99 }) }
    ]);
    const redis = { mget: jest.fn().mockResolvedValue([null, null, null]) };

    const report = await getDriverIntroFeeReport({ firestore, redis, env: {} });

    expect(report.drivers.map((row) => row.status)).toEqual(['review', 'invalid', 'active']);
    expect(report.drivers[1]).toMatchObject({ driverId: 'driver-3', ridesUsed: null, ridesRemaining: null });
    expect(report.summary).toMatchObject({ needsReview: 2, ridesUsed: 14 });
  });

  it('reports an empty program without calling Redis or users', async () => {
    const { firestore } = setup([]);
    const redis = { mget: jest.fn() };

    const report = await getDriverIntroFeeReport({ firestore, redis, env: {} });

    expect(report.policy.enabled).toBe(false);
    expect(report.drivers).toEqual([]);
    expect(report.liveCounters).toBe(true);
    expect(redis.mget).not.toHaveBeenCalled();
    expect(firestore.getAll).not.toHaveBeenCalled();
  });

  it('flags a list cut at the report limit', async () => {
    const docs = Array.from({ length: REPORT_LIMIT + 1 }, (_, index) => docFor(seed(`driver-${index}`, 1)));
    const { firestore, stateCollection } = setup(docs);
    const redis = { mget: jest.fn().mockResolvedValue([]) };

    const report = await getDriverIntroFeeReport({ firestore, redis, env: {} });

    expect(stateCollection.limit).toHaveBeenCalledWith(REPORT_LIMIT + 1);
    expect(report.truncated).toBe(true);
    expect(report.drivers).toHaveLength(REPORT_LIMIT);
  });
});
