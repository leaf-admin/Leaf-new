const { BackofficeCommandCenterService } = require('../../../services/backoffice-command-center-service');

function createRedisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK')
  };
}

function createService(overrides = {}) {
  const redis = createRedisMock();
  const opsGetOverview = jest.fn().mockResolvedValue({
    supportQueue: {
      totalOpenTickets: 4,
      backlogByPriority: { N1: 1, N2: 1, N3: 2 },
      overdueAckCount: 0,
      overdueFirstResponseCount: 1,
      ticketsWithoutOwner: 2,
      medianFirstResponseMinutes: 14
    },
    incidents: { openCount: 0 },
    rideHealth: { reassignmentPending: { total: 0 } },
    disputes: { openCount: 0 },
    activePolicies: []
  });
  const service = new BackofficeCommandCenterService({
    redis: {
      ensureConnection: jest.fn().mockResolvedValue(true),
      getConnection: jest.fn(() => redis)
    },
    metrics: {
      getUsersStatusStats: jest.fn().mockResolvedValue({
        customers: { total: 100, online: 8 },
        drivers: { total: 25, online: 7 }
      }),
      getRidesStats: jest.fn().mockResolvedValue({
        totalRides: 12,
        activeRides: 3,
        completedToday: 9,
        cancellationRate: 4.2
      }),
      getFinancialRidesStats: jest.fn().mockResolvedValue({
        totalValue: 450.25,
        totalRides: 9,
        averageValue: 50.03
      }),
      getOperationalFeeStats: jest.fn().mockResolvedValue({
        totalOperationalFee: 38.7,
        totalRides: 9,
        averageFee: 4.3
      })
    },
    ops: {
      getOverview: opsGetOverview
    },
    campaignCenter: {
      getStats: jest.fn().mockResolvedValue({
        total: 3,
        active: 2,
        paused: 1,
        impressions: 1200,
        clicks: 60,
        conversions: 12,
        ctr: 0.05,
        campaignValueCents: 150000,
        effectiveCpmCents: 125000,
        effectiveCpcCents: 2500
      })
    },
    health: {
      quickCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
    },
    workerHealthMonitor: {
      getHealth: jest.fn().mockResolvedValue({ status: 'healthy', consumers: { count: 2 } }),
      getStreamLag: jest.fn().mockResolvedValue({ lag: 0 }),
      getDLQSize: jest.fn().mockResolvedValue(0)
    },
    ...overrides
  });

  return { service, redis, opsGetOverview };
}

describe('backoffice-command-center-service', () => {
  it('builds one cached operational snapshot without external paid API calls', async () => {
    const { service, redis, opsGetOverview } = createService();

    const snapshot = await service.getSnapshot({ hours: 1, period: 'today' });

    expect(snapshot.success).toBe(true);
    expect(snapshot.status).toBe('warning');
    expect(snapshot.dailyMetrics).toMatchObject({
      activeDrivers: 7,
      activeRides: 3,
      ridesToday: 12,
      completedRidesToday: 9,
      gmvCents: 45025,
      grossRevenueCents: 3870,
      arpuBaseCents: 450,
      averageRideTicketCents: 5003
    });
    expect(snapshot.support.totalOpenTickets).toBe(4);
    expect(snapshot.campaigns.active).toBe(2);
    expect(snapshot.costControls.externalPaidApisCalled).toBe(false);
    expect(snapshot.costControls.paidApiFamilies).toEqual([]);
    expect(snapshot.cache.status).toBe('MISS');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(opsGetOverview).toHaveBeenCalledWith({ hours: 1, autoEscalate: false });
  });

  it('serves Redis cache before collecting sources', async () => {
    const cached = {
      success: true,
      generatedAt: new Date(Date.now() - 3000).toISOString(),
      status: 'healthy',
      scope: { ttlSeconds: 20 },
      dailyMetrics: { activeDrivers: 1 },
      costControls: { externalPaidApisCalled: false }
    };
    const metrics = {
      getUsersStatusStats: jest.fn()
    };
    const { service, redis } = createService({ metrics });
    redis.get.mockResolvedValue(JSON.stringify(cached));

    const snapshot = await service.getSnapshot({ hours: 1, period: 'today' });

    expect(snapshot.cache.status).toBe('HIT');
    expect(snapshot.dailyMetrics.activeDrivers).toBe(1);
    expect(metrics.getUsersStatusStats).not.toHaveBeenCalled();
  });
});
