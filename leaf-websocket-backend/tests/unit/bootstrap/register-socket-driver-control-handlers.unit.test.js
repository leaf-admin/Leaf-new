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
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  writeVisibleBookingSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/driver-activation-state-service', () => ({
  resolveDriverActivationState: jest.fn(),
}));

const registerSocketDriverControlHandlers = require('../../../bootstrap/register-socket-driver-control-handlers');
const { assessDriverArrivalAtPickup } = require('../../../utils/pickup-arrival-policy');

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
});

describe('register-socket-driver-control-handlers notificationAction scope', () => {
  let socket;
  let io;
  let redis;

  beforeEach(() => {
    jest.clearAllMocks();
    socket = createSocket();
    io = createIo();
    redis = createRedis();

    registerSocketDriverControlHandlers({
      socket,
      io,
      redisPool: {
        getConnection: jest.fn(() => redis),
      },
      logStructured: jest.fn(),
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
});
