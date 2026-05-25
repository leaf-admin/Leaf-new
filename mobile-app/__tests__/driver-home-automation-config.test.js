const {
  resolveDriverHomeAutomationConfig,
  resolveEffectiveDriverHomeAutomationConfig,
} = require('../src/screens/prototype/driverHomeAutomationConfig');

describe('driver home automation config', () => {
  it('keeps driver automation enabled even before the navigator settles on the home route', () => {
    expect(
      resolveDriverHomeAutomationConfig(
        {
          qaAutomation: '1',
          qaDriverAction: 'set_online',
          qaNonce: 'boot-online',
        },
        {
          isDriverRole: true,
          isHomeRoute: false,
          isDev: true,
          isE2E: false,
        }
      )
    ).toEqual({
      automationEnabled: true,
      action: 'set_online',
      nonce: 'boot-online',
      bookingId: '',
    });
  });

  it('keeps automation disabled for non-driver roles', () => {
    expect(
      resolveDriverHomeAutomationConfig(
        {
          qaAutomation: '1',
          qaDriverAction: 'set_online',
        },
        {
          isDriverRole: false,
          isHomeRoute: true,
          isDev: true,
          isE2E: true,
        }
      )
    ).toEqual({
      automationEnabled: false,
      action: '',
      nonce: '',
      bookingId: '',
    });
  });

  it('normalizes reject offer actions for driver concurrency flows', () => {
    expect(
      resolveDriverHomeAutomationConfig(
        {
          qaAutomation: '1',
          qaDriverAction: 'reject-offer',
          qaNonce: 'reject-competitive-offer',
        },
        {
          isDriverRole: true,
          isHomeRoute: true,
          isDev: true,
          isE2E: false,
        }
      )
    ).toEqual({
      automationEnabled: true,
      action: 'reject_offer',
      nonce: 'reject-competitive-offer',
      bookingId: '',
    });
  });

  it('preserves a target booking id for deterministic offer actions', () => {
    expect(
      resolveDriverHomeAutomationConfig(
        {
          qaAutomation: '1',
          qaDriverAction: 'accept_offer',
          qaNonce: 'accept-ride',
          qaBookingId: 'booking_123',
        },
        {
          isDriverRole: true,
          isHomeRoute: true,
          isDev: true,
          isE2E: false,
        }
      )
    ).toEqual({
      automationEnabled: true,
      action: 'accept_offer',
      nonce: 'accept-ride',
      bookingId: 'booking_123',
    });
  });

  it('prioritizes a hot deeplink command over route params for driver actions', () => {
    expect(
      resolveEffectiveDriverHomeAutomationConfig(
        {
          routeConfig: {
            automationEnabled: true,
            action: 'set_online',
            nonce: 'route-online',
            bookingId: '',
          },
          liveCommand: {
            action: 'accept_offer',
            nonce: 'hot-accept',
            bookingId: 'booking_hot_1',
          },
          persistedCommand: {
            action: 'accept_offer',
            nonce: 'persisted-accept',
            bookingId: 'booking_persisted_1',
          },
        },
        {
          isDriverRole: true,
          isHomeRoute: true,
          isDev: true,
          isE2E: false,
        }
      )
    ).toEqual({
      automationEnabled: true,
      action: 'accept_offer',
      nonce: 'hot-accept',
      bookingId: 'booking_hot_1',
    });
  });

  it('fills a missing route booking id from persisted fallback data', () => {
    expect(
      resolveEffectiveDriverHomeAutomationConfig(
        {
          routeConfig: {
            automationEnabled: true,
            action: 'accept_offer',
            nonce: 'route-accept',
            bookingId: '',
          },
          persistedCommand: {
            action: 'accept_offer',
            nonce: 'persisted-accept',
            bookingId: 'booking_fallback_1',
          },
        },
        {
          isDriverRole: true,
          isHomeRoute: true,
          isDev: true,
          isE2E: false,
        }
      )
    ).toEqual({
      automationEnabled: true,
      action: 'accept_offer',
      nonce: 'route-accept',
      bookingId: 'booking_fallback_1',
    });
  });

  it('keeps route-param automation disabled in production contexts', () => {
    expect(
      resolveDriverHomeAutomationConfig(
        {
          qaAutomation: '1',
          qaDriverAction: 'set_online',
          qaNonce: 'prod-attempt',
        },
        {
          isDriverRole: true,
          isHomeRoute: true,
          isDev: false,
          isE2E: false,
        }
      )
    ).toEqual({
      automationEnabled: false,
      action: '',
      nonce: '',
      bookingId: '',
    });
  });
});
