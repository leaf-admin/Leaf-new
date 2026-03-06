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

describe('fcm-service', () => {
  let FCMService;
  let fcmService;
  let mockRedis;

  beforeEach(() => {
    jest.resetModules();
    FCMService = require('../../../services/fcm-service');
    mockRedis = {
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      hdel: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
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
  });

  test('sendNotificationToUser should return unavailable when service is down', async () => {
    fcmService.isInitialized = false;
    const result = await fcmService.sendNotificationToUser('u1', { title: 'x', body: 'y' });
    expect(result).toHaveProperty('success', false);
  });

  test('destroy should disconnect redis client', () => {
    fcmService.destroy();
    expect(mockRedis.disconnect).toHaveBeenCalled();
  });
});
