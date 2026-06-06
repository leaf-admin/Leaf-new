describe('runtimeAccessPolicy payment bypass gates', () => {
  const loadPolicy = ({
    extra = {},
    isDevice = true,
    dev = false,
    env = {},
    runtimeAllowsGoogle = false,
  } = {}) => {
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
    jest.doMock('../src/services/RuntimeConfigService', () => ({
      __esModule: true,
      default: {
        getMapsRoutingPolicySync: jest.fn(() => ({
          clientDirectGoogleFallback: runtimeAllowsGoogle,
        })),
      },
    }));

    return require('../src/config/runtimeAccessPolicy');
  };

  afterEach(() => {
    jest.dontMock('expo-device');
    jest.dontMock('expo-constants');
    jest.dontMock('../src/services/RuntimeConfigService');
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

  it('does not allow direct Google fallback on simulator without explicit flag', () => {
    const policy = loadPolicy({
      isDevice: false,
      dev: false,
    });

    expect(policy.hasExplicitClientDirectGoogleFallbackFlag()).toBe(false);
    expect(policy.allowClientDirectGoogleFallback()).toBe(false);
  });

  it('does not allow direct Google fallback when runtime policy keeps it disabled', () => {
    const devPolicy = loadPolicy({
      isDevice: true,
      dev: true,
      env: {
        EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK: 'true',
      },
    });

    expect(devPolicy.hasExplicitClientDirectGoogleFallbackFlag()).toBe(true);
    expect(devPolicy.allowClientDirectGoogleFallback()).toBe(false);
  });

  it('allows direct Google fallback only in dev or QA runtime with explicit flag and runtime opt-in', () => {
    const productionPolicy = loadPolicy({
      isDevice: true,
      dev: false,
      runtimeAllowsGoogle: true,
      env: {
        EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK: 'true',
      },
    });
    expect(productionPolicy.allowClientDirectGoogleFallback()).toBe(false);

    const devPolicy = loadPolicy({
      isDevice: true,
      dev: true,
      runtimeAllowsGoogle: true,
      env: {
        EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK: 'true',
      },
    });
    expect(devPolicy.hasExplicitClientDirectGoogleFallbackFlag()).toBe(true);
    expect(devPolicy.allowClientDirectGoogleFallback()).toBe(true);
  });
});
