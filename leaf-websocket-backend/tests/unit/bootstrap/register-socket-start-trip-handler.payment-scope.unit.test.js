const mockResolveAuthoritativePaymentConfirmation = jest.fn();

jest.mock('../../../services/authoritative-payment-confirmation-service', () => ({
  collectPaymentReferences: (...values) => Array.from(new Set(
    values.flat().map((value) => String(value || '').trim()).filter(Boolean)
  )),
  isSocketMockPaymentAllowed: jest.fn(() => false),
  normalizePaymentAmountCents: (value) => Math.round(Number(value) || 0),
  resolveAuthoritativePaymentConfirmation: mockResolveAuthoritativePaymentConfirmation
}));

jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({
  getPaymentStatus: jest.fn()
})));

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

const registerSocketStartTripHandler = require('../../../bootstrap/register-socket-start-trip-handler');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

describe('registerSocketStartTripHandler payment scope', () => {
  it('passes the authoritative Redis booking snapshot to payment confirmation', async () => {
    const handlers = {};
    const socket = {
      id: 'socket_driver',
      userId: 'driver_1',
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      emit: jest.fn()
    };
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-sandbox',
      paymentProfileSource: 'payment_intent',
      testUserSandbox: true
    });
    const bookingSnapshot = {
      bookingId: 'booking_1',
      driverId: 'driver_1',
      paymentChargeId: 'charge_1',
      paymentAmountInCents: '3840',
      providerEnvironment: 'sandbox',
      financialContext: JSON.stringify(financialContext),
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      testUserSandbox: 'true'
    };
    const redis = {
      hgetall: jest.fn().mockResolvedValue(bookingSnapshot)
    };
    const idempotencyService = {
      generateKey: jest.fn(() => 'idem_start_1'),
      beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
      releaseInflight: jest.fn().mockResolvedValue(undefined)
    };
    mockResolveAuthoritativePaymentConfirmation.mockResolvedValue({
      success: false,
      code: 'PAYMENT_NOT_PROVIDER_CONFIRMED',
      message: 'Pagamento ainda não confirmado'
    });

    registerSocketStartTripHandler({
      socket,
      io: {},
      extractTraceIdFromEvent: jest.fn(() => 'trace_1'),
      traceContext: {
        runWithTraceId: jest.fn(async (_traceId, callback) => callback())
      },
      logStructured: jest.fn(),
      rateLimiterService: {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true })
      },
      validationService: {
        validateEndpoint: jest.fn((_endpoint, payload) => ({
          valid: true,
          sanitized: {
            bookingId: payload.bookingId,
            startLocation: payload.startLocation
          }
        }))
      },
      getSocketMetadata: jest.fn(() => ({})),
      auditService: { logRideAction: jest.fn() },
      redisPool: { getConnection: jest.fn(() => redis) },
      idempotencyService,
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

    await handlers.startTrip({
      bookingId: 'booking_1',
      startLocation: { lat: -22.9, lng: -43.2 }
    });

    expect(mockResolveAuthoritativePaymentConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        references: ['charge_1'],
        expectedAmountInCents: 3840,
        paymentContext: bookingSnapshot
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'tripStartError',
      expect.objectContaining({ code: 'PAYMENT_NOT_PROVIDER_CONFIRMED' })
    );
    expect(idempotencyService.releaseInflight).toHaveBeenCalledWith('idem_start_1');
  });
});
