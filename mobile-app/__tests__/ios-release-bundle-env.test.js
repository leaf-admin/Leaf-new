const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const buildScript = fs.readFileSync(path.resolve(__dirname, '../scripts/build-local-ios.sh'), 'utf8');
const exportScript = fs.readFileSync(path.resolve(__dirname, '../scripts/export-local-ios-ipa.sh'), 'utf8');
const guard = exportScript.slice(
  exportScript.indexOf('assert_bundle_has_release_env() {'),
  exportScript.indexOf('\nmain() {')
);

const releaseEnv = {
  EXPO_PUBLIC_API_URL: 'https://api.leaf.app.br',
  EXPO_PUBLIC_SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/42',
  EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_testkey_not_real_0001',
};

describe('iOS release bundle carries the production profile', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ios-bundle-env-'));
    fs.mkdirSync(path.join(root, 'Payload', 'Leaf.app'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function check(bundle) {
    fs.writeFileSync(path.join(root, 'Payload', 'Leaf.app', 'main.jsbundle'), bundle);
    return spawnSync('bash', ['-c', `${guard}\nassert_bundle_has_release_env "$1"`, 'guard', root], {
      env: { ...process.env, ...releaseEnv, EAS_BUILD_PROFILE: 'production' },
      encoding: 'utf8',
      timeout: 15000,
    });
  }

  it('accepts a bundle with API, Sentry and PostHog values (UTF-8 or Hermes UTF-16)', () => {
    const utf8 = check(Buffer.from(Object.values(releaseEnv).join('\n')));
    expect(utf8.status).toBe(0);
    const utf16 = check(Buffer.concat(Object.values(releaseEnv).map((v) => Buffer.from(v, 'utf16le'))));
    expect(utf16.status).toBe(0);
  });

  it('refuses a bundle built without the profile and never prints the values', () => {
    const result = check(Buffer.from(releaseEnv.EXPO_PUBLIC_API_URL));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('EXPO_PUBLIC_SENTRY_DSN EXPO_PUBLIC_POSTHOG_API_KEY');
    expect(result.stdout + result.stderr).not.toContain(releaseEnv.EXPO_PUBLIC_POSTHOG_API_KEY);
  });

  it('the export runs the guard on every IPA', () => {
    const assertBody = exportScript.slice(exportScript.indexOf('assert_exported_ipa() {'), exportScript.indexOf('assert_bundle_has_release_env() {'));
    expect(assertBody).toContain('assert_bundle_has_release_env "${tmp_dir}"');
  });

  it('the archive loads the EAS production profile and writes a source map before xcodebuild', () => {
    const archive = buildScript.slice(buildScript.indexOf('    archive)'));
    const xcodebuildIndex = archive.indexOf('xcodebuild');
    expect(archive.indexOf('export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-production}"')).toBeGreaterThan(-1);
    expect(archive.indexOf('load_eas_build_profile_env')).toBeGreaterThan(-1);
    expect(archive.indexOf('load_eas_build_profile_env')).toBeLessThan(xcodebuildIndex);
    expect(archive.indexOf('export SOURCEMAP_FILE="${SOURCEMAP_FILE:-')).toBeLessThan(xcodebuildIndex);
  });
});
