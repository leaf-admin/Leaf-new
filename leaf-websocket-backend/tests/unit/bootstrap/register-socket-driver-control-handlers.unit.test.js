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
  applyDriverSnapshot: jest.fn().mockResolvedValue(undefined),
  removeDriverSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  writeVisibleBookingSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/driver-activation-state-service', () => ({
  resolveDriverActivationState: jest.fn(),
}));

jest.mock('../../../services/driver-destination-mode-service', () => ({
  resolveDestinationModeIntent: jest.fn().mockResolvedValue({
    allowed: true,
    shouldWrite: false,
    patch: null,
    destinationMode: undefined,
    policy: null,
  }),
}));

jest.mock('../../../utils/active-trip-index', () => ({
  resolveActiveTripForDriver: jest.fn().mockResolvedValue({ tripId: null, customerId: null })
}));

jest.mock('../../../services/driver-eligibility-service', () => ({
  isDriverEligibleForRide: jest.fn().mockResolvedValue({
    eligible: true,
    code: 'ELIGIBLE',
  }),
  resolveDriverProfile: jest.fn().mockResolvedValue({
    activeVehicleId: 'vehicle_1',
    vehiclePlate: 'RJA2D41',
    vehicleMake: 'Honda',
    vehicleModel: 'City',
    vehicleColor: 'BRANCO',
    vehicleIdentitySource: 'crlv_pdf_ocr',
    vehicleIdentityCanonical: true,
  }),
}));

const registerSocketDriverControlHandlers = require('../../../bootstrap/register-socket-driver-control-handlers');
const { assessDriverArrivalAtPickup } = require('../../../utils/pickup-arrival-policy');
const { resolveDriverActivationState } = require('../../../services/driver-activation-state-service');
const driverEligibilityService = require('../../../services/driver-eligibility-service');
const activeTripIndex = require('../../../utils/active-trip-index');

const createSocket = () => {
  const handlers = new Map();

  return {
    id: 'socket_driver_1',
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

const createRedis = () => {
  const redis = {
    hgetall: jest.fn().mockResolvedValue({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      driverId: 'driver_1',
    }),
    hset: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    type: jest.fn().mockResolvedValue('hash'),
    del: jest.fn().mockResolvedValue(1),
    zrem: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    geoadd: jest.fn().mockResolvedValue(1),
  };
  redis.multi = jest.fn(() => ({
    hset: jest.fn().mockReturnThis(),
    zrem: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }));
  return redis;
};

describe('register-socket-driver-control-handlers notificationAction scope', () => {
  let socket;
  let io;
  let redis;
  let idempotencyService;
  let vehicleLockManager;
  let enforceSubscriptionForOnline;
  let enforceDailyKYCForOnline;

  beforeEach(() => {
    jest.clearAllMocks();
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({ tripId: null, customerId: null });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE',
    });
    driverEligibilityService.resolveDriverProfile.mockResolvedValue({
      activeVehicleId: 'vehicle_1',
      vehiclePlate: 'RJA2D41',
      vehicleMake: 'Honda',
      vehicleModel: 'City',
      vehicleColor: 'BRANCO',
      vehicleIdentitySource: 'crlv_pdf_ocr',
      vehicleIdentityCanonical: true,
    });
    socket = createSocket();
    io = createIo();
    redis = createRedis();
    idempotencyService = {
      generateKey: jest.fn(() => 'idem_arrive'),
      beginRequest: jest.fn().mockResolvedValue({
        isNew: true,
        disposition: 'started',
        cachedResult: null,
      }),
      cacheResult: jest.fn().mockResolvedValue(undefined),
      releaseInflight: jest.fn().mockResolvedValue(undefined),
    };
    vehicleLockManager = {
      acquireLock: jest.fn().mockResolvedValue({ success: true }),
      releaseLock: jest.fn().mockResolvedValue(true),
    };
    enforceSubscriptionForOnline = jest.fn().mockResolvedValue({ allowed: true });
    enforceDailyKYCForOnline = jest.fn().mockResolvedValue({ allowed: true });

    registerSocketDriverControlHandlers({
      socket,
      io,
      redisPool: {
        getConnection: jest.fn(() => redis),
      },
      logStructured: jest.fn(),
      idempotencyService,
      enforceSubscriptionForOnline,
      enforceDailyKYCForOnline,
      vehicleLockManager,
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

  it('returns cached arrival result without reapplying arrival state', async () => {
    const cachedResult = {
      success: true,
      bookingId: 'booking_1',
      rideId: 'booking_1',
      cached: true,
    };
    idempotencyService.beginRequest.mockResolvedValueOnce({
      isNew: false,
      disposition: 'cached',
      cachedResult,
    });

    await socket.trigger('notificationAction', {
      action: 'arrived_at_pickup',
      bookingId: 'booking_1',
      idempotencyKey: 'idem_arrive',
    });

    expect(assessDriverArrivalAtPickup).not.toHaveBeenCalled();
    expect(redis.hgetall).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('arrivedAtPickup', cachedResult);
    expect(socket.emit).toHaveBeenCalledWith(
      'notificationActionSuccess',
      expect.objectContaining({
        success: true,
        action: 'arrived_at_pickup',
        bookingId: 'booking_1',
        cached: true,
      })
    );
  });

  it('returns canonical vehicle identity in the authenticated driver online ack', async () => {
    resolveDriverActivationState.mockResolvedValue({
      canAttemptOnline: true,
      canGoOnline: true,
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      dispatchEligible: 'true',
      lat: '-22.9207',
      lng: '-43.4059',
    });

    await socket.trigger('setDriverStatus', {
      status: 'online',
      isOnline: true,
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        success: true,
        driverId: 'driver_1',
        driverOnlineDaily: expect.objectContaining({
          limitMs: 12 * 60 * 60 * 1000,
          warningMs: 10 * 60 * 60 * 1000,
        }),
        vehicleIdentity: {
          activeVehicleId: 'vehicle_1',
          plate: 'RJA2D41',
          make: 'Honda',
          model: 'City',
          color: 'BRANCO',
          source: 'crlv_pdf_ocr',
          canonical: true,
          complete: true,
        },
      })
    );
    expect(vehicleLockManager.acquireLock).toHaveBeenCalledWith('RJA2D41', 'driver_1', {
      leaseToken: 'socket_driver_1',
    });
    expect(socket.vehicleLockLeaseToken).toBe('socket_driver_1');
  });

  it('forces the driver offline and out of dispatch when a random KYC audit is pending', async () => {
    resolveDriverActivationState.mockResolvedValue({
      canAttemptOnline: true,
      canGoOnline: true,
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      status: 'OFFLINE',
      isOnline: 'false',
      dispatchEligible: 'true',
    });
    enforceDailyKYCForOnline.mockResolvedValueOnce({
      allowed: false,
      code: 'kycRequired',
      reason: 'Validacao aleatoria de identidade necessaria.',
      requirement: 'LIVENESS_REQUIRED',
      challenge: { challengeId: 'kyc_random_audit_1' }
    });

    await socket.trigger('setDriverStatus', {
      status: 'online',
      isOnline: true,
    });

    const tx = redis.multi.mock.results.at(-1).value;
    expect(tx.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        status: 'OFFLINE',
        isOnline: 'false',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'kycRequired'
      })
    );
    expect(tx.zrem).toHaveBeenCalledWith('driver_locations_eligible', 'driver_1');
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({
        code: 'kycRequired',
        challengeId: 'kyc_random_audit_1'
      })
    );
    expect(vehicleLockManager.acquireLock).not.toHaveBeenCalled();
  });

  it('treats an online request during a backend-indexed trip as continuity without KYC interruption', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'booking_active_1',
      customerId: 'customer_1',
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      status: 'IN_PROGRESS',
      isOnline: 'false',
      dispatchEligible: 'true',
      lat: '-22.9207',
      lng: '-43.4059',
    });

    await socket.trigger('setDriverStatus', {
      status: 'online',
      isOnline: true,
      isInTrip: false,
    });

    expect(resolveDriverActivationState).not.toHaveBeenCalled();
    expect(driverEligibilityService.isDriverEligibleForRide).not.toHaveBeenCalled();
    expect(vehicleLockManager.acquireLock).not.toHaveBeenCalled();
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        kycRecheckPendingAfterTrip: 'true',
        activeTripId: 'booking_active_1',
      })
    );
    expect(redis.geoadd).not.toHaveBeenCalledWith(
      'driver_locations_eligible',
      expect.anything(),
      expect.anything(),
      'driver_1'
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        success: true,
        code: 'IN_TRIP_KYC_DEFERRED',
        kycDeferred: true,
        activeTripId: 'booking_active_1',
      })
    );
  });

  it('defers an offline request until the backend-indexed active trip ends', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'booking_active_offline',
      customerId: 'customer_1',
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      status: 'IN_PROGRESS',
      isOnline: 'true',
      dispatchEligible: 'false',
      vehiclePlate: 'RJA2D41',
      lat: '-22.9207',
      lng: '-43.4059',
    });

    await socket.trigger('setDriverStatus', {
      status: 'offline',
      isOnline: false,
    });

    expect(vehicleLockManager.releaseLock).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalledWith('online_drivers', 'driver_1');
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        dispatchEligible: 'false',
        kycRecheckPendingAfterTrip: 'true',
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        code: 'OFFLINE_DEFERRED_ACTIVE_TRIP',
        offlineDeferred: true,
        isOnline: true,
      })
    );
  });

  it('preserves online continuity when the active-trip index is unavailable', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockRejectedValueOnce(new Error('redis unavailable'));
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      status: 'IN_PROGRESS',
      isOnline: 'true',
      dispatchEligible: 'false',
      vehiclePlate: 'RJA2D41',
      lat: '-22.9207',
      lng: '-43.4059',
    });

    await socket.trigger('setDriverStatus', {
      status: 'offline',
      isOnline: false,
    });

    expect(enforceSubscriptionForOnline).not.toHaveBeenCalled();
    expect(enforceDailyKYCForOnline).not.toHaveBeenCalled();
    expect(resolveDriverActivationState).not.toHaveBeenCalled();
    expect(vehicleLockManager.releaseLock).not.toHaveBeenCalled();
    expect(redis.zrem).not.toHaveBeenCalledWith('driver_locations', 'driver_1');
    expect(redis.srem).not.toHaveBeenCalledWith('online_drivers', 'driver_1');
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        kycRecheckPendingAfterTrip: 'true',
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        isOnline: true,
        offlineDeferred: true,
        activeTripStateUnknown: true,
        code: 'OFFLINE_DEFERRED_ACTIVE_TRIP_STATE_UNKNOWN',
      })
    );
  });

  it('honors continuityOnly when the active trip appears during the KYC gate', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: null,
      customerId: null,
    });
    resolveDriverActivationState.mockResolvedValue({
      canAttemptOnline: true,
      canGoOnline: true,
    });
    enforceDailyKYCForOnline.mockResolvedValue({
      allowed: true,
      deferred: true,
      continuityOnly: true,
      activeTripId: 'booking_race_1',
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      status: 'IN_PROGRESS',
      isOnline: 'false',
      dispatchEligible: 'true',
      lat: '-22.9207',
      lng: '-43.4059',
    });

    await socket.trigger('setDriverStatus', {
      status: 'online',
      isOnline: true,
    });

    expect(driverEligibilityService.isDriverEligibleForRide).not.toHaveBeenCalled();
    expect(vehicleLockManager.acquireLock).not.toHaveBeenCalled();
    expect(redis.zrem).toHaveBeenCalledWith('driver_locations_eligible', 'driver_1');
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        activeTripId: 'booking_race_1',
      })
    );
  });

  it('blocks the second profile from going online with the same vehicle lock', async () => {
    resolveDriverActivationState.mockResolvedValue({
      canAttemptOnline: true,
      canGoOnline: true,
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      dispatchEligible: 'true',
      lat: '-22.9207',
      lng: '-43.4059',
    });
    vehicleLockManager.acquireLock.mockResolvedValueOnce({
      success: false,
      currentDriver: 'driver_2',
      error: 'vehicle in use',
    });

    await socket.trigger('setDriverStatus', {
      status: 'online',
      isOnline: true,
    });

    expect(vehicleLockManager.acquireLock).toHaveBeenCalledWith('RJA2D41', 'driver_1', {
      leaseToken: 'socket_driver_1',
    });
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({
        success: false,
        code: 'VEHICLE_ALREADY_ONLINE',
      })
    );
    expect(socket.emit).not.toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({ isOnline: true })
    );
  });

  it('releases the online vehicle lock when the driver goes offline', async () => {
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      vehiclePlate: 'RJA2D41',
      activeVehicleId: 'vehicle_1',
      isOnline: 'true',
    });

    await socket.trigger('setDriverStatus', {
      status: 'offline',
      isOnline: false,
    });

    expect(vehicleLockManager.releaseLock).toHaveBeenCalledWith('RJA2D41', 'driver_1', {
      leaseToken: 'socket_driver_1',
    });
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        success: true,
        isOnline: false,
      })
    );
  });

  it('recomputes dispatch eligibility when a driver goes online from stale ineligible state', async () => {
    resolveDriverActivationState.mockResolvedValue({
      canAttemptOnline: true,
      canGoOnline: true,
    });
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_1',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'AWAITING_LOCATION_SYNC',
      lat: '-22.9207',
      lng: '-43.4059',
    });

    await socket.trigger('setDriverStatus', {
      status: 'online',
      isOnline: true,
    });

    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver_1',
      null,
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'AWAITING_LOCATION_SYNC',
      })
    );
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        status: 'AVAILABLE',
        dispatchEligible: 'true',
        dispatchEligibilityCode: 'ELIGIBLE',
      })
    );
    expect(redis.geoadd).toHaveBeenCalledWith(
      'driver_locations_eligible',
      -43.4059,
      -22.9207,
      'driver_1'
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        success: true,
        driverId: 'driver_1',
        isOnline: true,
        dispatchEligible: true,
      })
    );
  });
});
