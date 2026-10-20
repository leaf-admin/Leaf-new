jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn(),
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => null),
}));

jest.mock('../../../firebase-config', () => ({ getFirestore: jest.fn(() => null) }));

const {
  PilotKpiService,
  computePilotKpis,
  computeDriverRetention,
  normalizeRide,
} = require('../../../services/pilot-kpi-service');

// 20/10/2026 15:00 em São Paulo.
const NOW = Date.parse('2026-10-20T18:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function snapshot(passengerPaidCents, { toll = 0, fee = 99, payment = 50, subscription = 0 } = {}) {
  return {
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    passengerPaidCents,
    tollFeeCents: toll,
    operationalFeeCents: fee,
    paymentIntermediationFeeCents: payment,
    subscriptionRetainedFeeCents: subscription,
    driverNetAmountCents: passengerPaidCents - fee - payment - subscription,
  };
}

function ride(id, overrides = {}) {
  const createdAt = overrides.createdAt ?? NOW - 3 * HOUR;
  return normalizeRide(id, {
    rideId: id,
    status: 'completed',
    passengerId: `p-${id}`,
    driverId: 'd1',
    paymentMethod: 'pix',
    createdAt: { toMillis: () => createdAt },
    acceptedAt: createdAt + 2 * MIN,
    completedAt: createdAt + 30 * MIN,
    financialSnapshot: snapshot(2000),
    ...overrides,
    ...(overrides.createdAt !== undefined ? { createdAt: { toMillis: () => createdAt } } : {}),
  });
}

describe('computePilotKpis', () => {
  const rides = [
    ride('r1', { driverId: 'd1', financialSnapshot: snapshot(1200) }),
    ride('r2', { driverId: 'd1', financialSnapshot: snapshot(2400) }),
    ride('r3', { driverId: 'd1', financialSnapshot: snapshot(3200, { toll: 500, fee: 149 }) }),
    ride('r4', { driverId: 'd2', financialSnapshot: snapshot(6000, { fee: 180 }), paymentMethod: 'card' }),
    ride('r5', { status: 'pending', driverId: null, acceptedAt: null, completedAt: null, financialSnapshot: null }),
    ride('r6', { status: 'completed', driverId: 'd2', financialSnapshot: { authoritativeSnapshot: false } }),
    ride('old', { createdAt: NOW - 3 * DAY }),
    ride('sandbox', { financialNamespace: 'sandbox' }),
  ];

  const result = computePilotKpis({
    rides,
    rideCostsBrl: { r1: 0.1, r2: 0.2, r3: 0.3 },
    bookingTimes: {
      r1: { paymentConfirmedAt: new Date(NOW - 3 * HOUR + MIN).toISOString(), acceptedAt: String(NOW - 3 * HOUR + 2 * MIN), driverArrivedAt: String(NOW - 3 * HOUR + 5 * MIN) },
      r2: { paymentConfirmedAt: new Date(NOW - 3 * HOUR + MIN).toISOString(), acceptedAt: null, driverArrivedAt: String(NOW - 3 * HOUR + 9 * MIN) },
    },
    onlineDriversNow: 4,
    days: 1,
    now: NOW,
  });

  it('counts rides per active driver and concentration, ignoring sandbox and old rides', () => {
    expect(result.corridas.pedidos).toBe(6);
    expect(result.corridas.concluidas).toBe(5);
    expect(result.corridas.motoristasAtivos).toBe(2);
    expect(result.corridas.corridasPorMotoristaAtivoDia).toEqual({ valor: 2.5, meta: 10, naMeta: false });
    expect(result.corridas.porMotorista).toMatchObject({ media: 2.5, mediana: 2.5, maximo: 3, top3Pct: 100 });
  });

  it('computes the ticket without toll, the fare bands and the Pix share', () => {
    // Brutos sem pedágio: 12, 24, 27, 60.
    expect(result.receita.corridasComSnapshot).toBe(4);
    expect(result.receita.corridasSemSnapshot).toBe(1);
    expect(result.receita.ticketMedioBrl).toEqual({ valor: 30.75, meta: 29, diferencaBrl: 1.75 });
    expect(result.receita.pctAte25).toBe(50);
    expect(result.receita.faixas.map((band) => band.corridas)).toEqual([1, 1, 1, 0, 1]);
    expect(result.receita.pctPix).toBe(80);
  });

  it('computes contribution only for rides that have a variable cost', () => {
    // ((0,99-0,10) + (0,99-0,20) + (1,49-0,30)) / 3; r4 não tem custo.
    expect(result.receita.contribuicaoPorCorridaBrl).toEqual({ valor: 0.96, amostras: 3, semCusto: 1 });
    expect(result.receita.receitaLeafBrl).toBe(5.27);
    expect(result.receita.custoVariavelBrl).toBe(0.6);
  });

  it('measures the passenger wait from Pix confirmation to arrival', () => {
    expect(result.espera.passageiro).toMatchObject({ amostras: 2, mediaMin: 6, medianaMin: 6, metaMin: 5, naMeta: false });
    expect(result.espera.aceiteAteChegada).toMatchObject({ amostras: 1, mediaMin: 3 });
    expect(result.espera.pedidoAteAceite.amostras).toBe(5);
  });

  it('compares supply and demand without exposing ids', () => {
    expect(result.ofertaDemanda).toMatchObject({
      motoristasOnlineAgora: 4,
      motoristasAtivos: 2,
      passageirosQuePediram: 6,
      pedidosSemAceite: 1,
      pctPedidosSemAceite: 16.7,
    });
    expect(result.ofertaDemanda.porHora).toEqual(expect.arrayContaining([
      expect.objectContaining({ hora: 12, pedidos: 6 }),
    ]));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"d1"|"d2"|p-r1/);
  });

  it('marks missing values with a reason instead of zero', () => {
    const empty = computePilotKpis({ rides: [], days: 1, now: NOW });
    expect(empty.corridas.corridasPorMotoristaAtivoDia).toEqual({ valor: null, motivo: expect.any(String) });
    expect(empty.receita.ticketMedioBrl.valor).toBeNull();
    expect(empty.espera.passageiro.mediaMin).toBeNull();
    expect(empty.retencao.valor).toBeNull();
  });
});

describe('computeDriverRetention', () => {
  const done = (driverId, daysAgo) => ({ driverId, completedAt: NOW - daysAgo * DAY, namespace: null });

  it('uses the first ride as cohort and the day 7-13 and 30-36 windows', () => {
    const retention = computeDriverRetention([
      done('a', 40), done('a', 33), done('a', 10), // D7 (dia 7) e D30 (dia 30)
      done('b', 40), // só a primeira corrida
      done('c', 20), done('c', 10), // D7 (dia 10); ainda não completou 37 dias
      done('d', 3), // coorte nova demais
    ], NOW);

    expect(retention.motoristasComCorrida).toBe(4);
    expect(retention.d7).toEqual({ valor: 66.7, retidos: 2, coorte: 3 });
    expect(retention.d30).toEqual({ valor: 50, retidos: 1, coorte: 2 });
  });

  it('says why when no cohort is old enough', () => {
    const retention = computeDriverRetention([done('a', 3)], NOW);
    expect(retention.d7.valor).toBeNull();
    expect(retention.d7.motivo).toMatch(/13 dias/);
  });
});

describe('PilotKpiService', () => {
  function fakeFirestore(docs) {
    const where = jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ docs: docs.map(([id, data]) => ({ id, data: () => data })) }),
    }));
    return { collection: jest.fn(() => ({ where })), where };
  }

  function fakeRedis() {
    const store = new Map();
    return {
      store,
      get: jest.fn(async (key) => store.get(key) || null),
      set: jest.fn(async (key, value) => store.set(key, value)),
      mget: jest.fn(async (keys) => keys.map((key) => (key.endsWith(':r1') ? JSON.stringify({ rideCostTotalBrl: 0.12 }) : null))),
      hmget: jest.fn(async () => [null, null, null]),
      zcard: jest.fn(async () => 3),
    };
  }

  function build(docs) {
    const firestore = fakeFirestore(docs);
    const redis = fakeRedis();
    const costGuard = { recordEndpointReadEstimate: jest.fn().mockResolvedValue({}) };
    const service = new PilotKpiService({
      getFirestore: () => firestore,
      redis: { ensureConnection: jest.fn(), getConnection: () => redis },
      costGuard,
      now: () => NOW,
    });
    return { service, firestore, redis, costGuard };
  }

  const docs = [['r1', {
    status: 'COMPLETED', driverId: 'd1', passengerId: 'p1', paymentMethod: 'pix',
    createdAt: NOW - HOUR, acceptedAt: NOW - HOUR + MIN, completedAt: NOW - 30 * MIN,
    financialSnapshot: snapshot(2500),
  }]];

  it('reads the rides collection once and serves the next call from cache', async () => {
    const { service, firestore, redis, costGuard } = build(docs);

    const first = await service.getSnapshot({ days: 1 });
    const second = await service.getSnapshot({ days: 1 });

    expect(first.cache).toBe('MISS');
    expect(second.cache).toBe('HIT');
    expect(firestore.collection).toHaveBeenCalledTimes(1);
    expect(firestore.collection).toHaveBeenCalledWith('rides');
    expect(firestore.where).toHaveBeenCalledWith('createdAt', '>=', new Date(NOW - 2 * DAY));
    expect(first.receita.contribuicaoPorCorridaBrl).toMatchObject({ valor: 0.87, amostras: 1 });
    expect(first.ofertaDemanda.motoristasOnlineAgora).toBe(3);
    expect(redis.set).toHaveBeenCalledWith('ops:pilot_kpis:v1:1', expect.any(String), 'EX', 300);
    expect(costGuard.recordEndpointReadEstimate).toHaveBeenCalledWith('ops.pilotKpis', { estimatedReads: 1 });
  });

  it('only loads the 70-day history for 7 and 30 day windows', async () => {
    const { service, firestore } = build(docs);

    const weekly = await service.getSnapshot({ days: 7 });

    expect(firestore.where).toHaveBeenCalledWith('createdAt', '>=', new Date(NOW - 70 * DAY));
    expect(weekly.retencao.motoristasComCorrida).toBe(1);
  });

  it('falls back to one day for an unsupported window', async () => {
    const { service } = build(docs);
    const result = await service.getSnapshot({ days: 99 });
    expect(result.periodo.dias).toBe(1);
  });

  it('fails clearly without Firestore', async () => {
    const service = new PilotKpiService({ getFirestore: () => null, redis: { getConnection: () => null }, costGuard: null, now: () => NOW });
    await expect(service.getSnapshot({ days: 1 })).rejects.toThrow('Firestore indisponível');
  });
});
