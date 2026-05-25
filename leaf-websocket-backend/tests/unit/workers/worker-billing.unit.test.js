const mockListeners = {};
const mockReleaseInflight = jest.fn();
const mockCheckAndSet = jest.fn();
const mockGenerateKey = jest.fn();
const mockGetDriverWooviAccount = jest.fn();
const mockProcessNetDistribution = jest.fn();

jest.mock('../../../workers/WorkerManager', () => {
  return jest.fn().mockImplementation(() => ({
    registerListener: jest.fn((eventType, handler) => {
      mockListeners[eventType] = handler;
    }),
    start: jest.fn(),
    stop: jest.fn(),
    getStats: jest.fn(() => ({}))
  }));
});

jest.mock('../../../services/payment-service', () =>
  jest.fn().mockImplementation(() => ({
    processNetDistribution: mockProcessNetDistribution,
    toCents: (value) => Math.round(Number(value || 0) * 100),
    creditDriverBalance: jest.fn(),
    saveDistributionToFirestore: jest.fn(),
    updatePaymentHolding: jest.fn().mockResolvedValue({ success: true })
  }))
);
jest.mock('../../../services/driver-approval-service', () => ({
  getDriverWooviAccount: mockGetDriverWooviAccount
}));
jest.mock('../../../services/idempotency-service', () => ({
  generateKey: mockGenerateKey,
  checkAndSet: mockCheckAndSet,
  releaseInflight: mockReleaseInflight,
  cacheResult: jest.fn()
}));
jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));
jest.mock('../../../utils/ride-lifecycle-feature-flags', () => ({
  isMultiLegBillingEnabled: jest.fn(() => false)
}));

const {
  normalizeMoneyToCents,
  buildRideBillingIdempotencyScope,
  buildCancellationBillingIdempotencyScope
} = require('../../../workers/worker-billing');
const { EVENT_TYPES } = require('../../../events');

describe('worker-billing money normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateKey.mockReturnValue('driver_1:billing.ride.completed:booking_1');
    mockCheckAndSet.mockResolvedValue({ isNew: true, cachedResult: null });
    mockGetDriverWooviAccount.mockResolvedValue(null);
    mockProcessNetDistribution.mockResolvedValue({
      success: true,
      netAmount: 4041,
      balanceCreditId: 'driver_1'
    });
  });

  it('normalizes reais values to cents before payment distribution', () => {
    expect(normalizeMoneyToCents(15.06)).toBe(1506);
    expect(normalizeMoneyToCents('42')).toBe(4200);
    expect(normalizeMoneyToCents('0.5')).toBe(50);
    expect(normalizeMoneyToCents(null)).toBe(0);
    expect(normalizeMoneyToCents('invalid')).toBe(0);
  });

  it('uses deterministic booking scopes for billing idempotency', () => {
    expect(buildRideBillingIdempotencyScope('booking_1', 'event_a')).toBe('booking_1');
    expect(buildRideBillingIdempotencyScope('booking_1', 'event_b')).toBe('booking_1');
    expect(buildCancellationBillingIdempotencyScope('booking_1', 'driver_1', 'event_a')).toBe(
      'booking_1:driver_1'
    );
    expect(buildCancellationBillingIdempotencyScope('booking_1', 'driver_1', 'event_b')).toBe(
      'booking_1:driver_1'
    );
  });

  it('credits internal ledger even when driver Woovi account is missing', async () => {
    const result = await mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
      eventId: 'event_1',
      data: {
        bookingId: 'booking_1',
        driverId: 'driver_1',
        finalFare: 42,
        tollFee: 0
      }
    });

    expect(result).toMatchObject({
      success: true,
      netAmount: 4041,
      balanceCreditId: 'driver_1'
    });
    expect(mockGenerateKey).toHaveBeenCalledWith(
      'driver_1',
      'billing.ride.completed',
      'booking_1'
    );
    expect(mockProcessNetDistribution).toHaveBeenCalledWith({
      rideId: 'booking_1',
      driverId: 'driver_1',
      totalAmount: 4200,
      tollFee: 0,
      wooviAccountId: null,
      driverPixKey: null
    });
    expect(mockReleaseInflight).not.toHaveBeenCalled();
  });
});
