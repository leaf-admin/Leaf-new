const mockListeners = {};
const mockReleaseInflight = jest.fn();
const mockCheckAndSet = jest.fn();
const mockGenerateKey = jest.fn();
const mockGetDriverWooviAccount = jest.fn();
const mockProcessNetDistribution = jest.fn();
const mockProcessCancellationDistribution = jest.fn();
const mockCreditDriverBalance = jest.fn();
const mockSaveDistributionToFirestore = jest.fn();
const mockUpdatePaymentHolding = jest.fn();
const mockIsMultiLegBillingEnabled = jest.fn();

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
    processCancellationDistribution: mockProcessCancellationDistribution,
    toCents: (value) => Math.round(Number(value || 0) * 100),
    creditDriverBalance: mockCreditDriverBalance,
    saveDistributionToFirestore: mockSaveDistributionToFirestore,
    updatePaymentHolding: mockUpdatePaymentHolding
  }))
);
const mockRedis = { hset: jest.fn(), hdel: jest.fn(), hgetall: jest.fn() };
jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => mockRedis)
}));
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
  isMultiLegBillingEnabled: mockIsMultiLegBillingEnabled
}));


const mockHoldService = {
  isEnabled: jest.fn(() => true),
  evaluateRideHold: jest.fn(),
  recordHold: jest.fn(),
  listDueForRelease: jest.fn(),
  markReleased: jest.fn(),
  registerReleaseAttempt: jest.fn(),
  pruneReleased: jest.fn().mockResolvedValue(0),
  MAX_AUTOMATIC_RELEASE_ATTEMPTS: 30
};
jest.mock('../../../services/payout-hold-service', () => mockHoldService);
const mockNotifyPayoutUnderReview = jest.fn().mockResolvedValue({});
const mockNotifyRideConfirmationRequested = jest.fn().mockResolvedValue({});
jest.mock('../../../services/transactional-push', () => ({
  notifyPayoutUnderReview: (...args) => mockNotifyPayoutUnderReview(...args),
  notifyRideConfirmationRequested: (...args) => mockNotifyRideConfirmationRequested(...args)
}));
const mockBotEmit = jest.fn().mockResolvedValue({ queued: 1 });
jest.mock('../../../services/bot-event-service', () => ({ emit: (...args) => mockBotEmit(...args) }));

const { sweepPayoutHolds } = require('../../../workers/worker-billing');
const { EVENT_TYPES } = require('../../../events');

const completedEvent = {
  eventId: 'event_1',
  data: {
    bookingId: 'booking_1',
    driverId: 'driver_1',
    customerId: 'customer_1',
    finalFare: 42,
    tollFee: 0,
    financialSnapshot: {
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      passengerPaidCents: 4200,
      tollFeeCents: 0,
      operationalFeeCents: 120,
      paymentIntermediationFeeCents: 60,
      subscriptionRetainedFeeCents: 0,
      driverNetAmountCents: 4020
    }
  }
};

describe('worker-billing payout hold', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHoldService.isEnabled.mockReturnValue(true);
    mockGenerateKey.mockReturnValue('driver_1:billing.ride.completed:booking_1');
    mockCheckAndSet.mockResolvedValue({ isNew: true, cachedResult: null });
    mockGetDriverWooviAccount.mockResolvedValue(null);
    mockProcessNetDistribution.mockResolvedValue({ success: true, netAmount: 4020 });
    mockIsMultiLegBillingEnabled.mockReturnValue(false);
  });

  it('holds the credit, frees the idempotency key and notifies driver, passenger and operations', async () => {
    mockHoldService.evaluateRideHold.mockResolvedValue({
      reasons: ['LOCATION_DIVERGENCE'],
      summary: { pickupAddress: 'A', destinationAddress: 'B' }
    });
    mockHoldService.recordHold.mockResolvedValue({ created: true, hold: { status: 'awaiting_passenger' } });

    const result = await mockListeners[EVENT_TYPES.RIDE_COMPLETED](completedEvent);

    expect(result).toEqual({ success: true, held: true, bookingId: 'booking_1' });
    expect(mockProcessNetDistribution).not.toHaveBeenCalled();
    expect(mockHoldService.recordHold).toHaveBeenCalledWith(mockRedis, expect.objectContaining({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      customerId: 'customer_1',
      reasons: ['LOCATION_DIVERGENCE'],
      event: completedEvent
    }));
    expect(mockReleaseInflight).toHaveBeenCalledWith('driver_1:billing.ride.completed:booking_1');
    expect(mockNotifyPayoutUnderReview).toHaveBeenCalledWith({ driverId: 'driver_1', bookingId: 'booking_1' });
    expect(mockNotifyRideConfirmationRequested).toHaveBeenCalledWith({ passengerId: 'customer_1', bookingId: 'booking_1' });
    expect(mockBotEmit).toHaveBeenCalledWith('payout.held', expect.objectContaining({
      bookingId: 'booking_1',
      reasonCode: 'LOCATION_DIVERGENCE'
    }), expect.any(Object));
  });

  it('does not notify again when a redelivered event finds the hold already recorded', async () => {
    mockHoldService.evaluateRideHold.mockResolvedValue({ reasons: ['OPEN_INCIDENT'], summary: {} });
    mockHoldService.recordHold.mockResolvedValue({ created: false, hold: { status: 'in_review' } });

    const result = await mockListeners[EVENT_TYPES.RIDE_COMPLETED](completedEvent);

    expect(result.held).toBe(true);
    expect(mockNotifyPayoutUnderReview).not.toHaveBeenCalled();
    expect(mockBotEmit).not.toHaveBeenCalled();
  });

  it('credits normally when there is no reason, the flag is off or the evaluation fails', async () => {
    mockHoldService.evaluateRideHold.mockResolvedValueOnce({ reasons: [], summary: {} });
    await mockListeners[EVENT_TYPES.RIDE_COMPLETED](completedEvent);

    mockHoldService.isEnabled.mockReturnValueOnce(false);
    await mockListeners[EVENT_TYPES.RIDE_COMPLETED](completedEvent);

    mockHoldService.evaluateRideHold.mockRejectedValueOnce(new Error('redis down'));
    await mockListeners[EVENT_TYPES.RIDE_COMPLETED](completedEvent);

    expect(mockProcessNetDistribution).toHaveBeenCalledTimes(3);
    expect(mockHoldService.recordHold).not.toHaveBeenCalled();
  });

  it('sweep credits due holds through the original event without holding again', async () => {
    mockHoldService.listDueForRelease.mockResolvedValue([
      { bookingId: 'booking_1', driverId: 'driver_1', status: 'release_requested', releaseAttempts: 0, event: completedEvent },
      { bookingId: 'booking_2', status: 'release_requested', releaseAttempts: 30, event: completedEvent }
    ]);
    mockHoldService.evaluateRideHold.mockResolvedValue({ reasons: ['LOCATION_DIVERGENCE'], summary: {} });

    const result = await sweepPayoutHolds({ now: 123 });

    expect(result).toEqual({ due: 2, released: 1 });
    expect(mockHoldService.evaluateRideHold).not.toHaveBeenCalled();
    expect(mockProcessNetDistribution).toHaveBeenCalledTimes(1);
    expect(mockHoldService.markReleased).toHaveBeenCalledWith(mockRedis, 'booking_1', { now: 123 });
  });

  it('sweep records the attempt and keeps the hold when the credit fails', async () => {
    mockHoldService.listDueForRelease.mockResolvedValue([
      { bookingId: 'booking_1', status: 'awaiting_passenger', releaseAttempts: 0, event: completedEvent }
    ]);
    mockProcessNetDistribution.mockResolvedValue({ success: false, error: 'firestore down' });

    const result = await sweepPayoutHolds({ now: 456 });

    expect(result.released).toBe(0);
    expect(mockHoldService.markReleased).not.toHaveBeenCalled();
    expect(mockHoldService.registerReleaseAttempt).toHaveBeenCalledWith(
      mockRedis, 'booking_1', expect.stringContaining('firestore down'), { now: 456 }
    );
  });
});
