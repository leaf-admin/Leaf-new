jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn()
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    PENDING: 'PENDING',
    SEARCHING: 'SEARCHING',
    EXPANDED: 'EXPANDED',
    NOTIFIED: 'NOTIFIED',
    AWAITING_RESPONSE: 'AWAITING_RESPONSE',
    REASSIGNMENT_PENDING: 'REASSIGNMENT_PENDING',
    CANCELED: 'CANCELED'
  },
  getBookingState: jest.fn(),
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/event-sourcing', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined),
  EVENT_TYPES: {
    DRIVER_SEARCH_STARTED: 'DRIVER_SEARCH_STARTED',
    RADIUS_EXPANDED: 'RADIUS_EXPANDED'
  }
}));

jest.mock('../../../services/metrics-collector', () => ({
  recordRadiusExpansion: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/ride-queue-manager', () => ({
  dequeueRide: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-lock-manager', () => ({}));

const mockNotifyMultipleDrivers = jest.fn().mockResolvedValue({ notified: 1 });
const mockClearAllTimeouts = jest.fn();
const mockFindAndScoreDrivers = jest.fn().mockResolvedValue([]);

jest.mock('../../../services/driver-notification-dispatcher', () => {
  return jest.fn().mockImplementation(() => ({
    notifyMultipleDrivers: mockNotifyMultipleDrivers,
    clearAllTimeouts: mockClearAllTimeouts,
    findAndScoreDrivers: mockFindAndScoreDrivers
  }));
});

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const redisPool = require('../../../utils/redis-pool');
const RideStateManager = require('../../../services/ride-state-manager');
const eventSourcing = require('../../../services/event-sourcing');
const GradualRadiusExpander = require('../../../services/gradual-radius-expander');

describe('gradual-radius-expander', () => {
  let redis;
  let expander;
  let io;
  let roomEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    delete process.env.MATCH_EMPTY_WAVE_INTERVAL_MS;
    delete process.env.MATCH_EXPANSION_STEP_KM;
    delete process.env.MATCH_MINIMUM_SEARCH_DURATION_MS;
    delete process.env.MATCH_MAX_RADIUS_RETRY_INTERVAL_MS;
    delete process.env.MATCH_RESPONSE_PAUSE_MIN_UNIQUE_DRIVERS;

    redis = {
      hgetall: jest.fn(async (key) => {
        if (key.startsWith('booking_search:')) {
          return {};
        }
        if (key.startsWith('booking:')) {
          return {
            customerId: 'customer_1',
            status: 'SEARCHING',
            pickupLocation: JSON.stringify({ lat: -23.55, lng: -46.63 }),
            destinationLocation: JSON.stringify({ lat: -23.56, lng: -46.64 }),
            estimatedFare: '25.5',
            paymentMethod: 'pix'
          };
        }
        return {};
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      georadius: jest.fn().mockResolvedValue(['driver_1']),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      scard: jest.fn().mockResolvedValue(1)
    };

    roomEmitter = {
      emit: jest.fn()
    };
    io = {
      to: jest.fn(() => roomEmitter)
    };

    redisPool.getConnection.mockReturnValue(redis);
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.SEARCHING);

    expander = new GradualRadiusExpander(io);
  });

  it('does not restart search while the booking is waiting for driver response', async () => {
    RideStateManager.getBookingState
      .mockResolvedValueOnce(RideStateManager.STATES.NOTIFIED)
      .mockResolvedValue(RideStateManager.STATES.NOTIFIED);

    const searchSpy = jest.spyOn(expander, 'searchAndNotify');
    const eligibleSpy = jest.spyOn(expander, 'hasEligibleDriversNearby');

    await expander.startGradualSearch('booking_1', { lat: -23.55, lng: -46.63 });

    expect(searchSpy).not.toHaveBeenCalled();
    expect(eligibleSpy).not.toHaveBeenCalled();
    expect(eventSourcing.recordEvent).not.toHaveBeenCalledWith(
      'DRIVER_SEARCH_STARTED',
      expect.anything()
    );
  });

  it('waits the configured driver response window before scheduling the next wave', async () => {
    jest.spyOn(expander, 'hasEligibleDriversNearby').mockResolvedValue(true);
    jest.spyOn(expander, 'searchAndNotify').mockResolvedValue({ notified: 1, total: 1 });
    const scheduleSpy = jest
      .spyOn(expander, 'scheduleNextExpansion')
      .mockImplementation(() => {});

    await expander.startGradualSearch('booking_2', { lat: -23.55, lng: -46.63 });

    expect(scheduleSpy).toHaveBeenCalledWith(
      'booking_2',
      { lat: -23.55, lng: -46.63 },
      expander.config.initialRadius + expander.config.expansionStep,
      expander.config.maxRadius,
      expander.config.driverResponseWaitMs,
      expander.config.driversPerWave
    );
  });

  it('does not pause after the first wave when the unique notified driver minimum was not reached yet', async () => {
    process.env.MATCH_RESPONSE_PAUSE_MIN_UNIQUE_DRIVERS = '3';
    expander = new GradualRadiusExpander(io);
    redis.scard.mockResolvedValue(2);

    jest.spyOn(expander, 'hasEligibleDriversNearby').mockResolvedValue(true);
    jest.spyOn(expander, 'searchAndNotify').mockResolvedValue({ notified: 2, total: 2 });
    const scheduleSpy = jest
      .spyOn(expander, 'scheduleNextExpansion')
      .mockImplementation(() => {});

    await expander.startGradualSearch('booking_2b', { lat: -23.55, lng: -46.63 });

    expect(scheduleSpy).toHaveBeenCalledWith(
      'booking_2b',
      { lat: -23.55, lng: -46.63 },
      expander.config.initialRadius + expander.config.expansionStep,
      expander.config.maxRadius,
      expander.config.expansionInterval,
      expander.config.driversPerWave
    );
  });

  it('keeps expanding while awaiting response until the minimum unique notified drivers is reached', async () => {
    jest.useFakeTimers();
    process.env.MATCH_RESPONSE_PAUSE_MIN_UNIQUE_DRIVERS = '3';
    expander = new GradualRadiusExpander(io);
    redis.scard.mockResolvedValue(2);

    const originalSchedule = expander.scheduleNextExpansion.bind(expander);
    const searchSpy = jest.spyOn(expander, 'searchAndNotify').mockResolvedValue({ notified: 1, total: 1 });
    const scheduleSpy = jest
      .spyOn(expander, 'scheduleNextExpansion')
      .mockImplementation((bookingId, pickupLocation, nextRadius, maxRadius, interval, limit) => {
        if (interval === 500) {
          return originalSchedule(bookingId, pickupLocation, nextRadius, maxRadius, interval, limit);
        }
        return undefined;
      });

    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.AWAITING_RESPONSE);
    jest.spyOn(expander, 'getSearchDispatchability').mockResolvedValue({
      ok: true,
      state: RideStateManager.STATES.AWAITING_RESPONSE,
      bookingData: {
        customerId: 'customer_1',
        status: 'SEARCHING',
        pickupLocation: JSON.stringify({ lat: -23.55, lng: -46.63 }),
        destinationLocation: JSON.stringify({ lat: -23.56, lng: -46.64 }),
        estimatedFare: '25.5',
        paymentMethod: 'pix'
      }
    });

    expander.scheduleNextExpansion(
      'booking_continue',
      { lat: -23.55, lng: -46.63 },
      2,
      5,
      500,
      3
    );

    await jest.runOnlyPendingTimersAsync();

    expect(searchSpy).toHaveBeenCalledWith(
      'booking_continue',
      { lat: -23.55, lng: -46.63 },
      2,
      3
    );
    expect(scheduleSpy).toHaveBeenCalledWith(
      'booking_continue',
      { lat: -23.55, lng: -46.63 },
      2 + expander.config.expansionStep,
      5,
      500,
      3
    );
  });

  it('uses the configured empty wave interval when a radius returns no eligible drivers', async () => {
    jest.useFakeTimers();
    process.env.MATCH_EMPTY_WAVE_INTERVAL_MS = '1500';
    process.env.MATCH_EXPANSION_STEP_KM = '1';
    expander = new GradualRadiusExpander(io);

    jest.spyOn(expander, 'getSearchDispatchability').mockResolvedValue({
      ok: true,
      bookingData: {
        customerId: 'customer_1',
        status: 'SEARCHING',
        pickupLocation: JSON.stringify({ lat: -23.55, lng: -46.63 }),
        destinationLocation: JSON.stringify({ lat: -23.56, lng: -46.64 }),
        estimatedFare: '25.5',
        paymentMethod: 'pix'
      }
    });
    jest.spyOn(expander, 'searchAndNotify').mockResolvedValue({ notified: 0, total: 0 });

    const originalSchedule = expander.scheduleNextExpansion.bind(expander);
    const scheduleSpy = jest
      .spyOn(expander, 'scheduleNextExpansion')
      .mockImplementation((bookingId, pickupLocation, nextRadius, maxRadius, interval, limit) => {
        if (nextRadius === 2) {
          return originalSchedule(bookingId, pickupLocation, nextRadius, maxRadius, interval, limit);
        }
        return undefined;
      });

    expander.scheduleNextExpansion(
      'booking_3',
      { lat: -23.55, lng: -46.63 },
      2,
      5,
      500,
      1
    );

    await jest.runOnlyPendingTimersAsync();

    expect(scheduleSpy).toHaveBeenCalledWith(
      'booking_3',
      { lat: -23.55, lng: -46.63 },
      3,
      5,
      1500,
      1
    );
  });

  it('pauses the next wave while a notified driver is still within the response window', async () => {
    jest.useFakeTimers();
    const originalSchedule = expander.scheduleNextExpansion.bind(expander);
    const scheduleSpy = jest
      .spyOn(expander, 'scheduleNextExpansion')
      .mockImplementation((bookingId, pickupLocation, nextRadius, maxRadius, interval, limit) => {
        if (interval === 500) {
          return originalSchedule(bookingId, pickupLocation, nextRadius, maxRadius, interval, limit);
        }
        return undefined;
      });

    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.AWAITING_RESPONSE);

    expander.scheduleNextExpansion(
      'booking_pause',
      { lat: -23.55, lng: -46.63 },
      2,
      5,
      500,
      1
    );

    await jest.runOnlyPendingTimersAsync();

    expect(scheduleSpy).toHaveBeenCalledWith(
      'booking_pause',
      { lat: -23.55, lng: -46.63 },
      2,
      5,
      expander.config.driverResponseWaitMs,
      1
    );
  });

  it('keeps the booking open during the configured search window before emitting noDriversFound', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    process.env.MATCH_MINIMUM_SEARCH_DURATION_MS = '3000';
    process.env.MATCH_MAX_RADIUS_RETRY_INTERVAL_MS = '1000';
    expander = new GradualRadiusExpander(io);

    const searchSpy = jest.spyOn(expander, 'searchAndNotify').mockResolvedValue({ notified: 0, total: 0 });

    await expander.handleMaxRadiusReached('booking_4', {
      searchedRadius: 5,
      pickupLocation: { lat: -23.55, lng: -46.63 },
      searchStartedAt: Date.now() - 500,
      limit: 1
    });

    expect(roomEmitter.emit).not.toHaveBeenCalledWith(
      'noDriversFound',
      expect.anything()
    );

    await jest.advanceTimersByTimeAsync(1000);
    expect(searchSpy).toHaveBeenCalledWith(
      'booking_4',
      { lat: -23.55, lng: -46.63 },
      5,
      1
    );
    expect(roomEmitter.emit).not.toHaveBeenCalledWith(
      'noDriversFound',
      expect.anything()
    );

    await jest.advanceTimersByTimeAsync(3000);

    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'noDriversFound',
      expect.objectContaining({
        bookingId: 'booking_4',
        code: 'NO_DRIVERS_AVAILABLE'
      })
    );
  });

  it('does not emit noDriversFound while a driver offer is still awaiting response', async () => {
    jest.useFakeTimers();
    RideStateManager.getBookingState.mockResolvedValue(RideStateManager.STATES.AWAITING_RESPONSE);
    const scheduleSpy = jest.spyOn(expander, 'scheduleBookingTimeout');

    await expander.handleMaxRadiusReached('booking_awaiting', {
      searchedRadius: 5,
      pickupLocation: { lat: -23.55, lng: -46.63 },
      limit: 1
    });

    expect(roomEmitter.emit).not.toHaveBeenCalledWith(
      'noDriversFound',
      expect.anything()
    );
    expect(scheduleSpy).toHaveBeenCalledWith(
      'booking_awaiting',
      expander.config.driverResponseWaitMs,
      expect.any(Function)
    );
  });

  it('keeps an active customer search untouched before the canonical deadline', async () => {
    process.env.MATCH_MINIMUM_SEARCH_DURATION_MS = '3000';
    expander = new GradualRadiusExpander(io);
    expander.config.driverResponseWaitMs = 1000;

    redis.get.mockImplementation(async (key) => (
      key === 'customer_active_booking:customer_1' ? 'booking_4' : null
    ));
    redis.hgetall.mockImplementation(async (key) => {
      if (key === 'booking_search:booking_4') {
        return {
          createdAt: '2026-01-01T00:00:01.000Z',
          state: 'SEARCHING'
        };
      }
      if (key === 'booking:booking_4') {
        return {
          customerId: 'customer_1',
          status: 'SEARCHING',
          pickupLocation: JSON.stringify({ lat: -23.55, lng: -46.63 })
        };
      }
      return {};
    });
    const finalizeSpy = jest.spyOn(expander, 'handleMaxRadiusReached');

    const result = await expander.reconcileExpiredSearchForCustomer(
      'customer_1',
      { nowMs: Date.parse('2026-01-01T00:00:03.500Z') }
    );

    expect(result).toEqual(expect.objectContaining({
      reconciled: false,
      reason: 'SEARCH_WINDOW_ACTIVE',
      remainingMs: 500
    }));
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it('reconciles a persisted customer search after the deadline without relying on an in-memory timer', async () => {
    process.env.MATCH_MINIMUM_SEARCH_DURATION_MS = '3000';
    expander = new GradualRadiusExpander(io);
    expander.config.driverResponseWaitMs = 1000;

    redis.get.mockImplementation(async (key) => (
      key === 'customer_active_booking:customer_1' ? 'booking_4' : null
    ));
    redis.hgetall.mockImplementation(async (key) => {
      if (key === 'booking_search:booking_4') {
        return {
          createdAt: '2026-01-01T00:00:01.000Z',
          state: 'SEARCHING'
        };
      }
      if (key === 'booking:booking_4') {
        return {
          customerId: 'customer_1',
          status: 'SEARCHING',
          pickupLocation: JSON.stringify({ lat: -23.55, lng: -46.63 })
        };
      }
      return {};
    });
    const finalizeSpy = jest
      .spyOn(expander, 'handleMaxRadiusReached')
      .mockResolvedValue(undefined);

    const result = await expander.reconcileExpiredSearchForCustomer(
      'customer_1',
      { nowMs: Date.parse('2026-01-01T00:00:05.000Z') }
    );

    expect(result).toEqual(expect.objectContaining({
      reconciled: true,
      bookingId: 'booking_4',
      forceFinalize: true
    }));
    expect(finalizeSpy).toHaveBeenCalledWith(
      'booking_4',
      expect.objectContaining({
        reason: 'SEARCH_TIMEOUT',
        skipMinimumSearchDuration: true,
        forceFinalize: true
      })
    );
  });

  it('never expires a booking that already has a driver assigned', async () => {
    redis.get.mockResolvedValue('booking_assigned');
    redis.hgetall.mockResolvedValue({
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'SEARCHING',
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    const finalizeSpy = jest.spyOn(expander, 'handleMaxRadiusReached');

    const result = await expander.reconcileExpiredSearchForCustomer(
      'customer_1',
      { nowMs: Date.parse('2026-01-01T00:10:00.000Z') }
    );

    expect(result).toEqual(expect.objectContaining({
      reconciled: false,
      reason: 'DRIVER_ALREADY_ASSIGNED'
    }));
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it('clears a stale customer active index that points to a terminal no-driver booking', async () => {
    redis.get.mockResolvedValue('booking_terminal');
    redis.hgetall.mockResolvedValue({
      customerId: 'customer_1',
      status: 'NO_DRIVERS_AVAILABLE',
      noDriversFoundReason: 'NO_ELIGIBLE_DRIVERS_IN_REGION'
    });

    const result = await expander.reconcileExpiredSearchForCustomer('customer_1');

    expect(result).toEqual(expect.objectContaining({
      reconciled: true,
      reason: 'TERMINAL_ACTIVE_INDEX_CLEARED',
      bookingId: 'booking_terminal'
    }));
    expect(redis.del).toHaveBeenCalledWith('customer_active_booking:customer_1');
  });
});
