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

jest.mock('../../../services/external-insights-service', () => ({
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

describe('ops external insights route', () => {
  beforeEach(() => {
    mockGetSnapshot.mockReset();
    mockGetSnapshot.mockResolvedValue({
      generatedAt: '2026-10-19T12:00:00.000Z',
      cache: 'HIT',
      sources: { sentry: { status: 'ok', data: { projects: [] } } },
    });
  });

  it('returns the cached snapshot with its cache header', async () => {
    const response = await request(createApp()).get('/api/ops/external-insights');

    expect(response.status).toBe(200);
    expect(response.headers['x-leaf-external-insights-cache']).toBe('HIT');
    expect(response.body).toMatchObject({ success: true, sources: { sentry: { status: 'ok' } } });
    expect(mockGetSnapshot).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it('only lets mutation roles skip the cache', async () => {
    mockUser = { uid: 'viewer-1', role: 'viewer' };
    await request(createApp()).get('/api/ops/external-insights?forceRefresh=true');
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ forceRefresh: false });

    mockUser = { uid: 'admin-1', role: 'admin' };
    await request(createApp()).get('/api/ops/external-insights?forceRefresh=true');
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it('hides provider errors behind a generic message', async () => {
    mockGetSnapshot.mockRejectedValue(new Error('boom with secret'));

    const response = await request(createApp()).get('/api/ops/external-insights');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'Erro ao buscar dados externos' });
  });
});
