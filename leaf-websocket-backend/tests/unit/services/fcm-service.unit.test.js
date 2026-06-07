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

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false)
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
  let circuitBreakerService;

  beforeEach(() => {
    jest.resetModules();
    FCMService = require('../../../services/fcm-service');
    admin = require('firebase-admin');
    circuitBreakerService = require('../../../services/circuit-breaker-service');
    mockRedis = {
      hset: jest.fn().mockResolvedValue(1),
      hincrby: jest.fn().mockResolvedValue(1),
      hget: jest.fn().mockResolvedValue(null),
      hgetall: jest.fn().mockResolvedValue({}),
      hdel: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      scard: jest.fn().mockResolvedValue(0),
      scan: jest.fn().mockResolvedValue(['0', []]),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
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

  test('initialize should prefer configured Firebase credentials path', async () => {
    const fs = require('fs');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/app/firebase-credentials.json';
    fs.existsSync.mockImplementation((candidate) => candidate === '/app/firebase-credentials.json');
    admin.apps = [];
    admin.initializeApp.mockClear();
    admin.credential.cert.mockClear();

    fcmService.isInitialized = false;
    await fcmService.initialize();

    expect(admin.credential.cert).toHaveBeenCalledWith('/app/firebase-credentials.json');
    expect(admin.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.any(Object)
    }));
    expect(fcmService.isInitialized).toBe(true);

    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  test('saveUserFCMToken should persist token in redis', async () => {
    const ok = await fcmService.saveUserFCMToken('u1', 'driver', 'token-1');
    expect(ok).toBe(true);
    expect(mockRedis.hset).toHaveBeenCalled();
    expect(mockRedis.sadd).toHaveBeenCalledWith('active_fcm_tokens', 'token-1');
    expect(mockRedis.sadd).toHaveBeenCalledWith('fcm_token_users:token-1', 'u1');
  });

  test('resolveUserTokens should prefer current canonical driver token over stale indexed tokens', async () => {
    mockRedis.hgetall.mockImplementation((key) => {
      if (key === 'fcm_tokens:driver-1') {
        return Promise.resolve({
          'old-android-token': JSON.stringify({
            userId: 'driver-1',
            userType: 'driver',
            fcmToken: 'old-android-token',
            platform: 'android',
            lastUpdated: '2026-06-01T10:00:00.000Z',
            isActive: true
          })
        });
      }
      if (key === 'driver:driver-1') {
        return Promise.resolve({
          fcmToken: 'fresh-ios-token',
          fcmPlatform: 'ios',
          fcmTokenUpdated: '2026-06-07T04:33:03.866Z'
        });
      }
      if (key === 'user:driver-1') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const tokens = await fcmService.resolveUserTokens('driver-1');

    expect(tokens.map((tokenData) => tokenData.fcmToken)).toEqual([
      'fresh-ios-token',
      'old-android-token'
    ]);
    expect(tokens[0]).toEqual(expect.objectContaining({
      source: 'driver:driver-1',
      platform: 'ios',
      migratedFromCanonical: true
    }));
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'fcm_tokens:driver-1',
      'fresh-ios-token',
      expect.any(String)
    );
  });

  test('resolveUserTokens should dedupe canonical token already present in multi-device index', async () => {
    mockRedis.hgetall.mockImplementation((key) => {
      if (key === 'fcm_tokens:driver-1') {
        return Promise.resolve({
          'fresh-ios-token': JSON.stringify({
            userId: 'driver-1',
            userType: 'driver',
            fcmToken: 'fresh-ios-token',
            platform: 'ios',
            lastUpdated: '2026-06-07T04:33:03.866Z',
            isActive: true
          })
        });
      }
      if (key === 'driver:driver-1') {
        return Promise.resolve({
          fcmToken: 'fresh-ios-token',
          fcmPlatform: 'ios',
          fcmTokenUpdated: '2026-06-07T04:33:03.866Z'
        });
      }
      if (key === 'user:driver-1') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const tokens = await fcmService.resolveUserTokens('driver-1');

    expect(tokens.map((tokenData) => tokenData.fcmToken)).toEqual(['fresh-ios-token']);
    expect(mockRedis.hset).not.toHaveBeenCalledWith(
      'fcm_tokens:driver-1',
      'fresh-ios-token',
      expect.any(String)
    );
  });

  test('sendNotificationToUser should return unavailable when service is down', async () => {
    fcmService.isInitialized = false;
    const result = await fcmService.sendNotificationToUser('u1', { title: 'x', body: 'y' });
    expect(result).toHaveProperty('success', false);
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

  test('sendRideStatusUpdate forwards ride timeline metadata for persistent notifications', async () => {
    const send = jest.fn().mockResolvedValue('msg-id');
    admin.messaging.mockReturnValue({ send });
    fcmService.resolveUserTokens = jest.fn().mockResolvedValue([{ fcmToken: 'token-1' }]);

    const result = await fcmService.sendRideStatusUpdate('u1', {
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
      pickupEstimatedTime: 4,
      tripEstimatedTime: 18,
      phaseStartedAt: '2026-06-05T19:00:00.000Z',
      pickup: { address: 'Rua de Partida, 100' },
      destination: { address: 'Leblon' },
    });

    expect(result.success).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'ride_status_update',
        bookingId: 'booking-1',
        status: 'accepted',
        userType: 'customer',
        pickupEstimatedTime: '4',
        tripEstimatedTime: '18',
        phaseStartedAt: '2026-06-05T19:00:00.000Z',
        pickup: JSON.stringify({ address: 'Rua de Partida, 100' }),
        destination: JSON.stringify({ address: 'Leblon' }),
      }),
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
    mockRedis.hgetall.mockResolvedValueOnce({
      totalSent: '3',
      successful: '2',
      failed: '1',
      tokenRegistrations: '4'
    });
    mockRedis.keys = jest.fn();

    const result = await fcmService.getServiceStats();

    expect(result.totalUsers).toBe(2);
    expect(result.totalSent).toBe(3);
    expect(result.successful).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.delivery.tokenRegistrations).toBe(4);
    expect(mockRedis.scan).toHaveBeenCalled();
    expect(mockRedis.keys).not.toHaveBeenCalled();
  });

  test('sendToToken records delivery counters in Redis', async () => {
    const result = await fcmService.sendToToken('token-5', {
      title: 'Teste',
      body: 'Mensagem',
      data: { type: 'test' }
    });

    expect(result.success).toBe(true);
    expect(mockRedis.hincrby).toHaveBeenCalledWith(
      expect.stringMatching(/^fcm_metrics:\d{4}-\d{2}-\d{2}$/),
      'totalSent',
      1
    );
    expect(mockRedis.hincrby).toHaveBeenCalledWith(
      expect.stringMatching(/^fcm_metrics:\d{4}-\d{2}-\d{2}$/),
      'successful',
      1
    );
    expect(circuitBreakerService.execute).toHaveBeenCalledWith(
      'fcm_send',
      expect.any(Function),
      null,
      expect.objectContaining({ failureThreshold: 5 })
    );
  });

  test('sendToToken should remove invalid FCM token from original Firebase error', async () => {
    admin.messaging.mockReturnValue({
      send: jest.fn().mockRejectedValue(Object.assign(new Error('Requested entity was not found.'), {
        code: 'messaging/registration-token-not-registered'
      }))
    });
    mockRedis.smembers.mockResolvedValue(['u1']);
    mockRedis.hget.mockImplementation((key, field) => {
      if (field !== 'fcmToken') return Promise.resolve(null);
      if (key === 'user:u1') return Promise.resolve('dead-token');
      return Promise.resolve(null);
    });

    const result = await fcmService.sendToToken('dead-token', {
      title: 'Teste',
      body: 'Mensagem',
      data: { type: 'test' }
    });

    expect(result.success).toBe(false);
    expect(mockRedis.srem).toHaveBeenCalledWith('active_fcm_tokens', 'dead-token');
    expect(mockRedis.hdel).toHaveBeenCalledWith('fcm_tokens:u1', 'dead-token');
    expect(mockRedis.hdel).toHaveBeenCalledWith('user:u1', 'fcmToken');
  });

  test('removeInvalidToken clears canonical indexes and matching legacy fcmToken fields', async () => {
    mockRedis.smembers.mockResolvedValue(['u1']);
    mockRedis.hget.mockImplementation((key, field) => {
      if (field !== 'fcmToken') return Promise.resolve(null);
      if (key === 'user:u1') return Promise.resolve('dead-token');
      if (key === 'driver:u1') return Promise.resolve('other-token');
      return Promise.resolve(null);
    });

    await fcmService.removeInvalidToken('dead-token');

    expect(mockRedis.srem).toHaveBeenCalledWith('active_fcm_tokens', 'dead-token');
    expect(mockRedis.hdel).toHaveBeenCalledWith('fcm_tokens:u1', 'dead-token');
    expect(mockRedis.hdel).toHaveBeenCalledWith('user:u1', 'fcmToken');
    expect(mockRedis.hdel).not.toHaveBeenCalledWith('driver:u1', 'fcmToken');
    expect(mockRedis.del).toHaveBeenCalledWith('fcm_token_users:dead-token');
  });

  test('destroy should disconnect redis client', () => {
    fcmService.destroy();
    expect(mockRedis.disconnect).toHaveBeenCalled();
  });
});
