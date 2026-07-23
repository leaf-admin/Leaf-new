const fs = require('fs');
const path = require('path');

const navigatorSource = fs.readFileSync(
  path.join(__dirname, '../src/navigation/AppNavigator.js'),
  'utf8',
);

describe('passenger search map composition', () => {
  it('keeps the native map and search sheet in the focused iOS route', () => {
    expect(navigatorSource).toContain('function RobotaxiDriverSearchMapScreen(props)');
    expect(navigatorSource).toContain('<RobotaxiPrototypeScreen {...props} />');
    expect(navigatorSource).toContain('<RobotaxiDriverSearchScreen {...props} />');
    expect(navigatorSource).toMatch(
      /name="RobotaxiPrototypeDriverSearch"[\s\S]*component=\{RobotaxiDriverSearchMapScreen\}[\s\S]*options=\{prototypeOverlayScreenOptions\}/,
    );
  });
});
