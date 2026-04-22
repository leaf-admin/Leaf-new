const {
  buildPrototypeConnectionIndicatorModel,
  resolvePrototypeConnectionAutomationConfig,
  shouldRunPrototypeConnectionAutomation,
} = require('../src/screens/prototype/prototypeConnectionStatus');

describe('prototypeConnectionStatus', () => {
  test('shows a lost-connection indicator during passenger search', () => {
    const model = buildPrototypeConnectionIndicatorModel({
      activeRole: 'customer',
      bookingStatus: 'searching',
      driverOnline: false,
      driverOnlinePending: false,
      connecting: false,
      isSocketConnected: false,
      isSocketAuthenticated: false,
      requiresAuthentication: true,
      recentlyRecovered: false,
    });

    expect(model).toEqual(
      expect.objectContaining({
        tone: 'danger',
        title: 'Conexão perdida',
      }),
    );
    expect(model.message).toMatch(/busca aberta/i);
  });

  test('shows a reconnecting indicator while the driver session is authenticating again', () => {
    const model = buildPrototypeConnectionIndicatorModel({
      activeRole: 'driver',
      bookingStatus: 'accepted',
      driverOnline: true,
      driverOnlinePending: false,
      connecting: true,
      isSocketConnected: false,
      isSocketAuthenticated: false,
      requiresAuthentication: true,
      recentlyRecovered: false,
    });

    expect(model).toEqual(
      expect.objectContaining({
        tone: 'warning',
        title: 'Reconectando',
      }),
    );
  });

  test('can force the indicator to surface in qa mode outside an active trip state', () => {
    const model = buildPrototypeConnectionIndicatorModel({
      activeRole: 'customer',
      bookingStatus: 'idle',
      driverOnline: false,
      driverOnlinePending: false,
      connecting: false,
      isSocketConnected: false,
      isSocketAuthenticated: false,
      requiresAuthentication: true,
      recentlyRecovered: false,
      forceVisible: true,
    });

    expect(model).toEqual(
      expect.objectContaining({
        tone: 'danger',
        title: 'Conexão perdida',
      }),
    );
  });

  test('resolves QA automation config for a frontend-only drop and recover scenario', () => {
    const config = resolvePrototypeConnectionAutomationConfig(
      {
        qaAutomation: '1',
        qaConnectionScenario: 'disconnect_once',
        qaConnectionTriggerState: 'started',
        qaConnectionRecoveryMs: '18000',
        qaConnectionDelayMs: '900',
        qaConnectionRole: 'driver',
        qaNonce: 'wave4-started',
      },
      {
        activeRole: 'driver',
        isDev: true,
        isE2E: false,
      },
    );

    expect(config).toEqual(
      expect.objectContaining({
        enabled: true,
        scenario: 'drop_and_recover',
        triggerState: 'started',
        role: 'driver',
        recoveryMs: 18000,
        delayMs: 900,
        nonce: 'wave4-started',
      }),
    );
  });

  test('runs connection automation only when the configured trigger state matches', () => {
    const config = resolvePrototypeConnectionAutomationConfig(
      {
        qaAutomation: '1',
        qaConnectionScenario: 'drop_and_recover',
        qaConnectionTriggerState: 'driver_online',
      },
      {
        activeRole: 'driver',
        isDev: true,
        isE2E: false,
      },
    );

    expect(
      shouldRunPrototypeConnectionAutomation(config, {
        activeRole: 'driver',
        bookingStatus: 'idle',
        driverOnline: false,
      }),
    ).toBe(false);

    expect(
      shouldRunPrototypeConnectionAutomation(config, {
        activeRole: 'driver',
        bookingStatus: 'idle',
        driverOnline: true,
      }),
    ).toBe(true);
  });
});
