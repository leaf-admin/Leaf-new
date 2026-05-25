const pricingContextStore = require('../../../services/pricing-context-store');

function createFakeRedis() {
  const hashes = new Map();
  const sortedSets = new Map();

  const api = {
    async hgetall(key) {
      return { ...(hashes.get(key) || {}) };
    },
    async hset(key, value) {
      const current = hashes.get(key) || {};
      hashes.set(key, { ...current, ...(value || {}) });
      return 1;
    },
    async expire() {
      return 1;
    },
    async zadd(key, score, member) {
      const current = sortedSets.get(key) || [];
      current.push({ score: Number(score), member });
      current.sort((left, right) => left.score - right.score);
      sortedSets.set(key, current);
      return 1;
    },
    async zrangebyscore(key, min, max, mode) {
      const current = sortedSets.get(key) || [];
      const minValue = Number(min);
      const maxValue = max === '+inf' ? Infinity : Number(max);
      const rows = current.filter((item) => item.score >= minValue && item.score <= maxValue);
      if (mode === 'WITHSCORES') {
        return rows.flatMap((item) => [item.member, String(item.score)]);
      }
      return rows.map((item) => item.member);
    },
    async zremrangebyscore(key, min, max) {
      const current = sortedSets.get(key) || [];
      const minValue = Number(min);
      const maxValue = Number(max);
      sortedSets.set(
        key,
        current.filter((item) => !(item.score >= minValue && item.score <= maxValue))
      );
      return 1;
    },
    pipeline() {
      const operations = [];
      const pipeline = {
        hset: (...args) => {
          operations.push(() => api.hset(...args));
          return pipeline;
        },
        expire: (...args) => {
          operations.push(() => api.expire(...args));
          return pipeline;
        },
        zadd: (...args) => {
          operations.push(() => api.zadd(...args));
          return pipeline;
        },
        zremrangebyscore: (...args) => {
          operations.push(() => api.zremrangebyscore(...args));
          return pipeline;
        },
        exec: async () => Promise.all(operations.map((operation) => operation()))
      };
      return pipeline;
    }
  };

  return api;
}

describe('pricing-context-store', () => {
  test('buildBaselineRedisKey inclui resolução, célula, dia e hora', () => {
    const key = pricingContextStore.buildBaselineRedisKey({
      resolution: 9,
      h3Index: '89a81082813ffff',
      nowIso: '2026-03-30T12:34:00.000Z'
    });

    expect(key).toBe('pricing:baseline:9:89a81082813ffff:1:12');
  });

  test('persiste e recarrega baseline, state e histórico de exceção', async () => {
    const redis = createFakeRedis();
    const nowIso = '2026-03-30T12:34:00.000Z';

    await pricingContextStore.persistPricingContextState(redis, {
      resolution: 9,
      h3Index: '89a81082813ffff',
      nowIso,
      baselinePayload: {
        expected_requests_5m: 5.1234,
        expected_idle_drivers: 3.4,
        expected_pickup_eta_min: 4.25,
        expected_speed_kmh: 22.3,
        expected_cancel_rate: 0.0567,
        sample_count: 3,
        updated_at: nowIso
      },
      statePayload: {
        state: 'PRESSAO',
        entered_at: nowIso,
        exited_at: '',
        zone_type: 'airport',
        updated_at: nowIso,
        last_score_pressao: 0.42,
        last_score_excecao: 0.18,
        last_exceptional_mode_active: false
      },
      historyPoint: {
        timestamp: nowIso,
        score_excecao: 0.18
      }
    });

    const loaded = await pricingContextStore.loadPricingContextState(redis, {
      resolution: 9,
      h3Index: '89a81082813ffff',
      nowIso,
      historyWindowMs: 15 * 60 * 1000
    });

    expect(loaded.baselineSource).toBe('redis_materialized');
    expect(loaded.stateSource).toBe('redis_materialized');
    expect(loaded.historySource).toBe('redis_history');
    expect(loaded.baseline).toEqual(expect.objectContaining({
      expected_requests_5m: 5.123,
      expected_idle_drivers: 3.4,
      expected_pickup_eta_min: 4.25,
      expected_speed_kmh: 22.3,
      expected_cancel_rate: 0.0567,
      sample_count: 3
    }));
    expect(loaded.state).toEqual(expect.objectContaining({
      previous_state: 'PRESSAO',
      zone_type: 'airport',
      last_score_pressao: 0.42,
      last_score_excecao: 0.18
    }));
    expect(loaded.state.recent_exception_history).toEqual([
      {
        timestamp: nowIso,
        score_excecao: 0.18
      }
    ]);
  });
});
