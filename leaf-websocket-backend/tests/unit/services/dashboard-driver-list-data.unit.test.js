const { readLegacy, readPage } = require('../../../services/dashboard-driver-list-data');
const mapWithConcurrency = require('../../../utils/map-with-concurrency');

describe('driver list budgets', () => {
  test('legacy read only loads bounded drivers and rejects overflow rather than truncating', async () => {
    const limits = [];
    let size = 1;
    const db = { ref: key => {
      const query = { orderByChild: () => query, equalTo: () => query, limitToFirst: count => { limits.push([key, count]); return query; },
        once: async () => ({ val: () => Object.fromEntries(Array.from({ length: size }, (_, i) => [`d${i}`, { usertype: 'driver' }])) }) };
      return query;
    } };
    const page = await readLegacy(db);
    expect(page).toMatchObject({ users: { d0: { usertype: 'driver' } }, mode: 'legacy-bounded' });
    expect(page.statsByDriver.size + page.carsByDriver.size).toBe(0);
    size = 201;
    await expect(readLegacy(db)).rejects.toMatchObject({ code: 'DASHBOARD_LEGACY_BUDGET' });
    expect(limits).toEqual([['users', 201], ['users', 201]]);
  });

  test('hydration admits four operations and stops admitting more after failure', async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async item => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setImmediate(resolve)); active--; return item * 2;
    });
    expect(maximum).toBe(4);
    expect(result).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
    let admitted = 0;
    await expect(mapWithConcurrency([1, 2, 3, 4, 5, 6], 4, async () => {
      admitted++; throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(admitted).toBeLessThanOrEqual(4);
  });

  test('cursor mode fails before a query without schema/parity attestation', async () => {
    const previous = process.env.ENABLE_ADMIN_DRIVER_CURSOR_READS;
    try {
      process.env.ENABLE_ADMIN_DRIVER_CURSOR_READS = 'true';
      const get = jest.fn().mockResolvedValue({ exists: false });
      const firestore = { collection: jest.fn(() => ({ doc: () => ({ get }) })) };
      await expect(readPage({ db: {}, firestore, params: { pagination: 'cursor' }, resolveNet: () => 0 }))
        .rejects.toMatchObject({ code: 'DASHBOARD_DIRECTORY_NOT_READY' });
      expect(firestore.collection).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_ADMIN_DRIVER_CURSOR_READS;
      else process.env.ENABLE_ADMIN_DRIVER_CURSOR_READS = previous;
    }
  });
});
