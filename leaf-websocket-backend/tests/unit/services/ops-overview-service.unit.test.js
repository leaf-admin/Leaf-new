const { OpsOverviewService } = require('../../../services/ops-overview-service');

describe('ops-overview-service', () => {
  it('aggregates overview and emits operational alerts', async () => {
    const supportQueue = {
      getQueueSummary: jest.fn(async () => ({
        totalOpenTickets: 4,
        backlogByPriority: { N1: 1, N2: 1, N3: 2 },
        overdueAckCount: 1,
        overdueFirstResponseCount: 0,
        ticketsWithoutOwner: 2,
        criticalBacklogCount: 0,
        medianFirstResponseMinutes: 12
      }))
    };
    const service = new OpsOverviewService({
      redis: { getConnection: () => ({}) },
      metrics: {
        getAllMetrics: jest.fn(async () => ({ match: { averageTimeMs: 1200 } }))
      },
      rideHealth: {
        getRideOperationsSnapshot: jest.fn(async () => ({
          reassignmentPending: {
            total: 2,
            stuck: 1,
            oldestAgeMs: 400000,
            oldestBookingId: 'booking-1',
            bookingIds: ['booking-1'],
            stuckThresholdMs: 300000
          },
          earlyEndedReview: {
            total: 3,
            recent: 2,
            oldestAgeMs: 120000,
            oldestBookingId: 'booking-2',
            bookingIds: ['booking-2'],
            recentWindowMs: 3600000
          },
          driverSignal: {
            total: 2,
            stale: 1,
            oldestAgeMs: 180000,
            oldestBookingId: 'booking-3',
            bookingIds: ['booking-3'],
            staleThresholdMs: 60000
          }
        })),
        buildReassignmentAlert: jest.fn((snapshot) => ({
          severity: 'critical',
          metric: 'reassignment_pending_stuck',
          value: snapshot.reassignmentPending.stuck
        })),
        buildReviewAlert: jest.fn(() => null),
        buildDriverSignalAlert: jest.fn((snapshot) => ({
          severity: 'warning',
          metric: 'driver_signal_stale',
          value: snapshot.driverSignal.stale
        }))
      },
      incidents: {
        getOpenSummary: jest.fn(async () => ({
          openCount: 1,
          bySeverity: { critical: 1, high: 0, medium: 0, low: 0 }
        }))
      },
      supportQueue,
      disputes: {
        getSummary: jest.fn(async () => ({
          openCount: 2,
          byStatus: { OPEN: 2 }
        }))
      },
      policies: {
        listPolicies: jest.fn(async () => [{ policyId: 'policy-1', dispatchMode: 'tight' }])
      }
    });

    const overview = await service.getOverview({ hours: 2, city: 'rio', regionHash: 'abc' });
    const alerts = await service.getAlerts({ hours: 2, city: 'rio', regionHash: 'abc' });

    expect(overview.scope.city).toBe('rio');
    expect(overview.supportQueue.overdueAckCount).toBe(1);
    expect(supportQueue.getQueueSummary).toHaveBeenCalledWith({ autoEscalate: false });
    expect(alerts.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'reassignment_pending_stuck' }),
      expect.objectContaining({ metric: 'driver_signal_stale' }),
      expect.objectContaining({ metric: 'support_backlog_n1' }),
      expect.objectContaining({ metric: 'incident_open_count' }),
      expect.objectContaining({ metric: 'payment_refund_open' })
    ]));
  });
});
