jest.unmock('express');

const express = require('express');
const request = require('supertest');

jest.mock('../../../services/health-check-service', () => ({
  runAllChecks: jest.fn(async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {}
  })),
  quickCheck: jest.fn(async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString()
  }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const healthRoutes = require('../../../routes/health');

function createApp() {
  const app = express();
  app.use(healthRoutes);
  return app;
}

describe('health runtime flags route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports ready=true for strict real-sandbox runtime', async () => {
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';
    process.env.REQUIRE_PAYMENT_BEFORE_BOOKING = 'true';
    process.env.VERIFY_PAYMENT_BEFORE_BOOKING = 'true';
    process.env.REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING = 'true';
    process.env.APP_REVIEW = 'false';
    process.env.MOCK_PAYMENT_FOR_TESTS = 'false';
    process.env.ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING = 'false';
    process.env.PAYMENT_BYPASS_ON_WOOVI_FAILURE = 'false';
    process.env.PAYMENT_FORCE_BYPASS = 'false';
    process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'false';
    process.env.AUTH_REVIEW_OTP_BYPASS_ENABLED = 'false';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.woovi.environment).toBe('sandbox');
    expect(response.body.launch).toEqual(
      expect.objectContaining({
        launchProfile: expect.any(String),
        demandPredictionEnabled: expect.any(Boolean),
        referralProgramsEnabled: expect.any(Boolean),
        leafDelasEnabled: expect.any(Boolean),
        driverDestinationModeEnabled: expect.any(Boolean),
        dynamicPricingEnabled: expect.any(Boolean),
        smartPushEnabled: expect.any(Boolean),
        adminMutationsEnabled: expect.any(Boolean)
      })
    );
    expect(response.body.realSandbox.ready).toBe(true);
    expect(response.body.realSandbox.blockers).toEqual([]);
  });

  it('reports blockers when bypass flags are enabled', async () => {
    process.env.WOOVI_ENVIRONMENT = 'production';
    process.env.WOOVI_BASE_URL = 'https://api.woovi.com/api/v1';
    process.env.APP_REVIEW = 'true';
    process.env.PAYMENT_BYPASS_ON_WOOVI_FAILURE = 'true';
    process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'true';

    const app = createApp();
    const response = await request(app).get('/api/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.realSandbox.ready).toBe(false);
    expect(response.body.realSandbox.blockers).toEqual(
      expect.arrayContaining([
        'WOOVI_ENVIRONMENT != sandbox',
        'WOOVI_BASE_URL não aponta para sandbox',
        'APP_REVIEW=true',
        'PAYMENT_BYPASS_ON_WOOVI_FAILURE=true',
        'AUTH_TEST_OTP_BYPASS_ENABLED=true'
      ])
    );
  });
});
