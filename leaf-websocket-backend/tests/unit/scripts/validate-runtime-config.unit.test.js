const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '../../..');
const validatorPath = path.join(backendRoot, 'scripts/deploy/validate-runtime-config.js');
const absentEnvFile = path.join(backendRoot, '.env.test-does-not-exist');

function runValidator(extraEnv = {}) {
  const recentDrillAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: backendRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ENV_FILE: absentEnvFile,
      LEAF_BROAD_LAUNCH_APPROVED: 'true',
      REDIS_MODE: 'sentinel',
      REDIS_SENTINELS: 'sentinel-a:26379,sentinel-b:26379,sentinel-c:26379',
      REDIS_SENTINEL_MASTER_NAME: 'leaf-master',
      REDIS_PASSWORD: 'redis-password',
      REDIS_SENTINEL_PASSWORD: 'sentinel-password',
      REDIS_HA_FAILURE_DOMAINS: 'redis-domain-a,redis-domain-b,redis-domain-c',
      REDIS_HA_FAILOVER_DRILL_ID: 'ops-20260803-redis-001',
      REDIS_HA_FAILOVER_DRILL_AT: recentDrillAt,
      LEAF_EDGE_HA_MODE: 'managed_load_balancer',
      LEAF_EDGE_HA_FAILURE_DOMAINS: 'edge-domain-a,edge-domain-b',
      LEAF_EDGE_HA_FAILOVER_DRILL_ID: 'ops-20260803-edge-001',
      LEAF_EDGE_HA_FAILOVER_DRILL_AT: recentDrillAt,
      ...extraEnv
    },
    encoding: 'utf8'
  });

  return {
    ...result,
    report: JSON.parse(result.stdout)
  };
}

describe('validate-runtime-config Woovi webhook production gates', () => {
  const baseProdEnv = {
    NODE_ENV: 'production',
    WOOVI_ENVIRONMENT: 'production',
    WOOVI_BASE_URL: 'https://api.woovi.com/api/v1',
    WOOVI_API_TOKEN: 'woovi-token',
    LEAF_PIX_KEY: 'pix-key',
    CORS_ORIGIN: 'https://api.leaf.example',
    KYC_AWS_COST_GUARD_ENABLED: 'true',
    KYC_AWS_COST_DAILY_LIMIT_USD: '2.50',
    KYC_AWS_COST_MONTHLY_LIMIT_USD: '50.00',
    KYC_AWS_COST_TIME_ZONE: 'UTC',
    LEAF_APPROVED_FINANCIAL_POLICY_ID: 'runtime_tiered_percent_above_50_v1',
    LEAF_FINANCIAL_POLICY_APPROVAL_REF: 'policy-test-approval'
  };
  const strictKycProdEnv = {
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
    KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS: '1',
    KYC_AWS_COMPARE_RESULT_PERSIST_MAX_ATTEMPTS: '3',
    ENABLE_CNH_FACE_BIOMETRICS: 'false',
    MOBILE_FACE_EMBEDDING_ENABLED: 'false',
    MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK: 'false',
    KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
    KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
    KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false',
    KYC_TRUST_CADENCE_ENABLED: 'true',
    DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
    KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
    REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
    REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
    REDIS_CRITICAL_DATASET_GENERATION: 'prod-test-generation',
    KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '10'
  };

  it('blocks a full production profile without formal broad-launch approval', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_BROAD_LAUNCH_APPROVED: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'Produção exige perfil pilot_controlled ou LEAF_BROAD_LAUNCH_APPROVED=true após o GO formal'
    );
  });

  it('blocks broad launch while Redis remains standalone or lacks current failover evidence', () => {
    const result = runValidator({
      ...baseProdEnv,
      REDIS_MODE: 'standalone',
      REDIS_SENTINELS: '',
      REDIS_HA_FAILURE_DOMAINS: 'redis-domain-a',
      REDIS_HA_FAILOVER_DRILL_ID: '',
      REDIS_HA_FAILOVER_DRILL_AT: ''
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'Lançamento amplo exige Redis Sentinel válido em 3+ domínios e drill de failover comprovado nos últimos 30 dias'
    );
    expect(result.report.diagnostics.productionHa.redis).toMatchObject({
      mode: 'standalone',
      ready: false,
      failureDomainCount: 1,
      uniqueFailureDomainCount: 1,
      failoverDrill: { valid: false }
    });
  });

  it('blocks broad launch without a redundant edge and current failover evidence', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_EDGE_HA_MODE: 'single_nginx',
      LEAF_EDGE_HA_FAILURE_DOMAINS: 'edge-domain-a',
      LEAF_EDGE_HA_FAILOVER_DRILL_ID: 'old-edge-drill',
      LEAF_EDGE_HA_FAILOVER_DRILL_AT: '2020-01-01T00:00:00.000Z'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'Lançamento amplo exige borda com failover em 2+ domínios e drill comprovado nos últimos 30 dias'
    );
    expect(result.report.diagnostics.productionHa.edge).toMatchObject({
      mode: 'single_nginx',
      modeValid: false,
      ready: false,
      failureDomainCount: 1,
      uniqueFailureDomainCount: 1,
      failoverDrill: { timestampValid: false, valid: false }
    });
  });

  it('rejects placeholder drill references and repeated failure domains', () => {
    const result = runValidator({
      ...baseProdEnv,
      REDIS_HA_FAILURE_DOMAINS: 'redis-domain-a,redis-domain-a,redis-domain-a',
      REDIS_HA_FAILOVER_DRILL_ID: 'change-ticket-or-run-id',
      LEAF_EDGE_HA_FAILURE_DOMAINS: 'edge-domain-a,edge-domain-a',
      LEAF_EDGE_HA_FAILOVER_DRILL_ID: 'placeholder'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'Lançamento amplo exige Redis Sentinel válido em 3+ domínios e drill de failover comprovado nos últimos 30 dias',
      'Lançamento amplo exige borda com failover em 2+ domínios e drill comprovado nos últimos 30 dias'
    ]));
    expect(result.report.diagnostics.productionHa.redis).toMatchObject({
      ready: false,
      failureDomainCount: 3,
      uniqueFailureDomainCount: 1,
      failoverDrill: { idConfigured: true, idValid: false, valid: false }
    });
    expect(result.report.diagnostics.productionHa.edge).toMatchObject({
      ready: false,
      failureDomainCount: 2,
      uniqueFailureDomainCount: 1,
      failoverDrill: { idConfigured: true, idValid: false, valid: false }
    });
  });

  it('accepts broad launch HA only with valid Sentinel, distinct domains and recent drills', () => {
    const result = runValidator({
      ...baseProdEnv,
      ...strictKycProdEnv
    });

    expect(result.status).toBe(0);
    expect(result.report.diagnostics.productionHa).toMatchObject({
      required: true,
      redis: {
        mode: 'sentinel',
        sentinelConfigValid: true,
        sentinelCount: 3,
        failureDomainCount: 3,
        uniqueFailureDomainCount: 3,
        ready: true,
        failoverDrill: { valid: true, maxAgeDays: 30 }
      },
      edge: {
        mode: 'managed_load_balancer',
        modeValid: true,
        failureDomainCount: 2,
        uniqueFailureDomainCount: 2,
        ready: true,
        failoverDrill: { valid: true, maxAgeDays: 30 }
      }
    });
  });

  it.each([
    'ENABLE_LEGACY_GRAPHQL',
    'ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT'
  ])('blocks the isolated legacy surface %s in production', (flag) => {
    const result = runValidator({
      ...baseProdEnv,
      [flag]: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      `${flag}=true bloqueado em produção`
    );
    expect(result.report.diagnostics.legacyRuntime[flag]).toEqual({
      value: true,
      source: 'env'
    });
  });

  it('blocks bypassing runtime config validation in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_SKIP_RUNTIME_CONFIG_VALIDATION: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'LEAF_SKIP_RUNTIME_CONFIG_VALIDATION=true bloqueado em produção'
    );
    expect(result.report.diagnostics.runtime.skipRuntimeConfigValidation).toEqual({
      value: true,
      source: 'env'
    });
  });

  it('blocks disabling the commercial subscription gate in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      SUBSCRIPTION_ONLINE_GATE_ENABLED: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'SUBSCRIPTION_ONLINE_GATE_ENABLED=false bloqueado em produção'
    );
    expect(result.report.diagnostics.subscriptionAuthority).toMatchObject({
      source: 'firestore',
      cache: 'redis',
      unavailablePolicy: 'fail_closed'
    });
  });

  it('blocks an unsafe subscription gate cache TTL in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      SUBSCRIPTION_GATE_CACHE_TTL_SECONDS: '7200'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'SUBSCRIPTION_GATE_CACHE_TTL_SECONDS deve estar entre 5 e 3600 em produção'
    );
  });

  it('blocks a pilot without cohorts, polygon, runtime version and strict KYC', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_BROAD_LAUNCH_APPROVED: 'false',
      LEAF_LAUNCH_PROFILE: 'pilot_controlled',
      GEOFENCE_REGION_FILE: 'config/geofence-does-not-exist.json'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'PILOT_ALLOWED_PASSENGER_IDS deve conter o cohort autorizado do piloto',
      'PILOT_ALLOWED_DRIVER_IDS deve conter o cohort autorizado do piloto',
      'GEOFENCE_REGION ausente ou inválido: o piloto exige polígono operacional aprovado',
      'LEAF_RUNTIME_POLICY_VERSION obrigatório no perfil piloto',
      'KYC_PRODUCTION_BIOMETRICS_ENABLED=false: produção biométrica ainda não está travada em modo estrito.'
    ]));
  });

  it('recognizes the versioned Rio pilot GeoJSON as a valid multi-polygon', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_LAUNCH_PROFILE: 'full',
      GEOFENCE_REGION_FILE: 'config/geofence.json'
    });

    expect(result.report.diagnostics.launchControl.geofenceRegion).toEqual(
      expect.objectContaining({
        configured: true,
        valid: true,
        source: 'file',
        version: 'rio-zona-sul-centro-lapa-v1',
        polygons: 22,
        points: 4337
      })
    );
  });

  it('allows geofence validation before KYC only when Pix and booking intake are paused', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_BROAD_LAUNCH_APPROVED: 'false',
      LEAF_LAUNCH_PROFILE: 'geofence_validation',
      LEAF_PILOT_CONTROLLED: 'false',
      PILOT_ALLOWED_PASSENGER_IDS: 'passenger-1',
      PILOT_ALLOWED_DRIVER_IDS: 'driver-1',
      LEAF_ACCEPT_NEW_PIX: 'false',
      LEAF_ACCEPT_NEW_BOOKINGS: 'false',
      LEAF_RUNTIME_POLICY_VERSION: 'geofence-validation-v1',
      GEOFENCE_FAIL_CLOSED: 'true',
      GEOFENCE_REQUIRE_DESTINATION_INSIDE_REGION: 'true',
      GEOFENCE_REGION_FILE: 'config/geofence.json',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false'
    });

    expect(result.status).toBe(0);
    expect(result.report.summary.blockers).toEqual([]);
    expect(result.report.summary.warnings).toContain(
      'KYC_PRODUCTION_BIOMETRICS_ENABLED=false: produção biométrica ainda não está travada em modo estrito.'
    );
    expect(result.report.diagnostics.launchControl).toEqual(expect.objectContaining({
      launchProfile: 'geofence_validation',
      pilotControlled: true,
      geofenceValidation: true,
      acceptNewPix: expect.objectContaining({ value: false }),
      acceptNewBookings: expect.objectContaining({ value: false })
    }));
  });

  it('blocks geofence validation when Pix or booking intake is enabled', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_BROAD_LAUNCH_APPROVED: 'false',
      LEAF_LAUNCH_PROFILE: 'geofence_validation',
      PILOT_ALLOWED_PASSENGER_IDS: 'passenger-1',
      PILOT_ALLOWED_DRIVER_IDS: 'driver-1',
      LEAF_ACCEPT_NEW_PIX: 'true',
      LEAF_ACCEPT_NEW_BOOKINGS: 'true',
      LEAF_RUNTIME_POLICY_VERSION: 'geofence-validation-v1',
      GEOFENCE_FAIL_CLOSED: 'true',
      GEOFENCE_REGION_FILE: 'config/geofence.json'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'LEAF_ACCEPT_NEW_PIX=true bloqueado no perfil geofence_validation',
      'LEAF_ACCEPT_NEW_BOOKINGS=true bloqueado no perfil geofence_validation'
    ]));
  });

  it('allows ride flow validation before KYC only for an acknowledged 1+1 cohort', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_BROAD_LAUNCH_APPROVED: 'false',
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation',
      LEAF_RIDE_FLOW_VALIDATION_ACK: 'true',
      PILOT_ALLOWED_PASSENGER_IDS: 'passenger-1',
      PILOT_ALLOWED_DRIVER_IDS: 'driver-1',
      LEAF_ACCEPT_NEW_PIX: 'true',
      LEAF_ACCEPT_NEW_BOOKINGS: 'true',
      LEAF_RUNTIME_POLICY_VERSION: 'ride-flow-validation-v1',
      GEOFENCE_FAIL_CLOSED: 'true',
      GEOFENCE_REQUIRE_DESTINATION_INSIDE_REGION: 'true',
      GEOFENCE_REGION_FILE: 'config/geofence.json',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_STRICT_PRODUCTION_MODE: 'false',
      KYC_AWS_LIVENESS_ENABLED: 'false',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'false',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_GENERATION: 'ride-flow-validation-2026-07-14',
      REDIS_CRITICAL_DATASET_GENERATION_KEY: 'leaf:runtime:critical-dataset:generation',
      REDIS_CRITICAL_MEMORY_WARNING_PERCENT: '60',
      REDIS_CRITICAL_MEMORY_HIGH_PERCENT: '75',
      REDIS_CRITICAL_MEMORY_CRITICAL_PERCENT: '85',
      REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS: '5000'
    });

    expect(result.status).toBe(0);
    expect(result.report.summary.blockers).toEqual([]);
    expect(result.report.summary.warnings).toContain(
      'KYC_PRODUCTION_BIOMETRICS_ENABLED=false: produção biométrica ainda não está travada em modo estrito.'
    );
    expect(result.report.diagnostics.launchControl).toEqual(expect.objectContaining({
      launchProfile: 'ride_flow_validation',
      pilotControlled: true,
      rideFlowValidation: true,
      acceptNewPix: expect.objectContaining({ value: true }),
      acceptNewBookings: expect.objectContaining({ value: true })
    }));
    expect(result.report.diagnostics.redisCriticalAuthority).toEqual(expect.objectContaining({
      required: true,
      requiredForAcceptRide: true,
      requiredForKycStrict: false,
      mode: 'redis_noeviction',
      liveAttestation: 'required_at_runtime'
    }));
  });

  it('blocks ride flow validation when redis_noeviction lacks its AcceptRide authority contract', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_BROAD_LAUNCH_APPROVED: 'false',
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation',
      LEAF_RIDE_FLOW_VALIDATION_ACK: 'true',
      PILOT_ALLOWED_PASSENGER_IDS: 'passenger-1',
      PILOT_ALLOWED_DRIVER_IDS: 'driver-1',
      LEAF_ACCEPT_NEW_PIX: 'true',
      LEAF_ACCEPT_NEW_BOOKINGS: 'true',
      LEAF_RUNTIME_POLICY_VERSION: 'ride-flow-validation-v1',
      GEOFENCE_FAIL_CLOSED: 'true',
      GEOFENCE_REGION_FILE: 'config/geofence.json',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'false',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'false',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED=true obrigatório para redis_noeviction',
      'REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED=true obrigatório para redis_noeviction',
      'REDIS_CRITICAL_DATASET_GENERATION deve identificar a geração persistente esperada'
    ]));
    expect(result.report.diagnostics.redisCriticalAuthority).toEqual(expect.objectContaining({
      required: true,
      requiredForAcceptRide: true,
      requiredForKycStrict: false
    }));
  });

  it('blocks an unsupported non-empty active-trip authority mode', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noevictin'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'KYC_ACTIVE_TRIP_AUTHORITY_MODE deve ser vazio ou redis_noeviction'
    );
    expect(result.report.diagnostics.redisCriticalAuthority).toEqual(
      expect.objectContaining({
        required: false,
        mode: 'redis_noevictin',
        modeValid: false
      })
    );
  });

  it('blocks ride flow validation without acknowledgment or an exact 1+1 cohort', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_BROAD_LAUNCH_APPROVED: 'false',
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation',
      PILOT_ALLOWED_PASSENGER_IDS: 'passenger-1,passenger-2',
      PILOT_ALLOWED_DRIVER_IDS: 'driver-1',
      LEAF_ACCEPT_NEW_PIX: 'true',
      LEAF_ACCEPT_NEW_BOOKINGS: 'true',
      LEAF_RUNTIME_POLICY_VERSION: 'ride-flow-validation-v1',
      GEOFENCE_FAIL_CLOSED: 'true',
      GEOFENCE_REGION_FILE: 'config/geofence.json'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'LEAF_RIDE_FLOW_VALIDATION_ACK=true obrigatório no perfil ride_flow_validation',
      'ride_flow_validation exige exatamente 1 passageiro na allowlist'
    ]));
  });

  it('allows production deploy with the bundled Woovi webhook public-key verifier', () => {
    const result = runValidator({
      ...baseProdEnv,
      ...strictKycProdEnv
    });

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.summary.blockers).toEqual([]);
    expect(result.report.diagnostics.redisCriticalAuthority).toEqual(
      expect.objectContaining({
        required: true,
        requiredForKycStrict: true,
        mode: 'redis_noeviction',
        modeValid: true
      })
    );
    expect(result.report.diagnostics.webhookSignature).toMatchObject({
      verifierKeysPresent: ['WOOVI_WEBHOOK_PUBLIC_KEY(default)'],
      hasVerifier: true,
      authorizationKeysPresent: [],
      hasAuthorization: false,
      providerVerificationFallback: false,
      requireSignature: {
        value: true,
        source: 'default',
        expected: true
      },
      allowUnsigned: {
        value: false,
        source: 'default',
        expected: false
      }
    });
    expect(result.report.diagnostics.authOtp).toMatchObject({
      customOtpRouteMounted: true,
      productionNonBypassMode: 'fail_closed_without_real_provider',
      debugOtp: { value: false, source: 'default' },
      testBypass: { value: false, source: 'default' },
      reviewBypass: { value: false, source: 'default' }
    });
    expect(result.report.diagnostics.financialPolicy).toMatchObject({
      approvedPolicyId: 'runtime_tiered_percent_above_50_v1',
      approvalReferenceConfigured: 'present',
      approved: true,
      activePolicy: {
        policyId: 'runtime_tiered_percent_above_50_v1',
        operationalFee: {
          above50Model: 'percentage',
          above50Percentage: 0.03
        }
      }
    });
    expect(result.report.diagnostics.coreRidePaymentGuards).toMatchObject({
      REQUIRE_PAYMENT_QUOTE_LOCK: { value: true, source: 'default', expected: true },
      REQUIRE_PAYMENT_BEFORE_BOOKING: { value: true, source: 'default', expected: true },
      VERIFY_PAYMENT_BEFORE_BOOKING: { value: true, source: 'default', expected: true },
      REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING: { value: true, source: 'default', expected: true },
      CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK: { value: false, source: 'default', expected: false },
      ENFORCE_PAYMENT_FARE_LOCK: { value: true, source: 'default', expected: true },
      REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH: { value: true, source: 'default', expected: true }
    });
    expect(result.report.sensitivePresence).toMatchObject({
      WOOVI_WEBHOOK_PUBLIC_KEY: 'default-public'
    });
  });

  it('blocks production deploy without explicit approval for the active financial policy', () => {
    const {
      LEAF_APPROVED_FINANCIAL_POLICY_ID,
      LEAF_FINANCIAL_POLICY_APPROVAL_REF,
      ...envWithoutPolicyApproval
    } = baseProdEnv;
    const result = runValidator(envWithoutPolicyApproval);

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'Política financeira ativa sem aprovação explícita: defina LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1 e LEAF_FINANCIAL_POLICY_APPROVAL_REF antes de produção'
    ]));
    expect(result.report.diagnostics.financialPolicy).toMatchObject({
      approvedPolicyId: '(empty)',
      approvalReferenceConfigured: '(empty)',
      approved: false,
      activePolicy: {
        policyId: 'runtime_tiered_percent_above_50_v1'
      }
    });
  });

  it('blocks production deploy when the approved financial policy id does not match the active code policy', () => {
    const result = runValidator({
      ...baseProdEnv,
      LEAF_APPROVED_FINANCIAL_POLICY_ID: 'fixed_149_above_20_v1',
      LEAF_FINANCIAL_POLICY_APPROVAL_REF: 'policy-test-approval'
    });

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'Política financeira ativa sem aprovação explícita: defina LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1 e LEAF_FINANCIAL_POLICY_APPROVAL_REF antes de produção'
    ]));
    expect(result.report.diagnostics.financialPolicy).toMatchObject({
      approvedPolicyId: 'fixed_149_above_20_v1',
      approvalReferenceConfigured: 'present',
      approved: false,
      activePolicy: {
        policyId: 'runtime_tiered_percent_above_50_v1'
      }
    });
  });

  it('blocks production deploy that disables Woovi x-webhook-signature validation', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_AUTHORIZATION: 'Bearer webhook-token',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'false',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'true',
      WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true obrigatório em produção'
    ]));
    expect(result.report.sensitivePresence).toMatchObject({
      WOOVI_API_TOKEN: 'present',
      WOOVI_WEBHOOK_AUTHORIZATION: 'present',
      LEAF_PIX_KEY: 'present'
    });
    expect(result.report.diagnostics.webhookSignature).toMatchObject({
      hasVerifier: true,
      hasAuthorization: true,
      providerVerificationFallback: false
    });
    expect(result.stdout).not.toContain('webhook-token');
  });

  it('allows production deploy with a configured public-key verifier and strict flags', () => {
    const result = runValidator({
      ...baseProdEnv,
      ...strictKycProdEnv,
      WOOVI_WEBHOOK_PUBLIC_KEY: 'public-key-placeholder',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED: 'true'
    });

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.summary.blockers).toEqual([]);
    expect(result.report.sensitivePresence).toMatchObject({
      WOOVI_API_TOKEN: 'present',
      WOOVI_WEBHOOK_PUBLIC_KEY: 'present',
      LEAF_PIX_KEY: 'present'
    });
    expect(result.stdout).not.toContain('public-key-placeholder');
  });

  it('allows real sandbox canary without webhook verifier only with provider verification fallback', () => {
    const result = runValidator({
      NODE_ENV: 'production',
      WOOVI_ENVIRONMENT: 'sandbox',
      WOOVI_BASE_URL: 'https://api.woovi-sandbox.com/api/v1',
      WOOVI_API_TOKEN: 'woovi-token',
      LEAF_PIX_KEY: 'pix-key',
      CORS_ORIGIN: 'https://api.leaf.example',
      KYC_AWS_COST_GUARD_ENABLED: 'true',
      KYC_AWS_COST_DAILY_LIMIT_USD: '2.50',
      KYC_AWS_COST_MONTHLY_LIMIT_USD: '50.00',
      KYC_AWS_COST_TIME_ZONE: 'UTC',
      LEAF_APPROVED_FINANCIAL_POLICY_ID: 'runtime_tiered_percent_above_50_v1',
      LEAF_FINANCIAL_POLICY_APPROVAL_REF: 'policy-test-approval',
      ...strictKycProdEnv,
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'false',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'true',
      WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED: 'true'
    });

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.summary.blockers).toEqual([]);
    expect(result.report.summary.warnings).toContain(
      'NODE_ENV=production está usando WOOVI_ENVIRONMENT diferente de production'
    );
    expect(result.report.diagnostics.webhookSignature).toMatchObject({
      verifierKeysPresent: [],
      hasVerifier: false,
      requireSignature: {
        value: false,
        source: 'env',
        expected: false
      },
      allowUnsigned: {
        value: true,
        source: 'env',
        expected: true
      },
      providerVerificationRequired: {
        value: true,
        source: 'env',
        expected: true
      }
    });
  });

  it('blocks real sandbox canary without verifier when provider verification fallback is not explicit', () => {
    const result = runValidator({
      NODE_ENV: 'production',
      WOOVI_ENVIRONMENT: 'sandbox',
      WOOVI_BASE_URL: 'https://api.woovi-sandbox.com/api/v1',
      WOOVI_API_TOKEN: 'woovi-token',
      LEAF_PIX_KEY: 'pix-key',
      CORS_ORIGIN: 'https://api.leaf.example',
      LEAF_APPROVED_FINANCIAL_POLICY_ID: 'runtime_tiered_percent_above_50_v1',
      LEAF_FINANCIAL_POLICY_APPROVAL_REF: 'policy-test-approval',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'WOOVI_WEBHOOK_REQUIRE_SIGNATURE=false obrigatório no sandbox sem verificador',
      'WOOVI_WEBHOOK_ALLOW_UNSIGNED=true obrigatório no sandbox sem verificador',
      'WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=true obrigatório no sandbox sem verificador'
    ]));
  });

  it('blocks each enabled payment bypass flag explicitly in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      PAYMENT_BYPASS_ON_WOOVI_FAILURE: 'true',
      PAYMENT_FORCE_BYPASS: 'true',
      EXPO_PUBLIC_FORCE_PAYMENT_BYPASS: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'PAYMENT_BYPASS_ON_WOOVI_FAILURE=true bloqueado em produção',
      'PAYMENT_FORCE_BYPASS=true bloqueado em produção',
      'EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=true bloqueado em produção'
    ]));
    expect(result.report.diagnostics.paymentBypass.PAYMENT_BYPASS_ON_WOOVI_FAILURE).toEqual({
      value: true,
      source: 'env'
    });
  });

  it('blocks legacy manual payment distribution in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      ENABLE_LEGACY_MANUAL_PAYMENT_DISTRIBUTION: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'ENABLE_LEGACY_MANUAL_PAYMENT_DISTRIBUTION=true bloqueado em produção'
    );
  });

  it('blocks production deploy when core ride payment guards are weakened', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      REQUIRE_PAYMENT_QUOTE_LOCK: 'false',
      REQUIRE_PAYMENT_BEFORE_BOOKING: 'false',
      VERIFY_PAYMENT_BEFORE_BOOKING: 'false',
      REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING: 'false',
      CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK: 'true',
      ENFORCE_PAYMENT_FARE_LOCK: 'false',
      REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'REQUIRE_PAYMENT_QUOTE_LOCK=false bloqueado em produção',
      'REQUIRE_PAYMENT_BEFORE_BOOKING=false bloqueado em produção',
      'VERIFY_PAYMENT_BEFORE_BOOKING=false bloqueado em produção',
      'REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING=false bloqueado em produção',
      'CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK=true bloqueado em produção',
      'ENFORCE_PAYMENT_FARE_LOCK=false bloqueado em produção',
      'REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH=false bloqueado em produção'
    ]));
    expect(result.report.diagnostics.coreRidePaymentGuards).toMatchObject({
      REQUIRE_PAYMENT_QUOTE_LOCK: { value: false, source: 'env', expected: true },
      REQUIRE_PAYMENT_BEFORE_BOOKING: { value: false, source: 'env', expected: true },
      VERIFY_PAYMENT_BEFORE_BOOKING: { value: false, source: 'env', expected: true },
      REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING: { value: false, source: 'env', expected: true },
      CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK: { value: true, source: 'env', expected: false },
      ENFORCE_PAYMENT_FARE_LOCK: { value: false, source: 'env', expected: true },
      REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH: { value: false, source: 'env', expected: true }
    });
  });

  it('blocks legacy runtime flags explicitly in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      ENABLE_LEGACY_SOCKET_BRIDGE: 'true',
      ENABLE_LEGACY_DRIVER_BAAS_FALLBACK: 'true',
      ENABLE_LEGACY_RUNTIME_ENDPOINTS: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'ENABLE_LEGACY_SOCKET_BRIDGE=true bloqueado em produção',
      'ENABLE_LEGACY_DRIVER_BAAS_FALLBACK=true bloqueado em produção',
      'ENABLE_LEGACY_RUNTIME_ENDPOINTS=true bloqueado em produção'
    ]));
    expect(result.report.diagnostics.legacyRuntime).toMatchObject({
      ENABLE_LEGACY_SOCKET_BRIDGE: {
        value: true,
        source: 'env'
      },
      ENABLE_LEGACY_DRIVER_BAAS_FALLBACK: {
        value: true,
        source: 'env'
      }
    });
  });

  it('blocks production gateway when Socket.IO Redis adapter is disabled', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      RUNTIME_ROLE: 'gateway',
      ENABLE_SOCKETIO_REDIS_ADAPTER: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'ENABLE_SOCKETIO_REDIS_ADAPTER=false bloqueado em produção para runtime gateway'
    );
    expect(result.report.diagnostics.runtime).toMatchObject({
      runtimeRole: 'gateway',
      socketRedisAdapter: {
        value: false,
        source: 'env',
        expected: true
      },
      requireSocketRedisAdapter: {
        value: true,
        expected: true
      }
    });
  });

  it('warns when production gateway disables the Socket.IO Redis adapter requirement', () => {
    const result = runValidator({
      ...baseProdEnv,
      ...strictKycProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      RUNTIME_ROLE: 'gateway',
      REQUIRE_SOCKETIO_REDIS_ADAPTER: 'false'
    });

    expect(result.status).toBe(0);
    expect(result.report.summary.warnings).toContain(
      'REQUIRE_SOCKETIO_REDIS_ADAPTER=false reduz garantia de escala horizontal do websocket'
    );
    expect(result.report.diagnostics.runtime.requireSocketRedisAdapter).toEqual({
      value: false,
      source: 'env',
      expected: true
    });
  });

  it('allows sideeffects worker validation without payment provider secrets', () => {
    const result = runValidator({
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'sideeffects'
    });

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.summary.missingCommon).toEqual([]);
    expect(result.report.summary.missingProd).toEqual([]);
    expect(result.report.summary.blockers).toEqual([]);
    expect(result.report.diagnostics.runtime).toMatchObject({
      runtimeRole: 'sideeffects',
      paymentProviderConfigRequired: false,
      requireSocketRedisAdapter: {
        value: false,
        source: 'default',
        expected: false
      }
    });
  });

  it('still blocks dangerous flags for sideeffects worker in production', () => {
    const result = runValidator({
      NODE_ENV: 'production',
      RUNTIME_ROLE: 'sideeffects',
      PAYMENT_FORCE_BYPASS: 'true',
      ENABLE_LEGACY_SOCKET_BRIDGE: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'PAYMENT_FORCE_BYPASS=true bloqueado em produção',
      'ENABLE_LEGACY_SOCKET_BRIDGE=true bloqueado em produção'
    ]));
    expect(result.report.diagnostics.runtime.paymentProviderConfigRequired).toBe(false);
  });

  it('blocks strict biometric production without AWS, face service and no-fallback config', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'KYC_AWS_LIVENESS_ENABLED=true obrigatório para produção biométrica.',
      'KYC_AWS_LIVENESS_ASSUME_ROLE_ARN obrigatório para emitir credenciais temporárias AWS.',
      'BIOMETRIC_FACE_SERVICE_URL obrigatório para comparação biométrica.',
      'BIOMETRIC_FACE_SERVICE_API_KEY obrigatório para comparação biométrica.',
      'ENABLE_CNH_FACE_BIOMETRICS=true obrigatório para gerar embedding da CNH.',
      'MOBILE_FACE_EMBEDDING_ENABLED=false obrigatório até homologação do modelo/runtime nativo.'
    ]));
    expect(result.report.diagnostics.biometricReadiness).toMatchObject({
      ok: false,
      enabled: true
    });
  });

  it('blocks adaptive identity cadence in production until strict biometrics are enabled', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_TRUST_CADENCE_ENABLED: 'true',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_GENERATION: 'prod-2026-07-13-a',
      REDIS_CRITICAL_DATASET_GENERATION_KEY: 'leaf:runtime:critical-dataset:generation',
      REDIS_CRITICAL_MEMORY_WARNING_PERCENT: '60',
      REDIS_CRITICAL_MEMORY_HIGH_PERCENT: '75',
      REDIS_CRITICAL_MEMORY_CRITICAL_PERCENT: '85',
      REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS: '5000',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '10'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'KYC_TRUST_CADENCE_ENABLED=true em produção exige KYC_PRODUCTION_BIOMETRICS_ENABLED=true'
    );
  });

  it('reports firebase diagnostics with all vars configured', () => {
    const result = runValidator({
      ...baseProdEnv,
      ...strictKycProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      FIREBASE_DATABASE_URL: 'https://leaf-test.firebaseio.com',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"dummy":true}'
    });

    expect(result.status).toBe(0);
    expect(result.report.diagnostics.firebase).toMatchObject({
      databaseUrlConfigured: 'present',
      serviceAccountConfigured: true,
      configured: true
    });
  });

  it('reports firebase diagnostics as unconfigured when all vars absent', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false'
    });

    expect(result.report.diagnostics.firebase).toMatchObject({
      configured: false,
      serviceAccountConfigured: false
    });
  });

  it('warns about missing firebase and maps config in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false'
    });

    expect(result.report.summary.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('FIREBASE_DATABASE_URL ausente'),
        expect.stringContaining('Credenciais Firebase ausentes'),
        expect.stringContaining('GOOGLE_MAPS_API_KEY ausente')
      ])
    );
  });

  it('reports maps diagnostics with key configured and masks secrets', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      GOOGLE_MAPS_API_KEY: 'maps-key',
      ENABLE_PLACES_CACHE: 'true',
      GEO_KEY: 'geo-key'
    });

    expect(result.report.diagnostics.maps).toMatchObject({
      keyConfigured: true,
      clientDirectGoogleFallbackAllowed: false,
      placesCacheEnabled: { value: true, source: 'env' },
      receiptMapImagesConfigured: true
    });
    expect(result.stdout).not.toContain('maps-key');
    expect(result.stdout).not.toContain('geo-key');
  });

  it('reports places cache enabled by default unless explicitly disabled', () => {
    const enabledByDefault = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      GOOGLE_MAPS_API_KEY: 'maps-key'
    });

    expect(enabledByDefault.report.diagnostics.maps.placesCacheEnabled).toEqual({
      value: true,
      source: 'default'
    });
    expect(enabledByDefault.report.diagnostics.maps.receiptMapImagesConfigured).toBe(true);

    const disabledExplicitly = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      GOOGLE_MAPS_API_KEY: 'maps-key',
      ENABLE_PLACES_CACHE: 'false'
    });

    expect(disabledExplicitly.report.diagnostics.maps.placesCacheEnabled).toEqual({
      value: false,
      source: 'env'
    });
  });

  it('blocks production when EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK is true', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      GOOGLE_MAPS_API_KEY: 'maps-key',
      EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.summary.blockers).toContain(
      'EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK=true bloqueado em produção: client-side Google fallback expõe chave de API'
    );
    expect(result.report.diagnostics.maps.clientDirectGoogleFallbackAllowed).toBe(true);
    expect(result.stdout).not.toContain('maps-key');
  });

  it('blocks custom OTP debug mode in production', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      DEBUG_OTP: 'true'
    });

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.summary.blockers).toContain('DEBUG_OTP=true bloqueado em produção');
    expect(result.report.diagnostics.authOtp.debugOtp).toEqual({
      value: true,
      source: 'env'
    });
  });

  it('reports push diagnostics with FCM configured', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      FCM_SERVER_KEY: 'fcm-key',
      ALLOW_PUBLIC_DIRECT_FCM_SEND: 'true',
      ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE: 'true'
    });

    expect(result.report.diagnostics.push).toMatchObject({
      fcmConfigured: true,
      provider: 'legacy-fcm-server-key',
      allowPublicDirectFcmSend: { value: true, source: 'env' },
      demandNotificationServiceEnabled: { value: true, source: 'env' },
      liveActivity: {
        apnsConfigured: false,
        keyIdConfigured: false,
        teamIdConfigured: false,
        privateKeyConfigured: false,
        bundleId: '(empty)',
        environment: 'production'
      }
    });
    expect(result.stdout).not.toContain('fcm-key');
  });

  it('reports Firebase Admin credentials as the production FCM provider', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"leaf-test"}',
      LEAF_APNS_KEY_ID: 'apns-key-id',
      LEAF_APNS_TEAM_ID: 'DTA8W5KA5D',
      LEAF_APNS_PRIVATE_KEY_PATH: '/secure/AuthKey_6Z45T8R37W.p8',
      LEAF_APNS_BUNDLE_ID: 'br.com.leaf.ride',
      LEAF_APNS_ENV: 'production'
    });

    expect(result.report.diagnostics.push).toMatchObject({
      fcmConfigured: true,
      provider: 'firebase-admin',
      liveActivity: {
        apnsConfigured: true,
        keyIdConfigured: true,
        teamIdConfigured: true,
        privateKeyConfigured: true,
        bundleId: 'present',
        environment: 'production'
      }
    });
    expect(result.stdout).not.toContain('apns-key-id');
    expect(result.stdout).not.toContain('DTA8W5KA5D');
    expect(result.stdout).not.toContain('AuthKey_6Z45T8R37W');
  });

  it('allows strict biometric production when all required controls are configured', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
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
      BIOMETRIC_FACE_SERVICE_URL: 'https://face.leaf.internal',
      BIOMETRIC_FACE_SERVICE_API_KEY: 'face-key',
      ENABLE_CNH_FACE_BIOMETRICS: 'true',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_GENERATION: 'prod-2026-07-13-a',
      REDIS_CRITICAL_DATASET_GENERATION_KEY: 'leaf:runtime:critical-dataset:generation',
      REDIS_CRITICAL_MEMORY_WARNING_PERCENT: '60',
      REDIS_CRITICAL_MEMORY_HIGH_PERCENT: '75',
      REDIS_CRITICAL_MEMORY_CRITICAL_PERCENT: '85',
      REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS: '5000',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '10'
    });

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.diagnostics.biometricReadiness).toMatchObject({
      ok: true,
      enabled: true
    });
    expect(result.report.diagnostics.adaptiveKycCadence).toMatchObject({
      enabled: { value: true, source: 'env' },
      onlineGate: { value: true, source: 'env' },
      activeTripIndex: { value: true, source: 'default' },
      policyVersion: 'driver_identity_recurring_v2',
      promotionRequirements: {
        observedMinDistinctSuccessDays: 7,
        trustedMinAgeDays: 30,
        trustedMinSuccessCount: 14,
        trustedMinDistinctSuccessDays: 14
      },
      randomAuditPercent: 10,
      verificationDuringActiveRide: false,
      referenceImageMode: 'inline_bytes'
    });
    expect(result.report.diagnostics.redisCriticalAuthority).toMatchObject({
      required: true,
      mode: 'redis_noeviction',
      datasetGenerationConfigured: true,
      datasetGenerationKeyConfigured: true,
      memoryThresholds: {
        warningPercent: 60,
        highPercent: 75,
        criticalPercent: 85
      },
      memoryThresholdsApproved: true,
      attestationCacheTtlMs: 5000,
      tripLocationStream: {
        enabled: { value: true, source: 'default' },
        requiredConsumerGroup: 'trip-location-workers',
        maxConsumerIdleMs: 30000,
        safeTrimThreshold: 500000,
        liveConsumerAttestation: 'required_at_runtime'
      },
      liveAttestation: 'required_at_runtime'
    });
    expect(result.stdout).not.toContain('face-key');
  });

  it('blocks redis_noeviction activation without attestation, quarantine and generation policy', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'false',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'false',
      REDIS_CRITICAL_DATASET_GENERATION: '',
      REDIS_CRITICAL_MEMORY_WARNING_PERCENT: '50',
      REDIS_CRITICAL_MEMORY_HIGH_PERCENT: '70',
      REDIS_CRITICAL_MEMORY_CRITICAL_PERCENT: '90',
      REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS: '6000'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED=true obrigatório para redis_noeviction',
      'REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED=true obrigatório para redis_noeviction',
      'REDIS_CRITICAL_DATASET_GENERATION deve identificar a geração persistente esperada',
      'Thresholds Redis críticos devem permanecer exatamente em 60/75/85',
      'REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS deve ficar entre 0 e 5000ms'
    ]));
  });

  it('blocks redis_noeviction when the trip-location worker or Firestore persistence is disabled', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_GENERATION: 'prod-2026-07-14-a',
      ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER: 'false',
      ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER=true obrigatório para redis_noeviction',
      'ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE=true obrigatório para redis_noeviction'
    ]));
    expect(result.report.diagnostics.redisCriticalAuthority.tripLocationStream).toEqual(
      expect.objectContaining({
        persistenceWorkerEnabled: { value: false, source: 'env' },
        firestorePersistenceEnabled: { value: false, source: 'env' }
      })
    );
  });

  it('blocks an unsafe trip-location retention threshold in redis_noeviction mode', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_GENERATION: 'prod-2026-07-13-a',
      TRIP_LOCATION_STREAM_SAFE_TRIM_THRESHOLD: '99999'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'TRIP_LOCATION_STREAM_SAFE_TRIM_THRESHOLD deve ser inteiro e no mínimo 100000'
    );
  });

  it('blocks an unsafe live-consumer idle limit only while the trip-location stream is enabled', () => {
    const strictEnv = {
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_GENERATION: 'prod-2026-07-13-a',
      TRIP_LOCATION_CONSUMER_MAX_IDLE_MS: '300001'
    };
    const enabledResult = runValidator(strictEnv);

    expect(enabledResult.status).toBe(1);
    expect(enabledResult.report.summary.blockers).toContain(
      'TRIP_LOCATION_CONSUMER_MAX_IDLE_MS deve ser inteiro entre 1000 e 300000ms'
    );

    const disabledResult = runValidator({
      ...strictEnv,
      ENABLE_TRIP_LOCATION_STREAM: 'false'
    });
    expect(disabledResult.report.summary.blockers).not.toContain(
      'TRIP_LOCATION_CONSUMER_MAX_IDLE_MS deve ser inteiro entre 1000 e 300000ms'
    );
  });

  it('blocks an invalid trip-location boolean instead of silently treating it as enabled', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
      REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
      REDIS_CRITICAL_DATASET_GENERATION: 'generation-rc1',
      ENABLE_TRIP_LOCATION_STREAM: 'treu'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'ENABLE_TRIP_LOCATION_STREAM deve ser booleano explícito em redis_noeviction'
    );
    expect(result.report.diagnostics.redisCriticalAuthority.tripLocationStream.booleanValid)
      .toBe(false);
  });

  it('blocks the AWS canonical profile when approval threshold is below 0.95', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_STRICT_PRODUCTION_MODE: 'true',
      KYC_FACE_COMPARE_PROVIDER: 'aws_rekognition_compare_faces',
      KYC_AWS_COMPARE_FACES_ENABLED: 'true',
      KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD: '0.90',
      KYC_AWS_COMPARE_FACES_REVIEW_THRESHOLD: '0.80'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'KYC_AWS_COMPARE_FACES_APPROVE_THRESHOLD deve ser pelo menos 0.95 no fluxo AWS canônico.'
    );
  });

  it('blocks strict biometric production when Firestore positive authority is not explicit', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_STRICT_PRODUCTION_MODE: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'KYC_STRICT_PRODUCTION_MODE=true obrigatório para usar somente Firestore como autoridade KYC positiva.'
    );
    expect(result.report.diagnostics.biometricReadiness.policy.strictProductionMode).toBe(false);
  });

  it('blocks strict biometric production when the active-trip guard is disabled', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_CREDENTIALS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/leaf-liveness',
      KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID: 'external-binding',
      KYC_AWS_LIVENESS_STS_SESSION_NAME_PREFIX: 'leaf-liveness',
      KYC_AWS_CREDENTIAL_SOURCE: 'static',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      BIOMETRIC_FACE_SERVICE_URL: 'https://face.leaf.internal',
      BIOMETRIC_FACE_SERVICE_API_KEY: 'face-key',
      ENABLE_CNH_FACE_BIOMETRICS: 'true',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '10',
      ENABLE_ACTIVE_TRIP_INDEX: 'false'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toContain(
      'KYC_PRODUCTION_BIOMETRICS_ENABLED=true exige ENABLE_ACTIVE_TRIP_INDEX=true em produção'
    );
  });

  it('blocks invalid random audit and S3-only reference output for adaptive cadence', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/leaf-liveness',
      KYC_AWS_LIVENESS_S3_BUCKET: 'leaf-liveness-output',
      BIOMETRIC_FACE_SERVICE_URL: 'https://face.leaf.internal',
      BIOMETRIC_FACE_SERVICE_API_KEY: 'face-key',
      ENABLE_CNH_FACE_BIOMETRICS: 'true',
      MOBILE_FACE_EMBEDDING_ENABLED: 'false',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false',
      KYC_TRUST_CADENCE_ENABLED: 'true',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '0'
    });

    expect(result.status).toBe(1);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'KYC_TRUSTED_RANDOM_AUDIT_PERCENT deve ser exatamente 10 na política driver_identity_recurring_v2',
      'KYC_AWS_LIVENESS_S3_BUCKET deve permanecer vazio com cadência adaptativa até o backend suportar ReferenceImage.S3Object'
    ]));
  });

  it('blocks adaptive cadence policy drift but ignores it while cadence is disabled', () => {
    const drifted = runValidator({
      ...baseProdEnv,
      KYC_TRUST_CADENCE_ENABLED: 'true',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_TRUST_POLICY_VERSION: 'driver_identity_recurring_v1',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '5',
      KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS: '6',
      KYC_TRUST_T2_MIN_AGE_DAYS: '29',
      KYC_TRUST_T2_MIN_SUCCESS_COUNT: '14',
      KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS: '7'
    });

    expect(drifted.report.summary.blockers).toEqual(expect.arrayContaining([
      'KYC_TRUST_POLICY_VERSION deve ser driver_identity_recurring_v2 quando a cadência adaptativa estiver ativa',
      'KYC_TRUSTED_RANDOM_AUDIT_PERCENT deve ser exatamente 10 na política driver_identity_recurring_v2',
      'KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS deve ser exatamente 7 na política driver_identity_recurring_v2',
      'KYC_TRUST_T2_MIN_AGE_DAYS deve ser exatamente 30 na política driver_identity_recurring_v2',
      'KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS deve ser exatamente 14 na política driver_identity_recurring_v2'
    ]));

    const legacy = runValidator({
      ...baseProdEnv,
      KYC_TRUST_CADENCE_ENABLED: 'false',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '5',
      KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS: '6',
      KYC_TRUST_T2_MIN_AGE_DAYS: '29',
      KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS: '7'
    });

    expect(legacy.report.summary.blockers.filter((message) => (
      message.includes('KYC_TRUST_POLICY_VERSION')
      || message.includes('KYC_TRUSTED_RANDOM_AUDIT_PERCENT')
      || message.includes('KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS')
      || message.includes('KYC_TRUST_T2_MIN_AGE_DAYS')
      || message.includes('KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS')
    ))).toEqual([]);
    expect(legacy.report.diagnostics.adaptiveKycCadence.policyVersion)
      .toBe('driver_identity_recurring_v1');
  });

  it('blocks stricter values under recurring-v2 until code and version change together', () => {
    const result = runValidator({
      ...baseProdEnv,
      KYC_TRUST_CADENCE_ENABLED: 'true',
      DAILY_KYC_ONLINE_GATE_ENABLED: 'true',
      KYC_TRUST_POLICY_VERSION: 'driver_identity_recurring_v2',
      KYC_TRUST_T0_MAX_AGE_HOURS: '12',
      KYC_TRUST_T1_MAX_AGE_HOURS: '48',
      KYC_TRUST_T2_MAX_AGE_HOURS: '120',
      KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS: '8',
      KYC_TRUST_T2_MIN_AGE_DAYS: '31',
      KYC_TRUST_T2_MIN_SUCCESS_COUNT: '15',
      KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS: '15',
      KYC_TRUSTED_RANDOM_AUDIT_PERCENT: '100'
    });

    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'KYC_TRUSTED_RANDOM_AUDIT_PERCENT deve ser exatamente 10 na política driver_identity_recurring_v2',
      'KYC_TRUST_T0_MAX_AGE_HOURS deve ser exatamente 24 na política driver_identity_recurring_v2',
      'KYC_TRUST_T1_MAX_AGE_HOURS deve ser exatamente 72 na política driver_identity_recurring_v2',
      'KYC_TRUST_T2_MAX_AGE_HOURS deve ser exatamente 168 na política driver_identity_recurring_v2',
      'KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS deve ser exatamente 7 na política driver_identity_recurring_v2',
      'KYC_TRUST_T2_MIN_AGE_DAYS deve ser exatamente 30 na política driver_identity_recurring_v2',
      'KYC_TRUST_T2_MIN_SUCCESS_COUNT deve ser exatamente 14 na política driver_identity_recurring_v2',
      'KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS deve ser exatamente 14 na política driver_identity_recurring_v2'
    ]));
  });
});
