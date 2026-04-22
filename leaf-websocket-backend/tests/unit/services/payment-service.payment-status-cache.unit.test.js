const mockCacheStore = new Map();

jest.mock('../../../services/woovi-driver-service', () =>
  jest.fn().mockImplementation(() => ({
    getChargeStatus: jest.fn().mockResolvedValue({
      success: false,
      error: 'not found'
    })
  }))
);

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({
    set: jest.fn(async (key, value) => {
      mockCacheStore.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key) => mockCacheStore.get(key) || null),
    hgetall: jest.fn(async () => ({}))
  }))
}));

const PaymentService = require('../../../services/payment-service');

describe('PaymentService payment status cache', () => {
  beforeEach(() => {
    mockCacheStore.clear();
  });

  it('reads confirmed payment status from redis cache before falling back to external providers', async () => {
    const service = new PaymentService();

    await service.writePaymentStatusCache('charge_123', {
      status: 'in_holding',
      amount: 1342,
      paidAt: '2026-04-01T23:00:00.000Z'
    });

    const result = await service.getPaymentStatus('charge_123');

    expect(result).toMatchObject({
      success: true,
      status: 'in_holding',
      amount: 1342,
      source: 'payment_status_cache'
    });
  });

  it('writes cache entries for rideId and chargeId when saving payment holding', async () => {
    const service = new PaymentService();

    const result = await service.savePaymentHolding('temp_ride_123', {
      status: 'in_holding',
      amount: 1342,
      paymentId: 'charge_abc',
      chargeId: 'charge_abc',
      paidAt: '2026-04-01T23:00:00.000Z',
      confirmedAt: '2026-04-01T23:00:00.000Z'
    });

    expect(result.success).toBe(false);
    expect(mockCacheStore.has('payment_status_cache:temp_ride_123')).toBe(true);
    expect(mockCacheStore.has('payment_status_cache:charge_abc')).toBe(true);
  });
});
