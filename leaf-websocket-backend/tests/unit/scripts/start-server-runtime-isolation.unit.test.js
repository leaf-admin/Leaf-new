const path = require('path');
const fs = require('fs');
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

  it('fixes server.js as the only entrypoint without runtime selectors', () => {
    const source = fs.readFileSync(script, 'utf8');

    expect(source).toContain('ENTRY_FILE="server.js"');
    expect(source).toContain('exec node "$ENTRY_FILE"');
    expect(source).not.toContain(['LEAF', 'SERVER', 'RUNTIME'].join('_'));
    expect(source).not.toContain(['LEAF', 'SERVER', 'ENTRY'].join('_'));
  });

  it('refuses the production config-validation bypass', () => {
    const result = runWith({
      LEAF_SKIP_RUNTIME_CONFIG_VALIDATION: 'true'
    });

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Validação de configuração não pode ser ignorada em produção'
    );
  });
});
