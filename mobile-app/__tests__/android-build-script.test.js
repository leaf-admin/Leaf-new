const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(
  path.resolve(__dirname, '../scripts/build-local-android.sh'),
  'utf8',
);

describe('local Android build script', () => {
  it('resolves AppConfig from the mobile project regardless of caller cwd', () => {
    expect(script).toContain(
      'expected_version_code="$(cd "${PROJECT_DIR}" && node -e "console.log(require(\'./config/AppConfig\').AppConfig.android_app_version)")"',
    );
    expect(script).toContain(
      'expected_version_name="$(cd "${PROJECT_DIR}" && node -e "console.log(require(\'./config/AppConfig\').AppConfig.ios_app_version)")"',
    );
  });
});
