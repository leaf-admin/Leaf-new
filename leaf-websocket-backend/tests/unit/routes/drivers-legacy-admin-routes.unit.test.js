jest.unmock('express');

const express = require('express');
const request = require('supertest');

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    hgetall: jest.fn(),
    georadius: jest.fn()
  }))
}));

jest.mock('../../../services/driver-lock-manager', () => ({}));
jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../services/driver-destination-mode-service', () => ({
  getPolicyForDriver: jest.fn()
}));
jest.mock('../../../middleware/firebase-user-auth', () => ({
  requireFirebaseUser: jest.fn((_req, _res, next) => next())
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));
jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(),
  getStorage: jest.fn()
}));

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: jest.fn((req, res, next) => {
    const token = req.headers.authorization || '';
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token não fornecido' });
    }

    req.user = {
      id: token.includes('viewer') ? 'viewer_1' : 'admin_1',
      role: token.includes('viewer') ? 'viewer' : 'admin',
      permissions: []
    };
    return next();
  }),
  requireRole: jest.fn((roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }
    return next();
  })
}));

const firebaseConfig = require('../../../firebase-config');
const driversRoutes = require('../../../routes/drivers');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(driversRoutes);
  return app;
}

function buildSnapshot(value) {
  return {
    exists: () => value !== undefined && value !== null,
    val: () => value
  };
}

function mockRealtimeDb({ users = {}, cars = {}, bookings = {} } = {}) {
  const createRef = path => ({
    once: jest.fn(async () => {
      if (path === 'cars') {
        return buildSnapshot(cars);
      }
      if (path === 'bookings') {
        return buildSnapshot(bookings);
      }
      if (path.startsWith('users/')) {
        return buildSnapshot(users[path.slice('users/'.length)]);
      }
      return buildSnapshot(null);
    }),
    orderByChild: jest.fn(() => ({
      equalTo: jest.fn(() => ({
        once: jest.fn(async () => buildSnapshot(bookings))
      }))
    }))
  });

  firebaseConfig.getRealtimeDB.mockReturnValue({
    ref: jest.fn(createRef)
  });
}

function buildBackendFinalSnapshot(overrides = {}) {
  return {
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    passengerPaidCents: 2200,
    tollFeeCents: 0,
    operationalFeeCents: 99,
    paymentIntermediationFeeCents: 50,
    subscriptionRetainedFeeCents: 0,
    driverNetAmountCents: 2051,
    ...overrides
  };
}

describe('drivers legacy admin application routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['get applications', 'get', '/api/drivers/applications'],
    ['get application detail', 'get', '/api/drivers/applications/driver_1'],
    ['approve application', 'post', '/api/drivers/applications/driver_1/approve'],
    ['reject application', 'post', '/api/drivers/applications/driver_1/reject']
  ])('requires admin authentication for %s', async (_label, method, path) => {
    const app = createApp();

    const response = await request(app)[method](path).send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Token não fornecido');
  });

  it('rejects non-admin roles before mutating driver approval state', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/drivers/applications/driver_1/approve')
      .set('Authorization', 'Bearer viewer-token')
      .send({ notes: 'x' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Acesso negado');
  });

  it.each([
    ['/api/drivers/applications/driver_1/approve'],
    ['/api/drivers/applications/driver_1/reject']
  ])('blocks legacy mass mutation for authenticated admins: %s', async (path) => {
    const app = createApp();

    const response = await request(app)
      .post(path)
      .set('Authorization', 'Bearer admin-token')
      .send({});

    expect(response.status).toBe(410);
    expect(response.body.code).toBe('LEGACY_DRIVER_APPLICATION_MUTATION_DISABLED');
  });
});

describe('drivers earnings route financial source', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('soma ganhos do motorista a partir do snapshot financeiro final do backend', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: {
        driver_1: {
          walletBalance: 50,
          rating: 4.9,
          hoursOnline: 3.5
        }
      },
      cars: {
        car_1: {
          driver: 'driver_1',
          carMake: 'Toyota',
          carModel: 'Corolla',
          carYear: '2024',
          carType: 'Sedan'
        }
      },
      bookings: {
        booking_1: {
          driver: 'driver_1',
          status: 'COMPLETED',
          tripdate: new Date().toISOString(),
          estimate: 80,
          finalFare: 80,
          financialSnapshot: JSON.stringify(buildBackendFinalSnapshot())
        }
      }
    });

    const response = await request(app).get('/api/drivers/driver_1/earnings');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.report.totalCompletedRides).toBe(1);
    expect(response.body.report.totalGrossAmount).toBe(22);
    expect(response.body.report.totalNetAmount).toBe(20.51);
    expect(response.body.report.totalFeeAmount).toBe(1.49);
    expect(response.body.report.financialSnapshotPendingCount).toBe(0);
  });

  it('nao calcula ganhos a partir de estimate/finalFare sem snapshot backend_final', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: {
        driver_1: {
          walletBalance: 50,
          rating: 4.9,
          hoursOnline: 3.5
        }
      },
      bookings: {
        booking_1: {
          driver: 'driver_1',
          status: 'COMPLETED',
          tripdate: new Date().toISOString(),
          estimate: 80,
          finalFare: 80,
          driverNetAmount: 70,
          totalFees: 10
        }
      }
    });

    const response = await request(app).get('/api/drivers/driver_1/earnings');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.report.totalCompletedRides).toBe(0);
    expect(response.body.report.totalGrossAmount).toBe(0);
    expect(response.body.report.totalNetAmount).toBe(0);
    expect(response.body.report.totalFeeAmount).toBe(0);
    expect(response.body.report.financialSnapshotPendingCount).toBe(1);
  });
});
