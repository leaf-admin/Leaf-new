const fs = require('fs');
const path = require('path');

const splashSource = fs.readFileSync(
  path.join(__dirname, '../src/screens/SplashScreen.js'),
  'utf8'
);

describe('SplashScreen QA seed restoration guard', () => {
  it('requires the explicit TEST_USER_TOOLS runtime policy before rebuilding QA profiles', () => {
    expect(splashSource).toContain(
      'allowTestUserTools,'
    );
    expect(splashSource).toContain(
      'allowTestUserTools() && isSimulatorBuild() && isE2ETestBuild()'
    );
    expect(splashSource).toContain('isProfileIdentityConsistent({');
    expect(splashSource).toContain('storedUid && canRestoreQaSeed');
    expect(splashSource).toContain('const rebuiltQaProfile = canRestoreQaSeed');
  });
});
