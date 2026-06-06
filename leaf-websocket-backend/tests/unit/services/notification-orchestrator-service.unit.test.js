const NotificationOrchestratorService = require('../../../services/notification-orchestrator-service');

function createRedisMock() {
  const values = new Map();
  const hashes = new Map();

  return {
    status: 'ready',
    connect: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(async (key, value, mode) => {
      if (mode === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    incr: jest.fn(async (key) => {
      const next = Number(values.get(key) || 0) + 1;
      values.set(key, String(next));
      return next;
    }),
    expire: jest.fn().mockResolvedValue(1),
    hincrby: jest.fn(async (key, field, amount) => {
      const hash = hashes.get(key) || {};
      hash[field] = String(Number(hash[field] || 0) + Number(amount));
      hashes.set(key, hash);
      return Number(hash[field]);
    }),
    hset: jest.fn(async (key, payload) => {
      hashes.set(key, { ...(hashes.get(key) || {}), ...payload });
      return 1;
    }),
    hgetall: jest.fn(async (key) => hashes.get(key) || {}),
    lpush: jest.fn().mockResolvedValue(1),
    ltrim: jest.fn().mockResolvedValue('OK')
  };
}

function createService(options = {}) {
  const redis = options.redis || createRedisMock();
  const fcmService = options.fcmService || {
    setRedis: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    sendNotificationToUser: jest.fn().mockResolvedValue({ success: true, messageId: 'msg_1' })
  };
  const service = new NotificationOrchestratorService({
    redis,
    fcmService,
    now: () => new Date('2026-06-06T12:00:00.000Z'),
    ...options
  });
  return { service, redis, fcmService };
}

describe('notification-orchestrator-service', () => {
  it('exposes a versioned lifecycle matrix with critical events', () => {
    const { service } = createService();

    const matrix = service.getMatrix();

    expect(matrix.version).toContain('leaf-notification-orchestration');
    expect(matrix.events).toEqual(expect.objectContaining({
      'ride.accepted': expect.objectContaining({ category: 'ride_lifecycle' }),
      'payment.pix_approved': expect.objectContaining({ category: 'payment' }),
      'driver.document_pending': expect.objectContaining({ audience: ['driver'] }),
      'smart_push.driver_demand_recommendation': expect.objectContaining({ dryRunOnly: true })
    }));
  });

  it('builds user-friendly copy with context interpolation', () => {
    const { service } = createService();

    const notification = service.buildNotification('ride.offer_received', {
      pickupLabel: 'Copacabana',
      destinationLabel: 'Leblon',
      bookingId: 'booking_1'
    });

    expect(notification).toEqual(expect.objectContaining({
      title: 'Nova corrida disponivel',
      body: 'Copacabana para Leblon.',
      channelId: 'driver_offers',
      data: expect.objectContaining({
        eventType: 'ride.offer_received',
        bookingId: 'booking_1'
      })
    }));
  });

  it('suppresses duplicate dispatches by idempotency key before sending push again', async () => {
    const { service, fcmService } = createService();

    const first = await service.dispatchEvent({
      eventType: 'ride.accepted',
      userId: 'user_1',
      userType: 'passenger',
      context: { driverName: 'Carlos', bookingId: 'booking_1' },
      idempotencyKey: 'booking_1'
    });
    const second = await service.dispatchEvent({
      eventType: 'ride.accepted',
      userId: 'user_1',
      userType: 'passenger',
      context: { driverName: 'Carlos', bookingId: 'booking_1' },
      idempotencyKey: 'booking_1'
    });

    expect(first.status).toBe('sent');
    expect(second).toEqual(expect.objectContaining({
      success: true,
      status: 'suppressed',
      reason: 'duplicate'
    }));
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledTimes(1);
  });

  it('rate-limits noisy events even when idempotency keys differ', async () => {
    const matrix = {
      'test.noisy_event': {
        category: 'transactional',
        audience: ['passenger'],
        channels: ['push'],
        title: 'Teste',
        body: 'Mensagem',
        priority: 'normal',
        channelId: 'test',
        dedupeWindowSeconds: 1,
        rateLimit: { max: 1, windowSeconds: 60 },
        quietHours: false
      }
    };
    const { service, fcmService } = createService({ matrix });

    const first = await service.dispatchEvent({
      eventType: 'test.noisy_event',
      userId: 'user_1',
      userType: 'passenger',
      idempotencyKey: 'first'
    });
    const second = await service.dispatchEvent({
      eventType: 'test.noisy_event',
      userId: 'user_1',
      userType: 'passenger',
      idempotencyKey: 'second'
    });

    expect(first.status).toBe('sent');
    expect(second).toEqual(expect.objectContaining({
      status: 'suppressed',
      reason: 'rate_limited'
    }));
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledTimes(1);
  });

  it('respects marketing opt-out for campaign notifications', async () => {
    const { service, fcmService } = createService();

    const result = await service.dispatchEvent({
      eventType: 'campaign.available',
      userId: 'user_1',
      userType: 'passenger',
      context: {
        campaignTitle: 'Boa viagem',
        campaignBody: 'Tem novidade no app',
        campaignId: 'campaign_1'
      },
      preferences: { marketingOptIn: false }
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'suppressed',
      reason: 'marketing_opt_out'
    }));
    expect(fcmService.sendNotificationToUser).not.toHaveBeenCalled();
  });

  it('keeps smart push recommendations in dry-run mode', async () => {
    const { service, fcmService } = createService({ smartPushMode: 'enabled' });

    const result = await service.previewSmartPushRecommendation({
      userId: 'driver_1',
      recommendation: {
        score: 0.82,
        reason: 'Alta demanda prevista',
        campaignId: 'smart_1'
      },
      preferences: { marketingOptIn: true }
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      status: 'dry_run'
    }));
    expect(fcmService.sendNotificationToUser).not.toHaveBeenCalled();
  });
});
