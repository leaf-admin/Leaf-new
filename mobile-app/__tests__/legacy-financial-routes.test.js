const fs = require('fs');
const path = require('path');

const appNavigatorSource = fs.readFileSync(
  path.join(__dirname, '../src/navigation/AppNavigator.js'),
  'utf8'
);

describe('legacy financial navigation surfaces', () => {
  it('keeps legacy route aliases but does not mount wallet/BaaS screens directly', () => {
    expect(appNavigatorSource).not.toMatch(/import\s+DriverBalanceScreen\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+WeeklyPaymentScreen\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+AddMoney\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+WalletDetails\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+FreeTrialScreen\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+PlanSelectionScreen\s+from/);

    expect(appNavigatorSource).toContain('name="BaaSAccountScreen"');
    expect(appNavigatorSource).toContain('name="DriverBalance"');
    expect(appNavigatorSource).toContain('name="WalletDetails"');
    expect(appNavigatorSource).toContain('name="addMoney"');
    expect(appNavigatorSource).toContain('component={PilotFeatureUnavailableScreen}');
    expect(appNavigatorSource).toContain('component={driverPayoutEntryComponent}');
  });
});
