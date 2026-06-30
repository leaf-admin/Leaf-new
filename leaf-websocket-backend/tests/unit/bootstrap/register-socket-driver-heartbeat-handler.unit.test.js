const registerSocketDriverHeartbeatHandler = require('../../../bootstrap/register-socket-driver-heartbeat-handler');

jest.mock('../../../services/heartbeat-service', () => ({
  ping: jest.fn().mockResolvedValue(undefined),
}));

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
