const index = require('../../../services/receipt-history-index');

describe('receipt history projection contracts', () => {
  const scope = { namespace: 'operational', financialContextId: 'operational-context' };
  const options = { ownerOf: (receipt, role) => receipt[role]?.id || '', timestampOf: () => 1710000000000 };
  const fixture = () => ({ rideId: 'ride', customer: { id: 'customer' }, driver: { id: 'driver' },
    trip: { dateTime: '2024-03-09T16:00:00Z', routeGeometry: 'private-heavy-data' },
    financial: { totalPaid: { amount: 30 }, breakdown: { driverAmount: { amount: 28.77 } } },
    mapImageBase64: 'x'.repeat(100000), mapImage: 'private-map', route: [1, 2, 3] });
  const previous = { writes: process.env.ENABLE_RECEIPT_HISTORY_WRITES, reads: process.env.ENABLE_RECEIPT_HISTORY_READS };
  beforeEach(() => { process.env.ENABLE_RECEIPT_HISTORY_WRITES = 'true'; process.env.ENABLE_RECEIPT_HISTORY_READS = 'true'; });
  afterAll(() => {
    for (const [key, value] of [['ENABLE_RECEIPT_HISTORY_WRITES', previous.writes], ['ENABLE_RECEIPT_HISTORY_READS', previous.reads]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  test('copies only small list data and preserves backend amounts without recalculation', () => {
    const summary = index.compactReceipt(fixture());
    expect(summary.financial).toEqual(fixture().financial);
    expect(summary).not.toHaveProperty('mapImage');
    expect(summary).not.toHaveProperty('mapImageBase64');
    expect(summary.trip).not.toHaveProperty('routeGeometry');
  });

  test('updates the same receipt item even when its date changes, with separate owner scopes', () => {
    const first = index.buildUpdates(fixture(), scope, options);
    const second = index.buildUpdates(fixture(), scope, { ...options, timestampOf: () => 1710000001000 });
    const items = Object.keys(first).filter(key => key.includes('/items/'));
    expect(items).toEqual(Object.keys(second).filter(key => key.includes('/items/')));
    expect(items).toHaveLength(2);
    expect(first[items[0]].sortKey).not.toBe(second[items[0]].sortKey);
    expect(Object.keys(first).some(key => key.endsWith('/ready'))).toBe(false);
  });

  test('sandbox profile and owner/role all participate in the cursor scope', () => {
    const base = index.ownerBase(scope, 'customer', 'customer');
    const key = `1710000000000_${index.hash('ride')}`;
    const cursor = Buffer.from(JSON.stringify({ v: 1, scope: index.hash(base), key, revision: 'revision' })).toString('base64url');
    expect(index.decodeCursor(cursor, base).key).toBe(key);
    for (const other of [index.ownerBase(scope, 'driver', 'customer'), index.ownerBase(scope, 'customer', 'other'),
      index.ownerBase({ namespace: 'sandbox', financialContextId: 'qa' }, 'customer', 'customer')]) {
      expect(() => index.decodeCursor(cursor, other)).toThrow('Cursor');
    }
    expect(index.ownerBase({ namespace: 'sandbox', financialContextId: 'qa-1' }, 'customer', 'u'))
      .not.toBe(index.ownerBase({ namespace: 'sandbox', financialContextId: 'qa-2' }, 'customer', 'u'));
  });

  test('refuses an oversized projection instead of copying large arbitrary data', () => {
    expect(() => index.compactReceipt({ ...fixture(), financial: { unexpectedBlob: 'x'.repeat(9000) } }))
      .toThrow('excede orçamento');
  });

  test('a revision change during the read rejects the page', async () => {
    let reads = 0;
    const query = { orderByChild: jest.fn(() => query), limitToLast: jest.fn(() => query),
      once: async () => ({ val: () => ({}) }) };
    const db = { ref: path => path.endsWith('/meta')
      ? { once: async () => ({ val: () => ({ ready: true, schema: 1, revision: ++reads === 1 ? 'before' : 'after' }) }) } : query };
    await expect(index.readPage({ db, scope, userId: 'customer', role: 'customer', limit: 10,
      ...options, assertRecord: () => {} })).rejects.toMatchObject({ code: 'RECEIPT_HISTORY_REFRESH_REQUIRED' });
    expect(query.limitToLast).toHaveBeenCalledWith(11);
  });

  test('without a migration attestation it returns control to the bounded legacy reader', async () => {
    const db = { ref: jest.fn(() => ({ once: async () => ({ val: () => ({ revision: 'new-writes-only', schema: 1 }) }) })) };
    expect(await index.readPage({ db, scope, userId: 'customer', role: 'customer', limit: 10 })).toBeNull();
    expect(db.ref).toHaveBeenCalledTimes(1);
  });
});
