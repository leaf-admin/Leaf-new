const { aggregateLegacy, readLegacy, readPage } = require('../../../services/dashboard-driver-list-data');
const mapWithConcurrency = require('../../../utils/map-with-concurrency');

describe('driver list budgets', () => {
  test('legacy aggregation is equivalent to the old per-driver scans, including first car and completed net only', () => {
    const cars = { a: { driver: 'd1', carNumber: 'first' }, b: { driver: 'd1', carNumber: 'second' } };
    const bookings = { a: { driver: 'd1', status: 'COMPLETED', net: 28.77 }, b: { driver: 'd1', status: 'CANCELED', net: 99 },
      c: { driver: 'd2', status: 'COMPLETED', net: 10 }, d: { driverId: 'd1', status: 'COMPLETED', net: 100 } };
    const result = aggregateLegacy(cars, bookings, booking => booking.net);
    for (const id of ['d1', 'd2', 'absent']) {
      const all = Object.values(bookings).filter(booking => booking.driver === id);
      const done = all.filter(booking => booking.status === 'COMPLETED');
      const stats = result.statsByDriver.get(id) || { totalTrips: 0, completedTrips: 0, totalEarnings: 0 };
      expect(stats).toEqual({ totalTrips: all.length, completedTrips: done.length, totalEarnings: done.reduce((sum, booking) => sum + booking.net, 0) });
      expect(result.carsByDriver.get(id)).toEqual(Object.values(cars).find(car => car.driver === id));
    }
  });

  test('legacy root reads reject overflow rather than using a truncated dataset', async () => {
    const limits = [];
    const db = { ref: key => {
      const query = { orderByChild: () => query, equalTo: () => query, limitToFirst: count => { limits.push([key, count]); return query; },
        once: async () => ({ val: () => key === 'bookings' ? Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [i, {}])) : key === 'users' ? { d1: { usertype: 'driver' } } : {} }) };
      return query;
    } };
    await expect(readLegacy(db, () => 0)).rejects.toMatchObject({ code: 'DASHBOARD_LEGACY_BUDGET' });
    expect(limits).toEqual([['users', 201], ['cars', 2001], ['bookings', 2001]]);
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
