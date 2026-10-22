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
  test('when the breaker falls back after a send failure, the original FCM error and code reach the log', async () => {
    const circuitBreaker = require('../../../services/circuit-breaker-service');
    // Como o breaker real: o fallback é chamado sem argumentos.
    circuitBreaker.execute.mockImplementation(async (name, fn, fallback) => {
      try {
        return await fn();
      } catch (error) {
        return fallback();
      }
    });
    const sendError = new Error('Request contains an invalid argument.');
    sendError.code = 'messaging/internal-error';
    admin.messaging.mockReturnValue({ send: jest.fn().mockRejectedValue(sendError) });

    const result = await fcmService.sendToToken('token-1', { title: 't', body: 'b', data: {} });

    expect(result).toEqual({ success: false, error: 'Request contains an invalid argument.' });
    const { logStructured } = require('../../../utils/logger');
    expect(logStructured).toHaveBeenCalledWith('error', 'Erro ao enviar notificação FCM', expect.objectContaining({
      error: 'Request contains an invalid argument.',
      errorCode: 'messaging/internal-error'
    }));
  });

  test('with the breaker open (no send), the fallback stays generic', async () => {
    const circuitBreaker = require('../../../services/circuit-breaker-service');
    circuitBreaker.execute.mockImplementation(async (name, fn, fallback) => fallback());
    const send = jest.fn();
    admin.messaging.mockReturnValue({ send });

    const result = await fcmService.sendToToken('token-1', { title: 't', body: 'b', data: {} });

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'Serviço de notificações temporariamente indisponível' });
  });

  test('a 400 for a malformed token is an invalid token; a 400 for a bad payload is not', async () => {
    const circuitBreaker = require('../../../services/circuit-breaker-service');
    let failures = 0;
    circuitBreaker.execute.mockImplementation(async (name, fn, fallback) => {
      try {
        return await fn();
      } catch (error) {
        failures += 1;
        return fallback();
      }
    });
    const badToken = new Error('The registration token is not a valid FCM registration token');
    badToken.code = 'messaging/invalid-argument';
    const badPayload = new Error('Invalid JSON payload received. Unknown name "actions" at \'message.android.notification\'');
    badPayload.code = 'messaging/invalid-argument';
    admin.messaging.mockReturnValue({
      send: jest.fn(async (message) => {
        throw message.token === 'malformed-token' ? badToken : badPayload;
      })
    });
    fcmService.removeInvalidToken = jest.fn().mockResolvedValue(undefined);

    await fcmService.sendToToken('malformed-token', { title: 't', body: 'b', data: {} });
    expect(failures).toBe(0);
    expect(fcmService.removeInvalidToken).toHaveBeenCalledWith('malformed-token');

    await fcmService.sendToToken('good-token', { title: 't', body: 'b', data: {} });
    expect(failures).toBe(1);
    expect(fcmService.removeInvalidToken).toHaveBeenCalledTimes(1);
  });

  test('a dead token is logged as a warning, not as an error that reaches Sentry', async () => {
    const circuitBreaker = require('../../../services/circuit-breaker-service');
    circuitBreaker.execute.mockImplementation(async (name, fn, fallback) => {
      try {
        return await fn();
      } catch (error) {
        return fallback();
      }
    });
    const deadToken = new Error('NotRegistered');
    deadToken.code = 'messaging/registration-token-not-registered';
    const outage = new Error('UNAVAILABLE');
    outage.code = 'messaging/server-unavailable';
    admin.messaging.mockReturnValue({
      send: jest.fn(async (message) => { throw message.token === 'dead-token' ? deadToken : outage; })
    });
    fcmService.removeInvalidToken = jest.fn().mockResolvedValue(undefined);
    const { logStructured } = require('../../../utils/logger');
    logStructured.mockClear();

    await fcmService.sendToToken('dead-token', { title: 't', body: 'b', data: {} });
    await fcmService.sendInteractiveNotification('dead-token', { title: 't', body: 'b', data: {} }, []);
    await fcmService.sendToToken('live-token', { title: 't', body: 'b', data: {} });

    const levels = logStructured.mock.calls
      .filter(([, message]) => String(message).startsWith('Erro ao enviar notificação FCM'))
      .map(([level, message]) => `${level}:${message}`);
    expect(levels).toEqual([
      'warn:Erro ao enviar notificação FCM',
      'warn:Erro ao enviar notificação FCM interativa',
      'error:Erro ao enviar notificação FCM'
    ]);
    expect(fcmService.removeInvalidToken).toHaveBeenCalledTimes(2);
  });

  test('removeInvalidToken also clears the legacy user:/driver: token, so resolveUserTokens does not bring it back', async () => {
    mockRedis.smembers.mockResolvedValue(['u1']);
    mockRedis.del = jest.fn().mockResolvedValue(1);
    mockRedis.hget = jest.fn(async (key) => (key === 'driver:u1' ? 'dead-token' : 'other-token'));

    await fcmService.removeInvalidToken('dead-token');

    expect(mockRedis.hdel).toHaveBeenCalledWith('fcm_tokens:u1', 'dead-token');
    expect(mockRedis.hdel).toHaveBeenCalledWith('driver:u1', 'fcmToken');
    expect(mockRedis.hdel).not.toHaveBeenCalledWith('user:u1', 'fcmToken');

    mockRedis.hgetall.mockResolvedValue({});
    mockRedis.hget.mockResolvedValue(null);
    const tokens = await fcmService.resolveUserTokens('u1');
    expect(tokens.map((t) => t.fcmToken)).not.toContain('dead-token');
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

  test('initialize uses the shared Firebase credentials when no app exists yet (workers)', async () => {
    jest.resetModules();
    const initializeFirebase = jest.fn(() => ({ name: '[DEFAULT]' }));
    jest.doMock('../../../firebase-config', () => ({ initializeFirebase }));
    const freshAdmin = require('firebase-admin');
    freshAdmin.apps.length = 0;
    try {
      const FreshFCMService = require('../../../services/fcm-service');
      const service = new FreshFCMService(mockRedis);
      await service.initialize();

      expect(initializeFirebase).toHaveBeenCalledTimes(1);
      expect(freshAdmin.initializeApp).not.toHaveBeenCalled();
      expect(service.isInitialized).toBe(true);
    } finally {
      freshAdmin.apps.push('mock-app');
    }
  });

  test('initialize stays unavailable when the shared Firebase credentials fail', async () => {
    jest.resetModules();
    jest.doMock('../../../firebase-config', () => ({ initializeFirebase: jest.fn(() => null) }));
    const freshAdmin = require('firebase-admin');
    freshAdmin.apps.length = 0;
    try {
      const FreshFCMService = require('../../../services/fcm-service');
      const service = new FreshFCMService(mockRedis);
      await service.initialize();

      expect(service.isInitialized).toBe(false);
    } finally {
      freshAdmin.apps.push('mock-app');
    }
  });

  test('interactive pushes carry the actions in data, never in android.notification (FCM rejects it)', async () => {
    const send = jest.fn().mockResolvedValue('msg-id');
    admin.messaging.mockReturnValue({ send });
    const actions = [{ id: 'accept', title: 'Aceitar' }, { id: 'reject', title: 'Recusar' }];

    await fcmService.sendInteractiveNotification('token-1', { title: 'Nova corrida', body: 'x', data: { type: 'ride_offer' } }, actions, 'RIDE_OFFER');
    await fcmService.sendToToken('token-1', { title: 'Outro', body: 'y', data: {}, actions });

    for (const [message] of send.mock.calls) {
      expect(message.android.notification.actions).toBeUndefined();
      expect(message.data.hasActions).toBe('true');
      expect(JSON.parse(message.data.actions)).toEqual(actions);
      Object.values(message.data).forEach((value) => expect(typeof value).toBe('string'));
    }
  });
});
