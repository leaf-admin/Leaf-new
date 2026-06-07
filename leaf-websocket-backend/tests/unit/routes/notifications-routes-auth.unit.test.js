jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockHset = jest.fn();
const mockKeys = jest.fn();
const mockHgetall = jest.fn();
const mockExists = jest.fn();
const mockDel = jest.fn();
const mockOrchestratorSetRedis = jest.fn();
const mockOrchestratorGetMatrix = jest.fn();
const mockOrchestratorGetStats = jest.fn();
const mockOrchestratorGetEventConfig = jest.fn();
const mockOrchestratorBuildNotification = jest.fn();
const mockOrchestratorDispatchEvent = jest.fn();
const mockOrchestratorGetHistory = jest.fn();
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

jest.mock('../../../services/notification-orchestrator-service', () => jest.fn(() => ({
  redis: null,
  setRedis: mockOrchestratorSetRedis,
  getMatrix: mockOrchestratorGetMatrix,
  getStats: mockOrchestratorGetStats,
  getEventConfig: mockOrchestratorGetEventConfig,
  buildNotification: mockOrchestratorBuildNotification,
  dispatchEvent: mockOrchestratorDispatchEvent,
  getHistory: mockOrchestratorGetHistory
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
    mockOrchestratorGetMatrix.mockReturnValue({
      version: 'test-matrix',
      events: {
        'ride.accepted': { category: 'ride_lifecycle' }
      }
    });
    mockOrchestratorGetStats.mockResolvedValue({
      date: '2026-06-06',
      version: 'test-matrix',
      metrics: { sent: 2 },
      smartPushMode: 'disabled'
    });
    mockOrchestratorGetHistory.mockResolvedValue([
      { id: 'orch_1', eventType: 'ride.accepted', status: 'sent' }
    ]);
    mockOrchestratorGetEventConfig.mockReturnValue({
      category: 'ride_lifecycle',
      audience: ['passenger'],
      channels: ['push', 'persisted']
    });
    mockOrchestratorBuildNotification.mockReturnValue({
      title: 'Corrida aceita',
      body: 'Carlos esta a caminho.',
      data: { eventType: 'ride.accepted' }
    });
    mockOrchestratorDispatchEvent.mockResolvedValue({
      success: true,
      status: 'dry_run',
      notification: { title: 'Corrida aceita', body: 'Carlos esta a caminho.' }
    });
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

  it('requires auth to read the orchestration matrix', async () => {
    const response = await request(createApp())
      .get('/api/notifications/orchestration/matrix');

    expect(response.status).toBe(401);
    expect(mockOrchestratorGetMatrix).not.toHaveBeenCalled();
  });

  it('allows authenticated operators to inspect the orchestration matrix', async () => {
    const response = await request(createApp())
      .get('/api/notifications/orchestration/matrix')
      .set('Authorization', 'Bearer manager');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        version: 'test-matrix',
        events: {
          'ride.accepted': { category: 'ride_lifecycle' }
        }
      }
    });
  });

  it('allows authenticated operators to inspect recent orchestration history', async () => {
    const response = await request(createApp())
      .get('/api/notifications/orchestration/history?date=2026-06-06&limit=5')
      .set('Authorization', 'Bearer manager');

    expect(response.status).toBe(200);
    expect(mockOrchestratorGetHistory).toHaveBeenCalledWith('2026-06-06', '5');
    expect(response.body).toEqual({
      success: true,
      data: {
        date: '2026-06-06',
        items: [{ id: 'orch_1', eventType: 'ride.accepted', status: 'sent' }]
      }
    });
  });

  it('keeps orchestration preview limited to admin roles', async () => {
    const response = await request(createApp())
      .post('/api/notifications/orchestration/preview')
      .set('Authorization', 'Bearer viewer')
      .send({
        eventType: 'ride.accepted',
        context: { driverName: 'Carlos' }
      });

    expect(response.status).toBe(403);
    expect(mockOrchestratorBuildNotification).not.toHaveBeenCalled();
  });

  it('builds an orchestration preview without dispatching push', async () => {
    const response = await request(createApp())
      .post('/api/notifications/orchestration/preview')
      .set('Authorization', 'Bearer manager')
      .send({
        eventType: 'ride.accepted',
        context: { driverName: 'Carlos' }
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        eventType: 'ride.accepted',
        mode: 'preview_only',
        notification: {
          title: 'Corrida aceita'
        }
      }
    });
    expect(mockOrchestratorDispatchEvent).not.toHaveBeenCalled();
  });

  it('forces orchestration dispatch into dry-run unless explicitly enabled by env', async () => {
    const response = await request(createApp())
      .post('/api/notifications/orchestration/dispatch')
      .set('Authorization', 'Bearer manager')
      .send({
        eventType: 'ride.accepted',
        userId: 'user_1',
        userType: 'passenger',
        context: { driverName: 'Carlos' },
        dryRun: false
      });

    expect(response.status).toBe(200);
    expect(mockOrchestratorDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'ride.accepted',
      userId: 'user_1',
      userType: 'passenger',
      dryRun: true
    }));
    expect(response.body.data).toEqual(expect.objectContaining({
      directSendEnabled: false,
      effectiveDryRun: true
    }));
  });
});
