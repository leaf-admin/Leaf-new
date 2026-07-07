jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  },
  logStructured: jest.fn()
}));

const RideLiveActivityService = require('../../../services/ride-live-activity-service');

describe('ride-live-activity-service', () => {
  const originalEnv = process.env;

  function buildRedis(overrides = {}) {
    return {
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      sadd: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      ...overrides
    };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-07T12:00:00.000Z'));
    process.env = { ...originalEnv };
    delete process.env.LEAF_APNS_KEY_ID;
    delete process.env.LEAF_APNS_TEAM_ID;
    delete process.env.LEAF_APNS_PRIVATE_KEY;
    delete process.env.LEAF_APNS_PRIVATE_KEY_PATH;
    delete process.env.LEAF_APNS_BUNDLE_ID;
    delete process.env.LEAF_APNS_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stores a ride live activity push token by booking and user', async () => {
    const redis = buildRedis();
    const service = new RideLiveActivityService(redis);

    const result = await service.saveToken('passenger-1', 'customer', {
      bookingId: 'booking-1',
      activityId: 'ride:passenger:booking-1',
      pushToken: 'activity-token',
      platform: 'ios'
    });

    expect(result).toEqual({
      success: true,
      activityId: 'ride:passenger:booking-1',
      bookingId: 'booking-1'
    });
    expect(redis.hset).toHaveBeenCalledWith(
      'ride_live_activity_tokens:booking-1',
      'ride:passenger:booking-1',
      expect.stringContaining('"pushToken":"activity-token"')
    );
    expect(redis.sadd).toHaveBeenCalledWith('ride_live_activity_user:passenger-1', 'ride:passenger:booking-1');
    expect(redis.expire).toHaveBeenCalledWith('ride_live_activity_tokens:booking-1', 86400);
    expect(redis.expire).toHaveBeenCalledWith('ride_live_activity_user:passenger-1', 86400);
  });

  it('builds update and terminal APNs payloads with normalized ride state', () => {
    const service = new RideLiveActivityService();

    const updatePayload = service.buildApnsPayload({
      status: 'motorista-a caminho',
      userType: 'customer',
      estimatedTime: 7.4,
      distance: 4.25,
      driverName: 'Ana'
    });
    const endPayload = service.buildApnsPayload({
      status: 'completed',
      userType: 'customer'
    });

    expect(updatePayload.aps).toMatchObject({
      timestamp: 1783425600,
      event: 'update',
      'stale-date': 1783426200,
      'content-state': {
        phase: 'motorista_a_caminho',
        etaText: '7 min',
        distanceText: '4,3 km',
        subtitle: 'Ana',
        progress: 0.25
      }
    });
    expect(endPayload.aps).toMatchObject({
      timestamp: 1783425600,
      event: 'end',
      'dismissal-date': 1783425660,
      'content-state': {
        phase: 'completed',
        progress: 1
      }
    });
  });

  it('skips APNs updates safely when no activity token or credentials are available', async () => {
    const redis = buildRedis({
      hgetall: jest.fn().mockResolvedValue({})
    });
    const service = new RideLiveActivityService(redis);

    await expect(service.sendRideStatusUpdate('passenger-1', {
      bookingId: 'booking-1',
      status: 'accepted'
    })).resolves.toEqual({
      success: false,
      skipped: true,
      reason: 'NO_LIVE_ACTIVITY_TOKEN',
      count: 0
    });

    redis.hgetall.mockResolvedValue({
      'ride:passenger:booking-1': JSON.stringify({
        userId: 'passenger-1',
        activityId: 'ride:passenger:booking-1',
        bookingId: 'booking-1',
        pushToken: 'activity-token'
      })
    });

    await expect(service.sendRideStatusUpdate('passenger-1', {
      bookingId: 'booking-1',
      status: 'accepted'
    })).resolves.toEqual({
      success: false,
      skipped: true,
      reason: 'APNS_NOT_CONFIGURED',
      count: 0
    });
  });

  it('sends APNs updates when credentials and matching tokens exist', async () => {
    process.env.LEAF_APNS_KEY_ID = 'key-id';
    process.env.LEAF_APNS_TEAM_ID = 'DTA8W5KA5D';
    process.env.LEAF_APNS_PRIVATE_KEY = [
      '-----BEGIN PRIVATE KEY-----',
      'fake-test-key',
      '-----END PRIVATE KEY-----'
    ].join('\\n');

    const redis = buildRedis({
      hgetall: jest.fn().mockResolvedValue({
        matching: JSON.stringify({
          userId: 'passenger-1',
          activityId: 'ride:passenger:booking-1',
          bookingId: 'booking-1',
          pushToken: 'activity-token'
        }),
        otherUser: JSON.stringify({
          userId: 'passenger-2',
          activityId: 'ride:passenger:booking-1',
          bookingId: 'booking-1',
          pushToken: 'other-token'
        }),
        invalid: '{'
      })
    });
    const service = new RideLiveActivityService(redis);
    jest.spyOn(service, 'sendApnsUpdate').mockResolvedValue({ success: true });

    const result = await service.sendRideStatusUpdate('passenger-1', {
      bookingId: 'booking-1',
      status: 'arrived'
    });

    expect(result).toEqual({
      success: true,
      count: 1,
      skipped: false
    });
    expect(service.sendApnsUpdate).toHaveBeenCalledTimes(1);
    expect(service.sendApnsUpdate).toHaveBeenCalledWith(
      'activity-token',
      expect.objectContaining({
        aps: expect.objectContaining({
          event: 'update',
          'content-state': expect.objectContaining({
            phase: 'arrived',
            title: 'Motorista chegou',
            progress: 0.52
          })
        })
      })
    );
  });
});
