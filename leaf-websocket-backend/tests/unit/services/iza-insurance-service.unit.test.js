'use strict';

jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn(), logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { createIzaInsuranceService, KEYS } = require('../../../services/iza-insurance/iza-insurance-service');
const { IzaApiError, toIzaLocalDateTime, izaConfigErrors, createIzaClient } = require('../../../services/iza-insurance/iza-client');
const { extractIzaRideEvent } = require('../../../services/iza-insurance/iza-ride-events');
const { resolveIzaIdentity } = require('../../../services/iza-insurance/iza-driver-identity');

// Redis em memória com o que o serviço usa; TTL segue o relógio do teste.
function createMemoryRedis(clock) {
  const values = new Map();
  const expires = new Map();
  const alive = (key) => {
    const at = expires.get(key);
    if (at !== undefined && at <= clock.ms) {
      values.delete(key);
      expires.delete(key);
    }
    return values.has(key);
  };
  const get = (key, fallback) => (alive(key) ? values.get(key) : fallback);
  return {
    values,
    async get(key) {
      const value = get(key, null);
      return typeof value === 'string' ? value : null;
    },
    async set(key, value, ...args) {
      const nx = args.includes('NX');
      if (nx && alive(key)) return null;
      values.set(key, String(value));
      const exIndex = args.indexOf('EX');
      if (exIndex >= 0) expires.set(key, clock.ms + Number(args[exIndex + 1]) * 1000);
      else expires.delete(key);
      return 'OK';
    },
    async del(key) {
      const had = alive(key);
      values.delete(key);
      expires.delete(key);
      return had ? 1 : 0;
    },
    async exists(key) {
      return alive(key) ? 1 : 0;
    },
    async expire(key, seconds) {
      if (alive(key)) expires.set(key, clock.ms + seconds * 1000);
      return 1;
    },
    async incr(key) {
      const next = Number(get(key, '0')) + 1;
      values.set(key, String(next));
      return next;
    },
    async hgetall(key) {
      return { ...(get(key, {}) || {}) };
    },
    async hincrby(key, field, by) {
      const hash = get(key, {}) || {};
      hash[field] = String(Number(hash[field] || 0) + by);
      values.set(key, hash);
      return Number(hash[field]);
    },
    async lpush(key, value) {
      const list = get(key, []);
      list.unshift(value);
      values.set(key, list);
      return list.length;
    },
    async rpush(key, value) {
      const list = get(key, []);
      list.push(value);
      values.set(key, list);
      return list.length;
    },
    async lpop(key) {
      const list = get(key, []);
      const value = list.shift();
      values.set(key, list);
      return value === undefined ? null : value;
    },
    async ltrim(key, start, stop) {
      values.set(key, get(key, []).slice(start, stop + 1));
      return 'OK';
    },
    async lrange(key, start, stop) {
      return get(key, []).slice(start, stop + 1);
    },
    async zadd(key, score, member) {
      const zset = get(key, new Map());
      zset.set(member, Number(score));
      values.set(key, zset);
      return 1;
    },
    async zrem(key, member) {
      const zset = get(key, new Map());
      zset.delete(member);
      values.set(key, zset);
      return 1;
    },
    async zrangebyscore(key, min, max, ...rest) {
      const zset = get(key, new Map());
      const top = max === '+inf' ? Infinity : Number(max);
      const limit = rest[0] === 'LIMIT' ? Number(rest[2]) : Infinity;
      return [...zset.entries()].filter(([, score]) => score <= top).sort((a, b) => a[1] - b[1]).slice(0, limit).map(([member]) => member);
    },
    setBooking(bookingId, fields) {
      values.set(`booking:${bookingId}`, { ...fields });
    },
    setDriver(driverId, fields) {
      values.set(`driver:${driverId}`, { ...fields });
    }
  };
}

const DOCS = { 'driver-a': '52998224725', 'driver-b': '11144477735' };

function createFakeIza() {
  let seq = 0;
  const calls = [];
  const fake = {
    calls,
    failNext: {},
    periods: [],
    async createPerson(input) {
      calls.push(['createPerson', input]);
      return { created: true, person: { id: `person-${input.doc}` } };
    },
    async createContract(input) {
      calls.push(['createContract', input]);
      return { created: true, contractId: `contract-${input.doc}` };
    },
    async openPeriod(input) {
      calls.push(['openPeriod', input]);
      if (fake.failNext.open) {
        const error = fake.failNext.open;
        fake.failNext.open = null;
        if (error.createdAnyway) {
          seq += 1;
          fake.periods.push({ id: `period-${seq}`, doc: input.doc, startedAt: input.startedAt, status: 'open' });
        }
        throw error;
      }
      seq += 1;
      const period = { id: `period-${seq}`, doc: input.doc, startedAt: input.startedAt, status: 'open' };
      fake.periods.push(period);
      return { periodId: period.id };
    },
    async closePeriod(input) {
      calls.push(['closePeriod', input]);
      if (fake.failNext.close) {
        const error = fake.failNext.close;
        fake.failNext.close = null;
        throw error;
      }
      const period = fake.periods.find((item) => item.id === input.periodId);
      if (period) Object.assign(period, { status: 'finished', finishedAt: input.finishedAt });
      return { closed: true, alreadyFinal: false };
    },
    async cancelPeriod(input) {
      calls.push(['cancelPeriod', input]);
      const period = fake.periods.find((item) => item.id === input.periodId);
      if (period) period.status = 'canceled';
      return { canceled: true };
    },
    async sendGeolocation(input) {
      calls.push(['sendGeolocation', input]);
      return { sent: true };
    },
    async listPeriods(input) {
      calls.push(['listPeriods', input]);
      return fake.periods.filter((period) => period.doc === input.doc).map((period) => ({ ...period }));
    },
    names: () => calls.map(([name]) => name)
  };
  return fake;
}

function setup({ enabled = true, identity = null } = {}) {
  const clock = { ms: Date.parse('2026-11-24T15:00:00.000Z') }; // 12:00 em Brasília
  const redis = createMemoryRedis(clock);
  const iza = createFakeIza();
  const userStore = { updateUser: jest.fn(async () => undefined) };
  const service = createIzaInsuranceService({
    client: iza,
    redis,
    getFirestore: () => ({ collection: () => ({ doc: () => ({ set: async () => undefined }) }) }),
    loadIdentity: async (_firestore, driverId) => identity || {
      ok: true,
      missing: [],
      doc: DOCS[driverId],
      name: `Motorista ${driverId}`,
      birthDate: '1990-01-01',
      nameSource: 'cnh'
    },
    userStore,
    config: { enabled, environment: 'hml', baseUrl: 'https://iza.test', userApiId: 'u', secretKey: 's', timeoutMs: 1000 },
    now: () => new Date(clock.ms),
    sleep: async () => undefined
  });
  const advance = async (ms) => {
    clock.ms += ms;
  };
  const sweep = async () => {
    await redis.del(KEYS.sweepLock);
    return service.sweep();
  };
  return { clock, redis, iza, service, advance, sweep, userStore };
}

describe('seguro por corrida (IZA)', () => {
  test('corrida concluída: cadastra o motorista, abre e encerra um período em horário de Brasília', async () => {
    const { service, iza, redis, advance } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS', startedAt: '2026-11-24T15:00:00.000Z' });

    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    expect(iza.names()).toEqual(['createPerson', 'createContract', 'openPeriod']);
    expect(iza.calls[2][1]).toEqual({ doc: DOCS['driver-a'], startedAt: '2026-11-24T12:00:00', timezone: 'America/Sao_Paulo' });

    await advance(20 * 60 * 1000);
    redis.setBooking('ride-1', { status: 'COMPLETED' });
    await service.handleRideEnded({ bookingId: 'ride-1', kind: 'completed', endedAt: '2026-11-24T15:20:00.000Z' });

    expect(iza.calls.at(-1)).toEqual(['closePeriod', { periodId: 'period-1', finishedAt: '2026-11-24T12:20:00' }]);
    const record = await service.loadRecord('ride-1');
    expect(record.state).toBe('done');
    expect(record.closedSegments[0]).toMatchObject({ periodId: 'period-1', status: 'finished' });
  });

  test('segunda corrida do mesmo motorista não cadastra de novo', async () => {
    const { service, iza, redis } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    redis.setBooking('ride-2', { status: 'IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await service.handleRideEnded({ bookingId: 'ride-1', kind: 'completed' });
    await service.handleRideStarted({ bookingId: 'ride-2', driverId: 'driver-a' });
    expect(iza.names().filter((name) => name === 'createPerson')).toHaveLength(1);
    expect(iza.names().filter((name) => name === 'openPeriod')).toHaveLength(2);
  });

  test('evento de início repetido não abre outro período', async () => {
    const { service, iza, redis } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    expect(iza.names().filter((name) => name === 'openPeriod')).toHaveLength(1);
  });

  test('cancelada nos 2 primeiros minutos: cancela; depois disso: encerra', async () => {
    const early = setup();
    early.redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await early.service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await early.advance(60 * 1000);
    await early.service.handleRideEnded({ bookingId: 'ride-1', kind: 'canceled' });
    expect(early.iza.names().at(-1)).toBe('cancelPeriod');

    const late = setup();
    late.redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await late.service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await late.advance(5 * 60 * 1000);
    await late.service.handleRideEnded({ bookingId: 'ride-1', kind: 'canceled' });
    expect(late.iza.names().at(-1)).toBe('closePeriod');
    expect(late.iza.names()).not.toContain('cancelPeriod');
  });

  test('cancelada antes de começar não gera período', async () => {
    const { service, iza } = setup();
    const result = await service.handleRideEnded({ bookingId: 'ride-x', kind: 'canceled' });
    expect(result).toMatchObject({ skipped: true });
    expect(iza.calls).toHaveLength(0);
  });

  test('falha temporária ao abrir: tenta de novo e, se a IZA já criou, aproveita sem duplicar', async () => {
    const { service, iza, redis, advance, sweep } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    iza.failNext.open = Object.assign(new IzaApiError('timeout', { retryable: true, code: 'IZA_TIMEOUT' }), { createdAnyway: true });

    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    expect((await service.loadRecord('ride-1')).segment.periodId).toBeNull();

    await advance(45 * 1000);
    await sweep();
    const record = await service.loadRecord('ride-1');
    expect(record.segment.periodId).toBe('period-1');
    expect(iza.names().filter((name) => name === 'openPeriod')).toHaveLength(1);
    expect(iza.names()).toContain('listPeriods');
  });

  test('falha temporária ao abrir sem período do lado da IZA: abre na nova tentativa', async () => {
    const { service, iza, redis, advance, sweep } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    iza.failNext.open = new IzaApiError('503', { status: 503, retryable: true });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await advance(45 * 1000);
    await sweep();
    expect((await service.loadRecord('ride-1')).segment.periodId).toBe('period-1');
    expect(iza.names().filter((name) => name === 'openPeriod')).toHaveLength(2);
  });

  test('corrida que terminou sem evento é encerrada pelo ciclo', async () => {
    const { service, iza, redis, advance, sweep } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await advance(10 * 60 * 1000);
    redis.setBooking('ride-1', { status: 'EARLY_ENDED_REVIEW', completedAt: '2026-11-24T15:08:00.000Z' });
    await sweep();
    expect(iza.calls.at(-1)).toEqual(['closePeriod', { periodId: 'period-1', finishedAt: '2026-11-24T12:08:00' }]);
    expect((await service.loadRecord('ride-1')).state).toBe('done');
  });

  test('corrida acima de 2 h: encerra o período e abre o próximo', async () => {
    const { service, iza, redis, advance, sweep } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await advance(116 * 60 * 1000);
    await sweep();
    const names = iza.names();
    expect(names.slice(-2)).toEqual(['closePeriod', 'openPeriod']);
    const record = await service.loadRecord('ride-1');
    expect(record.closedSegments).toHaveLength(1);
    expect(record.segment).toMatchObject({ seq: 2, periodId: 'period-2' });
  });

  test('troca de motorista no meio da corrida: encerra o anterior e abre no CPF do novo', async () => {
    const { service, iza, redis, advance } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await advance(15 * 60 * 1000);
    redis.setBooking('ride-1', { status: 'REASSIGNED_IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-b' });
    const opens = iza.calls.filter(([name]) => name === 'openPeriod').map(([, input]) => input.doc);
    expect(opens).toEqual([DOCS['driver-a'], DOCS['driver-b']]);
    expect(iza.calls.find(([name]) => name === 'closePeriod')[1].periodId).toBe('period-1');
  });

  test('falha ao encerrar fica pendente e o ciclo repete', async () => {
    const { service, iza, redis, advance, sweep } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    iza.failNext.close = new IzaApiError('503', { status: 503, retryable: true });
    await service.handleRideEnded({ bookingId: 'ride-1', kind: 'completed' });
    expect((await service.loadRecord('ride-1')).pendingCloses).toHaveLength(1);
    await advance(40 * 1000);
    await sweep();
    const record = await service.loadRecord('ride-1');
    expect(record.pendingCloses).toHaveLength(0);
    expect(record.state).toBe('done');
    expect(iza.names().filter((name) => name === 'closePeriod')).toHaveLength(2);
  });

  test('dado do motorista faltando: não abre período e não lança erro', async () => {
    const { service, iza, redis } = setup({ identity: { ok: false, missing: ['birthDate'] } });
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await expect(service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' })).resolves.toEqual({ ok: true });
    expect(iza.names()).not.toContain('openPeriod');
    const stats = await redis.hgetall('iza:stats:2026-11-24');
    expect(stats.periods_open_failed).toBe('1');
  });

  test('GPS: um ponto por minuto, só com localização recente', async () => {
    const { service, iza, redis, advance, sweep, clock } = setup();
    redis.setBooking('ride-1', { status: 'IN_PROGRESS' });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await advance(60 * 1000);
    redis.setDriver('driver-a', { lat: '-22.970722', lng: '-43.182365', lastUpdate: String(clock.ms - 5000) });
    await sweep();
    await sweep(); // mesmo minuto: não repete
    const geo = iza.calls.filter(([name]) => name === 'sendGeolocation');
    expect(geo).toHaveLength(1);
    expect(geo[0][1]).toMatchObject({ doc: DOCS['driver-a'], lat: -22.970722, lng: -43.182365 });

    await advance(60 * 1000);
    redis.setDriver('driver-a', { lat: '-22.97', lng: '-43.18', lastUpdate: String(clock.ms - 10 * 60 * 1000) });
    await sweep();
    expect(iza.calls.filter(([name]) => name === 'sendGeolocation')).toHaveLength(1);
  });

  test('flag desligada: nada é enviado', async () => {
    const { service, iza } = setup({ enabled: false });
    await service.handleRideStarted({ bookingId: 'ride-1', driverId: 'driver-a' });
    await service.registerDriver('driver-a');
    expect(iza.calls).toHaveLength(0);
  });

  test('cadastro na aprovação com falha temporária entra na fila de repetição', async () => {
    const { service, iza, redis, advance, sweep } = setup();
    const original = iza.createPerson;
    iza.createPerson = async () => {
      throw new IzaApiError('503', { status: 503, retryable: true });
    };
    await service.registerDriver('driver-a');
    iza.createPerson = original;
    await advance(40 * 1000);
    await sweep();
    expect(await redis.get('iza:insured:driver-a')).toBe(DOCS['driver-a']);
  });
});

describe('apoio da integração IZA', () => {
  test('horário de Brasília sem offset', () => {
    expect(toIzaLocalDateTime('2026-11-24T02:30:05.000Z')).toBe('2026-11-23T23:30:05');
  });

  test('evento do stream com payload aninhado', () => {
    const started = extractIzaRideEvent('ride.started', {
      data: { eventId: 'e', occurredAt: 1764000000000, eventType: 'ride.started', data: { bookingId: 'b1', driverId: 'd1' } }
    });
    expect(started).toEqual({ kind: 'started', bookingId: 'b1', driverId: 'd1', startedAt: 1764000000000 });
    expect(extractIzaRideEvent('ride.canceled', { data: { bookingId: 'b1' } })).toMatchObject({ kind: 'canceled', bookingId: 'b1' });
    expect(extractIzaRideEvent('ride.accepted', { data: { bookingId: 'b1' } })).toBeNull();
  });

  test('identidade: nome da CNH, CPF válido e nascimento obrigatórios', () => {
    const ok = resolveIzaIdentity({ user: { name: 'Apelido', cpf: '529.982.247-25' }, cnh: { nome: 'JOSE DA SILVA', dataNascimento: '01/02/1990' } });
    expect(ok).toMatchObject({ ok: true, doc: '52998224725', name: 'JOSE DA SILVA', birthDate: '1990-02-01', nameSource: 'cnh' });
    const bad = resolveIzaIdentity({ user: { name: 'Fulano', cpf: '11111111111' } });
    expect(bad.ok).toBe(false);
    expect(bad.missing).toEqual(['cpf', 'birthDate']);
  });

  test('config: flag ligada exige credencial e host do mesmo ambiente', () => {
    expect(izaConfigErrors({})).toEqual([]);
    expect(izaConfigErrors({ IZA_INSURANCE_ENABLED: 'true' })[0]).toMatch(/exige/);
    expect(izaConfigErrors({
      IZA_INSURANCE_ENABLED: 'true',
      IZA_ENV: 'prod',
      IZA_API_BASE_URL: 'https://intermittent-web-api.hml.iza.com.vc/api/integrations',
      IZA_USER_API_ID: 'u',
      IZA_SECRET_KEY: 's'
    })).toEqual(['IZA_ENV=prod apontando para o host de homologação da IZA']);
    expect(izaConfigErrors({
      IZA_INSURANCE_ENABLED: 'true',
      IZA_ENV: 'hml',
      IZA_API_BASE_URL: 'https://intermittent-web-api.hml.iza.com.vc/api/integrations',
      IZA_USER_API_ID: 'u',
      IZA_SECRET_KEY: 's'
    })).toEqual([]);
  });

  test('cliente: trata respostas reais da homologação', async () => {
    const responses = [];
    const fetchImpl = jest.fn(async () => {
      const [status, body] = responses.shift();
      return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
    });
    const client = createIzaClient({
      config: { baseUrl: 'https://iza.test/api', userApiId: 'u', secretKey: 's', timeoutMs: 1000 },
      fetchImpl
    });
    responses.push([400, { errors: { details: 'already_has_contract' } }]);
    await expect(client.createContract({ doc: '52998224725' })).resolves.toEqual({ created: false, contractId: null });
    responses.push([409, { error: { detail: 'Período não pode ser atualizado. Status Atual do período: Finished' } }]);
    await expect(client.closePeriod({ periodId: 'p', finishedAt: '2026-11-24T12:00:00' })).resolves.toMatchObject({ alreadyFinal: true });
    responses.push([409, { error: { detail: 'period already canceled' } }]);
    await expect(client.cancelPeriod({ periodId: 'p' })).resolves.toMatchObject({ canceled: true, alreadyFinal: true });
    responses.push([409, { error: { detail: 'cancellation tolerance time exceeded' } }]);
    await expect(client.cancelPeriod({ periodId: 'p' })).resolves.toMatchObject({ canceled: false, tooLate: true });
    responses.push([200, [{ id: 'p1', startedAt: '2026-11-24T12:00:00Z', finishedAt: '2026-11-24T12:20:00Z', status: 2, type: 1 }]]);
    await expect(client.listPeriods({ doc: '52998224725' })).resolves.toEqual([
      { id: 'p1', startedAt: '2026-11-24T12:00:00', finishedAt: '2026-11-24T12:20:00', status: 'finished' }
    ]);
    responses.push([503, '<html>fora do horário</html>']);
    await expect(client.openPeriod({ doc: '52998224725', startedAt: '2026-11-24T12:00:00' })).rejects.toMatchObject({ retryable: true, status: 503 });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Basic ${Buffer.from('u:s').toString('base64')}`);
  });
});
