describe('pilot-launch-flags', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults risky features to disabled in pilot_controlled', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';

    const { getPilotLaunchFlags, isLaunchFeatureEnabled } = require('../../../utils/pilot-launch-flags');
    const snapshot = getPilotLaunchFlags();

    expect(snapshot.launchProfile).toBe('pilot_controlled');
    expect(snapshot.pilotControlled).toBe(true);
    expect(snapshot.driverWithdrawalsEnabled).toBe(false);
    expect(snapshot.referralProgramsEnabled).toBe(false);
    expect(snapshot.campaignCenterEnabled).toBe(false);
    expect(snapshot.leafDelasEnabled).toBe(false);
    expect(snapshot.driverDestinationModeEnabled).toBe(false);
    expect(snapshot.dynamicPricingEnabled).toBe(false);
    expect(snapshot.demandPredictionEnabled).toBe(false);
    expect(snapshot.smartPushEnabled).toBe(false);
    expect(isLaunchFeatureEnabled('softBanEnforcementEnabled', true)).toBe(false);
  });

  it('allows explicit opt-in overrides per feature', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
    process.env.ENABLE_DRIVER_WITHDRAWALS = 'true';
    process.env.ENABLE_LEAF_DELAS = 'true';
    process.env.ENABLE_DRIVER_DESTINATION_MODE = 'true';

    const { getPilotLaunchFlags } = require('../../../utils/pilot-launch-flags');
    const snapshot = getPilotLaunchFlags();

    expect(snapshot.driverWithdrawalsEnabled).toBe(true);
    expect(snapshot.leafDelasEnabled).toBe(true);
    expect(snapshot.driverDestinationModeEnabled).toBe(true);
    expect(snapshot.referralProgramsEnabled).toBe(false);
    expect(snapshot.campaignCenterEnabled).toBe(false);
  });

  it('normalizes ride validation aliases into a controlled profile', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'ride_validation';

    const { getPilotLaunchFlags, isRideFlowValidationLaunch } = require('../../../utils/pilot-launch-flags');
    const snapshot = getPilotLaunchFlags();

    expect(snapshot.launchProfile).toBe('ride_flow_validation');
    expect(snapshot.pilotControlled).toBe(true);
    expect(snapshot.driverWithdrawalsEnabled).toBe(false);
    expect(isRideFlowValidationLaunch()).toBe(true);
  });
});
