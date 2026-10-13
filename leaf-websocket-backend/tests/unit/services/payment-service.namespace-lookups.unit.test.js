jest.mock('../../../services/woovi-driver-service', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../firebase-config', () => ({ getFirestore: jest.fn(() => null) }));
jest.mock('firebase-admin', () => ({
  firestore: { FieldValue: { serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__') } }
}));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));
jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({}))
}));

const PaymentService = require('../../../services/payment-service');
const firebaseConfig = require('../../../firebase-config');

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

// Firestore falso em que cada leitura fica pendente até ser liberada pelo teste.
const createDeferredFirestore = () => {
  const pending = [];
  const read = (collectionName) => new Promise((resolve) => {
    pending.push({ collectionName, resolve });
  });
  return {
    pending,
    collection: (collectionName) => ({
      doc: () => ({ get: () => read(collectionName) }),
      where: () => ({ limit: () => ({ get: () => read(collectionName) }) })
    })
  };
};

describe('PaymentService - leituras por namespace no caminho do reembolso', () => {
  it('consulta a payment intent por chargeId nos dois namespaces em paralelo', async () => {
    const firestore = createDeferredFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const lookup = service.getAdvancePaymentIntentByChargeId('charge_parallel');
    await flushAsync();

    expect(firestore.pending.map((entry) => entry.collectionName)).toEqual([
      'payment_intents',
      'sandbox_payment_intents'
    ]);

    firestore.pending.forEach((entry) => entry.resolve({ empty: true, docs: [] }));
    await expect(lookup).resolves.toEqual({ found: false });
  });

  it('mantém o conflito quando a cobrança existe nos dois namespaces', async () => {
    const firestore = createDeferredFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const lookup = service.getAdvancePaymentIntentByChargeId('charge_conflict');
    await flushAsync();
    const doc = { id: 'advance_x', data: () => ({ chargeId: 'charge_conflict' }) };
    firestore.pending.forEach((entry) => entry.resolve({ empty: false, docs: [doc] }));

    await expect(lookup).resolves.toMatchObject({
      found: false,
      code: 'PAYMENT_INTENT_NAMESPACE_CONFLICT'
    });
  });

  it('lê o payment holding nos dois namespaces em paralelo e continua exigindo um único registro', async () => {
    const firestore = createDeferredFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const lookup = service.getPaymentHolding('booking_parallel');
    await flushAsync();

    expect(firestore.pending.map((entry) => entry.collectionName)).toEqual([
      'payment_holdings',
      'sandbox_payment_holdings'
    ]);
    firestore.pending.forEach((entry) => entry.resolve({
      exists: true,
      data: () => ({ status: 'in_holding' })
    }));

    await expect(lookup).resolves.toBeNull();
  });
});
