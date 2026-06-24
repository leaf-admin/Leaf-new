jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: null,
}));

jest.mock('socket.io-client', () => jest.fn());

jest.mock('../src/utils/friendlyErrorMessages', () => ({
  toUserFriendlyError: jest.fn((payload, context = {}) => {
    const error = new Error(payload?.message || context?.fallbackMessage || 'Erro');
    if (payload?.code) {
      error.code = payload.code;
    }
    return error;
  }),
}));

jest.mock('../src/config/NetworkConfig', () => ({
  getWebSocketURL: jest.fn(() => 'https://socket.test'),
}));

import WebSocketManager from '../src/services/WebSocketManager';
import rideCostTelemetryService from '../src/services/RideCostTelemetryService';

describe('WebSocketManager createBooking retries', () => {
  beforeEach(() => {
    WebSocketManager.instance = null;
    jest.clearAllMocks();
    rideCostTelemetryService.resetForTests();
  });

  it('treats PAYMENT_NOT_CONFIRMED as a transient createBooking error', () => {
    const manager = WebSocketManager.getInstance();

    expect(
      manager._isCreateBookingRetryable({
        code: 'PAYMENT_NOT_CONFIRMED',
        message: 'O pagamento desta corrida ainda não foi confirmado.',
      }),
    ).toBe(true);
  });

  it('reuses a stable idempotency key when paymentId is present', () => {
    const manager = WebSocketManager.getInstance();
    const bookingData = {
      customerId: 'customer_123',
      pickupLocation: { lat: -23.56, lng: -46.65 },
      destinationLocation: { lat: -23.57, lng: -46.66 },
      estimatedFare: 27.5,
      carType: 'Leaf Plus',
      paymentId: 'charge_abc123',
    };

    const firstKey = manager._buildCreateBookingIdempotencyKey(bookingData, 'request_one');
    const secondKey = manager._buildCreateBookingIdempotencyKey(bookingData, 'request_two');

    expect(firstKey).toBe('mobile_customer_123_payment_charge_abc123');
    expect(secondKey).toBe(firstKey);
  });

  it('embeds a ride telemetry snapshot in createBooking payloads', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };
    manager.isAuthenticated = true;
    manager.authenticatedUserId = 'customer_123';
    manager.authenticatedUserType = 'customer';

    const bookingPromise = manager.createBooking({
      customerId: 'customer_123',
      pickupLocation: { lat: -23.56, lng: -46.65 },
      destinationLocation: { lat: -23.57, lng: -46.66 },
      estimatedFare: 27.5,
      carType: 'Leaf Plus',
    });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'createBooking',
      expect.objectContaining({
        customerId: 'customer_123',
        rideCostTelemetry: expect.objectContaining({
          sourceKey: 'customer:customer_123',
          snapshot: expect.objectContaining({
            sourceMeta: expect.objectContaining({
              userId: 'customer_123',
              userType: 'customer',
              flow: 'mobile_socket',
              platform: 'android',
            }),
          }),
        }),
      }),
    );

    manager.emit('bookingCreated', {
      success: true,
      bookingId: 'booking_telemetry_1',
      data: { bookingId: 'booking_telemetry_1' },
    });

    await expect(bookingPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_telemetry_1',
      }),
    );
  });

  it('confirms E2E bypass payments with mock metadata before booking creation', async () => {
    const manager = WebSocketManager.getInstance();
    const listeners = {};
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      once: jest.fn((event, callback) => {
        listeners[event] = callback;
      }),
      off: jest.fn(),
    };
    manager.isAuthenticated = true;
    manager.authenticatedUserId = 'customer_123';
    manager.authenticatedUserType = 'customer';

    const paymentPromise = manager.confirmPayment({
      bookingId: 'qa_bypass_123',
      paymentMethod: 'pix',
      chargeId: 'qa_bypass_123',
      amount: 14.22,
      mockPayment: true,
      __mockPayment: true,
      enforceFareLock: false,
      preBooking: true,
    });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'confirmPayment',
      expect.objectContaining({
        bookingId: 'qa_bypass_123',
        paymentMethod: 'pix',
        paymentId: 'qa_bypass_123',
        chargeId: 'qa_bypass_123',
        amount: 14.22,
        mockPayment: true,
        __mockPayment: true,
        enforceFareLock: false,
        preBooking: true,
      }),
    );

    listeners.paymentConfirmed({
      success: true,
      bookingId: 'qa_bypass_123',
    });

    await expect(paymentPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'qa_bypass_123',
      }),
    );
  });

  it('waits for the matching booking before resolving startTrip', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    const startPromise = manager.startTrip('booking_1', { lat: -22.97, lng: -43.18 });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'startTrip',
      expect.objectContaining({
        bookingId: 'booking_1',
        startLocation: { lat: -22.97, lng: -43.18 },
        requestId: expect.stringMatching(/^start_trip_/),
      }),
      expect.any(Function),
    );

    manager.emit('tripStarted', { success: true, bookingId: 'booking_other' });
    manager.emit('tripStarted', { success: true, bookingId: 'booking_1' });

    await expect(startPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_1',
      }),
    );
  });

  it('forwards ride outbox metadata with lifecycle commands', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    const startPromise = manager.startTrip(
      'booking_offline_1',
      { lat: -22.97, lng: -43.18 },
      {
        idempotencyKey: 'mobile_lifecycle_start_trip_booking_offline_1_driver_1',
        offlineIntent: true,
        rideEventOutbox: true,
        source: 'ride_event_outbox',
        eventType: 'start_trip',
        clientSequence: 3,
        clientCreatedAt: '2026-06-23T12:00:00.000Z',
      },
    );

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'startTrip',
      expect.objectContaining({
        bookingId: 'booking_offline_1',
        idempotencyKey: 'mobile_lifecycle_start_trip_booking_offline_1_driver_1',
        offlineIntent: true,
        rideEventOutbox: true,
        source: 'ride_event_outbox',
        eventType: 'start_trip',
        clientSequence: 3,
        clientCreatedAt: '2026-06-23T12:00:00.000Z',
      }),
      expect.any(Function),
    );

    manager.emit('tripStarted', { success: true, bookingId: 'booking_offline_1' });

    await expect(startPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_offline_1',
      }),
    );
  });

  it('rejects completeTrip on server lifecycle errors', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    const completePromise = manager.completeTrip(
      'booking_1',
      { lat: -22.98, lng: -43.19 },
      3.2,
      15.06,
    );

    manager.emit('tripCompleteError', {
      bookingId: 'booking_1',
      code: 'FARE_LOCK_MISMATCH',
      message: 'Valor final diverge',
    });

    await expect(completePromise).rejects.toMatchObject({
      code: 'FARE_LOCK_MISMATCH',
      message: 'Valor final diverge',
    });
  });

  it('emits batched driver locations with seq and capturedAt metadata', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    const batchPromise = manager.updateLocationBatch({
      driverId: 'driver_1',
      bookingId: 'booking_batch_1',
      tripStatus: 'started',
      isInTrip: true,
      locations: [
        {
          eventId: 'loc_1',
          lat: -22.91,
          lng: -43.17,
          seq: 1,
          capturedAt: 1710000000000,
          source: 'background_task',
        },
      ],
      batchId: 'batch_1',
    });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'updateLocationBatch',
      expect.objectContaining({
        batchId: 'batch_1',
        driverId: 'driver_1',
        bookingId: 'booking_batch_1',
        tripStatus: 'started',
        isInTrip: true,
        locations: [
          expect.objectContaining({
            eventId: 'loc_1',
            lat: -22.91,
            lng: -43.17,
            seq: 1,
            capturedAt: 1710000000000,
            source: 'background_task',
          }),
        ],
      }),
    );

    manager.emit('locationBatchUpdated', {
      success: true,
      batchId: 'batch_1',
      acceptedCount: 1,
    });

    await expect(batchPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        batchId: 'batch_1',
      }),
    );
  });

  it('sends backend quote metadata with ride extension requests', async () => {
    const manager = WebSocketManager.getInstance();
    const listeners = {};
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn((event, callback) => {
        listeners[event] = callback;
      }),
      off: jest.fn(),
    };

    const extensionPromise = manager.requestRideExtension(
      'booking_extension_1',
      {
        lat: -22.8721,
        lng: -43.3387,
        add: 'Mercadão de Madureira',
      },
      42.75,
      {
        routeDistanceKm: 8.4,
        routeDurationSecs: 1260,
        quoteLockId: 'ql_extension_4275',
        quoteSessionId: 'passenger_quote_extension_1',
      },
    );

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'requestRideExtension',
      expect.objectContaining({
        bookingId: 'booking_extension_1',
        newFare: 42.75,
        routeDistanceKm: 8.4,
        routeDurationSecs: 1260,
        quoteLockId: 'ql_extension_4275',
        quoteSessionId: 'passenger_quote_extension_1',
      }),
    );

    listeners.rideExtensionRequestAccepted({
      success: true,
      bookingId: 'booking_extension_1',
    });

    await expect(extensionPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_extension_1',
      }),
    );
  });
});
