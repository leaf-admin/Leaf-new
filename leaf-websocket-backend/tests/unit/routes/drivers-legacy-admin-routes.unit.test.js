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
  describe('corridas encerradas antecipadamente pelo passageiro', () => {
    const driverProfile = { walletBalance: 50, rating: 4.9, hoursOnline: 3.5 };
    // Pix de R$ 48,61; valor executado R$ 12,15; líquido liquidado R$ 10,86.
    const settledEarlyEndSnapshot = () => buildBackendFinalSnapshot({
      passengerPaidCents: 1215,
      tollFeeCents: 895,
      operationalFeeCents: 79,
      paymentIntermediationFeeCents: 50,
      driverNetAmountCents: 1086
    });
    const contractedSnapshot = () => buildBackendFinalSnapshot({
      passengerPaidCents: 4861,
      tollFeeCents: 895,
      operationalFeeCents: 149,
      paymentIntermediationFeeCents: 50,
      driverNetAmountCents: 4662
    });
    const todayKey = () => {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${now.getFullYear()}-${month}-${day}`;
    };

    it('conta a corrida EARLY_ENDED_BY_RIDER com o líquido liquidado, não o valor contratado', async () => {
      const app = createApp();
      mockRealtimeDb({
        users: { driver_1: driverProfile },
        bookings: {
          booking_completed: {
            driver: 'driver_1',
            status: 'COMPLETED',
            tripdate: new Date().toISOString(),
            financialSnapshot: JSON.stringify(buildBackendFinalSnapshot())
          },
          booking_early_end: {
            driver: 'driver_1',
            status: 'EARLY_ENDED_BY_RIDER',
            tripdate: new Date().toISOString(),
            estimate: 48.61,
            finalFare: 48.61,
            settlement: { settlementType: 'EARLY_ENDED_BY_RIDER', executedFare: 12.15 },
            financialSnapshot: settledEarlyEndSnapshot()
          }
        }
      });

      const response = await request(app).get('/api/drivers/driver_1/earnings');

      expect(response.status).toBe(200);
      const { report } = response.body;
      expect(report.totalCompletedRides).toBe(2);
      expect(report.tripsToday).toBe(2);
      expect(report.totalGrossAmount).toBeCloseTo(22 + 12.15, 2);
      expect(report.totalNetAmount).toBeCloseTo(20.51 + 10.86, 2);
      expect(report.totalFeeAmount).toBeCloseTo(1.49 + 1.29, 2);
      expect(report.totalCancellations).toBe(0);
      expect(report.financialSnapshotPendingCount).toBe(0);
      const today = report.dailySeries.find((slot) => slot.date === todayKey());
      expect(today).toMatchObject({ completedCount: 2, cancelledCount: 0 });
      expect(today.amount).toBeCloseTo(31.37, 2);
      expect(today.grossAmount).toBeCloseTo(34.15, 2);
      expect(report.dailyEarnings[report.dailyEarnings.length - 1].amount).toBeCloseTo(31.37, 2);
    });

    it('aceita o status em minúsculas e o settlement serializado', async () => {
      const app = createApp();
      mockRealtimeDb({
        users: { driver_1: driverProfile },
        bookings: {
          booking_early_end: {
            driver: 'driver_1',
            status: 'early_ended_by_rider',
            tripdate: new Date().toISOString(),
            settlement: JSON.stringify({ executedFare: 12.15 }),
            financialSnapshot: JSON.stringify(settledEarlyEndSnapshot())
          }
        }
      });

      const response = await request(app).get('/api/drivers/driver_1/earnings');

      expect(response.body.report.totalCompletedRides).toBe(1);
      expect(response.body.report.totalNetAmount).toBeCloseTo(10.86, 2);
    });

    it('deixa pendente o encerramento antecipado cujo snapshot ainda é o do valor contratado', async () => {
      const app = createApp();
      mockRealtimeDb({
        users: { driver_1: driverProfile },
        bookings: {
          booking_early_end: {
            driver: 'driver_1',
            status: 'EARLY_ENDED_BY_RIDER',
            tripdate: new Date().toISOString(),
            settlement: { executedFare: 12.15 },
            financialSnapshot: contractedSnapshot()
          }
        }
      });

      const response = await request(app).get('/api/drivers/driver_1/earnings');

      const { report } = response.body;
      expect(report.totalCompletedRides).toBe(0);
      expect(report.tripsToday).toBe(0);
      expect(report.totalNetAmount).toBe(0);
      expect(report.financialSnapshotPendingCount).toBe(1);
    });

    it('deixa pendente o encerramento antecipado sem snapshot final do backend', async () => {
      const app = createApp();
      mockRealtimeDb({
        users: { driver_1: driverProfile },
        bookings: {
          booking_early_end: {
            driver: 'driver_1',
            status: 'EARLY_ENDED_BY_RIDER',
            tripdate: new Date().toISOString(),
            estimate: 48.61,
            driverNetAmount: 46.62
          }
        }
      });

      const response = await request(app).get('/api/drivers/driver_1/earnings');

      expect(response.body.report.totalCompletedRides).toBe(0);
      expect(response.body.report.totalNetAmount).toBe(0);
      expect(response.body.report.financialSnapshotPendingCount).toBe(1);
    });

    it.each([
      ['EARLY_ENDED_REVIEW'],
      ['INTERRUPTED_OPERATIONAL_ENDED'],
      ['IN_PROGRESS']
    ])('não conta corridas %s como ganho nem como cancelamento', async (status) => {
      const app = createApp();
      mockRealtimeDb({
        users: { driver_1: driverProfile },
        bookings: {
          booking_other: {
            driver: 'driver_1',
            status,
            tripdate: new Date().toISOString(),
            financialSnapshot: settledEarlyEndSnapshot()
          }
        }
      });

      const response = await request(app).get('/api/drivers/driver_1/earnings');

      const { report } = response.body;
      expect(report.totalCompletedRides).toBe(0);
      expect(report.totalCancellations).toBe(0);
      expect(report.totalNetAmount).toBe(0);
      expect(report.financialSnapshotPendingCount).toBe(0);
    });

    it('continua contando cancelamentos apenas como cancelamento', async () => {
      const app = createApp();
      mockRealtimeDb({
        users: { driver_1: driverProfile },
        bookings: {
          booking_cancelled: {
            driver: 'driver_1',
            status: 'CANCELED',
            tripdate: new Date().toISOString(),
            financialSnapshot: settledEarlyEndSnapshot()
          }
        }
      });

      const response = await request(app).get('/api/drivers/driver_1/earnings');

      expect(response.body.report.totalCompletedRides).toBe(0);
      expect(response.body.report.totalCancellations).toBe(1);
      expect(response.body.report.totalNetAmount).toBe(0);
    });
  });
});
