const {
  ACTIVE_TRIP_TTL_SECONDS,
  ACTIVE_TRIP_RENEWAL_WRITE_THRESHOLD_SECONDS,
  ACTIVE_TRIP_LEASE_UNTIL_FIELD,
  IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
  IDENTITY_POLICY_MUTATION_TTL_SECONDS,
  setActiveTripForDriver,
  renewActiveTripForDriver,
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
      hgetall: jest.fn().mockResolvedValue({
        driverId: 'driver-1',
        status: 'IN_PROGRESS'
      }),
      set: jest.fn(),
      hset: jest.fn(),
      hdel: jest.fn()
    }
  };
}

describe('active-trip-index', () => {
  test('uses a 24-hour active-trip lease', () => {
    expect(ACTIVE_TRIP_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  test('setActiveTripForDriver should write trip and customer indexes', async () => {
    const { redis } = createRedisMock();

    const result = await setActiveTripForDriver(redis, 'driver-1', 'booking-1', 'customer-1');

    expect(result).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('identity_reverification_pending_after_trip'),
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

  test('setActiveTripForDriver never overwrites a different active-trip lease', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(-3);

    await expect(setActiveTripForDriver(
      redis,
      'driver-conflict',
      'booking-new',
      'customer-1'
    )).rejects.toMatchObject({ code: 'ACTIVE_TRIP_CONFLICT' });
    expect(redis.eval.mock.calls[0][0]).toContain('currentTrip ~= ARGV[1]');
  });

  test('renewActiveTripForDriver renews only a backend-confirmed matching booking', async () => {
    const { redis } = createRedisMock();

    await expect(renewActiveTripForDriver(
      redis,
      'driver-1',
      'booking-1'
    )).resolves.toBe(true);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringMatching(/indexedTrip[\s\S]*bookingDriverId[\s\S]*IN_PROGRESS[\s\S]*remainingIndexTtl/),
      4,
      'active_trip_by_driver:driver-1',
      'active_trip_customer_by_driver:driver-1',
      'driver:driver-1',
      'booking:booking-1',
      'booking-1',
      'driver-1',
      String(ACTIVE_TRIP_TTL_SECONDS),
      expect.any(String),
      String(ACTIVE_TRIP_RENEWAL_WRITE_THRESHOLD_SECONDS)
    );
  });

  test('renewActiveTripForDriver fails closed on booking or ownership mismatch', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(-1);

    await expect(renewActiveTripForDriver(
      redis,
      'driver-1',
      'booking-stale'
    )).resolves.toBe(false);
  });

  test('renewal always performs a Redis CAS and never masks a different booking binding', async () => {
    const { redis } = createRedisMock();
    redis.hgetall.mockImplementation(async (key) => ({
      bookingId: key.replace('booking:', ''),
      driverId: 'driver-throttled',
      status: 'IN_PROGRESS'
    }));
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(-1);

    await expect(renewActiveTripForDriver(
      redis,
      'driver-throttled',
      'booking-1'
    )).resolves.toBe(true);
    await expect(renewActiveTripForDriver(
      redis,
      'driver-throttled',
      'booking-1'
    )).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledTimes(2);

    await expect(renewActiveTripForDriver(
      redis,
      'driver-throttled',
      'booking-2'
    )).resolves.toBe(false);
    expect(redis.eval).toHaveBeenCalledTimes(3);
  });

  test('renewal result 2 is a positive CAS without a lease rewrite', async () => {
    const { redis } = createRedisMock();
    redis.hgetall.mockResolvedValue({
      bookingId: 'booking-clear-cache',
      driverId: 'driver-clear-cache',
      status: 'IN_PROGRESS'
    });
    redis.eval.mockResolvedValue(1);
    redis.eval.mockResolvedValueOnce(2);

    await expect(renewActiveTripForDriver(
      redis,
      'driver-clear-cache',
      'booking-clear-cache'
    )).resolves.toBe(true);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0][0]).toContain(`remainingHashLeaseMs > (tonumber(ARGV[5]) * 1000)`);
  });

  test('renewActiveTripForDriver rejects invalid lease bindings before Redis', async () => {
    const { redis } = createRedisMock();

    await expect(renewActiveTripForDriver(redis, 'driver-1', null))
      .rejects.toMatchObject({ code: 'ACTIVE_TRIP_LEASE_BINDING_INVALID' });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  test('clearActiveTripForDriver should not clear when expected trip differs', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(0);

    const result = await clearActiveTripForDriver(redis, 'driver-1', 'booking-1');

    expect(result).toBe(false);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('tostring(currentTrip) ~= tostring(ARGV[1])'),
      3,
      'active_trip_by_driver:driver-1',
      'active_trip_customer_by_driver:driver-1',
      'driver:driver-1',
      'booking-1'
    );
    expect(redis.multi).not.toHaveBeenCalled();
  });

  test('clearActiveTripForDriver compares and clears the expected trip in one Lua operation', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(1);

    await expect(clearActiveTripForDriver(redis, 'driver-1', 'booking-1'))
      .resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.multi).not.toHaveBeenCalled();
  });

  test('clearActiveTripForDriver treats an already absent expected trip as safe for post-trip work', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(2);

    await expect(clearActiveTripForDriver(redis, 'driver-1', 'booking-finished'))
      .resolves.toBe(true);
  });

  test('resolveActiveTripForDriver should return trip/customer pair', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(['booking-1', 'customer-1']);

    const resolved = await resolveActiveTripForDriver(redis, 'driver-1');

    expect(resolved).toEqual({
      tripId: 'booking-1',
      customerId: 'customer-1'
    });
  });

  test('resolveActiveTripForDriver accepts only the Lua-validated hash lease fallback', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(['booking-from-hash', 'customer-1']);

    await expect(resolveActiveTripForDriver(redis, 'driver-1')).resolves.toEqual({
      tripId: 'booking-from-hash',
      customerId: 'customer-1'
    });
    expect(redis.eval.mock.calls[0][0]).toContain(ACTIVE_TRIP_LEASE_UNTIL_FIELD);
    expect(redis.eval.mock.calls[0][0]).toContain('hashedLeaseUntilMs > nowMs');
  });

  test('resolveActiveTripForDriver rejects an expired hash fallback', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce(['', '']);

    await expect(resolveActiveTripForDriver(redis, 'driver-1')).resolves.toEqual({
      tripId: null,
      customerId: null
    });
    expect(redis.get).not.toHaveBeenCalled();
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

  test('existingOnly never creates a missing identity verification window', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce([-3, '']);

    const result = await claimIdentityVerificationWindow(
      redis,
      'driver-continuation',
      'token-existing',
      IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
      { existingOnly: true }
    );

    expect(result).toEqual(expect.objectContaining({
      acquired: false,
      reused: false,
      missing: true
    }));
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('ARGV[3] == "1"'),
      5,
      'active_trip_by_driver:driver-continuation',
      'kyc:identity-verification-window:driver-continuation',
      'driver:driver-continuation',
      'kyc:identity-policy-mutation:driver-continuation',
      'leaf:runtime:critical-dataset:generation',
      'token-existing',
      String(IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS),
      '1',
      ''
    );
  });

  test('new identity verification claim fails when dataset generation changes inside Lua', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce([-4, '']);

    await expect(claimIdentityVerificationWindow(
      redis,
      'driver-quarantined',
      'token-new',
      IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
      {
        requiredDatasetGeneration: 'generation-rc1',
        datasetGenerationKey: 'leaf:runtime:critical-dataset:generation'
      }
    )).rejects.toMatchObject({
      code: 'REDIS_CRITICAL_AUTHORITY_NOT_READY',
      statusCode: 503,
      retryable: true
    });
  });

  test('existingOnly atomically renews the exact persisted token', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce([2, '']);

    await expect(claimIdentityVerificationWindow(
      redis,
      'driver-continuation',
      'token-existing',
      IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
      { existingOnly: true }
    )).resolves.toEqual(expect.objectContaining({
      acquired: true,
      reused: true,
      missing: false,
      token: 'token-existing'
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
      5,
      'active_trip_by_driver:driver-active',
      'kyc:identity-policy-mutation:driver-active',
      'driver:driver-active',
      'kyc:identity-verification-window:driver-active',
      'leaf:runtime:critical-dataset:generation',
      'policy-token-1',
      String(IDENTITY_POLICY_MUTATION_TTL_SECONDS),
      ''
    );
  });

  test('new policy mutation fails when dataset generation changes inside Lua', async () => {
    const { redis } = createRedisMock();
    redis.eval.mockResolvedValueOnce([-3, '']);

    await expect(claimIdentityPolicyMutationWindow(
      redis,
      'driver-policy-quarantined',
      'policy-token-new',
      IDENTITY_POLICY_MUTATION_TTL_SECONDS,
      { requiredDatasetGeneration: 'generation-rc1' }
    )).rejects.toMatchObject({
      code: 'REDIS_CRITICAL_AUTHORITY_NOT_READY',
      statusCode: 503,
      retryable: true
    });
  });

  test('identity verification and policy mutation windows are mutually exclusive', async () => {
    const verificationHarness = createRedisMock();
    verificationHarness.redis.eval.mockResolvedValueOnce([-2, '']);
    await expect(claimIdentityVerificationWindow(
      verificationHarness.redis,
      'driver-policy-busy',
      'verify-token'
    )).resolves.toEqual(expect.objectContaining({
      acquired: false,
      busy: true,
      policyMutationBusy: true
    }));

    const policyHarness = createRedisMock();
    policyHarness.redis.eval.mockResolvedValueOnce([-2, '']);
    await expect(claimIdentityPolicyMutationWindow(
      policyHarness.redis,
      'driver-verify-busy',
      'policy-token'
    )).resolves.toEqual(expect.objectContaining({
      acquired: false,
      busy: true,
      verificationBusy: true
    }));
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
