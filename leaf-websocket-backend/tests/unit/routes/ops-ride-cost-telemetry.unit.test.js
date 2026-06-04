jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetRecentReports = jest.fn();
const mockGetReport = jest.fn();
const mockCollectRecentCostSummary = jest.fn();
const mockGetDailySummary = jest.fn();
const mockSendDailyReport = jest.fn();

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, _res, next) => {
    req.user = { uid: 'ops-user' };
    next();
  },
  requireSupportRoles: () => (_req, _res, next) => next(),
}));

jest.mock('../../../services/safety-incident-service', () => ({
  listIncidents: jest.fn(),
  getIncident: jest.fn(),
  ackIncident: jest.fn(),
  resolveIncident: jest.fn(),
}));

jest.mock('../../../services/passenger-trust-service', () => ({
  getProfile: jest.fn(),
  watchlistPassenger: jest.fn(),
  blockPassenger: jest.fn(),
  unblockPassenger: jest.fn(),
}));

jest.mock('../../../services/operational-area-policy-service', () => ({
  listPolicies: jest.fn(),
  createPolicy: jest.fn(),
  activatePolicy: jest.fn(),
  deactivatePolicy: jest.fn(),
}));

jest.mock('../../../services/dispute-review-service', () => ({
  listDisputes: jest.fn(),
  createDispute: jest.fn(),
  decideDispute: jest.fn(),
}));

jest.mock('../../../services/ops-overview-service', () => ({
  getOverview: jest.fn(),
  getAlerts: jest.fn(),
}));

jest.mock('../../../services/ride-cost-telemetry-service', () => ({
  getRecentReports: (...args) => mockGetRecentReports(...args),
  getReport: (...args) => mockGetReport(...args),
}));

jest.mock('../../../services/ride-cost-alert-service', () => ({
  collectRecentCostSummary: (...args) => mockCollectRecentCostSummary(...args),
}));

jest.mock('../../../services/daily-earnings-report-service', () => ({
  getDailySummary: (...args) => mockGetDailySummary(...args),
  sendDailyReport: (...args) => mockSendDailyReport(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  logError: jest.fn(),
  logRedis: jest.fn(),
}));

const opsRoutes = require('../../../routes/ops');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ops', opsRoutes);
  return app;
}

describe('ops ride cost telemetry routes', () => {
  beforeEach(() => {
    mockGetRecentReports.mockReset();
    mockGetReport.mockReset();
    mockCollectRecentCostSummary.mockReset();
    mockGetDailySummary.mockReset();
    mockSendDailyReport.mockReset();
  });

  it('retorna relatórios recentes com limite normalizado', async () => {
    const app = createApp();
    mockGetRecentReports.mockResolvedValue([
      { bookingId: 'booking-1' },
      { bookingId: 'booking-2' },
    ]);

    const response = await request(app).get('/api/ops/ride-cost-telemetry?limit=2');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      count: 2,
    });
    expect(mockGetRecentReports).toHaveBeenCalledWith(2);
  });

  it('retorna telemetria por booking quando encontrada', async () => {
    const app = createApp();
    mockGetReport.mockResolvedValue({
      bookingId: 'booking-1',
      totals: { google: { estimatedCostUsd: 0.01 } },
    });

    const response = await request(app).get('/api/ops/ride-cost-telemetry/booking-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      bookingId: 'booking-1',
    });
    expect(mockGetReport).toHaveBeenCalledWith('booking-1');
  });

  it('retorna resumo operacional de custo por corrida', async () => {
    const app = createApp();
    mockCollectRecentCostSummary.mockResolvedValue({
      completedRides: 20,
      averageBrl: 0.16,
      directionsPerRide: 2,
    });

    const response = await request(app).get('/api/ops/ride-cost-telemetry/summary');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      summary: {
        completedRides: 20,
        averageBrl: 0.16,
      },
    });
    expect(mockCollectRecentCostSummary).toHaveBeenCalledTimes(1);
  });

  it('retorna 404 quando booking não possui telemetria agregada', async () => {
    const app = createApp();
    mockGetReport.mockResolvedValue(null);

    const response = await request(app).get('/api/ops/ride-cost-telemetry/booking-missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      bookingId: 'booking-missing',
      found: false,
    });
  });

  it('retorna resumo diario de earnings', async () => {
    const app = createApp();
    mockGetDailySummary.mockResolvedValue({
      dateKey: '2026-05-13',
      completedRides: 2,
      platformNetTotalBrl: 1.66,
    });

    const response = await request(app).get('/api/ops/daily-earnings-report?date=2026-05-13');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      summary: {
        dateKey: '2026-05-13',
        completedRides: 2,
      },
    });
    expect(mockGetDailySummary).toHaveBeenCalledWith('2026-05-13');
  });

  it('envia resumo diario de earnings quando solicitado por ops', async () => {
    const app = createApp();
    mockSendDailyReport.mockResolvedValue({
      sent: true,
      summary: { dateKey: '2026-05-13' },
    });

    const response = await request(app)
      .post('/api/ops/daily-earnings-report/send')
      .send({ date: '2026-05-13', force: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      result: {
        sent: true,
      },
    });
    expect(mockSendDailyReport).toHaveBeenCalledWith('2026-05-13', { force: true });
  });
});
