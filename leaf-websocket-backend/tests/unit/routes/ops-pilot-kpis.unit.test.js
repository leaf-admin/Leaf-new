jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetSnapshot = jest.fn();
let mockUser = { uid: 'support-1', role: 'support' };

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
  requireSupportRoles: () => (_req, _res, next) => next(),
}));

jest.mock('../../../services/pilot-kpi-service', () => ({
  ALLOWED_DAYS: [1, 7, 30],
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

describe('ops pilot KPIs route', () => {
  beforeEach(() => {
    mockUser = { uid: 'support-1', role: 'support' };
    mockGetSnapshot.mockReset();
    mockGetSnapshot.mockResolvedValue({ cache: 'HIT', periodo: { dias: 7 }, corridas: { concluidas: 12 } });
  });

  it('returns the snapshot for the requested window', async () => {
    const response = await request(createApp()).get('/api/ops/pilot-kpis?days=7');

    expect(response.status).toBe(200);
    expect(response.headers['x-leaf-pilot-kpis-cache']).toBe('HIT');
    expect(response.body).toMatchObject({ success: true, corridas: { concluidas: 12 } });
    expect(mockGetSnapshot).toHaveBeenCalledWith({ days: 7, forceRefresh: false });
  });

  it('defaults to one day and rejects other windows', async () => {
    await request(createApp()).get('/api/ops/pilot-kpis');
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ days: 1, forceRefresh: false });

    const response = await request(createApp()).get('/api/ops/pilot-kpis?days=90');
    expect(response.status).toBe(400);
    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('only lets mutation roles skip the cache', async () => {
    await request(createApp()).get('/api/ops/pilot-kpis?forceRefresh=true');
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ days: 1, forceRefresh: false });

    mockUser = { uid: 'admin-1', role: 'admin' };
    await request(createApp()).get('/api/ops/pilot-kpis?forceRefresh=true');
    expect(mockGetSnapshot).toHaveBeenLastCalledWith({ days: 1, forceRefresh: true });
  });

  it('hides internal errors behind a generic message', async () => {
    mockGetSnapshot.mockRejectedValue(new Error('Firestore detail'));

    const response = await request(createApp()).get('/api/ops/pilot-kpis');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'Erro ao calcular os KPIs do piloto' });
  });
});
