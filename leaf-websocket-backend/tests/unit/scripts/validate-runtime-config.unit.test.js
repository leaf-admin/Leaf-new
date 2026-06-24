const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '../../..');
const validatorPath = path.join(backendRoot, 'scripts/deploy/validate-runtime-config.js');
const absentEnvFile = path.join(backendRoot, '.env.test-does-not-exist');

function runValidator(extraEnv = {}) {
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: backendRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ENV_FILE: absentEnvFile,
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
    LEAF_APPROVED_FINANCIAL_POLICY_ID: 'runtime_tiered_percent_above_50_v1',
    LEAF_FINANCIAL_POLICY_APPROVAL_REF: 'policy-test-approval'
  };

  it('allows production deploy with the bundled Woovi webhook public-key verifier', () => {
    const result = runValidator(baseProdEnv);

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.summary.blockers).toEqual([]);
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
      LEAF_APPROVED_FINANCIAL_POLICY_ID: 'runtime_tiered_percent_above_50_v1',
      LEAF_FINANCIAL_POLICY_APPROVAL_REF: 'policy-test-approval',
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
      'ENABLE_CNH_FACE_BIOMETRICS=true obrigatório para gerar embedding da CNH.'
    ]));
    expect(result.report.diagnostics.biometricReadiness).toMatchObject({
      ok: false,
      enabled: true
    });
  });

  it('reports firebase diagnostics with all vars configured', () => {
    const result = runValidator({
      ...baseProdEnv,
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
      allowPublicDirectFcmSend: { value: true, source: 'env' },
      demandNotificationServiceEnabled: { value: true, source: 'env' }
    });
    expect(result.stdout).not.toContain('fcm-key');
  });

  it('allows strict biometric production when all required controls are configured', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ENABLED: 'true',
      KYC_AWS_LIVENESS_ASSUME_ROLE_ARN: 'arn:aws:iam::123456789012:role/leaf-liveness',
      BIOMETRIC_FACE_SERVICE_URL: 'https://face.leaf.internal',
      BIOMETRIC_FACE_SERVICE_API_KEY: 'face-key',
      ENABLE_CNH_FACE_BIOMETRICS: 'true',
      KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH: 'true',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'false',
      KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH: 'false'
    });

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.diagnostics.biometricReadiness).toMatchObject({
      ok: true,
      enabled: true
    });
    expect(result.stdout).not.toContain('face-key');
  });
});
