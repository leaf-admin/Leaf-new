const registerSocketFcmHandlers = require('../../../bootstrap/register-socket-fcm-handlers');

describe('registerSocketFcmHandlers', () => {
  function buildHarness(socketOverrides = {}) {
    const listeners = {};
    const socket = {
      id: 'socket-123',
      on: jest.fn((event, handler) => {
        listeners[event] = handler;
      }),
      emit: jest.fn(),
      ...socketOverrides
    };
    const redis = {
      hset: jest.fn().mockResolvedValue(1)
    };
    const fcmService = {
      isServiceAvailable: jest.fn(() => true),
      setRedis: jest.fn(),
      initialize: jest.fn(),
      saveUserFCMToken: jest.fn().mockResolvedValue(true),
      removeUserFCMToken: jest.fn().mockResolvedValue(true)
    };
    const rideLiveActivityService = {
      setRedis: jest.fn(),
      saveToken: jest.fn().mockResolvedValue({
        success: true,
        activityId: 'ride:passenger:b1',
        bookingId: 'b1'
      })
    };

    registerSocketFcmHandlers({
      socket,
      redisPool: { getConnection: () => redis },
      fcmService,
      rideLiveActivityService,
      logStructured: jest.fn(),
      logError: jest.fn()
    });

    return { listeners, socket, redis, fcmService, rideLiveActivityService };
  }

  it('stores pre-auth tokens only under the socket temporary identity', async () => {
    const { listeners, socket, redis, fcmService } = buildHarness();

    await listeners.registerFCMToken({
      userId: 'victim-user',
      userType: 'driver',
      fcmToken: 'token-1',
      platform: 'ios'
    });

    expect(redis.hset).toHaveBeenCalledWith('user:temp_socket-123', expect.objectContaining({
      fcmToken: 'token-1',
      fcmPlatform: 'ios',
      isTemporary: 'true',
      socketId: 'socket-123'
    }));
    expect(fcmService.saveUserFCMToken).toHaveBeenCalledWith(
      'temp_socket-123',
      'temporary',
      'token-1',
      expect.objectContaining({
        isTemporary: true,
        socketId: 'socket-123',
        authenticated: false
      })
    );
    expect(socket.emit).toHaveBeenCalledWith('fcmTokenRegistered', expect.objectContaining({
      success: true,
      userId: 'temp_socket-123'
    }));
  });

  it('stores post-auth tokens only under the authenticated socket identity', async () => {
    const { listeners, socket, redis, fcmService } = buildHarness({
      userId: 'auth-user',
      userType: 'driver'
    });

    await listeners.registerFCMToken({
      userId: 'victim-user',
      userType: 'customer',
      fcmToken: 'token-2',
      platform: 'android'
    });

    expect(redis.hset).toHaveBeenCalledWith('driver:auth-user', expect.objectContaining({
      fcmToken: 'token-2',
      fcmPlatform: 'android',
      isTemporary: 'false',
      socketId: 'socket-123'
    }));
    expect(fcmService.saveUserFCMToken).toHaveBeenCalledWith(
      'auth-user',
      'driver',
      'token-2',
      expect.objectContaining({
        isTemporary: false,
        socketId: 'socket-123',
        authenticated: true
      })
    );
    expect(socket.emit).toHaveBeenCalledWith('fcmTokenRegistered', expect.objectContaining({
      success: true,
      userId: 'auth-user'
    }));
  });

  it('unregisters only the authenticated socket token owner', async () => {
    const { listeners, socket, fcmService } = buildHarness({
      userId: 'auth-user',
      userType: 'customer'
    });

    await listeners.unregisterFCMToken({
      userId: 'victim-user',
      fcmToken: 'token-3'
    });

    expect(fcmService.removeUserFCMToken).toHaveBeenCalledWith('auth-user', 'token-3');
    expect(socket.emit).toHaveBeenCalledWith('fcmTokenUnregistered', {
      success: true,
      userId: 'auth-user'
    });
  });

  it('unregisters pre-auth tokens only from the socket temporary identity', async () => {
    const { listeners, fcmService } = buildHarness();

    await listeners.unregisterFCMToken({
      userId: 'victim-user',
      fcmToken: 'token-4'
    });

    expect(fcmService.removeUserFCMToken).toHaveBeenCalledWith(
      'temp_socket-123',
      'token-4'
    );
  });

  it('stores Live Activity tokens under the authenticated socket identity', async () => {
    const { listeners, socket, rideLiveActivityService } = buildHarness({
      userId: 'auth-user',
      userType: 'customer'
    });

    await listeners.registerRideLiveActivityToken({
      userId: 'victim-user',
      bookingId: 'b1',
      activityId: 'ride:passenger:b1',
      pushToken: 'activity-token',
      platform: 'ios'
    });

    expect(rideLiveActivityService.saveToken).toHaveBeenCalledWith(
      'auth-user',
      'customer',
      expect.objectContaining({
        bookingId: 'b1',
        activityId: 'ride:passenger:b1',
        pushToken: 'activity-token',
        platform: 'ios'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith('rideLiveActivityTokenRegistered', expect.objectContaining({
      success: true,
      userId: 'auth-user',
      bookingId: 'b1'
    }));
  });
});
