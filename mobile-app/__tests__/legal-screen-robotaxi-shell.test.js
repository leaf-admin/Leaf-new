const fs = require('fs');
const path = require('path');

describe('Legal screen Robotaxi shell', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'LegalScreen.js'),
    'utf8',
  );
  const navigatorSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'navigation', 'AppNavigator.js'),
    'utf8',
  );

  it('uses the current tokens, safe areas and an accessible close action', () => {
    expect(source).toContain('robotaxiPrototypeTokens');
    expect(source).toContain('useSafeAreaInsets');
    expect(source).toContain('testID="legal-close-button"');
    expect(source).toContain('accessibilityLabel="Fechar informações legais"');
  });

  it('does not navigate to the unavailable legacy HelpScreen route', () => {
    expect(source).not.toContain("navigation.navigate('HelpScreen')");
    expect(source).toContain("navigation.navigate('RobotaxiPrototype')");
  });

  it('exposes each legal section as a selectable tab', () => {
    expect(source).toContain('accessibilityRole="tab"');
    expect(source).toContain('accessibilityState={{ selected: selectedSection === item.id }}');
  });

  it('registers public deep links for legal and privacy content', () => {
    expect(navigatorSource).toContain("Legal: 'legal'");
    expect(navigatorSource).toContain("PrivacyPolicy: 'privacy'");
  });
});
