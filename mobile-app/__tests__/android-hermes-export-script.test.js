const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(
  path.join(__dirname, '../scripts/export-android-bytecode.sh'),
  'utf8',
);

describe('Android Hermes export script', () => {
  it('supports both standalone and hoisted workspace installations', () => {
    expect(script).toContain(
      'LOCAL_HERMES_BIN="$ROOT_DIR/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"',
    );
    expect(script).toContain(
      'WORKSPACE_HERMES_BIN="$ROOT_DIR/../node_modules/react-native/sdks/hermesc/osx-bin/hermesc"',
    );
  });

  it('uses the workspace Hermes compiler when the local binary is absent', () => {
    expect(script).toMatch(
      /if \[ -x "\$LOCAL_HERMES_BIN" \]; then[\s\S]*elif \[ -x "\$WORKSPACE_HERMES_BIN" \]; then[\s\S]*HERMES_SOURCE_BIN="\$WORKSPACE_HERMES_BIN"/,
    );
  });
});
