const admin = require('firebase-admin');
const { getAppPublicStats, resetAppPublicStatsCache, CACHE_TTL_MS } = require('../../../services/app-public-stats-service');

function doc(fields) {
  return { get: (path) => fields[path] };
}

function fakeFirestore({ receipts = [], ratings = [] } = {}) {
  const queries = [];
  const firestore = {
    collection: jest.fn((name) => {
      const query = { name, wheres: [] };
      queries.push(query);
      const chain = {
        where: (field, op, value) => { query.wheres.push({ field, op, value }); return chain; },
        select: () => chain,
        limit: () => chain,
        get: async () => {
          const docs = name === 'receipts' ? receipts.map(doc) : ratings.map(doc);
          return { docs, size: docs.length };
        }
      };
      return chain;
    })
  };
  return { firestore, queries };
}

describe('app public stats', () => {
  beforeAll(() => {
    admin.firestore.Timestamp = { fromMillis: (ms) => ({ ms }) };
  });
  beforeEach(() => resetAppPublicStatsCache());

  it('counts only operational data since the opening and never invents numbers', async () => {
    const { firestore, queries } = fakeFirestore({
      receipts: [
        { 'historyIndex.customerId': 'p1', 'historyIndex.driverId': 'd1' },
        { 'historyIndex.customerId': 'p1', 'historyIndex.driverId': 'd2' },
        { 'historyIndex.customerId': 'p2', 'historyIndex.driverId': 'd1' }
      ],
      ratings: [
        { rating: 5, reviewerType: 'passenger' },
        { rating: 4, reviewerType: 'passenger' },
        { rating: 1, reviewerType: 'driver' }
      ]
    });
    const stats = await getAppPublicStats({ firestore, env: {} });
    expect(stats).toMatchObject({ activeUsers: 4, totalTrips: 3, averageRating: 4.5, ratingsCount: 2, since: '2026-11-02T03:00:00.000Z' });
    expect(queries.map((q) => q.name)).toEqual(['receipts', 'ratings']);
    expect(queries[0].wheres[0]).toMatchObject({ field: 'historyIndex.listedAt', op: '>=', value: { ms: Date.parse('2026-11-02T03:00:00Z') } });
  });

  it('answers zeros and no rating when there is no real data yet', async () => {
    const { firestore } = fakeFirestore();
    await expect(getAppPublicStats({ firestore, env: {} })).resolves.toMatchObject({ activeUsers: 0, totalTrips: 0, averageRating: null });
  });

  it('caches the answer for ten minutes', async () => {
    const { firestore } = fakeFirestore();
    await getAppPublicStats({ firestore, nowMs: 1000, env: {} });
    await getAppPublicStats({ firestore, nowMs: 1000 + CACHE_TTL_MS - 1, env: {} });
    expect(firestore.collection).toHaveBeenCalledTimes(2);
    await getAppPublicStats({ firestore, nowMs: 1000 + CACHE_TTL_MS + 1, env: {} });
    expect(firestore.collection).toHaveBeenCalledTimes(4);
  });
});
