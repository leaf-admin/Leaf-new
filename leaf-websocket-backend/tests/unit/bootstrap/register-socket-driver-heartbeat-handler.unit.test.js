jest.mock('../../../services/heartbeat-service', () => ({
  ping: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../utils/active-trip-index', () => ({
  resolveActiveTripForDriver: jest.fn().mockResolvedValue(null),
  renewActiveTripForDriver: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../services/driver-eligibility-service', () => ({
  isDriverEligibleForRide: jest.fn(),
}));

const activeTripIndex = require('../../../utils/active-trip-index');
const driverEligibilityService = require('../../../services/driver-eligibility-service');
const registerSocketDriverHeartbeatHandler = require('../../../bootstrap/register-socket-driver-heartbeat-handler');

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

function createSocket() {
  const handlers = new Map();
  return {
    id: 'socket_1',
    userId: 'driver_1',
    userType: 'driver',
    on: jest.fn((event, handler) => handlers.set(event, handler)),
    emit: jest.fn(),
    trigger: async (event, payload) => handlers.get(event)?.(payload),
  };
}

describe('register-socket-driver-heartbeat-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue(null);
    activeTripIndex.renewActiveTripForDriver.mockResolvedValue(true);
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE',
    });
  });

  it('does not trust client in-trip flags to bypass the outside-ride KYC gate', async () => {
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn().mockResolvedValue({ isOnline: 'false' }),
      hset: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
    };
    const enforceSubscriptionForOnline = jest.fn().mockResolvedValue({ allowed: true });
    const enforceDailyKYCForOnline = jest.fn().mockResolvedValue({
      allowed: false,
      code: 'KYC_REQUIRED',
      reason: 'internal provider diagnostic',
      requirement: 'IDENTITY_REVERIFICATION',
      challenge: {
        challengeId: 'challenge_heartbeat_1',
        score: 62,
        signals: ['INTERNAL_SIGNAL'],
        metadata: { attemptState: { started: 2 } },
        envelope: { estimatedCostUsd: 0.115 },
        supportTicketId: 'ticket_heartbeat_internal',
      },
      score: 62,
      signals: ['INTERNAL_SIGNAL'],
      metadata: { provider: 'internal-provider' },
      attemptState: { started: 2 },
      financialEnvelope: { estimatedUnitCostUsd: 0.115 },
      supportTicketId: 'ticket_heartbeat_internal',
      reviewAvailable: true,
      reviewCaseId: 'case_heartbeat_1',
      evidenceId: 'evidence_heartbeat_1',
    });

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline,
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() },
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'started',
      isInTrip: true,
      bookingId: 'forged_trip',
    });

    expect(activeTripIndex.resolveActiveTripForDriver).toHaveBeenCalledWith(redis, 'driver_1');
    expect(enforceSubscriptionForOnline).toHaveBeenCalledWith('driver_1');
    expect(enforceDailyKYCForOnline).toHaveBeenCalledWith('driver_1');
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'KYC_REQUIRED',
      })
    );
    expect(redis.hset).not.toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({ dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED' })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({
        reviewAvailable: true,
        reviewCaseId: 'case_heartbeat_1',
        evidenceId: 'evidence_heartbeat_1',
      })
    );
    const publicKycPayload = socket.emit.mock.calls.find(
      ([eventName, payload]) => eventName === 'driverStatusError' && payload?.kycRequired === true
    )?.[1];
    expect(publicKycPayload).toEqual(expect.objectContaining({
      error: 'Verificação facial necessária para ficar online.',
      reason: 'Verificação facial necessária para ficar online.',
      challengeId: 'challenge_heartbeat_1',
      requirement: 'IDENTITY_REVERIFICATION',
    }));
    expect(findForbiddenMobileKycPaths(publicKycPayload)).toEqual([]);
  });

  it('keeps a backend-indexed active ride outside paid KYC gates', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'trip_active_1',
      customerId: 'customer_1',
    });
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        id: 'driver_1',
        isOnline: 'false',
        dispatchEligible: 'true',
        lat: '-22.9',
        lng: '-43.2',
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
    };
    const enforceSubscriptionForOnline = jest.fn();
    const enforceDailyKYCForOnline = jest.fn();

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline,
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() },
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'available',
      isInTrip: false,
    });

    expect(enforceSubscriptionForOnline).not.toHaveBeenCalled();
    expect(enforceDailyKYCForOnline).not.toHaveBeenCalled();
    expect(activeTripIndex.renewActiveTripForDriver).toHaveBeenCalledWith(
      redis,
      'driver_1',
      'trip_active_1'
    );
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        activeTripId: 'trip_active_1',
      })
    );
  });

  it('fails closed when a resolved ride lease cannot be renewed', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'trip_stale_or_racing',
      customerId: 'customer_1',
    });
    activeTripIndex.renewActiveTripForDriver.mockResolvedValue(false);
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        id: 'driver_1',
        isOnline: 'false',
        dispatchEligible: 'true',
        lat: '-22.9',
        lng: '-43.2',
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
    };
    const enforceSubscriptionForOnline = jest.fn();
    const enforceDailyKYCForOnline = jest.fn();

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline,
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() },
    });

    await socket.trigger('driverHeartbeat', { lat: -22.9, lng: -43.2 });

    expect(enforceSubscriptionForOnline).not.toHaveBeenCalled();
    expect(enforceDailyKYCForOnline).not.toHaveBeenCalled();
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
      })
    );
  });

  it('opens a new daily online session after the operational day rolls over', async () => {
    const socket = createSocket();
    const onlineDriver = {
      id: 'driver_1',
      isOnline: 'true',
      dispatchEligible: 'true',
      dispatchEligibilityCode: 'ELIGIBLE',
      lat: '-22.9',
      lng: '-43.2'
    };
    const redis = {
      hgetall: jest.fn()
        .mockResolvedValueOnce(onlineDriver)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(onlineDriver),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1)
    };

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline: jest.fn(),
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() }
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(redis.hset).toHaveBeenCalledWith(
      expect.stringMatching(/^driver_online_daily:\d{4}-\d{2}-\d{2}:driver_1$/),
      expect.objectContaining({
        driverId: 'driver_1',
        sessionStartedAtMs: expect.any(String)
      })
    );
  });

  it('forces an idle driver offline when the daily online limit is reached', async () => {
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    const socket = createSocket();
    const redis = {
      hgetall: jest
        .fn()
        .mockResolvedValueOnce({ isOnline: 'true' })
        .mockResolvedValueOnce({
          totalMs: String(twelveHoursMs),
          sessionStartedAtMs: '',
        })
        .mockResolvedValueOnce({
          totalMs: String(twelveHoursMs),
          sessionStartedAtMs: '',
        }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
    };

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline: jest.fn(),
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() },
    });

    await socket.trigger('driverHeartbeat', {
      driverId: 'driver_1',
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'idle',
      isInTrip: false,
    });

    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        status: 'OFFLINE',
        isOnline: 'false',
        dispatchEligibilityCode: 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({
        success: false,
        code: 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
        error: 'Você atingiu o limite de tempo online hoje.',
        message: 'Você atingiu o limite de tempo online hoje.',
        driverOnlineDaily: expect.objectContaining({
          limitReached: true,
        }),
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        driverId: 'driver_1',
        isOnline: false,
        code: 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
        message: 'Você atingiu o limite de tempo online hoje.',
        driverOnlineDaily: expect.objectContaining({
          limitReached: true,
        }),
      })
    );
  });

  it('fails closed when the current socket can no longer renew its vehicle lease', async () => {
    const socket = createSocket();
    socket.vehiclePlate = 'ABC1D23';
    socket.vehicleLockLeaseToken = 'socket_1';
    const redis = {
      hgetall: jest.fn(async key => {
        if (String(key).startsWith('driver_online_daily:')) {
          return { totalMs: '0', sessionStartedAtMs: String(Date.now() - 1000) };
        }
        return {
          id: 'driver_1',
          isOnline: 'true',
          dispatchEligible: 'true',
          dispatchEligibilityCode: 'ELIGIBLE',
          lat: '-22.9',
          lng: '-43.2',
        };
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
    };
    const renewLock = jest.fn().mockResolvedValue(false);

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline: jest.fn(),
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock },
    });

    await socket.trigger('driverHeartbeat', {
      driverId: 'driver_1',
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'idle',
      isInTrip: false,
    });

    expect(renewLock).toHaveBeenCalledWith('ABC1D23', 'driver_1', {
      leaseToken: 'socket_1',
    });
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        status: 'OFFLINE',
        isOnline: 'false',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'VEHICLE_LEASE_LOST',
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({ success: false, code: 'VEHICLE_LEASE_LOST' })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({ isOnline: false, code: 'VEHICLE_LEASE_LOST' })
    );
    expect(socket.vehiclePlate).toBeNull();
    expect(socket.vehicleLockLeaseToken).toBeNull();
  });

  it('stops a superseded heartbeat without taking the newer session offline', async () => {
    const socket = createSocket();
    socket.vehiclePlate = 'ABC1D23';
    socket.vehicleLockLeaseToken = 'socket_1';
    const redis = {
      hgetall: jest.fn(async key => {
        if (String(key).startsWith('driver_online_daily:')) {
          return { totalMs: '0', sessionStartedAtMs: String(Date.now() - 1000) };
        }
        return {
          id: 'driver_1',
          isOnline: 'true',
          dispatchEligible: 'true',
          dispatchEligibilityCode: 'ELIGIBLE',
          lat: '-22.9',
          lng: '-43.2',
        };
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
    };
    const renewLock = jest.fn().mockResolvedValue(false);
    const getLockOwner = jest.fn().mockResolvedValue({
      driverId: 'driver_1',
      leaseToken: 'socket_new',
    });

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline: jest.fn(),
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock, getLockOwner },
    });

    const heartbeat = {
      driverId: 'driver_1',
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'idle',
      isInTrip: false,
    };
    await socket.trigger('driverHeartbeat', heartbeat);

    expect(getLockOwner).toHaveBeenCalledWith('ABC1D23');
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({ success: false, code: 'DRIVER_SESSION_REPLACED' })
    );
    expect(redis.hset).not.toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({ dispatchEligibilityCode: 'VEHICLE_LEASE_LOST' })
    );
    expect(socket.vehicleLeaseSuperseded).toBe(true);

    await socket.trigger('driverHeartbeat', heartbeat);
    expect(renewLock).toHaveBeenCalledTimes(1);
  });

  it('preserves active-trip continuity when KYC discovers the trip after the initial lookup', async () => {
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        id: 'driver_1',
        isOnline: 'false',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'CACHED',
        lat: '-22.9',
        lng: '-43.2'
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1)
    };
    const enforceSubscriptionForOnline = jest.fn().mockResolvedValue({ allowed: true });
    const enforceDailyKYCForOnline = jest.fn().mockResolvedValue({
      allowed: true,
      deferred: true,
      continuityOnly: true,
      activeTripId: 'trip_race_1'
    });

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline,
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() }
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(enforceDailyKYCForOnline).toHaveBeenCalledWith('driver_1');
    expect(driverEligibilityService.isDriverEligibleForRide).not.toHaveBeenCalled();
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        kycRecheckPendingAfterTrip: 'true',
        activeTripId: 'trip_race_1'
      })
    );
    expect(redis.geoadd).not.toHaveBeenCalledWith(
      'driver_locations_eligible',
      expect.anything(),
      expect.anything(),
      'driver_1'
    );
    expect(socket.emit).not.toHaveBeenCalledWith(
      'driverStatusError',
      expect.anything()
    );
  });

  it('runs the post-trip KYC gate for a prior IN_TRIP state even without the pending marker', async () => {
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        id: 'driver_1',
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP',
        lat: '-22.9',
        lng: '-43.2'
      }),
      hset: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1)
    };
    const enforceDailyKYCForOnline = jest.fn().mockResolvedValue({
      allowed: false,
      code: 'kycRequired',
      reason: 'Validacao facial necessaria'
    });

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() }
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(enforceDailyKYCForOnline).toHaveBeenCalledWith('driver_1');
    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'false',
        dispatchEligibilityCode: 'kycRequired'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({ code: 'kycRequired', kycRequired: true })
    );
  });

  it('preserves the post-trip retry marker when KYC state is transiently unavailable', async () => {
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        id: 'driver_1',
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        kycRecheckPendingAfterTrip: 'true',
        lat: '-22.9',
        lng: '-43.2'
      }),
      hset: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1)
    };
    const enforceDailyKYCForOnline = jest.fn().mockResolvedValue({
      allowed: false,
      retryRequired: true,
      code: 'KYC_REVERIFY_STATE_UNAVAILABLE',
      reason: 'Revalidacao pendente'
    });

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() }
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        isOnline: 'false',
        kycRecheckPendingAfterTrip: 'true'
      })
    );
  });

  it('does not run the post-trip KYC gate while the backend reports an active trip', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'trip_active_heartbeat',
      customerId: 'customer_1',
    });
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        id: 'driver_1',
        status: 'IN_PROGRESS',
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP',
        kycRecheckPendingAfterTrip: 'true',
        lat: '-22.9',
        lng: '-43.2'
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1)
    };
    const enforceDailyKYCForOnline = jest.fn().mockResolvedValue({
      allowed: false,
      code: 'kycRequired'
    });

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() }
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'started',
      isInTrip: true
    });

    expect(enforceDailyKYCForOnline).not.toHaveBeenCalled();
    expect(redis.hset).not.toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({ isOnline: 'false' })
    );
    expect(redis.zrem).not.toHaveBeenCalledWith('driver_locations', 'driver_1');
    expect(redis.srem).not.toHaveBeenCalledWith('online_drivers', 'driver_1');
  });

  it('keeps trip presence online when vehicle lease renewal temporarily fails', async () => {
    activeTripIndex.resolveActiveTripForDriver.mockResolvedValue({
      tripId: 'trip_active_lease',
      customerId: 'customer_1'
    });
    const socket = createSocket();
    socket.vehiclePlate = 'ABC1D23';
    socket.vehicleLockLeaseToken = 'socket_1';
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        id: 'driver_1',
        status: 'IN_TRIP',
        isOnline: 'true',
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
        lat: '-22.9',
        lng: '-43.2'
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1)
    };
    const renewLock = jest.fn().mockResolvedValue(false);

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline: jest.fn(),
      saveDriverLocation: jest.fn(),
      vehicleLockManager: {
        renewLock,
        getLockOwner: jest.fn().mockResolvedValue(null)
      }
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'started',
      isInTrip: true
    });

    expect(redis.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        status: 'IN_TRIP',
        isOnline: 'true',
        dispatchEligible: 'false',
        vehicleLeaseRecheckPendingAfterTrip: 'true'
      })
    );
    expect(redis.zrem).not.toHaveBeenCalledWith('driver_locations', 'driver_1');
    expect(redis.srem).not.toHaveBeenCalledWith('online_drivers', 'driver_1');
    expect(redis.hset).not.toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({ dispatchEligibilityCode: 'VEHICLE_LEASE_LOST' })
    );
    expect(socket.emit).not.toHaveBeenCalledWith(
      'driverStatusError',
      expect.objectContaining({ code: 'VEHICLE_LEASE_LOST' })
    );
    expect(socket.vehiclePlate).toBe('ABC1D23');
    expect(socket.vehicleLockLeaseToken).toBe('socket_1');
  });

  it('recovers dispatch eligibility from IN_TRIP_KYC_DEFERRED after the post-trip gate passes', async () => {
    const socket = createSocket();
    const redis = {
      hgetall: jest.fn(async (key) => {
        if (String(key).startsWith('driver_online_daily:')) {
          return { totalMs: '0', sessionStartedAtMs: String(Date.now() - 1000) };
        }
        return {
          id: 'driver_1',
          isOnline: 'true',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED',
          dispatchEligibilityCheckedAt: '',
          lat: '-22.9',
          lng: '-43.2'
        };
      }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zscore: jest.fn().mockResolvedValue('1'),
      geoadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1)
    };
    const enforceDailyKYCForOnline = jest.fn().mockResolvedValue({ allowed: true });

    registerSocketDriverHeartbeatHandler({
      socket,
      redisPool: { getConnection: jest.fn(() => redis) },
      logStructured: jest.fn(),
      enforceSubscriptionForOnline: jest.fn(),
      enforceDailyKYCForOnline,
      saveDriverLocation: jest.fn(),
      vehicleLockManager: { renewLock: jest.fn() }
    });

    await socket.trigger('driverHeartbeat', {
      lat: -22.9,
      lng: -43.2,
      tripStatus: 'available',
      isInTrip: false
    });

    expect(enforceDailyKYCForOnline).toHaveBeenCalledWith('driver_1');
    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver_1',
      null,
      expect.objectContaining({ dispatchEligibilityCode: 'IN_TRIP_KYC_DEFERRED' })
    );
    expect(redis.geoadd).toHaveBeenCalledWith(
      'driver_locations_eligible',
      -43.2,
      -22.9,
      'driver_1'
    );
  });
});
