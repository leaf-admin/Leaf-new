jest.unmock('express');

const express = require('express');
const request = require('supertest');

jest.mock('../../../services/health-check-service', () => ({
  runAllChecks: jest.fn(async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {}
  })),
  quickCheck: jest.fn(async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString()
  }))
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../services/redis-critical-authority-service', () => ({
  attest: jest.fn(async () => ({
    ready: true,
    status: 'healthy',
    quarantined: false,
    checkedAt: '2026-07-13T12:00:00.000Z',
    blockers: [],
    configuration: {
      enabled: true,
      quarantineEnabled: true,
      generationConfigured: true,
      generationKeyValid: true,
      thresholdPolicyMatches: true,
      tripLocationStreamEnabled: true,
      thresholds: {
        warningPercent: 60,
        highPercent: 75,
        criticalPercent: 85
      }
    },
    dataset: {
      markerPresent: true,
      generationMatches: true,
      markerPersistent: true
    },
    redis: {
      maxmemoryPolicy: 'noeviction',
      appendonly: 'yes',
      appendfsync: 'everysec',
      aofEnabled: 1,
      aofLastWriteStatus: 'ok',
      evictedKeys: 0
    },
    memory: {
      level: 'normal',
      usagePercent: 12.5,
      maxmemoryBytes: 2415919104,
      approvedMaxmemoryBytes: 2415919104,
      maxmemoryMatchesApproved: true
    },
    streams: {
      tripLocation: {
        enabled: true,
        name: 'trip_location_events',
        requiredConsumerGroup: 'trip-location-workers',
        consumerGroupPresent: true,
        consumerActive: true,
        consumerStateValid: true,
        consumerCount: 1,
        activeConsumerCount: 1,
        minConsumerIdleMs: 1000,
        maxConsumerIdleMs: 30000,
        length: 0,
        trimThreshold: 500000,
        pending: 0,
        lag: 0
      }
    }
  }))
}));

const healthRoutes = require('../../../routes/health');

function createApp() {
  const app = express();
  app.use(healthRoutes);
  return app;
}

describe('health runtime flags route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports ready=true for strict real-sandbox runtime', async () => {
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';
    process.env.REQUIRE_PAYMENT_BEFORE_BOOKING = 'true';
    process.env.VERIFY_PAYMENT_BEFORE_BOOKING = 'true';
    process.env.REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING = 'true';
    process.env.APP_REVIEW = 'false';
    process.env.MOCK_PAYMENT_FOR_TESTS = 'false';
    process.env.ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING = 'false';
    process.env.PAYMENT_BYPASS_ON_WOOVI_FAILURE = 'false';
    process.env.PAYMENT_FORCE_BYPASS = 'false';
    process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'false';
    process.env.AUTH_REVIEW_OTP_BYPASS_ENABLED = 'false';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.woovi.environment).toBe('sandbox');
    expect(response.body.launch).toEqual(
      expect.objectContaining({
        launchProfile: expect.any(String),
        demandPredictionEnabled: expect.any(Boolean),
        referralProgramsEnabled: expect.any(Boolean),
        leafDelasEnabled: expect.any(Boolean),
        driverDestinationModeEnabled: expect.any(Boolean),
        dynamicPricingEnabled: expect.any(Boolean),
        smartPushEnabled: expect.any(Boolean),
        adminMutationsEnabled: expect.any(Boolean)
      })
    );
    expect(response.body.realSandbox.ready).toBe(true);
    expect(response.body.realSandbox.blockers).toEqual([]);
  });

  it('fails production readiness when gateway role dependencies are incomplete', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE = 'gateway';
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
    process.env.PILOT_ALLOWED_PASSENGER_IDS = 'passenger-1';
    process.env.PILOT_ALLOWED_DRIVER_IDS = 'driver-1';
    const geofenceService = require('../../../services/geofence-service');
    const previousRegion = geofenceService.allowedRegion;
    const previousRegionSource = geofenceService.regionSource;
    geofenceService.allowedRegion = null;
    geofenceService.regionSource = 'none';
    delete process.env.WOOVI_API_TOKEN;
    delete process.env.LEAF_PIX_KEY;
    delete process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED;

    const response = await request(createApp()).get('/health/readiness');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'not-ready',
      runtimeRole: 'gateway',
      enforced: true,
      ready: false
    });
    expect(response.body.failedDependencies).toEqual(expect.arrayContaining([
      'paymentProviderConfigured',
      'redisAcceptAuthority',
      'kycStrict',
      'geofenceAvailable'
    ]));
    expect(response.body.dependencies.redisAcceptAuthority).toBe(false);

    geofenceService.allowedRegion = previousRegion;
    geofenceService.regionSource = previousRegionSource;
  });

  it('keeps ride_flow_validation KYC-dormant while independently requiring Redis AcceptRide authority', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'gateway',
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation',
      LEAF_PILOT_CONTROLLED: 'false',
      PILOT_ALLOWED_PASSENGER_IDS: 'passenger-1',
      PILOT_ALLOWED_DRIVER_IDS: 'driver-1',
      REDIS_HOST: 'redis',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"leaf"}',
      WOOVI_API_TOKEN: 'woovi-token',
      WOOVI_BASE_URL: 'https://api.woovi-sandbox.com/api/v1',
      LEAF_PIX_KEY: 'pix-key',
      GOOGLE_MAPS_API_KEY: 'maps-key',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_STRICT_PRODUCTION_MODE: 'false',
      KYC_AWS_LIVENESS_ENABLED: 'false',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'false',
      KYC_AWS_COMPARE_FACES_ENABLED: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'false',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction'
    });

    const readiness = await request(createApp()).get('/health/readiness');
    const flags = await request(createApp()).get('/health/runtime-flags');

    expect(readiness.body.dependencies).toEqual(expect.objectContaining({
      redisAcceptAuthority: true,
      kycStrict: true
    }));
    expect(readiness.body.failedDependencies).not.toEqual(expect.arrayContaining([
      'redisAcceptAuthority',
      'kycStrict'
    ]));
    expect(flags.body.acceptRideAuthority).toEqual(expect.objectContaining({
      valid: true,
      required: true,
      mode: 'redis_noeviction',
      ready: true
    }));
    expect(flags.body.kyc).toEqual(expect.objectContaining({
      strictReadinessRequired: false,
      productionBiometricsEnabled: false,
      adaptiveCadenceEnabled: false,
      onlineGateEnabled: false
    }));
  });

  it.each([
    ['adaptive cadence', 'KYC_TRUST_CADENCE_ENABLED'],
    ['online gate', 'DAILY_KYC_ONLINE_GATE_ENABLED']
  ])('does not relax strict KYC when %s is active', async (_label, activeFlag) => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'gateway',
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation',
      LEAF_PILOT_CONTROLLED: 'false',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_STRICT_PRODUCTION_MODE: 'false',
      KYC_AWS_LIVENESS_ENABLED: 'false',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'false',
      KYC_AWS_COMPARE_FACES_ENABLED: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'false',
      [activeFlag]: 'true'
    });

    const response = await request(createApp()).get('/health/readiness');

    expect(response.body.dependencies.kycStrict).toBe(false);
    expect(response.body.failedDependencies).toContain('kycStrict');
  });

  it('keeps non-production readiness scoped to live quick health', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE = 'gateway';
    delete process.env.WOOVI_API_TOKEN;
    delete process.env.GOOGLE_MAPS_API_KEY;

    const response = await request(createApp()).get('/health/readiness');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ready',
      enforced: false,
      ready: true
    });
  });

  it('reports runtime role and app version in runtime section', async () => {
    process.env.RUNTIME_ROLE = 'sideeffects';
    process.env.APP_VERSION = '1.2.3';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.runtime.runtimeRole).toBe('sideeffects');
    expect(response.body.runtime.appVersion).toBe('1.2.3');
  });

  it('reports firebase section with booleans', async () => {
    process.env.FIREBASE_DATABASE_URL = 'https://leaf-test.firebaseio.com';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"dummy": true}';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.firebase).toBeDefined();
    expect(response.body.firebase.configured).toBe(true);
    expect(response.body.firebase.serviceAccountConfigured).toBe(true);
    expect(response.body.firebase.databaseUrlConfigured).toBe(true);
  });

  it('reports firebase unconfigured when no vars set', async () => {
    delete process.env.FIREBASE_DATABASE_URL;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.firebase.configured).toBe(false);
  });

  it('reports push section with booleans', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"leaf"}';
    process.env.ALLOW_PUBLIC_DIRECT_FCM_SEND = 'false';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.push).toBeDefined();
    expect(response.body.push.configured).toBe(true);
    expect(response.body.push.provider).toBe('firebase-admin');
    expect(response.body.push.fcmConfigured).toBe(true);
    expect(response.body.push.allowPublicDirectFcmSend).toBe(false);
  });

  it('reports kyc section with booleans', async () => {
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    process.env.KYC_STRICT_PRODUCTION_MODE = 'true';
    process.env.KYC_AWS_LIVENESS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_CREDENTIALS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_ARN = 'arn:aws:iam::123456789012:role/leaf-liveness';
    process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID = 'external-binding';
    process.env.KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX = 'leaf-liveness';
    process.env.KYC_AWS_CREDENTIAL_SOURCE = 'static';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.ENABLE_CNH_FACE_BIOMETRICS = 'true';
    process.env.KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH = 'true';
    process.env.DAILY_KYC_ONLINE_GATE_ENABLED = 'true';
    process.env.KYC_TRUST_CADENCE_ENABLED = 'true';
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
    process.env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT = '10';
    process.env.KYC_AWS_COST_GUARD_ENABLED = 'true';
    process.env.KYC_AWS_COST_PER_USER_DAILY_SESSION_LIMIT = '20';
    process.env.KYC_AWS_COST_TIME_ZONE = 'UTC';
    delete process.env.KYC_AWS_LIVENESS_S3_BUCKET;
    delete process.env.AWS_LIVENESS_S3_BUCKET;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.kyc).toBeDefined();
    expect(response.body.kyc.productionBiometricsEnabled).toBe(true);
    expect(response.body.kyc.strictProductionMode).toBe(true);
    expect(response.body.kyc.awsLivenessConfigured).toBe(true);
    expect(response.body.kyc.awsLivenessCredentialsEnabled).toBe(true);
    expect(response.body.kyc.awsLivenessIdempotentRetryValid).toBe(true);
    expect(response.body.kyc.awsLivenessRetryDelaySeconds).toBe(2);
    expect(response.body.kyc.awsLivenessRetryWindowSeconds).toBe(120);
    expect(response.body.kyc.awsAssumeRoleExternalIdConfigured).toBe(true);
    expect(response.body.kyc.awsBaseCredentialsConfigured).toBe(true);
    expect(response.body.kyc.cnhFaceBiometricsConfigured).toBe(true);
    expect(response.body.kyc.legacyCnhEmbeddingDisabled).toBe(false);
    expect(response.body.kyc.requireTrustedBiometricMatch).toBe(true);
    expect(response.body.kyc.awsCostGuardEnabled).toBe(true);
    expect(response.body.kyc.awsCostLimitScope).toBe('per_driver_daily');
    expect(response.body.kyc.awsCostPerUserDailySessionLimit).toBe(20);
    expect(response.body.kyc.awsCostPerUserDailyLimitValid).toBe(true);
    expect(response.body.kyc.awsCostGlobalDailyLimitEnabled).toBe(false);
    expect(response.body.kyc.awsCostGlobalMonthlyLimitEnabled).toBe(false);
    expect(response.body.kyc.awsCostGlobalSpendMode).toBe('monitor_only_daily_discord');
    expect(response.body.kyc.awsCostRetentionValid).toBe(true);
    expect(response.body.kyc.awsCostOperationRetentionDays).toBe(35);
    expect(response.body.kyc.awsCompareResultPersistenceValid).toBe(true);
    expect(response.body.kyc.awsCostTimeZoneUtc).toBe(true);
    expect(response.body.acceptRideAuthority).toEqual(expect.objectContaining({
      required: true,
      mode: 'redis_noeviction',
      ready: true,
      attestation: expect.objectContaining({
        ready: true,
        quarantined: false
      })
    }));
    expect(response.body.kyc).toEqual(expect.objectContaining({
      onlineGateEnabled: true,
      adaptiveCadenceEnabled: true,
      activeTripIndexEnabled: true,
      activeTripAuthorityMode: 'redis_noeviction',
      activeTripAuthorityReady: true,
      strictReadinessRequired: true,
      strictReadinessTriggers: expect.objectContaining({
        productionBiometrics: true,
        adaptiveCadence: true,
        onlineGate: true
      }),
      activeTripAuthorityAttestation: expect.objectContaining({
        ready: true,
        status: 'healthy',
        quarantined: false,
        dataset: expect.objectContaining({
          generationMatches: true,
          markerPersistent: true
        }),
        redis: expect.objectContaining({
          maxmemoryPolicy: 'noeviction',
          aofEnabled: 1,
          evictedKeys: 0
        }),
        streams: {
          tripLocation: expect.objectContaining({
            consumerGroupPresent: true,
            consumerActive: true,
            requiredConsumerGroup: 'trip-location-workers'
          })
        }
      }),
      trustPolicyVersion: 'driver_identity_recurring_v2',
      cadenceHours: {
        new: 24,
        observed: 72,
        trusted: 168
      },
      trustPromotionRequirements: {
        observedMinDistinctSuccessDays: 7,
        trustedMinAgeDays: 30,
        trustedMinSuccessCount: 14,
        trustedMinDistinctSuccessDays: 14
      },
      trustPromotionRequirementsValid: true,
      approvedAdaptiveCadencePolicyValid: true,
      trustedRandomAuditPercent: 10,
      verificationDuringActiveRide: false,
      canonicalReferenceImageCompare: true,
      canonicalReferenceImageMode: 'inline_bytes'
    }));
  });

  it('keeps redis_noeviction KYC readiness red when live attestation is quarantined', async () => {
    const redisCriticalAuthorityService = require('../../../services/redis-critical-authority-service');
    redisCriticalAuthorityService.attest.mockResolvedValueOnce({
      ready: false,
      status: 'quarantined',
      quarantined: true,
      checkedAt: '2026-07-13T12:00:00.000Z',
      blockers: ['dataset_generation_mismatch'],
      configuration: {
        enabled: true,
        quarantineEnabled: true,
        generationConfigured: true,
        generationKeyValid: true,
        thresholdPolicyMatches: true,
        thresholds: {
          warningPercent: 60,
          highPercent: 75,
          criticalPercent: 85
        }
      },
      dataset: {
        markerPresent: true,
        generationMatches: false,
        markerPersistent: true
      },
      redis: {
        maxmemoryPolicy: 'noeviction',
        appendonly: 'yes',
        appendfsync: 'everysec',
        aofEnabled: 1,
        aofLastWriteStatus: 'ok',
        evictedKeys: 0
      },
      memory: {
        level: 'normal',
        usagePercent: 12.5,
        maxmemoryBytes: 2415919104,
        approvedMaxmemoryBytes: 2415919104,
        maxmemoryMatchesApproved: true
      },
      error: {
        code: 'ECONNREFUSED',
        message: 'redis://:super-secret@redis:6379'
      }
    });
    Object.assign(process.env, {
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'gateway',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_STRICT_PRODUCTION_MODE: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/leaf-liveness',
      KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID: 'external-binding',
      KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX: 'leaf-liveness',
      KYC_AWS_CREDENTIAL_SOURCE: 'static',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD: '0.95',
      KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD: '0.80',
      KYC_AWS_COST_GUARD_ENABLED: 'true',
      KYC_AWS_COST_PER_USER_DAILY_SESSION_LIMIT: '20',
      KYC_AWS_COST_TIME_ZONE: 'UTC',
      ENABLE_CNH_FACE_BIOMETRICS: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      ENABLE_ACTIVE_TRIP_INDEX: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      KYC_TRUST_POLICY_VERSION: 'driver_identity_recurring_v2'
    });

    const response = await request(createApp()).get('/health/readiness');

    expect(response.status).toBe(503);
    expect(response.body.dependencies.redisAcceptAuthority).toBe(false);
    expect(response.body.failedDependencies).toContain('redisAcceptAuthority');
    expect(response.body.dependencies.kycStrict).toBe(true);
    expect(response.body.failedDependencies).not.toContain('kycStrict');
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(JSON.stringify(response.body)).not.toContain('redis://');
  });

  it('keeps redis_noeviction readiness red when the route stream consumer is missing', async () => {
    const redisCriticalAuthorityService = require('../../../services/redis-critical-authority-service');
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'redis_noeviction';
    redisCriticalAuthorityService.attest.mockResolvedValueOnce({
      ready: false,
      status: 'quarantined',
      quarantined: true,
      checkedAt: '2026-07-13T12:00:00.000Z',
      blockers: ['trip_location_stream_consumer_missing'],
      configuration: {
        enabled: true,
        quarantineEnabled: true,
        generationConfigured: true,
        generationKeyValid: true,
        thresholdPolicyMatches: true,
        tripLocationStreamEnabled: true,
        thresholds: { warningPercent: 60, highPercent: 75, criticalPercent: 85 }
      },
      dataset: { markerPresent: true, generationMatches: true, markerPersistent: true },
      redis: {
        maxmemoryPolicy: 'noeviction',
        appendonly: 'yes',
        appendfsync: 'everysec',
        aofEnabled: 1,
        aofLastWriteStatus: 'ok',
        evictedKeys: 0
      },
      memory: { usagePercent: 20, maxmemoryMatchesApproved: true },
      streams: {
        tripLocation: {
          enabled: true,
          requiredConsumerGroup: 'trip-location-workers',
          consumerGroupPresent: false,
          length: 0,
          trimThreshold: 500000
        }
      }
    });

    const response = await request(createApp()).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.kyc.activeTripAuthorityReady).toBe(false);
    expect(response.body.kyc.activeTripAuthorityAttestation).toEqual(
      expect.objectContaining({
        blockers: ['trip_location_stream_consumer_missing'],
        streams: {
          tripLocation: expect.objectContaining({ consumerGroupPresent: false })
        }
      })
    );
  });

  it('fails readiness closed for an unsupported active-trip authority mode', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'gateway',
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation',
      LEAF_PILOT_CONTROLLED: 'false',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_STRICT_PRODUCTION_MODE: 'false',
      KYC_AWS_LIVENESS_ENABLED: 'false',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'false',
      KYC_AWS_COMPARE_FACES_ENABLED: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'false'
    });
    process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE = 'durable_fallback';

    const flags = await request(createApp()).get('/health/runtime-flags');
    const readiness = await request(createApp()).get('/health/readiness');

    expect(flags.status).toBe(200);
    expect(flags.body.acceptRideAuthority).toEqual(expect.objectContaining({
      valid: false,
      required: false,
      mode: 'durable_fallback',
      ready: false,
      attestation: null
    }));
    expect(flags.body.kyc).toEqual(expect.objectContaining({
      activeTripAuthorityMode: 'durable_fallback',
      activeTripAuthorityReady: false,
      activeTripAuthorityAttestation: null
    }));
    expect(readiness.status).toBe(503);
    expect(readiness.body.dependencies.redisAcceptAuthority).toBe(false);
    expect(readiness.body.failedDependencies).toContain('redisAcceptAuthority');
  });

  it('keeps an empty authority mode backward compatible while strict KYC is dormant', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'gateway',
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation',
      LEAF_PILOT_CONTROLLED: 'false',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_STRICT_PRODUCTION_MODE: 'false',
      KYC_AWS_LIVENESS_ENABLED: 'false',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'false',
      KYC_AWS_COMPARE_FACES_ENABLED: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'false',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: ''
    });

    const flags = await request(createApp()).get('/health/runtime-flags');
    const readiness = await request(createApp()).get('/health/readiness');

    expect(flags.body.acceptRideAuthority).toEqual({
      valid: true,
      required: false,
      mode: null,
      ready: false,
      attestation: null
    });
    expect(readiness.body.dependencies.redisAcceptAuthority).toBe(true);
    expect(readiness.body.failedDependencies).not.toContain('redisAcceptAuthority');
  });

  it('reports legacy v1 when adaptive cadence is disabled without a policy override', async () => {
    process.env.KYC_TRUST_CADENCE_ENABLED = 'false';
    delete process.env.KYC_TRUST_POLICY_VERSION;

    const response = await request(createApp()).get('/health/runtime-flags');

    expect(response.body.kyc).toEqual(expect.objectContaining({
      adaptiveCadenceEnabled: false,
      trustPolicyVersion: 'driver_identity_recurring_v1',
      approvedAdaptiveCadencePolicyValid: true
    }));
  });

  it('keeps strict KYC readiness red when the approved adaptive cadence drifts', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'gateway',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_STRICT_PRODUCTION_MODE: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/leaf-liveness',
      KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID: 'external-binding',
      KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX: 'leaf-liveness',
      KYC_AWS_CREDENTIAL_SOURCE: 'static',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD: '0.95',
      KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD: '0.80',
      KYC_AWS_COST_GUARD_ENABLED: 'true',
      KYC_AWS_COST_PER_USER_DAILY_SESSION_LIMIT: '20',
      KYC_AWS_COST_TIME_ZONE: 'UTC',
      ENABLE_CNH_FACE_BIOMETRICS: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      ENABLE_ACTIVE_TRIP_INDEX: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      KYC_TRUST_POLICY_VERSION: 'driver_identity_recurring_v2',
      KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS: '7',
      KYC_TRUST_T2_MIN_AGE_DAYS: '30',
      KYC_TRUST_T2_MIN_SUCCESS_COUNT: '14',
      KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS: '14',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '10'
    });

    let response = await request(createApp()).get('/health/readiness');
    expect(response.body.dependencies.kycStrict).toBe(true);

    process.env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT = '100';
    response = await request(createApp()).get('/health/readiness');
    expect(response.body.dependencies.kycStrict).toBe(false);

    process.env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT = '10';
    process.env.KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS = '15';
    response = await request(createApp()).get('/health/readiness');
    expect(response.body.dependencies.kycStrict).toBe(false);

    process.env.KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS = '14';
    process.env.KYC_TRUST_T2_MIN_AGE_DAYS = '31';
    response = await request(createApp()).get('/health/readiness');
    expect(response.body.dependencies.kycStrict).toBe(false);

    process.env.KYC_TRUST_T2_MIN_AGE_DAYS = '30';
    process.env.KYC_TRUST_T2_MAX_AGE_HOURS = '120';
    response = await request(createApp()).get('/health/readiness');
    expect(response.body.dependencies.kycStrict).toBe(false);
  });

  it('keeps strict KYC readiness red when Firestore is not the configured positive authority', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE = 'gateway';
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    process.env.KYC_STRICT_PRODUCTION_MODE = 'false';

    const response = await request(createApp()).get('/health/readiness');

    expect(response.status).toBe(503);
    expect(response.body.dependencies.kycStrict).toBe(false);
    expect(response.body.failedDependencies).toContain('kycStrict');
  });

  it('keeps strict AWS KYC readiness red when approval threshold is below 0.95', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE = 'gateway';
    process.env.KYC_FACE_COMPARE_PROVIDER = 'aws_rekognition_compare_faces';
    process.env.KYC_AWS_COMPARE_FACES_ENABLED = 'true';
    process.env.KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD = '0.90';

    const flags = await request(createApp()).get('/health/runtime-flags');
    const readiness = await request(createApp()).get('/health/readiness');

    expect(flags.body.kyc).toEqual(expect.objectContaining({
      awsCompareApproveThreshold: 0.90,
      awsCompareApproveThresholdValid: false,
      awsCompareThresholdsValid: false
    }));
    expect(readiness.status).toBe(503);
    expect(readiness.body.dependencies.kycStrict).toBe(false);
    expect(readiness.body.failedDependencies).toContain('kycStrict');
  });

  it('keeps strict AWS KYC readiness red when the review threshold is not below approval', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE = 'gateway';
    process.env.KYC_FACE_COMPARE_PROVIDER = 'aws_rekognition_compare_faces';
    process.env.KYC_AWS_COMPARE_FACES_ENABLED = 'true';
    process.env.KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD = '0.95';
    process.env.KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD = '0.95';

    const flags = await request(createApp()).get('/health/runtime-flags');
    const readiness = await request(createApp()).get('/health/readiness');

    expect(flags.body.kyc).toEqual(expect.objectContaining({
      awsCompareApproveThreshold: 0.95,
      awsCompareReviewThreshold: 0.95,
      awsCompareApproveThresholdValid: true,
      awsCompareThresholdsValid: false
    }));
    expect(readiness.status).toBe(503);
    expect(readiness.body.dependencies.kycStrict).toBe(false);
    expect(readiness.body.failedDependencies).toContain('kycStrict');
  });

  it('keeps strict KYC readiness red when the active-trip guard is disabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE = 'gateway';
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_CREDENTIALS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_ARN = 'arn:aws:iam::123456789012:role/leaf-liveness';
    process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID = 'external-binding';
    process.env.KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX = 'leaf-liveness';
    process.env.KYC_AWS_CREDENTIAL_SOURCE = 'static';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.KYC_FACE_COMPARE_PROVIDER = 'aws_rekognition_compare_faces';
    process.env.KYC_AWS_COMPARE_FACES_ENABLED = 'true';
    process.env.KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH = 'true';
    process.env.MOBILE_FACE_EMBEDDING_ENABLED = 'false';
    process.env.DAILY_KYC_ONLINE_GATE_ENABLED = 'true';
    process.env.KYC_TRUST_CADENCE_ENABLED = 'true';
    process.env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT = '10';
    process.env.ENABLE_ACTIVE_TRIP_INDEX = 'false';

    const response = await request(createApp()).get('/health/readiness');

    expect(response.status).toBe(503);
    expect(response.body.dependencies.kycStrict).toBe(false);
    expect(response.body.failedDependencies).toContain('kycStrict');
  });

  it('keeps canonical AWS readiness red when the legacy CNH embedding path is enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE = 'gateway';
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_CREDENTIALS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_ARN = 'arn:aws:iam::123456789012:role/leaf-liveness';
    process.env.KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID = 'external-binding';
    process.env.KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX = 'leaf-liveness';
    process.env.KYC_AWS_CREDENTIAL_SOURCE = 'static';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.KYC_FACE_COMPARE_PROVIDER = 'aws_rekognition_compare_faces';
    process.env.KYC_AWS_COMPARE_FACES_ENABLED = 'true';
    process.env.ENABLE_CNH_FACE_BIOMETRICS = 'true';
    process.env.KYC_AWS_COST_GUARD_ENABLED = 'true';
    process.env.KYC_AWS_COST_PER_USER_DAILY_SESSION_LIMIT = '20';
    process.env.KYC_AWS_COST_TIME_ZONE = 'UTC';
    process.env.KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH = 'true';
    process.env.MOBILE_FACE_EMBEDDING_ENABLED = 'false';
    process.env.DAILY_KYC_ONLINE_GATE_ENABLED = 'true';
    process.env.KYC_TRUST_CADENCE_ENABLED = 'true';
    process.env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT = '10';
    process.env.ENABLE_ACTIVE_TRIP_INDEX = 'true';

    const response = await request(createApp()).get('/health/readiness');

    expect(response.status).toBe(503);
    expect(response.body.dependencies.kycStrict).toBe(false);
    expect(response.body.failedDependencies).toContain('kycStrict');
  });

  it('reports maps section with booleans', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.ENABLE_PLACES_CACHE = 'true';
    process.env.GEO_KEY = 'geo-key';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.maps).toBeDefined();
    expect(response.body.maps.configured).toBe(true);
    expect(response.body.maps.keyConfigured).toBe(true);
    expect(response.body.maps.placesCacheEnabled).toBe(true);
    expect(response.body.maps.receiptMapImagesConfigured).toBe(true);
  });

  it('reports pricing separation and driver traffic-layer policy', async () => {
    process.env.PRICING_DEMAND_PRESSURE_MODE = 'active';
    process.env.ENABLE_DRIVER_TRAFFIC_LAYER = 'true';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.pricing).toEqual({
      demandPressureMode: 'active',
      trafficPricing: 'traffic_aware_time_component',
      heatmapSource: 'leaf_internal_supply_demand',
      driverTrafficLayerEnabled: true
    });
  });

  it('reports maps.googleFallbackAllowed and backendOnly', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const appWithoutFallback = createApp();
    const resNoFallback = await request(appWithoutFallback).get('/health/runtime-flags');
    expect(resNoFallback.body.maps.clientDirectGoogleFallbackAllowed).toBe(false);
    expect(resNoFallback.body.maps.backendOnly).toBe(true);
    expect(resNoFallback.body.maps.receiptMapImagesConfigured).toBe(true);

    process.env.EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK = 'true';
    const appWithFallback = createApp();
    const resWithFallback = await request(appWithFallback).get('/health/runtime-flags');
    expect(resWithFallback.body.maps.clientDirectGoogleFallbackAllowed).toBe(true);
    expect(resWithFallback.body.maps.backendOnly).toBe(false);
  });

  it('reports maps.backendOnly=false when maps key is absent', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.body.maps.configured).toBe(false);
    expect(response.body.maps.backendOnly).toBe(false);
  });

  it('keeps places cache enabled by default unless explicitly disabled', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    delete process.env.ENABLE_PLACES_CACHE;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const enabledByDefault = await request(createApp()).get('/health/runtime-flags');
    expect(enabledByDefault.body.maps.placesCacheEnabled).toBe(true);

    process.env.ENABLE_PLACES_CACHE = 'false';
    const disabledExplicitly = await request(createApp()).get('/health/runtime-flags');
    expect(disabledExplicitly.body.maps.placesCacheEnabled).toBe(false);
  });

  it('reports socket section with booleans', async () => {
    process.env.ENABLE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.REQUIRE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.socket).toBeDefined();
    expect(response.body.socket.redisAdapterEnabled).toBe(true);
    expect(response.body.socket.redisAdapterRequired).toBe(true);
  });

  it('default runtime role is gateway when not set', async () => {
    delete process.env.RUNTIME_ROLE;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.body.runtime.runtimeRole).toBe('gateway');
  });

  it('reports blockers when bypass flags are enabled', async () => {
    process.env.WOOVI_ENVIRONMENT = 'production';
    process.env.WOOVI_BASE_URL = 'https://api.woovi.com/api/v1';
    process.env.APP_REVIEW = 'true';
    process.env.PAYMENT_BYPASS_ON_WOOVI_FAILURE = 'true';
    process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'true';

    const app = createApp();
    const response = await request(app).get('/api/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.realSandbox.ready).toBe(false);
    expect(response.body.realSandbox.blockers).toEqual(
      expect.arrayContaining([
        'WOOVI_ENVIRONMENT != sandbox',
        'WOOVI_BASE_URL não aponta para sandbox',
        'APP_REVIEW=true',
        'PAYMENT_BYPASS_ON_WOOVI_FAILURE=true',
        'AUTH_TEST_OTP_BYPASS_ENABLED=true'
      ])
    );
  });
});
