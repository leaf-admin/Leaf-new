'use strict';

const mockRecordDriverDestinationDailyRideCompletion = jest.fn();
const mockValidateAndReserveRideOfflineIntent = jest.fn();
const mockMarkRideOfflineIntentProcessed = jest.fn();
const mockMarkRideOfflineIntentRejected = jest.fn();
const mockPersistFinalRideDataWithOutbox = jest.fn();
const mockGenerateAndSaveReceipt = jest.fn();
const mockScheduleMapH3Refresh = jest.fn();
const mockFirebaseDb = { ref: jest.fn() };
const mockRecordRideCompleted = jest.fn();
const mockRecordRideTotalDuration = jest.fn();

jest.mock('../../../services/driver-destination-mode-service', () => ({
  recordDriverDestinationDailyRideCompletion: (...args) => mockRecordDriverDestinationDailyRideCompletion(...args)
}));

jest.mock('../../../services/ride-offline-intent-validator', () => ({
  hasRideOfflineIntentPayload: jest.fn(() => false),
  validateAndReserveRideOfflineIntent: (...args) => mockValidateAndReserveRideOfflineIntent(...args),
  markRideOfflineIntentProcessed: (...args) => mockMarkRideOfflineIntentProcessed(...args),
  markRideOfflineIntentRejected: (...args) => mockMarkRideOfflineIntentRejected(...args)
}));

jest.mock('../../../services/ride-persistence-service', () => ({
  persistFinalRideDataWithOutbox: (...args) => mockPersistFinalRideDataWithOutbox(...args)
}));

jest.mock('../../../services/receipt-service', () =>
  jest.fn().mockImplementation(() => ({
    generateAndSaveReceipt: (...args) => mockGenerateAndSaveReceipt(...args)
  }))
);

jest.mock('../../../services/payment-service', () =>
  jest.fn().mockImplementation(() => ({
    calculateFareBreakdownFromReais: jest.fn((_fare, tollFee = 0) => ({
      totalFare: 81.17,
      grossAmount: 81.17,
      tollFee,
      operationalFee: 999,
      paymentIntermediationFee: 999,
      totalFees: 1998,
      driverNetAmount: 0
    }))
  }))
);

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => mockFirebaseDb)
}));

jest.mock('../../../utils/map-h3-refresh-broadcaster', () => ({
  scheduleMapH3Refresh: (...args) => mockScheduleMapH3Refresh(...args)
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordRideCompleted: (...args) => mockRecordRideCompleted(...args),
    recordRideTotalDuration: (...args) => mockRecordRideTotalDuration(...args)
  }
}));

const registerSocketCompleteTripHandler = require('../../../bootstrap/register-socket-complete-trip-handler');

function createSocket() {
  const handlers = new Map();
  return {
    id: 'socket_1',
    userId: 'driver_1',
    userType: 'driver',
    on: jest.fn((event, handler) => handlers.set(event, handler)),
    emit: jest.fn(),
    trigger: async (event, payload) => handlers.get(event)?.(payload)
  };
}

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('register-socket-complete-trip-handler receipt generation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPersistFinalRideDataWithOutbox.mockResolvedValue({ success: true });
    mockGenerateAndSaveReceipt.mockResolvedValue({ receiptId: 'LEAF-booking_1' });
    mockRecordDriverDestinationDailyRideCompletion.mockResolvedValue(undefined);
  });

  it('generates a backend-final receipt from the command snapshot even when activeBookings is already empty', async () => {
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn(async (key) => {
        if (key === 'trip_timer:booking_1') {
          return { startTimestamp: String(Date.now() - 300000) };
        }
        if (key === 'booking:booking_1') {
          return {
            bookingId: 'booking_1',
            customerId: 'customer_1',
            driverId: 'driver_1',
            pickupAddress: 'Origem',
            destinationAddress: 'Destino',
            operationalFee: '1.00',
            paymentIntermediationFee: '1.00',
            totalFees: '2.00',
            driverNetAmount: '79.17',
            estimatedTripDistanceKm: '27.1',
            tripDurationMin: '33',
            paymentMethod: 'pix',
            pricingPayload: JSON.stringify({
              toll_fee: 4,
              distance_km: 27.1,
              duration_min: 33
            })
          };
        }
        return {};
      })
    };
    const idempotencyService = {
      generateKey: jest.fn(() => 'idem_booking_1_complete'),
      beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
      cacheResult: jest.fn().mockResolvedValue(undefined),
      releaseInflight: jest.fn().mockResolvedValue(undefined)
    };
    const financialSnapshot = {
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      passengerPaidCents: 8117,
      operationalFeeCents: 244,
      paymentIntermediationFeeCents: 65,
      driverNetAmountCents: 7808,
      totalFeesCents: 309
    };
    const CompleteTripCommand = jest.fn().mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          bookingId: 'booking_1',
          driverId: 'driver_1',
          customerId: 'customer_1',
          city: 'rio_de_janeiro',
          serviceType: 'standard',
          event: { type: 'ride.completed', data: { bookingId: 'booking_1' } },
          endLocation: { lat: -22.9, lng: -43.2 },
          finalFare: 81.17,
          tollFee: 4,
          distance: 27.1,
          duration: 1980,
          paymentDistribution: { status: 'PENDING' },
          operationalFee: 2.44,
          paymentIntermediationFee: 0.65,
          totalFees: 3.09,
          driverNetAmount: 78.08,
          authoritativeSnapshot: true,
          financialSnapshotSource: 'backend_final',
          financialSnapshot
        }
      })
    }));
    const roomEmitter = { emit: jest.fn() };
    const io = {
      activeBookings: new Map(),
      to: jest.fn(() => roomEmitter)
    };

    registerSocketCompleteTripHandler({
      socket,
      io,
      extractTraceIdFromEvent: jest.fn(() => 'trace_1'),
      traceContext: { runWithTraceId: jest.fn(async (_traceId, callback) => callback()) },
      logStructured: jest.fn(),
      rateLimiterService: { checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }) },
      validationService: {
        validateEndpoint: jest.fn(() => ({
          valid: true,
          sanitized: {
            bookingId: 'booking_1',
            endLocation: { lat: -22.9, lng: -43.2 },
            distance: 12.4,
            fare: 81.17
          }
        }))
      },
      getSocketMetadata: jest.fn(() => ({})),
      auditService: { logRideAction: jest.fn() },
      redisPool: { getConnection: jest.fn(() => redis) },
      idempotencyService,
      getTracer: jest.fn(() => ({})),
      createCommandSpan: jest.fn(() => ({})),
      runInSpan: jest.fn(async (_span, callback) => callback()),
      endSpanError: jest.fn(),
      logCommand: jest.fn(),
      createEventSpan: jest.fn(() => ({ spanContext: jest.fn(() => ({})) })),
      eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
      logEvent: jest.fn(),
      CompleteTripCommand,
      fcmService: { sendRideStatusUpdate: jest.fn().mockResolvedValue(undefined) }
    });

    await socket.trigger('completeTrip', { bookingId: 'booking_1' });
    await flushImmediate();
    await flushImmediate();

    expect(CompleteTripCommand).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking_1',
      tollFee: 4,
      distance: 27.1,
      duration: 1980
    }));

    expect(idempotencyService.cacheResult).toHaveBeenCalledWith(
      'idem_booking_1_complete',
      expect.objectContaining({
        bookingId: 'booking_1',
        financialSnapshotSource: 'backend_final'
      })
    );
    expect(mockPersistFinalRideDataWithOutbox).toHaveBeenCalledWith(
      'booking_1',
      expect.objectContaining({
        financialSnapshotSource: 'backend_final',
        authoritativeSnapshot: true,
        financialSnapshot,
        tollFee: 4,
        routeDistanceKm: 27.1,
        routeDurationSecs: 1980,
        fareBreakdown: expect.objectContaining({
          operationalFee: 2.44,
          paymentIntermediationFee: 0.65,
          totalFees: 3.09,
          driverNetAmount: 78.08
        })
      })
    );
    expect(mockGenerateAndSaveReceipt).toHaveBeenCalledWith(
      'booking_1',
      expect.objectContaining({
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        grossAmount: 81.17,
        operationalFee: 2.44,
        paymentIntermediationFee: 0.65,
        totalFees: 3.09,
        driverNetAmount: 78.08,
        tollFee: 4,
        distance: 27.1,
        routeDistanceKm: 27.1,
        durationSeconds: 1980,
        payment_mode: 'pix',
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        financialSnapshot
      })
    );
  });

  describe('driver early end settlement', () => {
    const bookingHash = {
      bookingId: 'booking_1',
      customerId: 'customer_1',
      driverId: 'driver_1',
      pickupAddress: 'Origem',
      destinationAddress: 'Destino',
      destinationLocation: JSON.stringify({ lat: -22.9827, lng: -43.3642 }),
      estimatedTripDistanceKm: '10',
      routeDurationSecs: '1200',
      paymentMethod: 'pix'
    };
    const settlement = {
      settlementType: 'EARLY_ENDED_BY_DRIVER',
      originalFare: 40,
      prepaidAmount: 40,
      executedFare: 20,
      estimatedRefund: 20,
      executedDistanceKm: 5,
      executedDurationSecs: 600
    };

    async function runCompleteTrip({ commandData, payload = {}, bookingOverrides = {} }) {
      const socket = createSocket();
      const redis = {
        hgetall: jest.fn(async (key) => (key === 'booking:booking_1' ? { ...bookingHash, ...bookingOverrides } : {})),
        hset: jest.fn().mockResolvedValue(1)
      };
      const idempotencyService = {
        generateKey: jest.fn(() => 'idem_booking_1_complete'),
        beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
        cacheResult: jest.fn().mockResolvedValue(undefined),
        releaseInflight: jest.fn().mockResolvedValue(undefined)
      };
      const CompleteTripCommand = jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            bookingId: 'booking_1',
            driverId: 'driver_1',
            customerId: 'customer_1',
            event: { type: 'ride.completed', data: { bookingId: 'booking_1' } },
            tollFee: 0,
            paymentDistribution: { status: 'PENDING' },
            authoritativeSnapshot: true,
            financialSnapshotSource: 'backend_final',
            ...commandData
          }
        })
      }));
      const emitted = [];
      const io = {
        activeBookings: new Map(),
        to: jest.fn((room) => ({
          emit: jest.fn((event, data) => emitted.push({ room, event, data }))
        }))
      };

      registerSocketCompleteTripHandler({
        socket,
        io,
        extractTraceIdFromEvent: jest.fn(() => 'trace_1'),
        traceContext: { runWithTraceId: jest.fn(async (_traceId, callback) => callback()) },
        logStructured: jest.fn(),
        rateLimiterService: { checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }) },
        validationService: {
          validateEndpoint: jest.fn(() => ({
            valid: true,
            sanitized: {
              bookingId: 'booking_1',
              endLocation: { lat: -22.9827, lng: -43.3642 },
              distance: 10,
              fare: 40
            }
          }))
        },
        getSocketMetadata: jest.fn(() => ({})),
        auditService: { logRideAction: jest.fn() },
        redisPool: { getConnection: jest.fn(() => redis) },
        idempotencyService,
        getTracer: jest.fn(() => ({})),
        createCommandSpan: jest.fn(() => ({})),
        runInSpan: jest.fn(async (_span, callback) => callback()),
        endSpanError: jest.fn(),
        logCommand: jest.fn(),
        createEventSpan: jest.fn(() => ({ spanContext: jest.fn(() => ({})) })),
        eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
        logEvent: jest.fn(),
        CompleteTripCommand,
        fcmService: { sendRideStatusUpdate: jest.fn().mockResolvedValue(undefined) }
      });

      await socket.trigger('completeTrip', { bookingId: 'booking_1', ...payload });
      await flushImmediate();
      await flushImmediate();

      const tripCompleted = (room) =>
        emitted.find((entry) => entry.room === room && entry.event === 'tripCompleted')?.data;
      return {
        CompleteTripCommand,
        redis,
        driverPayload: tripCompleted('driver_driver_1'),
        passengerPayload: tripCompleted('customer_customer_1')
      };
    }

    it('sends the settled values and the same settlement shape to both apps', async () => {
      const earlyEnd = { detected: true, remainingMeters: 4040, thresholdMeters: 500, driverReason: 'passenger_request' };
      const { CompleteTripCommand, redis, driverPayload, passengerPayload } = await runCompleteTrip({
        bookingOverrides: { startedAt: new Date(Date.now() - 480000).toISOString() },
        payload: { earlyEnd: { reason: 'passenger_request', remainingMeters: 4000 } },
        commandData: {
          endLocation: { lat: -22.95175, lng: -43.38515 },
          finalFare: 20,
          distance: 5,
          duration: 600,
          operationalFee: 0.99,
          paymentIntermediationFee: 0.5,
          totalFees: 1.49,
          driverNetAmount: 18.51,
          completionType: 'EARLY_ENDED_BY_DRIVER',
          settlement,
          earlyEnd
        }
      });

      // O handler só repassa a declaração do motorista; quem decide é o command.
      expect(CompleteTripCommand).toHaveBeenCalledWith(expect.objectContaining({
        finalFare: 40,
        earlyEnd: { reason: 'passenger_request', remainingMeters: 4000 }
      }));

      for (const payload of [driverPayload, passengerPayload]) {
        expect(payload).toMatchObject({
          completionType: 'EARLY_ENDED_BY_DRIVER',
          settlement,
          earlyEnd,
          distance: 5,
          duration: 600,
          operationalFee: 0.99,
          paymentIntermediationFee: 0.5,
          driverNetAmount: 18.51,
          endLocation: { lat: -22.95175, lng: -43.38515 }
        });
      }
      expect(redis.hset).toHaveBeenCalledWith('booking:booking_1', expect.objectContaining({
        earlyEndReviewStatus: 'PENDING_PASSENGER_FEEDBACK'
      }));
      // A persistência usa completionType como status: a corrida segue COMPLETED.
      const persisted = mockPersistFinalRideDataWithOutbox.mock.calls[0][1];
      expect(persisted).toMatchObject({ fare: 20, distance: 5, duration: 600, settlement });
      expect(persisted.completionType).toBeUndefined();
      expect(mockGenerateAndSaveReceipt).toHaveBeenCalledWith(
        'booking_1',
        expect.objectContaining({
          finalFare: 20,
          distanceKm: 5,
          durationSeconds: 600,
          driverNetAmount: 18.51,
          completionType: 'EARLY_ENDED_BY_DRIVER',
          settlement,
          status: 'COMPLETED'
        })
      );

      for (const tripPayload of [driverPayload, passengerPayload]) {
        expect(tripPayload.actualDurationSecs).toBeGreaterThanOrEqual(480);
        expect(tripPayload.actualDurationSecs).toBeLessThan(490);
      }
    });

    it('sends the uncrossed toll refund to both apps and persists it', async () => {
      const tollAdjustment = {
        type: 'TOLL_NOT_CROSSED',
        bookedTollFee: 6.5,
        chargedTollFee: 0,
        refundedTollFee: 6.5,
        crossedPlazas: [],
        originalPaidAmount: 46.5,
        finalAmount: 40,
        estimatedRefund: 6.5
      };
      const { driverPayload, passengerPayload } = await runCompleteTrip({
        commandData: {
          endLocation: { lat: -22.9827, lng: -43.3642 },
          finalFare: 40,
          distance: 10,
          duration: 1200,
          tollAdjustment
        }
      });

      for (const payload of [driverPayload, passengerPayload]) {
        expect(payload.completionType).toBe('COMPLETED');
        expect(payload.tollAdjustment).toEqual(tollAdjustment);
      }
      expect(mockPersistFinalRideDataWithOutbox.mock.calls[0][1].tollAdjustment).toEqual(tollAdjustment);
      expect(mockGenerateAndSaveReceipt.mock.calls[0][1].tollAdjustment).toEqual(tollAdjustment);
    });

    it('keeps the completion payload unchanged when the command did not settle', async () => {
      const { driverPayload, passengerPayload } = await runCompleteTrip({
        payload: { earlyEnd: { reason: 'passenger_request', remainingMeters: 9000 } },
        commandData: {
          endLocation: { lat: -22.9827, lng: -43.3642 },
          finalFare: 40,
          distance: 10,
          duration: 1200,
          operationalFee: 1.49,
          paymentIntermediationFee: 0.5,
          totalFees: 1.99,
          driverNetAmount: 38.01
        }
      });

      for (const payload of [driverPayload, passengerPayload]) {
        expect(payload.completionType).toBe('COMPLETED');
        expect(payload.settlement).toBeUndefined();
        expect(payload.earlyEnd).toBeUndefined();
        expect(payload).toMatchObject({ distance: 10, duration: 1200, driverNetAmount: 38.01 });
      }
      const persisted = mockPersistFinalRideDataWithOutbox.mock.calls[0][1];
      expect(persisted.fare).toBe(40);
      expect(persisted.settlement).toBeUndefined();
      expect(mockGenerateAndSaveReceipt.mock.calls[0][1].settlement).toBeUndefined();
    });
  });
});
