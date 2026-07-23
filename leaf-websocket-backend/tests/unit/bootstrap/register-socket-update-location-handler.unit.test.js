jest.mock('../../../services/driver-eligibility-service', () => ({
  isDriverEligibleForRide: jest.fn()
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  applyDriverSnapshot: jest.fn().mockResolvedValue(undefined),
  removeDriverSnapshot: jest.fn().mockResolvedValue(undefined),
  applyBookingSnapshot: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/map-h3-refresh-broadcaster', () => ({
  scheduleMapH3Refresh: jest.fn()
}));

jest.mock('../../../utils/active-trip-index', () => ({
  resolveActiveTripForDriver: jest.fn().mockResolvedValue(null),
  setActiveTripForDriver: jest.fn().mockResolvedValue(undefined)
}));

const driverEligibilityService = require('../../../services/driver-eligibility-service');
const activeTripIndex = require('../../../utils/active-trip-index');
const registerSocketUpdateLocationHandler = require('../../../bootstrap/register-socket-update-location-handler');

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));
const flushSocketHandler = async () => {
  for (let index = 0; index < 10; index += 1) {
    await flushPromises();
  }
};

function createHarness() {
  const handlers = {};
  const socket = {
    id: 'socket_driver_1',
    userId: 'driver_1',
    userType: 'driver',
    on: jest.fn((event, handler) => {
      handlers[event] = async (payload) => {
        await handler(payload);
        await flushSocketHandler();
      };
    }),
    emit: jest.fn()
  };
  const redis = {
    hgetall: jest.fn().mockResolvedValue({}),
    hset: jest.fn().mockResolvedValue(1),
    zrem: jest.fn().mockResolvedValue(1),
    zscore: jest.fn().mockResolvedValue(null),
    zadd: jest.fn().mockResolvedValue(1),
    geoadd: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    xadd: jest.fn().mockResolvedValue('stream-id-1')
  };
  const saveDriverLocation = jest.fn().mockResolvedValue(undefined);
  const enforceSubscriptionForOnline = jest.fn().mockResolvedValue({ allowed: true });
  const enforceDailyKYCForOnline = jest.fn().mockResolvedValue({ allowed: true });
  const roomEmit = jest.fn();
  const io = {
    to: jest.fn(() => ({ emit: roomEmit }))
  };

  registerSocketUpdateLocationHandler({
    socket,
    io,
    rateLimiterService: {
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true })
    },
    logStructured: jest.fn(),
    redisPool: {
      getConnection: jest.fn(() => redis)
    },
    enforceSubscriptionForOnline,
    enforceDailyKYCForOnline,
    saveDriverLocation
  });

  return {
    handlers,
    io,
    redis,
    roomEmit,
    saveDriverLocation,
    socket,
    enforceSubscriptionForOnline,
    enforceDailyKYCForOnline
  };
}

describe('registerSocketUpdateLocationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue(null);
    activeTripIndex.setActiveTripForDriver.mockResolvedValue(undefined);
  });

  it('blocks offline-to-online location sync when canonical driver activation/KYC is not eligible', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: false,
      code: 'DRIVER_ACTIVATION_REJECTED',
      activationState: {
        state: 'REJECTED',
        canGoOnline: false,
        kyc: { status: 'pending_review', blocked: true }
      }
    });
    const { handlers, redis, saveDriverLocation, socket } = createHarness();

    await handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available'
    });

    expect(saveDriverLocation).not.toHaveBeenCalled();
    expect(redis.zrem).toHaveBeenCalledWith('driver_locations_eligible', 'driver_1');
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'false',
        status: 'OFFLINE',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'DRIVER_ACTIVATION_REJECTED'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({
        code: 'driverNotEligible',
        reason: 'DRIVER_ACTIVATION_REJECTED',
        eligibilityRequired: true
      })
    );
  });

  it('marks batched location sync as rejected when driver is not eligible', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: false,
      code: 'DRIVER_ACTIVATION_REJECTED'
    });
    const { handlers, saveDriverLocation, socket } = createHarness();

    await handlers.updateLocationBatch({
      bookingId: 'booking_batch_rejected',
      tripStatus: 'available',
      isInTrip: false,
      batchId: 'batch_rejected',
      locations: [
        {
          eventId: 'loc_rejected_1',
          lat: -22.91,
          lng: -43.17,
          seq: 1,
          capturedAt: 1710000000000
        }
      ]
    });

    expect(saveDriverLocation).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'locationBatchUpdated',
      expect.objectContaining({
        success: false,
        batchId: 'batch_rejected',
        bookingId: 'booking_batch_rejected',
        totalCount: 1,
        acceptedCount: 0,
        rejectedCount: 1,
        results: [
          expect.objectContaining({
            eventId: 'loc_rejected_1',
            success: false,
            code: 'DRIVER_ACTIVATION_REJECTED'
          })
        ]
      })
    );
  });

  it('preserves traffic segments when normalizing a shared active route plan', () => {
    const pickupCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.882, longitude: -43.344 }
    ];
    const destinationCoordinates = [
      { latitude: -22.882, longitude: -43.344 },
      { latitude: -22.883, longitude: -43.345 }
    ];
    const normalized = registerSocketUpdateLocationHandler.__private__.normalizeSharedRoutePlan({
      pickupCoordinates,
      destinationCoordinates,
      combinedCoordinates: [...pickupCoordinates, destinationCoordinates[1]],
      pickupTrafficSegments: [
        {
          level: 'moderate',
          color: '#F59E0B',
          coordinates: pickupCoordinates
        }
      ],
      destinationTrafficSegments: [
        {
          level: 'heavy',
          color: '#DC2626',
          coordinates: destinationCoordinates
        }
      ],
      pickupDistanceKm: 0.7,
      pickupDurationMinutes: 4,
      destinationDistanceKm: 8.2,
      destinationDurationMinutes: 14
    });

    expect(normalized).toEqual(expect.objectContaining({
      pickupTrafficSegments: [
        {
          level: 'moderate',
          color: '#F59E0B',
          coordinates: pickupCoordinates
        }
      ],
      destinationTrafficSegments: [
        {
          level: 'heavy',
          color: '#DC2626',
          coordinates: destinationCoordinates
        }
      ]
    }));
  });

  it('accepts batched in-trip driver locations with seq/capturedAt and streams them once', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE'
    });
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'booking_batch_1',
      customerId: 'customer_1'
    });
    const { handlers, redis, roomEmit, saveDriverLocation, socket } = createHarness();
    redis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver_1') {
        return {
          isOnline: 'true',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'IN_TRIP'
        };
      }
      if (key === 'booking:booking_batch_1') {
        return {
          bookingId: 'booking_batch_1',
          driverId: 'driver_1',
          customerId: 'customer_1',
          status: 'IN_PROGRESS',
          financialContext: '{"version":1,"namespace":"sandbox","contextId":"sandbox-context-id"}',
          financialNamespace: 'sandbox',
          financialContextId: 'sandbox-context-id',
          paymentProviderEnvironment: 'sandbox',
          paymentProfileId: 'qa-sandbox',
          testUserSandbox: 'true'
        };
      }
      return {};
    });
    redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce('1');

    await handlers.updateLocationBatch({
      bookingId: 'booking_batch_1',
      tripStatus: 'started',
      isInTrip: true,
      batchId: 'batch_1',
      locations: [
        {
          eventId: 'loc_1',
          lat: -22.91,
          lng: -43.17,
          seq: 1,
          capturedAt: 1710000000000,
          source: 'background_task'
        },
        {
          eventId: 'loc_2',
          lat: -22.92,
          lng: -43.18,
          seq: 2,
          capturedAt: 1710000005000,
          source: 'background_task'
        }
      ]
    });

    expect(saveDriverLocation).toHaveBeenCalledTimes(2);
    expect(redis.xadd).toHaveBeenCalledTimes(2);
    const firstStreamCall = redis.xadd.mock.calls[0];
    const streamDataIndex = firstStreamCall.indexOf('data');
    const firstStreamPayload = JSON.parse(firstStreamCall[streamDataIndex + 1]);
    expect(firstStreamPayload).toEqual(expect.objectContaining({
      financialContext: '{"version":1,"namespace":"sandbox","contextId":"sandbox-context-id"}',
      financialNamespace: 'sandbox',
      financialContextId: 'sandbox-context-id',
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-sandbox',
      testUserSandbox: 'true'
    }));
    expect(redis.zadd).toHaveBeenCalledWith(
      'ride_health:driver_signal_active',
      1710000000000,
      'booking_batch_1'
    );
    expect(redis.zadd).toHaveBeenCalledWith(
      'ride_health:driver_signal_active',
      1710000005000,
      'booking_batch_1'
    );
    expect(roomEmit).toHaveBeenCalledWith(
      'driverLocation',
      expect.objectContaining({
        bookingId: 'booking_batch_1',
        driverId: 'driver_1',
        seq: 1,
        orderStatus: 'in_order'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'locationBatchUpdated',
      expect.objectContaining({
        success: true,
        batchId: 'batch_1',
        bookingId: 'booking_batch_1',
        totalCount: 2,
        acceptedCount: 2
      })
    );
  });

  it('uses the backend trip index to defer KYC even when the client says it is not in trip', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'booking_active_backend',
      customerId: 'customer_1'
    });
    const harness = createHarness();
    harness.redis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver_1') {
        return {
          id: 'driver_1',
          isOnline: 'false',
          dispatchEligible: 'true',
          lat: '-22.91',
          lng: '-43.17'
        };
      }
      if (key === 'booking:booking_active_backend') {
        return {
          bookingId: 'booking_active_backend',
          driverId: 'driver_1',
          customerId: 'customer_1',
          status: 'IN_PROGRESS'
        };
      }
      return {};
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(harness.enforceSubscriptionForOnline).not.toHaveBeenCalled();
    expect(harness.enforceDailyKYCForOnline).not.toHaveBeenCalled();
    expect(harness.saveDriverLocation).toHaveBeenCalledWith(
      'driver_1',
      -22.91,
      -43.17,
      0,
      0,
      expect.any(Number),
      true,
      true
    );
    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        kycRecheckPendingAfterTrip: 'true',
        activeTripId: 'booking_active_backend'
      })
    );
    expect(harness.redis.geoadd).not.toHaveBeenCalledWith(
      'driver_locations_eligible',
      expect.anything(),
      expect.anything(),
      'driver_1'
    );
  });

  it('fails safe when the active-trip index is unavailable without KYC or offline transitions', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockRejectedValueOnce(new Error('redis unavailable'));
    const harness = createHarness();
    harness.redis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver_1') {
        return {
          id: 'driver_1',
          status: 'IN_PROGRESS',
          isOnline: 'true',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
          lat: '-22.91',
          lng: '-43.17'
        };
      }
      return {};
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(harness.enforceSubscriptionForOnline).not.toHaveBeenCalled();
    expect(harness.enforceDailyKYCForOnline).not.toHaveBeenCalled();
    expect(driverEligibilityService.isDriverEligibleForRide).not.toHaveBeenCalled();
    expect(harness.saveDriverLocation).toHaveBeenCalledWith(
      'driver_1',
      -22.91,
      -43.17,
      0,
      0,
      expect.any(Number),
      true,
      true
    );
    expect(harness.redis.zrem).not.toHaveBeenCalledWith('driver_locations', 'driver_1');
    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        kycRecheckPendingAfterTrip: 'true'
      })
    );
    expect(harness.socket.emit).not.toHaveBeenCalledWith(
      'driverStatusError',
      expect.anything()
    );
  });

  it('preserves active-trip continuity when KYC discovers the trip after the initial lookup', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue(null);
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: false,
      code: 'DRIVER_ACTIVATION_REJECTED'
    });
    const harness = createHarness();
    harness.redis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver_1') {
        return {
          id: 'driver_1',
          isOnline: 'false',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'CACHED',
          lat: '-22.91',
          lng: '-43.17'
        };
      }
      if (key === 'booking:booking_race_1') {
        return {
          bookingId: 'booking_race_1',
          driverId: 'driver_1',
          customerId: 'customer_1',
          status: 'IN_PROGRESS'
        };
      }
      return {};
    });
    harness.enforceDailyKYCForOnline.mockResolvedValue({
      allowed: true,
      deferred: true,
      continuityOnly: true,
      activeTripId: 'booking_race_1'
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(driverEligibilityService.isDriverEligibleForRide).not.toHaveBeenCalled();
    expect(harness.saveDriverLocation).toHaveBeenCalledWith(
      'driver_1',
      -22.91,
      -43.17,
      0,
      0,
      expect.any(Number),
      true,
      true
    );
    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        kycRecheckPendingAfterTrip: 'true',
        activeTripId: 'booking_race_1'
      })
    );
    expect(harness.redis.geoadd).not.toHaveBeenCalledWith(
      'driver_locations_eligible',
      expect.anything(),
      expect.anything(),
      'driver_1'
    );
  });

  it('applies the deferred KYC before a completed trip can rejoin dispatch', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue(null);
    const harness = createHarness();
    harness.redis.hgetall.mockResolvedValue({
      id: 'driver_1',
      isOnline: 'true',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
      kycRecheckPendingAfterTrip: 'true',
      lat: '-22.91',
      lng: '-43.17'
    });
    harness.enforceDailyKYCForOnline.mockResolvedValue({
      allowed: false,
      code: 'kycRequired',
      reason: 'Validacao aleatoria necessaria',
      requirement: 'LIVENESS_REQUIRED',
      challenge: { challengeId: 'challenge-random' }
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(harness.enforceDailyKYCForOnline).toHaveBeenCalledWith('driver_1');
    expect(harness.saveDriverLocation).not.toHaveBeenCalled();
    expect(harness.redis.geoadd).not.toHaveBeenCalledWith(
      'driver_locations_eligible',
      expect.anything(),
      expect.anything(),
      'driver_1'
    );
    expect(harness.socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({
        code: 'kycRequired',
        challengeId: 'challenge-random'
      })
    );
  });

  it('applies post-trip KYC from the prior IN_TRIP code even when the marker is missing', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue(null);
    const harness = createHarness();
    harness.redis.hgetall.mockResolvedValue({
      id: 'driver_1',
      isOnline: 'true',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'IN_TRIP',
      lat: '-22.91',
      lng: '-43.17'
    });
    harness.enforceDailyKYCForOnline.mockResolvedValue({
      allowed: false,
      code: 'kycRequired',
      reason: 'Validacao facial necessaria'
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(harness.enforceDailyKYCForOnline).toHaveBeenCalledWith('driver_1');
    expect(harness.saveDriverLocation).not.toHaveBeenCalled();
    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'false',
        dispatchEligibilityCode: 'kycRequired'
      })
    );
  });

  it('preserves the post-trip retry marker when deferred KYC cannot be read yet', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue(null);
    const harness = createHarness();
    harness.redis.hgetall.mockResolvedValue({
      id: 'driver_1',
      isOnline: 'true',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
      kycRecheckPendingAfterTrip: 'true',
      lat: '-22.91',
      lng: '-43.17'
    });
    harness.enforceDailyKYCForOnline.mockResolvedValue({
      allowed: false,
      retryRequired: true,
      code: 'KYC_REVERIFY_STATE_UNAVAILABLE',
      reason: 'Revalidacao pendente'
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'false',
        kycRecheckPendingAfterTrip: 'true'
      })
    );
  });

  it('does not run the post-trip KYC gate while the location state still reports an active trip', async () => {
    const harness = createHarness();
    harness.redis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver_1') {
        return {
          id: 'driver_1',
          status: 'IN_PROGRESS',
          isOnline: 'true',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'IN_TRIP',
          kycRecheckPendingAfterTrip: 'true',
          lat: '-22.91',
          lng: '-43.17'
        };
      }
      return {};
    });
    harness.enforceDailyKYCForOnline.mockResolvedValue({
      allowed: false,
      code: 'kycRequired'
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'started',
      isInTrip: true,
      tripId: 'booking_client_active'
    });

    expect(harness.enforceDailyKYCForOnline).not.toHaveBeenCalled();
    expect(harness.saveDriverLocation).toHaveBeenCalledWith(
      'driver_1',
      -22.91,
      -43.17,
      0,
      0,
      expect.any(Number),
      true,
      true
    );
    expect(harness.redis.hset).not.toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({ isOnline: 'false' })
    );
  });

  it('recovers dispatch eligibility from IN_TRIP_KYC_DEFERRED after post-trip KYC passes', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue(null);
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE'
    });
    const harness = createHarness();
    harness.redis.hgetall.mockResolvedValue({
      id: 'driver_1',
      isOnline: 'true',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
      lat: '-22.91',
      lng: '-43.17'
    });
    harness.enforceDailyKYCForOnline.mockResolvedValue({ allowed: true });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver_1',
      null,
      expect.objectContaining({ dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED' })
    );
    expect(harness.redis.geoadd).toHaveBeenCalledWith(
      'driver_locations_eligible',
      -43.17,
      -22.91,
      'driver_1'
    );
    expect(harness.saveDriverLocation).toHaveBeenCalledWith(
      'driver_1',
      -22.91,
      -43.17,
      0,
      0,
      expect.any(Number),
      true,
      false
    );
  });
});
