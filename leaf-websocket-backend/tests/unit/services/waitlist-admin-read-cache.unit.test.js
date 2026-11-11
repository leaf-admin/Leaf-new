const mockStore = new Map();
const mockRedis = {
  get: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
  set: jest.fn(async (key, value) => { mockStore.set(key, value); return 'OK'; }),
  incr: jest.fn(async (key) => {
    const next = Number(mockStore.get(key) || 0) + 1;
    mockStore.set(key, String(next));
    return next;
  })
};
const mockEnsureConnection = jest.fn(async () => true);

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: mockEnsureConnection,
  getConnection: () => mockRedis
}));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const cache = require('../../../services/waitlist-admin-read-cache');

describe('waitlist admin read cache', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    mockEnsureConnection.mockImplementation(async () => true);
  });

  it('reads once and serves the copy until it expires', async () => {
    const loader = jest.fn(async () => ({ total: 3 }));

    const first = await cache.read('stats', {}, loader);
    const second = await cache.read('stats', {}, loader);

    expect(first).toEqual({ value: { total: 3 }, cache: 'MISS' });
    expect(second).toEqual({ value: { total: 3 }, cache: 'HIT' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(expect.stringContaining(':stats:'), '{"total":3}', 'EX', 120);
  });

  it('keeps one copy per set of filters', async () => {
    const loader = jest.fn(async () => []);
    await cache.read('drivers', { status: 'pending', page: 1 }, loader);
    await cache.read('drivers', { page: 1, status: 'approved' }, loader);
    await cache.read('drivers', { page: 1, status: 'pending' }, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('reads again after a change to the queue', async () => {
    const loader = jest.fn()
      .mockResolvedValueOnce({ pending: 0 })
      .mockResolvedValueOnce({ pending: 1 });

    await cache.read('stats', {}, loader);
    await cache.invalidate();
    const after = await cache.read('stats', {}, loader);

    expect(after).toEqual({ value: { pending: 1 }, cache: 'MISS' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('reads straight from the source when Redis is down', async () => {
    mockEnsureConnection.mockRejectedValue(new Error('redis down'));
    const loader = jest.fn(async () => ({ total: 1 }));

    await expect(cache.read('stats', {}, loader)).resolves.toEqual({ value: { total: 1 }, cache: 'BYPASS' });
    await expect(cache.invalidate()).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
