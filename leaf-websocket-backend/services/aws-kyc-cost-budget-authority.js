const { logError } = require('../utils/logger');

const KEY_PREFIX = '{kyc:aws:cost}';

const RESERVE_BUDGET_SCRIPT = `
-- leaf_aws_kyc_cost_reserve_v1
local operationRaw = redis.call('GET', KEYS[4])
if operationRaw then
  local ok, operation = pcall(cjson.decode, operationRaw)
  if not ok or type(operation) ~= 'table' then
    return redis.error_reply('KYC_AWS_COST_REDIS_OPERATION_INVALID')
  end
  if
    operation.operationIdHash ~= ARGV[1]
    or operation.userIdHash ~= ARGV[2]
    or operation.day ~= ARGV[3]
    or operation.month ~= ARGV[4]
    or tonumber(operation.bundleCostMicros) ~= tonumber(ARGV[5])
  then
    return cjson.encode({ status = 'operation_mismatch' })
  end
  return cjson.encode({
    status = 'reserved',
    replay = true,
    daySpentMicros = tonumber(redis.call('HGET', KEYS[1], 'spentMicros') or 0),
    monthSpentMicros = tonumber(redis.call('HGET', KEYS[2], 'spentMicros') or 0),
    userDayOperationCount = tonumber(redis.call('HGET', KEYS[3], 'operationCount') or 0)
  })
end

local bundleCostMicros = tonumber(ARGV[5])
local allowInitialization = ARGV[11] == '1'
local activatedDay = redis.call('HGET', KEYS[5], 'activatedDay')
local activatedMonth = redis.call('HGET', KEYS[5], 'activatedMonth')
if not activatedDay or not activatedMonth then
  if not allowInitialization then
    return cjson.encode({ status = 'initialization_required' })
  end
  activatedDay = ARGV[3]
  activatedMonth = ARGV[4]
  redis.call('HSET', KEYS[5],
    'authority', 'redis_lua_v1',
    'activatedDay', activatedDay,
    'activatedMonth', activatedMonth)
  redis.call('EXPIRE', KEYS[5], tonumber(ARGV[10]))
end

local function initializeCounter(key, periodMatchesActivation, seedSpent, seedCount)
  if redis.call('EXISTS', key) == 1 then return true end
  if periodMatchesActivation and not allowInitialization then return false end
  local spent = periodMatchesActivation and tonumber(seedSpent) or 0
  local count = periodMatchesActivation and tonumber(seedCount) or 0
  if not spent or not count then return false end
  redis.call('HSET', key, 'spentMicros', spent, 'operationCount', count)
  return true
end

if not initializeCounter(KEYS[1], ARGV[3] == activatedDay, ARGV[12], ARGV[13]) then
  return cjson.encode({ status = 'initialization_required' })
end
if not initializeCounter(KEYS[2], ARGV[4] == activatedMonth, ARGV[14], ARGV[15]) then
  return cjson.encode({ status = 'initialization_required' })
end
if not initializeCounter(KEYS[3], ARGV[3] == activatedDay, ARGV[16], ARGV[17]) then
  return cjson.encode({ status = 'initialization_required' })
end

local daySpentMicros = tonumber(redis.call('HGET', KEYS[1], 'spentMicros') or 0)
local monthSpentMicros = tonumber(redis.call('HGET', KEYS[2], 'spentMicros') or 0)
local userDayOperationCount = tonumber(redis.call('HGET', KEYS[3], 'operationCount') or 0)
local nextDaySpentMicros = daySpentMicros + bundleCostMicros
local nextMonthSpentMicros = monthSpentMicros + bundleCostMicros
local nextUserDayOperationCount = userDayOperationCount + 1

if nextUserDayOperationCount > tonumber(ARGV[8]) then
  return cjson.encode({ status = 'user_day_exhausted' })
end
if nextDaySpentMicros > tonumber(ARGV[6]) then
  return cjson.encode({ status = 'daily_budget_exhausted' })
end
if nextMonthSpentMicros > tonumber(ARGV[7]) then
  return cjson.encode({ status = 'monthly_budget_exhausted' })
end

redis.call('HSET', KEYS[1],
  'periodType', 'day',
  'periodKey', ARGV[3],
  'spentMicros', nextDaySpentMicros,
  'operationCount', tonumber(redis.call('HGET', KEYS[1], 'operationCount') or 0) + 1)
redis.call('HSET', KEYS[2],
  'periodType', 'month',
  'periodKey', ARGV[4],
  'spentMicros', nextMonthSpentMicros,
  'operationCount', tonumber(redis.call('HGET', KEYS[2], 'operationCount') or 0) + 1)
redis.call('HSET', KEYS[3],
  'periodType', 'user_day',
  'periodKey', ARGV[3],
  'userIdHash', ARGV[2],
  'spentMicros', tonumber(redis.call('HGET', KEYS[3], 'spentMicros') or 0) + bundleCostMicros,
  'operationCount', nextUserDayOperationCount)

local operation = {
  operationIdHash = ARGV[1],
  userIdHash = ARGV[2],
  day = ARGV[3],
  month = ARGV[4],
  bundleCostMicros = bundleCostMicros,
  status = 'reserved'
}
redis.call('SET', KEYS[4], cjson.encode(operation), 'EX', tonumber(ARGV[9]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[10]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[10]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[9]))

return cjson.encode({
  status = 'reserved',
  replay = false,
  daySpentMicros = nextDaySpentMicros,
  monthSpentMicros = nextMonthSpentMicros,
  userDayOperationCount = nextUserDayOperationCount
})
`;

const MARK_DISPATCHED_SCRIPT = `
-- leaf_aws_kyc_cost_mark_dispatched_v1
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ status = 'missing' }) end
local ok, operation = pcall(cjson.decode, raw)
if not ok or type(operation) ~= 'table' then
  return redis.error_reply('KYC_AWS_COST_REDIS_OPERATION_INVALID')
end
if operation.operationIdHash ~= ARGV[1] then
  return cjson.encode({ status = 'operation_mismatch' })
end
if operation.status == 'dispatched' then
  return cjson.encode({ status = 'dispatched', replay = true })
end
if operation.status ~= 'reserved' then
  return cjson.encode({ status = 'state_invalid' })
end
operation.status = 'dispatched'
redis.call('SET', KEYS[1], cjson.encode(operation), 'KEEPTTL')
return cjson.encode({ status = 'dispatched', replay = false })
`;

const ROLLBACK_BUDGET_SCRIPT = `
-- leaf_aws_kyc_cost_rollback_v1
local raw = redis.call('GET', KEYS[4])
if not raw then return cjson.encode({ status = 'missing' }) end
local ok, operation = pcall(cjson.decode, raw)
if not ok or type(operation) ~= 'table' then
  return redis.error_reply('KYC_AWS_COST_REDIS_OPERATION_INVALID')
end
if operation.operationIdHash ~= ARGV[1] then
  return cjson.encode({ status = 'operation_mismatch' })
end
if operation.status ~= 'reserved' then
  return cjson.encode({ status = operation.status or 'state_invalid' })
end
if
  operation.userIdHash ~= ARGV[2]
  or operation.day ~= ARGV[3]
  or operation.month ~= ARGV[4]
  or tonumber(operation.bundleCostMicros) ~= tonumber(ARGV[5])
then
  return cjson.encode({ status = 'operation_mismatch' })
end
if redis.call('EXISTS', KEYS[1], KEYS[2], KEYS[3]) ~= 3 then
  return cjson.encode({ status = 'counter_state_missing' })
end

local function decrementCounter(key, field, amount)
  local current = tonumber(redis.call('HGET', key, field) or 0)
  redis.call('HSET', key, field, math.max(0, current - amount))
end

local bundleCostMicros = tonumber(ARGV[5])
decrementCounter(KEYS[1], 'spentMicros', bundleCostMicros)
decrementCounter(KEYS[1], 'operationCount', 1)
decrementCounter(KEYS[2], 'spentMicros', bundleCostMicros)
decrementCounter(KEYS[2], 'operationCount', 1)
decrementCounter(KEYS[3], 'spentMicros', bundleCostMicros)
decrementCounter(KEYS[3], 'operationCount', 1)
redis.call('DEL', KEYS[4])

return cjson.encode({ status = 'rolled_back' })
`;

const FINALIZE_DISPATCH_SCRIPT = `
-- leaf_aws_kyc_cost_finalize_dispatch_v1
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ status = 'missing' }) end
local ok, operation = pcall(cjson.decode, raw)
if not ok or type(operation) ~= 'table' then
  return redis.error_reply('KYC_AWS_COST_REDIS_OPERATION_INVALID')
end
if operation.operationIdHash ~= ARGV[1] then
  return cjson.encode({ status = 'operation_mismatch' })
end
if operation.status ~= 'dispatched' then
  return cjson.encode({ status = operation.status or 'state_invalid' })
end
redis.call('DEL', KEYS[1])
return cjson.encode({ status = 'finalized' })
`;

function createAuthorityError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

class AwsKycCostBudgetAuthority {
  constructor(options = {}) {
    this.redisProvider = options.redisProvider || (() => (
      require('../utils/redis-pool').getConnection()
    ));
  }

  getConfigSummary() {
    return {
      authority: 'redis_lua_v1',
      firestoreRole: 'durable_operation_audit'
    };
  }

  assertReady() {
    const redis = this.redisProvider();
    if (!redis || typeof redis.eval !== 'function') {
      throw createAuthorityError(
        'Redis atomico indisponivel para o limite de custo AWS KYC',
        'KYC_AWS_COST_GUARD_UNAVAILABLE'
      );
    }
    return redis;
  }

  keys({ operationIdHash, userIdHash, day, month }) {
    return {
      day: `${KEY_PREFIX}:day:${day}`,
      month: `${KEY_PREFIX}:month:${month}`,
      userDay: `${KEY_PREFIX}:user_day:${day}:${userIdHash}`,
      operation: `${KEY_PREFIX}:operation:${operationIdHash}`,
      authority: `${KEY_PREFIX}:authority:v1`
    };
  }

  parse(raw) {
    if (raw && typeof raw === 'object') return raw;
    return raw ? JSON.parse(raw) : {};
  }

  async eval(script, keys, args, operation) {
    try {
      const redis = this.assertReady();
      return this.parse(await redis.eval(
        script,
        keys.length,
        ...keys,
        ...args.map((value) => String(value))
      ));
    } catch (error) {
      if (error?.code === 'KYC_AWS_COST_GUARD_UNAVAILABLE') throw error;
      logError(error, `Falha Redis/Lua no limite de custo AWS KYC: ${operation}`, {
        service: 'aws-kyc-cost-budget-authority',
        operation
      });
      throw createAuthorityError(
        'Falha no limite atomico de custo AWS KYC',
        'KYC_AWS_COST_GUARD_UNAVAILABLE',
        { cause: error }
      );
    }
  }

  async reserve(input) {
    const keys = this.keys(input);
    const seed = input.seed || {};
    return this.eval(
      RESERVE_BUDGET_SCRIPT,
      [keys.day, keys.month, keys.userDay, keys.operation, keys.authority],
      [
        input.operationIdHash,
        input.userIdHash,
        input.day,
        input.month,
        input.bundleCostMicros,
        input.dailyLimitMicros,
        input.monthlyLimitMicros,
        input.perUserDailySessionLimit,
        input.operationRetentionSeconds,
        input.aggregateRetentionSeconds,
        input.seed ? 1 : 0,
        seed.daySpentMicros ?? 0,
        seed.dayOperationCount ?? 0,
        seed.monthSpentMicros ?? 0,
        seed.monthOperationCount ?? 0,
        seed.userDaySpentMicros ?? 0,
        seed.userDayOperationCount ?? 0
      ],
      'reserve'
    );
  }

  async markDispatched(input) {
    const keys = this.keys(input);
    return this.eval(
      MARK_DISPATCHED_SCRIPT,
      [keys.operation],
      [input.operationIdHash],
      'mark_dispatched'
    );
  }

  async rollback(input) {
    const keys = this.keys(input);
    return this.eval(
      ROLLBACK_BUDGET_SCRIPT,
      [keys.day, keys.month, keys.userDay, keys.operation],
      [
        input.operationIdHash,
        input.userIdHash,
        input.day,
        input.month,
        input.bundleCostMicros
      ],
      'rollback'
    );
  }

  async finalizeDispatch(input) {
    const keys = this.keys(input);
    return this.eval(
      FINALIZE_DISPATCH_SCRIPT,
      [keys.operation],
      [input.operationIdHash],
      'finalize_dispatch'
    );
  }
}

const singleton = new AwsKycCostBudgetAuthority();

module.exports = singleton;
module.exports.AwsKycCostBudgetAuthority = AwsKycCostBudgetAuthority;
module.exports.KEY_PREFIX = KEY_PREFIX;
