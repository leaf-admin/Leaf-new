const budget = require('../../../utils/metrics-read-budget');

describe('administrative metrics read budgets', () => {
  test('fixed page never calls an unrestricted Firestore get and rejects overflow', async () => {
    const query = { limit: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({
      docs: Array.from({ length: 2001 }, () => ({ data: () => ({ status: 'COMPLETED' }) }))
    }) };
    await expect(budget.firestoreSnapshot(query)).rejects.toMatchObject({ statusCode: 503 });
    expect(query.limit).toHaveBeenCalledWith(2001);
  });

  test('legacy root reads reject oversized records instead of truncating a total', async () => {
    const query = { limitToFirst: jest.fn().mockReturnThis(), once: jest.fn().mockResolvedValue({
      val: () => ({ oversized: { payload: 'x'.repeat(4 * 1024 * 1024) } })
    }) };
    await expect(budget.realtimeSnapshot(query)).rejects.toMatchObject({ statusCode: 503 });
    expect(query.limitToFirst).toHaveBeenCalledWith(2001);
  });

  test('two actual database calls keep slots until settled, with no unbounded queue', async () => {
    const resolvers = [];
    const run = () => budget.admit(() => new Promise(resolve => resolvers.push(resolve)));
    const a = run(); const b = run();
    await expect(run()).rejects.toMatchObject({ statusCode: 503 });
    resolvers.forEach(resolve => resolve('done'));
    await expect(Promise.all([a, b])).resolves.toEqual(['done', 'done']);
    await expect(budget.admit(async () => 'recovered')).resolves.toBe('recovered');
  });

  test('provider failure does not enable global fallback', () => {
    const previous = process.env.ENABLE_LEGACY_METRICS_FALLBACK;
    delete process.env.ENABLE_LEGACY_METRICS_FALLBACK;
    try { expect(() => budget.requireLegacyFallback()).toThrow(); }
    finally {
      if (previous === undefined) delete process.env.ENABLE_LEGACY_METRICS_FALLBACK;
      else process.env.ENABLE_LEGACY_METRICS_FALLBACK = previous;
    }
  });
});
