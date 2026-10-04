const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('local native build environment', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-local-build-env-'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(path.resolve(__dirname, '../scripts/source-local-build-env.sh'), path.join(root, 'scripts/source-local-build-env.sh'));
    fs.writeFileSync(path.join(root, '.env'), 'EXPO_PUBLIC_API_URL=http://localhost:3001\n');
    fs.writeFileSync(path.join(root, 'eas.json'), JSON.stringify({ build: {
      production: { env: { EXPO_PUBLIC_API_URL: 'https://api.leaf.app.br', EXPO_PUBLIC_LEAF_LAUNCH_PROFILE: 'pilot_controlled' } },
      development: {},
    } }));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function run(overrides = {}) {
    const env = { ...process.env, EAS_BUILD_PROFILE: 'production', LEAF_ENV_FILE: '', ...overrides };
    delete env.EXPO_PUBLIC_API_URL;
    delete env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE;
    return spawnSync('bash', ['-c', 'source scripts/source-local-build-env.sh && load_eas_build_profile_env && node -e \'console.log(JSON.stringify({api:process.env.EXPO_PUBLIC_API_URL,profile:process.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE}))\''], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  }

  it('replaces stale local public values with the selected EAS release profile', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ api: 'https://api.leaf.app.br', profile: 'pilot_controlled' });
  });

  it('preserves a separately selected QA env instead of merging release values', () => {
    fs.writeFileSync(path.join(root, '.env.qa'), 'EXPO_PUBLIC_API_URL=https://api.qa.example.test\n');
    const result = run({ LEAF_ENV_FILE: '.env.qa' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ api: 'https://api.qa.example.test' });
  });

  it('fails closed when the selected env file or EAS profile does not exist', () => {
    expect(run({ LEAF_ENV_FILE: '.env.missing' }).status).not.toBe(0);
    expect(run({ EAS_BUILD_PROFILE: 'unknown' }).status).not.toBe(0);
  });

  it('allows development profiles without public env overrides', () => {
    expect(run({ EAS_BUILD_PROFILE: 'development' }).status).toBe(0);
  });
});
