const redisData = new Map();
const redisHashes = new Map();
const recentScores = new Map();

const mockRedis = {
  get: jest.fn(),
  hgetall: jest.fn(),
  zrevrange: jest.fn(),
};

const mockEnsureConnection = jest.fn(async () => undefined);
const mockGetConnection = jest.fn(() => mockRedis);
const mockSendAlert = jest.fn(async () => undefined);
const mockSetRideCostRecentSummary = jest.fn();
const mockRecordRideCostAlert = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: (...args) => mockEnsureConnection(...args),
  getConnection: (...args) => mockGetConnection(...args),
}));

jest.mock('../../../services/alert-service', () => ({
  sendAlert: (...args) => mockSendAlert(...args),
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    setRideCostRecentSummary: (...args) => mockSetRideCostRecentSummary(...args),
    recordRideCostAlert: (...args) => mockRecordRideCostAlert(...args),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
}));

const service = require('../../../services/ride-cost-alert-service');

function addReport(bookingId, totalBrl, directionsRequests = 2, status = 'COMPLETED') {
  recentScores.set(bookingId, Date.now() + recentScores.size);
  redisData.set(`ride_cost_telemetry:${bookingId}`, JSON.stringify({
    bookingId,
    totals: {
      cost: {
        totalBrl,
        totalUsd: totalBrl / 5.2,
        googleUsd: totalBrl / 5.2,
        exchangeRateUsdBrl: 5.2,
      },
      google: {
        directions: {
          requestCount: directionsRequests,
        },
      },
    },
  }));
  redisHashes.set(`booking:${bookingId}`, { status });
}

function addReportWithAllowedComponents(bookingId, {
  totalBrl,
  googleUsd,
  backendUsd = 0,
  infrastructureUsd = 0,
  directionsRequests = 2,
  status = 'COMPLETED',
}) {
  recentScores.set(bookingId, Date.now() + recentScores.size);
  redisData.set(`ride_cost_telemetry:${bookingId}`, JSON.stringify({
    bookingId,
    totals: {
      cost: {
        totalBrl,
        totalUsd: totalBrl / 5.2,
        googleUsd,
        backendUsd,
        infrastructureUsd,
        wooviUsd: Math.max(0, totalBrl / 5.2 - googleUsd - backendUsd - infrastructureUsd),
        exchangeRateUsdBrl: 5.2,
      },
      google: {
        directions: {
          requestCount: directionsRequests,
        },
      },
    },
  }));
  redisHashes.set(`booking:${bookingId}`, { status });
}

describe('ride-cost-alert-service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      RIDE_COST_ALERTS_ENABLED: 'true',
      RIDE_COST_ALERT_CHECK_INTERVAL_MS: '0',
      RIDE_COST_ALERT_WINDOW_SIZE: '3',
      RIDE_COST_ALERT_MIN_COMPLETED_RIDES: '2',
      RIDE_COST_WARNING_BRL: '0.20',
      RIDE_COST_CRITICAL_BRL: '0.30',
      RIDE_COST_DIRECTIONS_WARNING_PER_RIDE: '2.2',
      RIDE_COST_DIRECTIONS_CRITICAL_PER_RIDE: '3',
    };
    redisData.clear();
    redisHashes.clear();
    recentScores.clear();
    jest.clearAllMocks();

    mockRedis.get.mockImplementation(async (key) => redisData.get(key) || null);
    mockRedis.hgetall.mockImplementation(async (key) => redisHashes.get(key) || {});
    mockRedis.zrevrange.mockImplementation(async (_key, start, end) => {
      const ordered = Array.from(recentScores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([member]) => member);
      return ordered.slice(start, end + 1);
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('calcula resumo apenas com corridas concluidas', async () => {
    addReport('ride-1', 0.15, 2, 'COMPLETED');
    addReport('ride-2', 0.17, 2, 'COMPLETED');
    addReport('ride-open', 1.00, 6, 'STARTED');

    const summary = await service.collectRecentCostSummary();

    expect(summary.completedRides).toBe(2);
    expect(summary.averageBrl).toBe(0.16);
    expect(summary.directionsPerRide).toBe(2);
    expect(mockSetRideCostRecentSummary).toHaveBeenCalledWith(expect.objectContaining({
      averageBrl: 0.16,
      directionsPerRide: 2,
    }));
  });

  it('calcula media usando Google/backend/infra e exclui Woovi mesmo se total legado vier inflado', async () => {
    addReportWithAllowedComponents('ride-1', {
      totalBrl: 10.15,
      googleUsd: 0.02,
      backendUsd: 0.005,
      infrastructureUsd: 0.005,
    });
    addReportWithAllowedComponents('ride-2', {
      totalBrl: 9.17,
      googleUsd: 0.025,
      backendUsd: 0.002,
      infrastructureUsd: 0.003,
    });

    const summary = await service.collectRecentCostSummary();

    expect(summary.completedRides).toBe(2);
    expect(summary.averageBrl).toBeCloseTo(0.156, 6);
    expect(summary.maxBrl).toBeCloseTo(0.156, 6);
  });

  it('envia alerta quando media de custo passa do limite', async () => {
    addReport('ride-1', 0.24, 2, 'COMPLETED');
    addReport('ride-2', 0.26, 2, 'COMPLETED');

    const result = await service.evaluateRecentRideCosts({ force: true });

    expect(result.skipped).toBe(false);
    expect(mockRecordRideCostAlert).toHaveBeenCalledWith('ride_cost_average_brl', 'warning');
    expect(mockSendAlert).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'warning',
      metric: 'ride_cost_average_brl',
      service: 'ride-cost-monitor',
      value: 0.25,
      threshold: 0.2,
    }));
  });

  it('envia alerta separado quando Directions por corrida foge do normal', async () => {
    addReport('ride-1', 0.16, 3, 'COMPLETED');
    addReport('ride-2', 0.16, 4, 'COMPLETED');

    await service.evaluateRecentRideCosts({ force: true });

    expect(mockRecordRideCostAlert).toHaveBeenCalledWith('google_directions_per_ride', 'critical');
    expect(mockSendAlert).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'critical',
      metric: 'google_directions_per_ride',
      value: 3.5,
      threshold: 3,
    }));
  });
});
