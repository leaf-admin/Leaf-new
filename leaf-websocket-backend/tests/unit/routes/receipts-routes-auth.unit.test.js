jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetReceiptByRideId = jest.fn();
const mockGenerateReceipt = jest.fn();
const mockGenerateStaticMapImage = jest.fn();
const mockRealtimeDb = { ref: jest.fn() };
const mockGetRealtimeDB = jest.fn(() => mockRealtimeDb);

const mockSupportRoles = new Set(['admin', 'manager', 'super-admin', 'support', 'development']);

function mockBuildUserFromAuthHeader(req) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return null;
  if (mockSupportRoles.has(token)) {
    return { id: `${token}_1`, uid: `${token}_1`, role: token };
  }
  return { id: token, uid: token, role: 'user' };
}

jest.mock('../../../services/receipt-service', () => jest.fn().mockImplementation(() => ({
  getReceiptByRideId: (...args) => mockGetReceiptByRideId(...args),
  generateReceipt: (...args) => mockGenerateReceipt(...args),
  generateStaticMapImage: (...args) => mockGenerateStaticMapImage(...args),
  GOOGLE_MAPS_API_KEY: 'test-key'
})));

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, res, next) => {
    const user = mockBuildUserFromAuthHeader(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Token não fornecido' });
    }
    req.user = user;
    return next();
  },
  requireSupportRoles: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }
    return next();
  },
  isSupportAgent: (user) => mockSupportRoles.has(String(user?.role || '')),
  canAccessUserScope: (user, targetUserId) => {
    if (!targetUserId) return false;
    return String(user?.uid || user?.id || '') === String(targetUserId) ||
      mockSupportRoles.has(String(user?.role || ''));
  }
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: (...args) => mockGetRealtimeDB(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

function createApp() {
  const routes = require('../../../routes/receipts');
  const app = express();
  app.use(express.json());
  app.use('/', routes);
  return app;
}

describe('receipts routes auth', () => {
  const receipt = {
    receiptId: 'LEAF-ride_1',
    rideId: 'ride_1',
    customer: { id: 'passenger_1' },
    driver: { id: 'driver_1' }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRealtimeDB.mockReturnValue(mockRealtimeDb);
    mockGetReceiptByRideId.mockResolvedValue(receipt);
    mockGenerateReceipt.mockResolvedValue(receipt);
    mockGenerateStaticMapImage.mockReturnValue('https://maps.test/static.png');
  });

  it('keeps receipt health public and before dynamic ride routes', async () => {
    const response = await request(createApp()).get('/api/receipts/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, service: 'Receipt Service' });
    expect(mockGetReceiptByRideId).not.toHaveBeenCalled();
  });

  it('requires authentication before returning a receipt', async () => {
    const response = await request(createApp()).get('/api/receipts/ride_1');

    expect(response.status).toBe(401);
    expect(mockGetReceiptByRideId).not.toHaveBeenCalled();
  });

  it('allows the passenger that owns the ride receipt', async () => {
    const response = await request(createApp())
      .get('/api/receipts/ride_1')
      .set('Authorization', 'Bearer passenger_1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, receipt });
  });

  it('falls back to Realtime Database when app locals do not expose firebaseDb', async () => {
    const response = await request(createApp())
      .get('/api/receipts/ride_1')
      .set('Authorization', 'Bearer passenger_1');

    expect(response.status).toBe(200);
    expect(mockGetRealtimeDB).toHaveBeenCalled();
    expect(mockGetReceiptByRideId).toHaveBeenCalledWith('ride_1', undefined, mockRealtimeDb);
  });

  it('blocks a user that does not own the ride receipt', async () => {
    const response = await request(createApp())
      .get('/api/receipts/ride_1')
      .set('Authorization', 'Bearer passenger_2');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false });
  });

  it('allows support actors to inspect a receipt', async () => {
    const response = await request(createApp())
      .get('/api/receipts/ride_1')
      .set('Authorization', 'Bearer support');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, receipt });
  });

  it('returns conflict when a receipt is waiting for final financial reconciliation', async () => {
    mockGetReceiptByRideId.mockRejectedValueOnce(Object.assign(new Error('pending final snapshot'), {
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      statusCode: 409,
      details: { missing: ['finalGrossAmount'] }
    }));

    const response = await request(createApp())
      .get('/api/receipts/ride_1')
      .set('Authorization', 'Bearer support');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      error: 'Recibo ainda não reconciliado',
      details: { missing: ['finalGrossAmount'] }
    });
  });

  it('blocks user receipt listing for a different user', async () => {
    const response = await request(createApp())
      .get('/api/receipts/user/passenger_1')
      .set('Authorization', 'Bearer passenger_2');

    expect(response.status).toBe(403);
  });

  it('keeps arbitrary receipt generation restricted to support roles', async () => {
    const userResponse = await request(createApp())
      .post('/api/receipts/generate')
      .set('Authorization', 'Bearer passenger_1')
      .send({ rideId: 'ride_1', rideData: { customer: 'passenger_1' } });

    expect(userResponse.status).toBe(403);
    expect(mockGenerateReceipt).not.toHaveBeenCalled();

    const supportResponse = await request(createApp())
      .post('/api/receipts/generate')
      .set('Authorization', 'Bearer support')
      .send({ rideId: 'ride_1', rideData: { customer: 'passenger_1' } });

    expect(supportResponse.status).toBe(200);
    expect(mockGenerateReceipt).toHaveBeenCalledWith('ride_1', { customer: 'passenger_1' });
  });

  it('returns conflict when support generation lacks final financial reconciliation', async () => {
    mockGenerateReceipt.mockRejectedValueOnce(Object.assign(new Error('pending final snapshot'), {
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      statusCode: 409,
      details: { missing: ['financialSnapshotSource=backend_final'] }
    }));

    const response = await request(createApp())
      .post('/api/receipts/generate')
      .set('Authorization', 'Bearer support')
      .send({ rideId: 'ride_1', rideData: { customer: 'passenger_1' } });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      error: 'Recibo ainda não reconciliado',
      details: { missing: ['financialSnapshotSource=backend_final'] }
    });
  });
});
