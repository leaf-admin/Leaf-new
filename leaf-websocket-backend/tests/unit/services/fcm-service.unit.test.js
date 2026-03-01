/**
 * Unit Tests for FCM Service
 */

const FCMService = require('../../../services/fcm-service');

// Mock do Firebase Admin
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(() => 'mock-credential')
  },
  messaging: jest.fn(() => ({
    send: jest.fn(),
    sendMulticast: jest.fn(),
    sendToDevice: jest.fn()
  }))
}));

// Mock do ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    hget: jest.fn(),
    hset: jest.fn(),
    zincrby: jest.fn(),
    zscore: jest.fn(),
    zremrangebyscore: jest.fn()
  }));
});

// Mock dos serviços dependentes
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  logStructured: jest.fn()
}));

jest.mock('../../../utils/trace-context', () => ({
  getCurrentTraceId: jest.fn(() => 'test-trace-id')
}));

jest.mock('../../../services/circuit-breaker-service', () => ({
  isServiceAvailable: jest.fn(() => true),
  recordFailure: jest.fn(),
  recordSuccess: jest.fn()
}));

// Mock do path e fs para evitar problemas com arquivos
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/'))
}));

const mockFirebaseAdmin = require('firebase-admin');
const mockCircuitBreaker = require('../../../services/circuit-breaker-service');
const mockLogger = require('../../../utils/logger');

describe('FCMService', () => {
  let fcmService;
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();

    // Criar nova instância
    fcmService = new FCMService();
    mockRedis = fcmService.redis;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('should create FCMService instance', () => {
      expect(fcmService).toBeDefined();
      expect(fcmService.redis).toBeDefined();
      expect(fcmService.isInitialized).toBe(false);
      expect(fcmService.rateLimitCounts).toBeInstanceOf(Map);
    });

    test('should check service availability', () => {
      // Service não inicializado
      expect(fcmService.isServiceAvailable()).toBe(false);

      // Service inicializado
      fcmService.isInitialized = true;
      mockFirebaseAdmin.apps = ['app'];
      expect(fcmService.isServiceAvailable()).toBe(true);

      // Firebase não disponível
      mockFirebaseAdmin.apps = [];
      expect(fcmService.isServiceAvailable()).toBe(false);
    });
  });

  describe('Token Management', () => {
    beforeEach(() => {
      fcmService.isInitialized = true;
      mockFirebaseAdmin.apps = ['app'];
    });

    test('should save user FCM token successfully', async () => {
      const userId = 'user123';
      const userType = 'passenger';
      const fcmToken = 'fcm-token-abc';

      mockRedis.hset.mockResolvedValue(1);
      mockRedis.sadd.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await fcmService.saveUserFCMToken(userId, userType, fcmToken);

      expect(result).toBe(true);
      expect(mockRedis.hset).toHaveBeenCalledWith(
        'fcm_tokens:user123',
        fcmToken,
        expect.any(String)
      );
      expect(mockRedis.sadd).toHaveBeenCalledWith('active_fcm_tokens', fcmToken);
      expect(mockRedis.expire).toHaveBeenCalledWith('fcm_tokens:user123', 2592000);
    });

    test('should reject empty FCM token', async () => {
      const userId = 'user123';
      const userType = 'passenger';
      const fcmToken = '';

      const result = await fcmService.saveUserFCMToken(userId, userType, fcmToken);

      expect(result).toBe(false);
    });

    test('should get user FCM tokens', async () => {
      const userId = 'user123';
      const mockTokens = {
        'token1': JSON.stringify({ userId: 'user123', isActive: true }),
        'token2': JSON.stringify({ userId: 'user123', isActive: false })
      };

      mockRedis.hgetall.mockResolvedValue(mockTokens);

      const tokens = await fcmService.getUserFCMTokens(userId);

      expect(mockRedis.hgetall).toHaveBeenCalledWith('fcm_tokens:user123');
      expect(tokens).toBeInstanceOf(Array);
      expect(tokens.length).toBeGreaterThan(0);
    });

    test('should remove user FCM token', async () => {
      const userId = 'user123';
      const fcmToken = 'token-to-remove';

      mockRedis.hdel.mockResolvedValue(1);
      mockRedis.srem.mockResolvedValue(1);

      const result = await fcmService.removeUserFCMToken(userId, fcmToken);

      expect(result).toBe(true);
      expect(mockRedis.hdel).toHaveBeenCalledWith('fcm_tokens:user123', fcmToken);
      expect(mockRedis.srem).toHaveBeenCalledWith('active_fcm_tokens', fcmToken);
    });
  });

  describe('Notification Sending', () => {
    beforeEach(() => {
      fcmService.isInitialized = true;
      mockFirebaseAdmin.apps = ['app'];
    });

    test('should send notification to user', async () => {
      const userId = 'user123';
      const notification = {
        title: 'Test Notification',
        body: 'Test message',
        data: { rideId: '123' }
      };

      // Mock para ter tokens
      mockRedis.hgetall.mockResolvedValue({
        'token1': JSON.stringify({ userId: 'user123', isActive: true })
      });

      mockFirebaseAdmin.messaging().send.mockResolvedValue('message-id-123');

      const result = await fcmService.sendNotificationToUser(userId, notification);

      expect(result).toBeDefined();
      expect(mockRedis.hgetall).toHaveBeenCalledWith('fcm_tokens:user123');
    });

    test('should not send when service unavailable', async () => {
      fcmService.isInitialized = false;

      const result = await fcmService.sendNotificationToUser('user123', {
        title: 'Test',
        body: 'Test'
      });

      expect(result).toBe(false);
    });

    test('should send to specific token', async () => {
      const fcmToken = 'token-abc';
      const notification = {
        title: 'Direct Notification',
        body: 'Direct message'
      };

      mockFirebaseAdmin.messaging().send.mockResolvedValue('message-id-123');

      const result = await fcmService.sendToToken(fcmToken, notification);

      expect(result).toBe(true);
      expect(mockFirebaseAdmin.messaging().send).toHaveBeenCalled();
    });

    test('should send to topic', async () => {
      const topic = 'drivers';
      const notification = {
        title: 'Topic Notification',
        body: 'Message to all drivers'
      };

      mockFirebaseAdmin.messaging().sendToTopic.mockResolvedValue('topic-message-id');

      const result = await fcmService.sendToTopic(topic, notification);

      expect(result).toBe(true);
      expect(mockFirebaseAdmin.messaging().sendToTopic).toHaveBeenCalledWith(topic, expect.any(Object));
    });
  });

  describe('Rate Limiting', () => {
    test('should check rate limit', () => {
      const result = fcmService.checkRateLimit('user123');

      expect(typeof result).toBe('boolean');
    });
  });

  describe('Trip Notifications', () => {
    beforeEach(() => {
      fcmService.isInitialized = true;
      mockFirebaseAdmin.apps = ['app'];
    });

    test('should create trip notification', () => {
      const tripData = {
        id: 'trip123',
        status: 'accepted',
        driverName: 'João Silva'
      };
      const notificationType = 'accepted';

      const notification = fcmService.createTripNotification(tripData, notificationType);

      expect(notification).toHaveProperty('title');
      expect(notification).toHaveProperty('body');
      expect(notification).toHaveProperty('data');
    });

    test('should send trip notification', async () => {
      const userId = 'user123';
      const tripData = {
        id: 'trip123',
        status: 'started'
      };
      const notificationType = 'started';

      mockRedis.hgetall.mockResolvedValue({
        'token1': JSON.stringify({ userId: 'user123', isActive: true })
      });

      mockFirebaseAdmin.messaging().send.mockResolvedValue('message-id-123');

      const result = await fcmService.sendTripNotification(userId, tripData, notificationType);

      expect(result).toBeDefined();
    });
  });

  describe('Cleanup', () => {
    test('should destroy service', () => {
      fcmService.destroy();

      expect(mockRedis.disconnect).toHaveBeenCalled();
    });
  });
});
