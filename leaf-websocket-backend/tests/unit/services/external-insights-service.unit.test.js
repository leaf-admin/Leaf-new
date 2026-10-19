const crypto = require('crypto');
const zlib = require('zlib');

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => null)
}));

const { ExternalInsightsService, parseAppStoreReport } = require('../../../services/external-insights-service');

const NOW = Date.parse('2026-10-19T12:00:00.000Z');

function memoryRedis() {
  const store = new Map();
  return {
    store,
    ensureConnection: jest.fn().mockResolvedValue(undefined),
    getConnection: () => ({
      get: jest.fn(async (key) => store.get(key) || null),
      set: jest.fn(async (key, value) => { store.set(key, value); return 'OK'; })
    })
  };
}

function appStoreReport(rows) {
  const header = ['Provider', 'Title', 'Product Type Identifier', 'Units', 'Apple Identifier'].join('\t');
  return zlib.gzipSync(Buffer.from([header, ...rows.map((row) => row.join('\t'))].join('\n')));
}

describe('external-insights-service', () => {
  it('reports every source as not configured without calling any provider', async () => {
    const http = { get: jest.fn(), post: jest.fn() };
    const service = new ExternalInsightsService({ redis: null, http, config: {}, now: () => NOW });

    const snapshot = await service.collect();

    expect(Object.values(snapshot.sources).map((source) => source.status)).toEqual([
      'not_configured', 'not_configured', 'not_configured', 'not_configured', 'not_configured'
    ]);
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('maps Sentry and UptimeRobot, and one failing source does not hide the others', async () => {
    const http = {
      get: jest.fn(async (url) => {
        expect(url).toBe('https://sentry.io/api/0/projects/leaf-org/leaf-backend/issues/');
        return {
          headers: { 'x-hits': '22' },
          data: [{ id: 7, title: 'Erro X', culprit: 'svc', level: 'error', count: '11', userCount: 0, lastSeen: '2026-10-18T16:05:44Z', permalink: 'https://sentry/7' }]
        };
      }),
      post: jest.fn(async (url) => {
        if (url.includes('uptimerobot')) {
          return {
            data: {
              stat: 'ok',
              monitors: [
                { friendly_name: 'API', url: 'https://api.leaf.app.br/health', status: 2, custom_uptime_ratio: '100.000-99.500-99.900', average_response_time: '120.000' },
                { friendly_name: 'Socket', url: 'https://socket.leaf.app.br/health', status: 9, custom_uptime_ratio: '90-95-97' }
              ]
            }
          };
        }
        const error = new Error('Request failed https://eu.posthog.com?token=secret-token');
        error.response = { status: 403 };
        throw error;
      })
    };
    const service = new ExternalInsightsService({
      redis: null,
      http,
      now: () => NOW,
      config: {
        SENTRY_READ_TOKEN: 'sentry-token',
        SENTRY_ORG: 'leaf-org',
        SENTRY_PROJECT_BACKEND: 'leaf-backend',
        POSTHOG_PERSONAL_API_KEY: 'secret-token',
        POSTHOG_PROJECT_ID: '1',
        UPTIMEROBOT_READ_ONLY_API_KEY: 'ur-key'
      }
    });

    const { sources } = await service.collect();

    expect(sources.sentry.data.projects[0]).toMatchObject({
      project: 'leaf-backend',
      unresolvedSeen24h: 22,
      topIssues: [{ id: '7', title: 'Erro X', events: 11, link: 'https://sentry/7' }]
    });
    expect(sources.uptime.data).toMatchObject({
      down: 1,
      monitors: [
        { name: 'API', status: 'up', uptime24h: 100, uptime7d: 99.5, uptime30d: 99.9, responseMs: 120 },
        { name: 'Socket', status: 'down', responseMs: null }
      ]
    });
    expect(sources.posthog).toEqual({ status: 'error', error: 'http_403' });
    expect(JSON.stringify(sources)).not.toContain('secret-token');
    expect(http.post.mock.calls.find(([url]) => url.includes('posthog'))[0])
      .toBe('https://eu.posthog.com/api/projects/1/query/');
  });

  it('counts only the Leaf app in the App Store report, by unit type', () => {
    const report = appStoreReport([
      ['APPLE', 'Leaf.app', '1', '2', '6757092661'],
      ['APPLE', 'Leaf.app', '7', '5', '6757092661'],
      ['APPLE', 'Leaf.app', '3F', '1', '6757092661'],
      ['APPLE', 'Outro app', '1', '9', '111']
    ]);

    expect(parseAppStoreReport(report, '6757092661')).toEqual({ downloads: 2, redownloads: 1, updates: 5 });
  });

  it('signs the App Store request and treats days without a report as zero', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const report = appStoreReport([['APPLE', 'Leaf.app', '1', '3', '6757092661']]);
    const http = {
      get: jest.fn(async (_url, options) => {
        expect(options.headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
        if (options.params['filter[reportDate]'] === '2026-10-18') {
          return { data: report };
        }
        const error = new Error('no sales');
        error.response = { status: 404 };
        throw error;
      }),
      post: jest.fn()
    };
    const service = new ExternalInsightsService({
      redis: null,
      http,
      now: () => NOW,
      config: {
        ASC_ISSUER_ID: 'issuer',
        ASC_KEY_ID: 'KEY123',
        ASC_VENDOR_NUMBER: '123',
        ASC_APP_APPLE_ID: '6757092661',
        ASC_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' })
      }
    });

    const { sources } = await service.collect();

    expect(http.get).toHaveBeenCalledTimes(7);
    expect(sources.appStore.data.days[0].date).toBe('2026-10-12');
    expect(sources.appStore.data.days[6]).toEqual({ date: '2026-10-18', downloads: 3, redownloads: 0, updates: 0 });
    expect(sources.appStore.data.downloads7d).toBe(3);
  });

  it('serves the cached snapshot and only refetches when forced', async () => {
    const redis = memoryRedis();
    const http = { get: jest.fn(), post: jest.fn() };
    const service = new ExternalInsightsService({ redis, http, config: {}, now: () => NOW });
    const collect = jest.spyOn(service, 'collect');

    expect((await service.getSnapshot()).cache).toBe('MISS');
    expect((await service.getSnapshot()).cache).toBe('HIT');
    expect((await service.getSnapshot({ forceRefresh: true })).cache).toBe('MISS');
    expect(collect).toHaveBeenCalledTimes(2);
    expect(service.ttlSeconds).toBe(600);
  });
});
