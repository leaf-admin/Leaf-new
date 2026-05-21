jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockUpdateUserOperationalStatus = jest.fn();
const mockRequestDriverDocument = jest.fn();

const mockAuthenticateJWT = jest.fn((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token nao fornecido' });
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

class MockDashboardUserManagementError extends Error {
  constructor(message, statusCode = 400, code = 'MOCK_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: mockAuthenticateJWT,
  requireRole: mockRequireRole
}));

jest.mock('../../../services/dashboard-user-management-service', () => ({
  DashboardUserManagementError: MockDashboardUserManagementError,
  updateUserOperationalStatus: (...args) => mockUpdateUserOperationalStatus(...args),
  requestDriverDocument: (...args) => mockRequestDriverDocument(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn()
}));

function createApp() {
  const routes = require('../../../routes/user-management');
  const app = express();
  app.use(express.json());
  app.use('/', routes);
  return app;
}

describe('user-management routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateUserOperationalStatus.mockResolvedValue({
      success: true,
      userId: 'user_1',
      status: 'suspended'
    });
    mockRequestDriverDocument.mockResolvedValue({
      success: true,
      driverId: 'driver_1',
      documentType: 'cnh',
      status: 'requested'
    });
  });

  it('requires auth to update user status', async () => {
    const response = await request(createApp())
      .post('/api/users/user_1/status')
      .send({ status: 'suspended' });

    expect(response.status).toBe(401);
    expect(mockUpdateUserOperationalStatus).not.toHaveBeenCalled();
  });

  it('rejects roles without dashboard operation permission', async () => {
    const response = await request(createApp())
      .post('/api/users/user_1/status')
      .set('Authorization', 'Bearer viewer')
      .send({ status: 'blocked' });

    expect(response.status).toBe(403);
    expect(mockUpdateUserOperationalStatus).not.toHaveBeenCalled();
  });

  it('updates user operational status for managers', async () => {
    const response = await request(createApp())
      .post('/api/users/user_1/status')
      .set('Authorization', 'Bearer manager')
      .send({ status: 'suspended', reason: 'Teste', durationDays: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, userId: 'user_1', status: 'suspended' });
    expect(mockUpdateUserOperationalStatus).toHaveBeenCalledWith(
      'user_1',
      expect.objectContaining({ status: 'suspended', reason: 'Teste', durationDays: 3 }),
      expect.objectContaining({
        operator: expect.objectContaining({ id: 'admin_1', role: 'manager' })
      })
    );
  });

  it('maps service validation errors to API errors', async () => {
    mockUpdateUserOperationalStatus.mockRejectedValueOnce(
      new MockDashboardUserManagementError('Usuario nao encontrado', 404, 'USER_NOT_FOUND')
    );

    const response = await request(createApp())
      .post('/api/users/missing/status')
      .set('Authorization', 'Bearer admin')
      .send({ status: 'blocked' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      code: 'USER_NOT_FOUND'
    });
  });

  it('requests driver documents behind dashboard auth', async () => {
    const response = await request(createApp())
      .post('/api/drivers/driver_1/documents/cnh/request')
      .set('Authorization', 'Bearer support')
      .send({ reason: 'Atualize sua CNH', sendPush: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, driverId: 'driver_1', documentType: 'cnh' });
    expect(mockRequestDriverDocument).toHaveBeenCalledWith(
      'driver_1',
      'cnh',
      expect.objectContaining({ reason: 'Atualize sua CNH', sendPush: true }),
      expect.objectContaining({
        operator: expect.objectContaining({ id: 'admin_1', role: 'support' })
      })
    );
  });
});
