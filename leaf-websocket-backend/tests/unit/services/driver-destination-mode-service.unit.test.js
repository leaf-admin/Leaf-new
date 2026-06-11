const {
  getPolicyForDriver,
  grantedQuotaForDriver,
  resolveDestinationModeIntent
} = require('../../../services/driver-destination-mode-service');

function createRedisMock(initial = {}) {
  const hashes = new Map(Object.entries(initial).map(([key, value]) => [key, { ...value }]));

  return {
    hget: jest.fn(async (key, field) => hashes.get(key)?.[field] ?? null),
    hincrby: jest.fn(async (key, field, increment) => {
      const current = hashes.get(key) || {};
      const next = Number.parseInt(current[field] || '0', 10) + increment;
      current[field] = String(next);
      hashes.set(key, current);
      return next;
    }),
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
      DRIVER_DESTINATION_DAILY_MAX_QUOTA: '4',
      DRIVER_DESTINATION_EXTRA_EVERY_TRIPS: '100',
      DRIVER_DESTINATION_DURATION_MINUTES: '90',
      DRIVER_DESTINATION_MIN_PROGRESS_KM: '1',
      DRIVER_DESTINATION_ARRIVAL_RADIUS_KM: '3'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('grants quota by completed trips without exceeding the cap', () => {
    expect(grantedQuotaForDriver({ totalTrips: 0 })).toBe(2);
    expect(grantedQuotaForDriver({ totalTrips: 100 })).toBe(3);
    expect(grantedQuotaForDriver({ totalTrips: 250 })).toBe(4);
    expect(grantedQuotaForDriver({ totalTrips: 900 })).toBe(4);
  });

  it('consumes one daily destination when a new active target is enabled', async () => {
    const redis = createRedisMock();
    const now = new Date('2026-06-11T12:00:00.000Z');

    const result = await resolveDestinationModeIntent({
      redis,
      driverId: 'driver_1',
      existingDriverState: { totalTrips: '0' },
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
      existingDriverState: { totalTrips: '0' },
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
        usedToday: 2,
        remainingToday: 0
      }
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
        used: '1'
      }
    });

    const policy = await getPolicyForDriver({
      redis,
      driverId: 'driver_2',
      driverState: { totalTrips: '120' },
      now: new Date('2026-06-11T12:00:00.000Z')
    });

    expect(policy).toMatchObject({
      enabled: true,
      dailyQuota: 3,
      usedToday: 1,
      remainingToday: 2,
      durationMinutes: 90,
      minProgressKm: 1,
      arrivalRadiusKm: 3
    });
  });
});
