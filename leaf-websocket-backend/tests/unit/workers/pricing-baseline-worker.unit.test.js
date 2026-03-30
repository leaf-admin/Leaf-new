jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(true),
  getConnection: jest.fn().mockReturnValue({ kind: 'redis' })
}));

jest.mock('../../../services/pricing-baseline-materializer', () => ({
  materializePricingBaselines: jest.fn().mockResolvedValue({
    candidateCells: 4,
    processedCells: 3,
    failedCells: 1
  })
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    setActiveWorkers: jest.fn(),
    recordPricingBaselineMaterialization: jest.fn()
  }
}));

const redisPool = require('../../../utils/redis-pool');
const materializer = require('../../../services/pricing-baseline-materializer');
const { metrics } = require('../../../utils/prometheus-metrics');
const worker = require('../../../workers/pricing-baseline-worker');

describe('pricing-baseline-worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    worker.stopPricingBaselineWorker();
  });

  it('deriva config de execução única a partir de args', () => {
    const config = worker.getWorkerConfig(
      {
        ENABLE_PRICING_BASELINE_WORKER: 'false',
        PRICING_BASELINE_WORKER_INTERVAL_MS: '60000'
      },
      ['--once']
    );

    expect(config.runOnce).toBe(true);
    expect(config.intervalMs).toBe(60000);
  });

  it('executa um ciclo e materializa baselines usando redis pool', async () => {
    const result = await worker.runPricingBaselineCycle('test');

    expect(result.success).toBe(true);
    expect(redisPool.ensureConnection).toHaveBeenCalledTimes(1);
    expect(materializer.materializePricingBaselines).toHaveBeenCalledWith(
      expect.objectContaining({
        redis: { kind: 'redis' }
      })
    );
  });

  it('inicia worker em modo once e desativa gauge ao final', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'pricing-baseline-worker.js', '--once'];

    try {
      const result = await worker.startPricingBaselineWorker();
      expect(result).toEqual(expect.objectContaining({ started: true, mode: 'once' }));
      expect(metrics.setActiveWorkers).toHaveBeenCalledWith(1, 'pricing-baseline');
      expect(metrics.setActiveWorkers).toHaveBeenCalledWith(0, 'pricing-baseline');
    } finally {
      process.argv = originalArgv;
    }
  });
});
