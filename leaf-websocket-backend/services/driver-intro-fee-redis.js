// Short, bounded scripts: at most 25 IDs per driver. The critical Redis dataset
// generation is checked in the same operation as each financial counter mutation.
const INSTALL_STATE = `
local observed = redis.call('GET', KEYS[4])
if observed ~= ARGV[1] or redis.call('TTL', KEYS[4]) ~= -1 then return 'ERR_GENERATION' end
local existing = redis.call('GET', KEYS[1])
if existing then return existing end
local pending = redis.call('HGET', KEYS[3], KEYS[1])
if pending then
  local state = cjson.decode(pending)
  if state.generation ~= ARGV[1] then return 'ERR_GENERATION' end
  redis.call('SET', KEYS[1], pending)
  redis.call('SET', KEYS[2], ARGV[1])
  return pending
end
if redis.call('EXISTS', KEYS[2]) == 1 then return 'ERR_STATE_LOST' end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[1])
return ARGV[2]
`;

const RECORD_COMPLETION = `
if redis.call('GET', KEYS[4]) ~= ARGV[1] or redis.call('TTL', KEYS[4]) ~= -1 then return 'ERR_GENERATION' end
local raw = redis.call('GET', KEYS[1])
if not raw then return 'ERR_STATE_LOST' end
local state = cjson.decode(raw)
if state.generation ~= ARGV[1] or state.driverId ~= ARGV[2] then return 'ERR_STATE_CONFLICT' end
local bookingId = ARGV[3]
local ids = state.completedBookingIds
for _, id in ipairs(ids) do if id == bookingId then return raw end end
if state.inflightBookingId and state.inflightBookingId ~= bookingId then return 'ERR_OTHER_RIDE' end
local owner = redis.call('HGET', KEYS[3], 'driverId')
if owner ~= ARGV[2] then return 'ERR_BOOKING_OWNER' end
local status = string.upper(redis.call('HGET', KEYS[3], 'status') or redis.call('HGET', KEYS[3], 'state') or '')
local complete = status == 'COMPLETED' or status == 'COMPLETE'
local excluded = status == 'CANCELED' or status == 'CANCELLED' or string.find(status, 'EARLY') or string.find(status, 'INTERRUPTED')
if not complete and not excluded then return 'ERR_RIDE_ACTIVE' end
local contextRaw = redis.call('HGET', KEYS[3], 'driverIntroFee')
if not contextRaw then return 'ERR_CONTEXT_MISSING' end
local context = cjson.decode(contextRaw)
if context.driverId ~= state.driverId or context.historySnapshotId ~= state.historySnapshotId then return 'ERR_STATE_CONFLICT' end
local changed = false
if complete and state.qualifiedCompletedRides < 25 then
  local outcomeRaw = redis.call('HGET', KEYS[3], 'driverIntroFeeCompletion')
  local outcome = outcomeRaw and cjson.decode(outcomeRaw) or {}
  if outcome.qualified == true then
    table.insert(ids, bookingId)
    state.qualifiedCompletedRides = math.min(25, state.baselineCount + #ids)
    changed = true
  elseif outcome.reviewRequired == true or outcome.qualified ~= false then
    state.reviewRequiredBookingId = bookingId
    changed = true
  end
end
state.inflightBookingId = nil
-- cjson encodes an empty Lua table as {}, whereas the persisted contract uses [].
local encoded = cjson.encode(state)
encoded = string.gsub(encoded, '"completedBookingIds":{}', '"completedBookingIds":[]')
redis.call('SET', KEYS[1], encoded)
if changed then redis.call('HSET', KEYS[2], KEYS[1], encoded) end
redis.call('HSET', KEYS[3], 'driverIntroFeeCompletionRecorded', 'true')
return encoded
`;

const ACK_CHECKPOINT = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
  return redis.call('HDEL', KEYS[1], ARGV[1])
end
return 0
`;

// Embedded in the existing AcceptRideCommand CAS after all ownership/KYC checks.
// The reservation, counter and accepted booking change in the same Lua operation.
const ACCEPT_CONTEXT = `
local introState = nil
local introContext = nil
local introSnapshot = nil
local reservationRaw = redis.call('GET', offerReservationKey)
local reservation = reservationRaw and cjson.decode(reservationRaw) or {}
if reservation.driverIntroFee then
  introContext = reservation.driverIntroFee
  local stateRaw = redis.call('GET', KEYS[12])
  if not stateRaw then return 'ERR_INTRO_FEE_STATE' end
  introState = cjson.decode(stateRaw)
  if redis.call('GET', datasetGenerationKey) ~= introState.generation or redis.call('TTL', datasetGenerationKey) ~= -1 then return 'ERR_INTRO_FEE_STATE' end
  if introContext.policyId ~= introState.policyId or introContext.historyVerified ~= true then return 'ERR_INTRO_FEE_STATE' end
  if introState.driverId ~= driverId or introContext.driverId ~= driverId or
    introState.historySnapshotId ~= introContext.historySnapshotId or
    introState.qualifiedCompletedRides ~= introContext.qualifiedCompletedRides or
    introState.reviewRequiredBookingId or
    (introState.inflightBookingId and introState.inflightBookingId ~= bookingId) then
    return 'ERR_INTRO_FEE_STALE_OFFER'
  end
  introSnapshot = reservation.estimatedFareSnapshot
  if not introSnapshot then return 'ERR_INTRO_FEE_STATE' end
elseif ARGV[11] == '1' and redis.call('HGET', bookingKey, 'financialNamespace') ~= 'sandbox' then
  return 'ERR_INTRO_FEE_OFFER_MISSING'
end
`;

const PERSIST_ACCEPTED_CONTEXT = `
if introContext then
  introState.inflightBookingId = bookingId
  local encoded = cjson.encode(introState)
  encoded = string.gsub(encoded, '"completedBookingIds":{}', '"completedBookingIds":[]')
  redis.call('SET', KEYS[12], encoded)
  redis.call('HSET', bookingKey, 'driverIntroFee', cjson.encode(introContext),
    'estimatedOperationalFee', tostring(introSnapshot.estimatedOperationalFee),
    'estimatedPaymentIntermediationFee', tostring(introSnapshot.estimatedPaymentIntermediationFee),
    'estimatedTotalFees', tostring(introSnapshot.estimatedTotalFees),
    'estimatedDriverNetAmount', tostring(introSnapshot.estimatedDriverNetAmount))
end
`;

module.exports = { INSTALL_STATE, RECORD_COMPLETION, ACK_CHECKPOINT, ACCEPT_CONTEXT, PERSIST_ACCEPTED_CONTEXT };
