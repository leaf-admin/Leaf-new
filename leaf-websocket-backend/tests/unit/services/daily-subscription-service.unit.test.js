const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

jest.mock('../../../utils/logger', () => ({ logger: mockLogger }));
jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => null)
}));
jest.mock('../../../services/subscription-state-service', () => ({
  runTransaction: jest.fn()
}));

const loadService = (env = {}) => {
  jest.resetModules();
  process.env = { ...process.env, ...env };
  return require('../../../services/daily-subscription-service');
};

describe('DailySubscriptionService operational daily fee policy', () => {
  const originalEnv = { ...process.env };
  const now = new Date('2026-06-10T12:00:00.000Z');
  const oldDriver = {
    uid: 'driver_1',
    approved: true,
    usertype: 'driver',
    createdAt: '2026-03-01T12:00:00.000Z',
    city: 'Rio de Janeiro'
  };
  const notifiedSubscription = {
    dailyFeeNoticeSentAt: '2026-03-15T12:00:00.000Z'
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const eligibleBillingConfig = (service) => ({
    ...service.getDefaultBillingConfig(),
    activation: {
      ...service.getDefaultBillingConfig().activation,
      eligibleCities: ['Rio de Janeiro']
    }
  });

  it('keeps withdrawal as the only collection mode and resolves the approved daily gross tiers', () => {
    const service = loadService();
    const billingConfig = eligibleBillingConfig(service);

    const cases = [
      [0, 0, 'up_to_100'],
      [10000, 0, 'up_to_100'],
      [10001, 490, '100_to_200'],
      [20000, 490, '100_to_200'],
      [20001, 790, '200_to_300'],
      [30001, 1290, '300_to_500'],
      [50001, 1490, 'above_500']
    ];

    for (const [gross, expectedFee, expectedTier] of cases) {
      const policy = service.resolveDailyFeePolicy({
        driverId: 'driver_1',
        planType: 'plus',
        driverData: oldDriver,
        subscriptionData: notifiedSubscription,
        billingConfig,
        now,
        dailyGrossRevenueCents: gross
      });

      expect(policy.collectionMode).toBe('withdrawal');
      expect(policy.grossDailyRevenueCents).toBe(gross);
      expect(policy.dailyFeeCents).toBe(expectedFee);
      expect(policy.nominalDailyFeeCents).toBe(expectedFee);
      expect(policy.dailyFeeTierId).toBe(expectedTier);
      expect(policy.activationEligible).toBe(true);
      expect(policy.source).toBe('daily_gross_revenue_tier');
    }
  });

  it('blocks activation when city maturity is not configured even if the global flag is enabled later', () => {
    const service = loadService({ SUBSCRIPTION_DAILY_BILLING_ENABLED: 'true' });
    const policy = service.resolveDailyFeePolicy({
      driverId: 'driver_1',
      planType: 'plus',
      driverData: oldDriver,
      subscriptionData: notifiedSubscription,
      billingConfig: service.getDefaultBillingConfig(),
      now,
      dailyGrossRevenueCents: 60000
    });

    expect(policy.activationEligible).toBe(false);
    expect(policy.activationBlockedReason).toBe('city_activation_not_configured');
    expect(policy.dailyFeeCents).toBe(0);
    expect(policy.nominalDailyFeeCents).toBe(1490);
  });

  it('does not charge new drivers before the configured minimum account age', () => {
    const service = loadService();
    const billingConfig = eligibleBillingConfig(service);
    const policy = service.resolveDailyFeePolicy({
      driverId: 'driver_new',
      planType: 'plus',
      driverData: {
        ...oldDriver,
        uid: 'driver_new',
        createdAt: '2026-05-20T12:00:00.000Z'
      },
      subscriptionData: notifiedSubscription,
      billingConfig,
      now,
      dailyGrossRevenueCents: 60000
    });

    expect(policy.activationEligible).toBe(false);
    expect(policy.activationBlockedReason).toBe('min_account_age_not_met');
    expect(policy.dailyFeeCents).toBe(0);
  });

  it('requires the 60-day notice period before charging on withdrawal', () => {
    const service = loadService();
    const billingConfig = eligibleBillingConfig(service);
    const policy = service.resolveDailyFeePolicy({
      driverId: 'driver_1',
      planType: 'plus',
      driverData: oldDriver,
      subscriptionData: {
        dailyFeeNoticeSentAt: '2026-05-01T12:00:00.000Z'
      },
      billingConfig,
      now,
      dailyGrossRevenueCents: 60000
    });

    expect(policy.activationEligible).toBe(false);
    expect(policy.activationBlockedReason).toBe('notice_period_not_met');
    expect(policy.dailyFeeCents).toBe(0);
  });

  it('lets an explicit driver cohort include bypass the age/city guards without enabling global billing by itself', () => {
    const service = loadService();
    const billingConfig = service.mergeBillingConfig({
      activation: {
        enabledDriverIds: ['driver_beta'],
        eligibleCities: []
      }
    });

    const policy = service.resolveDailyFeePolicy({
      driverId: 'driver_beta',
      planType: 'plus',
      driverData: {
        ...oldDriver,
        uid: 'driver_beta',
        city: 'Niteroi',
        createdAt: '2026-06-01T12:00:00.000Z'
      },
      subscriptionData: {},
      billingConfig,
      now,
      dailyGrossRevenueCents: 25000
    });

    expect(service.DAILY_BILLING_ENABLED).toBe(false);
    expect(policy.activationEligible).toBe(true);
    expect(policy.activationBlockedReason).toBe(null);
    expect(policy.dailyFeeCents).toBe(790);
    expect(policy.source).toBe('daily_gross_revenue_tier');
  });
});
