describe('runtimeAccessPolicy payment bypass gates', () => {
  const loadPolicy = ({
    extra = {},
    currentExtra,
    classicExtra,
    isDevice = true,
    dev = false,
    env = {},
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
      expoConfig: { extra },
      ...(currentExtra === undefined
        ? {}
        : { manifest2: { extra: { expoClient: { extra: currentExtra } } } }),
      ...(classicExtra === undefined
        ? {}
        : { manifest: { extra: classicExtra } }),
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
      isDevice: false,
      dev: true,
      env: {
        EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS: 'true',
        EXPO_PUBLIC_FORCE_PAYMENT_BYPASS: 'true',
      },
    });

    expect(policy.allowTestUserTools()).toBe(true);
    expect(policy.allowForcedPaymentBypass()).toBe(true);
  });

  it('does not enable QA tools on a physical debug device', () => {
    const policy = loadPolicy({
      isDevice: true,
      dev: true,
      env: {
        EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS: 'true',
      },
    });

    expect(policy.hasExplicitTestUserToolsFlag()).toBe(true);
    expect(policy.allowTestUserTools()).toBe(false);
  });

  it('lets a current manifest without the flag shadow stale embedded QA tools', () => {
    const policy = loadPolicy({
      extra: { enableTestUserTools: true },
      currentExtra: {},
      isDevice: false,
      dev: true,
    });

    expect(policy.hasExplicitTestUserToolsFlag()).toBe(false);
    expect(policy.allowTestUserTools()).toBe(false);
  });

  it('lets an explicit current manifest false shadow stale embedded QA tools', () => {
    const policy = loadPolicy({
      extra: { enableTestUserTools: true },
      currentExtra: { enableTestUserTools: false },
      isDevice: false,
      dev: true,
    });

    expect(policy.hasExplicitTestUserToolsFlag()).toBe(false);
    expect(policy.allowTestUserTools()).toBe(false);
  });

  it('lets an explicit current bundle false shadow stale embedded QA tools', () => {
    const policy = loadPolicy({
      extra: { enableTestUserTools: true },
      isDevice: false,
      dev: true,
      env: {
        EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS: 'false',
      },
    });

    expect(policy.hasExplicitTestUserToolsFlag()).toBe(false);
    expect(policy.allowTestUserTools()).toBe(false);
  });

  it('does not allow direct Google fallback on simulator without explicit flag', () => {
    const policy = loadPolicy({
      isDevice: false,
      dev: false,
    });

    expect(policy.hasExplicitClientDirectGoogleFallbackFlag()).toBe(false);
    expect(policy.allowClientDirectGoogleFallback()).toBe(false);
  });

  it('allows direct Google fallback only in dev or QA runtime with explicit flag', () => {
    const productionPolicy = loadPolicy({
      isDevice: true,
      dev: false,
      env: {
        EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK: 'true',
      },
    });
    expect(productionPolicy.allowClientDirectGoogleFallback()).toBe(false);

    const devPolicy = loadPolicy({
      isDevice: true,
      dev: true,
      env: {
        EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK: 'true',
      },
    });
    expect(devPolicy.hasExplicitClientDirectGoogleFallbackFlag()).toBe(true);
    expect(devPolicy.allowClientDirectGoogleFallback()).toBe(true);
  });
});
