describe('DriverBalanceService requestWithdrawal', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete global.fetch;
  });

  it('short-circuits withdrawal requests when pilot launch disables payouts', async () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra: {
          launchProfile: 'pilot_controlled',
          pilotControlled: true,
          pilotFeatureFlags: {}
        }
      }
    }));

    global.fetch = jest.fn();

    const service = require('../src/services/DriverBalanceService').default;
    const result = await service.requestWithdrawal('driver-1', 25, 'pix-key');

    expect(result.success).toBe(false);
    expect(result.code).toBe('FEATURE_DISABLED_IN_LAUNCH_PROFILE');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires app password before calling the withdrawal API', async () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra: {
          launchProfile: 'pilot_full',
          pilotControlled: false,
          pilotFeatureFlags: {
            driverWithdrawalsEnabled: true
          }
        }
      }
    }));

    global.fetch = jest.fn();

    const service = require('../src/services/DriverBalanceService').default;
    const result = await service.requestWithdrawal('driver-1', 25, 'pix-key');

    expect(result.success).toBe(false);
    expect(result.code).toBe('WITHDRAWAL_PASSWORD_REQUIRED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends the app password only in the withdrawal request body', async () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra: {
          launchProfile: 'pilot_full',
          pilotControlled: false,
          pilotFeatureFlags: {
            driverWithdrawalsEnabled: true
          }
        }
      }
    }));
    jest.doMock('@react-native-firebase/auth', () => () => ({
      currentUser: {
        getIdToken: jest.fn().mockResolvedValue('firebase-token')
      }
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn(() => 'application/json')
      },
      json: jest.fn().mockResolvedValue({ success: true, withdrawalId: 'wd-1' })
    });

    const service = require('../src/services/DriverBalanceService').default;
    const result = await service.requestWithdrawal('driver-1', 25, 'pix-key', 'Leaf1234');

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer firebase-token');
    expect(JSON.parse(options.body)).toMatchObject({
      amount: 25,
      pixKey: 'pix-key',
      appPassword: 'Leaf1234'
    });
  });
});
