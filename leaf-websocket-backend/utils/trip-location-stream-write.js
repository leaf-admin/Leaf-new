'use strict';

// Keep acceptance, deduplication and durable stream insertion in one Redis
// operation. A failed XADD must never leave a marker acknowledging a lost fix.
const APPEND_LOCATION = `
local streamType = redis.call('TYPE', KEYS[1]).ok
if streamType ~= 'none' and streamType ~= 'stream' then return redis.error_reply('LOCATION_STREAM_WRONG_TYPE') end
local driver = redis.call('HGET', KEYS[4], 'driverId')
local status = string.upper(redis.call('HGET', KEYS[4], 'status') or '')
local state = string.upper(redis.call('HGET', KEYS[4], 'state') or '')
local active = {ACCEPTED=true, ARRIVED=true, SEARCHING=true, STARTED=true, IN_PROGRESS=true, REASSIGNED_IN_PROGRESS=true}
if driver ~= ARGV[1] or not (active[status] or active[state]) then return {-2, '', '', ''} end
local seq = tonumber(ARGV[2])
local last = tonumber(redis.call('GET', KEYS[2]) or '')
local order = 'no_seq'
if seq then
  if last and seq < last - tonumber(ARGV[3]) then return {0, 'stale_ignored', tostring(last), ''} end
  if redis.call('EXISTS', KEYS[3]) == 1 then return {0, 'duplicate_dedupe', tostring(last or seq), ''} end
  if not last or seq > last then order = 'in_order'; last = seq
  elseif seq == last then order = 'duplicate_seq' else order = 'out_of_order' end
end
local data = cjson.decode(ARGV[5])
if seq then data.orderStatus = order; data.lastAcceptedSeq = last; data.outOfOrderWindow = tonumber(ARGV[3]) end
local id = redis.call('XADD', KEYS[1], '*', 'type', 'trip.location.v1', 'data', cjson.encode(data),
  'bookingId', data.tripId, 'tripId', data.tripId, 'driverId', data.driverId,
  'customerId', ARGV[6], 'seq', ARGV[2], 'lat', tostring(data.lat), 'lng', tostring(data.lng),
  'capturedAt', tostring(data.capturedAt), 'receivedAt', tostring(data.receivedAt),
  'orderStatus', order, 'lastAcceptedSeq', tostring(last or ''))
if seq then
  redis.call('SET', KEYS[2], tostring(last), 'EX', ARGV[4])
  redis.call('SET', KEYS[3], '1', 'EX', ARGV[4])
end
return {1, order, tostring(last or ''), id}
`;

async function appendTripLocation(redis, data, { window, ttl }) {
  const seq = Number.isInteger(data.seq) && data.seq >= 0 ? data.seq : null;
  const result = await redis.eval(APPEND_LOCATION, 4, 'trip_location_events',
    `trip_loc_seq_state:${data.tripId}:${data.driverId}`,
    `trip_loc_dedupe:${data.tripId}:${data.driverId}:${seq ?? 'none'}`,
    `booking:${data.tripId}`, data.driverId, seq === null ? '' : String(seq),
    String(window), String(ttl), JSON.stringify(data), data.customerId || '');
  if (Number(result[0]) === -2) {
    const error = new Error('Booking no longer confirms this driver');
    error.code = 'ACTIVE_TRIP_RECOVERY_REQUIRED';
    throw error;
  }
  return { inserted: Number(result[0]) === 1, orderStatus: result[1],
    lastAcceptedSeq: result[2] === '' ? null : Number(result[2]), streamId: result[3],
    stale: result[1] === 'stale_ignored', duplicate: result[1] === 'duplicate_dedupe' };
}

module.exports = { APPEND_LOCATION, appendTripLocation };
