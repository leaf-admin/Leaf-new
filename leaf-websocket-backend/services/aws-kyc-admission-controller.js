const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');

const ADMISSION_KEYS = Object.freeze({
  createBucket: '{kyc:aws:admission}:create:bucket',
  activeLeases: '{kyc:aws:admission}:active:leases',
  resultBucket: '{kyc:aws:admission}:result:bucket'
});

const PUBLIC_RETRY_AFTER_CEILING_MS = 5_000;

const ACQUIRE_CREATE_LEASE_SCRIPT = `
-- leaf_aws_liveness_admission_create_v1
local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local maxConcurrent = tonumber(ARGV[3])
local leaseTtlMs = tonumber(ARGV[4])
local leaseId = ARGV[5]

redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', nowMs)
local existingLeaseExpiry = redis.call('ZSCORE', KEYS[2], leaseId)
if existingLeaseExpiry then
  return cjson.encode({
    status = 'acquired',
    idempotent = true,
    active = redis.call('ZCARD', KEYS[2]),
    leaseExpiresAtMs = tonumber(existingLeaseExpiry)
  })
end

local active = redis.call('ZCARD', KEYS[2])
if active >= maxConcurrent then
  local earliest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local retryAfterMs = 100
  if earliest[2] then
    retryAfterMs = math.max(1, tonumber(earliest[2]) - nowMs)
  end
  return cjson.encode({
    status = 'concurrency_limited',
    active = active,
    retryAfterMs = retryAfterMs
  })
end

local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local updatedAtMs = tonumber(redis.call('HGET', KEYS[1], 'updatedAtMs'))
if not tokens or not updatedAtMs then
  tokens = burst
  updatedAtMs = nowMs
else
  local elapsedMs = math.max(0, nowMs - updatedAtMs)
  tokens = math.min(burst, tokens + ((elapsedMs / 1000) * rate))
  updatedAtMs = nowMs
end

if tokens < 1 then
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAtMs', updatedAtMs)
  redis.call('PEXPIRE', KEYS[1], 3600000)
  return cjson.encode({
    status = 'rate_limited',
    active = active,
    retryAfterMs = math.max(1, math.ceil(((1 - tokens) / rate) * 1000))
  })
end

tokens = tokens - 1
local leaseExpiresAtMs = nowMs + leaseTtlMs
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAtMs', updatedAtMs)
redis.call('PEXPIRE', KEYS[1], 3600000)
redis.call('ZADD', KEYS[2], leaseExpiresAtMs, leaseId)
redis.call('PEXPIRE', KEYS[2], leaseTtlMs + 60000)

return cjson.encode({
  status = 'acquired',
  idempotent = false,
  active = active + 1,
  remainingTokens = tokens,
  leaseExpiresAtMs = leaseExpiresAtMs
})
`;

const ACQUIRE_RESULT_PERMIT_SCRIPT = `
-- leaf_aws_liveness_admission_result_v1
local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local updatedAtMs = tonumber(redis.call('HGET', KEYS[1], 'updatedAtMs'))

if not tokens or not updatedAtMs then
  tokens = burst
  updatedAtMs = nowMs
else
  local elapsedMs = math.max(0, nowMs - updatedAtMs)
  tokens = math.min(burst, tokens + ((elapsedMs / 1000) * rate))
  updatedAtMs = nowMs
end

if tokens < 1 then
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAtMs', updatedAtMs)
  redis.call('PEXPIRE', KEYS[1], 3600000)
  return cjson.encode({
    status = 'rate_limited',
    retryAfterMs = math.max(1, math.ceil(((1 - tokens) / rate) * 1000))
  })
end

tokens = tokens - 1
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAtMs', updatedAtMs)
redis.call('PEXPIRE', KEYS[1], 3600000)
return cjson.encode({ status = 'acquired', remainingTokens = tokens })
`;

const RELEASE_CREATE_LEASE_SCRIPT = `
-- leaf_aws_liveness_admission_release_v1
local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', nowMs)
local released = redis.call('ZREM', KEYS[1], ARGV[1])
return cjson.encode({
  released = released == 1,
  active = redis.call('ZCARD', KEYS[1])
})
`;

function boolEnv(env, key, fallback = false) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === '') return fallback;
  return String(raw).trim().toLowerCase() === 'true';
}

function boundedNumber(env, key, fallback, min, max, integer = false) {
  const numeric = Number(env[key]);
  if (!Number.isFinite(numeric)) return fallback;
  const bounded = Math.min(max, Math.max(min, numeric));
  return integer ? Math.floor(bounded) : bounded;
}

function createAdmissionError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

class AwsKycAdmissionController {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.redisProvider = options.redisProvider || (() => redisPool.getConnection());
    this.sleep = options.sleep || ((delayMs) => new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }));
    this.nowMs = options.nowMs || (() => Date.now());
    this.enabled = boolEnv(this.env, 'KYC_AWS_ADMISSION_CONTROL_ENABLED', false);
    this.createTps = boundedNumber(this.env, 'KYC_AWS_ADMISSION_CREATE_TPS', 20, 1, 25);
    this.createBurst = boundedNumber(this.env, 'KYC_AWS_ADMISSION_CREATE_BURST', 20, 1, 25, true);
    this.resultTps = boundedNumber(this.env, 'KYC_AWS_ADMISSION_RESULT_TPS', 20, 1, 25);
    this.resultBurst = boundedNumber(this.env, 'KYC_AWS_ADMISSION_RESULT_BURST', 20, 1, 25, true);
    this.maxConcurrentSessions = boundedNumber(
      this.env,
      'KYC_AWS_ADMISSION_MAX_CONCURRENT_SESSIONS',
      70,
      1,
      75,
      true
    );
    this.leaseTtlMs = boundedNumber(
      this.env,
      'KYC_AWS_ADMISSION_LEASE_TTL_SECONDS',
      180,
      60,
      180,
      true
    ) * 1000;
    this.maxWaitMs = boundedNumber(
      this.env,
      'KYC_AWS_ADMISSION_MAX_WAIT_MS',
      0,
      0,
      30000,
      true
    );
    this.retryFloorMs = boundedNumber(
      this.env,
      'KYC_AWS_ADMISSION_RETRY_FLOOR_MS',
      40,
      10,
      1000,
      true
    );
  }

  isEnabled() {
    return this.enabled === true;
  }

  getConfigSummary() {
    return {
      enabled: this.isEnabled(),
      createTps: this.createTps,
      createBurst: this.createBurst,
      resultTps: this.resultTps,
      resultBurst: this.resultBurst,
      maxConcurrentSessions: this.maxConcurrentSessions,
      leaseTtlSeconds: this.leaseTtlMs / 1000,
      maxWaitMs: this.maxWaitMs,
      retryFloorMs: this.retryFloorMs
    };
  }

  assertEnabled(required) {
    if (required && !this.isEnabled()) {
      throw createAdmissionError(
        'Controle de admissao AWS KYC obrigatorio em biometria de producao',
        'KYC_AWS_ADMISSION_CONTROL_REQUIRED'
      );
    }
    return this.isEnabled();
  }

  getRedis() {
    const redis = this.redisProvider();
    if (!redis || typeof redis.eval !== 'function') {
      throw createAdmissionError(
        'Redis atomico indisponivel para admissao AWS KYC',
        'KYC_AWS_ADMISSION_CONTROL_UNAVAILABLE'
      );
    }
    return redis;
  }

  parseScriptResult(raw) {
    if (raw && typeof raw === 'object') return raw;
    return raw ? JSON.parse(raw) : {};
  }

  async runScript(script, numberOfKeys, ...args) {
    try {
      return this.parseScriptResult(await this.getRedis().eval(script, numberOfKeys, ...args));
    } catch (error) {
      if (error?.code?.startsWith?.('KYC_AWS_ADMISSION_')) throw error;
      const wrapped = createAdmissionError(
        'Falha no controle atomico de admissao AWS KYC',
        'KYC_AWS_ADMISSION_CONTROL_UNAVAILABLE',
        { cause: error }
      );
      logError(error, wrapped.message, { service: 'aws-kyc-admission-controller' });
      throw wrapped;
    }
  }

  async acquireWithWait(attempt, operation) {
    const startedAtMs = this.nowMs();
    let lastResult = null;
    let hadAdmissionWait = false;
    while (true) {
      lastResult = await attempt();
      if (lastResult?.status === 'acquired') {
        const waitedMs = Math.max(0, this.nowMs() - startedAtMs);
        metrics.recordKycAwsAdmission(operation, 'acquired', waitedMs / 1000);
        if (operation === 'create' && Number.isFinite(Number(lastResult.active))) {
          metrics.setKycAwsAdmissionActiveSessions(Number(lastResult.active));
        }
        if (hadAdmissionWait) {
          logStructured('info', 'Admissao AWS KYC liberada apos espera curta', {
            service: 'aws-kyc-admission-controller',
            operation,
            waitedMs,
            active: lastResult.active ?? null
          });
        }
        return { ...lastResult, waitedMs };
      }

      const elapsedMs = Math.max(0, this.nowMs() - startedAtMs);
      const remainingMs = this.maxWaitMs - elapsedMs;
      if (remainingMs <= 0) {
        const retryAfterMs = Math.min(
          PUBLIC_RETRY_AFTER_CEILING_MS,
          Math.max(
            this.retryFloorMs,
            Number(lastResult?.retryAfterMs || this.retryFloorMs)
          )
        );
        metrics.recordKycAwsAdmission(
          operation,
          lastResult?.status || 'capacity_exhausted',
          elapsedMs / 1000
        );
        throw createAdmissionError(
          'Capacidade AWS KYC temporariamente ocupada',
          'KYC_AWS_ADMISSION_CAPACITY_EXHAUSTED',
          {
            operation,
            reason: lastResult?.status || 'unknown',
            retryAfterMs,
            retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
          }
        );
      }

      const requestedDelayMs = Math.max(
        this.retryFloorMs,
        Number(lastResult?.retryAfterMs || this.retryFloorMs)
      );
      hadAdmissionWait = true;
      await this.sleep(Math.min(requestedDelayMs, remainingMs));
    }
  }

  async acquireCreateLease({ leaseId, required = false } = {}) {
    if (!this.assertEnabled(required)) return { status: 'bypassed', enabled: false };
    const safeLeaseId = String(leaseId || '').trim();
    if (!safeLeaseId) {
      throw createAdmissionError(
        'leaseId obrigatorio para admissao AWS KYC',
        'KYC_AWS_ADMISSION_LEASE_ID_REQUIRED'
      );
    }
    return this.acquireWithWait(() => this.runScript(
      ACQUIRE_CREATE_LEASE_SCRIPT,
      2,
      ADMISSION_KEYS.createBucket,
      ADMISSION_KEYS.activeLeases,
      String(this.createTps),
      String(this.createBurst),
      String(this.maxConcurrentSessions),
      String(this.leaseTtlMs),
      safeLeaseId
    ), 'create');
  }

  async acquireResultPermit({ required = false } = {}) {
    if (!this.assertEnabled(required)) return { status: 'bypassed', enabled: false };
    return this.acquireWithWait(() => this.runScript(
      ACQUIRE_RESULT_PERMIT_SCRIPT,
      1,
      ADMISSION_KEYS.resultBucket,
      String(this.resultTps),
      String(this.resultBurst)
    ), 'result');
  }

  async releaseCreateLease(leaseId) {
    if (!this.isEnabled()) return { released: false, enabled: false };
    const safeLeaseId = String(leaseId || '').trim();
    if (!safeLeaseId) return { released: false, enabled: true };
    const result = await this.runScript(
      RELEASE_CREATE_LEASE_SCRIPT,
      1,
      ADMISSION_KEYS.activeLeases,
      safeLeaseId
    );
    if (Number.isFinite(Number(result?.active))) {
      metrics.setKycAwsAdmissionActiveSessions(Number(result.active));
    }
    return result;
  }
}

const singleton = new AwsKycAdmissionController();

module.exports = singleton;
module.exports.AwsKycAdmissionController = AwsKycAdmissionController;
module.exports.ADMISSION_KEYS = ADMISSION_KEYS;
module.exports.createAdmissionError = createAdmissionError;
