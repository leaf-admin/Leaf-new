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
  getLockedBooking: jest.fn(),
  renewLock: jest.fn(),
  releaseLock: jest.fn()
}));

jest.mock('../../../services/driver-eligibility-service', () => ({
  isDriverEligibleForRide: jest.fn()
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
  ACTIVE_TRIP_TTL_SECONDS: 21600,
  activeTripKey: (driverId) => `active_trip_by_driver:${driverId}`,
  activeTripCustomerKey: (driverId) => `active_trip_customer_by_driver:${driverId}`,
  identityVerificationKey: (driverId) => `kyc:identity-verification-window:${driverId}`,
  identityPolicyMutationKey: (driverId) => `kyc:identity-policy-mutation:${driverId}`,
  activeStepUpChallengeKey: (driverId) => `kyc:stepup:active:${driverId}`
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
const driverEligibilityService = require('../../../services/driver-eligibility-service');
const eventSourcing = require('../../../services/event-sourcing');
const {
  hasOfferReservation,
  clearOfferReservationsForBooking
} = require('../../../services/offer-reservation-service');
const { writeVisibleBookingSnapshot } = require('../../../services/booking-visibility-service');
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
      hmget: jest.fn().mockResolvedValue([null, null, null, null, null, null, null]),
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
    driverLockManager.getLockedBooking.mockResolvedValue('booking_1');
    driverLockManager.renewLock.mockResolvedValue(true);
    driverLockManager.releaseLock.mockResolvedValue(true);
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE'
    });
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
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('ERR_KYC_VERIFICATION_IN_PROGRESS'),
      7,
      'booking:booking_1',
      'active_trip_by_driver:driver_1',
      'active_trip_customer_by_driver:driver_1',
      'driver:driver_1',
      'kyc:identity-verification-window:driver_1',
      'kyc:identity-policy-mutation:driver_1',
      'kyc:stepup:active:driver_1',
      'driver_1',
      'ACCEPTED',
      expect.any(String),
      expect.any(String),
      'booking_1',
      '21600'
    );
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

  it('rejects identity-verification conflict before mutating acceptance state', async () => {
    redis.eval.mockResolvedValue('ERR_KYC_VERIFICATION_IN_PROGRESS');

    const command = new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Validação de identidade em andamento');
    expect(redis.hset).not.toHaveBeenCalled();
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
    expect(clearOfferReservationsForBooking).not.toHaveBeenCalled();
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
  });

  it('rejects a persisted identity revalidation gate before mutating acceptance state', async () => {
    redis.eval.mockResolvedValue('ERR_KYC_REVERIFICATION_REQUIRED');

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Validação de identidade pendente');
    expect(redis.hset).not.toHaveBeenCalled();
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
    expect(clearOfferReservationsForBooking).not.toHaveBeenCalled();
  });

  it('rejects an active step-up challenge before mutating acceptance state', async () => {
    redis.eval.mockResolvedValue('ERR_KYC_CHALLENGE_ACTIVE');

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Validação de identidade pendente');
    expect(redis.hset).not.toHaveBeenCalled();
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
    expect(clearOfferReservationsForBooking).not.toHaveBeenCalled();
  });

  it('rejects canonical ineligibility before acquiring the ride lock', async () => {
    redis.hmget.mockResolvedValue([
      null,
      'SEARCHING',
      'PENDING',
      'leaf_plus',
      null,
      null,
      null
    ]);
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValueOnce({
      eligible: false,
      code: 'VEHICLE_NOT_APPROVED'
    });

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('não está elegível');
    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver_1',
      'leaf_plus'
    );
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('fails closed when canonical eligibility cannot be revalidated', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockRejectedValueOnce(
      new Error('eligibility unavailable')
    );

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Não foi possível validar a elegibilidade');
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('uses a fail-closed Lua guard for missing, empty or false dispatch eligibility', async () => {
    redis.eval.mockImplementation(async (script) => {
      expect(script).toContain(
        "local dispatchEligible = string.lower(tostring(redis.call('HGET', driverKey, 'dispatchEligible') or ''))"
      );
      expect(script).toContain("if dispatchEligible ~= 'true' and not alreadyOwnedBySameDriver then");
      expect(script).not.toContain("if dispatchEligible == 'false' and");
      expect(script).not.toContain('currentActiveTrip');
      return 'ERR_DRIVER_NOT_DISPATCH_ELIGIBLE';
    });

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('não está elegível');
    expect(redis.hset).not.toHaveBeenCalled();
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
    expect(clearOfferReservationsForBooking).not.toHaveBeenCalled();
  });

  it('does not let a stale active-trip index bypass KYC or dispatch gates', async () => {
    redis.eval.mockImplementation(async (script) => {
      expect(script).not.toContain('currentActiveTrip');
      expect(script).toContain(
        'if (identityVerification or identityPolicyMutation) and not alreadyOwnedBySameDriver then'
      );
      expect(script).toContain(
        "if dispatchEligible ~= 'true' and not alreadyOwnedBySameDriver then"
      );
      return 'ERR_KYC_VERIFICATION_IN_PROGRESS';
    });

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Validação de identidade em andamento');
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
  });

  it('renews and releases a same-booking lock when the CAS rejects before commit', async () => {
    driverLockManager.isDriverLocked.mockReset().mockResolvedValue({
      isLocked: true,
      bookingId: 'booking_1'
    });
    redis.eval.mockResolvedValue('ERR_INVALID_STATE_COMPLETED');

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(driverLockManager.renewLock).toHaveBeenCalledWith('driver_1', 3600);
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
  });

  it('releases an acquired lock when Redis eval throws before acceptance commit', async () => {
    redis.eval.mockRejectedValue(new Error('redis eval unavailable'));

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('redis eval unavailable');
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
  });

  it('keeps the ride lock when a secondary Redis read fails after acceptance committed', async () => {
    redis.eval.mockResolvedValue(
      'customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
    );
    redis.hgetall.mockRejectedValue(new Error('secondary read unavailable'));

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('secondary read unavailable');
    expect(driverLockManager.releaseLock).not.toHaveBeenCalled();
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
    redis.hmget.mockResolvedValue([
      'driver_1',
      'ACCEPTED',
      'ACCEPTED',
      'leaf_plus',
      null,
      null,
      null
    ]);
    redis.eval.mockImplementation(async (script, keyCount, ...args) => {
      expect(script).toContain('local alreadyOwned');
      expect(script).toContain("redis.call('SET', activeTripKey, bookingId, 'EX', activeTripTtl)");
      expect(script).toContain("'activeTripId', bookingId");
      expect(keyCount).toBe(4);
      expect(args).toEqual([
        'booking:booking_1',
        'active_trip_by_driver:driver_1',
        'active_trip_customer_by_driver:driver_1',
        'driver:driver_1',
        'driver_1',
        'booking_1',
        '21600',
        expect.any(String),
      ]);
      return 'OK_ALREADY_ACCEPTED|||customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}';
    });

    const command = new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(result.data.idempotentAccept).toBe(true);
    expect(result.data.event).toBeNull();
    expect(RideAcceptedEvent).not.toHaveBeenCalled();
    expect(driverEligibilityService.isDriverEligibleForRide).not.toHaveBeenCalled();
  });

  it('does not trust a stale idempotency snapshot to skip canonical eligibility', async () => {
    redis.hmget.mockResolvedValue([
      'driver_1',
      'ACCEPTED',
      'ACCEPTED',
      'leaf_plus',
      null,
      null,
      null
    ]);
    redis.eval
      .mockResolvedValueOnce('NOT_ALREADY_OWNED')
      .mockResolvedValueOnce(
        'customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
      );

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(true);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver_1',
      'leaf_plus'
    );
    expect(result.data.idempotentAccept).toBe(false);
  });

  it('handles concurrent same-driver acceptance idempotently only after the CAS confirms ownership', async () => {
    redis.hmget.mockResolvedValue([
      '',
      'SEARCHING',
      'PENDING',
      'leaf_plus',
      null,
      null,
      null
    ]);
    redis.eval.mockResolvedValue(
      'OK_ALREADY_ACCEPTED|||customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
    );

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(true);
    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver_1',
      'leaf_plus'
    );
    expect(result.data.idempotentAccept).toBe(true);
    expect(result.data.event).toBeNull();
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
