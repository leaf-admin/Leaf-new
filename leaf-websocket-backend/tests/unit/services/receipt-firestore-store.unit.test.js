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
    expect(document).toMatchObject({
      schema: 1, customerId: 'customer_1', driverId: 'driver_1', financialNamespace: 'operational',
      financialContextId: 'operational', savedAt: { ms: 1792947990000 }, mirroredFrom: 'rtdb',
      financial: { grossAmount: 42.14, driverNetAmount: 40.65, tollAmount: 9.95 }
    });
    expect('optional' in document).toBe(false);
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

    const same = fakeFirestore({ customerId: 'customer_1', driverId: 'driver_1', financialContextId: 'operational' });
    await store.mirror(same.firestore, receipt(), scope, options);
    expect(same.writes).toHaveLength(1);

    const other = fakeFirestore({ customerId: 'customer_2', driverId: 'driver_1', financialContextId: 'operational' });
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
});
