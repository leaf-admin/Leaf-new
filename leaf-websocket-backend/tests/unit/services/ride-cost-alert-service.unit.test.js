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

function addRideWithSkus(bookingId, { skus, completedAt = new Date().toISOString(), directionsRequests = 1, status = 'COMPLETED' }) {
  recentScores.set(bookingId, Date.now() + recentScores.size);
  const googleUsd = Object.values(skus).reduce((sum, sku) => sum + sku.estimatedCostUsd, 0);
  redisData.set(`ride_cost_telemetry:${bookingId}`, JSON.stringify({
    bookingId,
    updatedAt: completedAt,
    totals: {
      cost: { totalBrl: googleUsd * 5, googleUsd, backendUsd: 0, infrastructureUsd: 0, exchangeRateUsdBrl: 5 },
      google: { skus, directions: { requestCount: directionsRequests } },
    },
  }));
  redisHashes.set(`booking:${bookingId}`, { status, completedAt });
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

  it('lista cada corrida com a quebra por SKU e marca a que foge do padrão', async () => {
    const route = (n) => ({ routesPreferredTrafficAwarePolyline: { label: 'Routes', requestCount: n, estimatedCostUsd: 0.01 * n } });
    addRideWithSkus('ride-a', { skus: route(2), directionsRequests: 2 });
    addRideWithSkus('ride-b', { skus: route(2), directionsRequests: 2 });
    addRideWithSkus('ride-c', {
      skus: {
        autocompleteLegacyPerRequest: { label: 'Autocomplete', requestCount: 33, estimatedCostUsd: 0.09339 },
        placeDetailsLegacy: { label: 'Places Details', requestCount: 2, estimatedCostUsd: 0.034 },
        ...route(1),
      },
    });

    const summary = await service.collectRecentCostSummary();

    expect(summary.rides).toHaveLength(3);
    expect(summary.medianBrl).toBeCloseTo(0.1, 4);
    const normal = summary.rides.find((ride) => ride.bookingId === 'ride-a');
    expect(normal.anomalies).toEqual([]);
    expect(normal.skus).toEqual([expect.objectContaining({ key: 'routesPreferredTrafficAwarePolyline', requests: 2, costBrl: 0.1 })]);

    const outlier = summary.rides.find((ride) => ride.bookingId === 'ride-c');
    expect(outlier.totalBrl).toBeCloseTo(0.687, 3);
    expect(outlier.anomalies).toEqual(['acima_critico', 'acima_mediana', 'autocomplete_demais']);
    expect(outlier.skus[0]).toEqual(expect.objectContaining({ key: 'autocompleteLegacyPerRequest', requests: 33 }));
    expect(summary.anomalousRides).toBe(1);
    expect(service.describeAnomalousRides(summary)).toContain('ride-c R$ 0.6869 (acima_critico+acima_mediana+autocomplete_demais Autocomplete x33)');
  });

  it('soma o custo real das corridas de hoje sem projetar pela média', async () => {
    const sku = { routesPreferredTrafficAwarePolyline: { label: 'Routes', requestCount: 2, estimatedCostUsd: 0.02 } };
    addRideWithSkus('ride-old', { skus: sku, completedAt: '2020-01-01T12:00:00.000Z' });
    addRideWithSkus('ride-today-1', { skus: sku });
    addRideWithSkus('ride-today-2', { skus: sku });

    const summary = await service.collectRecentCostSummary();

    expect(summary.today.rides).toBe(2);
    expect(summary.today.totalBrl).toBeCloseTo(0.2, 4);
    expect(summary.rides.find((ride) => ride.bookingId === 'ride-old').dateKey).toBe('2020-01-01');
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
