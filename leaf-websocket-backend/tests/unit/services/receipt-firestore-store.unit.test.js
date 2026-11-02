const admin = require('firebase-admin');
const ReceiptService = require('../../../services/receipt-service');
const store = require('../../../services/receipt-firestore-store');
const rideAnnotationStore = require('../../../services/ride-annotation-store');

const scope = { namespace: 'operational', financialContextId: 'operational', collections: { receipts: 'receipts', bookings: 'bookings' } };
const options = {
  ownerOf: (receipt, role) => receipt?.[role]?.id || '',
  timestampOf: receipt => receipt.savedTimestamp
};
const receipt = (overrides = {}) => ({
  rideId: 'booking_1792947972712_owner', receiptId: 'LEAF-1', savedTimestamp: 1792947990000,
  customer: { id: 'customer_1' }, driver: { id: 'driver_1' },
  financial: { grossAmount: 42.14, driverNetAmount: 40.65, tollAmount: 9.95 },
  optional: undefined, ...overrides
});

function fakeFirestore(existing = null) {
  const writes = [];
  const ref = { id: 'doc' };
  const firestore = {
    collection: jest.fn(() => ({ doc: jest.fn(() => ref) })),
    runTransaction: jest.fn(async fn => fn({
      get: async () => ({ exists: Boolean(existing), data: () => existing }),
      set: (target, value) => writes.push({ target, value })
    }))
  };
  return { firestore, writes };
}

describe('receipt Firestore store (only copy; RTDB retired)', () => {
  beforeAll(() => {
    admin.firestore.Timestamp = { fromMillis: ms => ({ ms }) };
  });
  afterEach(() => jest.restoreAllMocks());

  it('builds a queryable document without undefined values', () => {
    const { rideId, document } = store.buildDocument(receipt(), scope, options);
    expect(rideId).toBe('booking_1792947972712_owner');
    expect(document.historyIndex).toEqual({
      schema: 1, customerId: 'customer_1', driverId: 'driver_1', namespace: 'operational',
      contextId: 'operational', listedAt: { ms: 1792947990000 }
    });
    expect('optional' in document).toBe(false);
    // The stored body keeps its original shape; only historyIndex is added.
    const { optional: _drop, ...original } = receipt();
    expect(store.readBody(document)).toEqual(original);
  });

  it('rejects documents above the Firestore size budget', () => {
    expect(() => store.buildDocument(receipt({ blob: 'x'.repeat(store.MAX_DOCUMENT_BYTES) }), scope, options))
      .toThrow(expect.objectContaining({ code: 'RECEIPT_FIRESTORE_BYTE_BUDGET' }));
  });

  it('writes the receipt and refuses an owner change', async () => {
    const fresh = fakeFirestore();
    await store.write(fresh.firestore, receipt(), scope, options);
    expect(fresh.firestore.collection).toHaveBeenCalledWith('receipts');
    expect(fresh.writes).toHaveLength(1);

    const same = fakeFirestore({ historyIndex: { customerId: 'customer_1', driverId: 'driver_1', contextId: 'operational' } });
    await store.write(same.firestore, receipt(), scope, options);
    expect(same.writes).toHaveLength(1);

    const other = fakeFirestore({ historyIndex: { customerId: 'customer_2', driverId: 'driver_1', contextId: 'operational' } });
    await expect(store.write(other.firestore, receipt(), scope, options))
      .rejects.toMatchObject({ code: 'RECEIPT_FIRESTORE_OWNER_CONFLICT' });
    expect(other.writes).toHaveLength(0);
  });

  it('saves to Firestore (failing loudly) plus the pointer on the ride annotation', async () => {
    const service = new ReceiptService();
    const order = [];
    const write = jest.spyOn(store, 'write').mockImplementation(async () => { order.push('firestore'); return { mirrored: true }; });
    jest.spyOn(rideAnnotationStore, 'updateAnnotation').mockImplementation(async (_firestore, root, id, patch) => {
      order.push(`annotation:${root}/${id}/${Object.keys(patch).join(',')}`);
    });
    service.getReceiptFirestore = () => ({});
    const operational = { rideId: 'booking_1792947972712_owner', receiptId: 'LEAF-1', hash: 'h',
      customer: { id: 'customer_1' }, driver: { id: 'driver_1' } };

    await expect(service.saveReceiptToFirestore(operational)).resolves.toBe(true);
    expect(order).toEqual(['firestore', 'annotation:bookings/booking_1792947972712_owner/receipt']);
    expect(write.mock.calls[0][1]).toMatchObject({ rideId: 'booking_1792947972712_owner', financialNamespace: 'operational' });

    write.mockRejectedValueOnce(Object.assign(new Error('firestore down'), { code: 'unavailable' }));
    await expect(service.saveReceiptToFirestore(operational)).rejects.toMatchObject({ code: 'RECEIPT_PERSIST_FAILED' });

    service.getReceiptFirestore = () => null;
    await expect(service.saveReceiptToFirestore(operational)).rejects.toMatchObject({
      code: 'RECEIPT_PERSIST_FAILED',
      details: expect.objectContaining({ stage: 'database_unavailable' })
    });
  });

  it('rejects malformed history cursors', () => {
    expect(() => store.decodeCursor('not-a-cursor')).toThrow(expect.objectContaining({ code: 'RECEIPT_HISTORY_CURSOR_INVALID', statusCode: 400 }));
    const valid = Buffer.from(JSON.stringify({ v: 1, t: 1792947990000, id: 'booking_1' })).toString('base64url');
    expect(store.decodeCursor(valid)).toEqual({ v: 1, t: 1792947990000, id: 'booking_1' });
  });

  describe('listPage', () => {
    // In-memory query: newest first, honours listedAt filters, startAfter and limit.
    function fakeHistory(listedAts) {
      const docs = listedAts.map((ms, index) => ({
        id: `booking_${index}`,
        data: () => ({ ...receipt({ rideId: `booking_${index}` }), historyIndex: { listedAt: { ms } } }),
        get: () => ({ toMillis: () => ms })
      })).sort((a, b) => b.get().toMillis() - a.get().toMillis());
      const calls = { count: 0, gets: [] };
      const chain = (state) => ({
        // Like Firestore: no filter after a cursor or an orderBy.
        where: (field, op, value) => {
          if (state.after !== undefined || state.ordered) throw new Error('where() after startAfter()/orderBy()');
          return field === 'historyIndex.listedAt'
            ? chain({ ...state, filters: [...state.filters, { op, ms: value.ms }] })
            : chain(state);
        },
        orderBy: () => chain({ ...state, ordered: true }),
        startAfter: (ts) => chain({ ...state, after: ts.ms }),
        offset: () => chain(state),
        limit: (n) => chain({ ...state, limit: n }),
        count: () => ({ get: async () => { calls.count += 1; return { data: () => ({ count: docs.length }) }; } }),
        get: async () => {
          const ms = (doc) => doc.get().toMillis();
          const matched = docs
            .filter((doc) => state.after === undefined || ms(doc) < state.after)
            .filter((doc) => state.filters.every((f) => (f.op === '>=' ? ms(doc) >= f.ms : ms(doc) < f.ms)))
            .slice(0, state.limit);
          calls.gets.push(state);
          return { docs: matched, empty: matched.length === 0 };
        }
      });
      const firestore = { collection: () => chain({ filters: [] }) };
      return { firestore, calls };
    }
    const base = {
      scope, role: 'driver', userId: 'driver_1',
      assertRecord: () => {}, ownerOf: (r, role) => r?.[role]?.id
    };

    beforeAll(() => {
      admin.firestore.FieldPath = { documentId: () => '__name__' };
    });

    it('loads a whole period in one page and reports older rides', async () => {
      const { firestore, calls } = fakeHistory([5000, 4000, 3000, 2000, 1000]);
      const first = await store.listPage(firestore, { ...base, limit: 1 });
      expect(first).toMatchObject({ total: 5, hasMore: true, periodComplete: null });
      expect(calls.count).toBe(1);

      const period = await store.listPage(firestore, { ...base, limit: 200, cursor: first.nextCursor, sinceMs: 2500 });
      expect(period.receipts.map((r) => r.rideId)).toEqual(['booking_1', 'booking_2']);
      expect(period).toMatchObject({ total: null, hasMore: true, periodComplete: true });
      // Later pages skip the count query.
      expect(calls.count).toBe(1);
      expect(store.decodeCursor(period.nextCursor)).toMatchObject({ t: 3000, id: 'booking_2' });
    });

    it('keeps paging inside a period larger than the page', async () => {
      const { firestore } = fakeHistory([5000, 4000, 3000, 2000]);
      const page = await store.listPage(firestore, { ...base, limit: 2, sinceMs: 1500 });
      expect(page).toMatchObject({ hasMore: true, periodComplete: false });
      expect(page.receipts).toHaveLength(2);
    });

    it('ends the list when nothing is older than the period', async () => {
      const { firestore } = fakeHistory([5000, 4000]);
      const page = await store.listPage(firestore, { ...base, limit: 200, sinceMs: 1000 });
      expect(page).toMatchObject({ hasMore: false, nextCursor: null, periodComplete: true });
    });

    it('keeps the caller position when the period page is empty', async () => {
      const { firestore } = fakeHistory([5000, 1000]);
      const first = await store.listPage(firestore, { ...base, limit: 1 });
      const empty = await store.listPage(firestore, { ...base, limit: 200, cursor: first.nextCursor, sinceMs: 3000 });
      expect(empty).toMatchObject({ receipts: [], hasMore: true, periodComplete: true, nextCursor: first.nextCursor });
    });

    it('refuses a period with an offset', async () => {
      const { firestore } = fakeHistory([5000]);
      await expect(store.listPage(firestore, { ...base, limit: 10, offset: 10, sinceMs: 1000 }))
        .rejects.toMatchObject({ code: 'RECEIPT_HISTORY_CURSOR_INVALID', statusCode: 400 });
    });
  });

  it('lists and looks receipts up only in Firestore', async () => {
    const service = new ReceiptService();
    service.getReceiptFirestore = () => ({});
    const listPage = jest.spyOn(store, 'listPage').mockResolvedValue({ receipts: [], pagination: 'keyset' });
    const getByRideId = jest.spyOn(store, 'getByRideId').mockResolvedValue(null);
    const { sealFinancialContext } = require('../../../services/financial-runtime-context');
    const financialContext = sealFinancialContext({ providerEnvironment: 'production' });

    await expect(service.listStoredReceiptsByUser({ userId: 'customer_1', role: 'customer', financialContext, limit: 5, cursor: 'c' }))
      .resolves.toEqual({ receipts: [], pagination: 'keyset' });
    expect(listPage.mock.calls[0][1]).toMatchObject({ role: 'customer', userId: 'customer_1', limit: 5, cursor: 'c', sinceMs: null });

    await service.listStoredReceiptsByUser({ userId: 'customer_1', role: 'customer', financialContext, limit: 500, cursor: 'c', sinceMs: 1000 });
    expect(listPage.mock.calls[1][1]).toMatchObject({ limit: 200, sinceMs: 1000 });
    await service.listStoredReceiptsByUser({ userId: 'customer_1', role: 'customer', financialContext, limit: 500 });
    expect(listPage.mock.calls[2][1]).toMatchObject({ limit: 50 });

    await expect(service.getReceiptFromFirestore('booking_1')).resolves.toBeNull();
    getByRideId.mockResolvedValueOnce({ rideId: 'booking_1', receiptId: 'LEAF-FS' });
    await expect(service.getReceiptFromFirestore('booking_1')).resolves.toMatchObject({ receiptId: 'LEAF-FS' });

    service.getReceiptFirestore = () => null;
    await expect(service.listStoredReceiptsByUser({ userId: 'customer_1', role: 'customer', financialContext }))
      .rejects.toMatchObject({ code: 'RECEIPT_DATABASE_UNAVAILABLE', statusCode: 503 });
    await expect(service.getReceiptFromFirestore('booking_1')).resolves.toBeNull();
  });
});
