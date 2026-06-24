const mockListeners = {};
const mockReleaseInflight = jest.fn();
const mockCheckAndSet = jest.fn();
const mockGenerateKey = jest.fn();
const mockGetDriverWooviAccount = jest.fn();
const mockProcessNetDistribution = jest.fn();
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
    toCents: (value) => Math.round(Number(value || 0) * 100),
    creditDriverBalance: mockCreditDriverBalance,
    saveDistributionToFirestore: mockSaveDistributionToFirestore,
    updatePaymentHolding: mockUpdatePaymentHolding
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
  isMultiLegBillingEnabled: mockIsMultiLegBillingEnabled
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
    mockCreditDriverBalance.mockResolvedValue({ success: true, balanceId: 'driver_1' });
    mockSaveDistributionToFirestore.mockResolvedValue({ success: true });
    mockUpdatePaymentHolding.mockResolvedValue({ success: true });
    mockIsMultiLegBillingEnabled.mockReturnValue(false);
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
      financialSnapshot: expect.objectContaining({
        authoritativeSnapshot: true,
        passengerPaidCents: 4200,
        driverNetAmountCents: 4020
      }),
      wooviAccountId: null,
      driverPixKey: null
    });
    expect(mockReleaseInflight).not.toHaveBeenCalled();
  });

  it('rejects standard ride settlement without the backend-final financial snapshot', async () => {
    await expect(
      mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
        eventId: 'event_snapshot_missing',
        data: {
          bookingId: 'booking_snapshot_missing',
          driverId: 'driver_1',
          finalFare: 42,
          tollFee: 0
        }
      })
    ).rejects.toThrow('FINANCIAL_SNAPSHOT_NOT_AUTHORITATIVE');

    expect(mockReleaseInflight).toHaveBeenCalledWith('driver_1:billing.ride.completed:booking_1');
    expect(mockProcessNetDistribution).not.toHaveBeenCalled();
  });

  it('stores manual settlement review and does not credit driver automatically', async () => {
    const result = await mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
      eventId: 'event_review_1',
      data: {
        bookingId: 'booking_review',
        driverId: 'driver_1',
        finalFare: 42,
        tollFee: 0,
        settlementReviewRequired: true,
        paymentDistribution: {
          status: 'UNDER_REVIEW',
          reason: 'DRIVER_OFFLINE_TIME_ADJUSTMENT_REVIEW'
        },
        offlineSettlementReview: {
          settlementType: 'DRIVER_OFFLINE_TIME_ADJUSTMENT_REVIEW',
          estimatedAdjustmentAmount: 0.5,
          requiresExplicitLedgerSettlement: true
        }
      }
    });

    expect(result).toMatchObject({
      success: true,
      data: expect.objectContaining({
        rideId: 'booking_review',
        driverId: 'driver_1',
        status: 'under_review',
        mode: 'manual_settlement_required',
        reason: 'DRIVER_OFFLINE_TIME_ADJUSTMENT_REVIEW'
      })
    });
    expect(mockSaveDistributionToFirestore).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: 'booking_review',
        status: 'under_review',
        totalAmount: 4200,
        offlineSettlementReview: expect.objectContaining({
          requiresExplicitLedgerSettlement: true
        })
      })
    );
    expect(mockUpdatePaymentHolding).toHaveBeenCalledWith(
      'booking_review',
      expect.objectContaining({
        status: 'under_review',
        distributionData: expect.objectContaining({
          reason: 'DRIVER_OFFLINE_TIME_ADJUSTMENT_REVIEW'
        })
      })
    );
    expect(mockProcessNetDistribution).not.toHaveBeenCalled();
    expect(mockCreditDriverBalance).not.toHaveBeenCalled();
  });

  it('fails explicitly when multi-leg billing is received before rollout flag is enabled', async () => {
    await expect(
      mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
        eventId: 'event_multi_disabled',
        data: {
          bookingId: 'booking_multi',
          driverId: 'driver_1',
          finalFare: 40,
          rideLegSettlements: [
            { legNumber: 1, driverId: 'driver_a', grossAmount: 18, driverNetAmount: 16 },
            { legNumber: 2, driverId: 'driver_b', grossAmount: 22, driverNetAmount: 22 }
          ]
        }
      })
    ).rejects.toThrow('Multi-leg billing desabilitado');

    expect(mockReleaseInflight).toHaveBeenCalledWith('driver_1:billing.ride.completed:booking_1');
    expect(mockProcessNetDistribution).not.toHaveBeenCalled();
    expect(mockCreditDriverBalance).not.toHaveBeenCalled();
  });

  it('credits each ride leg through the internal ledger when multi-leg billing is enabled', async () => {
    mockIsMultiLegBillingEnabled.mockReturnValue(true);
    mockCreditDriverBalance
      .mockResolvedValueOnce({ success: true, balanceId: 'balance_driver_a' })
      .mockResolvedValueOnce({ success: true, balanceId: 'balance_driver_b' });

    const result = await mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
      eventId: 'event_multi_enabled',
      data: {
        bookingId: 'booking_multi',
        driverId: 'driver_1',
        finalFare: 40,
        rideLegSettlements: [
          {
            legId: 'leg_1',
            legNumber: 1,
            driverId: 'driver_a',
            grossAmount: 18,
            driverNetAmount: 16,
            operationalFee: 1.2,
            paymentIntermediationFee: 0.8,
            platformAbsorbedOperationalFee: 0,
            platformAbsorbedPaymentIntermediationFee: 0
          },
          {
            legId: 'leg_2',
            legNumber: 2,
            driverId: 'driver_b',
            grossAmount: 22,
            driverNetAmount: 22,
            operationalFee: 0,
            paymentIntermediationFee: 0,
            platformAbsorbedOperationalFee: 1.4,
            platformAbsorbedPaymentIntermediationFee: 0.6
          }
        ]
      }
    });

    expect(result).toMatchObject({
      success: true,
      data: expect.objectContaining({
        rideId: 'booking_multi',
        status: 'distributed',
        mode: 'multi_leg',
        totalGrossAmount: 40,
        totalDriverNetAmount: 38
      })
    });
    expect(mockCreditDriverBalance).toHaveBeenNthCalledWith(1, 'driver_a', 1600, 'booking_multi:leg:1');
    expect(mockCreditDriverBalance).toHaveBeenNthCalledWith(2, 'driver_b', 2200, 'booking_multi:leg:2');
    expect(mockSaveDistributionToFirestore).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: 'booking_multi',
        mode: 'multi_leg',
        legs: expect.arrayContaining([
          expect.objectContaining({ driverId: 'driver_a', balanceCreditId: 'balance_driver_a' }),
          expect.objectContaining({ driverId: 'driver_b', balanceCreditId: 'balance_driver_b' })
        ])
      })
    );
    expect(mockUpdatePaymentHolding).toHaveBeenCalledWith(
      'booking_multi',
      expect.objectContaining({
        status: 'distributed',
        distributionData: expect.objectContaining({ mode: 'multi_leg' })
      })
    );
    expect(mockProcessNetDistribution).not.toHaveBeenCalled();
  });
});
