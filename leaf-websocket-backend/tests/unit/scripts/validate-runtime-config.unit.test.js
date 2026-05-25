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
    CORS_ORIGIN: 'https://api.leaf.example'
  };

  it('blocks production deploy without webhook signature verifier and strict flags', () => {
    const result = runValidator(baseProdEnv);

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.summary.blockers).toEqual(expect.arrayContaining([
      'Webhook Woovi/OpenPix em produção exige ao menos um verificador de assinatura: WOOVI_WEBHOOK_PUBLIC_KEY, OPENPIX_WEBHOOK_PUBLIC_KEY, WOOVI_WEBHOOK_SIGNATURE_SECRET, OPENPIX_WEBHOOK_SIGNATURE_SECRET, WOOVI_WEBHOOK_HMAC_SECRET ou OPENPIX_WEBHOOK_HMAC_SECRET',
      'WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true obrigatório em produção',
      'WOOVI_WEBHOOK_ALLOW_UNSIGNED=false obrigatório em produção'
    ]));
    expect(result.report.diagnostics.webhookSignature).toMatchObject({
      verifierKeysPresent: [],
      hasVerifier: false,
      requireSignature: {
        value: false,
        source: 'default',
        expected: true
      },
      allowUnsigned: {
        value: true,
        source: 'default',
        expected: false
      }
    });
  });

  it('allows production deploy with a configured verifier and strict flags', () => {
    const result = runValidator({
      ...baseProdEnv,
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'woovi-secret',
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: 'false',
      WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED: 'true'
    });

    expect(result.status).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.summary.blockers).toEqual([]);
    expect(result.report.sensitivePresence).toMatchObject({
      WOOVI_API_TOKEN: 'present',
      WOOVI_WEBHOOK_SIGNATURE_SECRET: 'present',
      LEAF_PIX_KEY: 'present'
    });
    expect(result.stdout).not.toContain('woovi-secret');
  });

  it('allows real sandbox canary without webhook verifier only with provider verification fallback', () => {
    const result = runValidator({
      NODE_ENV: 'production',
      WOOVI_ENVIRONMENT: 'sandbox',
      WOOVI_BASE_URL: 'https://api.woovi-sandbox.com/api/v1',
      WOOVI_API_TOKEN: 'woovi-token',
      LEAF_PIX_KEY: 'pix-key',
      CORS_ORIGIN: 'https://api.leaf.example',
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
        expected: true
      },
      allowUnsigned: {
        value: true,
        source: 'env',
        expected: false
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
});
