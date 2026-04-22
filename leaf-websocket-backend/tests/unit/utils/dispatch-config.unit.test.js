describe('dispatch-config', () => {
  const originalTimeout = process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS;

  afterEach(() => {
    if (typeof originalTimeout === 'undefined') {
      delete process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS;
    } else {
      process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS = originalTimeout;
    }
    jest.resetModules();
  });

  it('defaults the driver response timeout to 20 seconds', () => {
    delete process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS;

    const {
      DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS,
      getDriverResponseTimeoutSeconds,
    } = require('../../../utils/dispatch-config');

    expect(DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS).toBe(20);
    expect(getDriverResponseTimeoutSeconds()).toBe(20);
  });

  it('respects a positive env override', () => {
    process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS = '45';

    const { getDriverResponseTimeoutSeconds } = require('../../../utils/dispatch-config');

    expect(getDriverResponseTimeoutSeconds()).toBe(45);
  });
});
