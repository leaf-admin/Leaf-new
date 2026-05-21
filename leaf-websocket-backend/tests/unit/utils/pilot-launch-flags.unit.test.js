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
    expect(snapshot.demandPredictionEnabled).toBe(false);
    expect(isLaunchFeatureEnabled('softBanEnforcementEnabled', true)).toBe(false);
  });

  it('allows explicit opt-in overrides per feature', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
    process.env.ENABLE_DRIVER_WITHDRAWALS = 'true';

    const { getPilotLaunchFlags } = require('../../../utils/pilot-launch-flags');
    const snapshot = getPilotLaunchFlags();

    expect(snapshot.driverWithdrawalsEnabled).toBe(true);
    expect(snapshot.referralProgramsEnabled).toBe(false);
    expect(snapshot.campaignCenterEnabled).toBe(false);
  });
});
