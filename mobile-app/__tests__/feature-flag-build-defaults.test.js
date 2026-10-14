import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPilotDefaults = jest.fn();

jest.mock('../src/config/pilotLaunchProfile', () => ({
  getPilotFeatureFlagDefaults: () => mockPilotDefaults(),
}));

function loadService() {
  let service;
  jest.isolateModules(() => {
    service = require('../src/services/FeatureFlagService').default;
  });
  return service;
}

describe('feature flags defined by the build', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockPilotDefaults.mockReset();
  });

  it('a feature turned on in a new build is on for an app that stored it off before', async () => {
    await AsyncStorage.setItem(
      '@feature_flags',
      JSON.stringify({ PILOT_DRIVER_WITHDRAWALS_ENABLED: false, SOME_LOCAL_FLAG: true }),
    );
    mockPilotDefaults.mockReturnValue({ PILOT_DRIVER_WITHDRAWALS_ENABLED: true });

    const service = loadService();

    await expect(service.getFlag('PILOT_DRIVER_WITHDRAWALS_ENABLED', false)).resolves.toBe(true);
    // Flags que não vêm do build continuam valendo o que foi guardado.
    await expect(service.getFlag('SOME_LOCAL_FLAG', false)).resolves.toBe(true);
  });

  it('a feature turned off in a new build is off even if it was stored on', async () => {
    await AsyncStorage.setItem('@feature_flags', JSON.stringify({ PILOT_DRIVER_WITHDRAWALS_ENABLED: true }));
    mockPilotDefaults.mockReturnValue({ PILOT_DRIVER_WITHDRAWALS_ENABLED: false });

    const service = loadService();

    await expect(service.getFlag('PILOT_DRIVER_WITHDRAWALS_ENABLED', true)).resolves.toBe(false);
  });
});
