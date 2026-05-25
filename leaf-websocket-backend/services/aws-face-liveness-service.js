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
      || '0',
      0,
      0,
      100
    );

    this.redisPrefix = 'kyc:aws:liveness:session:';
    this.redisCredentialsPrefix = 'kyc:aws:liveness:credentials:';
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
      region: this.region
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
      region: this.region
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
      estimatedUnitCostUsd: this.estimatedUnitCostUsd
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

  async createSession({ userId = null, challengeId = null, requirement = null } = {}) {
    this.assertEnabled();

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
      createdAt: new Date().toISOString(),
      expiresAt: new Date(startedAt + (this.sessionTtlSeconds * 1000)).toISOString()
    };

    await this.saveSessionMetadata(sessionId, metadata);

    logStructured('info', 'Sessão AWS Face Liveness criada', {
      service: 'aws-face-liveness-service',
      userId: userId || undefined,
      sessionId
    });

    return {
      success: true,
      provider: PROVIDER_NAME,
      region: this.region,
      sessionId,
      expiresAt: metadata.expiresAt,
      confidenceThreshold: this.confidenceThreshold,
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
      await this.saveSessionMetadata(sessionId, {
        ...(metadata || {}),
        userId: metadata?.userId || userId || null,
        completedAt: new Date().toISOString(),
        lastStatus: status,
        confidence,
        livenessPassed
      });
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
