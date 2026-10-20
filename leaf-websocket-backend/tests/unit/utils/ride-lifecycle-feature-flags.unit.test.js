const { isDriverSelfActionPushEnabled } = require('../../../utils/ride-lifecycle-feature-flags');

describe('ride lifecycle feature flags', () => {
  const original = process.env.ENABLE_DRIVER_SELF_ACTION_PUSH;

  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_DRIVER_SELF_ACTION_PUSH;
    else process.env.ENABLE_DRIVER_SELF_ACTION_PUSH = original;
  });

  it('keeps the driver self-action push off by default', () => {
    delete process.env.ENABLE_DRIVER_SELF_ACTION_PUSH;
    expect(isDriverSelfActionPushEnabled()).toBe(false);
  });

  it('turns the driver self-action push back on only when asked', () => {
    process.env.ENABLE_DRIVER_SELF_ACTION_PUSH = 'true';
    expect(isDriverSelfActionPushEnabled()).toBe(true);
    process.env.ENABLE_DRIVER_SELF_ACTION_PUSH = 'false';
    expect(isDriverSelfActionPushEnabled()).toBe(false);
  });
});
