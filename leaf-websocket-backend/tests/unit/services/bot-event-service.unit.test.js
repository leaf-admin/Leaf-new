jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn(),
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => null),
}));

const crypto = require('crypto');
const {
  BotEventService,
  ROUTES,
  signPayload,
  sanitizeData,
  retryDelayMs,
} = require('../../../services/bot-event-service');

const SECRET = `whsec_${Buffer.from('segredo-de-teste-dos-bots').toString('base64')}`;
const ENV_KEYS = ['BOT_EVENTS_ENABLED', 'BOT_EVENTS_SUPORTE_URL', 'BOT_EVENTS_SUPORTE_SECRET', 'BOT_EVENTS_CFO_URL', 'BOT_EVENTS_CFO_SECRET'];

function fakeRedis() {
  const strings = new Map();
  const hash = new Map();
  const zset = new Map();
  const lists = new Map();
  return {
    strings,
    hash,
    zset,
    lists,
    set: jest.fn(async (key, value, ...args) => {
      if (args.includes('NX') && strings.has(key)) return null;
      strings.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key) => strings.delete(key)),
    hset: jest.fn(async (_key, field, value) => hash.set(field, value)),
    hget: jest.fn(async (_key, field) => hash.get(field) || null),
    hdel: jest.fn(async (_key, field) => hash.delete(field)),
    zadd: jest.fn(async (_key, score, member) => zset.set(member, score)),
    zrem: jest.fn(async (_key, member) => zset.delete(member)),
    zrangebyscore: jest.fn(async (_key, _min, max) => [...zset.entries()]
      .filter(([, score]) => score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member)),
    lpush: jest.fn(async (key, value) => lists.set(key, [value, ...(lists.get(key) || [])])),
    ltrim: jest.fn(async () => 'OK'),
  };
}

function build({ now = Date.parse('2026-10-20T18:00:00Z'), post = jest.fn().mockResolvedValue({ status: 204 }) } = {}) {
  const redis = fakeRedis();
  const clock = { now };
  const service = new BotEventService({
    redis: { ensureConnection: jest.fn(), getConnection: () => redis },
    http: { post },
    now: () => clock.now,
  });
  return { service, redis, post, clock };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('bot event service', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.BOT_EVENTS_ENABLED = 'true';
    process.env.BOT_EVENTS_SUPORTE_URL = 'https://relay.example.test/hooks/suporte';
    process.env.BOT_EVENTS_SUPORTE_SECRET = SECRET;
    process.env.BOT_EVENTS_CFO_URL = 'https://relay.example.test/hooks/cfo';
    process.env.BOT_EVENTS_CFO_SECRET = SECRET;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('signs in the OpenBot webhook format the app verifies', () => {
    const body = '{"id":"evt_1","type":"test.ping"}';
    const expected = crypto.createHmac('sha256', SECRET).update('1792544000.evt_1.').update(body).digest('hex');
    expect(signPayload({ secret: SECRET, id: 'evt_1', timestamp: '1792544000', body })).toBe(`sha256=${expected}`);
    expect(signPayload({ secret: SECRET, id: 'evt_1', timestamp: '1792544000', body })).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('does nothing while the flag is off', async () => {
    process.env.BOT_EVENTS_ENABLED = 'false';
    const { service, redis, post } = build();

    await expect(service.emit('support.ticket_created', { ticketId: 'T1' })).resolves.toEqual({ queued: 0, skipped: 'disabled' });
    await expect(service.drain()).resolves.toMatchObject({ skipped: 'disabled' });
    expect(redis.set).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('delivers a signed event with only the allowed fields', async () => {
    const { service, post } = build();

    const result = await service.emit('support.ticket_created', {
      ticketId: 'TICKET-1',
      category: 'payment',
      priority: 'N2',
      userId: 'uid-123',
      name: 'Maria',
      phone: '+5521999999999',
      description: 'meu cpf é 123.456.789-09',
    }, { dedupeKey: 'TICKET-1', severity: 'N2', money: true });
    await flush();

    expect(result.queued).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, options] = post.mock.calls[0];
    expect(url).toBe('https://relay.example.test/hooks/suporte');
    const event = JSON.parse(body);
    expect(event).toMatchObject({
      id: result.id,
      type: 'support.ticket_created',
      severity: 'N2',
      money: true,
      data: { ticketId: 'TICKET-1', category: 'payment', priority: 'N2' },
    });
    expect(body).not.toMatch(/uid-123|Maria|99999|123\.456/);

    const {
      'x-openbot-delivery-id': id,
      'x-openbot-timestamp': timestamp,
      'x-openbot-signature': signature,
    } = options.headers;
    expect(id).toBe(result.id);
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
    expect(timestamp).toMatch(/^[0-9]{1,12}$/);
    const expected = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${id}.`).update(body).digest('hex');
    expect(signature).toBe(`sha256=${expected}`);
  });

  it('sends one event to every configured destination and skips the rest', async () => {
    const { service, post } = build();

    // dispute.opened vai para cfo e suporte; refund.record_failed para cfo e cto (sem URL).
    await service.emit('dispute.opened', { disputeId: 'D1' }, { dedupeKey: 'D1' });
    const partial = await service.emit('refund.record_failed', { bookingId: 'B1' }, { dedupeKey: 'B1' });
    await flush();

    expect(ROUTES['refund.record_failed']).toEqual(['cfo', 'cto']);
    expect(ROUTES['safety.signal']).toEqual(['seguranca']);
    expect(partial.queued).toBe(1);
    expect(post.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://relay.example.test/hooks/cfo',
      'https://relay.example.test/hooks/cfo',
      'https://relay.example.test/hooks/suporte',
    ]);
  });

  it('never queues the same event twice', async () => {
    const { service } = build();

    const first = await service.emit('support.ticket_created', { ticketId: 'T1' }, { dedupeKey: 'T1' });
    const second = await service.emit('support.ticket_created', { ticketId: 'T1' }, { dedupeKey: 'T1' });

    expect(first.queued).toBe(1);
    expect(second).toEqual({ queued: 0, skipped: 'duplicate', id: first.id });
  });

  it('retries with backoff while the Mac is offline, then delivers', async () => {
    const post = jest.fn()
      .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValue({ status: 204 });
    const { service, redis, clock } = build({ post });

    await service.emit('support.ticket_created', { ticketId: 'T1' }, { dedupeKey: 'T1' });
    await flush();
    expect(redis.zset.size).toBe(1);
    const [member] = redis.zset.keys();
    expect(redis.zset.get(member)).toBe(clock.now + 30000);

    await expect(service.drain()).resolves.toMatchObject({ delivered: 0, retried: 0 });

    clock.now += 30000;
    await expect(service.drain()).resolves.toMatchObject({ retried: 1 });
    expect(redis.zset.get(member)).toBe(clock.now + 60000);

    clock.now += 60000;
    await expect(service.drain()).resolves.toMatchObject({ delivered: 1 });
    expect(redis.zset.size).toBe(0);
    expect(redis.hash.size).toBe(0);
  });

  it('drops to the dead letter list after 24 h or on a permanent error', async () => {
    const post = jest.fn().mockRejectedValue({ code: 'ETIMEDOUT' });
    const { service, redis, clock } = build({ post });

    await service.emit('support.ticket_created', { ticketId: 'T1' }, { dedupeKey: 'T1' });
    await flush();
    clock.now += 24 * 60 * 60 * 1000;
    await expect(service.drain()).resolves.toMatchObject({ dropped: 1 });
    expect(redis.zset.size).toBe(0);
    expect(JSON.parse(redis.lists.get('bot_events:dead')[0])).toMatchObject({ destination: 'suporte', lastError: 'ETIMEDOUT' });

    post.mockRejectedValue({ response: { status: 401 } });
    await service.emit('support.ticket_created', { ticketId: 'T2' }, { dedupeKey: 'T2' });
    await flush();
    expect(redis.lists.get('bot_events:dead')).toHaveLength(2);
  });

  it('only one process drains at a time', async () => {
    const { service, redis, post } = build();
    redis.strings.set('bot_events:drain_lock', 'other-pid');
    await service.emit('support.ticket_created', { ticketId: 'T1' }, { dedupeKey: 'T1' });
    await flush();

    await expect(service.drain()).resolves.toMatchObject({ skipped: 'locked' });
    expect(post).not.toHaveBeenCalled();
  });

  it('never throws to the caller', async () => {
    const service = new BotEventService({
      redis: { ensureConnection: jest.fn().mockRejectedValue(new Error('redis down')), getConnection: () => null },
      http: { post: jest.fn() },
    });
    await expect(service.emit('support.ticket_created', { ticketId: 'T1' })).resolves.toEqual({ queued: 0, skipped: 'error' });
    await expect(service.emit('unknown.type', {})).resolves.toEqual({ queued: 0, skipped: 'unknown_type' });
  });

  it('keeps only scalar allowed fields and caps their size', () => {
    expect(sanitizeData({ ticketId: 'x'.repeat(300), amountCents: 1500, money: 'no', nested: { a: 1 }, providerRefunded: false }))
      .toEqual({ ticketId: 'x'.repeat(120), amountCents: 1500, providerRefunded: false });
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([30000, 60000, 120000, 1800000]);
  });
});
