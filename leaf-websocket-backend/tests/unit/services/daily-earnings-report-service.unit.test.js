const redisData = new Map();
const redisHashes = new Map();
const redisSets = new Map();

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  hgetall: jest.fn(),
  hset: jest.fn(),
  hincrbyfloat: jest.fn(),
  expire: jest.fn(),
  zadd: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  del: jest.fn(),
};

const mockEnsureConnection = jest.fn(async () => undefined);
const mockGetConnection = jest.fn(() => mockRedis);
const mockAxiosPost = jest.fn(async () => ({ status: 204 }));
const mockCronSchedule = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: (...args) => mockEnsureConnection(...args),
  getConnection: (...args) => mockGetConnection(...args),
}));

jest.mock('axios', () => ({
  post: (...args) => mockAxiosPost(...args),
}));

jest.mock('node-cron', () => ({
  schedule: (...args) => mockCronSchedule(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
}));

const service = require('../../../services/daily-earnings-report-service');
const { _private } = service;

function hgetNumber(key, field) {
  return Number(redisHashes.get(key)?.[field] || 0);
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
    ...overrides,
  };
}

describe('daily-earnings-report-service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LEAF_REPORT_TIME_ZONE: 'America/Sao_Paulo',
      DISCORD_EARNINGS_WEBHOOK_URL: 'https://discord.example/webhook',
      DAILY_EARNINGS_REPORT_ENABLED: 'true',
    };
    redisData.clear();
    redisHashes.clear();
    redisSets.clear();
    jest.clearAllMocks();

    mockRedis.get.mockImplementation(async (key) => redisData.get(key) || null);
    mockRedis.set.mockImplementation(async (key, value, ...options) => {
      if (options.includes('NX') && redisData.has(key)) return null;
      redisData.set(key, value);
      return 'OK';
    });
    mockRedis.hgetall.mockImplementation(async (key) => redisHashes.get(key) || {});
    mockRedis.hset.mockImplementation(async (key, value) => {
      redisHashes.set(key, {
        ...(redisHashes.get(key) || {}),
        ...value,
      });
      return 1;
    });
    mockRedis.hincrbyfloat.mockImplementation(async (key, field, increment) => {
      const current = Number(redisHashes.get(key)?.[field] || 0);
      const next = current + Number(increment || 0);
      redisHashes.set(key, {
        ...(redisHashes.get(key) || {}),
        [field]: String(next),
      });
      return String(next);
    });
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.del.mockImplementation(async (key) => {
      redisData.delete(key);
      redisHashes.delete(key);
      redisSets.delete(key);
      return 1;
    });
    mockRedis.sadd.mockImplementation(async (key, member) => {
      const set = redisSets.get(key) || new Set();
      set.add(member);
      redisSets.set(key, set);
      return 1;
    });
    mockRedis.srem.mockImplementation(async (key, member) => {
      const set = redisSets.get(key) || new Set();
      set.delete(member);
      redisSets.set(key, set);
      return 1;
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('cria snapshot com custo sem Woovi e ganho liquido da plataforma', () => {
    const snapshot = _private.snapshotFromReportAndBooking({
      bookingId: 'booking-1',
      totals: {
        cost: {
          totalBrl: 5.14,
          googleUsd: 0.027,
          infrastructureUsd: 0.00004,
          wooviUsd: 0.9615,
          exchangeRateUsdBrl: 5.2,
        },
        infrastructure: {
          firebase: { estimatedCostUsd: 0.00002 },
        },
        google: {
          directions: { requestCount: 2 },
        },
      },
    }, {
      status: 'COMPLETED',
      completedAt: '2026-05-13T12:00:00-03:00',
      finalFare: '22.00',
      operationalFee: '0.99',
      financialSnapshot: JSON.stringify(buildBackendFinalSnapshot()),
    });

    expect(snapshot).toEqual(expect.objectContaining({
      bookingId: 'booking-1',
      dateKey: '2026-05-13',
      completedRides: 1,
      operationalFeeTotalBrl: 0.99,
      rideCostTotalBrl: 0.14,
      platformNetTotalBrl: 0.85,
      directionsRequestsTotal: 2,
    }));
  });

  it('nao cria snapshot final a partir de tarifa estimada sem backend_final', () => {
    const snapshot = _private.snapshotFromReportAndBooking({
      bookingId: 'booking-pending-reconciliation',
      totals: {
        cost: { totalBrl: 0.14, googleUsd: 0.027, exchangeRateUsdBrl: 5.2 },
        google: { directions: { requestCount: 2 } },
      },
    }, {
      status: 'COMPLETED',
      completedAt: '2026-05-13T12:00:00-03:00',
      finalFare: '22.00',
      estimatedFare: '22.00',
      operationalFee: '0.99',
    });

    expect(snapshot).toBeNull();
  });

  it('atualiza rollup de forma idempotente quando a mesma corrida muda de custo', async () => {
    redisHashes.set('booking:booking-1', {
      status: 'COMPLETED',
      completedAt: '2026-05-13T12:00:00-03:00',
      finalFare: '22',
      operationalFee: '0.99',
      financialSnapshot: JSON.stringify(buildBackendFinalSnapshot()),
    });

    await service.recordCompletedRideFromReport({
      bookingId: 'booking-1',
      totals: {
        cost: { totalBrl: 0.14, googleUsd: 0.027, exchangeRateUsdBrl: 5.2 },
        google: { directions: { requestCount: 2 } },
      },
    });
    await service.recordCompletedRideFromReport({
      bookingId: 'booking-1',
      totals: {
        cost: { totalBrl: 0.20, googleUsd: 0.038, exchangeRateUsdBrl: 5.2 },
        google: { directions: { requestCount: 3 } },
      },
    });

    const key = 'daily_earnings_report:2026-05-13';
    expect(hgetNumber(key, 'completedRides')).toBe(1);
    expect(hgetNumber(key, 'operationalFeeTotalBrl')).toBeCloseTo(0.99, 6);
    expect(hgetNumber(key, 'rideCostTotalBrl')).toBeCloseTo(0.20, 6);
    expect(hgetNumber(key, 'platformNetTotalBrl')).toBeCloseTo(0.79, 6);
    expect(hgetNumber(key, 'directionsRequestsTotal')).toBe(3);
  });

  it('envia payload diario para o webhook de earnings', async () => {
    redisHashes.set('daily_earnings_report:2026-05-13', {
      dateKey: '2026-05-13',
      completedRides: '2',
      rideCostTotalBrl: '0.32',
      googleCostTotalBrl: '0.30',
      firebaseCostTotalBrl: '0.01',
      infrastructureCostTotalBrl: '0.01',
      operationalFeeTotalBrl: '1.98',
      platformNetTotalBrl: '1.66',
      directionsRequestsTotal: '4',
    });
    redisHashes.set('{kyc:aws:cost}:usage_day:2026-05-13', {
      reportDay: '2026-05-13',
      sessionCount: '10',
      estimatedCostMicros: '160000',
    });

    const result = await service.sendDailyReport('2026-05-13', { force: true });

    expect(result.sent).toBe(true);
    expect(result.summary).toMatchObject({
      kycAwsSessionsTotal: 10,
      kycAwsEstimatedCostUsd: 0.16,
      kycAwsEstimatedCostBrl: 0.83,
    });
    expect(mockAxiosPost).toHaveBeenCalledWith(
      'https://discord.example/webhook',
      expect.objectContaining({
        username: 'Leaf Earnings',
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: 'Leaf earnings daily - 2026-05-13',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'AWS KYC estimado',
                value: '10 sessoes · US$ 0,16 (≈ R$ 0,83)',
              }),
            ]),
          }),
        ]),
      }),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('envia o custo KYC mesmo quando nao houve corrida e relatorios vazios estao desativados', async () => {
    process.env.DAILY_EARNINGS_REPORT_SEND_EMPTY = 'false';
    redisHashes.set('{kyc:aws:cost}:usage_day:2026-05-13', {
      sessionCount: '1',
      estimatedCostMicros: '16000',
    });

    const result = await service.sendDailyReport('2026-05-13', { force: true });

    expect(result).toMatchObject({
      sent: true,
      summary: {
        completedRides: 0,
        kycAwsSessionsTotal: 1,
        kycAwsEstimatedCostUsd: 0.016,
      },
    });
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  });
});
