const mockPaymentServiceInstance = {
  getAdvancePaymentIntent: jest.fn(),
  getPaymentStatus: jest.fn(),
  markAdvancePaymentIntentConsumed: jest.fn()
};
let mockFirestore;

jest.mock('../../../services/payment-service', () =>
  jest.fn().mockImplementation(() => mockPaymentServiceInstance)
);

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => mockFirestore)
}));

jest.mock('../../../services/passenger-trust-service', () => ({
  checkEligibility: jest.fn().mockResolvedValue({ allowed: true })
}));

jest.mock('../../../services/operational-area-policy-service', () => ({
  evaluateCreateBooking: jest.fn().mockResolvedValue({ allowed: true }),
  recordAcceptedRequest: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-availability-snapshot-service', () => ({
  countNearbyEligibleDriversApprox: jest.fn().mockResolvedValue({
    success: true,
    availableDrivers: 1
  })
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  applyBookingSnapshot: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/payment-dispatch-service', () => ({
  materializePaymentForBooking: jest.fn().mockResolvedValue({
    success: true,
    amountInCents: 8785
  }),
  triggerDispatchAfterPayment: jest.fn().mockResolvedValue({
    success: true,
    attempts: 1
  }),
  linkPaymentToBooking: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../services/ride-persistence-service', () => ({
  saveRide: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../services/demand-notification-service', () => ({
  checkAndNotifyDemand: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordHotpathStageLatency: jest.fn(),
    recordHotpathReason: jest.fn(),
    recordHotpathLatency: jest.fn(),
    recordRideRequested: jest.fn()
  }
}));

jest.mock('@opentelemetry/api', () => ({
  context: {},
  trace: {
    getActiveSpan: jest.fn(() => null)
  }
}));

const registerSocketCreateBookingHandler = require('../../../bootstrap/register-socket-create-booking-handler');
const paymentDispatchService = require('../../../services/payment-dispatch-service');
const passengerTrustService = require('../../../services/passenger-trust-service');
const operationalAreaPolicyService = require('../../../services/operational-area-policy-service');

function createFirestoreWithDocs(seed = {}) {
  const docs = new Map(Object.entries(seed));

  return {
    collection(collectionName) {
      return {
        doc(docId) {
          const path = `${collectionName}/${docId}`;
          return {
            async get() {
              return {
                exists: docs.has(path),
                data: () => docs.get(path)
              };
            }
          };
        },
        where(field, _operator, value) {
          return {
            limit() {
              return {
                async get() {
                  const matches = [];
                  for (const [path, data] of docs.entries()) {
                    if (!path.startsWith(`${collectionName}/`)) continue;
                    if (data?.[field] !== value) continue;
                    matches.push({
                      id: path.split('/').pop(),
                      data: () => data
                    });
                  }
                  return {
                    empty: matches.length === 0,
                    docs: matches
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

function createSpan() {
  return {
    spanContext: jest.fn(() => ({
      traceId: 'trace_test',
      spanId: 'span_test'
    }))
  };
}

function createRequestPayload(overrides = {}) {
  return {
    customerId: 'customer_1',
    pickupLocation: { lat: -22.9, lng: -43.2 },
    destinationLocation: { lat: -22.91, lng: -43.21 },
    estimatedFare: 87.85,
    routeDistanceKm: 12.4,
    routeDurationSecs: 1800,
    tollFee: 0,
    carType: 'leaf_plus',
    paymentMethod: 'pix',
    paymentStatus: 'confirmed',
    paymentData: {
      chargeId: 'charge_1',
      rideId: 'temp_ride_1',
      amountInCents: 8785,
      paymentStatus: 'confirmed'
    },
    ...overrides
  };
}

function createHarness({ availabilityResult } = {}) {
  const handlers = {};
  const socket = {
    id: 'socket_1',
    userId: 'customer_1',
    userType: 'customer',
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit: jest.fn()
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1),
    zcard: jest.fn().mockResolvedValue(0),
    scard: jest.fn().mockResolvedValue(1)
  };
  const idempotencyService = {
    beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
    waitForCachedResult: jest.fn(),
    cacheResult: jest.fn().mockResolvedValue(undefined),
    releaseInflight: jest.fn().mockResolvedValue(undefined)
  };
  const RequestRideCommand = jest.fn().mockImplementation(function RequestRideCommandMock(payload) {
    this.execute = jest.fn().mockResolvedValue({
      success: true,
      data: {
        bookingId: 'booking_1',
        bookingData: {
          bookingId: 'booking_1',
          estimatedFare: 87.85,
          paymentStatus: payload.paymentStatus
        },
        event: {
          data: {
            bookingId: 'booking_1',
            metadata: {}
          }
        },
        regionHash: 'region_hash'
      }
    });
  });
  const findAvailableDriversForPickup = jest.fn().mockResolvedValue(
    availabilityResult || {
      success: true,
      hasDrivers: true,
      drivers: [{ id: 'driver_1' }]
    }
  );

  registerSocketCreateBookingHandler({
    socket,
    io: {
      activeBookings: new Map(),
      to: jest.fn(() => ({ emit: jest.fn() }))
    },
    extractTraceIdFromEvent: jest.fn(() => 'trace_test'),
    traceContext: {
      runWithTraceId: jest.fn(async (_traceId, fn) => fn()),
      getCurrentTraceId: jest.fn(() => 'trace_test'),
      generateTraceId: jest.fn(() => 'trace_generated')
    },
    getTracer: jest.fn(() => ({})),
    createSocketSpan: jest.fn(() => createSpan()),
    runInSpan: jest.fn(async (_span, fn) => fn()),
    logStructured: jest.fn(),
    rateLimiterService: {
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true })
    },
    getSocketMetadata: jest.fn(() => ({ ip: '127.0.0.1' })),
    auditService: {
      logRideAction: jest.fn().mockResolvedValue(undefined),
      logSecurityAction: jest.fn().mockResolvedValue(undefined)
    },
    validationService: {
      validateEndpoint: jest.fn((_endpoint, payload) => ({
        valid: true,
        sanitized: {
          customerId: payload.customerId,
          pickupLocation: payload.pickupLocation,
          destinationLocation: payload.destinationLocation,
          estimatedFare: payload.estimatedFare,
          routeDistanceKm: payload.routeDistanceKm,
          routeDurationSecs: payload.routeDurationSecs,
          tollFee: payload.tollFee,
          carType: payload.carType,
          paymentMethod: payload.paymentMethod
        }
      }))
    },
    GeoHashUtils: {
      getRegionHash: jest.fn(() => 'region_hash')
    },
    redisPool: {
      getConnection: jest.fn(() => redis),
      ensureConnection: jest.fn().mockResolvedValue(undefined)
    },
    idempotencyService,
    RequestRideCommand,
    createCommandSpan: jest.fn(() => createSpan()),
    endSpanError: jest.fn(),
    logCommand: jest.fn(),
    createEventSpan: jest.fn(() => createSpan()),
    endSpanSuccess: jest.fn(),
    logEvent: jest.fn(),
    eventBus: {
      publish: jest.fn().mockResolvedValue(undefined)
    },
    metricsCollector: {
      recordMatchStart: jest.fn().mockResolvedValue(undefined)
    },
    findAvailableDriversForPickup,
    rideCostTelemetryService: null
  });

  return {
    handlers,
    socket,
    redis,
    idempotencyService,
    RequestRideCommand,
    findAvailableDriversForPickup
  };
}

async function flushImmediateCallbacks(callbacks) {
  while (callbacks.length) {
    await callbacks.shift()();
  }
}

describe('registerSocketCreateBookingHandler payment and availability guards', () => {
  let immediateCallbacks;
  let previousAvailabilityTimeoutMs;

  beforeEach(() => {
    previousAvailabilityTimeoutMs = process.env.CREATE_BOOKING_AVAILABILITY_TIMEOUT_MS;
    process.env.CREATE_BOOKING_AVAILABILITY_TIMEOUT_MS = '0';
    immediateCallbacks = [];
    jest.spyOn(global, 'setImmediate').mockImplementation((callback, ...args) => {
      immediateCallbacks.push(() => callback(...args));
      return immediateCallbacks.length;
    });
    mockFirestore = createFirestoreWithDocs();
    mockPaymentServiceInstance.getAdvancePaymentIntent.mockReset().mockResolvedValue({
      found: true,
      status: 'charge_created'
    });
    mockPaymentServiceInstance.getPaymentStatus.mockReset().mockResolvedValue({
        success: true,
        status: 'in_holding',
        source: 'woovi_provider',
        providerEnvironment: 'sandbox',
        chargeId: 'charge_1',
        amount: 8785
    });
    mockPaymentServiceInstance.markAdvancePaymentIntentConsumed.mockReset().mockResolvedValue(true);
    passengerTrustService.checkEligibility.mockReset().mockResolvedValue({ allowed: true });
    operationalAreaPolicyService.evaluateCreateBooking.mockReset().mockResolvedValue({ allowed: true });
    operationalAreaPolicyService.recordAcceptedRequest.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (previousAvailabilityTimeoutMs === undefined) {
      delete process.env.CREATE_BOOKING_AVAILABILITY_TIMEOUT_MS;
    } else {
      process.env.CREATE_BOOKING_AVAILABILITY_TIMEOUT_MS = previousAvailabilityTimeoutMs;
    }
  });

  it('rejects a client-confirmed payment when the proof is only local/cache-backed', async () => {
    mockPaymentServiceInstance.getPaymentStatus.mockResolvedValue({
      success: true,
      status: 'in_holding',
      source: 'payment_holding_doc',
      chargeId: 'charge_1',
      amount: 8785
    });
    const harness = createHarness();

    await harness.handlers.createBooking(createRequestPayload());

    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingError',
      expect.objectContaining({
        code: 'PAYMENT_NOT_CONFIRMED',
        providerCode: 'PAYMENT_NOT_PROVIDER_CONFIRMED'
      })
    );
    expect(harness.idempotencyService.beginRequest).not.toHaveBeenCalled();
    expect(harness.findAvailableDriversForPickup).not.toHaveBeenCalled();
    expect(harness.RequestRideCommand).not.toHaveBeenCalled();
  });

  it('fails closed when passenger trust guard is unavailable', async () => {
    passengerTrustService.checkEligibility.mockRejectedValueOnce(new Error('trust unavailable'));
    const harness = createHarness();

    await harness.handlers.createBooking(createRequestPayload());

    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingError',
      expect.objectContaining({
        code: 'PASSENGER_TRUST_GUARD_UNAVAILABLE'
      })
    );
    expect(harness.idempotencyService.beginRequest).not.toHaveBeenCalled();
    expect(harness.findAvailableDriversForPickup).not.toHaveBeenCalled();
    expect(harness.RequestRideCommand).not.toHaveBeenCalled();
  });

  it('fails closed when active ride guard cannot validate duplicate rides', async () => {
    const harness = createHarness();
    harness.redis.get.mockRejectedValueOnce(new Error('redis unavailable'));

    await harness.handlers.createBooking(createRequestPayload());

    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingError',
      expect.objectContaining({
        code: 'ACTIVE_RIDE_GUARD_UNAVAILABLE'
      })
    );
    expect(harness.idempotencyService.beginRequest).not.toHaveBeenCalled();
    expect(harness.findAvailableDriversForPickup).not.toHaveBeenCalled();
    expect(harness.RequestRideCommand).not.toHaveBeenCalled();
  });

  it('fails closed when area policy cannot validate operational coverage', async () => {
    operationalAreaPolicyService.evaluateCreateBooking.mockRejectedValueOnce(new Error('policy unavailable'));
    const harness = createHarness();

    await harness.handlers.createBooking(createRequestPayload());

    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingError',
      expect.objectContaining({
        code: 'AREA_POLICY_GUARD_UNAVAILABLE'
      })
    );
    expect(harness.idempotencyService.beginRequest).not.toHaveBeenCalled();
    expect(harness.findAvailableDriversForPickup).not.toHaveBeenCalled();
    expect(harness.RequestRideCommand).not.toHaveBeenCalled();
  });

  it('blocks a provider-confirmed paid booking before RequestRideCommand when no driver is available', async () => {
    mockFirestore = createFirestoreWithDocs({
      'payment_holdings/temp_ride_1': {
        status: 'in_holding',
        source: 'woovi_webhook',
        chargeId: 'charge_1',
        paymentId: 'charge_1',
        amount: 8785
      }
    });
    const harness = createHarness({
      availabilityResult: {
        success: true,
        hasDrivers: false,
        drivers: []
      }
    });

    await harness.handlers.createBooking(createRequestPayload());

    expect(harness.findAvailableDriversForPickup).toHaveBeenCalledWith(
      { lat: -22.9, lng: -43.2 },
      expect.objectContaining({
        carType: 'leaf_plus',
        destinationLocation: { lat: -22.91, lng: -43.21 }
      })
    );
    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingError',
      expect.objectContaining({
        code: 'NO_DRIVERS_AVAILABLE'
      })
    );
    expect(harness.RequestRideCommand).not.toHaveBeenCalled();
    expect(harness.idempotencyService.releaseInflight).toHaveBeenCalled();
    expect(harness.idempotencyService.cacheResult).not.toHaveBeenCalled();
  });

  it('rejects a provider-confirmed payment intent bound to a different route before creating the booking', async () => {
    mockPaymentServiceInstance.getAdvancePaymentIntent.mockResolvedValue({
      found: true,
      status: 'charge_created',
      passengerId: 'customer_1',
      amountCents: 8785,
      payableAmountInCents: 8785,
      paymentSessionId: 'pay_session_1',
      paymentContextKey: 'context_1',
      quoteSessionId: 'quote_session_1',
      quoteLockId: 'ql_bound_1',
      quoteLockSnapshot: {
        quoteLockId: 'ql_bound_1',
        quoteSessionId: 'quote_session_1',
        passengerId: 'customer_1',
        payableAmountInCents: 8785,
        grossAmountInCents: 8785,
        routeSignature: '-22.90000|-43.20000|-22.95000|-43.25000|leaf_plus',
        carType: 'leaf_plus'
      }
    });
    mockFirestore = createFirestoreWithDocs({
      'payment_holdings/temp_ride_1': {
        status: 'in_holding',
        source: 'woovi_webhook',
        chargeId: 'charge_1',
        paymentId: 'charge_1',
        amount: 8785
      }
    });
    const harness = createHarness();

    await harness.handlers.createBooking(createRequestPayload({
      paymentData: {
        chargeId: 'charge_1',
        rideId: 'temp_ride_1',
        amountInCents: 8785,
        grossAmountInCents: 8785,
        paymentSessionId: 'pay_session_1',
        paymentContextKey: 'context_1',
        quoteSessionId: 'quote_session_1',
        quoteLockId: 'ql_bound_1',
        paymentStatus: 'confirmed'
      }
    }));

    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingError',
      expect.objectContaining({
        code: 'PAYMENT_INTENT_ROUTE_MISMATCH'
      })
    );
    expect(harness.findAvailableDriversForPickup).not.toHaveBeenCalled();
    expect(harness.RequestRideCommand).not.toHaveBeenCalled();
  });

  it('accepts equivalent car type labels between quote lock and createBooking payload', async () => {
    mockPaymentServiceInstance.getAdvancePaymentIntent.mockResolvedValue({
      found: true,
      status: 'charge_created',
      passengerId: 'customer_1',
      amountCents: 8785,
      payableAmountInCents: 8785,
      paymentSessionId: 'pay_session_1',
      paymentContextKey: 'context_1',
      quoteSessionId: 'quote_session_1',
      quoteLockId: 'ql_bound_1',
      quoteLockSnapshot: {
        quoteLockId: 'ql_bound_1',
        quoteSessionId: 'quote_session_1',
        passengerId: 'customer_1',
        payableAmountInCents: 8785,
        grossAmountInCents: 8785,
        routeSignature: '-22.90000|-43.20000|-22.91000|-43.21000|leaf_plus',
        carType: 'leaf_plus'
      }
    });
    mockFirestore = createFirestoreWithDocs({
      'payment_holdings/temp_ride_1': {
        status: 'in_holding',
        source: 'woovi_webhook',
        chargeId: 'charge_1',
        paymentId: 'charge_1',
        amount: 8785
      }
    });
    const harness = createHarness();

    await harness.handlers.createBooking(createRequestPayload({
      carType: 'Leaf Plus',
      paymentData: {
        chargeId: 'charge_1',
        rideId: 'temp_ride_1',
        amountInCents: 8785,
        grossAmountInCents: 8785,
        paymentSessionId: 'pay_session_1',
        paymentContextKey: 'context_1',
        quoteSessionId: 'quote_session_1',
        quoteLockId: 'ql_bound_1',
        paymentStatus: 'confirmed'
      }
    }));

    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingCreated',
      expect.objectContaining({
        success: true,
        bookingId: 'booking_1'
      })
    );
    expect(harness.socket.emit.mock.calls.filter(([event]) => event === 'bookingError')).toEqual([]);
    expect(harness.RequestRideCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        carType: 'Leaf Plus',
        paymentData: expect.objectContaining({
          quoteLockId: 'ql_bound_1',
          paymentStatus: 'in_holding',
          serverValidated: true
        })
      })
    );
  });

  it('creates a paid booking only after provider proof and availability are both confirmed', async () => {
    const harness = createHarness();

    await harness.handlers.createBooking(createRequestPayload());
    await flushImmediateCallbacks(immediateCallbacks);

    expect(harness.RequestRideCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer_1',
        paymentStatus: 'in_holding',
        paymentId: 'charge_1',
        paymentData: expect.objectContaining({
          chargeId: 'charge_1',
          rideId: 'temp_ride_1',
          amountInCents: 8785,
          paymentStatus: 'in_holding',
          serverValidated: true,
          providerProofSource: 'woovi_provider'
        })
      })
    );
    expect(harness.socket.emit).toHaveBeenCalledWith(
      'bookingCreated',
      expect.objectContaining({
        success: true,
        bookingId: 'booking_1'
      })
    );
    expect(harness.idempotencyService.cacheResult).toHaveBeenCalled();
    expect(paymentDispatchService.materializePaymentForBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        chargeId: 'charge_1',
        temporaryRideId: 'temp_ride_1',
        amountInCents: 8785,
        paymentStatus: 'in_holding',
        source: 'createBooking_paid_immediate'
      })
    );
    expect(paymentDispatchService.triggerDispatchAfterPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'createBooking_paid_immediate',
        force: true
      })
    );
  });
});
