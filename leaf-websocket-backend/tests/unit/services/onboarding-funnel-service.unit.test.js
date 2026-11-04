jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => null)
}));

const {
  OnboardingFunnelService,
  summarizePeople,
  buildQuery
} = require('../../../services/onboarding-funnel-service');

const NOW = Date.parse('2026-11-03T12:00:00.000Z');
const CONFIG = { POSTHOG_PERSONAL_API_KEY: 'phx_test', POSTHOG_PROJECT_ID: '42' };

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

function stepCount(summary, step) {
  return summary.steps.find((entry) => entry.step === step).people;
}

describe('onboarding-funnel-service', () => {
  it('counts people per step and role without exposing person ids', () => {
    const result = summarizePeople([
      ['p1', ['phone_validation', 'phone_code'], '', false],
      ['p2', ['phone_validation', 'phone_code', 'profile_selection', 'profile_data'], 'customer', true],
      ['p3', ['phone_validation', 'phone_code', 'profile_selection', 'document_data'], 'driver', 0],
      ['p4', ['phone_validation'], 'admin', 0]
    ]);

    expect(result.truncated).toBe(false);
    expect(result.all.people).toBe(4);
    expect(result.all.completed).toBe(1);
    expect(stepCount(result.all, 'phone_validation')).toBe(4);
    expect(stepCount(result.all, 'phone_code')).toBe(3);
    expect(stepCount(result.all, 'profile_selection')).toBe(2);
    expect(result.roles.customer).toMatchObject({ people: 1, completed: 1 });
    expect(stepCount(result.roles.driver, 'document_data')).toBe(1);
    // Perfil fora de customer/driver fica junto de quem não escolheu.
    expect(result.roles.unknown.people).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/p[1-4]/);
  });

  it('marks the result as truncated past the person limit', () => {
    const rows = Array.from({ length: 10001 }, (_, index) => [`p${index}`, ['phone_validation'], null, false]);
    const result = summarizePeople(rows);
    expect(result.truncated).toBe(true);
    expect(result.all.people).toBe(10000);
  });

  it('queries only onboarding events inside the window', () => {
    const query = buildQuery(7);
    expect(query).toContain("event in ('onboarding_step_viewed', 'signup_completed')");
    expect(query).toContain('interval 7 day');
    expect(query).toContain('group by person_id');
  });

  it('reports not configured without calling PostHog', async () => {
    const http = { post: jest.fn() };
    const service = new OnboardingFunnelService({ redis: null, http, config: {}, now: () => NOW });

    const snapshot = await service.getSnapshot({ days: 7 });

    expect(snapshot).toMatchObject({ status: 'not_configured', days: 7, cache: 'MISS' });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('caches a good snapshot per window and serves it as HIT', async () => {
    const redis = memoryRedis();
    const http = { post: jest.fn().mockResolvedValue({ data: { results: [['p1', ['phone_validation'], 'customer', true]] } }) };
    const service = new OnboardingFunnelService({ redis, http, config: CONFIG, now: () => NOW });

    const first = await service.getSnapshot({ days: 14 });
    const second = await service.getSnapshot({ days: 14 });

    expect(first).toMatchObject({ status: 'ok', cache: 'MISS', days: 14 });
    expect(second).toMatchObject({ status: 'ok', cache: 'HIT', days: 14 });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post.mock.calls[0][0]).toBe('https://eu.posthog.com/api/projects/42/query/');
    expect([...redis.store.keys()]).toEqual(['observability:onboarding-funnel:v1:14']);
  });

  it('falls back to the default window for days outside the list', async () => {
    const http = { post: jest.fn().mockResolvedValue({ data: { results: [] } }) };
    const service = new OnboardingFunnelService({ redis: null, http, config: CONFIG, now: () => NOW });

    const snapshot = await service.getSnapshot({ days: 365 });

    expect(snapshot.days).toBe(14);
  });

  it('does not cache provider errors', async () => {
    const redis = memoryRedis();
    const http = { post: jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 503 } })) };
    const service = new OnboardingFunnelService({ redis, http, config: CONFIG, now: () => NOW });

    const snapshot = await service.getSnapshot({ days: 7 });

    expect(snapshot).toMatchObject({ status: 'error', error: 'HTTP 503' });
    expect(redis.store.size).toBe(0);
  });
});
