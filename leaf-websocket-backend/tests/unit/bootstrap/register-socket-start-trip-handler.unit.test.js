jest.mock('../../../services/ride-persistence-service', () => ({
  markRideStarted: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  applyBookingSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../utils/map-h3-refresh-broadcaster', () => ({
  scheduleMapH3Refresh: jest.fn(),
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordHotpathReason: jest.fn(),
    recordHotpathLatency: jest.fn(),
    recordHotpathStageLatency: jest.fn(),
  },
}));

const registerSocketStartTripHandler = require('../../../bootstrap/register-socket-start-trip-handler');

function buildHarness() {
  const listeners = {};
  const socket = {
    userId: 'driver-1',
    on: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    emit: jest.fn(),
  };
  const roomEmit = jest.fn();
  const io = {
    activeBookings: new Map(),
    to: jest.fn(() => ({ emit: roomEmit })),
  };
  const redis = {
    hgetall: jest.fn().mockResolvedValue({
      bookingId: 'booking-1',
      customerId: 'customer-1',
      driverId: 'driver-1',
      customerName: 'Leaf Passageiro Teste',
      driverName: 'Carlos Motorista Teste',
      pickupLocation: JSON.stringify({
        address: 'Rua de Partida, 100',
        lat: -22.9,
        lng: -43.2,
      }),
      destinationLocation: JSON.stringify({
        address: 'Leblon',
        lat: -22.98,
        lng: -43.22,
      }),
      estimatedFare: '27.50',
      estimatedTime: '12',
      distance: '6.2',
    }),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    type: jest.fn().mockResolvedValue('hash'),
    del: jest.fn().mockResolvedValue(1),
  };
  const StartTripCommand = jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: {
        bookingId: 'booking-1',
        driverId: 'driver-1',
        customerId: 'customer-1',
        event: { bookingId: 'booking-1' },
        startLocation: { lat: -22.91, lng: -43.19 },
      },
    }),
  }));
  const idempotencyService = {
    generateKey: jest.fn(() => 'idem-1'),
    beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
    cacheResult: jest.fn().mockResolvedValue(true),
    releaseInflight: jest.fn().mockResolvedValue(true),
  };
  const eventBus = {
    publish: jest.fn().mockResolvedValue(true),
  };
  const fcmService = {
    sendRideStatusUpdate: jest.fn().mockResolvedValue({ success: true }),
    isServiceAvailable: jest.fn(() => true),
    setRedis: jest.fn(),
    initialize: jest.fn(),
    sendInteractiveNotification: jest.fn().mockResolvedValue({ success: true }),
  };

  registerSocketStartTripHandler({
    socket,
    io,
    extractTraceIdFromEvent: jest.fn(() => 'trace-1'),
    traceContext: {
      runWithTraceId: jest.fn(async (_traceId, fn) => fn()),
    },
    logStructured: jest.fn(),
    rateLimiterService: {
      checkRateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        limit: 60,
        remaining: 59,
        resetAt: Date.now() + 60000,
      }),
    },
    validationService: {
      validateEndpoint: jest.fn(() => ({
        valid: true,
        sanitized: {
          bookingId: 'booking-1',
          startLocation: { lat: -22.91, lng: -43.19 },
        },
      })),
    },
    getSocketMetadata: jest.fn(() => ({})),
    auditService: {
      logRideAction: jest.fn().mockResolvedValue(true),
    },
    redisPool: {
      getConnection: jest.fn(() => redis),
    },
    idempotencyService,
    StartTripCommand,
    getTracer: jest.fn(() => ({})),
    createCommandSpan: jest.fn(() => ({})),
    runInSpan: jest.fn(async (_span, fn) => fn()),
    endSpanError: jest.fn(),
    logCommand: jest.fn(),
    eventBus,
    createEventSpan: jest.fn(() => ({
      spanContext: jest.fn(() => ({ traceId: 'trace-1', spanId: 'span-1' })),
    })),
    logEvent: jest.fn(),
    fcmService,
  });

  return {
    listeners,
    roomEmit,
    fcmService,
  };
}

describe('register-socket-start-trip-handler persistent notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends ride_status_update started to passenger and driver after starting the trip', async () => {
    const { listeners, roomEmit, fcmService } = buildHarness();

    await listeners.startTrip({
      bookingId: 'booking-1',
      mockPayment: true,
      startLocation: { lat: -22.91, lng: -43.19 },
    });

    expect(roomEmit).toHaveBeenCalledWith(
      'tripStarted',
      expect.objectContaining({
        bookingId: 'booking-1',
        success: true,
      })
    );
    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledWith(
      'customer-1',
      expect.objectContaining({
        bookingId: 'booking-1',
        status: 'started',
        userType: 'customer',
        driverName: 'Carlos Motorista Teste',
        destination: expect.objectContaining({ address: 'Leblon' }),
        estimatedTime: '12',
        tripEstimatedTime: '12',
      })
    );
    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({
        bookingId: 'booking-1',
        status: 'started',
        userType: 'driver',
        customerName: 'Leaf Passageiro Teste',
      })
    );
  });
});
