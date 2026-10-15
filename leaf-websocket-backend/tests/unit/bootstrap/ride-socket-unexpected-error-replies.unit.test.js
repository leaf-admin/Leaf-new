// An unexpected error inside these ride handlers must still reach the driver
// app as an error event. Before the fix, each catch block logged a variable
// declared inside its try, threw a ReferenceError and never emitted the reply.

jest.mock('../../../services/authoritative-payment-confirmation-service', () => ({
  collectPaymentReferences: jest.fn(() => []),
  isSocketMockPaymentAllowed: jest.fn(() => false),
  normalizePaymentAmountCents: jest.fn(() => 0),
  resolveAuthoritativePaymentConfirmation: jest.fn()
}));

jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({})));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordHotpathReason: jest.fn(),
    recordHotpathLatency: jest.fn()
  }
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  applyBookingSnapshot: jest.fn()
}));

jest.mock('../../../services/ride-offline-intent-validator', () => ({
  hasRideOfflineIntentPayload: jest.fn(() => false),
  markRideOfflineIntentProcessed: jest.fn(),
  markRideOfflineIntentRejected: jest.fn(),
  validateAndReserveRideOfflineIntent: jest.fn()
}));

const registerSocketDriverResponseHandler = require('../../../bootstrap/register-socket-driver-response-handler');
const registerSocketRejectRideHandler = require('../../../bootstrap/register-socket-reject-ride-handler');
const registerSocketStartTripHandler = require('../../../bootstrap/register-socket-start-trip-handler');

function createSocket() {
  const handlers = {};
  return {
    handlers,
    socket: {
      id: 'socket_driver_1',
      userId: 'driver_1',
      on: jest.fn((eventName, handler) => {
        handlers[eventName] = handler;
      }),
      emit: jest.fn()
    }
  };
}

function throwingValidationService() {
  return {
    validateEndpoint: jest.fn(() => {
      throw new Error('validation exploded');
    })
  };
}

describe('ride socket handlers reply on unexpected errors', () => {
  test('driverResponse emits driverResponseError for a malformed payload', async () => {
    const { handlers, socket } = createSocket();
    const logStructured = jest.fn();
    registerSocketDriverResponseHandler({ socket, io: { activeBookings: new Map() }, logStructured });

    await expect(handlers.driverResponse(null)).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith('driverResponseError', { error: 'Erro ao processar resposta' });
    expect(logStructured).toHaveBeenCalledWith('error', 'Erro na resposta do motorista', expect.objectContaining({
      bookingId: undefined,
      userId: 'driver_1'
    }));
  });

  test('rejectRide emits rejectRideError and logs the requested booking', async () => {
    const { handlers, socket } = createSocket();
    const logStructured = jest.fn();
    registerSocketRejectRideHandler({
      socket,
      rateLimiterService: { checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }) },
      logStructured,
      validationService: throwingValidationService(),
      getSocketMetadata: jest.fn(() => ({})),
      auditService: { logRideAction: jest.fn() },
      responseHandler: {}
    });

    await expect(handlers.rejectRide({ bookingId: 'booking_1' })).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith('rejectRideError', { error: 'Erro ao processar rejeição' });
    expect(logStructured).toHaveBeenCalledWith('error', 'Erro ao rejeitar corrida', expect.objectContaining({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }));
  });

  test('startTrip emits tripStartError and logs the driver', async () => {
    const { handlers, socket } = createSocket();
    const logStructured = jest.fn();
    const metrics = require('../../../utils/prometheus-metrics').metrics;
    registerSocketStartTripHandler({
      socket,
      io: {},
      extractTraceIdFromEvent: jest.fn(() => 'trace_1'),
      traceContext: { runWithTraceId: jest.fn(async (_traceId, callback) => callback()) },
      logStructured,
      rateLimiterService: { checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }) },
      validationService: throwingValidationService(),
      getSocketMetadata: jest.fn(() => ({})),
      auditService: { logRideAction: jest.fn() },
      redisPool: { getConnection: jest.fn(() => null) },
      idempotencyService: {
        generateKey: jest.fn(() => 'idem_1'),
        beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
        releaseInflight: jest.fn().mockResolvedValue(undefined)
      },
      StartTripCommand: jest.fn(),
      getTracer: jest.fn(),
      createCommandSpan: jest.fn(),
      runInSpan: jest.fn(),
      endSpanError: jest.fn(),
      logCommand: jest.fn(),
      eventBus: { publish: jest.fn() },
      createEventSpan: jest.fn(),
      logEvent: jest.fn(),
      fcmService: {}
    });

    await expect(handlers.startTrip({ bookingId: 'booking_1' })).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith('tripStartError', { error: 'Erro ao iniciar viagem' });
    expect(logStructured).toHaveBeenCalledWith('error', 'Erro ao iniciar viagem', expect.objectContaining({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }));
    expect(metrics.recordHotpathReason).toHaveBeenCalledWith('start_trip', 'unexpected_error');
  });
});
