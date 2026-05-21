jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockHset = jest.fn();
const mockKeys = jest.fn();
const mockHgetall = jest.fn();
const mockExists = jest.fn();
const mockDel = jest.fn();
const mockRedisConnection = {
  status: 'ready',
  connect: jest.fn(),
  hset: mockHset,
  keys: mockKeys,
  hgetall: mockHgetall,
  exists: mockExists,
  del: mockDel
};

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

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedisConnection)
}));

jest.mock('../../../services/fcm-service', () => jest.fn(() => ({
  redis: null,
  setRedis: jest.fn(),
  initialize: jest.fn().mockResolvedValue(undefined),
  getServiceStats: jest.fn().mockResolvedValue({ activeTokens: 0 })
})));

jest.mock('../../../utils/redis-scan', () => ({
  scanIds: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

function createApp() {
  const notificationsRoutes = require('../../../routes/notifications');
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRoutes);
  return app;
}

describe('notification schedule route auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisConnection.status = 'ready';
    mockKeys.mockResolvedValue(['scheduled_notifications:scheduled_1']);
    mockHgetall.mockResolvedValue({ id: 'scheduled_1', title: 'Teste' });
    mockExists.mockResolvedValue(1);
    mockDel.mockResolvedValue(1);
    mockHset.mockResolvedValue(1);
  });

  it('requires an admin role to create scheduled notifications', async () => {
    const response = await request(createApp())
      .post('/api/notifications/schedule')
      .set('Authorization', 'Bearer viewer')
      .send({
        userIds: ['user_1'],
        title: 'Teste',
        body: 'Mensagem',
        schedule: '2026-05-22T12:00:00.000Z'
      });

    expect(response.status).toBe(403);
    expect(mockHset).not.toHaveBeenCalled();
  });

  it('does not claim recurring notifications are scheduled while the worker is missing', async () => {
    const response = await request(createApp())
      .post('/api/notifications/schedule')
      .set('Authorization', 'Bearer manager')
      .send({
        userIds: ['user_1'],
        title: 'Teste',
        body: 'Mensagem',
        schedule: '2026-05-22T12:00:00.000Z',
        recurrence: 'daily'
      });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({
      success: false,
      status: 'not_implemented',
      code: 'RECURRING_NOTIFICATIONS_NOT_IMPLEMENTED'
    });
    expect(mockHset).not.toHaveBeenCalled();
  });

  it('allows managers to list scheduled notifications', async () => {
    const response = await request(createApp())
      .get('/api/notifications/scheduled')
      .set('Authorization', 'Bearer manager');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [{ id: 'scheduled_1', title: 'Teste' }]
    });
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'super-admin', 'manager', 'development']);
  });

  it('keeps scheduled notification cancellation limited to super-admin', async () => {
    const response = await request(createApp())
      .delete('/api/notifications/scheduled/scheduled_1')
      .set('Authorization', 'Bearer manager');

    expect(response.status).toBe(403);
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('allows super-admins to cancel scheduled notifications', async () => {
    const response = await request(createApp())
      .delete('/api/notifications/scheduled/scheduled_1')
      .set('Authorization', 'Bearer super-admin');

    expect(response.status).toBe(200);
    expect(mockDel).toHaveBeenCalledWith('scheduled_notifications:scheduled_1');
  });
});
