const {
  ACTIVE_TRIP_TTL_SECONDS,
  IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
  IDENTITY_POLICY_MUTATION_TTL_SECONDS,
  setActiveTripForDriver,
  clearActiveTripForDriver,
  resolveActiveTripForDriver,
  claimIdentityVerificationWindow,
  claimIdentityPolicyMutationWindow,
  renewIdentityVerificationWindow,
  releaseIdentityVerificationWindow,
  releaseIdentityPolicyMutationWindow
} = require('../../../utils/active-trip-index');

function createRedisMock() {
  const tx = {
    set: jest.fn().mockReturnThis(),
    hset: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    hdel: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(true)
  };

  return {
    tx,
    redis: {
      multi: jest.fn(() => tx),
      eval: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      hget: jest.fn(),
      set: jest.fn(),
      hset: jest.fn(),
      hdel: jest.fn()
    }
  };
}

describe('active-trip-index', () => {
  test('setActiveTripForDriver should write trip and customer indexes', async () => {
    const { redis } = createRedisMock();

    const result = await setActiveTripForDriver(redis, 'driver-1', 'booking-1', 'customer-1');

    expect(result).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('verification'),
      6,
      'active_trip_by_driver:driver-1',
      'active_trip_customer_by_driver:driver-1',
      'driver:driver-1',
      'kyc:identity-verification-window:driver-1',
      'kyc:identity-policy-mutation:driver-1',
      'kyc:stepup:active:driver-1',
      'booking-1',
      'customer-1',
      String(ACTIVE_TRIP_TTL_SECONDS),
      expect.any(String)
    );
  });

  test('setActiveTripForDriver blocks a new ride while identity verification owns the driver window', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(0);

    await expect(setActiveTripForDriver(redis, 'driver-locked', 'booking-new', 'customer-1'))
      .rejects.toMatchObject({ code: 'KYC_VERIFICATION_IN_PROGRESS' });
  });

  test('setActiveTripForDriver blocks a new ride when a revalidation gate is already persisted', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(-1);

    await expect(setActiveTripForDriver(redis, 'driver-gated', 'booking-new', 'customer-1'))
      .rejects.toMatchObject({ code: 'KYC_REVERIFICATION_REQUIRED' });
  });

  test('setActiveTripForDriver blocks a new ride while a step-up challenge is active', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(-2);

    await expect(setActiveTripForDriver(redis, 'driver-challenged', 'booking-new', 'customer-1'))
      .rejects.toMatchObject({ code: 'KYC_CHALLENGE_ACTIVE' });
  });

  test('clearActiveTripForDriver should not clear when expected trip differs', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(0);

    const result = await clearActiveTripForDriver(redis, 'driver-1', 'booking-1');

    expect(result).toBe(false);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('tostring(current) ~= tostring(ARGV[1])'),
      6,
      'active_trip_by_driver:driver-1',
      'active_trip_customer_by_driver:driver-1',
      'driver:driver-1',
      'driver_locations_eligible',
      'driver_locations',
      'online_drivers',
      'booking-1',
      'driver-1'
    );
    expect(redis.multi).not.toHaveBeenCalled();
  });

  test('clearActiveTripForDriver atomically applies a deferred vehicle offline after clearing the expected trip', async () => {
    const { redis } = createRedisMock();
    const previousEligibleGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY;
    process.env.ELIGIBLE_DRIVER_GEO_KEY = 'custom_driver_locations_eligible';
    redis.eval.mockResolvedValueOnce(1);

    try {
      await expect(clearActiveTripForDriver(redis, 'driver-1', 'booking-1'))
        .resolves.toBe(true);
    } finally {
      if (previousEligibleGeoKey === undefined) {
        delete process.env.ELIGIBLE_DRIVER_GEO_KEY;
      } else {
        process.env.ELIGIBLE_DRIVER_GEO_KEY = previousEligibleGeoKey;
      }
    }

    const [script] = redis.eval.mock.calls[0];
    expect(script).toContain('redis.call("hget", KEYS[3], "vehicleOfflinePendingAfterTrip")');
    expect(script).toContain('if deferredOffline == "true" then');
    expect(script).toContain(
      'redis.call("hset", KEYS[3], "status", "OFFLINE", "isOnline", "false", "dispatchEligible", "false")'
    );
    expect(script).toContain(
      'redis.call("hdel", KEYS[3], "vehicleOfflinePendingAfterTrip", "vehicleOfflineDeferredReason")'
    );
    expect(script).toContain('redis.call("zrem", KEYS[4], ARGV[2])');
    expect(script).toContain('redis.call("zrem", KEYS[5], ARGV[2])');
    expect(script).toContain('redis.call("srem", KEYS[6], ARGV[2])');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      6,
      'active_trip_by_driver:driver-1',
      'active_trip_customer_by_driver:driver-1',
      'driver:driver-1',
      'custom_driver_locations_eligible',
      'driver_locations',
      'online_drivers',
      'booking-1',
      'driver-1'
    );
  });

  test('clearActiveTripForDriver preserves the normal clear path when no deferred vehicle offline is pending', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(1);

    await expect(clearActiveTripForDriver(redis, 'driver-1', 'booking-1'))
      .resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.multi).not.toHaveBeenCalled();

    const [script] = redis.eval.mock.calls[0];
    expect(script).toContain('if deferredOffline == "true" then');
    expect(script).toContain('end; if expectedTripAbsent then return 2 end; return 1');
    expect(script.indexOf('tostring(current) ~= tostring(ARGV[1])'))
      .toBeLessThan(script.indexOf('vehicleOfflinePendingAfterTrip'));
  });

  test('clearActiveTripForDriver consumes deferred offline before treating an absent expected trip as safe', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(2);

    await expect(clearActiveTripForDriver(redis, 'driver-1', 'booking-finished'))
      .resolves.toBe(true);

    const [script] = redis.eval.mock.calls[0];
    expect(script).not.toContain('not current then return 2');
    expect(script).toContain(
      'if ARGV[1] ~= "" and current and tostring(current) ~= tostring(ARGV[1]) then return 0 end'
    );
    expect(script.indexOf('vehicleOfflinePendingAfterTrip'))
      .toBeLessThan(script.indexOf('if expectedTripAbsent then return 2 end'));
  });

  test('resolveActiveTripForDriver should return trip/customer pair', async () => {
    const { redis } = createRedisMock();
    redis.get
      .mockResolvedValueOnce('booking-1')
      .mockResolvedValueOnce('customer-1');

    const resolved = await resolveActiveTripForDriver(redis, 'driver-1');

    expect(resolved).toEqual({
      tripId: 'booking-1',
      customerId: 'customer-1'
    });
  });

  test('resolveActiveTripForDriver fails closed to the driver hash when the TTL index is absent', async () => {
    const { redis } = createRedisMock();
    redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce('customer-1');
    redis.hget.mockResolvedValueOnce('booking-from-hash');

    await expect(resolveActiveTripForDriver(redis, 'driver-1')).resolves.toEqual({
      tripId: 'booking-from-hash',
      customerId: 'customer-1'
    });
  });

  test('claimIdentityVerificationWindow atomically refuses an active trip', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce([0, 'booking-active']);

    const result = await claimIdentityVerificationWindow(
      redis,
      'driver-active',
      'token-1'
    );

    expect(result).toEqual(expect.objectContaining({
      acquired: false,
      busy: false,
      activeTripId: 'booking-active',
      ttlSeconds: IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS
    }));
  });

  test('releaseIdentityVerificationWindow deletes only the matching token through Lua', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(1);

    await expect(releaseIdentityVerificationWindow(redis, {
      key: 'kyc:identity-verification-window:driver-1',
      token: 'token-1'
    })).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('ARGV[1]'),
      1,
      'kyc:identity-verification-window:driver-1',
      'token-1'
    );
  });

  test('claimIdentityPolicyMutationWindow atomically refuses an active trip', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce([0, 'booking-active']);

    const result = await claimIdentityPolicyMutationWindow(
      redis,
      'driver-active',
      'policy-token-1'
    );

    expect(result).toEqual(expect.objectContaining({
      acquired: false,
      busy: false,
      activeTripId: 'booking-active',
      ttlSeconds: IDENTITY_POLICY_MUTATION_TTL_SECONDS
    }));
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('activeTripId'),
      3,
      'active_trip_by_driver:driver-active',
      'kyc:identity-policy-mutation:driver-active',
      'driver:driver-active',
      'policy-token-1',
      String(IDENTITY_POLICY_MUTATION_TTL_SECONDS)
    );
  });

  test('releaseIdentityPolicyMutationWindow is token-safe', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(1);

    await expect(releaseIdentityPolicyMutationWindow(redis, {
      key: 'kyc:identity-policy-mutation:driver-1',
      token: 'policy-token-1'
    })).resolves.toBe(true);
  });

  test('renewIdentityVerificationWindow extends only the matching token through Lua', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(1);

    await expect(renewIdentityVerificationWindow(redis, {
      key: 'kyc:identity-verification-window:driver-1',
      token: 'token-1',
      ttlSeconds: 900
    })).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('expire'),
      1,
      'kyc:identity-verification-window:driver-1',
      'token-1',
      '900'
    );
  });
});
