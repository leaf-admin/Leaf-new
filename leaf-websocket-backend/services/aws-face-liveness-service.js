const crypto = require('crypto');
const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand
} = require('@aws-sdk/client-rekognition');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const redisPool = require('../utils/redis-pool');
const {
  ACTIVE_TRIP_LEASE_UNTIL_FIELD,
  activeTripKey,
  identityVerificationKey
} = require('../utils/active-trip-index');
const { logStructured, logError } = require('../utils/logger');
const defaultAwsKycCostGuard = require('./aws-kyc-cost-guard-service');

const PROVIDER_NAME = 'aws_rekognition_face_liveness';
const DEFAULT_CHALLENGE_TYPE = 'FaceMovementChallenge';
const ALLOWED_CHALLENGE_TYPES = new Set([
  'FaceMovementChallenge',
  'FaceMovementAndLightChallenge'
]);
const ATTEMPT_RESERVATION_LIMIT = 32;
const PROCESSED_RESULT_LIMIT = 64;

const ATTEMPT_RESERVE_SCRIPT = `
-- leaf_aws_liveness_attempt_reserve_v1
local raw = redis.call('GET', KEYS[1])
local state = {}
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= 'table' then
    return redis.error_reply('KYC_ATTEMPT_STATE_INVALID')
  end
  state = decoded
end

local reservations = state.attemptReservations
if type(reservations) ~= 'table' then reservations = {} end
for _, reservation in ipairs(reservations) do
  if reservation.token == ARGV[8] then
    return cjson.encode({ status = 'reserved', state = state })
  end
end

local nowEpochMs = tonumber(ARGV[10])
local retryDelayMs = tonumber(ARGV[11]) * 1000
local retryWindowMs = tonumber(ARGV[12]) * 1000
local reservationsChanged = false
for _, reservation in ipairs(reservations) do
  if reservation.status == 'reserved' then
    local createdAtEpochMs = tonumber(reservation.createdAtEpochMs)
    if not createdAtEpochMs then
      return cjson.encode({ status = 'in_flight', state = state })
    end
    local ageMs = math.max(0, nowEpochMs - createdAtEpochMs)
    if ageMs < retryDelayMs then
      return cjson.encode({ status = 'in_flight', state = state })
    end
    if ageMs <= retryWindowMs then
      return cjson.encode({ status = 'resume', token = reservation.token, state = state })
    end
    reservation.status = 'dispatch_unknown_expired'
    reservation.resolvedAt = ARGV[7]
    reservationsChanged = true
  end
end

local maxAttempts = tonumber(ARGV[4])
local started = tonumber(state.started or 0)
local failed = tonumber(state.failed or 0)
local softBlocked = state.softBlocked == true
local recoveryAllowanceTotal = math.max(
  0,
  math.floor(tonumber(state.recoveryAllowanceTotal or 0))
)
local recoveryAllowanceRemaining = math.max(
  0,
  math.floor(tonumber(state.recoveryAllowanceRemaining or 0))
)
local recoveryAllowanceConsumed = math.max(
  0,
  math.floor(tonumber(state.recoveryAllowanceConsumed or 0))
)
local recoveryAllowanceGrantId = ''
if type(state.recoveryAllowanceGrantId) == 'string' then
  recoveryAllowanceGrantId = state.recoveryAllowanceGrantId
end
local providerRecoveryMaxCredits = math.max(0, tonumber(ARGV[13]))
local recoveryAllowanceValid = recoveryAllowanceTotal >= 1
  and recoveryAllowanceTotal <= providerRecoveryMaxCredits
  and string.find(recoveryAllowanceGrantId, '%S') ~= nil
  and recoveryAllowanceRemaining + recoveryAllowanceConsumed == recoveryAllowanceTotal
local usesRecoveryAllowance = started >= maxAttempts
if
  softBlocked
  or failed >= maxAttempts
  or (
    usesRecoveryAllowance
    and (
      not recoveryAllowanceValid
      or recoveryAllowanceRemaining <= 0
      or started >= maxAttempts + recoveryAllowanceTotal
    )
  )
then
  if reservationsChanged then
    state.attemptReservations = reservations
    redis.call('SET', KEYS[1], cjson.encode(state), 'EX', tonumber(ARGV[6]))
  end
  return cjson.encode({ status = 'exhausted', state = state })
end

if usesRecoveryAllowance then
  recoveryAllowanceRemaining = recoveryAllowanceRemaining - 1
  recoveryAllowanceConsumed = recoveryAllowanceConsumed + 1
end

state.userId = ARGV[1]
state.requirement = ARGV[2]
state.attemptScope = ARGV[3]
state.started = started + 1
state.failed = failed
state.passed = tonumber(state.passed or 0)
state.maxAttempts = maxAttempts
state.estimatedUnitCostUsd = tonumber(ARGV[5])
state.windowSeconds = tonumber(ARGV[6])
state.attemptsExhausted = false
state.lastStartedAt = ARGV[7]
state.recoveryAllowanceTotal = recoveryAllowanceTotal
state.recoveryAllowanceRemaining = recoveryAllowanceRemaining
state.recoveryAllowanceConsumed = recoveryAllowanceConsumed
state.effectiveMax = maxAttempts + (recoveryAllowanceValid and recoveryAllowanceTotal or 0)

table.insert(reservations, {
  token = ARGV[8],
  status = 'reserved',
  createdAt = ARGV[7],
  createdAtEpochMs = nowEpochMs,
  usedRecoveryAllowance = usesRecoveryAllowance,
  recoveryAllowanceGrantId = usesRecoveryAllowance and recoveryAllowanceGrantId or cjson.null
})
while #reservations > tonumber(ARGV[9]) do table.remove(reservations, 1) end
state.attemptReservations = reservations

local encoded = cjson.encode(state)
redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[6]))
return cjson.encode({ status = 'reserved', state = state })
`;

const ATTEMPT_COMMIT_SCRIPT = `
-- leaf_aws_liveness_attempt_commit_v1
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ status = 'missing' }) end
local ok, state = pcall(cjson.decode, raw)
if not ok or type(state) ~= 'table' then
  return redis.error_reply('KYC_ATTEMPT_STATE_INVALID')
end

local reservations = state.attemptReservations
if type(reservations) ~= 'table' then reservations = {} end
local found = false
for _, reservation in ipairs(reservations) do
  if reservation.token == ARGV[1] then
    found = true
    if reservation.status == 'reserved' then
      reservation.status = 'committed'
      reservation.sessionId = ARGV[2]
      reservation.committedAt = ARGV[3]
    end
  end
end
if not found then return cjson.encode({ status = 'missing', state = state }) end

state.attemptReservations = reservations
state.lastSessionId = ARGV[2]
local encoded = cjson.encode(state)
redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[4]))
return cjson.encode({ status = 'committed', state = state })
`;

const ATTEMPT_ROLLBACK_SCRIPT = `
-- leaf_aws_liveness_attempt_rollback_v1
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ status = 'missing' }) end
local ok, state = pcall(cjson.decode, raw)
if not ok or type(state) ~= 'table' then
  return redis.error_reply('KYC_ATTEMPT_STATE_INVALID')
end

local reservations = state.attemptReservations
if type(reservations) ~= 'table' then reservations = {} end
for index = #reservations, 1, -1 do
  local reservation = reservations[index]
  if reservation.token == ARGV[1] then
    if reservation.status ~= 'reserved' then
      return cjson.encode({ status = 'committed', state = state })
    end
    table.remove(reservations, index)
    state.started = math.max(0, tonumber(state.started or 0) - 1)
    local maxAttempts = math.max(0, tonumber(state.maxAttempts or 0))
    local recoveryAllowanceTotal = math.max(
      0,
      math.floor(tonumber(state.recoveryAllowanceTotal or 0))
    )
    local recoveryAllowanceRemaining = math.max(
      0,
      math.floor(tonumber(state.recoveryAllowanceRemaining or 0))
    )
    local recoveryAllowanceConsumed = math.max(
      0,
      math.floor(tonumber(state.recoveryAllowanceConsumed or 0))
    )
local recoveryAllowanceGrantId = ''
if type(state.recoveryAllowanceGrantId) == 'string' then
  recoveryAllowanceGrantId = state.recoveryAllowanceGrantId
end
    local recoveryAllowanceValid = recoveryAllowanceTotal >= 1
      and recoveryAllowanceTotal <= math.max(0, tonumber(ARGV[3]))
      and string.find(recoveryAllowanceGrantId, '%S') ~= nil
  and recoveryAllowanceRemaining + recoveryAllowanceConsumed == recoveryAllowanceTotal
    local canRestoreRecoveryAllowance = reservation.usedRecoveryAllowance == true
      and recoveryAllowanceValid
      and reservation.recoveryAllowanceGrantId == recoveryAllowanceGrantId
      and recoveryAllowanceConsumed > 0
    if canRestoreRecoveryAllowance then
      recoveryAllowanceRemaining = recoveryAllowanceRemaining + 1
      recoveryAllowanceConsumed = recoveryAllowanceConsumed - 1
    end
    state.recoveryAllowanceTotal = recoveryAllowanceTotal
    state.recoveryAllowanceRemaining = recoveryAllowanceRemaining
    state.recoveryAllowanceConsumed = recoveryAllowanceConsumed
    state.effectiveMax = maxAttempts + (recoveryAllowanceValid and recoveryAllowanceTotal or 0)
    state.attemptReservations = reservations
    local encoded = cjson.encode(state)
    redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[2]))
    return cjson.encode({ status = 'rolled_back', state = state })
  end
end
return cjson.encode({ status = 'missing', state = state })
`;

const ATTEMPT_RECOVERY_GRANT_SCRIPT = `
-- leaf_aws_liveness_attempt_recovery_grant_v1
local attemptRaw = redis.call('GET', KEYS[1])
if not attemptRaw then
  return cjson.encode({ status = 'attempt_state_missing' })
end
local attemptOk, state = pcall(cjson.decode, attemptRaw)
if not attemptOk or type(state) ~= 'table' then
  return cjson.encode({ status = 'attempt_state_invalid' })
end

local sessionRaw = redis.call('GET', KEYS[2])
if not sessionRaw then
  return cjson.encode({ status = 'session_metadata_missing' })
end
local sessionOk, metadata = pcall(cjson.decode, sessionRaw)
if not sessionOk or type(metadata) ~= 'table' then
  return cjson.encode({ status = 'session_metadata_invalid' })
end

if
  metadata.userId ~= ARGV[1]
  or metadata.provider ~= ARGV[2]
  or metadata.lastStatus ~= 'SUCCEEDED'
  or metadata.livenessPassed ~= true
  or (metadata.abandonedAt and metadata.abandonedAt ~= cjson.null and metadata.abandonedAt ~= '')
then
  return cjson.encode({ status = 'session_not_eligible' })
end

if
  state.userId ~= ARGV[1]
  or state.attemptScope ~= ARGV[3]
  or state.lastSessionId ~= ARGV[4]
then
  return cjson.encode({ status = 'attempt_binding_mismatch' })
end

local processed = state.processedResults
if type(processed) ~= 'table' then processed = {} end
local processedMatch = false
for _, item in ipairs(processed) do
  if
    item.sessionIdHash == ARGV[5]
    and item.status == 'SUCCEEDED'
    and item.passed == true
  then
    processedMatch = true
  end
end
if not processedMatch then
  return cjson.encode({ status = 'result_not_eligible' })
end

local recoveryAllowanceTotal = math.max(
  0,
  math.floor(tonumber(state.recoveryAllowanceTotal or 0))
)
local recoveryAllowanceRemaining = math.max(
  0,
  math.floor(tonumber(state.recoveryAllowanceRemaining or 0))
)
local recoveryAllowanceConsumed = math.max(
  0,
  math.floor(tonumber(state.recoveryAllowanceConsumed or 0))
)
local recoveryAllowanceGrantId = ''
if type(state.recoveryAllowanceGrantId) == 'string' then
  recoveryAllowanceGrantId = state.recoveryAllowanceGrantId
end
local recoveryAllowanceGrantIds = state.recoveryAllowanceGrantIds
if type(recoveryAllowanceGrantIds) ~= 'table' then
  recoveryAllowanceGrantIds = {}
  if
    recoveryAllowanceTotal == 1
    and string.find(recoveryAllowanceGrantId, '%S') ~= nil
  then
    table.insert(recoveryAllowanceGrantIds, recoveryAllowanceGrantId)
  end
end

local grantAlreadyApplied = false
for _, existingGrantId in ipairs(recoveryAllowanceGrantIds) do
  if existingGrantId == ARGV[6] then grantAlreadyApplied = true end
end
if grantAlreadyApplied then
  local replayValid = recoveryAllowanceTotal >= 1
    and #recoveryAllowanceGrantIds == recoveryAllowanceTotal
    and recoveryAllowanceRemaining + recoveryAllowanceConsumed == recoveryAllowanceTotal
  if not replayValid then
    return cjson.encode({ status = 'grant_replay_invalid' })
  end
  return cjson.encode({ status = 'replay', state = state })
end

local providerRecoveryMaxCredits = math.max(0, tonumber(ARGV[8]))
if recoveryAllowanceTotal > 0 then
  local existingStateValid = recoveryAllowanceTotal <= providerRecoveryMaxCredits
    and #recoveryAllowanceGrantIds == recoveryAllowanceTotal
    and string.find(recoveryAllowanceGrantId, '%S') ~= nil
    and recoveryAllowanceRemaining + recoveryAllowanceConsumed == recoveryAllowanceTotal
  if not existingStateValid then
    return cjson.encode({ status = 'grant_replay_invalid' })
  end
elseif
  recoveryAllowanceRemaining ~= 0
  or recoveryAllowanceConsumed ~= 0
  or string.find(recoveryAllowanceGrantId, '%S') ~= nil
  or #recoveryAllowanceGrantIds ~= 0
then
  return cjson.encode({ status = 'grant_replay_invalid' })
end
if recoveryAllowanceTotal >= providerRecoveryMaxCredits then
  return cjson.encode({ status = 'recovery_limit_reached', state = state })
end

local maxAttempts = math.max(0, tonumber(state.maxAttempts or 0))
local started = math.max(0, tonumber(state.started or 0))
local failed = math.max(0, tonumber(state.failed or 0))
local passed = math.max(0, tonumber(state.passed or 0))
local reservations = state.attemptReservations
if type(reservations) ~= 'table' then reservations = {} end
if
  maxAttempts <= 0
  or failed >= maxAttempts
  or state.softBlocked == true
  or passed <= 0
  or #reservations > 0
then
  return cjson.encode({ status = 'attempt_not_eligible', state = state })
end
if started < maxAttempts then
  return cjson.encode({ status = 'not_required', state = state })
end

local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000)
  + math.floor(tonumber(redisTime[2]) / 1000)
local activeTripId = redis.call('GET', KEYS[3])
if not activeTripId then
  local hashedTrip = redis.call('HGET', KEYS[4], 'activeTripId')
  local hashedLeaseUntilMs = tonumber(
    redis.call('HGET', KEYS[4], '${ACTIVE_TRIP_LEASE_UNTIL_FIELD}') or '0'
  )
  if hashedTrip and hashedLeaseUntilMs > nowMs then
    activeTripId = hashedTrip
  end
end
if activeTripId then
  return cjson.encode({ status = 'active_trip' })
end

table.insert(recoveryAllowanceGrantIds, ARGV[6])
state.recoveryAllowanceTotal = recoveryAllowanceTotal + 1
state.recoveryAllowanceRemaining = recoveryAllowanceRemaining + 1
state.recoveryAllowanceConsumed = recoveryAllowanceConsumed
state.recoveryAllowanceGrantId = ARGV[6]
state.recoveryAllowanceGrantIds = recoveryAllowanceGrantIds
state.recoveryAllowanceGrantedAt = ARGV[7]
state.recoveryAllowanceReason = 'provider_reference_image_incomplete'
state.recoveryAllowanceSessionIdHash = ARGV[5]
state.providerRecoveryMaxCredits = providerRecoveryMaxCredits
state.effectiveMax = maxAttempts + state.recoveryAllowanceTotal

redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
return cjson.encode({ status = 'applied', state = state })
`;

const ATTEMPT_RESULT_SCRIPT = `
-- leaf_aws_liveness_attempt_result_v1
local raw = redis.call('GET', KEYS[1])
local state = {}
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= 'table' then
    return redis.error_reply('KYC_ATTEMPT_STATE_INVALID')
  end
  state = decoded
end

local processed = state.processedResults
if type(processed) ~= 'table' then processed = {} end
for _, item in ipairs(processed) do
  if item.sessionIdHash == ARGV[7] then
    state.justExhausted = false
    state.idempotentReplay = true
    return cjson.encode({ status = 'replay', state = state })
  end
end

local passed = ARGV[10] == '1'
local failedCount = tonumber(state.failed or 0)
state.userId = ARGV[1]
state.requirement = ARGV[2]
state.attemptScope = ARGV[3]
state.passed = tonumber(state.passed or 0) + (passed and 1 or 0)
state.failed = failedCount + (passed and 0 or 1)
state.lastSessionId = ARGV[8]
state.lastStatus = ARGV[9]
state.lastCompletedAt = ARGV[11]
state.maxAttempts = tonumber(ARGV[4])
state.estimatedUnitCostUsd = tonumber(ARGV[5])
state.windowSeconds = tonumber(ARGV[6])
state.idempotentReplay = false

local reservations = state.attemptReservations
if type(reservations) ~= 'table' then reservations = {} end
for index = #reservations, 1, -1 do
  if reservations[index].sessionId == ARGV[8] then table.remove(reservations, index) end
end
state.attemptReservations = reservations

if passed then
  state.failed = 0
  state.attemptsExhausted = false
  state.softBlocked = false
  state.exhaustedAt = cjson.null
  state.justExhausted = false
elseif state.softBlocked == true then
  state.attemptsExhausted = true
  state.softBlocked = true
  state.justExhausted = false
elseif tonumber(state.failed or 0) >= tonumber(ARGV[4]) then
  state.attemptsExhausted = true
  state.softBlocked = ARGV[12] == '1'
  state.exhaustedAt = ARGV[11]
  state.justExhausted = true
else
  state.justExhausted = false
end

table.insert(processed, {
  sessionIdHash = ARGV[7],
  status = ARGV[9],
  passed = passed,
  processedAt = ARGV[11]
})
while #processed > tonumber(ARGV[13]) do table.remove(processed, 1) end
state.processedResults = processed

local encoded = cjson.encode(state)
redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[14]))
return cjson.encode({ status = 'recorded', state = state })
`;

const SESSION_COMPLETE_SCRIPT = `
-- leaf_aws_liveness_session_complete_v1
local raw = redis.call('GET', KEYS[1])
if not raw then return redis.error_reply('AWS_LIVENESS_SESSION_METADATA_REQUIRED') end
local ok, metadata = pcall(cjson.decode, raw)
if not ok or type(metadata) ~= 'table' then
  return redis.error_reply('AWS_LIVENESS_SESSION_METADATA_INVALID')
end
if not metadata.completedAt or metadata.completedAt == cjson.null or metadata.completedAt == '' then
  metadata.completedAt = ARGV[1]
end
metadata.lastStatus = ARGV[2]
metadata.confidence = tonumber(ARGV[3])
metadata.livenessPassed = ARGV[4] == '1'
metadata.referenceImageAvailable = ARGV[6] == '1'
metadata.referenceImageFaceDetected = ARGV[7] == '1'
metadata.referenceImageByteLength = tonumber(ARGV[8])
metadata.referenceImageReadAttempts = tonumber(ARGV[9])
metadata.referenceImageArtifactStatus = ARGV[10]
local encoded = cjson.encode(metadata)
redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[5]))
return encoded
`;

const SESSION_ABANDON_SCRIPT = `
-- leaf_aws_liveness_session_abandon_v1
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ status = 'missing' })
end
local ok, metadata = pcall(cjson.decode, raw)
if not ok or type(metadata) ~= 'table' then
  return cjson.encode({ status = 'invalid' })
end
if metadata.userId ~= ARGV[1] then
  return cjson.encode({ status = 'user_mismatch' })
end
if metadata.provider ~= ARGV[2] then
  return cjson.encode({ status = 'provider_mismatch' })
end
local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000)
  + math.floor(tonumber(redisTime[2]) / 1000)
local activeTripId = redis.call('GET', KEYS[3])
if not activeTripId then
  local hashedTrip = redis.call('HGET', KEYS[4], 'activeTripId')
  local hashedLeaseUntilMs = tonumber(
    redis.call('HGET', KEYS[4], '${ACTIVE_TRIP_LEASE_UNTIL_FIELD}') or '0'
  )
  if hashedTrip and hashedLeaseUntilMs > nowMs then
    activeTripId = hashedTrip
  end
end
if activeTripId then
  return cjson.encode({
    status = 'active_trip',
    activeTripId = tostring(activeTripId)
  })
end

local windowToken = metadata.verificationWindowToken
if metadata.abandonedAt and metadata.abandonedAt ~= cjson.null and metadata.abandonedAt ~= '' then
  local released = 0
  if type(windowToken) == 'string' and windowToken ~= '' then
    local currentWindowToken = redis.call('GET', KEYS[2])
    if currentWindowToken == windowToken then
      released = redis.call('DEL', KEYS[2])
    end
  end
  return cjson.encode({
    status = 'already_abandoned',
    released = released == 1,
    metadata = metadata
  })
end
if metadata.livenessPassed == true then
  return cjson.encode({
    status = 'resume_required',
    metadata = metadata
  })
end
if type(windowToken) ~= 'string' or windowToken == '' then
  return cjson.encode({ status = 'window_binding_missing' })
end

metadata.abandonedAt = ARGV[3]
metadata.status = 'ABANDONED'
metadata.providerStatusAtAbandon = ARGV[4]
metadata.abandonReason = 'client_cancelled'
local encoded = cjson.encode(metadata)
redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[5]))

local released = 0
local currentWindowToken = redis.call('GET', KEYS[2])
if currentWindowToken == windowToken then
  released = redis.call('DEL', KEYS[2])
end
return cjson.encode({
  status = 'abandoned',
  released = released == 1,
  metadata = metadata
})
`;

function normalizeReferenceImageBoundingBox(value) {
  const width = Number(value?.Width);
  const height = Number(value?.Height);
  const left = Number(value?.Left);
  const top = Number(value?.Top);
  const coordinates = [width, height, left, top];

  if (
    !coordinates.every(Number.isFinite)
    || width <= 0
    || height <= 0
    || width > 1.001
    || height > 1.001
  ) {
    return null;
  }

  const visibleLeft = Math.max(0, left);
  const visibleTop = Math.max(0, top);
  const visibleRight = Math.min(1, left + width);
  const visibleBottom = Math.min(1, top + height);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

  return {
    width: visibleRight - visibleLeft,
    height: visibleBottom - visibleTop,
    left: visibleLeft,
    top: visibleTop
  };
}

class AwsFaceLivenessService {
  constructor(options = {}) {
    this.costGuard = options.costGuard || defaultAwsKycCostGuard;
    this.enabled = String(
      process.env.KYC_AWS_LIVENESS_ENABLED
      || process.env.AWS_LIVENESS_ENABLED
      || 'false'
    ).toLowerCase() === 'true';

    this.region = String(
      process.env.AWS_REGION
      || process.env.AWS_LIVENESS_REGION
      || 'us-east-1'
    ).trim();

    this.confidenceThreshold = this.parseNumber(
      process.env.KYC_AWS_LIVENESS_CONFIDENCE_THRESHOLD
      || process.env.AWS_LIVENESS_CONFIDENCE_THRESHOLD
      || '80',
      80,
      0,
      100
    );

    this.sessionTtlSeconds = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_SESSION_TTL_SECONDS
      || process.env.AWS_LIVENESS_SESSION_TTL_SECONDS
      || '165',
      165,
      60,
      180
    );

    this.auditImagesLimit = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_AUDIT_IMAGES_LIMIT
      || process.env.AWS_LIVENESS_AUDIT_IMAGES_LIMIT
      || '0',
      0,
      0,
      4
    );

    this.challengeType = this.parseChallengeType(
      process.env.KYC_AWS_LIVENESS_CHALLENGE_TYPE
    );

    this.outputBucket = String(
      process.env.KYC_AWS_LIVENESS_S3_BUCKET
      || process.env.AWS_LIVENESS_S3_BUCKET
      || ''
    ).trim();

    this.outputPrefix = String(
      process.env.KYC_AWS_LIVENESS_S3_PREFIX
      || process.env.AWS_LIVENESS_S3_PREFIX
      || 'kyc/liveness'
    ).trim();

    this.credentialsEnabled = String(
      process.env.KYC_AWS_LIVENESS_CREDENTIALS_ENABLED
      || process.env.AWS_LIVENESS_CREDENTIALS_ENABLED
      || 'true'
    ).toLowerCase() === 'true';
    this.assumeRoleArn = String(
      process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_ARN
      || process.env.AWS_LIVENESS_ASSUME_ROLE_ARN
      || ''
    ).trim();
    this.assumeRoleExternalId = String(
      process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID
      || process.env.AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID
      || ''
    ).trim();
    this.stsDurationSeconds = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_STS_DURATION_SECONDS
      || process.env.AWS_LIVENESS_STS_DURATION_SECONDS
      || '900',
      900,
      900,
      3600
    );
    this.sessionNamePrefix = String(
      process.env.KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX
      || process.env.AWS_LIVENESS_STS_SESSION_NAME_PREFIX
      || 'leaf-liveness'
    ).trim();
    this.estimatedUnitCostUsd = this.parseNumber(
      process.env.KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD
      || process.env.AWS_LIVENESS_ESTIMATED_UNIT_COST_USD
      || '0.015',
      0,
      0,
      100
    );
    this.maxAttemptsPerWindow = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW
      || process.env.AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW
      || '2',
      2,
      1,
      10
    );
    this.withdrawalMaxAttemptsPerWindow = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_WITHDRAWAL_MAX_ATTEMPTS_PER_WINDOW
      || process.env.AWS_LIVENESS_WITHDRAWAL_MAX_ATTEMPTS_PER_WINDOW
      || '2',
      2,
      1,
      10
    );
    this.attemptWindowSeconds = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_ATTEMPT_WINDOW_SECONDS
      || process.env.AWS_LIVENESS_ATTEMPT_WINDOW_SECONDS
      || '86400',
      86400,
      300,
      604800
    );
    this.idempotentRetryDelaySeconds = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_DELAY_SECONDS || '2',
      2,
      0,
      30
    );
    this.idempotentRetryWindowSeconds = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_WINDOW_SECONDS || '120',
      120,
      30,
      150
    );
    this.referenceResultMaxReads = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_REFERENCE_RESULT_MAX_READS || '3',
      3,
      1,
      5
    );
    this.referenceResultRetryDelayMs = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_REFERENCE_RESULT_RETRY_DELAY_MS || '250',
      250,
      0,
      2000
    );
    this.providerRecoveryMaxCredits = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_PROVIDER_RECOVERY_MAX_CREDITS || '3',
      3,
      1,
      8
    );
    this.softBlockOnAttemptsExhausted = String(
      process.env.KYC_AWS_LIVENESS_SOFT_BLOCK_ON_EXHAUSTED
      || process.env.AWS_LIVENESS_SOFT_BLOCK_ON_EXHAUSTED
      || 'true'
    ).toLowerCase() === 'true';
    this.sdkMaxAttempts = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_SDK_MAX_ATTEMPTS
      || process.env.AWS_LIVENESS_SDK_MAX_ATTEMPTS
      || '2',
      2,
      1,
      5
    );

    this.redisPrefix = 'kyc:aws:liveness:session:';
    this.redisCredentialsPrefix = 'kyc:aws:liveness:credentials:';
    this.redisAttemptPrefix = 'kyc:aws:liveness:attempts:';
    this.rekognitionClient = this.createClient();
    this.stsClient = this.createStsClient();
  }

  parseNumber(rawValue, fallback, min, max) {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  parseIntValue(rawValue, fallback, min, max) {
    const numeric = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  parseChallengeType(rawValue) {
    const challengeType = rawValue == null || String(rawValue).trim() === ''
      ? DEFAULT_CHALLENGE_TYPE
      : String(rawValue).trim();

    if (!ALLOWED_CHALLENGE_TYPES.has(challengeType)) {
      const error = new Error(
        'KYC_AWS_LIVENESS_CHALLENGE_TYPE deve ser FaceMovementChallenge ou FaceMovementAndLightChallenge'
      );
      error.code = 'KYC_AWS_LIVENESS_CHALLENGE_TYPE_INVALID';
      throw error;
    }

    return challengeType;
  }

  createClient() {
    if (!this.enabled) return null;

    const clientConfig = {
      region: this.region,
      maxAttempts: this.sdkMaxAttempts
    };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN || undefined
      };
    }

    return new RekognitionClient(clientConfig);
  }

  createStsClient() {
    if (!this.enabled || !this.credentialsEnabled) return null;

    const clientConfig = {
      region: this.region,
      maxAttempts: this.sdkMaxAttempts
    };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN || undefined
      };
    }

    return new STSClient(clientConfig);
  }

  getProviderName() {
    return PROVIDER_NAME;
  }

  isEnabled() {
    return this.enabled === true;
  }

  getConfigSummary() {
    return {
      enabled: this.isEnabled(),
      provider: PROVIDER_NAME,
      region: this.region,
      confidenceThreshold: this.confidenceThreshold,
      sessionTtlSeconds: this.sessionTtlSeconds,
      auditImagesLimit: this.auditImagesLimit,
      challengeType: this.challengeType,
      hasOutputBucket: Boolean(this.outputBucket),
      credentialsEnabled: this.credentialsEnabled,
      hasAssumeRoleArn: Boolean(this.assumeRoleArn),
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      maxAttemptsPerWindow: this.maxAttemptsPerWindow,
      withdrawalMaxAttemptsPerWindow: this.withdrawalMaxAttemptsPerWindow,
      attemptWindowSeconds: this.attemptWindowSeconds,
      idempotentRetryDelaySeconds: this.idempotentRetryDelaySeconds,
      idempotentRetryWindowSeconds: this.idempotentRetryWindowSeconds,
      referenceResultMaxReads: this.referenceResultMaxReads,
      referenceResultRetryDelayMs: this.referenceResultRetryDelayMs,
      providerRecoveryMaxCredits: this.providerRecoveryMaxCredits,
      softBlockOnAttemptsExhausted: this.softBlockOnAttemptsExhausted,
      sdkMaxAttempts: this.sdkMaxAttempts,
      costGuard: this.costGuard?.getConfigSummary?.() || { enabled: false }
    };
  }

  assertEnabled() {
    if (!this.isEnabled()) {
      const error = new Error('AWS Rekognition Face Liveness está desabilitado');
      error.code = 'AWS_LIVENESS_DISABLED';
      throw error;
    }

    if (!this.rekognitionClient) {
      const error = new Error('Cliente AWS Rekognition não inicializado');
      error.code = 'AWS_LIVENESS_CLIENT_NOT_READY';
      throw error;
    }
  }

  assertCredentialsEnabled() {
    this.assertEnabled();

    if (!this.credentialsEnabled) {
      const error = new Error('Emissão de credenciais AWS liveness está desabilitada');
      error.code = 'AWS_LIVENESS_CREDENTIALS_DISABLED';
      throw error;
    }

    if (!this.assumeRoleArn) {
      const error = new Error('KYC_AWS_LIVENESS_ASSUME_ROLE_ARN não configurado');
      error.code = 'AWS_LIVENESS_ASSUME_ROLE_MISSING';
      throw error;
    }

    if (!this.stsClient) {
      const error = new Error('Cliente AWS STS não inicializado');
      error.code = 'AWS_LIVENESS_STS_CLIENT_NOT_READY';
      throw error;
    }
  }

  buildSessionRedisKey(sessionId) {
    return `${this.redisPrefix}${sessionId}`;
  }

  buildCredentialsRedisKey(userId) {
    return `${this.redisCredentialsPrefix}${String(userId || 'anonymous')}`;
  }

  normalizeAttemptScope(value) {
    const normalized = String(value || 'general')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 64);
    return normalized || 'general';
  }

  resolveAttemptScope({ requirement = null, attemptScope = null } = {}) {
    if (attemptScope) {
      return this.normalizeAttemptScope(attemptScope);
    }
    if (requirement === 'IDENTITY_REVERIFICATION') {
      return 'identity_reverification';
    }
    return this.normalizeAttemptScope(requirement || 'general');
  }

  getMaxAttemptsForScope(attemptScope) {
    const scope = this.normalizeAttemptScope(attemptScope);
    if (scope.startsWith('manual_review_retry_')) {
      return 1;
    }
    if (scope === 'withdrawal') {
      return this.withdrawalMaxAttemptsPerWindow;
    }
    return this.maxAttemptsPerWindow;
  }

  normalizeRecoveryAllowance(state = {}, maxAttempts) {
    const normalizeCount = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
    };
    const total = normalizeCount(state.recoveryAllowanceTotal);
    const remaining = normalizeCount(state.recoveryAllowanceRemaining);
    const consumed = normalizeCount(state.recoveryAllowanceConsumed);
    const grantId = typeof state.recoveryAllowanceGrantId === 'string'
      ? state.recoveryAllowanceGrantId.trim()
      : '';
    const grantIds = Array.isArray(state.recoveryAllowanceGrantIds)
      ? state.recoveryAllowanceGrantIds
        .map((value) => String(value || '').trim())
        .filter(Boolean)
      : (total === 1 && grantId ? [grantId] : []);
    const uniqueGrantIds = new Set(grantIds);
    const valid = total >= 1
      && total <= this.providerRecoveryMaxCredits
      && grantId.length > 0
      && grantIds.length === total
      && uniqueGrantIds.size === total
      && grantIds[grantIds.length - 1] === grantId
      && remaining + consumed === total;

    return {
      recoveryAllowanceTotal: total,
      recoveryAllowanceRemaining: remaining,
      recoveryAllowanceConsumed: consumed,
      recoveryAllowanceGrantId: grantId || null,
      recoveryAllowanceGrantCount: grantIds.length,
      recoveryAllowanceValid: valid,
      effectiveMax: Number(maxAttempts) + (valid ? total : 0)
    };
  }

  async grantReferenceImageRecoveryAttempt({
    userId,
    sessionId,
    requirement = null,
    attemptScope = null
  } = {}) {
    const safeUserId = String(userId || '').trim();
    const safeSessionId = String(sessionId || '').trim();
    if (!safeUserId || !safeSessionId) {
      const error = new Error('Binding da recuperacao de liveness incompleto');
      error.code = 'KYC_AWS_LIVENESS_RECOVERY_BINDING_REQUIRED';
      throw error;
    }

    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    const attemptKey = this.buildAttemptRedisKey({
      userId: safeUserId,
      requirement,
      attemptScope: scope
    });
    const sessionIdHash = crypto
      .createHash('sha256')
      .update(safeSessionId)
      .digest('hex');
    const grantId = crypto
      .createHash('sha256')
      .update(`${safeUserId}:${scope}:${sessionIdHash}:provider_reference_image_incomplete_v1`)
      .digest('hex');

    try {
      const redis = redisPool.getConnection();
      if (!redis || typeof redis.eval !== 'function') {
        const unavailableError = new Error(
          'Redis atomico indisponivel para recuperar tentativa de liveness'
        );
        unavailableError.code = 'KYC_AWS_LIVENESS_RECOVERY_STORE_UNAVAILABLE';
        throw unavailableError;
      }
      const raw = await redis.eval(
        ATTEMPT_RECOVERY_GRANT_SCRIPT,
        4,
        attemptKey,
        this.buildSessionRedisKey(safeSessionId),
        activeTripKey(safeUserId),
        `driver:${safeUserId}`,
        safeUserId,
        PROVIDER_NAME,
        scope,
        safeSessionId,
        sessionIdHash,
        grantId,
        new Date().toISOString(),
        this.providerRecoveryMaxCredits
      );
      const result = raw && typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
      if (result?.status === 'active_trip') {
        const error = new Error('Validacao de identidade adiada ate o fim da corrida ativa');
        error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
        throw error;
      }
      if ([
        'attempt_state_missing',
        'session_metadata_missing',
        'session_not_eligible',
        'attempt_binding_mismatch',
        'result_not_eligible',
        'attempt_not_eligible'
      ].includes(result?.status)) {
        const error = new Error('Tentativa nao elegivel para recuperacao de liveness');
        error.code = 'KYC_AWS_LIVENESS_RECOVERY_NOT_ELIGIBLE';
        error.recoveryStatus = result.status;
        throw error;
      }
      if ([
        'attempt_state_invalid',
        'session_metadata_invalid',
        'grant_replay_invalid'
      ].includes(result?.status)) {
        const error = new Error('Estado invalido para recuperacao de liveness');
        error.code = 'KYC_AWS_LIVENESS_RECOVERY_STATE_INVALID';
        error.recoveryStatus = result.status;
        throw error;
      }
      if (![
        'applied',
        'replay',
        'not_required',
        'different_grant_exists',
        'recovery_limit_reached'
      ].includes(result?.status) || !result?.state) {
        const error = new Error('Recuperacao de liveness nao confirmada');
        error.code = 'KYC_AWS_LIVENESS_RECOVERY_GRANT_FAILED';
        throw error;
      }

      const state = result.state;
      const maxAttempts = Number(state.maxAttempts || this.getMaxAttemptsForScope(scope));
      const recoveryAllowance = this.normalizeRecoveryAllowance(state, maxAttempts);
      const started = Number(state.started || 0);
      const canRetry = started < maxAttempts
        || (
          recoveryAllowance.recoveryAllowanceValid
          && recoveryAllowance.recoveryAllowanceRemaining > 0
          && started < recoveryAllowance.effectiveMax
        );
      return {
        status: result.status,
        granted: ['applied', 'replay'].includes(result.status),
        idempotentReplay: result.status === 'replay',
        providerRecoveryLimitReached: result.status === 'recovery_limit_reached',
        canRetry,
        attemptState: {
          started,
          passed: Number(state.passed || 0),
          failed: Number(state.failed || 0),
          maxAttempts,
          effectiveMax: recoveryAllowance.effectiveMax,
          recoveryAllowanceRemaining: recoveryAllowance.recoveryAllowanceRemaining,
          attemptsExhausted: !canRetry,
          softBlocked: state.softBlocked === true
        }
      };
    } catch (error) {
      logError(error, 'Falha ao conceder recuperacao controlada de liveness', {
        service: 'aws-face-liveness-service',
        userId: safeUserId,
        attemptScope: scope
      });
      if (error?.code) throw error;
      const wrappedError = new Error('Falha ao conceder recuperacao controlada de liveness');
      wrappedError.code = 'KYC_AWS_LIVENESS_RECOVERY_GRANT_FAILED';
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  buildAttemptRedisKey({ userId, requirement = null, attemptScope = null } = {}) {
    const safeUserId = String(userId || '').trim();
    const safeScope = this.resolveAttemptScope({ requirement, attemptScope });
    if (!safeUserId) return null;
    return `${this.redisAttemptPrefix}${safeUserId}:${safeScope}`;
  }

  async runRedisScript(script, key, args, { code, operation, userId = null } = {}) {
    try {
      const redis = redisPool.getConnection();
      if (!redis || typeof redis.eval !== 'function') {
        const unavailableError = new Error('Redis atomico indisponivel para controle de liveness');
        unavailableError.code = 'KYC_AWS_LIVENESS_ATOMIC_STORE_UNAVAILABLE';
        throw unavailableError;
      }
      const raw = await redis.eval(script, 1, key, ...args.map((value) => String(value)));
      if (raw && typeof raw === 'object') return raw;
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      logError(error, `Falha no controle atomico de liveness: ${operation}`, {
        service: 'aws-face-liveness-service',
        userId,
        operation
      });
      if (error?.code) throw error;
      const wrappedError = new Error(`Falha no controle atomico de liveness: ${operation}`);
      wrappedError.code = code || 'KYC_AWS_LIVENESS_ATOMIC_STORE_FAILED';
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  async reserveAttempt({ userId, requirement = null, attemptScope = null } = {}) {
    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    const key = this.buildAttemptRedisKey({ userId, requirement, attemptScope: scope });
    if (!key) return null;

    const maxAttempts = this.getMaxAttemptsForScope(scope);
    const reservation = {
      key,
      token: crypto.randomUUID(),
      userId,
      requirement,
      attemptScope: scope
    };
    const now = new Date();
    const nowIso = now.toISOString();
    const result = await this.runRedisScript(
      ATTEMPT_RESERVE_SCRIPT,
      key,
      [
        userId,
        requirement || 'LIVENESS_REQUIRED',
        scope,
        maxAttempts,
        this.estimatedUnitCostUsd,
        this.attemptWindowSeconds,
        nowIso,
        reservation.token,
        ATTEMPT_RESERVATION_LIMIT,
        now.getTime(),
        this.idempotentRetryDelaySeconds,
        this.idempotentRetryWindowSeconds,
        this.providerRecoveryMaxCredits
      ],
      {
        code: 'KYC_AWS_LIVENESS_ATTEMPT_RESERVE_FAILED',
        operation: 'reserve_attempt',
        userId
      }
    );

    if (result?.status === 'in_flight') {
      const error = new Error('Uma tentativa AWS liveness anterior tem resultado de dispatch desconhecido');
      error.code = 'KYC_AWS_LIVENESS_DISPATCH_OUTCOME_UNKNOWN';
      error.attemptState = result.state || null;
      throw error;
    }
    if (result?.status === 'exhausted') {
      const state = result.state || {};
      const started = Number(state.started || 0);
      const recoveryAllowance = this.normalizeRecoveryAllowance(state, maxAttempts);
      const error = new Error('Limite de tentativas de liveness atingido');
      error.code = 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED';
      error.attemptState = {
        ...state,
        attemptsExhausted: true,
        softBlocked: state.softBlocked === true,
        softBlockEnabled: this.softBlockOnAttemptsExhausted,
        maxAttempts,
        ...recoveryAllowance,
        estimatedCostUsd: Number((started * this.estimatedUnitCostUsd).toFixed(6))
      };
      throw error;
    }
    if (!['reserved', 'resume'].includes(result?.status) || !result.state) {
      const error = new Error('Nao foi possivel reservar tentativa de liveness');
      error.code = 'KYC_AWS_LIVENESS_ATTEMPT_RESERVE_FAILED';
      throw error;
    }

    return {
      ...reservation,
      token: result.status === 'resume' ? result.token : reservation.token,
      idempotentResume: result.status === 'resume',
      state: result.state
    };
  }

  async commitAttemptReservation(reservation, sessionId) {
    if (!reservation) return null;
    const result = await this.runRedisScript(
      ATTEMPT_COMMIT_SCRIPT,
      reservation.key,
      [
        reservation.token,
        sessionId,
        new Date().toISOString(),
        this.attemptWindowSeconds
      ],
      {
        code: 'KYC_AWS_LIVENESS_ATTEMPT_COMMIT_FAILED',
        operation: 'commit_attempt',
        userId: reservation.userId
      }
    );
    if (result?.status !== 'committed' || !result.state) {
      const error = new Error('Reserva de tentativa de liveness nao encontrada');
      error.code = 'KYC_AWS_LIVENESS_ATTEMPT_RESERVATION_LOST';
      throw error;
    }
    return result.state;
  }

  async rollbackAttemptReservation(reservation) {
    if (!reservation) return null;
    return this.runRedisScript(
      ATTEMPT_ROLLBACK_SCRIPT,
      reservation.key,
      [reservation.token, this.attemptWindowSeconds, this.providerRecoveryMaxCredits],
      {
        code: 'KYC_AWS_LIVENESS_ATTEMPT_ROLLBACK_FAILED',
        operation: 'rollback_attempt',
        userId: reservation.userId
      }
    );
  }

  async getAttemptState({ userId, requirement = null, attemptScope = null } = {}) {
    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    const maxAttempts = this.getMaxAttemptsForScope(scope);
    const key = this.buildAttemptRedisKey({ userId, requirement, attemptScope: scope });
    if (!key) return null;

    try {
      const redis = redisPool.getConnection();
      const raw = await redis.get(key);
      if (!raw) {
        return {
          userId,
          requirement: requirement || 'LIVENESS_REQUIRED',
          attemptScope: scope,
          started: 0,
          failed: 0,
          passed: 0,
          maxAttempts,
          effectiveMax: maxAttempts,
          recoveryAllowanceTotal: 0,
          recoveryAllowanceRemaining: 0,
          recoveryAllowanceConsumed: 0,
          recoveryAllowanceGrantId: null,
          recoveryAllowanceValid: false,
          estimatedUnitCostUsd: this.estimatedUnitCostUsd,
          estimatedCostUsd: 0,
          windowSeconds: this.attemptWindowSeconds,
          attemptsExhausted: false,
          softBlocked: false
        };
      }
      const parsed = JSON.parse(raw);
      const started = Number(parsed.started || 0);
      const storedMaxAttempts = Number(parsed.maxAttempts || maxAttempts);
      const estimatedUnitCostUsd = Number(
        parsed.estimatedUnitCostUsd || this.estimatedUnitCostUsd
      );
      const recoveryAllowance = this.normalizeRecoveryAllowance(parsed, storedMaxAttempts);
      return {
        userId,
        requirement: parsed.requirement || requirement || 'LIVENESS_REQUIRED',
        attemptScope: parsed.attemptScope || scope,
        started,
        failed: Number(parsed.failed || 0),
        passed: Number(parsed.passed || 0),
        maxAttempts: storedMaxAttempts,
        ...recoveryAllowance,
        estimatedUnitCostUsd,
        estimatedCostUsd: Number((started * estimatedUnitCostUsd).toFixed(6)),
        windowSeconds: Number(parsed.windowSeconds || this.attemptWindowSeconds),
        attemptsExhausted: parsed.attemptsExhausted === true,
        softBlocked: parsed.softBlocked === true,
        exhaustedAt: parsed.exhaustedAt || null,
        lastSessionId: parsed.lastSessionId || null,
        lastStatus: parsed.lastStatus || null,
        lastStartedAt: parsed.lastStartedAt || null,
        lastCompletedAt: parsed.lastCompletedAt || null
      };
    } catch (error) {
      logError(error, 'Falha ao ler contador de tentativas AWS liveness', {
        service: 'aws-face-liveness-service',
        userId
      });
      return null;
    }
  }

  async saveAttemptState({ userId, requirement = null, attemptScope = null, state }) {
    const key = this.buildAttemptRedisKey({ userId, requirement, attemptScope });
    if (!key || !state) return null;

    try {
      const redis = redisPool.getConnection();
      await redis.set(
        key,
        JSON.stringify(state),
        'EX',
        this.attemptWindowSeconds
      );
    } catch (error) {
      logError(error, 'Falha ao salvar contador de tentativas AWS liveness', {
        service: 'aws-face-liveness-service',
        userId
      });
    }
    return state;
  }

  async assertCanCreateSession({ userId, requirement = null, attemptScope = null } = {}) {
    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    const maxAttempts = this.getMaxAttemptsForScope(scope);
    const state = await this.getAttemptState({ userId, requirement, attemptScope: scope });
    if (!state) return null;

    const started = Number(state.started || 0);
    const recoveryAllowance = this.normalizeRecoveryAllowance(state, maxAttempts);
    const needsRecoveryAllowance = started >= maxAttempts;
    const canUseRecoveryAllowance = recoveryAllowance.recoveryAllowanceValid
      && recoveryAllowance.recoveryAllowanceRemaining > 0
      && started < recoveryAllowance.effectiveMax;
    if (
      state.softBlocked
      || state.failed >= maxAttempts
      || (needsRecoveryAllowance && !canUseRecoveryAllowance)
    ) {
      const error = new Error('Limite de tentativas de liveness atingido');
      error.code = 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED';
      error.attemptState = {
        ...state,
        attemptsExhausted: true,
        softBlocked: state.softBlocked === true,
        softBlockEnabled: this.softBlockOnAttemptsExhausted,
        maxAttempts,
        ...recoveryAllowance,
        estimatedCostUsd: Number((started * this.estimatedUnitCostUsd).toFixed(6))
      };
      throw error;
    }

    return state;
  }

  async recordAttemptStarted({ userId, requirement = null, attemptScope = null, sessionId = null } = {}) {
    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    const maxAttempts = this.getMaxAttemptsForScope(scope);
    const state = await this.getAttemptState({ userId, requirement, attemptScope: scope });
    if (!state) return null;

    const nextState = {
      ...state,
      userId,
      requirement: requirement || state.requirement || 'LIVENESS_REQUIRED',
      attemptScope: scope,
      started: Number(state.started || 0) + 1,
      maxAttempts,
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      windowSeconds: this.attemptWindowSeconds,
      lastSessionId: sessionId || state.lastSessionId || null,
      lastStartedAt: new Date().toISOString()
    };

    await this.saveAttemptState({ userId, requirement, attemptScope: scope, state: nextState });
    return nextState;
  }

  async recordAttemptResult({ userId, requirement = null, attemptScope = null, sessionId = null, status = null, livenessPassed = false } = {}) {
    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    const maxAttempts = this.getMaxAttemptsForScope(scope);
    const key = this.buildAttemptRedisKey({ userId, requirement, attemptScope: scope });
    if (!key || !sessionId) return null;

    const now = new Date().toISOString();
    const sessionIdHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    const result = await this.runRedisScript(
      ATTEMPT_RESULT_SCRIPT,
      key,
      [
        userId,
        requirement || 'LIVENESS_REQUIRED',
        scope,
        maxAttempts,
        this.estimatedUnitCostUsd,
        this.attemptWindowSeconds,
        sessionIdHash,
        sessionId,
        status || 'UNKNOWN',
        livenessPassed === true ? '1' : '0',
        now,
        this.softBlockOnAttemptsExhausted ? '1' : '0',
        PROCESSED_RESULT_LIMIT,
        Math.max(this.attemptWindowSeconds, this.sessionTtlSeconds)
      ],
      {
        code: 'KYC_AWS_LIVENESS_ATTEMPT_RESULT_FAILED',
        operation: 'record_attempt_result',
        userId
      }
    );

    if (!result?.state) return null;
    return {
      ...result.state,
      idempotentReplay: result.status === 'replay'
    };
  }

  async saveSessionMetadata(sessionId, metadata = {}) {
    try {
      const redis = redisPool.getConnection();
      const stored = await redis.set(
        this.buildSessionRedisKey(sessionId),
        JSON.stringify(metadata),
        'EX',
        this.sessionTtlSeconds
      );
      if (stored !== 'OK') {
        throw new Error('Redis nao confirmou persistencia da metadata AWS liveness');
      }
      return metadata;
    } catch (error) {
      logError(error, 'Falha ao persistir metadata de sessão AWS liveness', {
        service: 'aws-face-liveness-service',
        sessionId
      });
      if (error?.code === 'AWS_LIVENESS_SESSION_METADATA_PERSIST_FAILED') throw error;
      const persistError = new Error('Falha ao persistir binding da sessao AWS liveness');
      persistError.code = 'AWS_LIVENESS_SESSION_METADATA_PERSIST_FAILED';
      persistError.cause = error;
      throw persistError;
    }
  }

  async getSessionMetadata(sessionId) {
    try {
      const redis = redisPool.getConnection();
      const value = await redis.get(this.buildSessionRedisKey(sessionId));
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      logError(error, 'Falha ao ler metadata de sessão AWS liveness', {
        service: 'aws-face-liveness-service',
        sessionId
      });
      return null;
    }
  }

  assertBoundSessionMetadata(metadata, {
    userId,
    expectedChallengeId,
    expectedRequirement,
    allowAbandoned = false,
    allowExpired = false
  } = {}) {
    if (!metadata || typeof metadata !== 'object') {
      const error = new Error('Metadata canonica da sessao AWS nao encontrada ou expirada');
      error.code = 'AWS_LIVENESS_SESSION_METADATA_REQUIRED';
      throw error;
    }

    const safeUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!safeUserId || metadata.userId !== safeUserId) {
      const error = new Error('Sessao AWS nao pertence exatamente ao usuario informado');
      error.code = 'AWS_LIVENESS_SESSION_USER_MISMATCH';
      throw error;
    }
    if (metadata.provider !== PROVIDER_NAME) {
      const error = new Error('Provider da metadata AWS liveness invalido');
      error.code = 'AWS_LIVENESS_SESSION_PROVIDER_MISMATCH';
      throw error;
    }
    if (
      !allowAbandoned
      && (
        metadata.status === 'ABANDONED'
        || (
          typeof metadata.abandonedAt === 'string'
          && metadata.abandonedAt.trim()
        )
      )
    ) {
      const error = new Error('Sessao AWS liveness encerrada pelo usuario');
      error.code = 'AWS_LIVENESS_SESSION_ABANDONED';
      throw error;
    }

    const createdAtMs = typeof metadata.createdAt === 'string'
      ? Date.parse(metadata.createdAt)
      : Number.NaN;
    const expiresAtMs = typeof metadata.expiresAt === 'string'
      ? Date.parse(metadata.expiresAt)
      : Number.NaN;
    if (
      !Number.isFinite(createdAtMs)
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= createdAtMs
      || createdAtMs > Date.now()
    ) {
      const error = new Error('Janela temporal da metadata AWS liveness invalida');
      error.code = 'AWS_LIVENESS_SESSION_METADATA_INVALID';
      throw error;
    }
    if (!allowExpired && expiresAtMs <= Date.now()) {
      const error = new Error('Sessao AWS expirada para verificacao canonica');
      error.code = 'AWS_LIVENESS_SESSION_EXPIRED';
      throw error;
    }

    const attemptScope = typeof metadata.attemptScope === 'string'
      ? metadata.attemptScope.trim()
      : '';
    if (
      !attemptScope
      || metadata.attemptScope !== attemptScope
      || attemptScope !== this.normalizeAttemptScope(attemptScope)
    ) {
      const error = new Error('Escopo da metadata AWS liveness invalido');
      error.code = 'AWS_LIVENESS_SESSION_ATTEMPT_SCOPE_INVALID';
      throw error;
    }
    if (
      expectedChallengeId !== undefined
      && (metadata.challengeId || null) !== (expectedChallengeId || null)
    ) {
      const error = new Error('Challenge nao corresponde a sessao AWS');
      error.code = 'AWS_LIVENESS_SESSION_CHALLENGE_MISMATCH';
      throw error;
    }
    if (
      expectedRequirement !== undefined
      && (metadata.requirement || null) !== (expectedRequirement || null)
    ) {
      const error = new Error('Requirement nao corresponde a sessao AWS');
      error.code = 'AWS_LIVENESS_SESSION_REQUIREMENT_MISMATCH';
      throw error;
    }
    if (
      this.costGuard?.isEnabled?.()
      && (
        typeof metadata.costGuardOperationId !== 'string'
        || !metadata.costGuardOperationId.trim()
      )
    ) {
      const error = new Error('Sessao AWS sem binding do circuit breaker de custo');
      error.code = 'KYC_AWS_COST_OPERATION_NOT_FOUND';
      throw error;
    }
    return metadata;
  }

  async persistTerminalSessionMetadata(sessionId, {
    completedAt,
    status,
    confidence,
    livenessPassed,
    referenceImageAvailable = false,
    referenceImageFaceDetected = false,
    referenceImageByteLength = 0,
    referenceImageReadAttempts = 1,
    referenceImageArtifactStatus = 'unknown'
  }) {
    return this.runRedisScript(
      SESSION_COMPLETE_SCRIPT,
      this.buildSessionRedisKey(sessionId),
      [
        completedAt,
        status || 'UNKNOWN',
        Number(confidence || 0),
        livenessPassed === true ? '1' : '0',
        this.sessionTtlSeconds,
        referenceImageAvailable === true ? '1' : '0',
        referenceImageFaceDetected === true ? '1' : '0',
        Math.max(0, Number(referenceImageByteLength || 0)),
        Math.max(1, Number(referenceImageReadAttempts || 1)),
        String(referenceImageArtifactStatus || 'unknown')
      ],
      {
        code: 'AWS_LIVENESS_SESSION_METADATA_PERSIST_FAILED',
        operation: 'persist_terminal_session_metadata'
      }
    );
  }

  async persistAbandonedSessionMetadata(sessionId, {
    userId,
    providerStatus = 'UNKNOWN',
    abandonedAt = new Date().toISOString()
  } = {}) {
    try {
      const redis = redisPool.getConnection();
      if (!redis || typeof redis.eval !== 'function') {
        const unavailableError = new Error(
          'Redis atomico indisponivel para encerrar sessao AWS liveness'
        );
        unavailableError.code = 'KYC_AWS_LIVENESS_ABANDON_STORE_UNAVAILABLE';
        throw unavailableError;
      }
      const raw = await redis.eval(
        SESSION_ABANDON_SCRIPT,
        4,
        this.buildSessionRedisKey(sessionId),
        identityVerificationKey(userId),
        activeTripKey(userId),
        `driver:${userId}`,
        String(userId),
        PROVIDER_NAME,
        abandonedAt,
        String(providerStatus || 'UNKNOWN').toUpperCase(),
        String(this.sessionTtlSeconds)
      );
      const result = raw && typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
      if (result.status === 'missing') {
        const error = new Error('Metadata canonica da sessao AWS nao encontrada ou expirada');
        error.code = 'AWS_LIVENESS_SESSION_METADATA_REQUIRED';
        throw error;
      }
      if (result.status === 'invalid') {
        const error = new Error('Metadata canonica da sessao AWS invalida');
        error.code = 'AWS_LIVENESS_SESSION_METADATA_INVALID';
        throw error;
      }
      if (result.status === 'user_mismatch') {
        const error = new Error('Sessao AWS nao pertence exatamente ao usuario informado');
        error.code = 'AWS_LIVENESS_SESSION_USER_MISMATCH';
        throw error;
      }
      if (result.status === 'provider_mismatch') {
        const error = new Error('Provider da metadata AWS liveness invalido');
        error.code = 'AWS_LIVENESS_SESSION_PROVIDER_MISMATCH';
        throw error;
      }
      if (result.status === 'active_trip') {
        const error = new Error('Validacao de identidade adiada ate o fim da corrida ativa');
        error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
        error.activeTripId = result.activeTripId || null;
        throw error;
      }
      if (result.status === 'window_binding_missing') {
        const error = new Error('Sessao AWS sem token canonico da janela de verificacao');
        error.code = 'KYC_AWS_LIVENESS_ABANDON_WINDOW_BINDING_REQUIRED';
        throw error;
      }
      return result;
    } catch (error) {
      logError(error, 'Falha ao encerrar sessao AWS liveness de forma atomica', {
        service: 'aws-face-liveness-service',
        userId,
        sessionId
      });
      if (error?.code) throw error;
      const wrappedError = new Error('Falha ao encerrar sessao AWS liveness');
      wrappedError.code = 'KYC_AWS_LIVENESS_ABANDON_PERSIST_FAILED';
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  sanitizeSessionName(input) {
    return String(input || '')
      .replace(/[^a-zA-Z0-9+=,.@_-]/g, '-')
      .replace(/-{2,}/g, '-')
      .slice(0, 64);
  }

  buildSessionPolicyJson() {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['rekognition:StartFaceLivenessSession'],
          Resource: '*'
        }
      ]
    };
    return JSON.stringify(policy);
  }

  async getCachedCredentials(userId) {
    try {
      const redis = redisPool.getConnection();
      const raw = await redis.get(this.buildCredentialsRedisKey(userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.accessKeyId || !parsed?.secretAccessKey || !parsed?.sessionToken) {
        return null;
      }
      return parsed;
    } catch (error) {
      logError(error, 'Falha ao ler credenciais temporárias AWS em cache', {
        service: 'aws-face-liveness-service',
        userId
      });
      return null;
    }
  }

  async cacheCredentials(userId, credentials, ttlSeconds) {
    try {
      const redis = redisPool.getConnection();
      await redis.set(
        this.buildCredentialsRedisKey(userId),
        JSON.stringify(credentials),
        'EX',
        ttlSeconds
      );
    } catch (error) {
      logError(error, 'Falha ao salvar credenciais temporárias AWS em cache', {
        service: 'aws-face-liveness-service',
        userId
      });
    }
  }

  async issueTemporaryCredentials({ userId = null, sessionId = null } = {}) {
    this.assertCredentialsEnabled();

    if (!userId || !sessionId) {
      const error = new Error('Usuario e sessao AWS vinculada sao obrigatorios para credenciais');
      error.code = 'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED';
      throw error;
    }

    const sessionHash = crypto.createHash('sha256')
      .update(`${userId}:${sessionId}`)
      .digest('hex')
      .slice(0, 24);
    const cacheKeyUser = `${userId}:${sessionHash}`;
    const cached = await this.getCachedCredentials(cacheKeyUser);
    if (cached) {
      return {
        success: true,
        provider: PROVIDER_NAME,
        region: this.region,
        credentials: {
          accessKeyId: cached.accessKeyId,
          secretAccessKey: cached.secretAccessKey,
          sessionToken: cached.sessionToken,
          expiration: cached.expiration
        },
        source: 'cache'
      };
    }

    const roleSessionName = this.sanitizeSessionName(
      `${this.sessionNamePrefix}-${String(userId).slice(0, 16)}-${sessionHash}`
    );

    const input = {
      RoleArn: this.assumeRoleArn,
      RoleSessionName: roleSessionName,
      DurationSeconds: this.stsDurationSeconds,
      Policy: this.buildSessionPolicyJson()
    };
    if (this.assumeRoleExternalId) {
      input.ExternalId = this.assumeRoleExternalId;
    }

    const response = await this.stsClient.send(new AssumeRoleCommand(input));
    const credentials = response?.Credentials;

    if (!credentials?.AccessKeyId || !credentials?.SecretAccessKey || !credentials?.SessionToken) {
      const error = new Error('STS não retornou credenciais temporárias válidas');
      error.code = 'AWS_LIVENESS_STS_INVALID_RESPONSE';
      throw error;
    }

    const expirationDate = credentials.Expiration instanceof Date
      ? credentials.Expiration
      : new Date(credentials.Expiration || Date.now() + (this.stsDurationSeconds * 1000));
    const expirationIso = expirationDate.toISOString();
    const cacheTtlSeconds = Math.max(
      60,
      Math.min(
        this.stsDurationSeconds - 60,
        Math.floor((expirationDate.getTime() - Date.now()) / 1000) - 30
      )
    );

    const payload = {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
      expiration: expirationIso
    };
    await this.cacheCredentials(cacheKeyUser, payload, cacheTtlSeconds);

    logStructured('info', 'Credenciais temporárias AWS emitidas para liveness', {
      service: 'aws-face-liveness-service',
      userId,
      sessionHash
    });

    return {
      success: true,
      provider: PROVIDER_NAME,
      region: this.region,
      credentials: payload,
      source: 'sts_assume_role'
    };
  }

  async createSession({
    userId = null,
    challengeId = null,
    requirement = null,
    attemptScope = null,
    verificationWindowToken = null
  } = {}) {
    this.assertEnabled();
    if (typeof userId !== 'string' || !userId.trim()) {
      const error = new Error('userId e obrigatorio para criar sessao AWS liveness');
      error.code = 'KYC_AWS_LIVENESS_USER_REQUIRED';
      throw error;
    }
    userId = userId.trim();
    const strictProductionBiometrics = String(
      process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED || 'false'
    ).toLowerCase() === 'true';
    if (strictProductionBiometrics && this.outputBucket) {
      const error = new Error(
        'Output S3 nao e suportado no fluxo biometrico canonico; mantenha KYC_AWS_LIVENESS_S3_BUCKET vazio'
      );
      error.code = 'AWS_LIVENESS_S3_OUTPUT_UNSUPPORTED';
      throw error;
    }
    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    const attemptReservation = await this.reserveAttempt({
      userId,
      requirement,
      attemptScope: scope
    });

    const clientRequestToken = attemptReservation.token;
    let costGuardReservation = null;
    try {
      costGuardReservation = await this.costGuard.reserveLivenessBundle({
        userId,
        operationId: clientRequestToken,
        required: strictProductionBiometrics
      });
    } catch (error) {
      await this.rollbackAttemptReservation(attemptReservation).catch(() => null);
      throw error;
    }

    const input = {
      ClientRequestToken: clientRequestToken,
      Settings: {
        AuditImagesLimit: this.auditImagesLimit,
        ChallengePreferences: [{
          Type: this.challengeType
        }]
      }
    };

    if (this.outputBucket) {
      input.Settings.OutputConfig = {
        S3Bucket: this.outputBucket,
        S3KeyPrefix: this.outputPrefix
      };
    }

    const startedAt = Date.now();
    let response = null;
    let providerDispatched = false;
    try {
      if (costGuardReservation?.operationId) {
        await this.costGuard.markLivenessDispatched(costGuardReservation.operationId);
      }
      providerDispatched = true;
      response = await this.rekognitionClient.send(
        new CreateFaceLivenessSessionCommand(input)
      );
      if (!response?.SessionId) {
        const invalidResponseError = new Error('AWS não retornou SessionId para liveness');
        invalidResponseError.code = 'AWS_LIVENESS_SESSION_INVALID_RESPONSE';
        throw invalidResponseError;
      }
    } catch (error) {
      error.providerDispatched = providerDispatched;
      if (!providerDispatched) {
        await Promise.all([
          this.rollbackAttemptReservation(attemptReservation),
          costGuardReservation?.operationId
            ? this.costGuard.rollbackBeforeDispatch(costGuardReservation.operationId)
            : Promise.resolve(false)
        ]).catch((rollbackError) => {
          logError(rollbackError, 'Falha ao reverter reserva pre-dispatch AWS liveness', {
            service: 'aws-face-liveness-service',
            userId,
            attemptScope: scope
          });
        });
      } else {
        logError(error, 'Dispatch AWS liveness com resultado desconhecido; custo e tentativa preservados', {
          service: 'aws-face-liveness-service',
          userId,
          attemptScope: scope
        });
      }
      throw error;
    }
    const sessionId = response.SessionId;

    const metadata = {
      provider: PROVIDER_NAME,
      userId: userId || null,
      challengeId: challengeId || null,
      requirement: requirement || null,
      attemptScope: scope,
      verificationWindowToken: typeof verificationWindowToken === 'string' && verificationWindowToken.trim()
        ? verificationWindowToken.trim()
        : null,
      costGuardOperationId: costGuardReservation?.operationId || null,
      challengeType: this.challengeType,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(startedAt + (this.sessionTtlSeconds * 1000)).toISOString()
    };

    let attemptState = null;
    try {
      if (costGuardReservation?.operationId) {
        await this.costGuard.markLivenessCompleted(
          costGuardReservation.operationId,
          sessionId
        );
      }
      attemptState = await this.commitAttemptReservation(attemptReservation, sessionId);
      await this.saveSessionMetadata(sessionId, metadata);
    } catch (error) {
      error.providerDispatched = true;
      logError(error, 'Sessao AWS criada sem conclusao do binding local; tentativa paga preservada', {
        service: 'aws-face-liveness-service',
        userId,
        attemptScope: scope,
        sessionId
      });
      throw error;
    }

    logStructured('info', 'Sessão AWS Face Liveness criada', {
      service: 'aws-face-liveness-service',
      userId: userId || undefined,
      sessionId,
      attemptScope: scope,
      attempt: attemptState?.started || null,
      maxAttempts: attemptState?.maxAttempts || this.getMaxAttemptsForScope(scope),
      challengeType: this.challengeType,
      estimatedUnitCostUsd: this.estimatedUnitCostUsd
    });

    return {
      success: true,
      provider: PROVIDER_NAME,
      region: this.region,
      sessionId,
      attemptScope: scope,
      challengeType: this.challengeType,
      expiresAt: metadata.expiresAt,
      confidenceThreshold: this.confidenceThreshold,
      attempt: attemptState?.started || null,
      maxAttempts: attemptState?.maxAttempts || this.getMaxAttemptsForScope(scope),
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      status: 'CREATED'
    };
  }

  async getSessionResult({
    sessionId,
    userId = null,
    requireBoundMetadata = false,
    expectedChallengeId,
    expectedRequirement,
    includeReferenceImage = false,
    allowExpiredMetadata = false
  }) {
    this.assertEnabled();

    if (!sessionId || typeof sessionId !== 'string') {
      const error = new Error('sessionId é obrigatório');
      error.code = 'AWS_LIVENESS_SESSION_ID_REQUIRED';
      throw error;
    }

    if (includeReferenceImage && !requireBoundMetadata) {
      const error = new Error('ReferenceImage AWS exige metadata canônica vinculada');
      error.code = 'AWS_LIVENESS_REFERENCE_IMAGE_BINDING_REQUIRED';
      throw error;
    }

    const startedAt = Date.now();
    const metadata = await this.getSessionMetadata(sessionId);
    if (requireBoundMetadata) {
      this.assertBoundSessionMetadata(metadata, {
        userId,
        expectedChallengeId,
        expectedRequirement,
        allowExpired: allowExpiredMetadata
      });
    } else if (metadata?.userId && userId && metadata.userId !== userId) {
      const error = new Error('Sessão AWS não pertence ao usuário informado');
      error.code = 'AWS_LIVENESS_SESSION_USER_MISMATCH';
      throw error;
    }

    let response = null;
    let referenceImageReadAttempts = 0;
    const maxReads = includeReferenceImage ? this.referenceResultMaxReads : 1;
    for (let readAttempt = 1; readAttempt <= maxReads; readAttempt += 1) {
      response = await this.rekognitionClient.send(
        new GetFaceLivenessSessionResultsCommand({
          SessionId: sessionId
        })
      );
      referenceImageReadAttempts = readAttempt;
      const providerStatus = String(response?.Status || 'UNKNOWN').toUpperCase();
      const referenceBytes = response?.ReferenceImage?.Bytes;
      const referenceBuffer = referenceBytes ? Buffer.from(referenceBytes) : null;
      const referenceBounds = normalizeReferenceImageBoundingBox(
        response?.ReferenceImage?.BoundingBox
      );
      const shouldRetryReference = providerStatus === 'SUCCEEDED'
        && (!referenceBuffer?.length || !referenceBounds)
        && readAttempt < maxReads;
      if (!shouldRetryReference) break;
      if (this.referenceResultRetryDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, this.referenceResultRetryDelayMs * readAttempt);
        });
      }
    }

    const status = String(response?.Status || 'UNKNOWN').toUpperCase();
    const confidenceRaw = Number(response?.Confidence ?? 0);
    const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : 0;
    const confidenceNormalized = Math.max(0, Math.min(1, confidence / 100));
    const completed = status === 'SUCCEEDED' || status === 'FAILED' || status === 'EXPIRED';
    const livenessPassed = status === 'SUCCEEDED' && confidence >= this.confidenceThreshold;
    const processingTime = Date.now() - startedAt;

    const referenceImageBytes = response?.ReferenceImage?.Bytes;
    const referenceImageBuffer = referenceImageBytes
      ? Buffer.from(referenceImageBytes)
      : null;
    const referenceImageBoundingBox = normalizeReferenceImageBoundingBox(
      response?.ReferenceImage?.BoundingBox
    );
    const referenceImageArtifactStatus = referenceImageBuffer?.length
      ? (referenceImageBoundingBox ? 'complete' : 'bounds_missing')
      : 'image_missing';
    if (
      includeReferenceImage
      && (referenceImageReadAttempts > 1 || referenceImageArtifactStatus !== 'complete')
    ) {
      logStructured(
        referenceImageBuffer?.length ? 'info' : 'warn',
        'Resultado AWS liveness avaliado para comparacao canonica',
        {
          service: 'aws-face-liveness-service',
          sessionHash: crypto.createHash('sha256').update(sessionId).digest('hex'),
          status,
          referenceImageReadAttempts,
          referenceImageByteLength: referenceImageBuffer?.length || 0,
          referenceImageFaceDetected: Boolean(referenceImageBoundingBox),
          referenceImageArtifactStatus
        }
      );
    }
    const result = {
      success: true,
      provider: PROVIDER_NAME,
      sessionId,
      userId: metadata?.userId || userId || null,
      challengeId: metadata?.challengeId || null,
      requirement: metadata?.requirement || null,
      attemptScope: metadata?.attemptScope || null,
      status,
      completed,
      completedAt: metadata?.completedAt || null,
      confidence,
      confidenceNormalized,
      confidenceThreshold: this.confidenceThreshold,
      livenessPassed,
      referenceImageAvailable: Boolean(
        referenceImageBuffer?.length || response?.ReferenceImage?.S3Object
      ),
      referenceImageFaceDetected: Boolean(referenceImageBoundingBox),
      referenceImageArtifactStatus,
      referenceImageReadAttempts,
      auditImagesCount: Array.isArray(response?.AuditImages) ? response.AuditImages.length : 0,
      challenge: {
        version: response?.Challenge?.Versions?.Current || null,
        preference: response?.Challenge?.Preference || null,
        type: response?.Challenge?.Type || null
      },
      processingTime
    };

    if (includeReferenceImage) {
      result.referenceImageBuffer = referenceImageBuffer;
      result.referenceImageBoundingBox = referenceImageBoundingBox;
      result.sessionMetadata = metadata
        ? {
          userId: metadata.userId || null,
          challengeId: metadata.challengeId || null,
          requirement: metadata.requirement || null,
          attemptScope: metadata.attemptScope || null,
          costGuardOperationId: metadata.costGuardOperationId || null,
          createdAt: metadata.createdAt || null,
          expiresAt: metadata.expiresAt || null
        }
        : null;
    }

    if (completed) {
      const completedAtCandidate = metadata?.completedAt || new Date().toISOString();
      const attemptState = await this.recordAttemptResult({
        userId: metadata?.userId || userId,
        requirement: metadata?.requirement || null,
        attemptScope: metadata?.attemptScope || null,
        sessionId,
        status,
        livenessPassed
      });

      const terminalMetadata = await this.persistTerminalSessionMetadata(sessionId, {
        completedAt: completedAtCandidate,
        status,
        confidence,
        livenessPassed,
        referenceImageAvailable: Boolean(referenceImageBuffer?.length),
        referenceImageFaceDetected: Boolean(referenceImageBoundingBox),
        referenceImageByteLength: referenceImageBuffer?.length || 0,
        referenceImageReadAttempts,
        referenceImageArtifactStatus
      });
      result.completedAt = terminalMetadata?.completedAt || completedAtCandidate;
      if (result.sessionMetadata) {
        result.sessionMetadata.completedAt = result.completedAt;
      }

      result.attemptState = attemptState
        ? {
          started: attemptState.started,
          failed: attemptState.failed,
          passed: attemptState.passed,
          attemptScope: attemptState.attemptScope || metadata?.attemptScope || null,
          maxAttempts: attemptState.maxAttempts,
          attemptsExhausted: attemptState.attemptsExhausted === true,
          softBlocked: attemptState.softBlocked === true,
          exhaustedAt: attemptState.exhaustedAt || null,
          justExhausted: attemptState.justExhausted === true,
          idempotentReplay: attemptState.idempotentReplay === true,
          estimatedCostUsd: Number((Number(attemptState.started || 0) * this.estimatedUnitCostUsd).toFixed(6))
        }
        : null;
    }

    return result;
  }

  async abandonSession({ sessionId, userId } = {}) {
    this.assertEnabled();

    const safeSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const safeUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!safeSessionId) {
      const error = new Error('sessionId e obrigatorio');
      error.code = 'AWS_LIVENESS_SESSION_ID_REQUIRED';
      throw error;
    }
    if (!safeUserId) {
      const error = new Error('userId e obrigatorio');
      error.code = 'KYC_AWS_LIVENESS_USER_REQUIRED';
      throw error;
    }

    const metadata = await this.getSessionMetadata(safeSessionId);
    this.assertBoundSessionMetadata(metadata, {
      userId: safeUserId,
      allowAbandoned: true,
      allowExpired: true
    });
    if (
      metadata.status === 'ABANDONED'
      || (
        typeof metadata.abandonedAt === 'string'
        && metadata.abandonedAt.trim()
      )
    ) {
      return {
        success: true,
        abandoned: true,
        alreadyAbandoned: true,
        sessionId: safeSessionId,
        providerStatus: metadata.providerStatusAtAbandon || metadata.lastStatus || 'UNKNOWN'
      };
    }

    let providerResult;
    try {
      providerResult = await this.getSessionResult({
        sessionId: safeSessionId,
        userId: safeUserId,
        requireBoundMetadata: true,
        allowExpiredMetadata: true
      });
    } catch (error) {
      if (error?.code === 'AWS_LIVENESS_SESSION_ABANDONED') {
        const latestMetadata = await this.getSessionMetadata(safeSessionId);
        this.assertBoundSessionMetadata(latestMetadata, {
          userId: safeUserId,
          allowAbandoned: true,
          allowExpired: true
        });
        return {
          success: true,
          abandoned: true,
          alreadyAbandoned: true,
          sessionId: safeSessionId,
          providerStatus:
            latestMetadata.providerStatusAtAbandon
            || latestMetadata.lastStatus
            || 'UNKNOWN'
        };
      }
      throw error;
    }

    if (providerResult.completed === true && providerResult.livenessPassed === true) {
      const error = new Error(
        'A validacao de vivacidade foi concluida e precisa seguir para comparacao facial'
      );
      error.code = 'KYC_AWS_LIVENESS_RESUME_REQUIRED';
      error.result = {
        completed: true,
        livenessPassed: true,
        sessionId: safeSessionId
      };
      throw error;
    }

    const persisted = await this.persistAbandonedSessionMetadata(safeSessionId, {
      userId: safeUserId,
      providerStatus: providerResult.status
    });
    if (persisted.status === 'resume_required') {
      const error = new Error(
        'A validacao de vivacidade foi concluida e precisa seguir para comparacao facial'
      );
      error.code = 'KYC_AWS_LIVENESS_RESUME_REQUIRED';
      error.result = {
        completed: true,
        livenessPassed: true,
        sessionId: safeSessionId
      };
      throw error;
    }
    if (!['abandoned', 'already_abandoned'].includes(persisted.status)) {
      const error = new Error('Nao foi possivel encerrar a sessao AWS liveness');
      error.code = 'KYC_AWS_LIVENESS_ABANDON_PERSIST_FAILED';
      throw error;
    }

    logStructured('info', 'Sessao AWS Face Liveness encerrada pelo usuario', {
      service: 'aws-face-liveness-service',
      userId: safeUserId,
      sessionId: safeSessionId,
      providerStatus: providerResult.status,
      verificationWindowReleased: persisted.released === true,
      idempotent: persisted.status === 'already_abandoned'
    });

    return {
      success: true,
      abandoned: true,
      alreadyAbandoned: persisted.status === 'already_abandoned',
      sessionId: safeSessionId,
      providerStatus: providerResult.status,
      completed: providerResult.completed === true,
      livenessPassed: providerResult.livenessPassed === true
    };
  }

  toDevicePayload(livenessResult, basePayload = {}) {
    const normalizedThreshold = Math.max(0, Math.min(1, this.confidenceThreshold / 100));
    const confidenceNormalized = Number(
      livenessResult?.confidenceNormalized
      ?? basePayload?.confidence
      ?? 0
    );
    const confidence = Number.isFinite(confidenceNormalized)
      ? Math.max(0, Math.min(1, confidenceNormalized))
      : 0;

    const hasExplicitMatch = typeof basePayload?.isMatch === 'boolean';
    const isMatch = hasExplicitMatch
      ? basePayload.isMatch
      : livenessResult?.livenessPassed === true;

    return {
      ...basePayload,
      mode: PROVIDER_NAME,
      provider: PROVIDER_NAME,
      isMatch,
      similarityScore: Number.isFinite(Number(basePayload?.similarityScore))
        ? Number(basePayload.similarityScore)
        : confidence,
      confidence: Number.isFinite(Number(basePayload?.confidence))
        ? Number(basePayload.confidence)
        : confidence,
      threshold: Number.isFinite(Number(basePayload?.threshold))
        ? Number(basePayload.threshold)
        : normalizedThreshold,
      livenessPassed: livenessResult?.livenessPassed === true,
      awsLivenessPassed: livenessResult?.livenessPassed === true,
      aws: {
        provider: PROVIDER_NAME,
        sessionId: livenessResult?.sessionId || null,
        status: livenessResult?.status || 'UNKNOWN',
        confidence: livenessResult?.confidence || 0,
        confidenceThreshold: livenessResult?.confidenceThreshold || this.confidenceThreshold,
        passed: livenessResult?.livenessPassed === true,
        completed: livenessResult?.completed === true,
        referenceImageAvailable: livenessResult?.referenceImageAvailable === true,
        referenceImageFaceDetected: livenessResult?.referenceImageFaceDetected === true,
        referenceImageArtifactStatus: livenessResult?.referenceImageArtifactStatus || 'unknown'
      }
    };
  }
}

module.exports = AwsFaceLivenessService;
