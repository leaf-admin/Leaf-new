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
  isDriverLocked: jest.fn(),
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
jest.mock('../../../utils/active-trip-index', () => ({ clearActiveTripForDriver: jest.fn() }));
jest.mock('../../../services/trip-location-persistence-service', () => ({ forceFinalizeTrip: jest.fn() }));
jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  clearBookingSnapshot: jest.fn().mockResolvedValue(undefined),
  applyDriverSnapshot: jest.fn().mockResolvedValue(undefined),
}));

const RideStateManager = require('../../../services/ride-state-manager');
const PaymentService = require('../../../services/payment-service');
const redisPool = require('../../../utils/redis-pool');
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
});
