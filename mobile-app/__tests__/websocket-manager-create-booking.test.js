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
});
