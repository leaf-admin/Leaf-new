jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetRuntimeSummary = jest.fn();
const mockResolveProfile = jest.fn();

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  getRuntimeSummary: (...args) => mockGetRuntimeSummary(...args),
  resolveProfile: (...args) => mockResolveProfile(...args)
}));

jest.mock('../../../utils/pilot-launch-flags', () => ({
  getPilotLaunchFlags: jest.fn(() => ({
    launchProfile: 'test',
    leafDelasEnabled: true,
    driverDestinationModeEnabled: false,
    dynamicPricingEnabled: false,
    smartPushEnabled: false,
    adminMutationsEnabled: false
  }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

function createApp() {
  const app = express();
  app.use('/api/app', require('../../../routes/app-routes'));
  return app;
}

describe('app routes runtime config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockGetRuntimeSummary.mockResolvedValue({
      defaultEnvironment: 'production',
      defaultProfile: {
        profileId: 'env-default',
        environment: 'production',
        scope: 'global',
        source: 'env'
      },
      canarySandboxEnabled: true,
      globalSandboxEnabled: false,
      activeProfileCount: 2
    });
    mockResolveProfile.mockResolvedValue({
      profileId: 'sandbox-test-user',
      name: 'Teste sandbox',
      environment: 'sandbox',
      scope: 'users',
      source: 'firestore',
      reason: 'canary_test_user',
      expiresAtIso: '2026-06-12T00:00:00.000Z',
      wooviConfig: {
        apiToken: 'must-not-leak',
        clientSecret: 'must-not-leak'
      }
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns public-safe runtime config and effective payment profile for a user context', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"leaf"}';

    const response = await request(createApp())
      .get('/api/app/runtime-config')
      .set('x-leaf-user-id', 'passenger-test');

    expect(response.status).toBe(200);
    expect(response.body.schemaVersion).toBe(1);
    expect(response.body.paymentRuntime.defaultEnvironment).toBe('production');
    expect(response.body.paymentRuntime.effectiveProfile).toEqual(
      expect.objectContaining({
        profileId: 'sandbox-test-user',
        environment: 'sandbox',
        scope: 'users',
        contextMatched: true
      })
    );
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
    expect(response.body.mapsRoutingPolicy.placesCacheEnabled).toBe(true);
    expect(response.body.notificationPolicy.configured).toBe(true);
  });

  it('does not expose legacy BaaS copy in app info', async () => {
    const response = await request(createApp()).get('/api/app/info');

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/BaaS/i);
    expect(response.body.changelog[0].description).toContain('Ganhos e saque');
  });
});
