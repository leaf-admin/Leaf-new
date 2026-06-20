const registerSocketCompleteTripHandler = require('../../../bootstrap/register-socket-complete-trip-handler');
const registerSocketCancelRideHandler = require('../../../bootstrap/register-socket-cancel-ride-handler');

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
});
