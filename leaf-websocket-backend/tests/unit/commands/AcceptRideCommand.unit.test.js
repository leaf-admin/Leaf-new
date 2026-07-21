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
  ACTIVE_TRIP_TTL_SECONDS: 21600,
  ACTIVE_TRIP_LEASE_UNTIL_FIELD: 'activeTripLeaseUntilMs',
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
  getOfferReservationKey: (bookingId, driverId) => `offer_reservation:${bookingId}:${driverId}`,
  clearOfferReservationsForBooking: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/redis-critical-authority-service', () => ({
  assertReady: jest.fn().mockResolvedValue({ ready: true })
}));

const RideAcceptedEvent = require('../../../events/ride.accepted');
const redisPool = require('../../../utils/redis-pool');
const driverLockManager = require('../../../services/driver-lock-manager');
const eventSourcing = require('../../../services/event-sourcing');
const {
  hasOfferReservation,
  clearOfferReservationsForBooking
} = require('../../../services/offer-reservation-service');
const { writeVisibleBookingSnapshot } = require('../../../services/booking-visibility-service');
const { metrics } = require('../../../utils/prometheus-metrics');
const { resolveAcceptRidePayload } = require('../../../utils/accept-ride-payload');
const traceContext = require('../../../utils/trace-context');
const redisCriticalAuthorityService = require('../../../services/redis-critical-authority-service');
const AcceptRideCommand = require('../../../commands/AcceptRideCommand');

const originalActiveTripAuthorityMode = process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE;
const originalDatasetGeneration = process.env.REDIS_CRITICAL_DATASET_GENERATION;
const originalDatasetGenerationKey = process.env.REDIS_CRITICAL_DATASET_GENERATION_KEY;

describe('AcceptRideCommand', () => {
  let redis;
  let setImmediateSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE;
    delete process.env.REDIS_CRITICAL_DATASET_GENERATION;
    delete process.env.REDIS_CRITICAL_DATASET_GENERATION_KEY;
    redisCriticalAuthorityService.assertReady.mockResolvedValue({ ready: true });

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

  afterAll(() => {
    if (originalActiveTripAuthorityMode == null) {
      delete process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE;
    } else {
      process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = originalActiveTripAuthorityMode;
    }
    if (originalDatasetGeneration == null) {
      delete process.env.REDIS_CRITICAL_DATASET_GENERATION;
    } else {
      process.env.REDIS_CRITICAL_DATASET_GENERATION = originalDatasetGeneration;
    }
    if (originalDatasetGenerationKey == null) {
      delete process.env.REDIS_CRITICAL_DATASET_GENERATION_KEY;
    } else {
      process.env.REDIS_CRITICAL_DATASET_GENERATION_KEY = originalDatasetGenerationKey;
    }
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
      10,
      'booking:booking_1',
      'active_trip_by_driver:driver_1',
      'active_trip_customer_by_driver:driver_1',
      'driver:driver_1',
      'kyc:identity-verification-window:driver_1',
      'kyc:identity-policy-mutation:driver_1',
      'kyc:stepup:active:driver_1',
      'leaf:runtime:critical-dataset:generation',
      'offer_reservation:booking_1:driver_1',
      'driver_active_notification:driver_1',
      'driver_1',
      'ACCEPTED',
      expect.any(String),
      expect.any(String),
      'booking_1',
      '21600',
      '',
      '1',
      '0'
    );
    expect(redis.eval.mock.calls[0][0]).toContain('identity_reverification_pending_after_trip');
    expect(redis.eval.mock.calls[0][0]).toContain('kyc_recheck_pending_after_trip');
    expect(redis.eval.mock.calls[0][0]).toContain('activeTripLeaseUntilMs');
    expect(redis.eval.mock.calls[0][0]).toContain('ERR_OFFER_EXPIRED');
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

  it('fails closed before Redis access when the authority mode is unsupported', async () => {
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noevictin';

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/temporariamente indisponível/i);
    expect(redisPool.ensureConnection).not.toHaveBeenCalled();
    expect(redisPool.getConnection).not.toHaveBeenCalled();
    expect(redisCriticalAuthorityService.assertReady).not.toHaveBeenCalled();
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(metrics.recordCommand).toHaveBeenCalledWith('AcceptRide', expect.any(Number), false);
  });

  it('requires a force-refreshed Redis authority attestation before a new acceptance', async () => {
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
    process.env.REDIS_CRITICAL_DATASET_GENERATION = 'generation-rc1';
    redis.eval.mockResolvedValue(
      'customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
    );

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(true);
    expect(redisCriticalAuthorityService.assertReady).toHaveBeenCalledWith({
      forceRefresh: true
    });
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0]).toEqual(expect.arrayContaining([
      'leaf:runtime:critical-dataset:generation',
      'generation-rc1',
      '1',
      '1'
    ]));
  });

  it('never turns an un-attested idempotent snapshot into new ownership inside Lua', async () => {
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
    process.env.REDIS_CRITICAL_DATASET_GENERATION = 'generation-rc1';
    redis.hmget.mockResolvedValue(['driver_1', 'ACCEPTED', 'ACCEPTED']);
    redis.eval.mockResolvedValue('ERR_REDIS_AUTHORITY_RECHECK_REQUIRED');

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(redisCriticalAuthorityService.assertReady).not.toHaveBeenCalled();
    expect(redis.eval.mock.calls[0]).toEqual(expect.arrayContaining([
      'generation-rc1',
      '0',
      '1'
    ]));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/temporariamente indisponível/i);
  });

  it('fails closed when dataset generation changes between attestation and Lua mutation', async () => {
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
    process.env.REDIS_CRITICAL_DATASET_GENERATION = 'generation-rc1';
    redis.eval.mockResolvedValue('ERR_REDIS_DATASET_QUARANTINED');

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(redisCriticalAuthorityService.assertReady).toHaveBeenCalledWith({ forceRefresh: true });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/temporariamente indisponível/i);
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed before ride ownership mutation when Redis is quarantined', async () => {
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
    redisCriticalAuthorityService.assertReady.mockRejectedValue(Object.assign(
      new Error('Redis critical authority is not ready'),
      {
        code: 'REDIS_CRITICAL_AUTHORITY_NOT_READY',
        attestation: { blockers: ['dataset_generation_marker_missing'] }
      }
    ));

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/temporariamente indisponível/i);
    expect(redis.eval).not.toHaveBeenCalled();
    expect(driverLockManager.acquireLock).not.toHaveBeenCalled();
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
  });

  it('allows idempotent ownership continuation while new Redis claims are quarantined', async () => {
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
    redis.hmget.mockResolvedValue(['driver_1', 'ACCEPTED', 'ACCEPTED']);
    redisCriticalAuthorityService.assertReady.mockRejectedValue(new Error('must not be called'));
    redis.eval.mockResolvedValue(
      'OK_ALREADY_ACCEPTED|||customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
    );

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(true);
    expect(result.data.idempotentAccept).toBe(true);
    expect(redisCriticalAuthorityService.assertReady).not.toHaveBeenCalled();
  });

  it.each(['ARRIVED', 'REASSIGNED_IN_PROGRESS'])(
    'preserves idempotent continuation in %s while new Redis claims are quarantined',
    async (activeState) => {
      process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
      redis.hmget.mockResolvedValue(['driver_1', activeState, activeState]);
      redisCriticalAuthorityService.assertReady.mockRejectedValue(new Error('must not be called'));
      redis.eval.mockResolvedValue(
        'OK_ALREADY_ACCEPTED|||customer_1|||{"lat":-23.55,"lng":-46.63,"add":"Rua A, 10"}'
      );

      const result = await new AcceptRideCommand({
        driverId: 'driver_1',
        bookingId: 'booking_1'
      }).execute();

      expect(result.success).toBe(true);
      expect(result.data.idempotentAccept).toBe(true);
      expect(redisCriticalAuthorityService.assertReady).not.toHaveBeenCalled();
    }
  );

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

  it('rejects a driver made dispatch-ineligible by a random audit before mutating acceptance state', async () => {
    redis.eval.mockResolvedValue('ERR_DRIVER_NOT_DISPATCH_ELIGIBLE');

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

  it('rejects an active-trip lease conflict before replacing ride ownership', async () => {
    redis.eval.mockResolvedValue('ERR_DRIVER_ACTIVE_TRIP_CONFLICT');

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('já está em outra corrida');
    expect(redis.eval.mock.calls[0][0]).toContain('ERR_DRIVER_ACTIVE_TRIP_CONFLICT');
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
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
    redis.eval.mockImplementation(async (script) => {
      expect(script).toContain('alreadyOwnedBySameDriver');
      expect(script).toContain('and not alreadyOwnedBySameDriver');
      expect(script).toContain('activeStepUpChallenge');
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

  it('rechecks the offer reservation atomically before assigning ownership', async () => {
    redis.eval.mockResolvedValue('ERR_OFFER_EXPIRED');

    const result = await new AcceptRideCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1'
    }).execute();

    expect(hasOfferReservation).toHaveBeenCalledWith(redis, 'booking_1', 'driver_1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/oferta expirada/i);
    expect(writeVisibleBookingSnapshot).not.toHaveBeenCalled();
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
