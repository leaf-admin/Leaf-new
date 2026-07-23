describe('pilotLaunchProfile', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults risky pilot features to disabled in pilot_controlled', () => {
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

  it('treats ride flow validation as a controlled launch profile', () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra: {
          launchProfile: 'ride_flow_validation',
          pilotFeatureFlags: {}
        }
      }
    }));

    const { getPilotLaunchFeatureSnapshot } = require('../src/config/pilotLaunchProfile');
    const snapshot = getPilotLaunchFeatureSnapshot();

    expect(snapshot.launchProfile).toBe('ride_flow_validation');
    expect(snapshot.pilotControlled).toBe(true);
    expect(snapshot.driverWithdrawalsEnabled).toBe(false);
    expect(snapshot.dynamicPricingEnabled).toBe(false);
  });
});
