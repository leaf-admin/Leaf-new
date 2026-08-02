const fs = require('fs');
const path = require('path');

const CURRENT_SURFACE_FILES = [
  'src/screens/prototype/RobotaxiVehiclesScreen.js',
  'src/screens/prototype/RobotaxiProfileScreen.js',
  'src/screens/prototype/RobotaxiSettingsScreen.js',
  'src/screens/prototype/RobotaxiTripHistoryScreen.js',
  'src/services/MobileVehicleService.js',
  'src/services/MobilePreferencesService.js',
  'src/services/MobileProfileService.js',
  'src/services/BookingHistoryService.js',
];

describe('current account surface contract', () => {
  const sources = Object.fromEntries(CURRENT_SURFACE_FILES.map(file => [
    file,
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
  ]));

  it.each(CURRENT_SURFACE_FILES)('%s does not access Firebase client data stores directly', (file) => {
    expect(sources[file]).not.toMatch(/@react-native-firebase\/(?:database|firestore|storage)/);
    expect(sources[file]).not.toMatch(/\b(?:database|firestore|storage)\s*\(\s*\)/);
  });

  it('does not restore the direct Firebase vehicle adapter', () => {
    expect(fs.existsSync(
      path.join(__dirname, '../src/services/VehicleService.js'),
    )).toBe(false);
  });

  it('routes functional current surfaces through their canonical Leaf API adapters', () => {
    expect(sources['src/screens/prototype/RobotaxiVehiclesScreen.js']).toContain('MobileVehicleService');
    expect(sources['src/screens/prototype/RobotaxiProfileScreen.js']).toContain('MobileProfileService');
    expect(sources['src/screens/prototype/RobotaxiTripHistoryScreen.js']).toContain('BookingHistoryService');
  });

  it('exposes stable CURRENT screen ids for UI runners', () => {
    expect(sources['src/screens/prototype/RobotaxiProfileScreen.js']).toContain(
      'testID="robotaxi-profile-screen"',
    );
  });

  it('keeps settings inventory classified without coupling the current renderer to remote preferences', () => {
    const settingsSource = sources['src/screens/prototype/RobotaxiSettingsScreen.js'];

    expect(settingsSource).toContain('ROBOTAXI_SETTINGS_ITEMS');
    expect(settingsSource).not.toContain('MobilePreferencesService');
    expect(settingsSource).not.toContain('getPreferences(');
    expect(settingsSource).not.toContain('updatePreferences(');
  });

  it('keeps the account API endpoints explicit in the adapters', () => {
    expect(sources['src/services/MobileVehicleService.js']).toContain('/account/vehicles');
    expect(sources['src/services/MobilePreferencesService.js']).toContain('/account/preferences');
    expect(sources['src/services/MobileProfileService.js']).toContain('/account/profile');
    expect(sources['src/services/BookingHistoryService.js']).toContain('/receipts/user/');
  });

  it('keeps test ids out of the visible accessibility name', () => {
    expect(sources['src/screens/prototype/RobotaxiVehiclesScreen.js']).toContain(
      'accessibilityLabel="Fechar veículos"',
    );
    expect(sources['src/screens/prototype/RobotaxiVehiclesScreen.js']).not.toContain(
      'accessibilityLabel="robotaxi-vehicles-close-button"',
    );
    expect(sources['src/screens/prototype/RobotaxiSettingsScreen.js']).toContain(
      'accessibilityLabel="Fechar configurações"',
    );
    expect(sources['src/screens/prototype/RobotaxiSettingsScreen.js']).toContain(
      'accessible={false}',
    );
  });
});
