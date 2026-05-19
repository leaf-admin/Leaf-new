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
      'Webhook Woovi/OpenPix em produção exige WOOVI_WEBHOOK_PUBLIC_KEY ou WOOVI_WEBHOOK_SIGNATURE_SECRET',
      'WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true obrigatório em produção',
      'WOOVI_WEBHOOK_ALLOW_UNSIGNED=false obrigatório em produção'
    ]));
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
  });
});
