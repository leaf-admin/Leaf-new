describe('ride-flow-validation-guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      LEAF_LAUNCH_PROFILE: 'ride_flow_validation'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows only durable user-scoped sandbox profiles', () => {
    const { evaluateRideFlowValidationPaymentProfile } = require('../../../services/ride-flow-validation-guard');

    expect(evaluateRideFlowValidationPaymentProfile({
      environment: 'sandbox',
      scope: 'users',
      profileId: 'qa-test-users-sandbox-durable',
      testUserSandbox: true
    })).toEqual(expect.objectContaining({ allowed: true }));

    expect(evaluateRideFlowValidationPaymentProfile({
      environment: 'production',
      scope: 'global',
      profileId: 'env-default',
      testUserSandbox: false
    })).toEqual(expect.objectContaining({
      allowed: false,
      code: 'RIDE_FLOW_VALIDATION_SANDBOX_PROFILE_REQUIRED'
    }));
  });

  it('accepts booking only when its authoritative payment binding is sandbox', () => {
    const { evaluateRideFlowValidationPaymentBinding } = require('../../../services/ride-flow-validation-guard');

    expect(evaluateRideFlowValidationPaymentBinding({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable'
    })).toEqual(expect.objectContaining({ allowed: true }));

    expect(evaluateRideFlowValidationPaymentBinding({
      providerEnvironment: 'production',
      paymentProfileId: 'env-default'
    })).toEqual(expect.objectContaining({
      allowed: false,
      code: 'RIDE_FLOW_VALIDATION_SANDBOX_PAYMENT_REQUIRED'
    }));
  });

  it('does not alter payment behavior outside the validation profile', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
    jest.resetModules();
    const { evaluateRideFlowValidationPaymentProfile } = require('../../../services/ride-flow-validation-guard');

    expect(evaluateRideFlowValidationPaymentProfile({ environment: 'production' }))
      .toEqual({ allowed: true, code: 'RIDE_FLOW_VALIDATION_NOT_ACTIVE' });
  });
});
