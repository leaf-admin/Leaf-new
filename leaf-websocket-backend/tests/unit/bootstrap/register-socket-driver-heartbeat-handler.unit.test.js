jest.mock('../../../services/heartbeat-service', () => ({
  ping: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../utils/active-trip-index', () => ({
  resolveActiveTripForDriver: jest.fn().mockResolvedValue(null),
  renewActiveTripForDriver: jest.fn().mockResolvedValue(true),
}));

const activeTripIndex = require('../../../utils/active-trip-index');
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
});
