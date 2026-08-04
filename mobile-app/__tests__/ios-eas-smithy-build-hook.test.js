const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');

describe('iOS EAS Smithy build hook', () => {
  it('registers the post-install hook used by EAS Build', () => {
    const packageJson = require('../package.json');

    expect(packageJson.scripts['eas-build-post-install']).toBe(
      'bash scripts/eas-build-post-install.sh',
    );
  });

  it('limits the Xcode trust override to iOS and uses the canonical key', () => {
    const hook = fs.readFileSync(
      path.join(mobileRoot, 'scripts/eas-build-post-install.sh'),
      'utf8',
    );

    expect(hook).toContain('EAS_BUILD_PLATFORM:-}');
    expect(hook).toContain('!= "ios"');
    expect(hook).toContain(
      'IDESkipPackagePluginFingerprintValidatation -bool YES',
    );
    expect(hook).not.toContain('IDESkipMacroFingerprintValidation -bool YES');
  });
});
