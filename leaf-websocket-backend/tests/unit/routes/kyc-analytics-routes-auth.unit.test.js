jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetAnalytics = jest.fn();
const mockAuthenticateJWT = jest.fn((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token não fornecido' });
  }
  req.user = { id: 'admin_1', role: token, email: 'admin@leaf.test' };
  return next();
});
const mockRequireRole = jest.fn((roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ success: false, error: 'Acesso negado' });
  }
  return next();
});

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: mockAuthenticateJWT,
  requireRole: mockRequireRole
}));

jest.mock('../../../services/IntegratedKYCService', () => jest.fn(() => ({
  initialized: true,
  getAnalytics: mockGetAnalytics
})));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

function createApp() {
  const kycAnalyticsRoutes = require('../../../routes/kyc-analytics-routes');
  const app = express();
  app.use(express.json());
  app.use('/api/kyc-analytics', kycAnalyticsRoutes.getRouter());
  return app;
}

describe('kyc analytics route auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAnalytics.mockResolvedValue({ total: 1 });
  });

  it('rejects analytics without admin JWT auth', async () => {
    const response = await request(createApp()).get('/api/kyc-analytics/analytics');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it('rejects non-admin roles before returning analytics', async () => {
    const response = await request(createApp())
      .get('/api/kyc-analytics/analytics')
      .set('Authorization', 'Bearer viewer');

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it('allows managers to read KYC analytics', async () => {
    const response = await request(createApp())
      .get('/api/kyc-analytics/analytics?days=3')
      .set('Authorization', 'Bearer manager');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { total: 1 },
      period: '3 days'
    });
    expect(mockGetAnalytics).toHaveBeenCalledWith(null, 3);
  });
});
