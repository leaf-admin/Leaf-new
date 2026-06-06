describe('pilotLaunchProfile', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  const mockRuntimeFeatureGates = (featureGates = {}) => {
    jest.doMock('../src/services/RuntimeConfigService', () => ({
      __esModule: true,
      default: {
        getOperationalFeatureGatesSync: jest.fn(() => featureGates),
      },
    }));
  };

  it('defaults risky pilot features to disabled in pilot_controlled', () => {
    mockRuntimeFeatureGates();
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra: {
          launchProfile: 'pilot_controlled',
          pilotControlled: true,
          pilotFeatureFlags: {}
        }
      }
    }));

    const { getPilotLaunchFeatureSnapshot } = require('../src/config/pilotLaunchProfile');
    const snapshot = getPilotLaunchFeatureSnapshot();

    expect(snapshot.launchProfile).toBe('pilot_controlled');
    expect(snapshot.pilotControlled).toBe(true);
    expect(snapshot.driverWithdrawalsEnabled).toBe(false);
    expect(snapshot.referralProgramsEnabled).toBe(false);
    expect(snapshot.leafDelasEnabled).toBe(false);
    expect(snapshot.driverDestinationModeEnabled).toBe(false);
    expect(snapshot.dynamicPricingEnabled).toBe(false);
    expect(snapshot.smartPushEnabled).toBe(false);
    expect(snapshot.softBanEnforcementEnabled).toBe(false);
  });

  it('accepts explicit feature opt-in overrides for controlled pilot', () => {
    mockRuntimeFeatureGates();
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra: {
          launchProfile: 'pilot_controlled',
          pilotControlled: true,
          pilotFeatureFlags: {
            driverWithdrawalsEnabled: true,
            leafDelasEnabled: true,
            dynamicPricingEnabled: true
          }
        }
      }
    }));

    const { getPilotLaunchFeatureSnapshot } = require('../src/config/pilotLaunchProfile');
    const snapshot = getPilotLaunchFeatureSnapshot();

    expect(snapshot.driverWithdrawalsEnabled).toBe(true);
    expect(snapshot.leafDelasEnabled).toBe(true);
    expect(snapshot.dynamicPricingEnabled).toBe(true);
    expect(snapshot.referralProgramsEnabled).toBe(false);
  });

  it('uses backend runtime feature gates when an operational config is available', () => {
    mockRuntimeFeatureGates({
      referralProgramsEnabled: true,
      smartPushEnabled: true,
      biometricStrictModeEnabled: true,
    });
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra: {
          launchProfile: 'pilot_controlled',
          pilotControlled: true,
          pilotFeatureFlags: {}
        }
      }
    }));

    const { getPilotLaunchFeatureSnapshot } = require('../src/config/pilotLaunchProfile');
    const snapshot = getPilotLaunchFeatureSnapshot();

    expect(snapshot.referralProgramsEnabled).toBe(true);
    expect(snapshot.smartPushEnabled).toBe(true);
    expect(snapshot.biometricStrictModeEnabled).toBe(true);
    expect(snapshot.driverWithdrawalsEnabled).toBe(false);
  });
});
