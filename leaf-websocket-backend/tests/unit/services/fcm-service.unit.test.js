/**
 * Unit tests (atualizados) para FCM service.
 */

jest.mock('firebase-admin', () => ({
  apps: ['mock-app'],
  messaging: jest.fn(() => ({
    send: jest.fn().mockResolvedValue('msg-id'),
    sendToTopic: jest.fn().mockResolvedValue('topic-msg-id')
  })),
  initializeApp: jest.fn(),
  credential: { cert: jest.fn(() => ({})) }
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  logStructured: jest.fn()
}));

jest.mock('../../../services/circuit-breaker-service', () => ({
  execute: jest.fn((name, fn) => fn())
}));

describe('fcm-service', () => {
  let FCMService;
  let fcmService;
  let mockRedis;
  let admin;

  beforeEach(() => {
    jest.resetModules();
    FCMService = require('../../../services/fcm-service');
    admin = require('firebase-admin');
    mockRedis = {
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      hdel: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      scard: jest.fn().mockResolvedValue(0),
      scan: jest.fn().mockResolvedValue(['0', []]),
      expire: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn()
    };
    fcmService = new FCMService(mockRedis);
    fcmService.isInitialized = true;
  });

  test('should create service instance and expose expected API', () => {
    expect(fcmService).toBeDefined();
    expect(typeof fcmService.saveUserFCMToken).toBe('function');
    expect(typeof fcmService.sendNotificationToUser).toBe('function');
    expect(typeof fcmService.destroy).toBe('function');
  });

  test('saveUserFCMToken should persist token in redis', async () => {
    const ok = await fcmService.saveUserFCMToken('u1', 'driver', 'token-1');
    expect(ok).toBe(true);
    expect(mockRedis.hset).toHaveBeenCalled();
    expect(mockRedis.sadd).toHaveBeenCalledWith('active_fcm_tokens', 'token-1');
    expect(mockRedis.sadd).toHaveBeenCalledWith('fcm_token_users:token-1', 'u1');
  });

  test('sendNotificationToUser should return unavailable when service is down', async () => {
    fcmService.isInitialized = false;
    const result = await fcmService.sendNotificationToUser('u1', { title: 'x', body: 'y' });
    expect(result).toHaveProperty('success', false);
  });

  test('sendNotificationToUser exposes only a token fingerprint in results and logs', async () => {
    const rawToken = 'fcm-secret-token-that-must-not-be-logged';
    fcmService.resolveUserTokens = jest.fn().mockResolvedValue([{ fcmToken: rawToken }]);

    const result = await fcmService.sendNotificationToUser('u1', {
      title: 'Ride update',
      body: 'Driver accepted'
    });

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(result.results).toEqual([
      expect.objectContaining({
        tokenFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
        success: true
      })
    ]);
    expect(JSON.stringify(result)).not.toContain(rawToken);

    const { logStructured } = require('../../../utils/logger');
    expect(JSON.stringify(logStructured.mock.calls)).not.toContain(rawToken);
  });

  test('sendRideStatusUpdate should fail when no token sends successfully', async () => {
    admin.messaging.mockReturnValue({
      send: jest.fn().mockRejectedValue(new Error('send failed'))
    });
    fcmService.resolveUserTokens = jest.fn().mockResolvedValue([{ fcmToken: 'token-1' }]);

    const result = await fcmService.sendRideStatusUpdate('u1', {
      bookingId: 'b1',
      status: 'accepted'
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      count: 0
    }));
  });

  test('removeUserFCMToken keeps token active when another user still owns it', async () => {
    mockRedis.smembers.mockResolvedValue(['real-user']);

    const result = await fcmService.removeUserFCMToken('temp-user', 'token-1');

    expect(result).toBe(true);
    expect(mockRedis.hdel).toHaveBeenCalledWith('fcm_tokens:temp-user', 'token-1');
    expect(mockRedis.srem).toHaveBeenCalledWith('fcm_token_users:token-1', 'temp-user');
    expect(mockRedis.srem).not.toHaveBeenCalledWith('active_fcm_tokens', 'token-1');
  });

  test('removeUserFCMToken removes token from active set when no owners remain', async () => {
    mockRedis.smembers.mockResolvedValue([]);

    const result = await fcmService.removeUserFCMToken('only-user', 'token-2');

    expect(result).toBe(true);
    expect(mockRedis.srem).toHaveBeenCalledWith('active_fcm_tokens', 'token-2');
  });

  test('getServiceStats should count users with SCAN instead of KEYS', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['42', ['fcm_tokens:u1']])
      .mockResolvedValueOnce(['0', ['fcm_tokens:u2']]);
    mockRedis.keys = jest.fn();

    const result = await fcmService.getServiceStats();

    expect(result.totalUsers).toBe(2);
    expect(mockRedis.scan).toHaveBeenCalled();
    expect(mockRedis.keys).not.toHaveBeenCalled();
  });

  test('destroy should disconnect redis client', () => {
    fcmService.destroy();
    expect(mockRedis.disconnect).toHaveBeenCalled();
  });
  test('stale device tokens do not count as service failures and are removed; the valid token still receives', async () => {
    const circuitBreaker = require('../../../services/circuit-breaker-service');
    // Breaker real o bastante para o caso: abre após 5 falhas e passa a usar o fallback.
    let failures = 0;
    circuitBreaker.execute.mockImplementation(async (name, fn, fallback) => {
      if (failures >= 5) return fallback();
      try {
        return await fn();
      } catch (error) {
        failures += 1;
        return fallback(error);
      }
    });

    const staleTokens = ['stale-1', 'stale-2', 'stale-3', 'stale-4', 'stale-5', 'stale-6'];
    const send = jest.fn(async (message) => {
      if (staleTokens.includes(message.token)) {
        const error = new Error('NotRegistered');
        error.code = 'messaging/registration-token-not-registered';
        throw error;
      }
      return 'msg-valid';
    });
    admin.messaging.mockReturnValue({ send });
    fcmService.resolveUserTokens = jest.fn().mockResolvedValue(
      [...staleTokens, 'valid-token'].map((fcmToken) => ({ fcmToken }))
    );
    fcmService.removeInvalidToken = jest.fn().mockResolvedValue(undefined);

    const result = await fcmService.sendNotificationToUser('u1', { title: 'Nova corrida', body: 'x', data: {} });

    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ total: 7, success: 1, failed: 6 });
    expect(failures).toBe(0);
    expect(fcmService.removeInvalidToken.mock.calls.map(([token]) => token)).toEqual(staleTokens);
  });

  test('a real FCM outage still counts as a failure for the breaker', async () => {
    const circuitBreaker = require('../../../services/circuit-breaker-service');
    const fallback = jest.fn();
    circuitBreaker.execute.mockImplementation(async (name, fn) => {
      try {
        return await fn();
      } catch (error) {
        fallback(error.message);
        throw error;
      }
    });
    admin.messaging.mockReturnValue({ send: jest.fn().mockRejectedValue(new Error('UNAVAILABLE')) });
    fcmService.removeInvalidToken = jest.fn();

    const result = await fcmService.sendToToken('valid-token', { title: 't', body: 'b', data: {} });

    expect(result).toEqual({ success: false, error: 'UNAVAILABLE' });
    expect(fallback).toHaveBeenCalledWith('UNAVAILABLE');
    expect(fcmService.removeInvalidToken).not.toHaveBeenCalled();
  });
  test('a time-limited notice carries its expiry and collapse key on both platforms', async () => {
    const send = jest.fn().mockResolvedValue('msg-id');
    admin.messaging.mockReturnValue({ send });

    await fcmService.sendToToken('token-1', {
      title: 'Nova corrida',
      body: 'x',
      data: { type: 'ride_offer' },
      collapseKey: 'leaf-ride-offer',
      ttlSeconds: 20
    });
    await fcmService.sendToToken('token-1', { title: 'Outro', body: 'y', data: {} });

    const [timed] = send.mock.calls[0];
    expect(timed.android.ttl).toBe(20000);
    expect(timed.android.collapseKey).toBe('leaf-ride-offer');
    expect(timed.android.notification.tag).toBe('leaf-ride-offer');
    expect(timed.apns.headers['apns-collapse-id']).toBe('leaf-ride-offer');
    expect(Number(timed.apns.headers['apns-expiration'])).toBeGreaterThan(Date.now() / 1000);

    const [plain] = send.mock.calls[1];
    expect(plain.android.ttl).toBeUndefined();
    expect(plain.android.notification.tag).toBeUndefined();
    expect(plain.apns.headers).toBeUndefined();
  });
});
