const DEFAULT_BASELINE_KEY_PREFIX = process.env.PRICING_BASELINE_KEY_PREFIX || 'pricing:baseline';
const DEFAULT_STATE_KEY_PREFIX = process.env.PRICING_STATE_KEY_PREFIX || 'pricing:state';
const DEFAULT_HISTORY_KEY_PREFIX = process.env.PRICING_EXCEPTION_HISTORY_KEY_PREFIX || 'pricing:exception-history';
const DEFAULT_TTL_SECONDS = Number.parseInt(
  process.env.PRICING_REDIS_TTL_SECONDS || String(14 * 24 * 60 * 60),
  10
);
const DEFAULT_HISTORY_WINDOW_MS = Number.parseInt(
  process.env.PRICING_HISTORY_WINDOW_MS || String(15 * 60 * 1000),
  10
);

function toNumber(value, fallback = 0) {
  const parsed = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundStoredNumber(value, digits = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return '0';
  }
  return String(Number(parsed.toFixed(digits)));
}

function parseHistoryMember(rawMember, rawScore) {
  if (!rawMember) return null;

  try {
    const parsed = typeof rawMember === 'string' ? JSON.parse(rawMember) : rawMember;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const timestamp = parsed.timestamp || new Date(Number(rawScore) || Date.now()).toISOString();
    const scoreExcecao = toNumber(parsed.score_excecao, NaN);
    if (!Number.isFinite(scoreExcecao)) {
      return null;
    }

    return {
      timestamp,
      score_excecao: scoreExcecao
    };
  } catch (_error) {
    return null;
  }
}

function buildBaselineRedisKey({ resolution, h3Index, nowIso }) {
  const now = new Date(nowIso);
  return [
    DEFAULT_BASELINE_KEY_PREFIX,
    Number.isFinite(Number(resolution)) ? Number(resolution) : 9,
    String(h3Index || ''),
    now.getUTCDay(),
    now.getUTCHours()
  ].join(':');
}

function buildStateRedisKey({ resolution, h3Index }) {
  return [
    DEFAULT_STATE_KEY_PREFIX,
    Number.isFinite(Number(resolution)) ? Number(resolution) : 9,
    String(h3Index || '')
  ].join(':');
}

function buildExceptionHistoryRedisKey({ resolution, h3Index }) {
  return [
    DEFAULT_HISTORY_KEY_PREFIX,
    Number.isFinite(Number(resolution)) ? Number(resolution) : 9,
    String(h3Index || '')
  ].join(':');
}

function isRedisPricingStoreUsable(redis) {
  return Boolean(
    redis
      && typeof redis.hgetall === 'function'
      && typeof redis.hset === 'function'
      && typeof redis.expire === 'function'
      && typeof redis.pipeline === 'function'
      && typeof redis.zadd === 'function'
      && typeof redis.zrangebyscore === 'function'
      && typeof redis.zremrangebyscore === 'function'
  );
}

async function loadPricingContextState(redis, { resolution, h3Index, nowIso, historyWindowMs = DEFAULT_HISTORY_WINDOW_MS }) {
  if (!isRedisPricingStoreUsable(redis) || !h3Index) {
    return {
      baseline: null,
      state: null,
      baselineSource: 'unavailable',
      stateSource: 'unavailable',
      historySource: 'unavailable'
    };
  }

  const baselineKey = buildBaselineRedisKey({ resolution, h3Index, nowIso });
  const stateKey = buildStateRedisKey({ resolution, h3Index });
  const historyKey = buildExceptionHistoryRedisKey({ resolution, h3Index });
  const nowMs = Date.parse(nowIso) || Date.now();
  const minScore = nowMs - historyWindowMs;

  try {
    const [baselineHash, stateHash, historyRows] = await Promise.all([
      redis.hgetall(baselineKey).catch(() => ({})),
      redis.hgetall(stateKey).catch(() => ({})),
      redis.zrangebyscore(historyKey, minScore, '+inf', 'WITHSCORES').catch(() => [])
    ]);

    const baseline = baselineHash && Object.keys(baselineHash).length > 0
      ? {
          expected_requests_5m: toNumber(baselineHash.expected_requests_5m, NaN),
          expected_idle_drivers: toNumber(baselineHash.expected_idle_drivers, NaN),
          expected_pickup_eta_min: toNumber(baselineHash.expected_pickup_eta_min, NaN),
          expected_speed_kmh: toNumber(baselineHash.expected_speed_kmh, NaN),
          expected_cancel_rate: toNumber(baselineHash.expected_cancel_rate, NaN),
          sample_count: toNumber(baselineHash.sample_count, 0),
          updated_at: baselineHash.updated_at || null
        }
      : null;

    const history = Array.isArray(historyRows)
      ? historyRows.reduce((accumulator, member, index, rows) => {
          if (index % 2 !== 0) return accumulator;
          const point = parseHistoryMember(member, rows[index + 1]);
          if (point) accumulator.push(point);
          return accumulator;
        }, [])
      : [];

    const state = stateHash && Object.keys(stateHash).length > 0
      ? {
          previous_state: stateHash.state || 'NORMAL',
          state_entered_at: stateHash.entered_at || null,
          state_exited_at: stateHash.exited_at || null,
          zone_type: stateHash.zone_type || null,
          last_score_pressao: toNumber(stateHash.last_score_pressao, NaN),
          last_score_excecao: toNumber(stateHash.last_score_excecao, NaN),
          last_exceptional_mode_active: String(stateHash.last_exceptional_mode_active || 'false') === 'true',
          recent_exception_history: history
        }
      : null;

    return {
      baseline,
      state,
      baselineSource: baseline ? 'redis_materialized' : 'derived_heuristic',
      stateSource: state ? 'redis_materialized' : 'derived_fallback',
      historySource: history.length > 0 ? 'redis_history' : 'derived_fallback'
    };
  } catch (_error) {
    return {
      baseline: null,
      state: null,
      baselineSource: 'unavailable',
      stateSource: 'unavailable',
      historySource: 'unavailable'
    };
  }
}

async function persistPricingContextState(
  redis,
  {
    resolution,
    h3Index,
    nowIso,
    baselinePayload = null,
    statePayload = null,
    historyPoint = null,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    historyWindowMs = DEFAULT_HISTORY_WINDOW_MS
  }
) {
  if (!isRedisPricingStoreUsable(redis) || !h3Index) {
    return false;
  }

  const baselineKey = buildBaselineRedisKey({ resolution, h3Index, nowIso });
  const stateKey = buildStateRedisKey({ resolution, h3Index });
  const historyKey = buildExceptionHistoryRedisKey({ resolution, h3Index });
  const nowMs = Date.parse(nowIso) || Date.now();
  const pipeline = redis.pipeline();

  if (baselinePayload) {
    pipeline.hset(baselineKey, {
      expected_requests_5m: roundStoredNumber(baselinePayload.expected_requests_5m, 3),
      expected_idle_drivers: roundStoredNumber(baselinePayload.expected_idle_drivers, 3),
      expected_pickup_eta_min: roundStoredNumber(baselinePayload.expected_pickup_eta_min, 3),
      expected_speed_kmh: roundStoredNumber(baselinePayload.expected_speed_kmh, 3),
      expected_cancel_rate: roundStoredNumber(baselinePayload.expected_cancel_rate, 4),
      sample_count: String(Math.max(1, Math.round(toNumber(baselinePayload.sample_count, 1)))),
      updated_at: baselinePayload.updated_at || nowIso
    });
    pipeline.expire(baselineKey, ttlSeconds);
  }

  if (statePayload) {
    pipeline.hset(stateKey, {
      state: statePayload.state || 'NORMAL',
      entered_at: statePayload.entered_at || '',
      exited_at: statePayload.exited_at || '',
      zone_type: statePayload.zone_type || '',
      last_score_pressao: roundStoredNumber(statePayload.last_score_pressao, 4),
      last_score_excecao: roundStoredNumber(statePayload.last_score_excecao, 4),
      last_exceptional_mode_active: statePayload.last_exceptional_mode_active ? 'true' : 'false',
      updated_at: statePayload.updated_at || nowIso
    });
    pipeline.expire(stateKey, ttlSeconds);
  }

  if (historyPoint) {
    const historyTimestampMs = Date.parse(historyPoint.timestamp) || nowMs;
    pipeline.zadd(
      historyKey,
      historyTimestampMs,
      JSON.stringify({
        timestamp: historyPoint.timestamp || nowIso,
        score_excecao: toNumber(historyPoint.score_excecao, 0)
      })
    );
    pipeline.zremrangebyscore(historyKey, 0, nowMs - historyWindowMs);
    pipeline.expire(historyKey, ttlSeconds);
  }

  await pipeline.exec();
  return true;
}

module.exports = {
  DEFAULT_HISTORY_WINDOW_MS,
  DEFAULT_TTL_SECONDS,
  buildBaselineRedisKey,
  buildStateRedisKey,
  buildExceptionHistoryRedisKey,
  isRedisPricingStoreUsable,
  loadPricingContextState,
  persistPricingContextState
};
