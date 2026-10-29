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

  test('two database calls run at once; a few more wait for a slot and the queue stays bounded', async () => {
    const resolvers = [];
    const started = [];
    const run = (id) => budget.admit(() => new Promise(resolve => { started.push(id); resolvers.push(resolve); }));
    const active = [run('a'), run('b')];
    const queued = Array.from({ length: 6 }, (_, index) => run(`q${index}`));
    await expect(run('overflow')).rejects.toMatchObject({ statusCode: 503 });
    expect(started).toEqual(['a', 'b']);

    resolvers.shift()('done');
    await expect(active[0]).resolves.toBe('done');
    await new Promise(resolve => setImmediate(resolve));
    expect(started).toEqual(['a', 'b', 'q0']);

    while (resolvers.length) {
      resolvers.shift()('done');
      await new Promise(resolve => setImmediate(resolve));
    }
    await expect(Promise.all([active[1], ...queued])).resolves.toHaveLength(7);
    await expect(budget.admit(async () => 'recovered')).resolves.toBe('recovered');
  });

  test('a queued read gives up after the wait limit', async () => {
    jest.useFakeTimers();
    try {
      const release = [];
      const hold = () => budget.admit(() => new Promise(resolve => release.push(resolve)));
      const held = [hold(), hold()];
      const queued = budget.admit(async () => 'late');
      jest.advanceTimersByTime(8001);
      await expect(queued).rejects.toMatchObject({ statusCode: 503 });
      release.forEach(resolve => resolve('done'));
      await Promise.all(held);
    } finally {
      jest.useRealTimers();
    }
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
