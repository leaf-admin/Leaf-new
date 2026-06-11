const {
  buildDestinationEntitlement,
  getPolicyForDriver,
  grantedQuotaForDriver,
  recordDriverDestinationDailyRideCompletion,
  resolveDestinationModeIntent
} = require('../../../services/driver-destination-mode-service');

function createRedisMock(initial = {}) {
  const hashes = new Map(Object.entries(initial).map(([key, value]) => [key, { ...value }]));

  return {
    hget: jest.fn(async (key, field) => hashes.get(key)?.[field] ?? null),
    hgetall: jest.fn(async (key) => hashes.get(key) || {}),
    hset: jest.fn(async (key, fieldOrPayload, maybeValue) => {
      const current = hashes.get(key) || {};
      if (typeof fieldOrPayload === 'string') {
        current[fieldOrPayload] = String(maybeValue);
      } else {
        Object.assign(current, fieldOrPayload);
      }
      hashes.set(key, current);
      return 1;
    }),
    hincrby: jest.fn(async (key, field, increment) => {
      const current = hashes.get(key) || {};
      const next = Number.parseInt(current[field] || '0', 10) + increment;
      current[field] = String(next);
      hashes.set(key, current);
      return next;
    }),
    sadd: jest.fn(async (key, member) => {
      const current = hashes.get(key) || { __set: new Set() };
      if (!(current.__set instanceof Set)) current.__set = new Set();
      const before = current.__set.size;
      current.__set.add(member);
      hashes.set(key, current);
      return current.__set.size > before ? 1 : 0;
    }),
    expire: jest.fn(async () => 1),
    multi: jest.fn(() => ({
      hset: jest.fn(function hset(key, payload) {
        hashes.set(key, { ...(hashes.get(key) || {}), ...payload });
        return this;
      }),
      expire: jest.fn(function expire() {
        return this;
      }),
      exec: jest.fn(async () => [])
    })),
    __hashes: hashes
  };
}

describe('driver-destination-mode-service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      ENABLE_DRIVER_DESTINATION_MODE: 'true',
      DRIVER_DESTINATION_DAILY_BASE_QUOTA: '2',
      DRIVER_DESTINATION_DAILY_MAX_QUOTA: '12',
      DRIVER_DESTINATION_BONUS_RIDE_WINDOW: '5',
      DRIVER_DESTINATION_DURATION_MINUTES: '90',
      DRIVER_DESTINATION_MIN_PROGRESS_KM: '1',
      DRIVER_DESTINATION_ARRIVAL_RADIUS_KM: '3'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('starts the day with two base destination tickets', () => {
    const entitlement = buildDestinationEntitlement(
      { destinationModeDailyCompletedTripsDay: '2026-06-11', destinationModeDailyCompletedTrips: '0' },
      { used: '0' },
      undefined,
      new Date('2026-06-11T12:00:00.000Z')
    );

    expect(entitlement).toMatchObject({
      baseDailyQuota: 2,
      dailyQuota: 2,
      usedToday: 0,
      remainingToday: 2,
      bonusReady: false,
      ridesUntilNextBonus: 5
    });
    expect(grantedQuotaForDriver({ destinationModeDailyCompletedTrips: '0' })).toBe(2);
  });

  it('unlocks one non-accumulating bonus after five daily rides', () => {
    const entitlement = buildDestinationEntitlement(
      { destinationModeDailyCompletedTripsDay: '2026-06-11', destinationModeDailyCompletedTrips: '12' },
      { used: '0', bonusAnchorTrips: '0' },
      undefined,
      new Date('2026-06-11T12:00:00.000Z')
    );

    expect(entitlement).toMatchObject({
      dailyCompletedTrips: 12,
      dailyQuota: 3,
      remainingToday: 3,
      bonusReady: true,
      bonusRemaining: 1,
      ridesUntilNextBonus: 0
    });
  });

  it('consumes one daily destination when a new active target is enabled', async () => {
    const redis = createRedisMock();
    const now = new Date('2026-06-11T12:00:00.000Z');

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: {
        destinationModeDailyCompletedTripsDay: '2026-06-11',
        destinationModeDailyCompletedTrips: '0'
      },
      isOnline: true,
      now,
      requestedMode: {
        provided: true,
        active: true,
        lat: '-22.984',
        lng: '-43.222',
        label: 'Barra da Tijuca'
      }
    });

    expect(result).toMatchObject({
      allowed: true,
      consumed: true,
      destinationMode: {
        active: true,
        label: 'Barra da Tijuca'
      },
      policy: {
        dailyQuota: 2,
        baseDailyQuota: 2,
        usedToday: 1,
        remainingToday: 1,
        durationMinutes: 90
      }
    });
    expect(result.patch).toMatchObject({
      destinationModeActive: 'true',
      destinationModeMinProgressKm: '1',
      destinationModeArrivalRadiusKm: '3'
    });
    expect(redis.hincrby).toHaveBeenCalledTimes(1);
  });

  it('does not consume quota when the same active destination is resent', async () => {
    const redis = createRedisMock();
    const now = new Date('2026-06-11T12:00:00.000Z');
    const expiresAt = '2026-06-11T13:30:00.000Z';

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: {
        destinationModeActive: 'true',
        destinationModeLat: '-22.9840001',
        destinationModeLng: '-43.2220001',
        destinationModeExpiresAt: expiresAt
      },
      isOnline: true,
      now,
      requestedMode: {
        provided: true,
        active: true,
        lat: '-22.984',
        lng: '-43.222',
        label: 'Barra da Tijuca'
      }
    });

    expect(result.allowed).toBe(true);
    expect(result.consumed).toBe(false);
    expect(result.destinationMode.expiresAt).toBe(expiresAt);
    expect(redis.hincrby).not.toHaveBeenCalled();
  });

  it('rejects activation after the daily quota is used', async () => {
    const redis = createRedisMock({
      'driver_destination_usage:driver_1:2026-06-11': {
        used: '2'
      }
    });

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: {
        destinationModeDailyCompletedTripsDay: '2026-06-11',
        destinationModeDailyCompletedTrips: '4'
      },
      isOnline: true,
      now: new Date('2026-06-11T12:00:00.000Z'),
      requestedMode: {
        provided: true,
        active: true,
        lat: '-22.984',
        lng: '-43.222'
      }
    });

    expect(result).toMatchObject({
      allowed: false,
      code: 'DRIVER_DESTINATION_DAILY_QUOTA_EXCEEDED',
      policy: {
        dailyQuota: 2,
        baseDailyQuota: 2,
        usedToday: 2,
        remainingToday: 0,
        ridesUntilNextBonus: 1
      }
    });
  });

  it('allows a bonus activation after five daily rides and resets the next bonus window', async () => {
    const redis = createRedisMock({
      'driver_destination_usage:driver_1:2026-06-11': {
        used: '2',
        bonusAnchorTrips: '0'
      }
    });

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: {
        destinationModeDailyCompletedTripsDay: '2026-06-11',
        destinationModeDailyCompletedTrips: '5'
      },
      isOnline: true,
      now: new Date('2026-06-11T12:00:00.000Z'),
      requestedMode: {
        provided: true,
        active: true,
        lat: '-22.984',
        lng: '-43.222'
      }
    });

    expect(result).toMatchObject({
      allowed: true,
      consumed: true,
      policy: {
        usedToday: 3,
        remainingToday: 0,
        dailyCompletedTrips: 5,
        bonusReady: false,
        ridesUntilNextBonus: 5
      }
    });
    expect(redis.__hashes.get('driver_destination_usage:driver_1:2026-06-11')).toMatchObject({
      used: '3',
      bonusAnchorTrips: '5'
    });
  });

  it('does not unlock another bonus until five rides after the previous bonus use', async () => {
    const redis = createRedisMock({
      'driver_destination_usage:driver_1:2026-06-11': {
        used: '3',
        bonusAnchorTrips: '5'
      }
    });

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: {
        destinationModeDailyCompletedTripsDay: '2026-06-11',
        destinationModeDailyCompletedTrips: '9'
      },
      isOnline: true,
      now: new Date('2026-06-11T12:00:00.000Z'),
      requestedMode: {
        provided: true,
        active: true,
        lat: '-22.984',
        lng: '-43.222'
      }
    });

    expect(result).toMatchObject({
      allowed: false,
      code: 'DRIVER_DESTINATION_DAILY_QUOTA_EXCEEDED',
      policy: {
        dailyCompletedTrips: 9,
        ridesUntilNextBonus: 1,
        bonusReady: false
      }
    });
  });

  it('unlocks the next bonus after five more rides when the previous bonus was consumed', async () => {
    const redis = createRedisMock({
      'driver_destination_usage:driver_1:2026-06-11': {
        used: '3',
        bonusAnchorTrips: '5'
      }
    });

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: {
        destinationModeDailyCompletedTripsDay: '2026-06-11',
        destinationModeDailyCompletedTrips: '10'
      },
      isOnline: true,
      now: new Date('2026-06-11T12:00:00.000Z'),
      requestedMode: {
        provided: true,
        active: true,
        lat: '-22.984',
        lng: '-43.222'
      }
    });

    expect(result.allowed).toBe(true);
    expect(redis.__hashes.get('driver_destination_usage:driver_1:2026-06-11')).toMatchObject({
      used: '4',
      bonusAnchorTrips: '10'
    });
  });

  it('clears an active destination when the driver goes offline without consuming quota', async () => {
    const redis = createRedisMock();

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: {
        destinationModeActive: 'true',
        destinationModeLat: '-22.984',
        destinationModeLng: '-43.222',
        destinationModeExpiresAt: '2026-06-11T13:30:00.000Z'
      },
      isOnline: false,
      now: new Date('2026-06-11T12:00:00.000Z'),
      requestedMode: {
        provided: false
      }
    });

    expect(result).toMatchObject({
      allowed: true,
      shouldWrite: true,
      consumed: false,
      destinationMode: {
        active: false
      },
      patch: {
        destinationModeActive: 'false',
        driverDestinationModeActive: 'false'
      }
    });
    expect(redis.hincrby).not.toHaveBeenCalled();
  });

  it('returns a public policy snapshot with current remaining quota', async () => {
    const redis = createRedisMock({
      'driver_destination_usage:driver_2:2026-06-11': {
        used: '1',
        bonusAnchorTrips: '0'
      }
    });

    const policy = await getPolicyForDriver({
      redis,
      driverId: 'driver_2',
      driverState: {
        destinationModeDailyCompletedTripsDay: '2026-06-11',
        destinationModeDailyCompletedTrips: '5'
      },
      now: new Date('2026-06-11T12:00:00.000Z')
    });

    expect(policy).toMatchObject({
      enabled: true,
      dailyQuota: 3,
      usedToday: 1,
      remainingToday: 2,
      bonusRideWindow: 5,
      bonusReady: true,
      durationMinutes: 90,
      minProgressKm: 1,
      arrivalRadiusKm: 3
    });
  });

  it('records completed rides for destination bonus idempotently', async () => {
    const redis = createRedisMock();
    const now = new Date('2026-06-11T12:00:00.000Z');

    const first = await recordDriverDestinationDailyRideCompletion({
      redis,
      driverId: 'driver_3',
      bookingId: 'booking_1',
      now
    });
    const duplicate = await recordDriverDestinationDailyRideCompletion({
      redis,
      driverId: 'driver_3',
      bookingId: 'booking_1',
      now
    });

    expect(first).toMatchObject({
      recorded: true,
      completedToday: 1
    });
    expect(duplicate).toMatchObject({
      recorded: false,
      reason: 'already_recorded'
    });
    expect(redis.__hashes.get('driver:driver_3')).toMatchObject({
      destinationModeDailyCompletedTrips: '1',
      destinationModeDailyCompletedTripsDay: '2026-06-11'
    });
  });
});
