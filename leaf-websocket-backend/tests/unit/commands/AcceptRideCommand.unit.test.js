jest.mock('../../../events/ride.accepted', () => {
  return jest.fn().mockImplementation((data) => ({
    toJSON: () => ({ ...data, type: 'ride.accepted' })
  }));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    ACCEPTED: 'ACCEPTED'
  }
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn(),
  acquireLock: jest.fn(),
  renewLock: jest.fn(),
  releaseLock: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logStructured: jest.fn()
}));

jest.mock('../../../services/event-sourcing', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined),
  EVENT_TYPES: {
    STATE_CHANGED: 'STATE_CHANGED'
  }
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, fn) => fn())
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordCommand: jest.fn()
  }
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/active-trip-index', () => ({
  setActiveTripForDriver: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/accept-ride-payload', () => ({
  resolveAcceptRidePayload: jest.fn(async (_redis, _bookingId, payload) => payload)
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  rehydratePrimaryBooking: jest.fn().mockResolvedValue(null),
  writeVisibleBookingSnapshot: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../services/offer-reservation-service', () => ({
  hasOfferReservation: jest.fn().mockResolvedValue(true),
  clearOfferReservationsForBooking: jest.fn().mockResolvedValue(undefined)
}));

const RideAcceptedEvent = require('../../../events/ride.accepted');
const redisPool = require('../../../utils/redis-pool');
const driverLockManager = require('../../../services/driver-lock-manager');
const eventSourcing = require('../../../services/event-sourcing');
const {
  hasOfferReservation,
  clearOfferReservationsForBooking
} = require('../../../services/offer-reservation-service');
const { setActiveTripForDriver } = require('../../../utils/active-trip-index');
const { metrics } = require('../../../utils/prometheus-metrics');
const { resolveAcceptRidePayload } = require('../../../utils/accept-ride-payload');
const traceContext = require('../../../utils/trace-context');
const AcceptRideCommand = require('../../../commands/AcceptRideCommand');

describe('AcceptRideCommand', () => {
  let redis;
  let setImmediateSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    redis = {
      exists: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue('booking_1'),
      hmget: jest.fn().mockResolvedValue([null, null, null]),
      eval: jest.fn(),
      hgetall: jest.fn().mockResolvedValue({
        destinationLocation: JSON.stringify({ lat: -23.57, lng: -46.66 }),
        estimatedFare: '38.5'
      }),
      hset: jest.fn().mockResolvedValue(1),
      geopos: jest.fn().mockResolvedValue([[-46.65, -23.56]]),
      del: jest.fn().mockResolvedValue(1)
    };

    redisPool.getConnection.mockReturnValue(redis);
    RideAcceptedEvent.mockImplementation((data) => ({
      toJSON: () => ({ ...data, type: 'ride.accepted' })
    }));
    traceContext.runWithTraceId.mockImplementation(async (_traceId, fn) => fn());
    eventSourcing.recordEvent.mockResolvedValue(undefined);
    hasOfferReservation.mockResolvedValue(true);
    clearOfferReservationsForBooking.mockResolvedValue(undefined);
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((fn) => {
      fn();
      return 0;
    });
    driverLockManager.isDriverLocked
      .mockResolvedValueOnce({ isLocked: false, bookingId: null })
      .mockResolvedValueOnce({ isLocked: false, bookingId: null });
    driverLockManager.acquireLock.mockResolvedValue(true);
    resolveAcceptRidePayload.mockImplementation(async (_instance, _bookingId, payload) => payload);
  });

  afterEach(() => {
    setImmediateSpy?.mockRestore();
  });

  it('accepts a booking and returns enriched ride acceptance payload', async () => {
    redis.eval.mockResolvedValue(
      'customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
    );

    const command = new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(driverLockManager.acquireLock).toHaveBeenCalledWith('driver_1', 'booking_1', 3600);
    expect(redis.hset).toHaveBeenCalledWith(
      'booking:booking_1',
      expect.objectContaining({
        driverAcceptedLocation: JSON.stringify({ lat: -23.56, lng: -46.65 })
      })
    );
    expect(resolveAcceptRidePayload).toHaveBeenCalled();
    expect(clearOfferReservationsForBooking).toHaveBeenCalledWith(redis, 'booking_1');
    expect(setActiveTripForDriver).toHaveBeenCalledWith(redis, 'driver_1', 'booking_1', 'customer_1');
    expect(RideAcceptedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        driverId: 'driver_1',
        customerId: 'customer_1'
      })
    );
    expect(result.data).toEqual(
      expect.objectContaining({
        bookingId: 'booking_1',
        customerId: 'customer_1',
        idempotentAccept: false,
        driverAcceptedLocation: { lat: -23.56, lng: -46.65 }
      })
    );
    expect(result.data.driverDistanceToPickupKm).toBeGreaterThan(0);
    expect(result.data.estimatedArrivalToPickupMin).toBeGreaterThan(0);
    expect(metrics.recordCommand).toHaveBeenCalledWith('AcceptRide', expect.any(Number), true);
  });

  it('keeps zero driver-to-pickup distance when driver is at the pickup point', async () => {
    redis.eval.mockResolvedValue(
      'customer_1|||{"lat":-22.857,"lng":-43.309,"add":"Rua Alecrim, 497"}'
    );
    redis.geopos.mockResolvedValue([[-43.309, -22.857]]);

    const command = new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(redis.hset).toHaveBeenCalledWith(
      'booking:booking_1',
      expect.objectContaining({
        driverAcceptedLocation: JSON.stringify({ lat: -22.857, lng: -43.309 }),
        driverDistanceToPickupKm: '0',
        estimatedArrivalToPickupMin: '1'
      })
    );
    expect(result.data.driverDistanceToPickupKm).toBe(0);
    expect(result.data.estimatedArrivalToPickupMin).toBe(1);
  });

  it('reuses the acceptance when the same driver already owns the booking', async () => {
    redis.eval.mockResolvedValue(
      'OK_ALREADY_ACCEPTED|||customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
    );

    const command = new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(result.data.idempotentAccept).toBe(true);
    expect(result.data.event).toBeNull();
    expect(RideAcceptedEvent).not.toHaveBeenCalled();
  });

  it('fails early with an expired-offer reason when the driver no longer has a valid reservation', async () => {
    redis.get.mockResolvedValue(null);
    redis.hmget.mockResolvedValue(['', 'SEARCHING', 'PENDING']);
    hasOfferReservation.mockResolvedValue(false);

    const command = new AcceptRideCommand({
      driverId: 'driver_2',
      bookingId: 'booking_2'
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/oferta expirada/i);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('allows accepting a booking that is awaiting driver response in the active state machine', async () => {
    redis.get.mockResolvedValue('booking_3');
    redis.hmget.mockResolvedValue(['', 'AWAITING_RESPONSE', '']);
    redis.eval.mockImplementation(async (script) => {
      expect(script).toContain("currentStateUpper == 'AWAITING_RESPONSE'");
      expect(script).toContain("currentStateUpper == 'NOTIFIED'");
      expect(script).toContain("currentStateUpper == 'EXPANDED'");
      return 'customer_3|||{"lat":-23.55,"lng":-46.63,"add":"Rua B, 20"}';
    });

    const command = new AcceptRideCommand({
      driverId: 'driver_3',
      bookingId: 'booking_3'
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(result.data.bookingId).toBe('booking_3');
  });
});
