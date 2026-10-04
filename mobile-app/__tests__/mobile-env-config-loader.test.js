const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = [
  'LEAF_ENV_FILE',
  'EXPO_PUBLIC_API_URL',
  'LEAF_QA_MARKER',
  'LEAF_PRODUCTION_MARKER',
  'GOOGLE_MAPS_API_KEY',
  'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY',
];

describe('mobile app config environment loader', () => {
  let projectRoot;
  let previousEnv;

  beforeEach(() => {
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-mobile-env-'));
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
    jest.resetModules();
  });

  it('loads only the explicitly selected env file instead of merging defaults', () => {
    fs.writeFileSync(path.join(projectRoot, '.env'), 'LEAF_PRODUCTION_MARKER=production\n');
    fs.writeFileSync(path.join(projectRoot, '.env.qa'), 'EXPO_PUBLIC_API_URL=https://api.qa.example.test\nLEAF_QA_MARKER=qa\n');
    process.env.LEAF_ENV_FILE = '.env.qa';

    require('../config/loadConfigEnv').loadConfigEnv(projectRoot);

    expect(process.env.EXPO_PUBLIC_API_URL).toBe('https://api.qa.example.test');
    expect(process.env.LEAF_QA_MARKER).toBe('qa');
    expect(process.env.LEAF_PRODUCTION_MARKER).toBeUndefined();
  });

  it('gives values in an explicit env file precedence over inherited shell values', () => {
    fs.writeFileSync(path.join(projectRoot, '.env.qa'), 'EXPO_PUBLIC_API_URL=https://api.qa.example.test\n');
    process.env.LEAF_ENV_FILE = '.env.qa';
    process.env.EXPO_PUBLIC_API_URL = 'https://api.leaf.app.br';

    require('../config/loadConfigEnv').loadConfigEnv(projectRoot);

    expect(process.env.EXPO_PUBLIC_API_URL).toBe('https://api.qa.example.test');
  });

  it('fails closed when the selected env file is missing', () => {
    process.env.LEAF_ENV_FILE = '.env.missing';

    expect(() => require('../config/loadConfigEnv').loadConfigEnv(projectRoot)).toThrow(
      'LEAF_ENV_FILE points to a missing file.',
    );
  });

  it('preserves the existing default env-file priority when no override is selected', () => {
    fs.writeFileSync(path.join(projectRoot, '.env'), 'LEAF_QA_MARKER=base\n');
    fs.writeFileSync(path.join(projectRoot, '.env.local'), 'LEAF_QA_MARKER=local\nLEAF_PRODUCTION_MARKER=production\n');

    require('../config/loadConfigEnv').loadConfigEnv(projectRoot);

    expect(process.env.LEAF_QA_MARKER).toBe('base');
    expect(process.env.LEAF_PRODUCTION_MARKER).toBe('production');
  });
});
