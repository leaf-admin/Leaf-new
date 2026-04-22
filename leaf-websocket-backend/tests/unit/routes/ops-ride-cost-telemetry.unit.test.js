jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetRecentReports = jest.fn();
const mockGetReport = jest.fn();

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

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
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
});
