jest.useFakeTimers();

jest.mock('../../../services/driver-lock-manager', () => ({
  acquireLock: jest.fn(),
  getLockedBooking: jest.fn(),
  releaseLock: jest.fn()
}));

jest.mock('../../../services/event-sourcing', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined),
  EVENT_TYPES: {
    DRIVER_NOTIFIED: 'DRIVER_NOTIFIED',
    DRIVER_TIMEOUT: 'DRIVER_TIMEOUT'
  }
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn()
}));

jest.mock('../../../services/payment-service', () => {
  return jest.fn().mockImplementation(() => ({}));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    SEARCHING: 'SEARCHING',
    EXPANDED: 'EXPANDED',
    NOTIFIED: 'NOTIFIED',
    AWAITING_RESPONSE: 'AWAITING_RESPONSE',
    PENDING: 'PENDING',
    REASSIGNMENT_PENDING: 'REASSIGNMENT_PENDING'
  },
  getBookingState: jest.fn(),
  updateBookingState: jest.fn().mockResolvedValue(true)
  ,
  isTerminalStateValue: jest.fn((value) => [
    'COMPLETE',
    'COMPLETED',
    'CANCELED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED',
    'SUPERSEDED',
    'NO_DRIVERS_AVAILABLE',
    'NO_DRIVERS_FOUND',
    'EARLY_ENDED_BY_RIDER',
    'INTERRUPTED_OPERATIONAL_ENDED',
    'EARLY_ENDED_REVIEW'
  ].includes(String(value || '').trim().toUpperCase()))
}));

const driverLockManager = require('../../../services/driver-lock-manager');
const RideStateManager = require('../../../services/ride-state-manager');
const DriverNotificationDispatcher = require('../../../services/driver-notification-dispatcher');
const nowMs = Date.parse('2026-04-08T20:00:00.000Z');

function createPipelineMock(resultResolver) {
  const commands = [];
  const pipeline = {
    get: jest.fn(() => {
      commands.push('get');
      return pipeline;
    }),
    sismember: jest.fn(() => {
      commands.push('sismember');
      return pipeline;
    }),
    hmget: jest.fn(() => {
      commands.push('hmget');
      return pipeline;
    }),
    ttl: jest.fn(() => {
      commands.push('ttl');
      return pipeline;
    }),
    hget: jest.fn(() => {
      commands.push('hget');
      return pipeline;
    }),
    exec: jest.fn(async () => resultResolver(commands.join('|'))),
  };
  return pipeline;
}

function createMultiMock() {
  const multi = {
    hset: jest.fn(() => multi),
    sadd: jest.fn(() => multi),
    set: jest.fn(() => multi),
    expire: jest.fn(() => multi),
    exec: jest.fn(async () => []),
  };
  return multi;
}

describe('driver-notification-dispatcher timeout cleanup', () => {
  let redis;
  let dispatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.setSystemTime(nowMs);

    redis = {
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn().mockResolvedValue('SEARCHING'),
      hgetall: jest.fn().mockResolvedValue({}),
      hdel: jest.fn().mockResolvedValue(1),
      georadius: jest.fn().mockResolvedValue([]),
      smembers: jest.fn().mockResolvedValue([]),
      multi: jest.fn(() => createMultiMock()),
      pipeline: jest.fn(() =>
        createPipelineMock((signature) => {
          if (signature === 'get|sismember|sismember|hmget|ttl|ttl|hget') {
            return [
              [null, null],
              [null, 0],
              [null, 0],
              [null, ['true', 'true', 'online', String(nowMs), new Date(nowMs).toISOString()]],
              [null, -2],
              [null, -2],
              [null, '0'],
            ];
          }
          if (signature === 'get|sismember|ttl|hget') {
            return [
              [null, null],
              [null, 0],
              [null, -2],
              [null, '0'],
            ];
          }
          return [];
        })
      )
    };

    dispatcher = new DriverNotificationDispatcher(redis, null);
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.SEARCHING);
    driverLockManager.acquireLock.mockResolvedValue(true);
    driverLockManager.getLockedBooking.mockResolvedValue('booking_123');
    driverLockManager.releaseLock.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('releases the driver lock when the response timeout expires for the same booking', async () => {
    dispatcher.scheduleDriverTimeout('driver_1', 'booking_123', 1);

    await jest.advanceTimersByTimeAsync(1000);

    expect(redis.del).toHaveBeenCalledWith('driver_active_notification:driver_1');
    expect(driverLockManager.getLockedBooking).toHaveBeenCalledWith('driver_1');
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
    expect(redis.hset).toHaveBeenCalledWith('booking:booking_123', expect.objectContaining({
      timeoutDriverId: 'driver_1'
    }));
  });

  it('restores the booking to the previous search state when timeout expires during awaiting response', async () => {
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.AWAITING_RESPONSE);
    redis.hget.mockResolvedValue('EXPANDED');

    dispatcher.scheduleDriverTimeout('driver_1', 'booking_123', 1);

    await jest.advanceTimersByTimeAsync(1000);

    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      redis,
      'booking_123',
      RideStateManager.STATES.EXPANDED,
      expect.objectContaining({
        timeoutDriverId: 'driver_1'
      })
    );
    expect(redis.hdel).toHaveBeenCalledWith(
      'booking:booking_123',
      'awaitingResponseDriverId',
      'awaitingResponseAt'
    );
  });

  it('does not release the lock when it belongs to another booking', async () => {
    driverLockManager.getLockedBooking.mockResolvedValue('booking_other');

    dispatcher.scheduleDriverTimeout('driver_1', 'booking_123', 1);

    await jest.advanceTimersByTimeAsync(1000);

    expect(redis.del).toHaveBeenCalledWith('driver_active_notification:driver_1');
    expect(driverLockManager.releaseLock).not.toHaveBeenCalled();
  });

  it('does not notify a driver while the booking is in rejection cooldown', async () => {
    redis.pipeline.mockImplementationOnce(() =>
      createPipelineMock((signature) => {
        if (signature === 'get|sismember|sismember|hmget|ttl|ttl|hget') {
          return [
            [null, null],
            [null, 0],
            [null, 0],
            [null, ['true', 'true', 'online', String(nowMs), new Date(nowMs).toISOString()]],
            [null, -2],
            [null, 28],
            [null, '1'],
          ];
        }
        return [];
      })
    );

    dispatcher.getDispatchability = jest.fn().mockResolvedValue({
      ok: true,
      bookingData: {
        bookingId: 'booking_123',
      },
    });

    const notified = await dispatcher.notifyDriver('driver_1', 'booking_123', {
      bookingId: 'booking_123',
    });

    expect(notified).toBe(false);
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
  });

  it('does not notify a driver once the booking reached the maximum rejection count', async () => {
    redis.pipeline.mockImplementationOnce(() =>
      createPipelineMock((signature) => {
        if (signature === 'get|sismember|sismember|hmget|ttl|ttl|hget') {
          return [
            [null, null],
            [null, 0],
            [null, 0],
            [null, ['true', 'true', 'online', String(nowMs), new Date(nowMs).toISOString()]],
            [null, -2],
            [null, -2],
            [null, '2'],
          ];
        }
        return [];
      })
    );

    dispatcher.getDispatchability = jest.fn().mockResolvedValue({
      ok: true,
      bookingData: {
        bookingId: 'booking_123',
      },
    });

    const notified = await dispatcher.notifyDriver('driver_1', 'booking_123', {
      bookingId: 'booking_123',
    });

    expect(notified).toBe(false);
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
  });

  it('does not notify a driver with stale liveness in preflight', async () => {
    redis.pipeline.mockImplementationOnce(() =>
      createPipelineMock((signature) => {
        if (signature === 'get|sismember|sismember|hmget|ttl|ttl|hget') {
          const staleMs = nowMs - 120000;
          return [
            [null, null],
            [null, 0],
            [null, 0],
            [null, ['true', 'true', 'online', String(staleMs), new Date(staleMs).toISOString()]],
            [null, -2],
            [null, -2],
            [null, '0'],
          ];
        }
        return [];
      })
    );

    dispatcher.getDispatchability = jest.fn().mockResolvedValue({
      ok: true,
      bookingData: {
        bookingId: 'booking_123',
      },
    });

    const outcomeSpy = jest.fn();
    const notified = await dispatcher.notifyDriver('driver_1', 'booking_123', {
      bookingId: 'booking_123',
    }, {
      onNotificationOutcome: outcomeSpy
    });

    expect(notified).toBe(false);
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        reason: 'DRIVER_LIVENESS_STALE'
      })
    );
  });

  it('cancels a timeout scheduled by another dispatcher instance', async () => {
    const anotherDispatcher = new DriverNotificationDispatcher(redis, null);

    dispatcher.scheduleDriverTimeout('driver_1', 'booking_shared', 1);
    anotherDispatcher.cancelDriverTimeout('driver_1', 'booking_shared');

    await jest.advanceTimersByTimeAsync(1000);

    expect(redis.del).not.toHaveBeenCalledWith('driver_active_notification:driver_1');
    expect(redis.hset).not.toHaveBeenCalledWith(
      'booking:booking_shared',
      expect.objectContaining({ timeoutDriverId: 'driver_1' })
    );
  });

  it('blocks dispatch when booking status is an alternate terminal state', async () => {
    redis.hgetall = jest.fn().mockResolvedValue({
      bookingId: 'booking_review',
      customerId: 'customer_1',
      status: 'EARLY_ENDED_REVIEW',
    });
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.SEARCHING);

    const result = await dispatcher.getDispatchability('booking_review');

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'BOOKING_STATUS_BLOCKED',
      state: RideStateManager.STATES.SEARCHING,
      status: 'EARLY_ENDED_REVIEW',
    }));
  });

  it('uses canonical booking fields when caller provides a partial dispatch payload', async () => {
    redis.hgetall.mockResolvedValue({
      bookingId: 'booking_123',
      customerId: 'customer_1',
      status: 'REQUESTED',
      passengerName: 'Leaf Passageiro Teste',
      routeDistanceKm: '27.1',
      routeDurationSecs: '1920',
    });
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.SEARCHING);

    const result = await dispatcher.getDispatchability('booking_123', {
      bookingId: 'booking_123',
      customerId: 'customer_1',
      passengerName: null,
      routeDistanceKm: 16.43,
      driverDistanceToPickupKm: 0.2,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      state: RideStateManager.STATES.SEARCHING,
    }));
    expect(result.bookingData).toEqual(expect.objectContaining({
      passengerName: 'Leaf Passageiro Teste',
      routeDistanceKm: '27.1',
      routeDurationSecs: '1920',
      driverDistanceToPickupKm: 0.2,
    }));
  });

  it('emits the driver offer with canonical route metrics instead of straight-line fallback', async () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    dispatcher = new DriverNotificationDispatcher(redis, { to });
    redis.hgetall.mockResolvedValue({
      bookingId: 'booking_123',
      customerId: 'customer_1',
      status: 'REQUESTED',
      passengerName: 'Leaf Passageiro Teste',
      pickupLocation: JSON.stringify({
        lat: -22.857,
        lng: -43.309,
        add: 'Av. Meriti, 9 - Vila Kosmos',
      }),
      destinationLocation: JSON.stringify({
        lat: -22.9976583,
        lng: -43.3581268,
        add: 'Av. das Americas, 4666',
      }),
      estimatedFare: '53.67',
      routeDistanceKm: '27.1',
      routeDurationSecs: '1920',
    });

    const notified = await dispatcher.notifyDriver('driver_1', 'booking_123', {
      bookingId: 'booking_123',
      customerId: 'customer_1',
      pickupLocation: {
        lat: -22.857,
        lng: -43.309,
        add: 'Av. Meriti, 9 - Vila Kosmos',
      },
      destinationLocation: {
        lat: -22.9976583,
        lng: -43.3581268,
        add: 'Av. das Americas, 4666',
      },
      estimatedFare: 53.67,
      routeDistanceKm: 16.43,
      driverDistanceToPickupKm: 0.2,
      estimatedArrivalToPickupMin: 1,
    });

    expect(notified).toBe(true);
    expect(to).toHaveBeenCalledWith('driver_driver_1');
    expect(emit).toHaveBeenCalledWith(
      'newRideRequest',
      expect.objectContaining({
        bookingId: 'booking_123',
        passengerName: 'Leaf Passageiro Teste',
        estimatedTripDistanceKm: 27.1,
        estimatedTripDurationMin: 32,
        driverDistanceToPickupKm: 0.2,
      })
    );
  });

  it('scores nearby drivers using the booking snapshot as payment reservation context', async () => {
    redis.georadius.mockResolvedValue([
      ['driver_1', '0.2', ['-43.309', '-22.857']],
    ]);
    redis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver_1') {
        return {
          id: 'driver_1',
          isOnline: 'true',
          status: 'AVAILABLE',
          dispatchEligible: 'true',
          carType: 'Leaf Plus',
        };
      }
      return {};
    });
    dispatcher.scoreWeights.distance = 1;
    dispatcher.scoreWeights.rating = 0;
    dispatcher.scoreWeights.acceptanceRate = 0;
    dispatcher.scoreWeights.responseTime = 0;

    const result = await dispatcher.findAndScoreDrivers(
      { lat: -22.857, lng: -43.309 },
      2,
      1,
      'booking_123',
      {
        bookingData: {
          bookingId: 'booking_123',
          paymentReferenceRideId: 'temp_ride_123',
          paymentSessionId: 'pay_123',
          paymentQuoteLockId: 'ql_123',
          paymentDriverReservationId: 'pdr_123',
        }
      }
    );

    expect(result).toEqual([
      expect.objectContaining({
        driverId: 'driver_1',
        distance: 0.2,
        score: expect.any(Number),
      }),
    ]);
  });
});
