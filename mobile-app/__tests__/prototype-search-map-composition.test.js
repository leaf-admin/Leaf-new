const fs = require('fs');
const path = require('path');

const navigatorSource = fs.readFileSync(
  path.join(__dirname, '../src/navigation/AppNavigator.js'),
  'utf8',
);

describe('passenger search map composition', () => {
  it('shows the search as a transparent overlay over the home map instead of a second map', () => {
    // A second RobotaxiPrototypeScreen meant a second Google map during the search (~+380 MB on iPhone).
    expect(navigatorSource).not.toContain('function RobotaxiDriverSearchMapScreen(props)');
    expect(navigatorSource).toMatch(
      /name="RobotaxiPrototypeDriverSearch"[\s\S]*?component=\{RobotaxiDriverSearchScreen\}[\s\S]*?options=\{prototypeTransparentOverlayScreenOptions\}/,
    );
  });
});
