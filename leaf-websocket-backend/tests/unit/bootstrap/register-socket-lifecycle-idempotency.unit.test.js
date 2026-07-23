jest.mock('../../../services/ride-persistence-service', () => ({
  markRideCancelled: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../utils/map-h3-refresh-broadcaster', () => ({
  scheduleMapH3Refresh: jest.fn(),
}));

const registerSocketCompleteTripHandler = require('../../../bootstrap/register-socket-complete-trip-handler');
const registerSocketCancelRideHandler = require('../../../bootstrap/register-socket-cancel-ride-handler');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

const createSocket = (overrides = {}) => {
  const handlers = new Map();
  return {
    id: 'socket_1',
    userId: 'driver_1',
    userType: 'driver',
    on: jest.fn((event, handler) => handlers.set(event, handler)),
    emit: jest.fn(),
    trigger: async (event, payload) => handlers.get(event)?.(payload),
    ...overrides,
  };
};

const createTraceContext = () => ({
  runWithTraceId: jest.fn(async (_traceId, callback) => callback()),
});

const createSpanDeps = () => ({
  getTracer: jest.fn(() => ({})),
  createCommandSpan: jest.fn(() => ({})),
  createEventSpan: jest.fn(() => ({})),
  runInSpan: jest.fn(async (_span, callback) => callback()),
  endSpanError: jest.fn(),
  logCommand: jest.fn(),
  logEvent: jest.fn(),
});

const createIdempotencyService = (cachedResult) => ({
  generateKey: jest.fn(() => 'idem_key'),
  beginRequest: jest.fn().mockResolvedValue({
    isNew: false,
    disposition: 'cached',
    cachedResult,
  }),
  cacheResult: jest.fn(),
  releaseInflight: jest.fn(),
});

describe('socket lifecycle idempotency guards', () => {
  it('returns cached completeTrip result without executing CompleteTripCommand', async () => {
    const socket = createSocket();
    const cachedResult = {
      success: true,
      bookingId: 'booking_1',
      message: 'Viagem finalizada',
    };
    const idempotencyService = createIdempotencyService(cachedResult);
    const CompleteTripCommand = jest.fn();

    registerSocketCompleteTripHandler({
      socket,
      io: { to: jest.fn() },
      extractTraceIdFromEvent: jest.fn(() => 'trace_1'),
      traceContext: createTraceContext(),
      logStructured: jest.fn(),
      rateLimiterService: {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      },
      validationService: {
        validateEndpoint: jest.fn(() => ({
          valid: true,
          sanitized: {
            bookingId: 'booking_1',
            endLocation: { lat: -22.95, lng: -43.18 },
            distance: 12.4,
            fare: 82.53,
          },
        })),
      },
      getSocketMetadata: jest.fn(() => ({})),
      auditService: { logRideAction: jest.fn() },
      redisPool: { getConnection: jest.fn() },
      idempotencyService,
      CompleteTripCommand,
      eventBus: { publish: jest.fn() },
      fcmService: { sendRideStatusUpdate: jest.fn() },
      ...createSpanDeps(),
    });

    await socket.trigger('completeTrip', {
      bookingId: 'booking_1',
      idempotencyKey: 'idem_key',
    });

    expect(socket.emit).toHaveBeenCalledWith('tripCompleted', cachedResult);
    expect(CompleteTripCommand).not.toHaveBeenCalled();
    expect(idempotencyService.cacheResult).not.toHaveBeenCalled();
  });

  it('returns cached cancelRide result without executing CancelRideCommand', async () => {
    const socket = createSocket({
      userId: 'customer_1',
      userType: 'customer',
    });
    const redis = { hgetall: jest.fn() };
    const cachedResult = {
      success: true,
      bookingId: 'booking_2',
      message: 'Corrida cancelada',
    };
    const idempotencyService = createIdempotencyService(cachedResult);
    const CancelRideCommand = jest.fn();

    registerSocketCancelRideHandler({
      socket,
      io: { to: jest.fn() },
      extractTraceIdFromEvent: jest.fn(() => 'trace_2'),
      traceContext: createTraceContext(),
      logStructured: jest.fn(),
      rateLimiterService: {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      },
      redisPool: {
        ensureConnection: jest.fn().mockResolvedValue(undefined),
        getConnection: jest.fn(() => redis),
      },
      RideStateManager: { STATES: {} },
      gradualExpander: { stopSearch: jest.fn() },
      GeoHashUtils: { getRegionHash: jest.fn() },
      rideQueueManager: { dequeueRide: jest.fn() },
      CancelRideCommand,
      eventBus: { publish: jest.fn() },
      PaymentService: jest.fn(),
      fcmService: { sendRideStatusUpdate: jest.fn() },
      assertRideParticipant: jest.fn().mockResolvedValue({
        allowed: true,
        participantRole: 'passenger',
        identity: { userId: 'customer_1' },
      }),
      idempotencyService,
      ...createSpanDeps(),
    });

    await socket.trigger('cancelRide', {
      bookingId: 'booking_2',
      idempotencyKey: 'idem_key',
    });

    expect(socket.emit).toHaveBeenCalledWith('rideCancelled', cachedResult);
    expect(CancelRideCommand).not.toHaveBeenCalled();
    expect(redis.hgetall).not.toHaveBeenCalled();
    expect(idempotencyService.cacheResult).not.toHaveBeenCalled();
  });

  it('rejects cancellation before idempotency or persistence when the socket is not a ride participant', async () => {
    const socket = createSocket({ userId: 'unrelated_user', userType: 'customer' });
    const redis = { hgetall: jest.fn() };
    const idempotencyService = createIdempotencyService(null);
    const CancelRideCommand = jest.fn();
    const assertRideParticipant = jest.fn().mockResolvedValue({
      allowed: false,
      code: 'RIDE_SCOPE_DENIED',
      error: 'Usuário não participa desta corrida',
    });

    registerSocketCancelRideHandler({
      socket,
      io: { to: jest.fn() },
      extractTraceIdFromEvent: jest.fn(() => 'trace_3'),
      traceContext: createTraceContext(),
      logStructured: jest.fn(),
      rateLimiterService: {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      },
      redisPool: {
        ensureConnection: jest.fn().mockResolvedValue(undefined),
        getConnection: jest.fn(() => redis),
      },
      RideStateManager: { STATES: {} },
      gradualExpander: { stopSearch: jest.fn() },
      GeoHashUtils: { getRegionHash: jest.fn() },
      rideQueueManager: { dequeueRide: jest.fn() },
      CancelRideCommand,
      eventBus: { publish: jest.fn() },
      PaymentService: jest.fn(),
      fcmService: { sendRideStatusUpdate: jest.fn() },
      assertRideParticipant,
      idempotencyService,
      ...createSpanDeps(),
    });

    await socket.trigger('cancelRide', { bookingId: 'booking_3' });

    expect(assertRideParticipant).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking_3',
      allowedRoles: ['passenger', 'driver'],
      allowSupport: false,
    }));
    expect(socket.emit).toHaveBeenCalledWith('rideCancellationError', expect.objectContaining({
      code: 'RIDE_SCOPE_DENIED',
    }));
    expect(idempotencyService.beginRequest).not.toHaveBeenCalled();
    expect(CancelRideCommand).not.toHaveBeenCalled();
    expect(redis.hgetall).not.toHaveBeenCalled();
  });

  it('fails cancellation before command or payment access when a sandbox booking lost its seal', async () => {
    const socket = createSocket({ userId: 'customer_sandbox', userType: 'customer' });
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        customerId: 'customer_sandbox',
        passengerId: 'customer_sandbox',
        status: 'SEARCHING',
        financialNamespace: 'sandbox',
        providerEnvironment: 'sandbox',
        testUserSandbox: true
      }),
      smembers: jest.fn()
    };
    const idempotencyService = {
      generateKey: jest.fn(() => 'idem_sandbox_context_lost'),
      beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
      releaseInflight: jest.fn().mockResolvedValue(undefined),
      cacheResult: jest.fn()
    };
    const CancelRideCommand = jest.fn();
    const paymentService = { getStoredPayment: jest.fn() };
    const PaymentService = jest.fn(() => paymentService);
    const getBookingState = jest.fn();

    registerSocketCancelRideHandler({
      socket,
      io: { to: jest.fn() },
      extractTraceIdFromEvent: jest.fn(() => 'trace_sandbox_context_lost'),
      traceContext: createTraceContext(),
      logStructured: jest.fn(),
      rateLimiterService: {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      },
      redisPool: {
        ensureConnection: jest.fn().mockResolvedValue(undefined),
        getConnection: jest.fn(() => redis),
      },
      RideStateManager: {
        STATES: { SEARCHING: 'SEARCHING', PENDING: 'PENDING' },
        getBookingState,
      },
      gradualExpander: { stopSearch: jest.fn() },
      GeoHashUtils: { getRegionHash: jest.fn() },
      rideQueueManager: { dequeueRide: jest.fn() },
      CancelRideCommand,
      eventBus: { publish: jest.fn() },
      PaymentService,
      fcmService: { sendRideStatusUpdate: jest.fn() },
      assertRideParticipant: jest.fn().mockResolvedValue({
        allowed: true,
        participantRole: 'passenger',
        identity: { userId: 'customer_sandbox' },
      }),
      idempotencyService,
      ...createSpanDeps(),
    });

    await socket.trigger('cancelRide', {
      bookingId: 'booking_sandbox_context_lost',
      reason: 'Teste de isolamento'
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'rideCancellationError',
      expect.objectContaining({ code: 'FINANCIAL_SANDBOX_CONTEXT_LOST' })
    );
    expect(idempotencyService.releaseInflight).toHaveBeenCalledWith('idem_sandbox_context_lost');
    expect(getBookingState).not.toHaveBeenCalled();
    expect(redis.smembers).not.toHaveBeenCalled();
    expect(CancelRideCommand).not.toHaveBeenCalled();
    expect(PaymentService).not.toHaveBeenCalled();
    expect(paymentService.getStoredPayment).not.toHaveBeenCalled();
  });

  it('ignores a client fee and emits the fee/refund summary returned by the command', async () => {
    const socket = createSocket({
      userId: 'customer_1',
      userType: 'customer',
    });
    const roomEmit = jest.fn();
    const io = {
      to: jest.fn(() => ({ emit: roomEmit })),
    };
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'payment_intent',
      testUserSandbox: true
    });
    const booking = {
      customerId: 'customer_1',
      passengerId: 'customer_1',
      driverId: '',
      status: 'ACCEPTED',
      estimatedFare: '100',
      financialContext: JSON.stringify(financialContext),
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true,
    };
    const redis = {
      hgetall: jest.fn().mockResolvedValue(booking),
      smembers: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
    };
    const idempotencyService = {
      generateKey: jest.fn(() => 'idem_canonical_fee'),
      beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
      cacheResult: jest.fn().mockResolvedValue(undefined),
      releaseInflight: jest.fn().mockResolvedValue(undefined),
    };
    const commandResult = {
      success: true,
      data: {
        bookingId: 'booking_canonical_fee',
        cancellationFee: 299,
        refundResult: {
          success: true,
          amount: 9701,
          refundId: 'refund_canonical_fee',
          chargeId: 'charge_canonical_fee',
        },
        event: null,
      },
    };
    const CancelRideCommand = jest.fn().mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue(commandResult),
    }));
    const paymentService = {
      getStoredPayment: jest.fn().mockResolvedValue({
        status: 'REFUNDED_PARTIAL',
        refunded: true,
        amount: 10000,
        refundAmount: 9701,
        cancellationFee: 299,
        refundId: 'refund_canonical_fee',
        chargeId: 'charge_canonical_fee',
      }),
      processRideRefund: jest.fn(),
      markPaymentRefunded: jest.fn(),
    };
    const PaymentService = jest.fn(() => paymentService);
    PaymentService.isRefundedPaymentStatus = jest.fn(() => true);

    registerSocketCancelRideHandler({
      socket,
      io,
      extractTraceIdFromEvent: jest.fn(() => 'trace_canonical_fee'),
      traceContext: createTraceContext(),
      logStructured: jest.fn(),
      rateLimiterService: {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      },
      redisPool: {
        ensureConnection: jest.fn().mockResolvedValue(undefined),
        getConnection: jest.fn(() => redis),
      },
      RideStateManager: {
        STATES: { SEARCHING: 'SEARCHING', PENDING: 'PENDING' },
        getBookingState: jest.fn().mockResolvedValue('ACCEPTED'),
      },
      gradualExpander: { stopSearch: jest.fn() },
      GeoHashUtils: { getRegionHash: jest.fn() },
      rideQueueManager: { dequeueRide: jest.fn() },
      CancelRideCommand,
      eventBus: { publish: jest.fn() },
      PaymentService,
      fcmService: { sendRideStatusUpdate: jest.fn().mockResolvedValue(undefined) },
      assertRideParticipant: jest.fn().mockResolvedValue({
        allowed: true,
        participantRole: 'passenger',
        identity: { userId: 'customer_1' },
      }),
      idempotencyService,
      ...createSpanDeps(),
    });

    await socket.trigger('cancelRide', {
      bookingId: 'booking_canonical_fee',
      reason: 'Teste canônico',
      cancellationFee: 999999,
    });

    expect(CancelRideCommand).toHaveBeenCalledTimes(1);
    expect(CancelRideCommand.mock.calls[0][0]).not.toHaveProperty('cancellationFee');
    expect(paymentService.getStoredPayment).toHaveBeenCalledWith(
      'booking_canonical_fee',
      financialContext
    );
    expect(paymentService.processRideRefund).not.toHaveBeenCalled();
    expect(paymentService.markPaymentRefunded).not.toHaveBeenCalled();
    expect(roomEmit).toHaveBeenCalledWith(
      'rideCancelled',
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          cancellationFee: 2.99,
          refundAmount: 97.01,
          refundStatus: 'REFUNDED_PARTIAL',
          refundId: 'refund_canonical_fee',
        }),
      })
    );
  });

  it('keeps the original paid amount for an idempotent full-refund replay', async () => {
    const socket = createSocket({
      userId: 'customer_1',
      userType: 'customer',
    });
    const roomEmit = jest.fn();
    const io = {
      to: jest.fn(() => ({ emit: roomEmit })),
    };
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        customerId: 'customer_1',
        passengerId: 'customer_1',
        driverId: '',
        status: 'SEARCHING',
        estimatedFare: '13.42',
      }),
      smembers: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
    };
    const idempotencyService = {
      generateKey: jest.fn(() => 'idem_full_refund_replay'),
      beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
      cacheResult: jest.fn().mockResolvedValue(undefined),
      releaseInflight: jest.fn().mockResolvedValue(undefined),
    };
    const CancelRideCommand = jest.fn().mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          bookingId: 'booking_full_refund_replay',
          cancellationFee: 0,
          refundResult: {
            success: true,
            alreadyRefunded: true,
            amount: 0,
            chargeId: 'charge_full_refund_replay',
          },
          event: null,
        },
      }),
    }));
    const paymentService = {
      getStoredPayment: jest.fn().mockResolvedValue({
        status: 'REFUNDED_FULL',
        refunded: true,
        amount: 1342,
        refundAmount: 0,
        cancellationFee: 0,
        chargeId: 'charge_full_refund_replay',
      }),
      processRideRefund: jest.fn(),
      markPaymentRefunded: jest.fn(),
    };
    const PaymentService = jest.fn(() => paymentService);
    PaymentService.isRefundedPaymentStatus = jest.fn(() => true);

    registerSocketCancelRideHandler({
      socket,
      io,
      extractTraceIdFromEvent: jest.fn(() => 'trace_full_refund_replay'),
      traceContext: createTraceContext(),
      logStructured: jest.fn(),
      rateLimiterService: {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      },
      redisPool: {
        ensureConnection: jest.fn().mockResolvedValue(undefined),
        getConnection: jest.fn(() => redis),
      },
      RideStateManager: {
        STATES: { SEARCHING: 'SEARCHING', PENDING: 'PENDING' },
        getBookingState: jest.fn().mockResolvedValue('SEARCHING'),
      },
      gradualExpander: { stopSearch: jest.fn().mockResolvedValue(undefined) },
      GeoHashUtils: { getRegionHash: jest.fn() },
      rideQueueManager: { dequeueRide: jest.fn() },
      CancelRideCommand,
      eventBus: { publish: jest.fn() },
      PaymentService,
      fcmService: { sendRideStatusUpdate: jest.fn().mockResolvedValue(undefined) },
      assertRideParticipant: jest.fn().mockResolvedValue({
        allowed: true,
        participantRole: 'passenger',
        identity: { userId: 'customer_1' },
      }),
      idempotencyService,
      ...createSpanDeps(),
    });

    await socket.trigger('cancelRide', {
      bookingId: 'booking_full_refund_replay',
      reason: 'Teste de repetição de reembolso integral',
    });

    expect(roomEmit).toHaveBeenCalledWith(
      'rideCancelled',
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          cancellationFee: 0,
          refundAmount: 13.42,
          refundStatus: 'ALREADY_REFUNDED',
        }),
      })
    );
  });
});
