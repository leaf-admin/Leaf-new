describe('dispatch-config', () => {
  const originalTimeout = process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS;
  const originalSmokeDisableTtls = process.env.REAL_SMOKE_DISABLE_TTLS;
  const originalSmokeTimeout = process.env.SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS;
  const originalSandboxTimeoutExtension = process.env.ALLOW_SANDBOX_DRIVER_RESPONSE_TIMEOUT_EXTENSION;
  const originalMatchInitialRadius = process.env.MATCH_INITIAL_RADIUS_KM;
  const originalMatchMaxRadius = process.env.MATCH_MAX_RADIUS_KM;
  const originalMatchExpansionStep = process.env.MATCH_EXPANSION_STEP_KM;
  const originalMatchDriversPerWave = process.env.MATCH_DRIVERS_PER_WAVE;
  const originalPaymentAvailabilityRadius = process.env.PAYMENT_AVAILABILITY_RADIUS_KM;
  const originalPaymentAvailabilityLimit = process.env.PAYMENT_AVAILABILITY_LIMIT;
  const originalOperationsPolicyRadius = process.env.OPERATIONS_POLICY_RADIUS_KM;
  const originalOperationsPolicyDriverLimit = process.env.OPERATIONS_POLICY_DRIVER_LIMIT;

  afterEach(() => {
    if (typeof originalTimeout === 'undefined') {
      delete process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS;
    } else {
      process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS = originalTimeout;
    }
    if (typeof originalSmokeDisableTtls === 'undefined') {
      delete process.env.REAL_SMOKE_DISABLE_TTLS;
    } else {
      process.env.REAL_SMOKE_DISABLE_TTLS = originalSmokeDisableTtls;
    }
    if (typeof originalSmokeTimeout === 'undefined') {
      delete process.env.SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS;
    } else {
      process.env.SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS = originalSmokeTimeout;
    }
    if (typeof originalSandboxTimeoutExtension === 'undefined') {
      delete process.env.ALLOW_SANDBOX_DRIVER_RESPONSE_TIMEOUT_EXTENSION;
    } else {
      process.env.ALLOW_SANDBOX_DRIVER_RESPONSE_TIMEOUT_EXTENSION = originalSandboxTimeoutExtension;
    }
    if (typeof originalMatchInitialRadius === 'undefined') {
      delete process.env.MATCH_INITIAL_RADIUS_KM;
    } else {
      process.env.MATCH_INITIAL_RADIUS_KM = originalMatchInitialRadius;
    }
    if (typeof originalMatchMaxRadius === 'undefined') {
      delete process.env.MATCH_MAX_RADIUS_KM;
    } else {
      process.env.MATCH_MAX_RADIUS_KM = originalMatchMaxRadius;
    }
    if (typeof originalMatchExpansionStep === 'undefined') {
      delete process.env.MATCH_EXPANSION_STEP_KM;
    } else {
      process.env.MATCH_EXPANSION_STEP_KM = originalMatchExpansionStep;
    }
    if (typeof originalMatchDriversPerWave === 'undefined') {
      delete process.env.MATCH_DRIVERS_PER_WAVE;
    } else {
      process.env.MATCH_DRIVERS_PER_WAVE = originalMatchDriversPerWave;
    }
    if (typeof originalPaymentAvailabilityRadius === 'undefined') {
      delete process.env.PAYMENT_AVAILABILITY_RADIUS_KM;
    } else {
      process.env.PAYMENT_AVAILABILITY_RADIUS_KM = originalPaymentAvailabilityRadius;
    }
    if (typeof originalPaymentAvailabilityLimit === 'undefined') {
      delete process.env.PAYMENT_AVAILABILITY_LIMIT;
    } else {
      process.env.PAYMENT_AVAILABILITY_LIMIT = originalPaymentAvailabilityLimit;
    }
    if (typeof originalOperationsPolicyRadius === 'undefined') {
      delete process.env.OPERATIONS_POLICY_RADIUS_KM;
    } else {
      process.env.OPERATIONS_POLICY_RADIUS_KM = originalOperationsPolicyRadius;
    }
    if (typeof originalOperationsPolicyDriverLimit === 'undefined') {
      delete process.env.OPERATIONS_POLICY_DRIVER_LIMIT;
    } else {
      process.env.OPERATIONS_POLICY_DRIVER_LIMIT = originalOperationsPolicyDriverLimit;
    }
    jest.resetModules();
  });

  it('defaults the driver response timeout to 20 seconds', () => {
    delete process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS;
    delete process.env.REAL_SMOKE_DISABLE_TTLS;

    const {
      DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS,
      DEFAULT_SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS,
      getDriverResponseTimeoutSeconds,
    } = require('../../../utils/dispatch-config');

    expect(DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS).toBe(20);
    expect(DEFAULT_SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS).toBe(21600);
    expect(getDriverResponseTimeoutSeconds()).toBe(20);
  });

  it('respects a positive env override', () => {
    process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS = '45';

    const { getDriverResponseTimeoutSeconds } = require('../../../utils/dispatch-config');

    expect(getDriverResponseTimeoutSeconds()).toBe(45);
  });

  it('extends the driver response timeout when smoke TTLs are disabled', () => {
    process.env.REAL_SMOKE_DISABLE_TTLS = 'true';

    const { getDriverResponseTimeoutSeconds } = require('../../../utils/dispatch-config');

    expect(getDriverResponseTimeoutSeconds()).toBe(21600);
  });

  it('respects a positive smoke timeout override', () => {
    process.env.REAL_SMOKE_DISABLE_TTLS = 'true';
    process.env.SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS = '900';

    const { getDriverResponseTimeoutSeconds } = require('../../../utils/dispatch-config');

    expect(getDriverResponseTimeoutSeconds()).toBe(900);
  });

  it('extends the driver response timeout for sandbox booking markers', () => {
    const { getDriverResponseTimeoutSeconds } = require('../../../utils/dispatch-config');

    expect(getDriverResponseTimeoutSeconds({
      paymentProviderEnvironment: 'sandbox',
    })).toBe(21600);
    expect(getDriverResponseTimeoutSeconds({
      paymentData: JSON.stringify({ paymentProfileId: 'woovi-sandbox-user-test' }),
    })).toBe(21600);
  });

  it('uses the approved 5km geographic radius as the canonical driver search maximum', () => {
    delete process.env.MATCH_MAX_RADIUS_KM;
    delete process.env.PAYMENT_AVAILABILITY_RADIUS_KM;
    delete process.env.OPERATIONS_POLICY_RADIUS_KM;

    const {
      DEFAULT_DRIVER_SEARCH_MAX_RADIUS_KM,
      getDriverSearchMaxRadiusKm,
      getPaymentAvailabilityRadiusKm,
      getOperationsPolicyRadiusKm,
    } = require('../../../utils/dispatch-config');

    expect(DEFAULT_DRIVER_SEARCH_MAX_RADIUS_KM).toBe(5);
    expect(getDriverSearchMaxRadiusKm()).toBe(5);
    expect(getPaymentAvailabilityRadiusKm()).toBe(5);
    expect(getOperationsPolicyRadiusKm()).toBe(5);
  });

  it('keeps payment availability aligned with the dispatch max radius when only dispatch radius is configured', () => {
    process.env.MATCH_MAX_RADIUS_KM = '4.5';
    delete process.env.PAYMENT_AVAILABILITY_RADIUS_KM;

    const {
      getDriverSearchMaxRadiusKm,
      getPaymentAvailabilityRadiusKm,
    } = require('../../../utils/dispatch-config');

    expect(getDriverSearchMaxRadiusKm()).toBe(4.5);
    expect(getPaymentAvailabilityRadiusKm()).toBe(4.5);
  });
});
