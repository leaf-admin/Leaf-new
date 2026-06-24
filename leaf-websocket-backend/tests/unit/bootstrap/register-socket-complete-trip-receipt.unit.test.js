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
    calculateFareBreakdownFromReais: jest.fn(() => ({
      totalFare: 81.17,
      grossAmount: 81.17,
      tollFee: 0,
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
            driverNetAmount: '79.17'
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
          tollFee: 0,
          distance: 12.4,
          duration: 1320,
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
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        financialSnapshot
      }),
      mockFirebaseDb
    );
  });
});
