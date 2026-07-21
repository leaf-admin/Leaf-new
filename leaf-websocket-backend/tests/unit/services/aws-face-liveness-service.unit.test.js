jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockEval = jest.fn();
const redisValues = new Map();

function readJsonValue(key, fallback = {}) {
  const raw = redisValues.get(key);
  return raw ? JSON.parse(raw) : fallback;
}

function writeJsonValue(key, value) {
  redisValues.set(key, JSON.stringify(value));
}

function executeMockEval(script, numberOfKeys, key, ...args) {
  if (script.includes('leaf_aws_liveness_attempt_recovery_grant_v1')) {
    const keys = [key, ...args.splice(0, numberOfKeys - 1)];
    const [attemptKey, sessionKey, activeTripKey] = keys;
    const [
      userId,
      provider,
      attemptScope,
      sessionId,
      sessionIdHash,
      grantId,
      grantedAt,
      providerRecoveryMaxCreditsRaw,
    ] = args;
    const state = readJsonValue(attemptKey, null);
    if (!state) return JSON.stringify({ status: 'attempt_state_missing' });
    const metadata = readJsonValue(sessionKey, null);
    if (!metadata) return JSON.stringify({ status: 'session_metadata_missing' });
    if (
      metadata.userId !== userId
      || metadata.provider !== provider
      || metadata.lastStatus !== 'SUCCEEDED'
      || metadata.livenessPassed !== true
      || metadata.abandonedAt
    ) {
      return JSON.stringify({ status: 'session_not_eligible' });
    }
    if (
      state.userId !== userId
      || state.attemptScope !== attemptScope
      || state.lastSessionId !== sessionId
    ) {
      return JSON.stringify({ status: 'attempt_binding_mismatch' });
    }
    const processedMatch = (state.processedResults || []).some((item) => (
      item.sessionIdHash === sessionIdHash
      && item.status === 'SUCCEEDED'
      && item.passed === true
    ));
    if (!processedMatch) return JSON.stringify({ status: 'result_not_eligible' });
    const total = Number(state.recoveryAllowanceTotal || 0);
    const remaining = Number(state.recoveryAllowanceRemaining || 0);
    const consumed = Number(state.recoveryAllowanceConsumed || 0);
    const existingGrantId = String(state.recoveryAllowanceGrantId || '').trim();
    const grantIds = Array.isArray(state.recoveryAllowanceGrantIds)
      ? [...state.recoveryAllowanceGrantIds]
      : (total === 1 && existingGrantId ? [existingGrantId] : []);
    if (grantIds.includes(grantId)) {
      if (total < 1 || grantIds.length !== total || remaining + consumed !== total) {
        return JSON.stringify({ status: 'grant_replay_invalid' });
      }
      return JSON.stringify({ status: 'replay', state });
    }
    const providerRecoveryMaxCredits = Number(providerRecoveryMaxCreditsRaw || 0);
    const existingStateValid = total === 0
      ? remaining === 0 && consumed === 0 && !existingGrantId && grantIds.length === 0
      : total <= providerRecoveryMaxCredits
        && grantIds.length === total
        && Boolean(existingGrantId)
        && remaining + consumed === total;
    if (!existingStateValid) return JSON.stringify({ status: 'grant_replay_invalid' });
    if (total >= providerRecoveryMaxCredits) {
      return JSON.stringify({ status: 'recovery_limit_reached', state });
    }
    const maxAttempts = Number(state.maxAttempts || 0);
    const started = Number(state.started || 0);
    if (
      maxAttempts <= 0
      || Number(state.failed || 0) >= maxAttempts
      || state.softBlocked === true
      || Number(state.passed || 0) <= 0
      || (state.attemptReservations || []).length > 0
    ) {
      return JSON.stringify({ status: 'attempt_not_eligible', state });
    }
    if (started < maxAttempts) return JSON.stringify({ status: 'not_required', state });
    if (redisValues.has(activeTripKey)) return JSON.stringify({ status: 'active_trip' });

    grantIds.push(grantId);
    state.recoveryAllowanceTotal = total + 1;
    state.recoveryAllowanceRemaining = remaining + 1;
    state.recoveryAllowanceConsumed = consumed;
    state.recoveryAllowanceGrantId = grantId;
    state.recoveryAllowanceGrantIds = grantIds;
    state.recoveryAllowanceGrantedAt = grantedAt;
    state.recoveryAllowanceReason = 'provider_reference_image_incomplete';
    state.recoveryAllowanceSessionIdHash = sessionIdHash;
    state.providerRecoveryMaxCredits = providerRecoveryMaxCredits;
    state.effectiveMax = maxAttempts + state.recoveryAllowanceTotal;
    writeJsonValue(attemptKey, state);
    return JSON.stringify({ status: 'applied', state });
  }

  if (script.includes('leaf_aws_liveness_attempt_reserve_v1')) {
    const state = readJsonValue(key);
    const maxAttempts = Number(args[3]);
    const reservations = Array.isArray(state.attemptReservations)
      ? state.attemptReservations
      : [];
    if (reservations.some((reservation) => reservation.token === args[7])) {
      return JSON.stringify({ status: 'reserved', state });
    }
    const nowEpochMs = Number(args[9]);
    const retryDelayMs = Number(args[10]) * 1000;
    const retryWindowMs = Number(args[11]) * 1000;
    let reservationsChanged = false;
    for (const reservation of reservations) {
      if (reservation.status !== 'reserved') continue;
      const createdAtEpochMs = Number(reservation.createdAtEpochMs);
      if (!Number.isFinite(createdAtEpochMs)) {
        return JSON.stringify({ status: 'in_flight', state });
      }
      const ageMs = Math.max(0, nowEpochMs - createdAtEpochMs);
      if (ageMs < retryDelayMs) {
        return JSON.stringify({ status: 'in_flight', state });
      }
      if (ageMs <= retryWindowMs) {
        return JSON.stringify({ status: 'resume', token: reservation.token, state });
      }
      reservation.status = 'dispatch_unknown_expired';
      reservation.resolvedAt = args[6];
      reservationsChanged = true;
    }
    const started = Number(state.started || 0);
    const recoveryAllowanceTotal = Math.max(
      0,
      Math.floor(Number(state.recoveryAllowanceTotal || 0))
    );
    let recoveryAllowanceRemaining = Math.max(
      0,
      Math.floor(Number(state.recoveryAllowanceRemaining || 0))
    );
    let recoveryAllowanceConsumed = Math.max(
      0,
      Math.floor(Number(state.recoveryAllowanceConsumed || 0))
    );
    const recoveryAllowanceGrantId = typeof state.recoveryAllowanceGrantId === 'string'
      ? state.recoveryAllowanceGrantId
      : '';
    const providerRecoveryMaxCredits = Number(args[12] || 0);
    const recoveryAllowanceValid = recoveryAllowanceTotal >= 1
      && recoveryAllowanceTotal <= providerRecoveryMaxCredits
      && recoveryAllowanceGrantId.trim().length > 0
      && recoveryAllowanceRemaining + recoveryAllowanceConsumed === recoveryAllowanceTotal;
    const usesRecoveryAllowance = started >= maxAttempts;
    if (
      state.softBlocked === true
      || Number(state.failed || 0) >= maxAttempts
      || (
        usesRecoveryAllowance
        && (
          !recoveryAllowanceValid
          || recoveryAllowanceRemaining <= 0
          || started >= maxAttempts + recoveryAllowanceTotal
        )
      )
    ) {
      if (reservationsChanged) writeJsonValue(key, state);
      return JSON.stringify({ status: 'exhausted', state });
    }
    if (usesRecoveryAllowance) {
      recoveryAllowanceRemaining -= 1;
      recoveryAllowanceConsumed += 1;
    }
    state.userId = args[0];
    state.requirement = args[1];
    state.attemptScope = args[2];
    state.started = started + 1;
    state.failed = Number(state.failed || 0);
    state.passed = Number(state.passed || 0);
    state.maxAttempts = maxAttempts;
    state.estimatedUnitCostUsd = Number(args[4]);
    state.windowSeconds = Number(args[5]);
    state.attemptsExhausted = false;
    state.lastStartedAt = args[6];
    state.recoveryAllowanceTotal = recoveryAllowanceTotal;
    state.recoveryAllowanceRemaining = recoveryAllowanceRemaining;
    state.recoveryAllowanceConsumed = recoveryAllowanceConsumed;
    state.effectiveMax = maxAttempts + (recoveryAllowanceValid ? recoveryAllowanceTotal : 0);
    reservations.push({
      token: args[7],
      status: 'reserved',
      createdAt: args[6],
      createdAtEpochMs: nowEpochMs,
      usedRecoveryAllowance: usesRecoveryAllowance,
      recoveryAllowanceGrantId: usesRecoveryAllowance ? recoveryAllowanceGrantId : null
    });
    state.attemptReservations = reservations.slice(-Number(args[8]));
    writeJsonValue(key, state);
    return JSON.stringify({ status: 'reserved', state });
  }

  if (script.includes('leaf_aws_liveness_attempt_commit_v1')) {
    const state = readJsonValue(key, null);
    if (!state) return JSON.stringify({ status: 'missing' });
    const reservation = (state.attemptReservations || [])
      .find((item) => item.token === args[0]);
    if (!reservation) return JSON.stringify({ status: 'missing', state });
    reservation.status = 'committed';
    reservation.sessionId = args[1];
    reservation.committedAt = args[2];
    state.lastSessionId = args[1];
    writeJsonValue(key, state);
    return JSON.stringify({ status: 'committed', state });
  }

  if (script.includes('leaf_aws_liveness_attempt_rollback_v1')) {
    const state = readJsonValue(key, null);
    if (!state) return JSON.stringify({ status: 'missing' });
    const index = (state.attemptReservations || [])
      .findIndex((item) => item.token === args[0]);
    if (index < 0) return JSON.stringify({ status: 'missing', state });
    if (state.attemptReservations[index].status !== 'reserved') {
      return JSON.stringify({ status: 'committed', state });
    }
    const [reservation] = state.attemptReservations.splice(index, 1);
    state.started = Math.max(0, Number(state.started || 0) - 1);
    const maxAttempts = Math.max(0, Number(state.maxAttempts || 0));
    const recoveryAllowanceTotal = Math.max(
      0,
      Math.floor(Number(state.recoveryAllowanceTotal || 0))
    );
    let recoveryAllowanceRemaining = Math.max(
      0,
      Math.floor(Number(state.recoveryAllowanceRemaining || 0))
    );
    let recoveryAllowanceConsumed = Math.max(
      0,
      Math.floor(Number(state.recoveryAllowanceConsumed || 0))
    );
    const recoveryAllowanceGrantId = typeof state.recoveryAllowanceGrantId === 'string'
      ? state.recoveryAllowanceGrantId
      : '';
    const recoveryAllowanceValid = recoveryAllowanceTotal >= 1
      && recoveryAllowanceTotal <= Number(args[2] || 0)
      && recoveryAllowanceGrantId.trim().length > 0
      && recoveryAllowanceRemaining + recoveryAllowanceConsumed === recoveryAllowanceTotal;
    const canRestoreRecoveryAllowance = reservation.usedRecoveryAllowance === true
      && recoveryAllowanceValid
      && reservation.recoveryAllowanceGrantId === recoveryAllowanceGrantId
      && recoveryAllowanceConsumed > 0;
    if (canRestoreRecoveryAllowance) {
      recoveryAllowanceRemaining += 1;
      recoveryAllowanceConsumed -= 1;
    }
    state.recoveryAllowanceTotal = recoveryAllowanceTotal;
    state.recoveryAllowanceRemaining = recoveryAllowanceRemaining;
    state.recoveryAllowanceConsumed = recoveryAllowanceConsumed;
    state.effectiveMax = maxAttempts + (recoveryAllowanceValid ? recoveryAllowanceTotal : 0);
    writeJsonValue(key, state);
    return JSON.stringify({ status: 'rolled_back', state });
  }

  if (script.includes('leaf_aws_liveness_attempt_result_v1')) {
    const state = readJsonValue(key);
    const processed = Array.isArray(state.processedResults) ? state.processedResults : [];
    if (processed.some((item) => item.sessionIdHash === args[6])) {
      return JSON.stringify({
        status: 'replay',
        state: { ...state, justExhausted: false, idempotentReplay: true }
      });
    }
    const passed = args[9] === '1';
    state.userId = args[0];
    state.requirement = args[1];
    state.attemptScope = args[2];
    state.passed = Number(state.passed || 0) + (passed ? 1 : 0);
    state.failed = Number(state.failed || 0) + (passed ? 0 : 1);
    state.lastSessionId = args[7];
    state.lastStatus = args[8];
    state.lastCompletedAt = args[10];
    state.maxAttempts = Number(args[3]);
    state.estimatedUnitCostUsd = Number(args[4]);
    state.windowSeconds = Number(args[5]);
    state.idempotentReplay = false;
    state.attemptReservations = (state.attemptReservations || [])
      .filter((item) => item.sessionId !== args[7]);
    if (passed) {
      state.failed = 0;
      state.attemptsExhausted = false;
      state.softBlocked = false;
      state.exhaustedAt = null;
      state.justExhausted = false;
    } else if (state.softBlocked === true) {
      state.attemptsExhausted = true;
      state.justExhausted = false;
    } else if (state.failed >= Number(args[3])) {
      state.attemptsExhausted = true;
      state.softBlocked = args[11] === '1';
      state.exhaustedAt = args[10];
      state.justExhausted = true;
    } else {
      state.justExhausted = false;
    }
    processed.push({
      sessionIdHash: args[6],
      status: args[8],
      passed,
      processedAt: args[10]
    });
    state.processedResults = processed.slice(-Number(args[12]));
    writeJsonValue(key, state);
    return JSON.stringify({ status: 'recorded', state });
  }

  if (script.includes('leaf_aws_liveness_session_complete_v1')) {
    const metadata = readJsonValue(key, null);
    if (!metadata) throw new Error('AWS_LIVENESS_SESSION_METADATA_REQUIRED');
    metadata.completedAt = metadata.completedAt || args[0];
    metadata.lastStatus = args[1];
    metadata.confidence = Number(args[2]);
    metadata.livenessPassed = args[3] === '1';
    metadata.referenceImageAvailable = args[5] === '1';
    metadata.referenceImageFaceDetected = args[6] === '1';
    metadata.referenceImageByteLength = Number(args[7]);
    metadata.referenceImageReadAttempts = Number(args[8]);
    metadata.referenceImageArtifactStatus = args[9];
    writeJsonValue(key, metadata);
    return JSON.stringify(metadata);
  }

  if (script.includes('leaf_aws_liveness_session_abandon_v1')) {
    const windowKey = args[0];
    const activeTripKey = args[1];
    const userId = args[3];
    const provider = args[4];
    const abandonedAt = args[5];
    const providerStatus = args[6];
    const metadata = readJsonValue(key, null);
    if (!metadata) return JSON.stringify({ status: 'missing' });
    if (metadata.userId !== userId) return JSON.stringify({ status: 'user_mismatch' });
    if (metadata.provider !== provider) return JSON.stringify({ status: 'provider_mismatch' });
    if (redisValues.has(activeTripKey)) {
      return JSON.stringify({
        status: 'active_trip',
        activeTripId: redisValues.get(activeTripKey)
      });
    }
    const windowToken = metadata.verificationWindowToken;
    if (metadata.abandonedAt) {
      const released = redisValues.get(windowKey) === windowToken;
      if (released) redisValues.delete(windowKey);
      return JSON.stringify({
        status: 'already_abandoned',
        released,
        metadata
      });
    }
    if (metadata.livenessPassed === true) {
      return JSON.stringify({ status: 'resume_required', metadata });
    }
    if (!windowToken) return JSON.stringify({ status: 'window_binding_missing' });
    metadata.abandonedAt = abandonedAt;
    metadata.status = 'ABANDONED';
    metadata.providerStatusAtAbandon = providerStatus;
    metadata.abandonReason = 'client_cancelled';
    writeJsonValue(key, metadata);
    const released = redisValues.get(windowKey) === windowToken;
    if (released) redisValues.delete(windowKey);
    return JSON.stringify({ status: 'abandoned', released, metadata });
  }

  throw new Error('Unexpected Redis script');
}

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    get: mockGet,
    set: mockSet,
    eval: mockEval
  }))
}));

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: jest.fn(() => ({
    send: mockSend
  })),
  CreateFaceLivenessSessionCommand: jest.fn((input) => ({ input })),
  GetFaceLivenessSessionResultsCommand: jest.fn((input) => ({ input }))
}));

describe('aws-face-liveness-service', () => {
  let AwsFaceLivenessService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    redisValues.clear();
    mockGet.mockImplementation(async (key) => redisValues.get(key) || null);
    mockSet.mockImplementation(async (key, value) => {
      redisValues.set(key, value);
      return 'OK';
    });
    mockEval.mockImplementation(executeMockEval);

    process.env.KYC_AWS_LIVENESS_ENABLED = 'true';
    process.env.AWS_REGION = 'us-east-1';
    process.env.KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD = '0.015';

    AwsFaceLivenessService = require('../../../services/aws-face-liveness-service');
  });

  afterEach(() => {
    delete process.env.KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD;
    delete process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW;
    delete process.env.KYC_AWS_LIVENESS_WITHDRAWAL_MAX_ATTEMPTS_PER_WINDOW;
    delete process.env.KYC_AWS_LIVENESS_SESSION_TTL_SECONDS;
    delete process.env.KYC_AWS_LIVENESS_ATTEMPT_WINDOW_SECONDS;
    delete process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_DELAY_SECONDS;
    delete process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_WINDOW_SECONDS;
    delete process.env.KYC_AWS_LIVENESS_REFERENCE_RESULT_MAX_READS;
    delete process.env.KYC_AWS_LIVENESS_REFERENCE_RESULT_RETRY_DELAY_MS;
    delete process.env.KYC_AWS_LIVENESS_PROVIDER_RECOVERY_MAX_CREDITS;
    delete process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED;
    delete process.env.KYC_AWS_LIVENESS_S3_BUCKET;
    delete process.env.KYC_AWS_LIVENESS_CHALLENGE_TYPE;
  });

  test('should use the movement-only challenge by default', async () => {
    mockSend.mockResolvedValueOnce({ SessionId: 'session-movement-default' });

    const service = new AwsFaceLivenessService();
    const result = await service.createSession({
      userId: 'driver-movement-default'
    });

    expect(mockSend.mock.calls[0][0].input.Settings.ChallengePreferences).toEqual([
      { Type: 'FaceMovementChallenge' }
    ]);
    expect(result.challengeType).toBe('FaceMovementChallenge');
    expect(service.getConfigSummary().challengeType).toBe('FaceMovementChallenge');
    expect(readJsonValue(
      'kyc:aws:liveness:session:session-movement-default'
    )).toMatchObject({
      challengeType: 'FaceMovementChallenge'
    });
  });

  test('should allow an explicit movement-and-light challenge override', async () => {
    process.env.KYC_AWS_LIVENESS_CHALLENGE_TYPE = 'FaceMovementAndLightChallenge';
    mockSend.mockResolvedValueOnce({ SessionId: 'session-movement-light' });

    const service = new AwsFaceLivenessService();
    const result = await service.createSession({
      userId: 'driver-movement-light'
    });

    expect(mockSend.mock.calls[0][0].input.Settings.ChallengePreferences).toEqual([
      { Type: 'FaceMovementAndLightChallenge' }
    ]);
    expect(result.challengeType).toBe('FaceMovementAndLightChallenge');
    expect(service.getConfigSummary().challengeType).toBe('FaceMovementAndLightChallenge');
  });

  test('should fail closed when the configured challenge type is invalid', () => {
    process.env.KYC_AWS_LIVENESS_CHALLENGE_TYPE = 'UnsupportedChallenge';

    expect(() => new AwsFaceLivenessService()).toThrow(
      expect.objectContaining({
        code: 'KYC_AWS_LIVENESS_CHALLENGE_TYPE_INVALID'
      })
    );
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockEval).not.toHaveBeenCalled();
  });

  test('should create liveness session and persist metadata', async () => {
    mockSend.mockResolvedValueOnce({ SessionId: 'session-123' });

    const service = new AwsFaceLivenessService();
    const result = await service.createSession({
      userId: 'driver-1',
      verificationWindowToken: 'verification-window-token-123'
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('session-123');
    expect(result).not.toHaveProperty('verificationWindowToken');
    expect(readJsonValue('kyc:aws:liveness:session:session-123')).toEqual(
      expect.objectContaining({
        userId: 'driver-1',
        verificationWindowToken: 'verification-window-token-123'
      })
    );
    expect(mockSet).toHaveBeenCalled();
  });

  test('should reject a provider session without a bound user before any paid call', async () => {
    const service = new AwsFaceLivenessService();

    await expect(service.createSession({ attemptScope: 'driver_online' }))
      .rejects.toMatchObject({
        code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
      });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockEval).not.toHaveBeenCalled();
  });

  test('should reject S3 output in strict biometrics before reserving or calling AWS', async () => {
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_S3_BUCKET = 'leaf-liveness-output';
    const service = new AwsFaceLivenessService();

    await expect(service.createSession({ userId: 'driver-s3-blocked' }))
      .rejects.toMatchObject({
        code: 'AWS_LIVENESS_S3_OUTPUT_UNSUPPORTED'
      });
    expect(mockEval).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should fail before AWS when the aggregate cost guard rejects the bundle', async () => {
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    const budgetError = Object.assign(new Error('budget exhausted'), {
      code: 'KYC_AWS_COST_BUDGET_EXHAUSTED'
    });
    const costGuard = {
      isEnabled: jest.fn(() => true),
      getConfigSummary: jest.fn(() => ({ enabled: true })),
      reserveLivenessBundle: jest.fn(async () => { throw budgetError; }),
      rollbackBeforeDispatch: jest.fn()
    };
    const service = new AwsFaceLivenessService({ costGuard });

    await expect(service.createSession({ userId: 'driver-budget-blocked' }))
      .rejects.toMatchObject({ code: 'KYC_AWS_COST_BUDGET_EXHAUSTED' });
    expect(costGuard.reserveLivenessBundle).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'driver-budget-blocked',
      required: true
    }));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockEval.mock.calls.some(([script]) => (
      script.includes('leaf_aws_liveness_attempt_rollback_v1')
    ))).toBe(true);
  });

  test('should bind one aggregate budget operation to the AWS client token and session metadata', async () => {
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    mockSend.mockResolvedValueOnce({ SessionId: 'session-cost-bound' });
    const costGuard = {
      isEnabled: jest.fn(() => true),
      getConfigSummary: jest.fn(() => ({ enabled: true })),
      reserveLivenessBundle: jest.fn(async ({ operationId }) => ({ operationId })),
      markLivenessDispatched: jest.fn(async () => ({})),
      markLivenessCompleted: jest.fn(async () => ({})),
      rollbackBeforeDispatch: jest.fn(async () => false)
    };
    const service = new AwsFaceLivenessService({ costGuard });

    const result = await service.createSession({ userId: 'driver-cost-bound' });
    const reservedOperationId = costGuard.reserveLivenessBundle.mock.calls[0][0].operationId;

    expect(result.sessionId).toBe('session-cost-bound');
    expect(mockSend.mock.calls[0][0].input.ClientRequestToken).toBe(reservedOperationId);
    expect(costGuard.markLivenessDispatched).toHaveBeenCalledWith(reservedOperationId);
    expect(costGuard.markLivenessCompleted).toHaveBeenCalledWith(
      reservedOperationId,
      'session-cost-bound'
    );
    expect(readJsonValue('kyc:aws:liveness:session:session-cost-bound')).toMatchObject({
      costGuardOperationId: reservedOperationId
    });
  });

  test('should preserve paid attempt when canonical metadata cannot be persisted after SessionId', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '1';
    mockSend.mockResolvedValueOnce({ SessionId: 'session-without-binding' });
    mockSet.mockRejectedValueOnce(new Error('redis unavailable'));

    const service = new AwsFaceLivenessService();

    await expect(service.createSession({ userId: 'driver-binding-failure' }))
      .rejects.toMatchObject({
        code: 'AWS_LIVENESS_SESSION_METADATA_PERSIST_FAILED',
        providerDispatched: true
      });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(readJsonValue(
      'kyc:aws:liveness:attempts:driver-binding-failure:general'
    )).toEqual(expect.objectContaining({
      started: 1,
      attemptReservations: [expect.objectContaining({
        status: 'committed',
        sessionId: 'session-without-binding'
      })]
    }));
    await expect(service.createSession({ userId: 'driver-binding-failure' }))
      .rejects.toMatchObject({
        code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED'
      });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockEval.mock.calls.some(([script]) => (
      script.includes('leaf_aws_liveness_attempt_rollback_v1')
    ))).toBe(false);
  });

  test('should preserve reserved paid attempt and fail closed when commit fails after SessionId', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '1';
    mockSend.mockResolvedValueOnce({ SessionId: 'session-without-commit' });
    mockEval.mockImplementation((script, ...args) => {
      if (script.includes('leaf_aws_liveness_attempt_commit_v1')) {
        throw new Error('redis commit unavailable');
      }
      return executeMockEval(script, ...args);
    });

    const service = new AwsFaceLivenessService();
    await expect(service.createSession({ userId: 'driver-commit-failure' }))
      .rejects.toMatchObject({
        code: 'KYC_AWS_LIVENESS_ATTEMPT_COMMIT_FAILED'
      });

    expect(readJsonValue(
      'kyc:aws:liveness:attempts:driver-commit-failure:general'
    )).toEqual(expect.objectContaining({
      started: 1,
      attemptReservations: [expect.objectContaining({
        status: 'reserved'
      })]
    }));
    await expect(service.createSession({ userId: 'driver-commit-failure' }))
      .rejects.toMatchObject({
        code: 'KYC_AWS_LIVENESS_DISPATCH_OUTCOME_UNKNOWN'
      });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockEval.mock.calls.some(([script]) => (
      script.includes('leaf_aws_liveness_attempt_rollback_v1')
    ))).toBe(false);
  });

  test('should atomically reserve the attempt budget before creating a provider session', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '1';
    mockSend.mockResolvedValueOnce({ SessionId: 'single-provider-session' });

    const service = new AwsFaceLivenessService();
    const results = await Promise.allSettled([
      service.createSession({ userId: 'driver-concurrent', attemptScope: 'driver_online' }),
      service.createSession({ userId: 'driver-concurrent', attemptScope: 'driver_online' })
    ]);

    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(results.find((item) => item.status === 'rejected').reason).toMatchObject({
      code: 'KYC_AWS_LIVENESS_DISPATCH_OUTCOME_UNKNOWN'
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('should replay the same reservation token after the final slot is reserved', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '1';
    const randomUuidSpy = jest
      .spyOn(require('crypto'), 'randomUUID')
      .mockReturnValue('stable-reservation-token');

    try {
      const service = new AwsFaceLivenessService();
      const first = await service.reserveAttempt({
        userId: 'driver-reservation-replay',
        attemptScope: 'driver_online'
      });
      const replay = await service.reserveAttempt({
        userId: 'driver-reservation-replay',
        attemptScope: 'driver_online'
      });

      expect(replay.token).toBe(first.token);
      expect(replay.state).toEqual(expect.objectContaining({ started: 1 }));
      expect(replay.state.attemptReservations).toHaveLength(1);
    } finally {
      randomUuidSpy.mockRestore();
    }
  });

  test('should grant one idempotent recovery credit for each eligible incomplete reference image', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '2';
    const userId = 'driver-reference-recovery';
    const sessionId = 'reference-session-success';
    const sessionIdHash = require('crypto')
      .createHash('sha256')
      .update(sessionId)
      .digest('hex');
    const attemptKey = `kyc:aws:liveness:attempts:${userId}:first_access`;
    const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
    const processedResults = [{
      sessionIdHash,
      status: 'SUCCEEDED',
      passed: true,
      processedAt: '2026-07-17T03:19:52.908Z'
    }];
    writeJsonValue(attemptKey, {
      userId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 2,
      failed: 0,
      passed: 2,
      maxAttempts: 2,
      lastSessionId: sessionId,
      lastStatus: 'SUCCEEDED',
      processedResults,
      attemptReservations: []
    });
    writeJsonValue(sessionKey, {
      userId,
      provider: 'aws_rekognition_face_liveness',
      lastStatus: 'SUCCEEDED',
      livenessPassed: true
    });

    const service = new AwsFaceLivenessService();
    const applied = await service.grantReferenceImageRecoveryAttempt({
      userId,
      sessionId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access'
    });
    const replay = await service.grantReferenceImageRecoveryAttempt({
      userId,
      sessionId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access'
    });

    expect(applied).toEqual(expect.objectContaining({
      status: 'applied',
      granted: true,
      idempotentReplay: false,
      canRetry: true,
      attemptState: expect.objectContaining({
        started: 2,
        passed: 2,
        failed: 0,
        maxAttempts: 2,
        effectiveMax: 3,
        recoveryAllowanceRemaining: 1,
        attemptsExhausted: false
      })
    }));
    expect(replay).toEqual(expect.objectContaining({
      status: 'replay',
      granted: true,
      idempotentReplay: true,
      canRetry: true
    }));
    expect(readJsonValue(attemptKey)).toEqual(expect.objectContaining({
      started: 2,
      passed: 2,
      failed: 0,
      effectiveMax: 3,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 0,
      recoveryAllowanceGrantIds: [expect.any(String)],
      recoveryAllowanceReason: 'provider_reference_image_incomplete',
      recoveryAllowanceSessionIdHash: sessionIdHash,
      processedResults
    }));
  });

  test('should add a second bounded provider credit without erasing paid attempts or hard-fail state', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '2';
    process.env.KYC_AWS_LIVENESS_PROVIDER_RECOVERY_MAX_CREDITS = '3';
    const userId = 'driver-reference-recovery-second';
    const sessionId = 'reference-session-success-second';
    const sessionIdHash = require('crypto')
      .createHash('sha256')
      .update(sessionId)
      .digest('hex');
    const previousGrantId = 'previous-provider-recovery-grant';
    const attemptKey = `kyc:aws:liveness:attempts:${userId}:first_access`;
    writeJsonValue(attemptKey, {
      userId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 3,
      failed: 0,
      passed: 3,
      maxAttempts: 2,
      lastSessionId: sessionId,
      lastStatus: 'SUCCEEDED',
      processedResults: [{
        sessionIdHash,
        status: 'SUCCEEDED',
        passed: true,
      }],
      attemptReservations: [],
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 0,
      recoveryAllowanceConsumed: 1,
      recoveryAllowanceGrantId: previousGrantId,
      recoveryAllowanceGrantIds: [previousGrantId],
    });
    writeJsonValue(`kyc:aws:liveness:session:${sessionId}`, {
      userId,
      provider: 'aws_rekognition_face_liveness',
      lastStatus: 'SUCCEEDED',
      livenessPassed: true,
    });

    const service = new AwsFaceLivenessService();
    const applied = await service.grantReferenceImageRecoveryAttempt({
      userId,
      sessionId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
    });
    const replay = await service.grantReferenceImageRecoveryAttempt({
      userId,
      sessionId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
    });

    expect(applied).toEqual(expect.objectContaining({
      status: 'applied',
      canRetry: true,
      attemptState: expect.objectContaining({
        started: 3,
        passed: 3,
        failed: 0,
        effectiveMax: 4,
        recoveryAllowanceRemaining: 1,
      }),
    }));
    expect(replay).toEqual(expect.objectContaining({
      status: 'replay',
      idempotentReplay: true,
      canRetry: true,
    }));
    expect(readJsonValue(attemptKey)).toEqual(expect.objectContaining({
      started: 3,
      passed: 3,
      failed: 0,
      recoveryAllowanceTotal: 2,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 1,
      recoveryAllowanceGrantIds: [previousGrantId, expect.any(String)],
      effectiveMax: 4,
    }));
  });

  test('should not grant reference-image recovery while the driver has an active trip', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '2';
    const userId = 'driver-reference-active-trip';
    const sessionId = 'reference-session-active-trip';
    const sessionIdHash = require('crypto')
      .createHash('sha256')
      .update(sessionId)
      .digest('hex');
    writeJsonValue(`kyc:aws:liveness:attempts:${userId}:first_access`, {
      userId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      started: 2,
      failed: 0,
      passed: 2,
      maxAttempts: 2,
      lastSessionId: sessionId,
      processedResults: [{
        sessionIdHash,
        status: 'SUCCEEDED',
        passed: true
      }],
      attemptReservations: []
    });
    writeJsonValue(`kyc:aws:liveness:session:${sessionId}`, {
      userId,
      provider: 'aws_rekognition_face_liveness',
      lastStatus: 'SUCCEEDED',
      livenessPassed: true
    });
    redisValues.set(`active_trip_by_driver:${userId}`, 'trip-active');

    const service = new AwsFaceLivenessService();
    await expect(service.grantReferenceImageRecoveryAttempt({
      userId,
      sessionId,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access'
    })).rejects.toMatchObject({
      code: 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP'
    });
    expect(readJsonValue(`kyc:aws:liveness:attempts:${userId}:first_access`))
      .not.toHaveProperty('recoveryAllowanceGrantId');
  });

  test('should consume one pregranted recovery credit only above the normal max and block the fourth attempt', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '2';
    const attemptKey = 'kyc:aws:liveness:attempts:driver-recovery:driver_online';
    const processedHistory = [{
      sessionIdHash: 'previous-session-hash',
      status: 'SUCCEEDED',
      passed: true,
      processedAt: '2026-07-15T05:00:00.000Z'
    }];
    writeJsonValue(attemptKey, {
      userId: 'driver-recovery',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      started: 1,
      failed: 0,
      passed: 1,
      maxAttempts: 2,
      processedResults: processedHistory,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 0,
      recoveryAllowanceGrantId: 'internal-recovery-grant-1'
    });
    mockSend
      .mockResolvedValueOnce({ SessionId: 'normal-session-2' })
      .mockResolvedValueOnce({ SessionId: 'recovery-session-3' });

    const service = new AwsFaceLivenessService();
    await service.createSession({
      userId: 'driver-recovery',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    });
    const afterNormalAttempt = readJsonValue(attemptKey);
    expect(afterNormalAttempt).toEqual(expect.objectContaining({
      started: 2,
      passed: 1,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 0,
      recoveryAllowanceGrantId: 'internal-recovery-grant-1',
      effectiveMax: 3
    }));
    expect(afterNormalAttempt.processedResults).toEqual(processedHistory);

    await service.createSession({
      userId: 'driver-recovery',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    });
    const afterRecoveryAttempt = readJsonValue(attemptKey);
    expect(afterRecoveryAttempt).toEqual(expect.objectContaining({
      started: 3,
      passed: 1,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 0,
      recoveryAllowanceConsumed: 1,
      recoveryAllowanceGrantId: 'internal-recovery-grant-1',
      effectiveMax: 3
    }));
    expect(afterRecoveryAttempt.processedResults).toEqual(processedHistory);
    expect(afterRecoveryAttempt.attemptReservations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'recovery-session-3',
        status: 'committed',
        usedRecoveryAllowance: true,
        recoveryAllowanceGrantId: 'internal-recovery-grant-1'
      })
    ]));

    const exposedState = await service.getAttemptState({
      userId: 'driver-recovery',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    });
    expect(exposedState).toEqual(expect.objectContaining({
      started: 3,
      passed: 1,
      maxAttempts: 2,
      effectiveMax: 3,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 0,
      recoveryAllowanceConsumed: 1,
      recoveryAllowanceGrantId: 'internal-recovery-grant-1',
      recoveryAllowanceValid: true,
      estimatedCostUsd: 0.045
    }));

    await expect(service.createSession({
      userId: 'driver-recovery',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    })).rejects.toMatchObject({
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      attemptState: expect.objectContaining({
        started: 3,
        effectiveMax: 3,
        recoveryAllowanceRemaining: 0,
        recoveryAllowanceConsumed: 1,
        estimatedCostUsd: 0.045
      })
    });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('should restore the same recovery credit when createSession rolls back before provider dispatch', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '2';
    const attemptKey = 'kyc:aws:liveness:attempts:driver-recovery-rollback:driver_online';
    const processedHistory = [{
      sessionIdHash: 'successful-session-hash',
      status: 'SUCCEEDED',
      passed: true,
      processedAt: '2026-07-15T05:00:00.000Z'
    }];
    writeJsonValue(attemptKey, {
      userId: 'driver-recovery-rollback',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      started: 2,
      failed: 0,
      passed: 2,
      maxAttempts: 2,
      processedResults: processedHistory,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 0,
      recoveryAllowanceGrantId: 'internal-recovery-grant-rollback'
    });
    const preDispatchError = new Error('cost guard pre-dispatch unavailable');
    const costGuard = {
      getConfigSummary: jest.fn(() => ({ enabled: true })),
      reserveLivenessBundle: jest.fn(async ({ operationId }) => ({ operationId })),
      markLivenessDispatched: jest.fn(async () => { throw preDispatchError; }),
      rollbackBeforeDispatch: jest.fn(async () => true)
    };

    const service = new AwsFaceLivenessService({ costGuard });
    await expect(service.createSession({
      userId: 'driver-recovery-rollback',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    })).rejects.toThrow('cost guard pre-dispatch unavailable');

    const afterRollback = readJsonValue(attemptKey);
    expect(afterRollback).toEqual(expect.objectContaining({
      started: 2,
      passed: 2,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 0,
      recoveryAllowanceGrantId: 'internal-recovery-grant-rollback',
      effectiveMax: 3,
      attemptReservations: []
    }));
    expect(afterRollback.processedResults).toEqual(processedHistory);
    expect(costGuard.rollbackBeforeDispatch).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();

    const exposedState = await service.getAttemptState({
      userId: 'driver-recovery-rollback',
      attemptScope: 'driver_online'
    });
    expect(exposedState).toEqual(expect.objectContaining({
      started: 2,
      passed: 2,
      effectiveMax: 3,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 0,
      estimatedCostUsd: 0.03
    }));
  });

  test('should replay a recovery reservation without consuming its grant twice', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '2';
    const attemptKey = 'kyc:aws:liveness:attempts:driver-recovery-replay:driver_online';
    writeJsonValue(attemptKey, {
      userId: 'driver-recovery-replay',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      started: 2,
      failed: 0,
      passed: 2,
      maxAttempts: 2,
      recoveryAllowanceTotal: 1,
      recoveryAllowanceRemaining: 1,
      recoveryAllowanceConsumed: 0,
      recoveryAllowanceGrantId: 'internal-recovery-grant-replay'
    });
    const randomUuidSpy = jest
      .spyOn(require('crypto'), 'randomUUID')
      .mockReturnValueOnce('stable-recovery-reservation-token')
      .mockReturnValueOnce('stable-recovery-reservation-token')
      .mockReturnValueOnce('fourth-attempt-token');

    try {
      const service = new AwsFaceLivenessService();
      const first = await service.reserveAttempt({
        userId: 'driver-recovery-replay',
        attemptScope: 'driver_online'
      });
      const replay = await service.reserveAttempt({
        userId: 'driver-recovery-replay',
        attemptScope: 'driver_online'
      });

      expect(replay.token).toBe(first.token);
      expect(replay.state).toEqual(expect.objectContaining({
        started: 3,
        effectiveMax: 3,
        recoveryAllowanceTotal: 1,
        recoveryAllowanceRemaining: 0,
        recoveryAllowanceConsumed: 1
      }));
      expect(replay.state.attemptReservations).toEqual([
        expect.objectContaining({
          token: 'stable-recovery-reservation-token',
          usedRecoveryAllowance: true,
          recoveryAllowanceGrantId: 'internal-recovery-grant-replay'
        })
      ]);

      await service.commitAttemptReservation(first, 'recovery-replay-session');
      await expect(service.reserveAttempt({
        userId: 'driver-recovery-replay',
        attemptScope: 'driver_online'
      })).rejects.toMatchObject({
        code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED'
      });
      const storedState = readJsonValue(attemptKey);
      expect(storedState).toEqual(expect.objectContaining({
        started: 3,
        recoveryAllowanceRemaining: 0,
        recoveryAllowanceConsumed: 1
      }));
      expect(storedState.attemptReservations).toHaveLength(1);
    } finally {
      randomUuidSpy.mockRestore();
    }
  });

  test('should recover an ambiguous provider dispatch with the same idempotent token', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '1';
    process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_DELAY_SECONDS = '0';
    mockSend
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ SessionId: 'session-idempotent-recovery' });

    const service = new AwsFaceLivenessService();
    await expect(service.createSession({
      userId: 'driver-rollback',
      attemptScope: 'driver_online'
    })).rejects.toMatchObject({
      message: 'provider unavailable',
      providerDispatched: true
    });

    const originalToken = readJsonValue(
      'kyc:aws:liveness:attempts:driver-rollback:driver_online'
    ).attemptReservations[0].token;
    const recovered = await service.createSession({
      userId: 'driver-rollback',
      attemptScope: 'driver_online'
    });
    const attemptState = readJsonValue(
      'kyc:aws:liveness:attempts:driver-rollback:driver_online'
    );

    expect(recovered.sessionId).toBe('session-idempotent-recovery');
    expect(mockSend.mock.calls[0][0].input.ClientRequestToken).toBe(originalToken);
    expect(mockSend.mock.calls[1][0].input.ClientRequestToken).toBe(originalToken);
    expect(attemptState.started).toBe(1);
    expect(attemptState.attemptReservations).toHaveLength(1);
    expect(attemptState.attemptReservations[0]).toEqual(expect.objectContaining({
      status: 'committed',
      sessionId: 'session-idempotent-recovery'
    }));
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('should consume an expired ambiguous dispatch and open the next attempt slot', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '2';
    process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_DELAY_SECONDS = '0';
    process.env.KYC_AWS_LIVENESS_IDEMPOTENT_RETRY_WINDOW_SECONDS = '30';
    mockSend
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({ SessionId: 'session-second-slot' });

    const service = new AwsFaceLivenessService();
    await expect(service.createSession({
      userId: 'driver-expired-dispatch',
      attemptScope: 'driver_online'
    })).rejects.toThrow('provider timeout');

    const key = 'kyc:aws:liveness:attempts:driver-expired-dispatch:driver_online';
    const state = readJsonValue(key);
    const firstToken = state.attemptReservations[0].token;
    state.attemptReservations[0].createdAtEpochMs = Date.now() - 31_000;
    writeJsonValue(key, state);

    const recovered = await service.createSession({
      userId: 'driver-expired-dispatch',
      attemptScope: 'driver_online'
    });
    const finalState = readJsonValue(key);

    expect(recovered.sessionId).toBe('session-second-slot');
    expect(finalState.started).toBe(2);
    expect(finalState.attemptReservations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        token: firstToken,
        status: 'dispatch_unknown_expired'
      }),
      expect.objectContaining({
        status: 'committed',
        sessionId: 'session-second-slot'
      })
    ]));
    expect(mockSend.mock.calls[1][0].input.ClientRequestToken).not.toBe(firstToken);
  });

  test('should keep successful sessions inside the paid budget without soft-blocking identity', async () => {
    process.env.KYC_AWS_LIVENESS_MAX_ATTEMPTS_PER_WINDOW = '1';
    writeJsonValue('kyc:aws:liveness:attempts:driver-success-budget:driver_online', {
      userId: 'driver-success-budget',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      started: 1,
      failed: 0,
      passed: 0,
      softBlocked: false,
      attemptReservations: [{
        token: 'token-success',
        status: 'committed',
        sessionId: 'session-success-budget'
      }]
    });

    const service = new AwsFaceLivenessService();
    const result = await service.recordAttemptResult({
      userId: 'driver-success-budget',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      sessionId: 'session-success-budget',
      status: 'SUCCEEDED',
      livenessPassed: true
    });

    expect(result).toEqual(expect.objectContaining({
      started: 1,
      failed: 0,
      passed: 1,
      softBlocked: false
    }));
    await expect(service.createSession({
      userId: 'driver-success-budget',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    })).rejects.toMatchObject({
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      attemptState: expect.objectContaining({ softBlocked: false })
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should retain processed-result idempotency for at least the attempt window', async () => {
    process.env.KYC_AWS_LIVENESS_ATTEMPT_WINDOW_SECONDS = '300';
    process.env.KYC_AWS_LIVENESS_SESSION_TTL_SECONDS = '165';

    const service = new AwsFaceLivenessService();
    const result = await service.recordAttemptResult({
      userId: 'driver-result-ttl',
      attemptScope: 'driver_online',
      sessionId: 'session-result-ttl',
      status: 'FAILED',
      livenessPassed: false
    });
    const resultEvalCall = mockEval.mock.calls.find(([script]) => (
      script.includes('leaf_aws_liveness_attempt_result_v1')
    ));

    expect(result.windowSeconds).toBe(300);
    expect(resultEvalCall.at(-1)).toBe('300');
  });

  test.each([
    ['IN_PROGRESS', false],
    ['FAILED', true],
    ['EXPIRED', true]
  ])(
    'should abandon a bound %s provider session and release only its metadata token',
    async (providerStatus, completed) => {
      const sessionId = `session-abandon-${providerStatus.toLowerCase()}`;
      const userId = `driver-abandon-${providerStatus.toLowerCase()}`;
      const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
      const windowKey = `kyc:identity-verification-window:${userId}`;
      writeJsonValue(sessionKey, {
        provider: 'aws_rekognition_face_liveness',
        userId,
        challengeId: 'challenge-abandon',
        requirement: 'LIVENESS_REQUIRED',
        attemptScope: 'driver_online',
        verificationWindowToken: 'window-token-abandon',
        costGuardOperationId: 'cost-operation-abandon',
        estimatedUnitCostUsd: 0.015,
        attempt: 2,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
      redisValues.set(windowKey, 'window-token-abandon');
      mockSend.mockResolvedValueOnce({
        Status: providerStatus,
        Confidence: providerStatus === 'IN_PROGRESS' ? undefined : 20
      });

      const service = new AwsFaceLivenessService();
      const result = await service.abandonSession({ sessionId, userId });
      const stored = readJsonValue(sessionKey);

      expect(result).toEqual(expect.objectContaining({
        success: true,
        abandoned: true,
        sessionId,
        providerStatus,
        completed,
        livenessPassed: false
      }));
      expect(stored).toEqual(expect.objectContaining({
        status: 'ABANDONED',
        providerStatusAtAbandon: providerStatus,
        abandonReason: 'client_cancelled',
        abandonedAt: expect.any(String),
        verificationWindowToken: 'window-token-abandon',
        costGuardOperationId: 'cost-operation-abandon',
        estimatedUnitCostUsd: 0.015,
        attempt: 2
      }));
      expect(redisValues.has(windowKey)).toBe(false);
      expect(mockEval.mock.calls.some(([script]) => (
        script.includes('leaf_aws_liveness_attempt_rollback_v1')
      ))).toBe(false);
    }
  );

  test('should make abandonment idempotent without consulting AWS again', async () => {
    const sessionId = 'session-abandon-idempotent';
    const userId = 'driver-abandon-idempotent';
    const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
    const windowKey = `kyc:identity-verification-window:${userId}`;
    writeJsonValue(sessionKey, {
      provider: 'aws_rekognition_face_liveness',
      userId,
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      verificationWindowToken: 'window-token-idempotent',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    redisValues.set(windowKey, 'window-token-idempotent');
    mockSend.mockResolvedValueOnce({ Status: 'IN_PROGRESS' });

    const service = new AwsFaceLivenessService();
    const first = await service.abandonSession({ sessionId, userId });
    const second = await service.abandonSession({ sessionId, userId });

    expect(first.alreadyAbandoned).toBe(false);
    expect(second).toEqual(expect.objectContaining({
      success: true,
      abandoned: true,
      alreadyAbandoned: true,
      sessionId
    }));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('should not release a newer verification window owned by another token', async () => {
    const sessionId = 'session-abandon-window-mismatch';
    const userId = 'driver-abandon-window-mismatch';
    const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
    const windowKey = `kyc:identity-verification-window:${userId}`;
    writeJsonValue(sessionKey, {
      provider: 'aws_rekognition_face_liveness',
      userId,
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      verificationWindowToken: 'old-window-token',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    redisValues.set(windowKey, 'new-window-token');
    mockSend.mockResolvedValueOnce({ Status: 'IN_PROGRESS' });

    const service = new AwsFaceLivenessService();
    const result = await service.abandonSession({ sessionId, userId });

    expect(result.abandoned).toBe(true);
    expect(readJsonValue(sessionKey)).toEqual(expect.objectContaining({
      status: 'ABANDONED',
      verificationWindowToken: 'old-window-token'
    }));
    expect(redisValues.get(windowKey)).toBe('new-window-token');
  });

  test('should fail closed if a trip starts after the provider lookup and before abandonment', async () => {
    const sessionId = 'session-abandon-active-trip-race';
    const userId = 'driver-abandon-active-trip-race';
    const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
    const windowKey = `kyc:identity-verification-window:${userId}`;
    const tripKey = `active_trip_by_driver:${userId}`;
    writeJsonValue(sessionKey, {
      provider: 'aws_rekognition_face_liveness',
      userId,
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      verificationWindowToken: 'window-token-active-trip-race',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    redisValues.set(windowKey, 'window-token-active-trip-race');
    mockSend.mockImplementationOnce(async () => {
      redisValues.set(tripKey, 'trip-started-during-provider-call');
      return { Status: 'IN_PROGRESS' };
    });

    const service = new AwsFaceLivenessService();
    await expect(service.abandonSession({ sessionId, userId })).rejects.toMatchObject({
      code: 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
      activeTripId: 'trip-started-during-provider-call'
    });

    expect(readJsonValue(sessionKey)).not.toHaveProperty('abandonedAt');
    expect(redisValues.get(windowKey)).toBe('window-token-active-trip-race');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('should require face compare resume when AWS liveness already passed', async () => {
    const sessionId = 'session-abandon-passed';
    const userId = 'driver-abandon-passed';
    const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
    const windowKey = `kyc:identity-verification-window:${userId}`;
    writeJsonValue(sessionKey, {
      provider: 'aws_rekognition_face_liveness',
      userId,
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      verificationWindowToken: 'window-token-passed',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    redisValues.set(windowKey, 'window-token-passed');
    mockSend.mockResolvedValueOnce({
      Status: 'SUCCEEDED',
      Confidence: 99
    });

    const service = new AwsFaceLivenessService();
    await expect(service.abandonSession({ sessionId, userId })).rejects.toMatchObject({
      code: 'KYC_AWS_LIVENESS_RESUME_REQUIRED',
      result: {
        completed: true,
        livenessPassed: true,
        sessionId
      }
    });

    expect(readJsonValue(sessionKey)).not.toHaveProperty('abandonedAt');
    expect(redisValues.get(windowKey)).toBe('window-token-passed');
    expect(mockEval.mock.calls.some(([script]) => (
      script.includes('leaf_aws_liveness_session_abandon_v1')
    ))).toBe(false);
  });

  test('should fail closed and keep the window when AWS result lookup is transiently unavailable', async () => {
    const sessionId = 'session-abandon-provider-error';
    const userId = 'driver-abandon-provider-error';
    const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
    const windowKey = `kyc:identity-verification-window:${userId}`;
    writeJsonValue(sessionKey, {
      provider: 'aws_rekognition_face_liveness',
      userId,
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      verificationWindowToken: 'window-token-provider-error',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    redisValues.set(windowKey, 'window-token-provider-error');
    const providerError = new Error('AWS temporariamente indisponivel');
    providerError.name = 'ServiceUnavailableException';
    mockSend.mockRejectedValueOnce(providerError);

    const service = new AwsFaceLivenessService();
    await expect(service.abandonSession({ sessionId, userId }))
      .rejects.toBe(providerError);

    expect(readJsonValue(sessionKey)).not.toHaveProperty('abandonedAt');
    expect(redisValues.get(windowKey)).toBe('window-token-provider-error');
    expect(mockEval.mock.calls.some(([script]) => (
      script.includes('leaf_aws_liveness_session_abandon_v1')
    ))).toBe(false);
  });

  test('should reject provider polling for an abandoned bound session', async () => {
    writeJsonValue('kyc:aws:liveness:session:session-abandoned', {
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-abandoned',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      verificationWindowToken: 'window-token-abandoned',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'ABANDONED',
      abandonedAt: new Date().toISOString()
    });

    const service = new AwsFaceLivenessService();
    await expect(service.getSessionResult({
      sessionId: 'session-abandoned',
      userId: 'driver-abandoned',
      requireBoundMetadata: true
    })).rejects.toMatchObject({
      code: 'AWS_LIVENESS_SESSION_ABANDONED'
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should parse result and set liveness pass based on threshold', async () => {
    writeJsonValue('kyc:aws:liveness:session:session-abc', {
      userId: 'driver-2'
    });
    mockSend.mockResolvedValueOnce({
      Status: 'SUCCEEDED',
      Confidence: 97.3,
      ReferenceImage: {
        Bytes: Uint8Array.from([1, 2, 3]),
        BoundingBox: { Width: 0.4, Height: 0.5, Left: 0.3, Top: 0.2 }
      },
      AuditImages: [{}, {}]
    });

    const service = new AwsFaceLivenessService();
    const result = await service.getSessionResult({
      sessionId: 'session-abc',
      userId: 'driver-2'
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.livenessPassed).toBe(true);
    expect(result.auditImagesCount).toBe(2);
    expect(result.referenceImageAvailable).toBe(true);
    expect(result.referenceImageFaceDetected).toBe(true);
    expect(result).not.toHaveProperty('referenceImageBuffer');
  });

  test('should expose AWS reference bytes only for a bound internal verification', async () => {
    writeJsonValue('kyc:aws:liveness:session:session-bound', {
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-bound',
      challengeId: 'challenge-bound',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      verificationWindowToken: 'server-only-window-token',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    mockSend.mockResolvedValueOnce({
      Status: 'SUCCEEDED',
      Confidence: 99,
      ReferenceImage: {
        Bytes: Uint8Array.from([4, 5, 6]),
        BoundingBox: { Width: 0.3, Height: 0.4, Left: -0.05, Top: 0.1 }
      }
    });

    const service = new AwsFaceLivenessService();
    const result = await service.getSessionResult({
      sessionId: 'session-bound',
      userId: 'driver-bound',
      requireBoundMetadata: true,
      expectedChallengeId: 'challenge-bound',
      expectedRequirement: 'LIVENESS_REQUIRED',
      includeReferenceImage: true
    });

    expect(result.referenceImageBuffer).toEqual(Buffer.from([4, 5, 6]));
    expect(result.referenceImageBoundingBox).toEqual({
      width: 0.25,
      height: 0.4,
      left: 0,
      top: 0.1
    });
    expect(result.sessionMetadata).toEqual(
      expect.objectContaining({
        userId: 'driver-bound',
        challengeId: 'challenge-bound',
        requirement: 'LIVENESS_REQUIRED'
      })
    );
    expect(result).not.toHaveProperty('verificationWindowToken');
    expect(result.sessionMetadata).not.toHaveProperty('verificationWindowToken');
  });

  test('should re-read the same successful session until reference bytes and provider bounds are ready', async () => {
    process.env.KYC_AWS_LIVENESS_REFERENCE_RESULT_MAX_READS = '3';
    process.env.KYC_AWS_LIVENESS_REFERENCE_RESULT_RETRY_DELAY_MS = '0';
    const sessionId = 'session-reference-eventual-consistency';
    const sessionKey = `kyc:aws:liveness:session:${sessionId}`;
    writeJsonValue(sessionKey, {
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-reference-eventual-consistency',
      challengeId: null,
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'first_access',
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    mockSend
      .mockResolvedValueOnce({ Status: 'SUCCEEDED', Confidence: 98 })
      .mockResolvedValueOnce({
        Status: 'SUCCEEDED',
        Confidence: 98,
        ReferenceImage: { Bytes: Uint8Array.from([7, 8, 9]) },
      })
      .mockResolvedValueOnce({
        Status: 'SUCCEEDED',
        Confidence: 98,
        ReferenceImage: {
          Bytes: Uint8Array.from([7, 8, 9]),
          BoundingBox: { Width: 0.4, Height: 0.5, Left: 0.2, Top: 0.1 },
        },
      });

    const service = new AwsFaceLivenessService();
    const result = await service.getSessionResult({
      sessionId,
      userId: 'driver-reference-eventual-consistency',
      requireBoundMetadata: true,
      includeReferenceImage: true,
    });

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(result).toEqual(expect.objectContaining({
      livenessPassed: true,
      referenceImageBuffer: Buffer.from([7, 8, 9]),
      referenceImageReadAttempts: 3,
      referenceImageArtifactStatus: 'complete',
    }));
    expect(result.referenceImageBoundingBox).toEqual(expect.objectContaining({
      height: 0.5,
      left: 0.2,
      top: 0.1,
    }));
    expect(result.referenceImageBoundingBox.width).toBeCloseTo(0.4, 10);
    expect(readJsonValue(sessionKey)).toEqual(expect.objectContaining({
      referenceImageAvailable: true,
      referenceImageFaceDetected: true,
      referenceImageByteLength: 3,
      referenceImageReadAttempts: 3,
      referenceImageArtifactStatus: 'complete',
    }));
  });

  test('should reject reference image access without canonical bound metadata', async () => {
    const service = new AwsFaceLivenessService();

    await expect(service.getSessionResult({
      sessionId: 'session-reference-unbound',
      userId: 'driver-reference-unbound',
      includeReferenceImage: true
    })).rejects.toMatchObject({
      code: 'AWS_LIVENESS_REFERENCE_IMAGE_BINDING_REQUIRED'
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test.each([
    ['userId', { userId: null }, 'AWS_LIVENESS_SESSION_USER_MISMATCH'],
    ['provider', { provider: 'client_declared' }, 'AWS_LIVENESS_SESSION_PROVIDER_MISMATCH'],
    ['createdAt', { createdAt: null }, 'AWS_LIVENESS_SESSION_METADATA_INVALID'],
    ['expiresAt', { expiresAt: 'invalid' }, 'AWS_LIVENESS_SESSION_METADATA_INVALID'],
    ['attemptScope', { attemptScope: 'Driver Online' }, 'AWS_LIVENESS_SESSION_ATTEMPT_SCOPE_INVALID']
  ])('should reject canonical metadata with invalid %s binding', async (_field, override, code) => {
    writeJsonValue('kyc:aws:liveness:session:session-invalid-binding', {
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-strict',
      challengeId: 'challenge-strict',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...override
    });

    const service = new AwsFaceLivenessService();
    await expect(service.getSessionResult({
      sessionId: 'session-invalid-binding',
      userId: 'driver-strict',
      requireBoundMetadata: true,
      expectedChallengeId: 'challenge-strict',
      expectedRequirement: 'LIVENESS_REQUIRED'
    })).rejects.toMatchObject({ code });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should reject canonical verification without server-side session metadata', async () => {
    mockGet.mockResolvedValueOnce(null);
    const service = new AwsFaceLivenessService();

    await expect(service.getSessionResult({
      sessionId: 'session-unbound',
      userId: 'driver-unbound',
      requireBoundMetadata: true,
      includeReferenceImage: true
    })).rejects.toMatchObject({
      code: 'AWS_LIVENESS_SESSION_METADATA_REQUIRED'
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should expose configurable estimated unit cost in config summary', () => {
    const service = new AwsFaceLivenessService();

    expect(service.getConfigSummary()).toEqual(
      expect.objectContaining({
        estimatedUnitCostUsd: 0.015,
        maxAttemptsPerWindow: 2,
        withdrawalMaxAttemptsPerWindow: 2,
        attemptWindowSeconds: 86400,
        sdkMaxAttempts: 2
      })
    );
  });

  test('should isolate liveness attempt budgets by backend attempt scope', () => {
    process.env.KYC_AWS_LIVENESS_WITHDRAWAL_MAX_ATTEMPTS_PER_WINDOW = '3';
    const service = new AwsFaceLivenessService();

    expect(service.buildAttemptRedisKey({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online'
    })).toBe('kyc:aws:liveness:attempts:driver-1:driver_online');
    expect(service.buildAttemptRedisKey({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'withdrawal'
    })).toBe('kyc:aws:liveness:attempts:driver-1:withdrawal');
    expect(service.getMaxAttemptsForScope('driver_online')).toBe(2);
    expect(service.getMaxAttemptsForScope('withdrawal')).toBe(3);
  });

  test('should allow withdrawal liveness when driver-online budget is exhausted', async () => {
    writeJsonValue('kyc:aws:liveness:attempts:driver-1:driver_online', {
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      started: 2,
      failed: 2,
      softBlocked: true
    });
    mockSend.mockResolvedValueOnce({ SessionId: 'withdrawal-session-1' });

    const service = new AwsFaceLivenessService();
    const result = await service.createSession({
      userId: 'driver-1',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'withdrawal'
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('withdrawal-session-1');
    expect(result.attemptScope).toBe('withdrawal');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('should block new liveness session when attempt budget is exhausted', async () => {
    writeJsonValue('kyc:aws:liveness:attempts:driver-exhausted:LIVENESS_REQUIRED'.toLowerCase(), {
      userId: 'driver-exhausted',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'liveness_required',
      started: 2,
      failed: 2,
      softBlocked: true,
      exhaustedAt: '2026-05-28T00:00:00.000Z'
    });

    const service = new AwsFaceLivenessService();

    await expect(
      service.createSession({ userId: 'driver-exhausted', requirement: 'LIVENESS_REQUIRED' })
    ).rejects.toMatchObject({
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED'
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should mark failed liveness result as soft-blocked on final attempt', async () => {
    writeJsonValue('kyc:aws:liveness:session:session-final', {
      userId: 'driver-final',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'liveness_required'
    });
    writeJsonValue('kyc:aws:liveness:attempts:driver-final:liveness_required', {
      userId: 'driver-final',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'liveness_required',
      started: 2,
      failed: 1,
      softBlocked: false
    });
    mockSend.mockResolvedValueOnce({
      Status: 'FAILED',
      Confidence: 20
    });

    const service = new AwsFaceLivenessService();
    const result = await service.getSessionResult({
      sessionId: 'session-final',
      userId: 'driver-final'
    });

    expect(result.completed).toBe(true);
    expect(result.livenessPassed).toBe(false);
    expect(result.attemptState).toEqual(
      expect.objectContaining({
        failed: 2,
        softBlocked: true,
        justExhausted: true,
        maxAttempts: 2
      })
    );
  });

  test('should process a terminal session once and keep completedAt stable across polls', async () => {
    writeJsonValue('kyc:aws:liveness:session:session-terminal-replay', {
      provider: 'aws_rekognition_face_liveness',
      userId: 'driver-terminal-replay',
      challengeId: 'challenge-terminal-replay',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    writeJsonValue('kyc:aws:liveness:attempts:driver-terminal-replay:driver_online', {
      userId: 'driver-terminal-replay',
      requirement: 'LIVENESS_REQUIRED',
      attemptScope: 'driver_online',
      started: 2,
      failed: 1,
      softBlocked: false
    });
    mockSend
      .mockResolvedValueOnce({ Status: 'FAILED', Confidence: 20 })
      .mockResolvedValueOnce({ Status: 'FAILED', Confidence: 20 });

    const service = new AwsFaceLivenessService();
    const input = {
      sessionId: 'session-terminal-replay',
      userId: 'driver-terminal-replay',
      requireBoundMetadata: true,
      expectedChallengeId: 'challenge-terminal-replay',
      expectedRequirement: 'LIVENESS_REQUIRED'
    };
    const first = await service.getSessionResult(input);
    const second = await service.getSessionResult(input);

    expect(first.completedAt).toEqual(expect.any(String));
    expect(second.completedAt).toBe(first.completedAt);
    expect(first.attemptState).toEqual(expect.objectContaining({
      failed: 2,
      justExhausted: true,
      idempotentReplay: false
    }));
    expect(second.attemptState).toEqual(expect.objectContaining({
      failed: 2,
      justExhausted: false,
      idempotentReplay: true
    }));
  });
});
