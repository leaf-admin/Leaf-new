describe('runtimeAccessPolicy payment bypass gates', () => {
  const loadPolicy = ({ extra = {}, isDevice = true, dev = false, env = {} } = {}) => {
    jest.resetModules();

    Object.keys(process.env)
      .filter((key) => key.startsWith('EXPO_PUBLIC_') || key === 'APP_REVIEW')
      .forEach((key) => {
        delete process.env[key];
      });
    Object.assign(process.env, env);

    global.__DEV__ = dev;

    jest.doMock('expo-device', () => ({
      isDevice,
    }));
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        extra,
      },
    }));

    return require('../src/config/runtimeAccessPolicy');
  };

  afterEach(() => {
    jest.dontMock('expo-device');
    jest.dontMock('expo-constants');
    jest.resetModules();
  });

  it('does not allow forced payment bypass with only the payment flag', () => {
    const policy = loadPolicy({
      dev: true,
      env: {
        EXPO_PUBLIC_FORCE_PAYMENT_BYPASS: 'true',
      },
    });

    expect(policy.hasExplicitPaymentBypassFlag()).toBe(true);
    expect(policy.allowTestUserTools()).toBe(false);
    expect(policy.allowForcedPaymentBypass()).toBe(false);
  });

  it('allows forced payment bypass only with explicit QA tools and payment flags', () => {
    const policy = loadPolicy({
      dev: true,
      env: {
        EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS: 'true',
        EXPO_PUBLIC_FORCE_PAYMENT_BYPASS: 'true',
      },
    });

    expect(policy.allowTestUserTools()).toBe(true);
    expect(policy.allowForcedPaymentBypass()).toBe(true);
  });
});
