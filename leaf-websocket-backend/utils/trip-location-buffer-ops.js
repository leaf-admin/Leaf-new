'use strict';
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');

const APPEND_BUFFER = `
for i, expected in ipairs({'list', 'hash', 'string', 'set', 'zset'}) do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= expected then return redis.error_reply('LOCATION_BUFFER_WRONG_TYPE') end
end
if redis.call('EXISTS', KEYS[3]) == 1 then return {0, 0} end
local version = redis.call('HGET', KEYS[2], 'bufferVersion') or '0'
if version ~= ARGV[1] then return {-1, 0} end
local patch = cjson.decode(ARGV[3])
local count = redis.call('RPUSH', KEYS[1], ARGV[2])
for field, value in pairs(patch) do redis.call('HSET', KEYS[2], field, value) end
redis.call('HSET', KEYS[2], 'bufferVersion', tostring(tonumber(version) + 1), 'bufferedCount', tostring(count))
local finalization = redis.call('HGET', KEYS[2], 'finalizationConfig')
if finalization then redis.call('HSET', KEYS[2], 'finalizationRequested', finalization) end
redis.call('SADD', KEYS[4], ARGV[4])
redis.call('ZADD', KEYS[5], 'NX', tonumber(ARGV[5]) + tonumber(ARGV[7]), ARGV[4])
if count >= tonumber(ARGV[8]) then redis.call('ZADD', KEYS[5], ARGV[5], ARGV[4]) end
redis.call('PERSIST', KEYS[1])
redis.call('PERSIST', KEYS[2])
redis.call('SET', KEYS[3], '1', 'EX', ARGV[6])
return {1, count}
`;

const CLAIM_TRIPS = `
local trips = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
for _, trip in ipairs(trips) do redis.call('ZADD', KEYS[1], ARGV[3], trip) end
return trips
`;

const CLAIM_CHUNK = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return '' end
local current = redis.call('GET', KEYS[2])
if current then return current end
redis.call('SET', KEYS[2], ARGV[2])
return ARGV[2]
`;

const ACK_CHUNK = `
for i, expected in ipairs({'string', 'string', 'list', 'hash', 'zset', 'set'}) do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= expected then return redis.error_reply('LOCATION_ACK_WRONG_TYPE') end
end
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return -1 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return -2 end
local points = cjson.decode(ARGV[3])
for i, point in ipairs(points) do
  if redis.call('LINDEX', KEYS[3], i - 1) ~= point then return -3 end
end
redis.call('LTRIM', KEYS[3], #points, -1)
redis.call('HINCRBY', KEYS[4], 'persistedPoints', #points)
redis.call('HSET', KEYS[4], 'lastPersistedAt', ARGV[4])
redis.call('DEL', KEYS[2])
if redis.call('LLEN', KEYS[3]) == 0 and not redis.call('HGET', KEYS[4], 'finalizationRequested') then
  redis.call('ZREM', KEYS[5], ARGV[5]); redis.call('SREM', KEYS[6], ARGV[5])
  redis.call('EXPIRE', KEYS[4], ARGV[6])
end
return #points
`;

const REQUEST_FINALIZATION = `
for i, expected in ipairs({'hash', 'zset'}) do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= expected then return redis.error_reply('LOCATION_FINALIZATION_WRONG_TYPE') end
end
redis.call('HSET', KEYS[1], 'finalizationRequested', ARGV[1], 'finalizationConfig', ARGV[1])
redis.call('PERSIST', KEYS[1])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
return 1
`;

const FINISH_FINALIZATION = `
for i, expected in ipairs({'hash', 'zset', 'set', 'list'}) do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= expected then return redis.error_reply('LOCATION_FINALIZATION_WRONG_TYPE') end
end
if (redis.call('HGET', KEYS[1], 'bufferVersion') or '0') ~= ARGV[1] or redis.call('LLEN', KEYS[4]) > 0 then
  local config = redis.call('HGET', KEYS[1], 'finalizationConfig')
  if config then redis.call('HSET', KEYS[1], 'finalizationRequested', config) end
  redis.call('ZADD', KEYS[2], 'NX', ARGV[4], ARGV[2])
  return 0
end
redis.call('HDEL', KEYS[1], 'finalizationRequested')
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('SREM', KEYS[3], ARGV[2])
return 1
`;

module.exports = { digest, APPEND_BUFFER, CLAIM_TRIPS, CLAIM_CHUNK, ACK_CHUNK, REQUEST_FINALIZATION, FINISH_FINALIZATION };
