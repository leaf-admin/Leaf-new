const path = require('path');
const { spawnSync } = require('child_process');

describe('production runtime launcher isolation', () => {
  const backendDir = path.resolve(__dirname, '../../..');
  const script = path.join(backendDir, 'scripts/runtime/start-server.sh');

  function runWith(overrides) {
    return spawnSync('bash', [script], {
      cwd: backendDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        LEAF_SKIP_RUNTIME_CONFIG_VALIDATION: 'false',
        ...overrides
      },
      encoding: 'utf8',
      timeout: 5000
    });
  }

  it.each(['vps', 'custom'])(
    'refuses the %s entrypoint before executing application code',
    (runtime) => {
      const result = runWith({
        LEAF_SERVER_RUNTIME: runtime,
        LEAF_SERVER_ENTRY: 'server.js'
      });

      expect(result.status).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'Produção aceita somente LEAF_SERVER_RUNTIME=modular'
      );
    }
  );

  it('refuses the production config-validation bypass', () => {
    const result = runWith({
      LEAF_SERVER_RUNTIME: 'modular',
      LEAF_SKIP_RUNTIME_CONFIG_VALIDATION: 'true'
    });

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Validação de configuração não pode ser ignorada em produção'
    );
  });

  it('normalizes production casing and whitespace before applying isolation', () => {
    const result = runWith({
      NODE_ENV: ' Production ',
      LEAF_SERVER_RUNTIME: 'vps'
    });

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Produção aceita somente LEAF_SERVER_RUNTIME=modular'
    );
  });
});
