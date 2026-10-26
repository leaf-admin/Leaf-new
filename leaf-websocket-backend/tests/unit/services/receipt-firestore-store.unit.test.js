const admin = require('firebase-admin');
const ReceiptService = require('../../../services/receipt-service');
const store = require('../../../services/receipt-firestore-store');

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

describe('receipt Firestore mirror', () => {
  const previousFlag = process.env.ENABLE_RECEIPT_FIRESTORE_WRITES;
  beforeAll(() => {
    admin.firestore.Timestamp = { fromMillis: ms => ({ ms }) };
  });
  afterEach(() => {
    if (previousFlag === undefined) delete process.env.ENABLE_RECEIPT_FIRESTORE_WRITES;
    else process.env.ENABLE_RECEIPT_FIRESTORE_WRITES = previousFlag;
  });

  it('builds a queryable document without undefined values', () => {
    const { rideId, document } = store.buildDocument(receipt(), scope, options);
    expect(rideId).toBe('booking_1792947972712_owner');
    expect(document.historyIndex).toEqual({
      schema: 1, customerId: 'customer_1', driverId: 'driver_1', namespace: 'operational',
      contextId: 'operational', listedAt: { ms: 1792947990000 }
    });
    expect('optional' in document).toBe(false);
    // The stored body keeps the RTDB shape; only historyIndex is added.
    const { optional: _drop, ...original } = receipt();
    expect(store.readBody(document)).toEqual(original);
  });

  it('rejects documents above the Firestore size budget', () => {
    expect(() => store.buildDocument(receipt({ blob: 'x'.repeat(store.MAX_DOCUMENT_BYTES) }), scope, options))
      .toThrow(expect.objectContaining({ code: 'RECEIPT_FIRESTORE_BYTE_BUDGET' }));
  });

  it('does nothing while the writer flag is off', async () => {
    delete process.env.ENABLE_RECEIPT_FIRESTORE_WRITES;
    const { firestore } = fakeFirestore();
    await expect(store.mirror(firestore, receipt(), scope, options)).resolves.toEqual({ mirrored: false, reason: 'disabled' });
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('writes the receipt and refuses an owner change', async () => {
    process.env.ENABLE_RECEIPT_FIRESTORE_WRITES = 'true';
    const fresh = fakeFirestore();
    await store.mirror(fresh.firestore, receipt(), scope, options);
    expect(fresh.firestore.collection).toHaveBeenCalledWith('receipts');
    expect(fresh.writes).toHaveLength(1);

    const same = fakeFirestore({ historyIndex: { customerId: 'customer_1', driverId: 'driver_1', contextId: 'operational' } });
    await store.mirror(same.firestore, receipt(), scope, options);
    expect(same.writes).toHaveLength(1);

    const other = fakeFirestore({ historyIndex: { customerId: 'customer_2', driverId: 'driver_1', contextId: 'operational' } });
    await expect(store.mirror(other.firestore, receipt(), scope, options))
      .rejects.toMatchObject({ code: 'RECEIPT_FIRESTORE_OWNER_CONFLICT' });
    expect(other.writes).toHaveLength(0);
  });

  it('mirrors after the RTDB write and never fails the receipt when Firestore fails', async () => {
    process.env.ENABLE_RECEIPT_FIRESTORE_WRITES = 'true';
    const service = new ReceiptService();
    const order = [];
    const firebaseDb = { ref: jest.fn(path => ({ set: jest.fn(async () => { order.push(`rtdb:${path}`); }) })) };
    const mirror = jest.spyOn(store, 'mirror').mockImplementation(async () => { order.push('firestore'); return { mirrored: true }; });
    service.getReceiptFirestore = () => ({});
    const operational = { rideId: 'booking_1792947972712_owner', receiptId: 'LEAF-1', hash: 'h',
      customer: { id: 'customer_1' }, driver: { id: 'driver_1' } };

    await expect(service.saveReceiptToFirestore(operational, firebaseDb)).resolves.toBe(true);
    expect(order).toEqual(['rtdb:receipts/booking_1792947972712_owner', 'rtdb:bookings/booking_1792947972712_owner/receipt', 'firestore']);
    expect(mirror.mock.calls[0][1]).toMatchObject({ rideId: 'booking_1792947972712_owner', financialNamespace: 'operational' });

    mirror.mockRejectedValueOnce(Object.assign(new Error('firestore down'), { code: 'unavailable' }));
    await expect(service.saveReceiptToFirestore(operational, firebaseDb)).resolves.toBe(true);
    mirror.mockRestore();
  });

  it('rejects malformed history cursors', () => {
    expect(() => store.decodeCursor('not-a-cursor')).toThrow(expect.objectContaining({ code: 'RECEIPT_HISTORY_CURSOR_INVALID', statusCode: 400 }));
    const valid = Buffer.from(JSON.stringify({ v: 1, t: 1792947990000, id: 'booking_1' })).toString('base64url');
    expect(store.decodeCursor(valid)).toEqual({ v: 1, t: 1792947990000, id: 'booking_1' });
  });

  it('routes listing and lookup to Firestore only when both flags are on, with RTDB fallback for a missing receipt', async () => {
    process.env.ENABLE_RECEIPT_FIRESTORE_WRITES = 'true';
    const service = new ReceiptService();
    service.getReceiptFirestore = () => ({});
    const listPage = jest.spyOn(store, 'listPage').mockResolvedValue({ receipts: [], pagination: 'keyset' });
    const getByRideId = jest.spyOn(store, 'getByRideId').mockResolvedValue(null);
    const rtdbReceipt = { rideId: 'booking_1', receiptId: 'LEAF-1', customer: { id: 'customer_1' } };
    const firebaseDb = { ref: jest.fn(() => ({
      once: async () => ({ val: () => rtdbReceipt }),
      orderByChild: () => ({ equalTo: () => ({ limitToLast: () => ({ once: async () => ({ val: () => ({}) }) }) }) })
    })) };

    const { sealFinancialContext } = require('../../../services/financial-runtime-context');
    const financialContext = sealFinancialContext({ providerEnvironment: 'production' });
    delete process.env.ENABLE_RECEIPT_FIRESTORE_READS;
    await service.listStoredReceiptsByUser({ firebaseDb, userId: 'customer_1', role: 'customer', financialContext });
    expect(listPage).not.toHaveBeenCalled();

    process.env.ENABLE_RECEIPT_FIRESTORE_READS = 'true';
    await expect(service.listStoredReceiptsByUser({ firebaseDb, userId: 'customer_1', role: 'customer', financialContext, limit: 5, cursor: 'c' }))
      .resolves.toEqual({ receipts: [], pagination: 'keyset' });
    expect(listPage.mock.calls[0][1]).toMatchObject({ role: 'customer', userId: 'customer_1', limit: 5, cursor: 'c' });

    await expect(service.getReceiptFromFirestore('booking_1', firebaseDb)).resolves.toMatchObject({ receiptId: 'LEAF-1' });
    expect(getByRideId).toHaveBeenCalled();
    expect(firebaseDb.ref).toHaveBeenCalledWith('receipts/booking_1');

    getByRideId.mockResolvedValueOnce({ rideId: 'booking_1', receiptId: 'LEAF-FS' });
    firebaseDb.ref.mockClear();
    await expect(service.getReceiptFromFirestore('booking_1', firebaseDb)).resolves.toMatchObject({ receiptId: 'LEAF-FS' });
    expect(firebaseDb.ref).not.toHaveBeenCalled();

    delete process.env.ENABLE_RECEIPT_FIRESTORE_READS;
    listPage.mockRestore();
    getByRideId.mockRestore();
  });

  it('backfill skips fixtures, writes only on --apply and verifies parity', async () => {
    const backfill = require('../../../scripts/maintenance/backfill-receipts-firestore.cjs');
    expect(() => backfill.parseArgs(['--collection', 'receipts', '--apply'])).toThrow('--ref');
    const rows = {
      booking_1_capacity_x: { rideId: 'booking_1_capacity_x', customer: { id: 'c' } },
      booking_1_cap_ff_passenger_1: { rideId: 'booking_1_cap_ff_passenger_1', customer: { id: 'c' } },
      booking_2_real: { rideId: 'booking_2_real', receiptId: 'LEAF-2', savedTimestamp: 1, customer: { id: 'customer_1' }, driver: { id: 'driver_1' } }
    };
    const db = { ref: () => ({ orderByKey: () => ({ limitToFirst: () => ({ once: async () => ({ val: () => rows }) }),
      startAfter: () => ({ limitToFirst: () => ({ once: async () => ({ val: () => ({}) }) }) }) }) }) };

    // A short page (RTDB returns n-1 rows after startAfter) must not end the scan.
    const sorted = Array.from({ length: 250 }, (_, i) => `booking_${String(i).padStart(4, '0')}_x`);
    const paged = { ref: () => ({ orderByKey: () => {
      const page = after => ({ limitToFirst: n => ({ once: async () => {
        const start = after ? sorted.indexOf(after) + 1 : 0;
        const keys = sorted.slice(start, start + (after ? n - 1 : n));
        return { val: () => Object.fromEntries(keys.map(k => [k, { rideId: k, customer: { id: 'p' } }])) };
      } }) });
      return { ...page(null), startAfter: after => page(after) };
    } }) };
    const fullScan = await backfill.run({ collection: 'receipts', apply: false, limit: Infinity },
      { db: paged, firestore: {}, log: () => {} });
    expect(fullScan.scanned).toBe(250);
    const saved = new Map();
    const write = jest.spyOn(store, 'write').mockImplementation(async (_fs, receipt) => { saved.set(receipt.rideId, JSON.parse(JSON.stringify(receipt))); });
    const get = jest.spyOn(store, 'getByRideId').mockImplementation(async (_fs, _scope, id) => saved.get(id) || null);
    const quiet = () => {};

    const dry = await backfill.run({ collection: 'receipts', apply: false, limit: Infinity }, { db, firestore: {}, log: quiet });
    expect(dry).toMatchObject({ scanned: 3, skippedFixtures: 2, wouldWrite: 1, written: 0 });
    expect(write).not.toHaveBeenCalled();

    const applied = await backfill.run({ collection: 'receipts', apply: true, ref: 'test', limit: Infinity }, { db, firestore: {}, log: quiet });
    expect(applied).toMatchObject({ written: 1, parityMismatch: 0, errors: 0 });
    const again = await backfill.run({ collection: 'receipts', apply: true, ref: 'test', limit: Infinity }, { db, firestore: {}, log: quiet });
    expect(again).toMatchObject({ written: 0, alreadyEqual: 1 });
    write.mockRestore();
    get.mockRestore();
  });
});
