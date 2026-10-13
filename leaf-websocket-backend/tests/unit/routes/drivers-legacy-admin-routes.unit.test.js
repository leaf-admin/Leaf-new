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
// Token de teste: "Bearer firebase:<uid>". A checagem de dono (requireFirebaseSelf) é a real.
jest.mock('../../../middleware/firebase-user-auth', () => ({
  ...jest.requireActual('../../../middleware/firebase-user-auth'),
  requireFirebaseUser: jest.fn((req, res, next) => {
    const match = /^Bearer firebase:(.+)$/.exec(String(req.headers.authorization || ''));
    if (!match) {
      return res.status(401).json({ success: false, error: 'Token de autenticação ausente.' });
    }
    req.authenticatedUser = { uid: match[1], authSource: 'firebase' };
    return next();
  })
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));
jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(),
  getFirestore: jest.fn(),
  getStorage: jest.fn()
}));
// Classificação do usuário (operacional x sandbox): o resto do escopo de persistência é real.
jest.mock('../../../services/payment-runtime-profile-service', () => ({
  resolveProfile: jest.fn()
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
const paymentRuntimeProfileService = require('../../../services/payment-runtime-profile-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const driversRoutes = require('../../../routes/drivers');

const PRODUCTION_PROFILE = {
  environment: 'production',
  profileId: 'default_production',
  source: 'default',
  testUserSandbox: false
};
const SANDBOX_QA_PROFILE = {
  environment: 'sandbox',
  profileId: 'qa_sandbox_profile',
  source: 'firestore',
  testUserSandbox: true
};
const sandboxQaContext = (overrides = {}) => sealFinancialContext({
  providerEnvironment: 'sandbox',
  paymentProfileId: SANDBOX_QA_PROFILE.profileId,
  paymentProfileSource: SANDBOX_QA_PROFILE.source,
  testUserSandbox: true,
  ...overrides
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(driversRoutes);
  return app;
}

function getEarnings(app, driverId = 'driver_1', tokenUid = driverId) {
  const pending = request(app).get(`/api/drivers/${driverId}/earnings`);
  return tokenUid ? pending.set('Authorization', `Bearer firebase:${tokenUid}`) : pending;
}

function buildSnapshot(value) {
  return {
    exists: () => value !== undefined && value !== null,
    val: () => value
  };
}

// Firestore mínimo: coleções em memória, filtros de igualdade e o recorte por ID do documento.
function buildFirestore(collections = {}, { failDocumentIdFilterWith = null } = {}) {
  const queries = [];
  const buildQuery = (collectionName, filters) => ({
    where: jest.fn((field, op, value) => buildQuery(collectionName, [...filters, { field, op, value }])),
    get: jest.fn(async () => {
      queries.push({ collection: collectionName, filters });
      if (failDocumentIdFilterWith && filters.some((filter) => filter.field === '__name__')) {
        throw failDocumentIdFilterWith;
      }
      const docs = Object.entries(collections[collectionName] || {})
        .filter(([docId, data]) => filters.every((filter) => {
          if (filter.field === '__name__') {
            return filter.op === '>=' && docId >= filter.value;
          }
          return filter.op === '==' && data[filter.field] === filter.value;
        }))
        .map(([docId, data]) => ({ id: docId, data: () => data }));
      return { size: docs.length, docs, forEach: (callback) => docs.forEach(callback) };
    })
  });

  return {
    queries,
    collection: jest.fn((collectionName) => buildQuery(collectionName, []))
  };
}

// `rides`/`sandboxRides` são as coleções do Firestore; `bookings` é o nó legado do Realtime Database.
function mockRealtimeDb({
  users = {},
  cars = {},
  bookings = {},
  rides = {},
  sandboxRides = {},
  profile = PRODUCTION_PROFILE,
  firestoreOptions = {}
} = {}) {
  const realtimeQueries = [];
  const indexedNodes = { cars, bookings };
  const createRef = path => ({
    once: jest.fn(async () => {
      realtimeQueries.push({ path, orderByChild: null });
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
    orderByChild: jest.fn((child) => ({
      equalTo: jest.fn((value) => ({
        once: jest.fn(async () => {
          realtimeQueries.push({ path, orderByChild: child, equalTo: value });
          const matches = Object.fromEntries(
            Object.entries(indexedNodes[path] || {}).filter(([, item]) => item?.[child] === value)
          );
          return buildSnapshot(matches);
        })
      }))
    }))
  });

  firebaseConfig.getRealtimeDB.mockReturnValue({
    ref: jest.fn(createRef)
  });

  const firestore = buildFirestore({ rides, sandbox_rides: sandboxRides }, firestoreOptions);
  firebaseConfig.getFirestore.mockReturnValue(firestore);
  paymentRuntimeProfileService.resolveProfile.mockResolvedValue(profile);

  return { firestore, realtimeQueries };
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

describe('drivers earnings route authentication', () => {
  const earningsDb = () => ({
    users: {
      driver_1: { walletBalance: 50, rating: 4.9, hoursOnline: 3.5 },
      driver_2: { walletBalance: 10, rating: 4.7, hoursOnline: 1 }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('responde 401 sem token e não lê dados do motorista', async () => {
    const app = createApp();
    mockRealtimeDb(earningsDb());

    const response = await getEarnings(app, 'driver_1', null);

    expect(response.status).toBe(401);
    expect(response.body.report).toBeUndefined();
    expect(firebaseConfig.getRealtimeDB).not.toHaveBeenCalled();
  });

  it('responde 403 para o token de outro motorista e não lê dados', async () => {
    const app = createApp();
    mockRealtimeDb(earningsDb());

    const response = await getEarnings(app, 'driver_1', 'driver_2');

    expect(response.status).toBe(403);
    expect(response.body.report).toBeUndefined();
    expect(firebaseConfig.getRealtimeDB).not.toHaveBeenCalled();
  });

  it('não aceita o JWT de admin do dashboard no lugar do ID token do motorista', async () => {
    const app = createApp();
    mockRealtimeDb(earningsDb());

    const response = await request(app)
      .get('/api/drivers/driver_1/earnings')
      .set('Authorization', 'Bearer admin-token');

    expect(response.status).toBe(401);
    expect(firebaseConfig.getRealtimeDB).not.toHaveBeenCalled();
  });

  it('responde 200 para o próprio motorista', async () => {
    const app = createApp();
    mockRealtimeDb(earningsDb());

    const response = await getEarnings(app, 'driver_1', 'driver_1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.report.balance).toBe(50);
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

    const response = await getEarnings(app);

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

    const response = await getEarnings(app);

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
    // O relatório corta o dia no fuso de Brasília.
    const todayKey = () => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

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

      const response = await getEarnings(app);

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

      const response = await getEarnings(app);

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

      const response = await getEarnings(app);

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

      const response = await getEarnings(app);

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

      const response = await getEarnings(app);

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

      const response = await getEarnings(app);

      expect(response.body.report.totalCompletedRides).toBe(0);
      expect(response.body.report.totalCancellations).toBe(1);
      expect(response.body.report.totalNetAmount).toBe(0);
    });
  });
});

describe('drivers earnings route day boundaries (America/Sao_Paulo)', () => {
  const driverProfile = { walletBalance: 50, rating: 4.9, hoursOnline: 3.5 };
  const completedBooking = (overrides = {}) => ({
    driver: 'driver_1',
    status: 'COMPLETED',
    financialSnapshot: buildBackendFinalSnapshot(),
    ...overrides
  });
  // Só o relógio (Date) é simulado; os timers reais continuam servindo o supertest.
  const freezeClockAt = (isoInstant) => {
    jest.useFakeTimers({
      now: new Date(isoInstant),
      doNotFake: [
        'nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'hrtime', 'performance'
      ]
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LEAF_REPORT_TIME_ZONE;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('corrida concluída às 22:30 de Brasília fica nesse dia, não no seguinte', async () => {
    freezeClockAt('2026-10-11T15:00:00.000Z'); // 12:00 de 11/10 em Brasília
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      bookings: {
        // 22:30 de 10/10 em Brasília = 01:30 de 11/10 em UTC
        booking_1: completedBooking({ completedAt: '2026-10-11T01:30:00.000Z' })
      }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(200);
    const { report } = response.body;
    const slot = (date) => report.dailySeries.find((item) => item.date === date);
    expect(slot('2026-10-10')).toMatchObject({ day: '10', completedCount: 1, amount: 20.51 });
    expect(slot('2026-10-11')).toMatchObject({ day: '11', completedCount: 0, amount: 0 });
    expect(report.tripsToday).toBe(0);
    expect(report.totalCompletedRides).toBe(1);
  });

  it('às 23:30 de Brasília a última entrada de dailySeries ainda é o dia corrente de Brasília', async () => {
    freezeClockAt('2026-10-11T02:30:00.000Z'); // 23:30 de 10/10 em Brasília
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      bookings: {
        booking_1: completedBooking({ completedAt: '2026-10-11T01:30:00.000Z' })
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.dailySeries).toHaveLength(30);
    expect(report.dailySeries[0].date).toBe('2026-09-11');
    expect(report.dailySeries[29]).toMatchObject({ date: '2026-10-10', day: '10', completedCount: 1 });
    expect(report.dailySeries.map((item) => item.date)).not.toContain('2026-10-11');
    expect(report.tripsToday).toBe(1);
    expect(report.dailyEarnings[report.dailyEarnings.length - 1]).toMatchObject({ day: '10', amount: 20.51 });
  });

  it('usa o horário de conclusão da corrida quando existe, e não o de criação', async () => {
    freezeClockAt('2026-10-10T15:00:00.000Z');
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      bookings: {
        // Pedida 23:50 de 09/10, concluída 00:20 de 10/10 (Brasília)
        booking_completed_at: completedBooking({
          tripdate: '2026-10-10T02:50:00.000Z',
          completedAt: '2026-10-10T03:20:00.000Z'
        }),
        // Corrida legada com tripend em milissegundos
        booking_tripend: completedBooking({
          tripdate: '2026-10-10T02:50:00.000Z',
          tripend: Date.parse('2026-10-10T03:25:00.000Z')
        })
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    const slot = (date) => report.dailySeries.find((item) => item.date === date);
    expect(slot('2026-10-09').completedCount).toBe(0);
    expect(slot('2026-10-10').completedCount).toBe(2);
    expect(report.tripsToday).toBe(2);
  });

  it('sem horário de conclusão válido, mantém os campos de antes (tripdate)', async () => {
    freezeClockAt('2026-10-10T15:00:00.000Z');
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      bookings: {
        booking_no_completion: completedBooking({ tripdate: '2026-10-10T02:50:00.000Z' }),
        booking_bad_completion: completedBooking({
          tripdate: '2026-10-10T02:50:00.000Z',
          completedAt: 'not-a-date'
        }),
        booking_cancelled: { driver: 'driver_1', status: 'CANCELED', tripdate: '2026-10-10T02:50:00.000Z' }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    const slot = (date) => report.dailySeries.find((item) => item.date === date);
    expect(slot('2026-10-09')).toMatchObject({ completedCount: 2, cancelledCount: 1 });
    expect(slot('2026-10-10')).toMatchObject({ completedCount: 0, cancelledCount: 0 });
    expect(report.tripsToday).toBe(0);
  });

  it('respeita LEAF_REPORT_TIME_ZONE quando configurado', async () => {
    process.env.LEAF_REPORT_TIME_ZONE = 'UTC';
    freezeClockAt('2026-10-11T02:30:00.000Z');
    const app = createApp();
    mockRealtimeDb({ users: { driver_1: driverProfile } });

    const response = await getEarnings(app);

    expect(response.body.report.dailySeries[29].date).toBe('2026-10-11');
  });
});

describe('drivers earnings route settled rides source (Firestore rides, namespace do motorista)', () => {
  const driverProfile = { walletBalance: 50, rating: 4.9, hoursOnline: 3.5 };
  const NOW = '2026-10-11T15:00:00.000Z'; // 12:00 de 11/10 em Brasília
  const freezeClockAt = (isoInstant) => {
    jest.useFakeTimers({
      now: new Date(isoInstant),
      doNotFake: [
        'nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'hrtime', 'performance'
      ]
    });
  };
  // Timestamp do Firestore, como o serverTimestamp gravado na finalização.
  const firestoreTimestamp = (isoInstant) => ({ toDate: () => new Date(isoInstant) });
  const rideId = (isoInstant, suffix = 'passenger_1') => `booking_${Date.parse(isoInstant)}_${suffix}`;
  // Recibo do aparelho: + R$ 41,93 (Pix de R$ 43,92).
  const completedSnapshot = () => buildBackendFinalSnapshot({
    passengerPaidCents: 4392,
    operationalFeeCents: 149,
    paymentIntermediationFeeCents: 50,
    driverNetAmountCents: 4193
  });
  // Pix de R$ 48,61; valor executado R$ 10,72; líquido liquidado R$ 9,43.
  const earlyEndSnapshot = () => buildBackendFinalSnapshot({
    passengerPaidCents: 1072,
    operationalFeeCents: 79,
    paymentIntermediationFeeCents: 50,
    driverNetAmountCents: 943
  });
  const contractedSnapshot = () => buildBackendFinalSnapshot({
    passengerPaidCents: 4861,
    operationalFeeCents: 149,
    paymentIntermediationFeeCents: 50,
    driverNetAmountCents: 4662
  });
  const sandboxEnvelope = (context = sandboxQaContext()) => ({
    financialContext: context,
    financialNamespace: context.namespace,
    financialContextId: context.contextId
  });
  const completedRide = (completedAtIso, overrides = {}) => ({
    driverId: 'driver_1',
    passengerId: 'passenger_1',
    status: 'completed',
    finalPrice: 43.92,
    netFare: null,
    driverEarnings: null,
    createdAt: firestoreTimestamp(completedAtIso),
    completedAt: firestoreTimestamp(completedAtIso),
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    financialSnapshot: completedSnapshot(),
    ...overrides
  });
  const earlyEndedRide = (completedAtIso, overrides = {}) => completedRide(completedAtIso, {
    status: 'EARLY_ENDED_BY_RIDER',
    completionType: 'EARLY_ENDED_BY_RIDER',
    finalPrice: 10.72,
    settlement: { settlementType: 'EARLY_ENDED_BY_RIDER', executedFare: 10.72, prepaidAmount: 48.61 },
    financialSnapshot: earlyEndSnapshot(),
    ...overrides
  });
  const cancelledRide = (cancelledAtIso, overrides = {}) => ({
    driverId: 'driver_1',
    passengerId: 'passenger_1',
    status: 'cancelled',
    createdAt: firestoreTimestamp(cancelledAtIso),
    completedAt: null,
    cancelledAt: firestoreTimestamp(cancelledAtIso),
    ...overrides
  });
  const slotOf = (report, date) => report.dailySeries.find((item) => item.date === date);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LEAF_REPORT_TIME_ZONE;
    freezeClockAt(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('motorista sandbox com duas corridas liquidadas hoje recebe o valor e a contagem do dia', async () => {
    const app = createApp();
    const { firestore, realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', sandboxEnvelope()),
        [rideId('2026-10-11T13:30:00.000Z')]: earlyEndedRide('2026-10-11T13:45:00.000Z', sandboxEnvelope())
      },
      // O nó legado não entra na conta de um motorista sandbox.
      bookings: {
        legacy_1: {
          driver: 'driver_1',
          status: 'COMPLETED',
          tripdate: NOW,
          financialSnapshot: buildBackendFinalSnapshot()
        }
      }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(200);
    const { report } = response.body;
    expect(report.tripsToday).toBe(2);
    expect(report.totalCompletedRides).toBe(2);
    expect(report.totalNetAmount).toBeCloseTo(41.93 + 9.43, 2);
    expect(report.totalGrossAmount).toBeCloseTo(43.92 + 10.72, 2);
    expect(report.totalFeeAmount).toBeCloseTo(1.99 + 1.29, 2);
    expect(report.totalCancellations).toBe(0);
    expect(report.financialSnapshotPendingCount).toBe(0);
    expect(report.dailySeries[29]).toMatchObject({ date: '2026-10-11', completedCount: 2, cancelledCount: 0 });
    expect(report.dailySeries[29].amount).toBeCloseTo(51.36, 2);
    expect(report.dailyEarnings[report.dailyEarnings.length - 1].amount).toBeCloseTo(51.36, 2);

    // Uma consulta, na coleção sandbox, por motorista e com o recorte por ID do documento.
    expect(firestore.queries).toHaveLength(1);
    expect(firestore.queries[0].collection).toBe('sandbox_rides');
    expect(firestore.queries[0].filters).toEqual([
      { field: 'driverId', op: '==', value: 'driver_1' },
      { field: '__name__', op: '>=', value: `booking_${Date.parse(NOW) - 31 * 24 * 60 * 60 * 1000}` }
    ]);
    expect(realtimeQueries.some((query) => query.path === 'bookings')).toBe(false);
  });

  it('corrida de ontem fica no dia de ontem', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        // 22:30 de 10/10 em Brasília = 01:30 de 11/10 em UTC
        [rideId('2026-10-11T01:00:00.000Z')]: completedRide('2026-10-11T01:30:00.000Z', sandboxEnvelope()),
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', sandboxEnvelope())
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(slotOf(report, '2026-10-10')).toMatchObject({ day: '10', completedCount: 1, amount: 41.93 });
    expect(slotOf(report, '2026-10-11')).toMatchObject({ day: '11', completedCount: 1, amount: 41.93 });
    expect(report.tripsToday).toBe(1);
    expect(report.totalCompletedRides).toBe(2);
    expect(report.totalNetAmount).toBeCloseTo(83.86, 2);
  });

  it('corrida cancelada soma um cancelamento no dia do cancelamento e nenhum ganho', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        // Pedida 23:50 de 10/10, cancelada 00:05 de 11/10 (Brasília)
        [rideId('2026-10-11T02:50:00.000Z')]: cancelledRide('2026-10-11T03:05:00.000Z', {
          ...sandboxEnvelope(),
          createdAt: firestoreTimestamp('2026-10-11T02:50:00.000Z'),
          financialSnapshot: completedSnapshot()
        })
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.totalCancellations).toBe(1);
    expect(report.totalCompletedRides).toBe(0);
    expect(report.tripsToday).toBe(0);
    expect(report.totalNetAmount).toBe(0);
    expect(report.totalGrossAmount).toBe(0);
    expect(report.financialSnapshotPendingCount).toBe(0);
    expect(slotOf(report, '2026-10-11')).toMatchObject({ cancelledCount: 1, completedCount: 0, amount: 0 });
    expect(slotOf(report, '2026-10-10')).toMatchObject({ cancelledCount: 0 });
  });

  it('encerramento antecipado pelo passageiro usa o líquido liquidado e fica pendente com o snapshot contratado', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [rideId('2026-10-11T12:10:00.000Z')]: earlyEndedRide('2026-10-11T12:40:00.000Z', sandboxEnvelope()),
        [rideId('2026-10-11T13:10:00.000Z')]: earlyEndedRide('2026-10-11T13:40:00.000Z', {
          ...sandboxEnvelope(),
          financialSnapshot: contractedSnapshot()
        })
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.totalCompletedRides).toBe(1);
    expect(report.totalNetAmount).toBeCloseTo(9.43, 2);
    expect(report.totalGrossAmount).toBeCloseTo(10.72, 2);
    expect(report.financialSnapshotPendingCount).toBe(1);
    expect(slotOf(report, '2026-10-11').financialSnapshotPendingCount).toBe(1);
  });

  it('corrida COMPLETED com completionType EARLY_ENDED_BY_DRIVER conta uma vez, com o líquido liquidado', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', {
          status: 'completed',
          completionType: 'EARLY_ENDED_BY_DRIVER',
          finalPrice: 10.72,
          settlement: { settlementType: 'EARLY_ENDED_BY_DRIVER', executedFare: 10.72, prepaidAmount: 48.61 },
          financialSnapshot: earlyEndSnapshot()
        }),
        // Mesma liquidação, mas o snapshot ainda é o do valor contratado: não soma.
        [rideId('2026-10-11T13:10:00.000Z')]: completedRide('2026-10-11T13:40:00.000Z', {
          completionType: 'EARLY_ENDED_BY_DRIVER',
          settlement: { executedFare: 10.72 },
          financialSnapshot: contractedSnapshot()
        })
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.totalCompletedRides).toBe(1);
    expect(report.tripsToday).toBe(1);
    expect(report.totalNetAmount).toBeCloseTo(9.43, 2);
    expect(report.totalCancellations).toBe(0);
    expect(report.financialSnapshotPendingCount).toBe(1);
  });

  it('não soma duas vezes a corrida que existe no Firestore e no nó legado', async () => {
    const app = createApp();
    const sharedRideId = rideId('2026-10-11T12:10:00.000Z');
    const { realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [sharedRideId]: completedRide('2026-10-11T12:40:00.000Z')
      },
      bookings: {
        [sharedRideId]: {
          driver: 'driver_1',
          status: 'COMPLETED',
          completedAt: '2026-10-11T12:40:00.000Z',
          financialSnapshot: completedSnapshot()
        },
        legacy_only: {
          driver: 'driver_1',
          status: 'COMPLETED',
          completedAt: '2026-10-10T12:40:00.000Z',
          financialSnapshot: completedSnapshot()
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.totalCompletedRides).toBe(1);
    expect(report.tripsToday).toBe(1);
    expect(report.totalNetAmount).toBeCloseTo(41.93, 2);
    expect(slotOf(report, '2026-10-10').completedCount).toBe(0);
    expect(realtimeQueries.some((query) => query.path === 'bookings')).toBe(false);
  });

  it('usa o nó legado só quando o Firestore não tem corrida do motorista operacional', async () => {
    const app = createApp();
    const { firestore, realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', { driverId: 'driver_2' })
      },
      bookings: {
        legacy_only: {
          driver: 'driver_1',
          status: 'COMPLETED',
          completedAt: '2026-10-10T12:40:00.000Z',
          financialSnapshot: buildBackendFinalSnapshot()
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(firestore.queries[0].collection).toBe('rides');
    expect(report.totalCompletedRides).toBe(1);
    expect(report.totalNetAmount).toBeCloseTo(20.51, 2);
    expect(slotOf(report, '2026-10-10').completedCount).toBe(1);
    expect(realtimeQueries).toContainEqual({ path: 'bookings', orderByChild: 'driver', equalTo: 'driver_1' });
  });

  it('não mistura namespaces: sandbox ignora outro contexto e operacional ignora registro sandbox', async () => {
    const sandboxApp = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', sandboxEnvelope()),
        [rideId('2026-10-11T13:10:00.000Z')]: completedRide(
          '2026-10-11T13:40:00.000Z',
          sandboxEnvelope(sandboxQaContext({ paymentProfileId: 'other_sandbox_profile' }))
        ),
        // Registro sem contexto selado dentro da coleção sandbox
        [rideId('2026-10-11T14:10:00.000Z')]: completedRide('2026-10-11T14:40:00.000Z')
      },
      rides: {
        [rideId('2026-10-11T11:10:00.000Z')]: completedRide('2026-10-11T11:40:00.000Z')
      }
    });

    const sandboxResponse = await getEarnings(sandboxApp);

    expect(sandboxResponse.body.report.totalCompletedRides).toBe(1);
    expect(sandboxResponse.body.report.totalNetAmount).toBeCloseTo(41.93, 2);

    const operationalApp = createApp();
    const { realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z'),
        [rideId('2026-10-11T13:10:00.000Z')]: completedRide('2026-10-11T13:40:00.000Z', sandboxEnvelope())
      },
      sandboxRides: {
        [rideId('2026-10-11T14:10:00.000Z')]: completedRide('2026-10-11T14:40:00.000Z', sandboxEnvelope())
      }
    });

    const operationalResponse = await getEarnings(operationalApp);

    expect(operationalResponse.body.report.totalCompletedRides).toBe(1);
    expect(operationalResponse.body.report.totalNetAmount).toBeCloseTo(41.93, 2);
    expect(realtimeQueries.some((query) => query.path === 'bookings')).toBe(false);
  });

  it('motorista sandbox sem corridas responde zeros sem consultar o nó legado', async () => {
    const app = createApp();
    const { realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      bookings: {
        legacy_1: {
          driver: 'driver_1',
          status: 'COMPLETED',
          tripdate: NOW,
          financialSnapshot: buildBackendFinalSnapshot()
        }
      }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(200);
    expect(response.body.report.totalCompletedRides).toBe(0);
    expect(response.body.report.totalNetAmount).toBe(0);
    expect(realtimeQueries.some((query) => query.path === 'bookings')).toBe(false);
  });

  it('ignora corrida fora da janela de 30 dias e corridas ainda não finalizadas', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        // Dentro do recorte por ID (folga de um dia), mas concluída antes da janela
        [rideId('2026-09-11T10:00:00.000Z')]: completedRide('2026-09-11T10:30:00.000Z'),
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', {
          status: 'in_progress',
          completedAt: null
        }),
        [rideId('2026-10-11T13:10:00.000Z')]: completedRide('2026-10-11T13:40:00.000Z', {
          status: 'EARLY_ENDED_REVIEW'
        }),
        [rideId('2026-09-12T12:10:00.000Z')]: completedRide('2026-09-12T12:40:00.000Z')
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.dailySeries[0].date).toBe('2026-09-12');
    expect(report.dailySeries[0].completedCount).toBe(1);
    expect(report.totalCompletedRides).toBe(1);
    expect(report.totalCancellations).toBe(0);
    expect(report.financialSnapshotPendingCount).toBe(0);
  });

  it('sem o recorte por ID (índice ausente) repete a consulta só por motorista', async () => {
    const app = createApp();
    const missingIndex = Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), { code: 9 });
    const { firestore } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z')
      },
      firestoreOptions: { failDocumentIdFilterWith: missingIndex }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(200);
    expect(response.body.report.totalCompletedRides).toBe(1);
    expect(firestore.queries).toHaveLength(2);
    expect(firestore.queries[1].filters).toEqual([{ field: 'driverId', op: '==', value: 'driver_1' }]);
  });

  it('responde 500 quando a consulta de corridas falha, em vez de zeros', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      firestoreOptions: { failDocumentIdFilterWith: Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }) }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.report).toBeUndefined();
  });

  it('responde 503 quando o namespace do motorista não pode ser classificado', async () => {
    const app = createApp();
    const { firestore } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: { ...PRODUCTION_PROFILE, classificationUnavailable: true }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, code: 'EARNINGS_REPORT_SOURCE_UNAVAILABLE' });
    expect(response.body.report).toBeUndefined();
    expect(firestore.queries).toHaveLength(0);
  });

  it('responde 503 quando o Firestore não está disponível', async () => {
    const app = createApp();
    mockRealtimeDb({ users: { driver_1: driverProfile } });
    firebaseConfig.getFirestore.mockReturnValue(null);

    const response = await getEarnings(app);

    expect(response.status).toBe(503);
    expect(response.body.report).toBeUndefined();
  });

  it('lê o carro do motorista pela consulta indexada, não o nó inteiro', async () => {
    const app = createApp();
    const { realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      cars: {
        car_other: { driver: 'driver_2', carMake: 'Fiat', carModel: 'Argo', carYear: '2022', carType: 'Hatch' },
        car_1: { driver: 'driver_1', carMake: 'Toyota', carModel: 'Corolla', carYear: '2024', carType: 'Sedan' }
      }
    });

    const response = await getEarnings(app);

    expect(response.body.report.activeCar).toEqual({ brand: 'Toyota', model: 'Corolla', year: '2024', engine: 'Sedan' });
    expect(realtimeQueries).toContainEqual({ path: 'cars', orderByChild: 'driver', equalTo: 'driver_1' });
    expect(realtimeQueries).not.toContainEqual({ path: 'cars', orderByChild: null });
  });

  it('mantém o formato da resposta', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', sandboxEnvelope())
      }
    });

    const response = await getEarnings(app);

    expect(Object.keys(response.body).sort()).toEqual(['report', 'success']);
    const { report } = response.body;
    expect(Object.keys(report).sort()).toEqual([
      'activeCar',
      'balance',
      'dailyEarnings',
      'dailySeries',
      'dailySeriesWindowDays',
      'effectiveFeePct',
      'financialSnapshotPendingCount',
      'hoursOnline',
      'rating',
      'totalCancellations',
      'totalCompletedRides',
      'totalFeeAmount',
      'totalGrossAmount',
      'totalNetAmount',
      'tripsToday'
    ]);
    expect(report).toMatchObject({
      balance: 50,
      rating: '4.9',
      hoursOnline: '3.5',
      activeCar: null,
      dailySeriesWindowDays: 30
    });
    expect(report.effectiveFeePct).toBeCloseTo((1.99 / 43.92) * 100, 4);
    expect(report.dailySeries).toHaveLength(30);
    report.dailySeries.forEach((slot) => {
      expect(Object.keys(slot).sort()).toEqual([
        'amount', 'cancelledCount', 'color', 'completedCount', 'date', 'day', 'feeAmount', 'grossAmount'
      ]);
    });
    expect(report.dailySeries[29]).toEqual({
      date: '2026-10-11',
      day: '11',
      amount: 41.93,
      grossAmount: 43.92,
      feeAmount: 1.99,
      completedCount: 1,
      cancelledCount: 0,
      color: '#A5D6A7'
    });
    expect(report.dailyEarnings).toHaveLength(7);
    report.dailyEarnings.forEach((item) => {
      expect(Object.keys(item).sort()).toEqual(['amount', 'color', 'day']);
    });
  });
});
