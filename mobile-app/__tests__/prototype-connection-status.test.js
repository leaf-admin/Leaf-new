const {
  buildDriverBackgroundTrackingNoticeModel,
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

  test('does not surface recovered connection noise during quote preview', () => {
    const model = buildPrototypeConnectionIndicatorModel({
      activeRole: 'customer',
      bookingStatus: 'quote',
      driverOnline: false,
      driverOnlinePending: false,
      connecting: false,
      isSocketConnected: true,
      isSocketAuthenticated: true,
      requiresAuthentication: true,
      recentlyRecovered: true,
    });

    expect(model).toBeNull();
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

  test('ignores qa connection automation flags in production contexts', () => {
    const config = resolvePrototypeConnectionAutomationConfig(
      {
        qaAutomation: '1',
        qaConnectionScenario: 'drop_and_recover',
        qaConnectionTriggerState: 'started',
      },
      {
        activeRole: 'driver',
        isDev: false,
        isE2E: false,
      },
    );

    expect(config.enabled).toBe(false);
    expect(config.scenario).toBe('');
  });

  describe('driver background tracking notice', () => {
    const failedStatus = {
      isTracking: false,
      lastStartFailure: { code: 'ERR_UNEXPECTED', message: 'boom', count: 1 },
    };

    test('warns the driver in plain language when tracking could not start during a ride', () => {
      const model = buildDriverBackgroundTrackingNoticeModel({
        activeRole: 'driver',
        driverRideActive: true,
        trackingStatus: failedStatus,
      });

      expect(model).toEqual({
        tone: 'warning',
        icon: 'navigate-circle-outline',
        title: 'Localização em segundo plano indisponível',
        message:
          'Sua localização só é enviada com o app aberto. Mantenha o Leaf em primeiro plano.',
      });
    });

    test('stays silent without an active ride, for passengers, and when tracking is healthy or was never attempted', () => {
      expect(
        buildDriverBackgroundTrackingNoticeModel({
          activeRole: 'driver',
          driverRideActive: false,
          trackingStatus: failedStatus,
        }),
      ).toBeNull();
      expect(
        buildDriverBackgroundTrackingNoticeModel({
          activeRole: 'customer',
          driverRideActive: true,
          trackingStatus: failedStatus,
        }),
      ).toBeNull();
      expect(
        buildDriverBackgroundTrackingNoticeModel({
          activeRole: 'driver',
          driverRideActive: true,
          trackingStatus: { isTracking: true, lastStartFailure: null },
        }),
      ).toBeNull();
      expect(
        buildDriverBackgroundTrackingNoticeModel({
          activeRole: 'driver',
          driverRideActive: true,
          trackingStatus: { isTracking: false, lastStartFailure: null },
        }),
      ).toBeNull();
      expect(
        buildDriverBackgroundTrackingNoticeModel({
          activeRole: 'driver',
          driverRideActive: true,
          trackingStatus: null,
        }),
      ).toBeNull();
    });
  });
});
