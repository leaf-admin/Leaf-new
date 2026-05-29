const crypto = require('crypto');
const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand
} = require('@aws-sdk/client-rekognition');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');

const PROVIDER_NAME = 'aws_rekognition_face_liveness';

class AwsFaceLivenessService {
  constructor() {
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
      || '1200',
      1200,
      60,
      86400
    );

    this.auditImagesLimit = this.parseIntValue(
      process.env.KYC_AWS_LIVENESS_AUDIT_IMAGES_LIMIT
      || process.env.AWS_LIVENESS_AUDIT_IMAGES_LIMIT
      || '0',
      0,
      0,
      4
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
      hasOutputBucket: Boolean(this.outputBucket),
      credentialsEnabled: this.credentialsEnabled,
      hasAssumeRoleArn: Boolean(this.assumeRoleArn),
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      maxAttemptsPerWindow: this.maxAttemptsPerWindow,
      withdrawalMaxAttemptsPerWindow: this.withdrawalMaxAttemptsPerWindow,
      attemptWindowSeconds: this.attemptWindowSeconds,
      softBlockOnAttemptsExhausted: this.softBlockOnAttemptsExhausted,
      sdkMaxAttempts: this.sdkMaxAttempts
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
    if (scope === 'withdrawal') {
      return this.withdrawalMaxAttemptsPerWindow;
    }
    return this.maxAttemptsPerWindow;
  }

  buildAttemptRedisKey({ userId, requirement = null, attemptScope = null } = {}) {
    const safeUserId = String(userId || '').trim();
    const safeScope = this.resolveAttemptScope({ requirement, attemptScope });
    if (!safeUserId) return null;
    return `${this.redisAttemptPrefix}${safeUserId}:${safeScope}`;
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
          estimatedUnitCostUsd: this.estimatedUnitCostUsd,
          windowSeconds: this.attemptWindowSeconds,
          attemptsExhausted: false,
          softBlocked: false
        };
      }
      const parsed = JSON.parse(raw);
      return {
        userId,
        requirement: parsed.requirement || requirement || 'LIVENESS_REQUIRED',
        attemptScope: parsed.attemptScope || scope,
        started: Number(parsed.started || 0),
        failed: Number(parsed.failed || 0),
        passed: Number(parsed.passed || 0),
        maxAttempts: Number(parsed.maxAttempts || maxAttempts),
        estimatedUnitCostUsd: Number(parsed.estimatedUnitCostUsd || this.estimatedUnitCostUsd),
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

    if (state.softBlocked || state.started >= maxAttempts || state.failed >= maxAttempts) {
      const error = new Error('Limite de tentativas de liveness atingido');
      error.code = 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED';
      error.attemptState = {
        ...state,
        attemptsExhausted: true,
        softBlocked: this.softBlockOnAttemptsExhausted,
        softBlockEnabled: this.softBlockOnAttemptsExhausted,
        maxAttempts,
        estimatedCostUsd: Number((maxAttempts * this.estimatedUnitCostUsd).toFixed(6))
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
    const state = await this.getAttemptState({ userId, requirement, attemptScope: scope });
    if (!state) return null;

    const passed = livenessPassed === true;
    const failed = !passed;
    const now = new Date().toISOString();
    const nextState = {
      ...state,
      userId,
      requirement: requirement || state.requirement || 'LIVENESS_REQUIRED',
      attemptScope: scope,
      passed: passed ? Number(state.passed || 0) + 1 : Number(state.passed || 0),
      failed: failed ? Number(state.failed || 0) + 1 : Number(state.failed || 0),
      lastSessionId: sessionId || state.lastSessionId || null,
      lastStatus: status || state.lastStatus || null,
      lastCompletedAt: now,
      maxAttempts,
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      windowSeconds: this.attemptWindowSeconds
    };

    if (passed) {
      nextState.started = 0;
      nextState.failed = 0;
      nextState.attemptsExhausted = false;
      nextState.softBlocked = false;
      nextState.exhaustedAt = null;
      nextState.justExhausted = false;
    } else if (!state.softBlocked && nextState.failed >= maxAttempts) {
      nextState.attemptsExhausted = true;
      nextState.softBlocked = this.softBlockOnAttemptsExhausted;
      nextState.exhaustedAt = now;
      nextState.justExhausted = true;
    } else if (state.softBlocked) {
      nextState.attemptsExhausted = true;
      nextState.softBlocked = true;
      nextState.justExhausted = false;
    } else {
      nextState.justExhausted = false;
    }

    await this.saveAttemptState({ userId, requirement, attemptScope: scope, state: nextState });
    return nextState;
  }

  async saveSessionMetadata(sessionId, metadata = {}) {
    try {
      const redis = redisPool.getConnection();
      await redis.set(
        this.buildSessionRedisKey(sessionId),
        JSON.stringify(metadata),
        'EX',
        this.sessionTtlSeconds
      );
    } catch (error) {
      logError(error, 'Falha ao persistir metadata de sessão AWS liveness', {
        service: 'aws-face-liveness-service',
        sessionId
      });
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

  async issueTemporaryCredentials({ userId = null } = {}) {
    this.assertCredentialsEnabled();

    const cacheKeyUser = userId || 'anonymous';
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
      `${this.sessionNamePrefix}-${String(userId || 'anonymous').slice(0, 24)}-${Date.now()}`
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
      userId: userId || undefined
    });

    return {
      success: true,
      provider: PROVIDER_NAME,
      region: this.region,
      credentials: payload,
      source: 'sts_assume_role'
    };
  }

  async createSession({ userId = null, challengeId = null, requirement = null, attemptScope = null } = {}) {
    this.assertEnabled();
    const scope = this.resolveAttemptScope({ requirement, attemptScope });
    await this.assertCanCreateSession({ userId, requirement, attemptScope: scope });

    const input = {
      ClientRequestToken: crypto.randomUUID(),
      Settings: {
        AuditImagesLimit: this.auditImagesLimit
      }
    };

    if (this.outputBucket) {
      input.Settings.OutputConfig = {
        S3Bucket: this.outputBucket,
        S3KeyPrefix: this.outputPrefix
      };
    }

    const startedAt = Date.now();
    const response = await this.rekognitionClient.send(
      new CreateFaceLivenessSessionCommand(input)
    );

    const sessionId = response?.SessionId;
    if (!sessionId) {
      throw new Error('AWS não retornou SessionId para liveness');
    }

    const metadata = {
      provider: PROVIDER_NAME,
      userId: userId || null,
      challengeId: challengeId || null,
      requirement: requirement || null,
      attemptScope: scope,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(startedAt + (this.sessionTtlSeconds * 1000)).toISOString()
    };

    await this.saveSessionMetadata(sessionId, metadata);
    const attemptState = await this.recordAttemptStarted({
      userId,
      requirement,
      attemptScope: scope,
      sessionId
    });

    logStructured('info', 'Sessão AWS Face Liveness criada', {
      service: 'aws-face-liveness-service',
      userId: userId || undefined,
      sessionId,
      attemptScope: scope,
      attempt: attemptState?.started || null,
      maxAttempts: attemptState?.maxAttempts || this.getMaxAttemptsForScope(scope),
      estimatedUnitCostUsd: this.estimatedUnitCostUsd
    });

    return {
      success: true,
      provider: PROVIDER_NAME,
      region: this.region,
      sessionId,
      attemptScope: scope,
      expiresAt: metadata.expiresAt,
      confidenceThreshold: this.confidenceThreshold,
      attempt: attemptState?.started || null,
      maxAttempts: attemptState?.maxAttempts || this.getMaxAttemptsForScope(scope),
      estimatedUnitCostUsd: this.estimatedUnitCostUsd,
      status: 'CREATED'
    };
  }

  async getSessionResult({ sessionId, userId = null }) {
    this.assertEnabled();

    if (!sessionId || typeof sessionId !== 'string') {
      const error = new Error('sessionId é obrigatório');
      error.code = 'AWS_LIVENESS_SESSION_ID_REQUIRED';
      throw error;
    }

    const startedAt = Date.now();
    const metadata = await this.getSessionMetadata(sessionId);
    if (metadata?.userId && userId && metadata.userId !== userId) {
      const error = new Error('Sessão AWS não pertence ao usuário informado');
      error.code = 'AWS_LIVENESS_SESSION_USER_MISMATCH';
      throw error;
    }

    const response = await this.rekognitionClient.send(
      new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId
      })
    );

    const status = String(response?.Status || 'UNKNOWN').toUpperCase();
    const confidenceRaw = Number(response?.Confidence ?? 0);
    const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : 0;
    const confidenceNormalized = Math.max(0, Math.min(1, confidence / 100));
    const completed = status === 'SUCCEEDED' || status === 'FAILED' || status === 'EXPIRED';
    const livenessPassed = status === 'SUCCEEDED' && confidence >= this.confidenceThreshold;
    const processingTime = Date.now() - startedAt;

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
      confidence,
      confidenceNormalized,
      confidenceThreshold: this.confidenceThreshold,
      livenessPassed,
      referenceImageAvailable: Boolean(response?.ReferenceImage),
      auditImagesCount: Array.isArray(response?.AuditImages) ? response.AuditImages.length : 0,
      challenge: {
        version: response?.Challenge?.Versions?.Current || null,
        preference: response?.Challenge?.Preference || null,
        type: response?.Challenge?.Type || null
      },
      processingTime
    };

    if (completed) {
      const attemptState = await this.recordAttemptResult({
        userId: metadata?.userId || userId,
        requirement: metadata?.requirement || null,
        attemptScope: metadata?.attemptScope || null,
        sessionId,
        status,
        livenessPassed
      });

      await this.saveSessionMetadata(sessionId, {
        ...(metadata || {}),
        userId: metadata?.userId || userId || null,
        completedAt: new Date().toISOString(),
        lastStatus: status,
        confidence,
        livenessPassed
      });

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
          estimatedCostUsd: Number((Number(attemptState.started || 0) * this.estimatedUnitCostUsd).toFixed(6))
        }
        : null;
    }

    return result;
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
        completed: livenessResult?.completed === true
      }
    };
  }
}

module.exports = AwsFaceLivenessService;
