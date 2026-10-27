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
// `queries` guarda as consultas em coleções raiz (corridas); `subcollectionQueries`, as de
// subcoleção (extrato do saldo, chave `<coleção>/<doc>/<subcoleção>`); `batchReads`, os getAll.
function buildFirestore(collections = {}, { failDocumentIdFilterWith = null, failSubcollectionQueryWith = null } = {}) {
  const queries = [];
  const subcollectionQueries = [];
  const batchReads = [];
  const matchesFilter = (docId, data, filter) => {
    if (filter.field === '__name__') {
      return filter.op === '>=' && docId >= filter.value;
    }
    if (filter.op === '>=') return data[filter.field] >= filter.value;
    if (filter.op === '<=') return data[filter.field] <= filter.value;
    return filter.op === '==' && data[filter.field] === filter.value;
  };
  const buildQuery = (collectionName, filters, log = queries) => ({
    where: jest.fn((field, op, value) => buildQuery(collectionName, [...filters, { field, op, value }], log)),
    doc: jest.fn((docId) => ({
      path: `${collectionName}/${docId}`,
      get: jest.fn(async () => {
        const data = (collections[collectionName] || {})[docId];
        return { id: docId, exists: data !== undefined, data: () => data };
      }),
      collection: jest.fn((subcollectionName) =>
        buildQuery(`${collectionName}/${docId}/${subcollectionName}`, [], subcollectionQueries))
    })),
    get: jest.fn(async () => {
      log.push({ collection: collectionName, filters });
      if (failDocumentIdFilterWith && filters.some((filter) => filter.field === '__name__')) {
        throw failDocumentIdFilterWith;
      }
      if (failSubcollectionQueryWith && log === subcollectionQueries) {
        throw failSubcollectionQueryWith;
      }
      const docs = Object.entries(collections[collectionName] || {})
        .filter(([docId, data]) => filters.every((filter) => matchesFilter(docId, data, filter)))
        .map(([docId, data]) => ({ id: docId, data: () => data }));
      return { size: docs.length, docs, forEach: (callback) => docs.forEach(callback) };
    })
  });

  return {
    queries,
    subcollectionQueries,
    batchReads,
    collection: jest.fn((collectionName) => buildQuery(collectionName, [])),
    getAll: jest.fn(async (...refs) => {
      batchReads.push(refs.map((ref) => ref.path));
      return refs.map((ref) => {
        const separator = ref.path.lastIndexOf('/');
        const data = (collections[ref.path.slice(0, separator)] || {})[ref.path.slice(separator + 1)];
        return { id: ref.path.slice(separator + 1), exists: data !== undefined, data: () => data };
      });
    })
  };
}

// `rides`/`sandboxRides` são as coleções do Firestore. `bookings` descreve corridas no formato
// antigo (driver, tripdate) e vira documento de `rides`: o nó legado do RTDB não é mais lido.
function mockRealtimeDb({
  users = {},
  cars = {},
  bookings = {},
  rides = {},
  sandboxRides = {},
  profile = PRODUCTION_PROFILE,
  firestoreCollections = {},
  firestoreOptions = {}
} = {}) {
  const realtimeQueries = [];
  const indexedNodes = { cars };
  const createRef = path => ({
    once: jest.fn(async () => {
      realtimeQueries.push({ path, orderByChild: null });
      if (path === 'cars') {
        return buildSnapshot(cars);
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

  const asRides = Object.fromEntries(Object.entries(bookings).map(([key, booking]) => [
    `booking_${Date.parse(booking.completedAt || booking.tripdate || new Date().toISOString())}_${key}`,
    { ...booking, driverId: booking.driver }
  ]));
  const firestore = buildFirestore(
    { users, rides: { ...asRides, ...rides }, sandbox_rides: sandboxRides, ...firestoreCollections },
    firestoreOptions
  );
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

  it('conta a corrida do Firestore uma vez e nunca consulta o nó legado', async () => {
    const app = createApp();
    const sharedRideId = rideId('2026-10-11T12:10:00.000Z');
    const { realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [sharedRideId]: completedRide('2026-10-11T12:40:00.000Z')
      },
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.totalCompletedRides).toBe(1);
    expect(report.tripsToday).toBe(1);
    expect(report.totalNetAmount).toBeCloseTo(41.93, 2);
    expect(slotOf(report, '2026-10-10').completedCount).toBe(0);
    expect(realtimeQueries.some((query) => query.path === 'bookings')).toBe(false);
  });

  it('motorista operacional sem corrida no Firestore responde zeros sem consultar o nó legado', async () => {
    const app = createApp();
    const { firestore, realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', { driverId: 'driver_2' })
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(firestore.queries[0].collection).toBe('rides');
    expect(report.totalCompletedRides).toBe(0);
    expect(realtimeQueries.some((query) => query.path === 'bookings')).toBe(false);
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
      profile: SANDBOX_QA_PROFILE
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

  it('não lê o nó legado de carros, que nunca existiu nesta base', async () => {
    const app = createApp();
    const { realtimeQueries } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      cars: {
        car_other: { driver: 'driver_2', carMake: 'Fiat', carModel: 'Argo', carYear: '2022', carType: 'Hatch' },
        car_1: { driver: 'driver_1', carMake: 'Toyota', carModel: 'Corolla', carYear: '2024', carType: 'Sedan' }
      }
    });

    const response = await getEarnings(app);

    expect(response.body.report.activeCar).toBeNull();
    expect(realtimeQueries.some((query) => query.path === 'cars')).toBe(false);
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
      'cancellationCreditsAvailable',
      'dailyEarnings',
      'dailySeries',
      'dailySeriesWindowDays',
      'effectiveFeePct',
      'financialSnapshotPendingCount',
      'hoursOnline',
      'rating',
      'totalCancellationCreditAmount',
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
        'amount', 'cancellationCreditAmount', 'cancelledCount', 'color', 'completedCount', 'date', 'day',
        'feeAmount', 'grossAmount'
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
      cancellationCreditAmount: 0,
      color: '#A5D6A7'
    });
    expect(report.totalCancellationCreditAmount).toBe(0);
    expect(report.cancellationCreditsAvailable).toBe(true);
    expect(report.dailyEarnings).toHaveLength(7);
    report.dailyEarnings.forEach((item) => {
      expect(Object.keys(item).sort()).toEqual(['amount', 'color', 'day']);
    });
  });
});

describe('drivers earnings route cancellation credits (multa de cancelamento/no-show creditada)', () => {
  const driverProfile = { walletBalance: 50, rating: 4.9, hoursOnline: 3.5 };
  const NOW = '2026-10-11T15:00:00.000Z'; // 12:00 de 11/10 em Brasília
  const firestoreTimestamp = (isoInstant) => ({ toDate: () => new Date(isoInstant) });
  const rideId = (isoInstant, suffix = 'passenger_1') => `booking_${Date.parse(isoInstant)}_${suffix}`;
  const sandboxEnvelope = (context = sandboxQaContext()) => ({
    financialContext: context,
    financialNamespace: context.namespace,
    financialContextId: context.contextId
  });
  const operationalEnvelope = () => sandboxEnvelope(sealFinancialContext({ providerEnvironment: 'production' }));
  const cancelledRide = (cancelledAtIso, overrides = {}) => ({
    driverId: 'driver_1',
    passengerId: 'passenger_1',
    status: 'cancelled',
    createdAt: firestoreTimestamp(cancelledAtIso),
    completedAt: null,
    cancelledAt: firestoreTimestamp(cancelledAtIso),
    ...overrides
  });
  const completedRide = (completedAtIso, overrides = {}) => ({
    driverId: 'driver_1',
    passengerId: 'passenger_1',
    status: 'completed',
    createdAt: firestoreTimestamp(completedAtIso),
    completedAt: firestoreTimestamp(completedAtIso),
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    // + R$ 41,93 (Pix de R$ 43,92)
    financialSnapshot: buildBackendFinalSnapshot({
      passengerPaidCents: 4392,
      operationalFeeCents: 149,
      paymentIntermediationFeeCents: 50,
      driverNetAmountCents: 4193
    }),
    ...overrides
  });
  // Lançamento do extrato, como o creditDriverBalance grava para `cancel_<rideId>`.
  const cancellationCredit = (bookingId, settledAtIso, amountInCents, overrides = {}) => ({
    type: 'credit',
    amount: amountInCents / 100,
    amountInCents,
    rideId: `cancel_${bookingId}`,
    createdAt: firestoreTimestamp(settledAtIso),
    ...overrides
  });
  // Distribuição da multa, como o processCancellationDistribution grava em payment_distributions.
  const cancellationDistribution = (bookingId, chargedCents, netCents, overrides = {}) => ({
    rideId: bookingId,
    driverId: 'driver_1',
    status: 'distributed_cancellation',
    netAmount: netCents,
    calculation: { totalAmount: chargedCents, operationalFee: 0, wooviFee: chargedCents - netCents, netAmount: netCents },
    ...overrides
  });
  const slotOf = (report, date) => report.dailySeries.find((item) => item.date === date);
  const SANDBOX_TRANSACTIONS = 'sandbox_driver_balances/driver_1/transactions';
  const OPERATIONAL_TRANSACTIONS = 'driver_balances/driver_1/transactions';

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LEAF_REPORT_TIME_ZONE;
    jest.useFakeTimers({
      now: new Date(NOW),
      doNotFake: [
        'nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'hrtime', 'performance'
      ]
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('no-show com multa de R$ 3,00 creditada hoje soma R$ 2,50 ao dia, um cancelamento e nenhuma corrida', async () => {
    const app = createApp();
    const bookingId = rideId('2026-10-11T13:00:00.000Z');
    const { firestore } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [bookingId]: cancelledRide('2026-10-11T13:20:00.000Z', sandboxEnvelope())
      },
      firestoreCollections: {
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_a: cancellationCredit(bookingId, '2026-10-11T13:20:05.000Z', 250, sandboxEnvelope())
        },
        sandbox_payment_distributions: {
          [bookingId]: cancellationDistribution(bookingId, 300, 250, sandboxEnvelope())
        }
      }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(200);
    const { report } = response.body;
    expect(slotOf(report, '2026-10-11')).toEqual({
      date: '2026-10-11',
      day: '11',
      amount: 2.5,
      grossAmount: 3,
      feeAmount: 0.5,
      completedCount: 0,
      cancelledCount: 1,
      cancellationCreditAmount: 2.5,
      color: '#A5D6A7'
    });
    expect(report.tripsToday).toBe(0);
    expect(report.totalCompletedRides).toBe(0);
    expect(report.totalCancellations).toBe(1);
    expect(report.totalNetAmount).toBeCloseTo(2.5, 2);
    expect(report.totalGrossAmount).toBeCloseTo(3, 2);
    expect(report.totalFeeAmount).toBeCloseTo(0.5, 2);
    expect(report.totalCancellationCreditAmount).toBeCloseTo(2.5, 2);
    expect(report.effectiveFeePct).toBeCloseTo((0.5 / 3) * 100, 4);
    expect(report.cancellationCreditsAvailable).toBe(true);
    expect(report.financialSnapshotPendingCount).toBe(0);
    expect(report.dailyEarnings[report.dailyEarnings.length - 1].amount).toBeCloseTo(2.5, 2);

    // Custo: a consulta de corridas de sempre, uma consulta por faixa no extrato e uma
    // leitura em lote com uma distribuição por multa creditada.
    expect(firestore.queries).toHaveLength(1);
    expect(firestore.subcollectionQueries).toEqual([{
      collection: SANDBOX_TRANSACTIONS,
      filters: [
        { field: 'rideId', op: '>=', value: `cancel_booking_${Date.parse(NOW) - 31 * 24 * 60 * 60 * 1000}` },
        { field: 'rideId', op: '<=', value: 'cancel_booking_' }
      ]
    }]);
    expect(firestore.batchReads).toEqual([[`sandbox_payment_distributions/${bookingId}`]]);
  });

  it('cancelamento sem crédito ao motorista não soma nada e não lê distribuições', async () => {
    const app = createApp();
    const bookingId = rideId('2026-10-11T13:00:00.000Z');
    const { firestore } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [bookingId]: cancelledRide('2026-10-11T13:20:00.000Z', sandboxEnvelope())
      },
      firestoreCollections: {
        // Crédito de corrida concluída e saque no mesmo extrato: não são multa de cancelamento.
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_b: { ...sandboxEnvelope(), type: 'credit', amountInCents: 4193, rideId: 'booking_1', createdAt: firestoreTimestamp(NOW) },
          withdrawal_1: { ...sandboxEnvelope(), type: 'withdrawal', amountInCents: 1000, createdAt: firestoreTimestamp(NOW) }
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(slotOf(report, '2026-10-11')).toMatchObject({
      amount: 0, grossAmount: 0, feeAmount: 0, cancelledCount: 1, completedCount: 0, cancellationCreditAmount: 0
    });
    expect(report.totalCancellations).toBe(1);
    expect(report.totalNetAmount).toBe(0);
    expect(report.totalCancellationCreditAmount).toBe(0);
    expect(report.cancellationCreditsAvailable).toBe(true);
    expect(firestore.batchReads).toEqual([]);
  });

  it('corrida concluída e multa creditada no mesmo dia somam, sem contar a multa como corrida', async () => {
    const app = createApp();
    const cancelledId = rideId('2026-10-11T13:00:00.000Z');
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', sandboxEnvelope()),
        [cancelledId]: cancelledRide('2026-10-11T13:20:00.000Z', sandboxEnvelope())
      },
      firestoreCollections: {
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_a: cancellationCredit(cancelledId, '2026-10-11T13:20:05.000Z', 250, sandboxEnvelope())
        },
        sandbox_payment_distributions: {
          [cancelledId]: cancellationDistribution(cancelledId, 300, 250, sandboxEnvelope())
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    const today = slotOf(report, '2026-10-11');
    expect(today).toMatchObject({ completedCount: 1, cancelledCount: 1 });
    expect(today.amount).toBeCloseTo(41.93 + 2.5, 2);
    expect(today.grossAmount).toBeCloseTo(43.92 + 3, 2);
    expect(today.feeAmount).toBeCloseTo(1.99 + 0.5, 2);
    expect(today.cancellationCreditAmount).toBeCloseTo(2.5, 2);
    expect(today.grossAmount - today.feeAmount).toBeCloseTo(today.amount, 2);
    expect(report.tripsToday).toBe(1);
    expect(report.totalCompletedRides).toBe(1);
    expect(report.totalCancellations).toBe(1);
    expect(report.totalNetAmount).toBeCloseTo(44.43, 2);
    expect(report.totalGrossAmount).toBeCloseTo(46.92, 2);
    expect(report.totalFeeAmount).toBeCloseTo(2.49, 2);
    expect(report.totalCancellationCreditAmount).toBeCloseTo(2.5, 2);
    expect(report.effectiveFeePct).toBeCloseTo((2.49 / 46.92) * 100, 4);
  });

  it('a multa entra no dia em que foi liquidada, não no dia do cancelamento', async () => {
    const app = createApp();
    const bookingId = rideId('2026-10-11T02:30:00.000Z');
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        // Cancelada 23:58 de 10/10, crédito liquidado 00:02 de 11/10 (Brasília)
        [bookingId]: cancelledRide('2026-10-11T02:58:00.000Z', sandboxEnvelope())
      },
      firestoreCollections: {
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_a: cancellationCredit(bookingId, '2026-10-11T03:02:00.000Z', 250, sandboxEnvelope())
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(slotOf(report, '2026-10-10')).toMatchObject({ cancelledCount: 1, amount: 0, cancellationCreditAmount: 0 });
    expect(slotOf(report, '2026-10-11')).toMatchObject({ cancelledCount: 0, amount: 2.5, cancellationCreditAmount: 2.5 });
  });

  it('sem a distribuição da multa o bruto é o próprio crédito e a taxa é zero', async () => {
    const app = createApp();
    const bookingId = rideId('2026-10-11T13:00:00.000Z');
    const otherBookingId = rideId('2026-10-11T14:00:00.000Z');
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      firestoreCollections: {
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_a: cancellationCredit(bookingId, '2026-10-11T13:20:05.000Z', 250, sandboxEnvelope()),
          ride_credit_b: cancellationCredit(otherBookingId, '2026-10-11T14:20:05.000Z', 400, sandboxEnvelope())
        },
        sandbox_payment_distributions: {
          // Distribuição que não bate com o crédito (outro líquido): não é usada.
          [otherBookingId]: cancellationDistribution(otherBookingId, 900, 850, sandboxEnvelope())
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(slotOf(report, '2026-10-11')).toMatchObject({
      amount: 6.5, grossAmount: 6.5, feeAmount: 0, cancellationCreditAmount: 6.5
    });
    expect(report.totalNetAmount).toBeCloseTo(6.5, 2);
    expect(report.totalFeeAmount).toBe(0);
  });

  it('cancelamento antigo sem crédito no extrato, ou com crédito fora da janela, não soma nada', async () => {
    const app = createApp();
    const oldBookingId = rideId('2026-08-01T13:00:00.000Z');
    const recentBookingId = rideId('2026-10-01T13:00:00.000Z');
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [recentBookingId]: cancelledRide('2026-10-01T13:20:00.000Z', sandboxEnvelope())
      },
      firestoreCollections: {
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_old: cancellationCredit(oldBookingId, '2026-08-01T13:20:05.000Z', 250, sandboxEnvelope())
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(report.totalCancellations).toBe(1);
    expect(report.totalNetAmount).toBe(0);
    expect(report.totalCancellationCreditAmount).toBe(0);
    report.dailySeries.forEach((slot) => expect(slot.amount).toBe(0));
  });

  it('motorista sandbox não recebe multa do extrato operacional, nem de outro contexto sandbox', async () => {
    const app = createApp();
    const bookingId = rideId('2026-10-11T13:00:00.000Z');
    const otherContext = sandboxQaContext({ paymentProfileId: 'other_sandbox_profile' });
    const { firestore } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      firestoreCollections: {
        [OPERATIONAL_TRANSACTIONS]: {
          ride_credit_op: cancellationCredit(bookingId, '2026-10-11T13:20:05.000Z', 250, operationalEnvelope())
        },
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_other: cancellationCredit(bookingId, '2026-10-11T13:20:05.000Z', 700, sandboxEnvelope(otherContext)),
          ride_credit_unsealed: cancellationCredit(bookingId, '2026-10-11T13:21:05.000Z', 900)
        }
      }
    });

    const response = await getEarnings(app);

    expect(response.body.report.totalNetAmount).toBe(0);
    expect(response.body.report.totalCancellationCreditAmount).toBe(0);
    expect(firestore.subcollectionQueries.map((query) => query.collection)).toEqual([SANDBOX_TRANSACTIONS]);
  });

  it('motorista operacional lê só o extrato operacional e ignora lançamento sandbox', async () => {
    const app = createApp();
    const bookingId = rideId('2026-10-11T13:00:00.000Z');
    const sandboxBookingId = rideId('2026-10-11T14:00:00.000Z');
    const { firestore } = mockRealtimeDb({
      users: { driver_1: driverProfile },
      rides: {
        [bookingId]: cancelledRide('2026-10-11T13:20:00.000Z')
      },
      firestoreCollections: {
        [OPERATIONAL_TRANSACTIONS]: {
          // Lançamento legado sem envelope e lançamento sandbox gravado no lugar errado.
          ride_credit_op: cancellationCredit(bookingId, '2026-10-11T13:20:05.000Z', 250),
          ride_credit_sandbox: cancellationCredit(sandboxBookingId, '2026-10-11T14:20:05.000Z', 700, sandboxEnvelope())
        },
        [SANDBOX_TRANSACTIONS]: {
          ride_credit_a: cancellationCredit(sandboxBookingId, '2026-10-11T14:20:05.000Z', 900, sandboxEnvelope())
        },
        payment_distributions: {
          [bookingId]: cancellationDistribution(bookingId, 300, 250)
        },
        sandbox_payment_distributions: {
          [bookingId]: cancellationDistribution(bookingId, 800, 250, sandboxEnvelope())
        }
      }
    });

    const response = await getEarnings(app);

    const { report } = response.body;
    expect(slotOf(report, '2026-10-11')).toMatchObject({
      amount: 2.5, grossAmount: 3, feeAmount: 0.5, cancelledCount: 1, cancellationCreditAmount: 2.5
    });
    expect(report.totalNetAmount).toBeCloseTo(2.5, 2);
    expect(firestore.subcollectionQueries.map((query) => query.collection)).toEqual([OPERATIONAL_TRANSACTIONS]);
    expect(firestore.batchReads).toEqual([[`payment_distributions/${bookingId}`]]);
  });

  it('extrato indisponível: o relatório responde com as corridas e avisa que as multas ficaram de fora', async () => {
    const app = createApp();
    mockRealtimeDb({
      users: { driver_1: driverProfile },
      profile: SANDBOX_QA_PROFILE,
      sandboxRides: {
        [rideId('2026-10-11T12:10:00.000Z')]: completedRide('2026-10-11T12:40:00.000Z', sandboxEnvelope())
      },
      firestoreOptions: { failSubcollectionQueryWith: new Error('UNAVAILABLE') }
    });

    const response = await getEarnings(app);

    expect(response.status).toBe(200);
    const { report } = response.body;
    expect(report.cancellationCreditsAvailable).toBe(false);
    expect(report.totalNetAmount).toBeCloseTo(41.93, 2);
    expect(report.totalCancellationCreditAmount).toBe(0);
    expect(report.tripsToday).toBe(1);
  });
});

describe('GET /api/drivers/nearby auth gate', () => {
  const originalFlag = process.env.NEARBY_REQUIRE_AUTH;
  const { logger } = require('../../../utils/logger');

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEARBY_REQUIRE_AUTH;
    } else {
      process.env.NEARBY_REQUIRE_AUTH = originalFlag;
    }
  });

  it('rejects requests without a token when the flag is on', async () => {
    process.env.NEARBY_REQUIRE_AUTH = 'true';

    const response = await request(createApp()).get('/api/drivers/nearby?lat=-22.9&lng=-43.3');

    expect(response.status).toBe(401);
  });

  it('lets an authenticated request through when the flag is on', async () => {
    process.env.NEARBY_REQUIRE_AUTH = 'true';

    const response = await request(createApp())
      .get('/api/drivers/nearby')
      .set('Authorization', 'Bearer firebase:passenger_1');

    // Passou da autenticação e parou na validação dos parâmetros.
    expect(response.status).toBe(400);
  });

  it('keeps the previous app version working while the flag is off', async () => {
    delete process.env.NEARBY_REQUIRE_AUTH;

    const response = await request(createApp()).get('/api/drivers/nearby');

    expect(response.status).toBe(400);
  });

  it('does not log request headers', async () => {
    logger.info.mockClear();

    await request(createApp())
      .get('/api/drivers/nearby')
      .set('Authorization', 'Bearer firebase:passenger_1');

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('firebase:passenger_1');
  });
});
