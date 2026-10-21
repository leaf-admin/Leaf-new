jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockList = jest.fn();
const mockGet = jest.fn();

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, _res, next) => {
    req.user = { uid: 'support-1', role: 'support' };
    next();
  },
  requireSupportRoles: () => (_req, _res, next) => next(),
}));

jest.mock('../../../services/safety-signal-service', () => ({
  list: (...args) => mockList(...args),
  get: (...args) => mockGet(...args),
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

describe('ops safety signals routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the latest signals', async () => {
    mockList.mockResolvedValue([{ signalId: 'SIG-1', type: 'mock_location' }]);

    const response = await request(createApp()).get('/api/ops/safety/signals?limit=5');

    expect(response.status).toBe(200);
    expect(response.body.signals).toEqual([{ signalId: 'SIG-1', type: 'mock_location' }]);
    expect(mockList).toHaveBeenCalledWith({ limit: '5' });
  });

  it('returns one signal with its dossier or 404', async () => {
    mockGet.mockResolvedValueOnce({ signalId: 'SIG-1', history: [] }).mockResolvedValueOnce(null);

    const found = await request(createApp()).get('/api/ops/safety/signals/SIG-1');
    const missing = await request(createApp()).get('/api/ops/safety/signals/SIG-2');

    expect(found.status).toBe(200);
    expect(found.body.signal.signalId).toBe('SIG-1');
    expect(missing.status).toBe(404);
  });

  it('answers 500 without leaking the error', async () => {
    mockList.mockRejectedValue(new Error('redis down'));

    const response = await request(createApp()).get('/api/ops/safety/signals');

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('redis down');
  });
});
