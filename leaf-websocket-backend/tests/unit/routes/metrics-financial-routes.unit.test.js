jest.unmock('express');

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

let mockBookings = {};

jest.mock('../../../services/modern-metrics-service', () => ({
  getFinancialRidesStats: jest.fn().mockRejectedValue(new Error('force-rtdb-fallback')),
  getOperationalFeeStats: jest.fn().mockRejectedValue(new Error('force-rtdb-fallback')),
}));

jest.mock('../../../services/metrics-history-service', () => jest.fn().mockImplementation(() => ({
  getHistory: jest.fn().mockResolvedValue([]),
  getComparison: jest.fn().mockResolvedValue({}),
  getAggregatedMetrics: jest.fn().mockResolvedValue({}),
})));

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, _res, next) => {
    req.user = { id: 'metrics-admin', role: 'admin' };
    next();
  },
  requireSupportRoles: () => (_req, _res, next) => next(),
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: () => ({
    ref: jest.fn((path) => ({
      limitToFirst: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({
        val: () => (path === 'bookings' ? mockBookings : {}),
      }),
    })),
  }),
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    hget: jest.fn().mockResolvedValue('0'),
  })),
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn(),
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const metricsRoutes = require('../../../routes/metrics');
const originalLegacyMetrics = process.env.ENABLE_LEGACY_METRICS_FALLBACK;
const originalEnableFinancialSimulator = process.env.ENABLE_FINANCIAL_SIMULATOR;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(metricsRoutes);
  return app;
}

describe('metrics financial routes', () => {
  const metricsSource = fs.readFileSync(
    path.join(__dirname, '../../../routes/metrics.js'),
    'utf8'
  );

  beforeEach(() => {
    process.env.ENABLE_LEGACY_METRICS_FALLBACK = 'true';
    delete process.env.ENABLE_FINANCIAL_SIMULATOR;
    mockBookings = {
      final_backend_snapshot: {
        status: 'COMPLETED',
        tripdate: '2026-04-06T10:00:00.000Z',
        finalPrice: 81.17,
        operationalFee: 1.49,
        driverNetAmount: 78.42,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
      },
      pending_reconciliation: {
        status: 'COMPLETED',
        tripdate: '2026-04-06T10:10:00.000Z',
        finalPrice: 27.5,
        estimatedFare: 27.5,
        estimate: 27.5,
      },
    };
  });

  afterAll(() => {
    if (originalLegacyMetrics === undefined) delete process.env.ENABLE_LEGACY_METRICS_FALLBACK;
    else process.env.ENABLE_LEGACY_METRICS_FALLBACK = originalLegacyMetrics;
    if (originalEnableFinancialSimulator === undefined) {
      process.env.ENABLE_LEGACY_METRICS_FALLBACK = 'true';
    delete process.env.ENABLE_FINANCIAL_SIMULATOR;
    } else {
      process.env.ENABLE_FINANCIAL_SIMULATOR = originalEnableFinancialSimulator;
    }
  });

  it('fails explicitly without reading RTDB after modern metrics fail by default', async () => {
    delete process.env.ENABLE_LEGACY_METRICS_FALLBACK;
    const response = await request(createApp()).get('/api/metrics/financial/rides');
    expect(response.status).toBe(503);
  });

  it('never falls back to the RTDB, even with the retired legacy flag set', async () => {
    process.env.ENABLE_LEGACY_METRICS_FALLBACK = 'true';
    for (const route of ['/api/metrics/financial/rides', '/api/metrics/financial/operational-fee']) {
      const response = await request(createApp()).get(route);
      expect(response.status).toBe(503);
    }
    expect(metricsSource).not.toContain('requireLegacyFallback');
  });

  it('blocks financial simulator route unless the explicit launch flag is enabled', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/metrics/simulation/run')
      .query({ drivers: 1, hours: 1 });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      code: 'FEATURE_DISABLED_IN_LAUNCH_PROFILE',
      feature: 'financialSimulatorEnabled',
    });
  });

  it('keeps report exports behind dashboard financial roles', () => {
    expect(metricsSource).toContain("const REPORT_READ_ROLES = ['admin', 'manager', 'super-admin']");
    expect(metricsSource).toContain("router.get('/api/reports/predefined', authenticateSupport, requireSupportRoles(REPORT_READ_ROLES)");
    expect(metricsSource).toContain("router.post('/api/reports/generate', authenticateSupport, requireSupportRoles(REPORT_READ_ROLES)");
    expect(metricsSource).toContain("router.get('/api/reports/generate/:reportId', authenticateSupport, requireSupportRoles(REPORT_READ_ROLES)");
  });

  it('does not generate placeholder report files when predefined datasets are not implemented', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/reports/generate/monthly-financial')
      .query({ format: 'pdf' });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({
      success: false,
      code: 'REPORT_DATASET_NOT_IMPLEMENTED',
      reportId: 'monthly-financial',
    });
    expect(metricsSource).not.toMatch(/summary:\s*\{\},\s*data:\s*\[\]/);
  });

  it('allows financial simulator route only with the explicit launch flag', async () => {
    process.env.ENABLE_FINANCIAL_SIMULATOR = 'true';
    const app = createApp();

    const response = await request(app)
      .get('/api/metrics/simulation/run')
      .query({ drivers: 1, hours: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        simulationParams: expect.objectContaining({
          drivers: 1,
          hours: 1,
        }),
        totalRequests: expect.any(Number),
        totalDriverPayout: expect.any(Number),
        totalWooviFees: expect.any(Number),
      })
    );
  });
});
