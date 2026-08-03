'use strict';

const DRIVER_ONLINE_PROJECTION_SCRIPT = `
local function key_type(key)
  local result = redis.call('TYPE', key)
  if type(result) == 'table' then
    return result.ok
  end
  return result
end

local function validate_key_type(key, expected)
  local actual = key_type(key)
  if actual ~= 'none' and actual ~= expected then
    return false, actual
  end
  return true, actual
end

local driver_id = ARGV[1]
local online = ARGV[2] == '1'
local has_location = ARGV[3] == '1'
local longitude = ARGV[4]
local latitude = ARGV[5]
local dispatch_eligible = ARGV[6] == '1'
local projection_scope = ARGV[7]
local ttl_seconds = tonumber(ARGV[8]) or 0
local key_expectations = { 'hash', 'zset', 'zset', 'set', 'zset' }
local key_indices = projection_scope == 'eligibility_only'
  and { 1, 3 }
  or (projection_scope == 'location_only'
    and { 1, 2, 4, 5 }
    or (online and { 1, 2, 3, 4, 5 } or { 1, 2, 3, 4 }))

for _, index in ipairs(key_indices) do
  local valid, actual = validate_key_type(KEYS[index], key_expectations[index])
  if not valid then
    return redis.error_reply(
      'LEAF_DRIVER_PROJECTION_WRONGTYPE ' .. KEYS[index]
      .. ' expected=' .. key_expectations[index]
      .. ' actual=' .. actual
    )
  end
end

local field_count = tonumber(ARGV[9]) or 0
local hash_args = {}

for index = 1, field_count * 2 do
  hash_args[index] = ARGV[9 + index]
end

if #hash_args == 0 then
  return redis.error_reply('LEAF_DRIVER_PROJECTION_EMPTY_HASH')
end

redis.call('HSET', KEYS[1], unpack(hash_args))

if projection_scope == 'eligibility_only' then
  redis.call('ZREM', KEYS[3], driver_id)
elseif projection_scope == 'location_only' and online then
  redis.call('GEOADD', KEYS[2], longitude, latitude, driver_id)
  redis.call('SADD', KEYS[4], driver_id)
  redis.call('ZREM', KEYS[5], driver_id)
elseif projection_scope == 'location_only' then
  redis.call('GEOADD', KEYS[5], longitude, latitude, driver_id)
  redis.call('ZREM', KEYS[2], driver_id)
  redis.call('SREM', KEYS[4], driver_id)
elseif online and has_location then
  redis.call('GEOADD', KEYS[2], longitude, latitude, driver_id)
  redis.call('SADD', KEYS[4], driver_id)
  redis.call('ZREM', KEYS[5], driver_id)
  if dispatch_eligible then
    redis.call('GEOADD', KEYS[3], longitude, latitude, driver_id)
  else
    redis.call('ZREM', KEYS[3], driver_id)
  end
elseif online then
  redis.call('ZREM', KEYS[3], driver_id)
  redis.call('ZREM', KEYS[5], driver_id)
else
  redis.call('ZREM', KEYS[2], driver_id)
  redis.call('ZREM', KEYS[3], driver_id)
  redis.call('SREM', KEYS[4], driver_id)
end

if ttl_seconds > 0 then
  redis.call('EXPIRE', KEYS[1], ttl_seconds)
end

return {
  1,
  projection_scope == 'eligibility_only' and -1 or (online and 1 or 0),
  projection_scope == 'eligibility_only' and -1 or (dispatch_eligible and 1 or 0)
}
`;

function normalizeHashFields(fields = {}) {
  return Object.entries(fields)
    .filter(([field, value]) => String(field || '').trim() && value !== undefined && value !== null)
    .flatMap(([field, value]) => [String(field), String(value)]);
}

function normalizeGeoCoordinates(lat, lng, { required = false } = {}) {
  const parseCoordinate = (value) => {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const normalizedLat = parseCoordinate(lat);
  const normalizedLng = parseCoordinate(lng);
  const bothAbsent = normalizedLat === null && normalizedLng === null;

  if (!required || bothAbsent) {
    return { hasLocation: false, lat: null, lng: null };
  }

  if (
    normalizedLat === null ||
    normalizedLng === null ||
    normalizedLat < -85.05112878 ||
    normalizedLat > 85.05112878 ||
    normalizedLng < -180 ||
    normalizedLng > 180
  ) {
    const error = new Error('Coordenadas inválidas para a projeção online do motorista');
    error.code = 'DRIVER_ONLINE_PROJECTION_INVALID_LOCATION';
    throw error;
  }

  return {
    hasLocation: true,
    lat: normalizedLat,
    lng: normalizedLng
  };
}

async function commitDriverOnlineProjection(redis, {
  driverId,
  driverKey = `driver:${driverId}`,
  eligibleGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
  fields,
  isOnline,
  dispatchEligible,
  projectionScope = 'full',
  ttlSeconds = 0,
  lat,
  lng
} = {}) {
  const normalizedDriverId = String(driverId || '').trim();
  const normalizedDriverKey = String(driverKey || '').trim();
  const normalizedEligibleGeoKey = String(eligibleGeoKey || '').trim();
  const normalizedProjectionScope = ['eligibility_only', 'location_only'].includes(projectionScope)
    ? projectionScope
    : 'full';
  const parsedTtlSeconds = Number(ttlSeconds);
  const normalizedTtlSeconds = Number.isFinite(parsedTtlSeconds) && parsedTtlSeconds > 0
    ? Math.floor(parsedTtlSeconds)
    : 0;
  const location = normalizeGeoCoordinates(lat, lng, {
    required: isOnline === true || normalizedProjectionScope === 'location_only'
  });
  const hasLocation = location.hasLocation;
  const hashArgs = normalizeHashFields(fields);

  if (normalizedProjectionScope === 'location_only' && !hasLocation) {
    const error = new Error('Coordenadas obrigatórias para a projeção de localização do motorista');
    error.code = 'DRIVER_ONLINE_PROJECTION_INVALID_LOCATION';
    throw error;
  }

  if (normalizedProjectionScope === 'location_only' && normalizedTtlSeconds <= 0) {
    const error = new Error('TTL obrigatório para a projeção de localização do motorista');
    error.code = 'DRIVER_ONLINE_PROJECTION_INVALID_TTL';
    throw error;
  }

  if (
    !redis ||
    typeof redis.eval !== 'function' ||
    !normalizedDriverId ||
    !normalizedDriverKey ||
    !normalizedEligibleGeoKey ||
    hashArgs.length === 0
  ) {
    const error = new Error('Redis atômico indisponível para projetar status do motorista');
    error.code = 'DRIVER_ONLINE_PROJECTION_ATOMIC_UNAVAILABLE';
    throw error;
  }

  const result = await redis.eval(
    DRIVER_ONLINE_PROJECTION_SCRIPT,
    5,
    normalizedDriverKey,
    'driver_locations',
    normalizedEligibleGeoKey,
    'online_drivers',
    'driver_offline_locations',
    normalizedDriverId,
    isOnline === true ? '1' : '0',
    hasLocation ? '1' : '0',
    hasLocation ? String(location.lng) : '',
    hasLocation ? String(location.lat) : '',
    dispatchEligible === true ? '1' : '0',
    normalizedProjectionScope,
    String(normalizedTtlSeconds),
    String(hashArgs.length / 2),
    ...hashArgs
  );

  if (!Array.isArray(result) || Number(result[0]) !== 1) {
    const error = new Error('Redis não confirmou a projeção atômica do motorista');
    error.code = 'DRIVER_ONLINE_PROJECTION_ATOMIC_REJECTED';
    throw error;
  }

  return {
    success: true,
    isOnline: Number(result[1]) === 1,
    dispatchEligible: Number(result[2]) === 1,
    hasLocation,
    projectionScope: normalizedProjectionScope,
    ttlSeconds: normalizedTtlSeconds
  };
}

module.exports = {
  DRIVER_ONLINE_PROJECTION_SCRIPT,
  commitDriverOnlineProjection,
  normalizeGeoCoordinates,
  normalizeHashFields
};
