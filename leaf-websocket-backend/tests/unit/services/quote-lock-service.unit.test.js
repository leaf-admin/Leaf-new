const {
  createQuoteLock,
  validateQuoteLock
} = require('../../../services/quote-lock-service');

function createRedisMock() {
  const store = new Map();
  return {
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key) => store.get(key) || null)
  };
}

describe('quote-lock-service', () => {
  it('creates and validates a quote lock for the same route and amount', async () => {
    const redis = createRedisMock();
    const created = await createQuoteLock({
      redis,
      quoteSessionId: 'quote_session_1',
      passengerId: 'passenger_1',
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      destinationLocation: { lat: -22.870711, lng: -43.342938 },
      carType: 'Leaf Plus',
      estimatedFare: 27.5,
      grossEstimatedFare: 27.5,
      passengerPayableFare: 27.5,
      rateCardVersion: 'test-rate-card',
      ttlSeconds: 120
    });

    expect(created.success).toBe(true);
    expect(created.quoteLockId).toMatch(/^ql_/);

    const validation = await validateQuoteLock({
      redis,
      quoteLockId: created.quoteLockId,
      quoteSessionId: 'quote_session_1',
      passengerId: 'passenger_1',
      amountInCents: 2750,
      grossAmountInCents: 2750,
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      destinationLocation: { lat: -22.870711, lng: -43.342938 },
      carType: 'Leaf Plus'
    });

    expect(validation).toEqual(expect.objectContaining({
      success: true,
      payableAmountInCents: 2750,
      grossAmountInCents: 2750
    }));
  });

  it('rejects a payment amount that diverges from the locked quote', async () => {
    const redis = createRedisMock();
    const created = await createQuoteLock({
      redis,
      quoteSessionId: 'quote_session_1',
      passengerId: 'passenger_1',
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      destinationLocation: { lat: -22.870711, lng: -43.342938 },
      carType: 'Leaf Plus',
      estimatedFare: 27.5,
      passengerPayableFare: 27.5,
      ttlSeconds: 120
    });

    const validation = await validateQuoteLock({
      redis,
      quoteLockId: created.quoteLockId,
      quoteSessionId: 'quote_session_1',
      passengerId: 'passenger_1',
      amountInCents: 8050,
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      destinationLocation: { lat: -22.870711, lng: -43.342938 },
      carType: 'Leaf Plus'
    });

    expect(validation).toEqual(expect.objectContaining({
      success: false,
      code: 'QUOTE_LOCK_AMOUNT_MISMATCH',
      expectedAmountInCents: 2750,
      incomingAmountInCents: 8050
    }));
  });
});
