jest.mock('../../../events/ride.canceled', () =>
  jest.fn().mockImplementation((payload) => ({
    toJSON: jest.fn(() => payload),
  }))
);
jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    SEARCHING: 'SEARCHING',
    PENDING: 'PENDING',
    NOTIFIED: 'NOTIFIED',
    ACCEPTED: 'ACCEPTED',
    ARRIVED: 'ARRIVED',
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    EARLY_ENDED_BY_RIDER: 'EARLY_ENDED_BY_RIDER',
    EARLY_ENDED_REVIEW: 'EARLY_ENDED_REVIEW',
    CANCELED: 'CANCELED',
  },
  getBookingState: jest.fn(),
  updateBookingState: jest.fn(),
}));
jest.mock('../../../services/payment-service', () => jest.fn());
jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn().mockResolvedValue({ isLocked: false, bookingId: null }),
  releaseLock: jest.fn(),
}));
jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logStructured: jest.fn(),
}));
jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, callback) => callback()),
}));
jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: { recordCommand: jest.fn() },
}));
jest.mock('../../../utils/tracer', () => ({
  getTracer: jest.fn(() => ({
    startSpan: jest.fn(() => ({ setStatus: jest.fn(), end: jest.fn(), recordException: jest.fn() })),
  })),
}));
jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test'),
}));
jest.mock('../../../utils/active-trip-index', () => ({
  clearActiveTripForDriver: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../services/trip-location-persistence-service', () => ({ forceFinalizeTrip: jest.fn() }));
jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  clearBookingSnapshot: jest.fn().mockResolvedValue(undefined),
  applyDriverSnapshot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../services/kyc-policy-service', () => ({
  applyDeferredIdentityReverificationIfSafe: jest.fn().mockResolvedValue({
    success: true,
    applied: false,
  }),
}));

const RideStateManager = require('../../../services/ride-state-manager');
const PaymentService = require('../../../services/payment-service');
const redisPool = require('../../../utils/redis-pool');
const kycPolicyService = require('../../../services/kyc-policy-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const CancelRideCommand = require('../../../commands/CancelRideCommand');

describe('CancelRideCommand authorization and terminal guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisPool.getConnection.mockReturnValue({
      hgetall: jest.fn().mockResolvedValue({
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'SEARCHING',
      }),
    });
    RideStateManager.getBookingState.mockResolvedValue('SEARCHING');
  });

  it('refuses a cancellation actor who is not the passenger, driver, or trusted integrity service', async () => {
    const command = new CancelRideCommand({
      bookingId: 'booking_1',
      canceledBy: 'unrelated_user',
      userType: 'customer',
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('não autorizado');
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
  });

  it('allows the dedicated system integrity actor to cancel an in-progress ride', async () => {
    const command = new CancelRideCommand({
      bookingId: 'booking_1',
      canceledBy: 'system_trip_integrity',
      userType: 'system',
    });

    expect(CancelRideCommand.isAuthorizedCancellationActor({
      canceledBy: command.canceledBy,
      userType: command.userType,
      customerId: 'customer_1',
      driverId: 'driver_1',
    })).toBe(true);
  });

  it('keeps sandbox cancellation out of operational KYC state', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'sandbox-test-user',
      paymentProfileSource: 'test',
      testUserSandbox: true,
    });
    const getStoredPayment = jest.fn().mockResolvedValue(null);
    PaymentService.mockImplementation(() => ({
      WOOVI_FEE_PERCENTAGE: 0.0099,
      WOOVI_FEE_MINIMUM: 50,
      getStoredPayment,
    }));
    const redis = {
      hgetall: jest.fn().mockImplementation(async (key) => {
        if (key === 'booking:booking_sandbox_cancel') {
          return {
            customerId: 'customer_1',
            driverId: 'driver_1',
            status: 'SEARCHING',
            financialContext: JSON.stringify(financialContext),
            financialNamespace: 'sandbox',
            financialContextId: financialContext.contextId,
            paymentProviderEnvironment: 'sandbox',
            testUserSandbox: 'true',
          };
        }
        return {};
      }),
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue('booking_sandbox_cancel'),
      del: jest.fn().mockResolvedValue(1),
      geopos: jest.fn().mockResolvedValue([]),
    };
    redisPool.getConnection.mockReturnValue(redis);
    RideStateManager.getBookingState.mockResolvedValue('SEARCHING');
    RideStateManager.updateBookingState.mockResolvedValue({ success: true });

    const result = await new CancelRideCommand({
      bookingId: 'booking_sandbox_cancel',
      canceledBy: 'customer_1',
      userType: 'customer',
      reason: 'Teste sandbox',
    }).execute();

    expect(result.success).toBe(true);
    expect(getStoredPayment).toHaveBeenCalledWith('booking_sandbox_cancel', financialContext);
    expect(result.data.event).toEqual(expect.objectContaining({
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
    }));
    expect(kycPolicyService.applyDeferredIdentityReverificationIfSafe).not.toHaveBeenCalled();
  });

  it('refunds canonical confirmed payments with chargeId on cancellation', async () => {
    const processRideRefund = jest.fn().mockResolvedValue({ success: true, refundId: 'refund_confirmed_1' });
    PaymentService.mockImplementation(() => ({
      WOOVI_FEE_PERCENTAGE: 0.0099,
      WOOVI_FEE_MINIMUM: 50,
      getStoredPayment: jest.fn().mockResolvedValue({
        status: 'CONFIRMED',
        chargeId: 'charge_confirmed_1',
        amount: 8750,
        passengerId: 'customer_1',
      }),
      processRideRefund,
    }));
    redisPool.getConnection.mockReturnValue({
      hgetall: jest.fn().mockImplementation(async (key) => {
        if (key === 'booking:booking_confirmed_refund') {
          return {
            customerId: 'customer_1',
            driverId: '',
            status: 'SEARCHING',
          };
        }
        return {};
      }),
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue('booking_confirmed_refund'),
      del: jest.fn().mockResolvedValue(1),
      geopos: jest.fn().mockResolvedValue([]),
    });
    RideStateManager.getBookingState.mockResolvedValue('SEARCHING');
    RideStateManager.updateBookingState.mockResolvedValue({ success: true });

    const command = new CancelRideCommand({
      bookingId: 'booking_confirmed_refund',
      canceledBy: 'customer_1',
      userType: 'customer',
      reason: 'Teste refund confirmado',
      cancellationFee: 999999,
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(processRideRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: 'booking_confirmed_refund',
        chargeId: 'charge_confirmed_1',
        amount: 8750,
        status: 'REFUNDED_FULL',
        passengerId: 'customer_1',
      })
    );
  });

  it('ignores a client fee and calculates the accepted-ride fee from canonical backend data', async () => {
    const processRideRefund = jest.fn().mockResolvedValue({
      success: true,
      refundId: 'refund_canonical_fee_1',
      amount: 9701,
      chargeId: 'charge_canonical_fee_1',
    });
    PaymentService.mockImplementation(() => ({
      WOOVI_FEE_PERCENTAGE: 0.0099,
      WOOVI_FEE_MINIMUM: 50,
      getStoredPayment: jest.fn().mockResolvedValue({
        status: 'PAID',
        chargeId: 'charge_canonical_fee_1',
        amount: 10000,
        passengerId: 'customer_1',
      }),
      processRideRefund,
    }));
    redisPool.getConnection.mockReturnValue({
      hgetall: jest.fn().mockImplementation(async (key) => {
        if (key === 'booking:booking_canonical_fee') {
          return {
            customerId: 'customer_1',
            driverId: '',
            status: 'ACCEPTED',
            acceptedAt: String(Date.now()),
            estimatedFare: '100',
            driverDistanceToPickupKm: '0',
          };
        }
        return {};
      }),
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue('booking_canonical_fee'),
      del: jest.fn().mockResolvedValue(1),
      geopos: jest.fn().mockResolvedValue([]),
    });
    RideStateManager.getBookingState.mockResolvedValue('ACCEPTED');
    RideStateManager.updateBookingState.mockResolvedValue({ success: true });

    const command = new CancelRideCommand({
      bookingId: 'booking_canonical_fee',
      canceledBy: 'customer_1',
      userType: 'customer',
      reason: 'Teste taxa canônica',
      cancellationFee: 999999,
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(result.data.cancellationFee).toBe(299);
    // Sem motorista atribuído não há a quem creditar: nenhuma pendência é registrada.
    expect(
      redisPool.getConnection.mock.results
        .flatMap((entry) => entry.value?.hset?.mock?.calls || [])
        .some(([key]) => key === 'billing:cancellation_credit_pending')
    ).toBe(false);
    expect(processRideRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: 'booking_canonical_fee',
        chargeId: 'charge_canonical_fee_1',
        amount: 9701,
        cancellationFee: 299,
        status: 'REFUNDED_PARTIAL',
      })
    );
  });
  it('charges the no-show wait fee in cents of a fare stored in reais', async () => {
    const processRideRefund = jest.fn().mockResolvedValue({ success: true, refundId: 'refund_no_show_1' });
    PaymentService.mockImplementation(() => ({
      WOOVI_FEE_PERCENTAGE: 0.0099,
      WOOVI_FEE_MINIMUM: 50,
      getStoredPayment: jest.fn().mockResolvedValue({
        status: 'PAID',
        chargeId: 'charge_no_show_1',
        amount: 4507,
        passengerId: 'customer_1',
      }),
      processRideRefund,
    }));
    redisPool.getConnection.mockReturnValue({
      hgetall: jest.fn().mockImplementation(async (key) => {
        if (key === 'booking:booking_no_show') {
          return {
            customerId: 'customer_1',
            driverId: 'driver_1',
            status: 'ARRIVED',
            driverArrivedAt: String(Date.now() - 5 * 60000 - 2000),
            estimatedFare: '45.07',
          };
        }
        return {};
      }),
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue('booking_no_show'),
      del: jest.fn().mockResolvedValue(1),
      geopos: jest.fn().mockResolvedValue([]),
    });
    RideStateManager.getBookingState.mockResolvedValue('ARRIVED');
    RideStateManager.updateBookingState.mockResolvedValue({ success: true });

    const result = await new CancelRideCommand({
      bookingId: 'booking_no_show',
      canceledBy: 'driver_1',
      userType: 'driver',
      reason: 'Passageiro não compareceu ao embarque.',
    }).execute();

    expect(result.success).toBe(true);
    // 5 min x R$ 0,50 + R$ 0,50; the 40% cap is R$ 18,02, not R$ 0,18.
    expect(result.data.cancellationFee).toBe(300);
    // O crédito devido ao motorista fica registrado antes do evento, para não depender só dele.
    const pendingCall = require('../../../utils/redis-pool')
      .getConnection.mock.results.flatMap((entry) => entry.value?.hset?.mock?.calls || [])
      .find(([key]) => key === 'billing:cancellation_credit_pending');
    expect(pendingCall).toBeDefined();
    expect(pendingCall[1]).toBe(result.data.bookingId);
    expect(JSON.parse(pendingCall[2])).toMatchObject({
      bookingId: result.data.bookingId,
      driverId: result.data.driverId,
      cancellationFee: 300,
      attempts: 0,
    });
  });
});

describe('CancelRideCommand ordering of refund, state commit and post-commit work', () => {
  const tripLocationPersistenceService = require('../../../services/trip-location-persistence-service');
  const { logStructured } = require('../../../utils/logger');
  const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

  const arrangeDriverCancel = ({ processRideRefund }) => {
    PaymentService.mockImplementation(() => ({
      WOOVI_FEE_PERCENTAGE: 0.0099,
      WOOVI_FEE_MINIMUM: 50,
      getStoredPayment: jest.fn().mockResolvedValue({
        status: 'CONFIRMED',
        chargeId: 'charge_driver_cancel',
        amount: 4861,
        passengerId: 'customer_1',
      }),
      processRideRefund,
    }));
    redisPool.getConnection.mockReturnValue({
      hgetall: jest.fn().mockImplementation(async (key) => {
        if (key === 'booking:booking_driver_cancel') {
          return { customerId: 'customer_1', driverId: 'driver_1', status: 'ACCEPTED' };
        }
        return {};
      }),
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue('booking_driver_cancel'),
      del: jest.fn().mockResolvedValue(1),
      geopos: jest.fn().mockResolvedValue([]),
    });
    RideStateManager.getBookingState.mockResolvedValue('ACCEPTED');
    RideStateManager.updateBookingState.mockResolvedValue({ success: true });
    return new CancelRideCommand({
      bookingId: 'booking_driver_cancel',
      canceledBy: 'driver_1',
      userType: 'driver',
      reason: 'Motorista cancelou',
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tripLocationPersistenceService.forceFinalizeTrip.mockReset();
  });

  it('answers after the refund and the state commit without waiting for the location trail flush', async () => {
    const order = [];
    const processRideRefund = jest.fn().mockImplementation(async () => {
      order.push('refund');
      return { success: true, refundId: 'refund_driver_cancel', amount: 4861 };
    });
    const command = arrangeDriverCancel({ processRideRefund });
    RideStateManager.updateBookingState.mockImplementation(async () => {
      order.push('state_commit');
      return { success: true };
    });
    let releaseFlush;
    tripLocationPersistenceService.forceFinalizeTrip.mockImplementation(() => {
      order.push('location_flush_started');
      return new Promise((resolve) => { releaseFlush = resolve; });
    });

    const result = await command.execute();

    // O flush ainda está pendente e o command já respondeu.
    expect(result.success).toBe(true);
    expect(order).toEqual(['refund', 'state_commit', 'location_flush_started']);
    expect(processRideRefund).toHaveBeenCalledTimes(1);
    expect(processRideRefund).toHaveBeenCalledWith(expect.objectContaining({
      rideId: 'booking_driver_cancel',
      chargeId: 'charge_driver_cancel',
      amount: 4861,
      status: 'REFUNDED_FULL',
    }));
    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      expect.anything(),
      'booking_driver_cancel',
      'CANCELED',
      expect.objectContaining({ canceledBy: 'driver_1' })
    );
    expect(tripLocationPersistenceService.forceFinalizeTrip).toHaveBeenCalledWith(
      'booking_driver_cancel',
      expect.objectContaining({ status: 'canceled', reason: 'ride_canceled' })
    );
    expect(result.data.refundResult).toMatchObject({ success: true, refundId: 'refund_driver_cancel' });

    releaseFlush({ success: true });
    await flushAsync();
  });

  it('still fails the cancellation and commits nothing when the refund fails', async () => {
    const processRideRefund = jest.fn().mockResolvedValue({ success: false, error: 'Falha ao processar reembolso' });
    const command = arrangeDriverCancel({ processRideRefund });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Falha ao processar reembolso');
    expect(processRideRefund).toHaveBeenCalledTimes(1);
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
    expect(tripLocationPersistenceService.forceFinalizeTrip).not.toHaveBeenCalled();
  });

  it('still logs a location trail flush failure without failing the cancellation', async () => {
    const processRideRefund = jest.fn().mockResolvedValue({ success: true, refundId: 'refund_driver_cancel' });
    const command = arrangeDriverCancel({ processRideRefund });
    tripLocationPersistenceService.forceFinalizeTrip.mockRejectedValue(new Error('firestore unavailable'));

    const result = await command.execute();
    await flushAsync();

    expect(result.success).toBe(true);
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'Falha ao finalizar trilha de localização da corrida cancelada',
      expect.objectContaining({ bookingId: 'booking_driver_cancel', error: 'firestore unavailable' })
    );
  });
});
