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

  it('lists and looks receipts up only in Firestore', async () => {
    const service = new ReceiptService();
    service.getReceiptFirestore = () => ({});
    const listPage = jest.spyOn(store, 'listPage').mockResolvedValue({ receipts: [], pagination: 'keyset' });
    const getByRideId = jest.spyOn(store, 'getByRideId').mockResolvedValue(null);
    const { sealFinancialContext } = require('../../../services/financial-runtime-context');
    const financialContext = sealFinancialContext({ providerEnvironment: 'production' });

    await expect(service.listStoredReceiptsByUser({ userId: 'customer_1', role: 'customer', financialContext, limit: 5, cursor: 'c' }))
      .resolves.toEqual({ receipts: [], pagination: 'keyset' });
    expect(listPage.mock.calls[0][1]).toMatchObject({ role: 'customer', userId: 'customer_1', limit: 5, cursor: 'c' });

    await expect(service.getReceiptFromFirestore('booking_1')).resolves.toBeNull();
    getByRideId.mockResolvedValueOnce({ rideId: 'booking_1', receiptId: 'LEAF-FS' });
    await expect(service.getReceiptFromFirestore('booking_1')).resolves.toMatchObject({ receiptId: 'LEAF-FS' });

    service.getReceiptFirestore = () => null;
    await expect(service.listStoredReceiptsByUser({ userId: 'customer_1', role: 'customer', financialContext }))
      .rejects.toMatchObject({ code: 'RECEIPT_DATABASE_UNAVAILABLE', statusCode: 503 });
    await expect(service.getReceiptFromFirestore('booking_1')).resolves.toBeNull();
  });
});
