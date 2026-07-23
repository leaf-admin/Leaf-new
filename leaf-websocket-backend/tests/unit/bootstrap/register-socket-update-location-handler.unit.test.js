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
  setActiveTripForDriver: jest.fn().mockResolvedValue(undefined),
  renewActiveTripForDriver: jest.fn().mockResolvedValue(true)
}));

const driverEligibilityService = require('../../../services/driver-eligibility-service');
const activeTripIndex = require('../../../utils/active-trip-index');
const registerSocketUpdateLocationHandler = require('../../../bootstrap/register-socket-update-location-handler');

const FORBIDDEN_MOBILE_KYC_FIELDS = new Set([
  'challenge',
  'score',
  'signals',
  'metadata',
  'attemptState',
  'supportTicketId',
  'envelope',
  'financialEnvelope',
  'costEnvelope',
  'estimatedUnitCostUsd',
  'estimatedCostUsd',
]);

function findForbiddenMobileKycPaths(value, path = '$') {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenMobileKycPaths(item, `${path}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nestedPath = `${path}.${key}`;
    return [
      ...(FORBIDDEN_MOBILE_KYC_FIELDS.has(key) ? [nestedPath] : []),
      ...findForbiddenMobileKycPaths(nestedValue, nestedPath),
    ];
  });
}

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
    activeTripIndex.renewActiveTripForDriver.mockResolvedValue(true);
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

  it('does not trust client ride flags or route plans to bypass KYC', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE'
    });
    const harness = createHarness();
    harness.enforceDailyKYCForOnline.mockResolvedValue({
      allowed: false,
      code: 'KYC_REQUIRED',
      reason: 'internal provider diagnostic',
      requirement: 'LIVENESS_REQUIRED',
      challenge: {
        challengeId: 'challenge_location_1',
        score: 88,
        signals: [{ code: 'INTERNAL_SIGNAL' }],
        metadata: { attemptState: { started: 4 } },
        envelope: { estimatedUnitCostUsd: 0.115 },
        supportTicketId: 'ticket_location_internal'
      },
      score: 88,
      signals: [{ code: 'INTERNAL_SIGNAL' }],
      metadata: { provider: 'internal-provider' },
      attemptState: { started: 4 },
      costEnvelope: { estimatedCostUsd: 0.115 },
      supportTicketId: 'ticket_location_internal',
      reviewAvailable: false,
      reviewCaseId: 'case_location_1',
      evidenceId: 'evidence_location_1'
    });

    await harness.handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'started',
      isInTrip: true,
      bookingId: 'forged_trip',
      routePlan: { bookingId: 'forged_trip', coordinates: [] }
    });

    expect(activeTripIndex.resolveActiveTripForDriver).toHaveBeenCalledWith(
      harness.redis,
      'driver_1'
    );
    expect(harness.enforceSubscriptionForOnline).toHaveBeenCalledWith('driver_1');
    expect(harness.enforceDailyKYCForOnline).toHaveBeenCalledWith('driver_1');
    expect(harness.saveDriverLocation).not.toHaveBeenCalled();
    expect(harness.redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'KYC_REQUIRED'
      })
    );
    expect(harness.redis.hset).not.toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({ dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED' })
    );
    expect(harness.socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({
        reviewAvailable: false
      })
    );
    const publicKycPayload = harness.socket.emit.mock.calls.find(
      ([eventName, payload]) => eventName === 'driverStatusError' && payload?.kycRequired === true
    )?.[1];
    expect(publicKycPayload).toEqual(expect.objectContaining({
      error: 'Verificação facial necessária para ficar online.',
      reason: 'Verificação facial necessária para ficar online.',
      challengeId: 'challenge_location_1',
      requirement: 'LIVENESS_REQUIRED'
    }));
    expect(publicKycPayload).not.toHaveProperty('reviewCaseId');
    expect(publicKycPayload).not.toHaveProperty('evidenceId');
    expect(findForbiddenMobileKycPaths(publicKycPayload)).toEqual([]);
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
    expect(activeTripIndex.renewActiveTripForDriver).toHaveBeenCalledTimes(2);
    expect(activeTripIndex.renewActiveTripForDriver).toHaveBeenCalledWith(
      redis,
      'driver_1',
      'booking_batch_1',
      {
        bookingData: expect.objectContaining({
          driverId: 'driver_1',
          status: 'IN_PROGRESS'
        })
      }
    );
    expect(redis.xadd).toHaveBeenCalledTimes(2);
    expect(redis.xadd.mock.calls[0].slice(0, 4)).toEqual([
      'trip_location_events',
      '*',
      'type',
      'trip.location.v1'
    ]);
    expect(redis.xadd.mock.calls[0]).not.toContain('MAXLEN');
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

  it('does not stream or fan out a ride location when lease renewal is rejected', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'booking_lease_rejected',
      customerId: 'customer_1'
    });
    activeTripIndex.renewActiveTripForDriver.mockResolvedValue(false);
    const { handlers, redis, roomEmit } = createHarness();
    redis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver_1') {
        return {
          isOnline: 'true',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'IN_TRIP'
        };
      }
      if (key === 'booking:booking_lease_rejected') {
        return {
          bookingId: 'booking_lease_rejected',
          driverId: 'driver_1',
          customerId: 'customer_1',
          status: 'IN_PROGRESS'
        };
      }
      return {};
    });

    await handlers.updateLocation({
      lat: -22.91,
      lng: -43.17,
      tripStatus: 'started',
      isInTrip: true,
      seq: 1,
      capturedAt: 1710000000000
    });

    expect(redis.xadd).not.toHaveBeenCalled();
    expect(roomEmit).not.toHaveBeenCalled();
    expect(redis.zrem).toHaveBeenCalledWith('driver_locations_eligible', 'driver_1');
  });

  describe('safe stream retention', () => {
    const { trimTripLocationStreamSafely } = registerSocketUpdateLocationHandler.__private__;

    it('trims only entries older than the oldest pending id', async () => {
      const redis = {
        xlen: jest.fn().mockResolvedValue(500001),
        xinfo: jest.fn().mockResolvedValue([
          ['name', 'trip-location-workers', 'pending', 1, 'last-delivered-id', '900-0']
        ]),
        xpending: jest.fn().mockResolvedValue([1, '400-2', '400-2', [['worker-1', '1']]]),
        xtrim: jest.fn().mockResolvedValue(120)
      };

      await expect(trimTripLocationStreamSafely(redis)).resolves.toEqual(
        expect.objectContaining({
          trimmed: 120,
          safeBoundary: '400-2',
          reason: 'safe_boundary_trimmed'
        })
      );
      expect(redis.xtrim).toHaveBeenCalledWith(
        'trip_location_events',
        'MINID',
        '~',
        '400-2'
      );
    });

    it('uses the oldest safe boundary across all consumer groups', async () => {
      const redis = {
        xlen: jest.fn().mockResolvedValue(600000),
        xinfo: jest.fn().mockResolvedValue([
          ['name', 'group-a', 'pending', 1, 'last-delivered-id', '900-0'],
          ['name', 'group-b', 'pending', 0, 'last-delivered-id', '300-5']
        ]),
        xpending: jest.fn()
          .mockResolvedValueOnce([1, '400-2', '400-2', [['worker-a', '1']]])
          .mockResolvedValueOnce([0, null, null, []]),
        xtrim: jest.fn().mockResolvedValue(10)
      };

      await trimTripLocationStreamSafely(redis);

      expect(redis.xtrim).toHaveBeenCalledWith(
        'trip_location_events',
        'MINID',
        '~',
        '300-5'
      );
    });

    it('keeps the stream intact when no consumer group proves a safe boundary', async () => {
      const redis = {
        xlen: jest.fn().mockResolvedValue(600000),
        xinfo: jest.fn().mockResolvedValue([]),
        xpending: jest.fn(),
        xtrim: jest.fn()
      };

      await expect(trimTripLocationStreamSafely(redis)).resolves.toEqual(
        expect.objectContaining({ reason: 'no_consumer_group', trimmed: 0 })
      );
      expect(redis.xpending).not.toHaveBeenCalled();
      expect(redis.xtrim).not.toHaveBeenCalled();
    });

    it('does not trim unread entries when a group has not delivered anything', async () => {
      const redis = {
        xlen: jest.fn().mockResolvedValue(600000),
        xinfo: jest.fn().mockResolvedValue([
          ['name', 'trip-location-workers', 'pending', 0, 'last-delivered-id', '0-0']
        ]),
        xpending: jest.fn().mockResolvedValue([0, null, null, []]),
        xtrim: jest.fn()
      };

      await expect(trimTripLocationStreamSafely(redis)).resolves.toEqual(
        expect.objectContaining({ reason: 'unread_or_pending_boundary', trimmed: 0 })
      );
      expect(redis.xtrim).not.toHaveBeenCalled();
    });
  });
});
