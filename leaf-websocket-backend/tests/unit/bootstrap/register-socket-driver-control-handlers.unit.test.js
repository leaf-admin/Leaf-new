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
  }),
  hset: jest.fn().mockResolvedValue(1),
  type: jest.fn().mockResolvedValue('hash'),
  del: jest.fn().mockResolvedValue(1),
});

describe('register-socket-driver-control-handlers notificationAction scope', () => {
  let socket;
  let io;
  let redis;
  let fcmService;

  beforeEach(() => {
    jest.clearAllMocks();
    socket = createSocket();
    io = createIo();
    redis = createRedis();
    fcmService = {
      sendRideStatusUpdate: jest.fn().mockResolvedValue({ success: true }),
    };

    registerSocketDriverControlHandlers({
      socket,
      io,
      redisPool: {
        getConnection: jest.fn(() => redis),
      },
      logStructured: jest.fn(),
      fcmService,
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
    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledWith(
      'customer_1',
      expect.objectContaining({
        bookingId: 'booking_1',
        status: 'arrived',
        userType: 'customer',
        driverName: 'Carlos Motorista Teste',
        pickup: expect.objectContaining({ address: 'Rua de Partida, 100' }),
        pickupEstimatedTime: '0',
      })
    );
    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledWith(
      'driver_1',
      expect.objectContaining({
        bookingId: 'booking_1',
        status: 'arrived',
        userType: 'driver',
        customerName: 'Leaf Passageiro Teste',
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
