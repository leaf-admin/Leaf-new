jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(),
  getConnection: jest.fn()
}));

jest.mock('../../../services/ride-health-monitor', () => ({
  backfillRideHealthIndex: jest.fn(),
  evaluateRideOperationsAlerts: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    setActiveWorkers: jest.fn()
  }
}));

const redisPool = require('../../../utils/redis-pool');
const rideHealthMonitor = require('../../../services/ride-health-monitor');
const { metrics } = require('../../../utils/prometheus-metrics');
const worker = require('../../../workers/ride-health-monitor-worker');

describe('ride-health-monitor-worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisPool.ensureConnection.mockResolvedValue(true);
    redisPool.getConnection.mockReturnValue({ kind: 'redis' });
    rideHealthMonitor.backfillRideHealthIndex.mockResolvedValue({
      scanned: 0,
      tracked: 0
    });
    rideHealthMonitor.evaluateRideOperationsAlerts.mockResolvedValue({
      snapshot: {
        reassignmentPending: { total: 2, stuck: 1 },
        earlyEndedReview: { total: 3, recent: 2 }
      },
      alerts: [{ metric: 'reassignment_pending_stuck', severity: 'warning' }]
    });
    worker.stopRideHealthMonitorWorker();
  });

  it('deriva config de execução única a partir de args', () => {
    const config = worker.getWorkerConfig(
      {
        ENABLE_RIDE_HEALTH_MONITOR_WORKER: 'false',
        RIDE_HEALTH_MONITOR_INTERVAL_MS: '90000'
      },
      ['--once']
    );

    expect(config.runOnce).toBe(true);
    expect(config.intervalMs).toBe(90000);
  });

  it('executa um ciclo usando redis pool e monitor operacional', async () => {
    const result = await worker.runRideHealthMonitorCycle('test');

    expect(result.success).toBe(true);
    expect(redisPool.ensureConnection).toHaveBeenCalledTimes(1);
    expect(rideHealthMonitor.evaluateRideOperationsAlerts).toHaveBeenCalledWith(
      { kind: 'redis' },
      expect.objectContaining({
        nowIso: expect.any(String)
      })
    );
  });

  it('inicia worker em modo once e desativa gauge ao final', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'ride-health-monitor-worker.js', '--once'];

    try {
      const result = await worker.startRideHealthMonitorWorker();
      expect(result).toEqual(expect.objectContaining({ started: true, mode: 'once' }));
      expect(metrics.setActiveWorkers).toHaveBeenCalledWith(1, 'ride-health-monitor');
      expect(metrics.setActiveWorkers).toHaveBeenCalledWith(0, 'ride-health-monitor');
    } finally {
      process.argv = originalArgv;
    }
  });
});
