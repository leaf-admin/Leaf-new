const fs = require('fs');
const path = require('path');

describe('Robotaxi driver earnings navigation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'EarningsReportScreen.js'),
    'utf8',
  );

  it('renders a visible and accessible close action', () => {
    expect(source).toContain('<PrototypeMenuCloseButton');
    expect(source).toContain('onPress={handleBackPress}');
    expect(source).toContain('testID="driver-earnings-close-button"');
    expect(source).toContain('accessibilityLabel="Fechar ganhos"');
  });

  it('returns to the Robotaxi home when there is no navigation history', () => {
    expect(source).toContain("navigation.navigate('RobotaxiPrototype')");
  });
});
