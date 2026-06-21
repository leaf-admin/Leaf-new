jest.mock('../../../utils/pickup-arrival-policy', () => ({
  assessDriverArrivalAtPickup: jest.fn(),
}));

jest.mock('../../../utils/map-h3-refresh-broadcaster', () => ({
  scheduleMapH3Refresh: jest.fn(),
}));

jest.mock('../../../bootstrap/active-ride-sync-utils', () => ({
  buildActiveRideSnapshotForUser: jest.fn().mockResolvedValue({ bookingId: 'booking_1' }),
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    ARRIVED: 'ARRIVED',
  },
  updateBookingState: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  applyBookingSnapshot: jest.fn().mockResolvedValue(undefined),
  applyDriverSnapshot: jest.fn().mockResolvedValue(undefined),
  removeDriverSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  writeVisibleBookingSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/driver-activation-state-service', () => ({
  resolveDriverActivationState: jest.fn(),
}));

jest.mock('../../../services/driver-destination-mode-service', () => ({
  resolveDestinationModeIntent: jest.fn().mockResolvedValue({
    allowed: true,
    shouldWrite: false,
    patch: null,
    destinationMode: undefined,
    policy: null,
  }),
}));

jest.mock('../../../services/driver-eligibility-service', () => ({
  resolveDriverProfile: jest.fn().mockResolvedValue({
    activeVehicleId: 'vehicle_1',
    vehiclePlate: 'RJA2D41',
    vehicleMake: 'Honda',
    vehicleModel: 'City',
    vehicleColor: 'BRANCO',
    vehicleIdentitySource: 'crlv_pdf_ocr',
    vehicleIdentityCanonical: true,
  }),
}));

const registerSocketDriverControlHandlers = require('../../../bootstrap/register-socket-driver-control-handlers');
const { assessDriverArrivalAtPickup } = require('../../../utils/pickup-arrival-policy');
const { resolveDriverActivationState } = require('../../../services/driver-activation-state-service');

const createSocket = () => {
  const handlers = new Map();

  return {
    userId: 'driver_1',
    on: jest.fn((event, handler) => {
      handlers.set(event, handler);
    }),
    emit: jest.fn(),
    trigger: async (event, payload) => handlers.get(event)?.(payload),
  };
};

const createIo = () => {
  const roomEmit = jest.fn();
  return {
    activeBookings: new Map(),
    roomEmit,
    to: jest.fn(() => ({ emit: roomEmit })),
  };
};

const createRedis = () => ({
  hgetall: jest.fn().mockResolvedValue({
    bookingId: 'booking_1',
    customerId: 'customer_1',
    driverId: 'driver_1',
  }),
  hset: jest.fn().mockResolvedValue(1),
  type: jest.fn().mockResolvedValue('hash'),
  del: jest.fn().mockResolvedValue(1),
  zrem: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  sadd: jest.fn().mockResolvedValue(1),
  geoadd: jest.fn().mockResolvedValue(1),
});

describe('register-socket-driver-control-handlers notificationAction scope', () => {
  let socket;
  let io;
  let redis;
  let idempotencyService;

  beforeEach(() => {
    jest.clearAllMocks();
    socket = createSocket();
    io = createIo();
    redis = createRedis();
    idempotencyService = {
      generateKey: jest.fn(() => 'idem_arrive'),
      beginRequest: jest.fn().mockResolvedValue({
        isNew: true,
        disposition: 'started',
        cachedResult: null,
      }),
      cacheResult: jest.fn().mockResolvedValue(undefined),
      releaseInflight: jest.fn().mockResolvedValue(undefined),
    };

    registerSocketDriverControlHandlers({
      socket,
      io,
      redisPool: {
        getConnection: jest.fn(() => redis),
      },
      logStructured: jest.fn(),
      idempotencyService,
    });
  });

  it('emits scoped notification action success for arrived_at_pickup', async () => {
    assessDriverArrivalAtPickup.mockResolvedValue({
      allowed: true,
      distanceMeters: 12,
      toleranceMeters: 50,
    });

    await socket.trigger('notificationAction', {
      action: 'arrived_at_pickup',
      bookingId: 'booking_1',
      location: { lat: -22.9, lng: -43.2 },
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'notificationActionSuccess',
      expect.objectContaining({
        success: true,
        action: 'arrived_at_pickup',
        bookingId: 'booking_1',
        rideId: 'booking_1',
      })
    );
  });

  it('emits scoped notification action errors for unsupported actions', async () => {
    await socket.trigger('notificationAction', {
      action: 'unsupported_action',
      bookingId: 'booking_2',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'notificationActionError',
      expect.objectContaining({
        success: false,
        action: 'unsupported_action',
        bookingId: 'booking_2',
        code: 'UNSUPPORTED_NOTIFICATION_ACTION',
      })
    );
  });

  it('emits scoped notification action errors when arrival validation fails', async () => {
    assessDriverArrivalAtPickup.mockResolvedValue({
      allowed: false,
      message: 'Fora do raio de embarque',
      code: 'OUTSIDE_PICKUP_RADIUS',
      distanceMeters: 180,
      toleranceMeters: 50,
    });

    await socket.trigger('notificationAction', {
      action: 'arrived_at_pickup',
      bookingId: 'booking_3',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'notificationActionError',
      expect.objectContaining({
        success: false,
        action: 'arrived_at_pickup',
        bookingId: 'booking_3',
        code: 'OUTSIDE_PICKUP_RADIUS',
      })
    );
  });

  it('returns cached arrival result without reapplying arrival state', async () => {
    const cachedResult = {
      success: true,
      bookingId: 'booking_1',
      rideId: 'booking_1',
      cached: true,
    };
    idempotencyService.beginRequest.mockResolvedValueOnce({
      isNew: false,
      disposition: 'cached',
      cachedResult,
    });

    await socket.trigger('notificationAction', {
      action: 'arrived_at_pickup',
      bookingId: 'booking_1',
      idempotencyKey: 'idem_arrive',
    });

    expect(assessDriverArrivalAtPickup).not.toHaveBeenCalled();
    expect(redis.hgetall).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('arrivedAtPickup', cachedResult);
    expect(socket.emit).toHaveBeenCalledWith(
      'notificationActionSuccess',
      expect.objectContaining({
        success: true,
        action: 'arrived_at_pickup',
        bookingId: 'booking_1',
        cached: true,
      })
    );
  });

  it('returns canonical vehicle identity in the authenticated driver online ack', async () => {
    resolveDriverActivationState.mockResolvedValue({
      canAttemptOnline: true,
      canGoOnline: true,
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      dispatchEligible: 'true',
      lat: '-22.9207',
      lng: '-43.4059',
    });

    await socket.trigger('setDriverStatus', {
      status: 'online',
      isOnline: true,
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        success: true,
        driverId: 'driver_1',
        vehicleIdentity: {
          activeVehicleId: 'vehicle_1',
          plate: 'RJA2D41',
          make: 'Honda',
          model: 'City',
          color: 'BRANCO',
          source: 'crlv_pdf_ocr',
          canonical: true,
          complete: true,
        },
      })
    );
  });
});
