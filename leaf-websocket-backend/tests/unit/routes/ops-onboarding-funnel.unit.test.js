jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetSnapshot = jest.fn();
let mockUser = { uid: 'viewer-1', role: 'viewer' };

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
  requireSupportRoles: () => (_req, _res, next) => next(),
}));

jest.mock('../../../services/onboarding-funnel-service', () => ({
  ALLOWED_DAYS: [7, 14, 30],
  getSnapshot: (...args) => mockGetSnapshot(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logRedis: jest.fn(),
  logStructured: jest.fn(),
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => null),
}));

const opsRoutes = require('../../../routes/ops');

function createApp() {
  const app = express();
  app.use('/api/ops', opsRoutes);
  return app;
}

describe('ops onboarding funnel route', () => {
  beforeEach(() => {
    mockUser = { uid: 'viewer-1', role: 'viewer' };
    mockGetSnapshot.mockReset();
    mockGetSnapshot.mockResolvedValue({ status: 'ok', days: 14, cache: 'HIT', all: { people: 3 } });
  });

  it('returns the cached funnel with its cache header', async () => {
    const response = await request(createApp()).get('/api/ops/onboarding-funnel');

    expect(response.status).toBe(200);
    expect(response.headers['x-leaf-onboarding-funnel-cache']).toBe('HIT');
    expect(response.body).toMatchObject({ success: true, status: 'ok', all: { people: 3 } });
    expect(mockGetSnapshot).toHaveBeenCalledWith({ days: undefined, forceRefresh: false });
  });

  it('accepts only the allowed windows', async () => {
    const ok = await request(createApp()).get('/api/ops/onboarding-funnel?days=30');
    expect(ok.status).toBe(200);
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ days: 30, forceRefresh: false });

    const bad = await request(createApp()).get('/api/ops/onboarding-funnel?days=90');
    expect(bad.status).toBe(400);
  });

  it('only lets mutation roles skip the cache', async () => {
    await request(createApp()).get('/api/ops/onboarding-funnel?forceRefresh=true');
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ days: undefined, forceRefresh: false });

    mockUser = { uid: 'admin-1', role: 'admin' };
    await request(createApp()).get('/api/ops/onboarding-funnel?forceRefresh=true');
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ days: undefined, forceRefresh: true });
  });

  it('hides failures behind a generic message', async () => {
    mockGetSnapshot.mockRejectedValue(new Error('boom with secret'));

    const response = await request(createApp()).get('/api/ops/onboarding-funnel');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'Erro ao buscar o funil de cadastro' });
  });
});
