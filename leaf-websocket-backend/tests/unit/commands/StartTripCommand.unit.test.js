jest.mock('../../../events/ride.started', () => {
  return jest.fn().mockImplementation((data) => ({
    toJSON: () => ({ ...data, type: 'ride.started' })
  }));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    ACCEPTED: 'ACCEPTED',
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS'
  },
  getBookingState: jest.fn(),
  isValidTransition: jest.fn(),
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

const mockGetPaymentStatus = jest.fn();
jest.mock('../../../services/payment-service', () => {
  return jest.fn().mockImplementation(() => ({
    getPaymentStatus: mockGetPaymentStatus
  }));
});

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logStructured: jest.fn()
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, fn) => fn())
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordCommand: jest.fn()
  }
}));

jest.mock('../../../utils/tracer', () => ({
  getTracer: jest.fn(() => ({
    startSpan: jest.fn(() => ({
      addEvent: jest.fn(),
      setStatus: jest.fn(),
      setAttribute: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn()
    }))
  }))
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/active-trip-index', () => ({
  setActiveTripForDriver: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  rehydratePrimaryBooking: jest.fn().mockResolvedValue(null),
  writeVisibleBookingSnapshot: jest.fn().mockResolvedValue(true)
}));

const RideStartedEvent = require('../../../events/ride.started');
const RideStateManager = require('../../../services/ride-state-manager');
const PaymentService = require('../../../services/payment-service');
const redisPool = require('../../../utils/redis-pool');
const { setActiveTripForDriver } = require('../../../utils/active-trip-index');
const { metrics } = require('../../../utils/prometheus-metrics');
const traceContext = require('../../../utils/trace-context');
const { getTracer } = require('../../../utils/tracer');
const StartTripCommand = require('../../../commands/StartTripCommand');

describe('StartTripCommand', () => {
  let redis;

  beforeEach(() => {
    jest.clearAllMocks();

    redis = {
      hgetall: jest.fn().mockResolvedValue({
        driverId: 'driver_1',
        customerId: 'customer_1',
        paymentStatus: 'confirmed',
        paymentChargeId: 'charge_1',
        paymentAmountInCents: '3840',
        arrivalRegisteredAt: '2026-04-07T10:00:00.000Z'
      }),
      hset: jest.fn().mockResolvedValue(1)
    };

    redisPool.getConnection.mockReturnValue(redis);
    RideStartedEvent.mockImplementation((data) => ({
      toJSON: () => ({ ...data, type: 'ride.started' })
    }));
    PaymentService.mockImplementation(() => ({
      getPaymentStatus: mockGetPaymentStatus
    }));
    traceContext.runWithTraceId.mockImplementation(async (_traceId, fn) => fn());
    getTracer.mockReturnValue({
      startSpan: jest.fn(() => ({
        addEvent: jest.fn(),
        setStatus: jest.fn(),
        setAttribute: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn()
      }))
    });
    RideStateManager.isValidTransition.mockReturnValue(true);
    mockGetPaymentStatus.mockResolvedValue({
      success: true,
      status: 'in_holding',
      source: 'woovi_provider',
      chargeId: 'charge_1',
      amount: 3840,
      providerEnvironment: 'sandbox',
      paymentProfileId: 'test-user-sandbox'
    });
  });

  it('blocks trip start before arrival at pickup is registered', async () => {
    RideStateManager.getBookingState.mockResolvedValue('ACCEPTED');

    const command = new StartTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      startLocation: { lat: -23.55, lng: -46.63 }
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('após registrar chegada');
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
  });

  it('blocks trip start when payment is not confirmed', async () => {
    redis.hgetall.mockResolvedValue({
      driverId: 'driver_1',
      customerId: 'customer_1',
      paymentStatus: 'pending',
      paymentChargeId: 'charge_1',
      paymentAmountInCents: '3840',
      arrivalRegisteredAt: '2026-04-07T10:00:00.000Z'
    });
    RideStateManager.getBookingState.mockResolvedValue('ARRIVED');
    mockGetPaymentStatus.mockResolvedValue({
      success: true,
      status: 'pending',
      source: 'woovi_provider',
      chargeId: 'charge_1',
      amount: 3840,
      providerEnvironment: 'sandbox',
      paymentProfileId: 'test-user-sandbox'
    });

    const command = new StartTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      startLocation: { lat: -23.55, lng: -46.63 }
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Pagamento não confirmado');
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
  });

  it('blocks trip start when Redis says paid but no provider-backed proof exists', async () => {
    redis.hgetall.mockResolvedValue({
      driverId: 'driver_1',
      customerId: 'customer_1',
      paymentStatus: 'confirmed',
      paymentChargeId: 'charge_1',
      paymentAmountInCents: '3840',
      arrivalRegisteredAt: '2026-04-07T10:00:00.000Z'
    });
    RideStateManager.getBookingState.mockResolvedValue('ARRIVED');
    mockGetPaymentStatus.mockResolvedValue({
      success: true,
      status: 'in_holding',
      source: 'booking_cache',
      chargeId: 'charge_1',
      amount: 3840
    });

    const command = new StartTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      startLocation: { lat: -23.55, lng: -46.63 }
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Pagamento não confirmado pelo provedor');
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
  });

  it('starts the trip from a valid arrived state with confirmed payment', async () => {
    RideStateManager.getBookingState.mockResolvedValue('ARRIVED');

    const command = new StartTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      startLocation: { lat: -23.55, lng: -46.63 }
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(setActiveTripForDriver).toHaveBeenCalledWith(
      redis,
      'driver_1',
      'booking_1',
      'customer_1'
    );
    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      redis,
      'booking_1',
      'IN_PROGRESS',
      expect.objectContaining({
        driverId: 'driver_1',
        startLocation: { lat: -23.55, lng: -46.63 }
      })
    );
    expect(redis.hset).toHaveBeenCalledWith(
      'booking:booking_1',
      expect.objectContaining({
        status: 'IN_PROGRESS'
      })
    );
    expect(RideStartedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        driverId: 'driver_1',
        customerId: 'customer_1'
      })
    );
    expect(metrics.recordCommand).toHaveBeenCalledWith('StartTrip', expect.any(Number), true);
  });

  it('blocks trip start when arrival was not persisted even in ARRIVED state', async () => {
    redis.hgetall.mockResolvedValue({
      driverId: 'driver_1',
      customerId: 'customer_1',
      paymentStatus: 'confirmed',
      paymentChargeId: 'charge_1',
      paymentAmountInCents: '3840'
    });
    RideStateManager.getBookingState.mockResolvedValue('ARRIVED');

    const command = new StartTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      startLocation: { lat: -23.55, lng: -46.63 }
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('após registrar chegada');
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
  });
});
