jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetRuntimeSummary = jest.fn();
const mockResolveProfile = jest.fn();
const mockGetH3VisualPolicy = jest.fn();

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  getRuntimeSummary: (...args) => mockGetRuntimeSummary(...args),
  resolveProfile: (...args) => mockResolveProfile(...args)
}));

jest.mock('../../../services/h3-visual-policy-service', () => ({
  getPolicy: (...args) => mockGetH3VisualPolicy(...args)
}));

jest.mock('../../../utils/pilot-launch-flags', () => ({
  isPilotControlledLaunch: jest.fn(() => false),
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
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
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
    process.env.ENABLE_DRIVER_DESTINATION_MODE = 'true';
    process.env.DRIVER_DESTINATION_DAILY_BASE_QUOTA = '2';
    process.env.DRIVER_DESTINATION_DAILY_MAX_QUOTA = '12';
    process.env.DRIVER_DESTINATION_BONUS_RIDE_WINDOW = '5';
    process.env.DRIVER_DESTINATION_DURATION_MINUTES = '90';
    process.env.DRIVER_DESTINATION_MIN_PROGRESS_KM = '1';
    process.env.DRIVER_DESTINATION_ARRIVAL_RADIUS_KM = '3';
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
    mockGetH3VisualPolicy.mockResolvedValue({
      enabled: true,
      opacity: 0.7,
      resolutionOffset: 0,
      label: {
        enabled: true,
        minPercent: 3,
        maxVisible: 12,
        template: '+{percent}%'
      },
      version: 2
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
    expect(response.body.mapsRoutingPolicy.trafficAwareRoutes).toBe(true);
    expect(response.body.mapsRoutingPolicy.routesCacheTtlSeconds).toBe(90);
    expect(response.body.mapsRoutingPolicy.driverTrafficLayerEnabled).toBe(true);
    expect(response.body.mapsRoutingPolicy.demandHeatmap).toMatchObject({
      source: 'leaf_internal_supply_demand',
      paidProviderCalls: false,
      trafficAffectsHeatmap: false
    });
    expect(response.body.mapsRoutingPolicy.h3VisualPolicy).toMatchObject({
      enabled: true,
      opacity: 0.7,
      version: 2
    });
    expect(response.body.notificationPolicy.configured).toBe(true);
    expect(response.body.launchControl).toEqual(expect.objectContaining({
      pilotControlled: expect.any(Boolean),
      passengerCohortSize: expect.any(Number),
      driverCohortSize: expect.any(Number),
      geofence: expect.objectContaining({
        code: expect.any(String),
        failClosed: expect.any(Boolean)
      })
    }));
    expect(response.body.pricingPolicy).toMatchObject({
      mode: 'dry_run',
      trafficPricing: 'traffic_aware_time_component',
      dynamicMarkup: 'legacy_combined_pressure',
      maxDynamicMarkupPercent: 35
    });
    expect(response.body.driverDestinationPolicy).toMatchObject({
      enabled: true,
      baseDailyQuota: 2,
      maxDailyQuota: 12,
      bonusRideWindow: 5,
      maxCarriedBonusTickets: 1,
      durationMinutes: 90,
      minProgressKm: 1,
      arrivalRadiusKm: 3
    });
  });

  it('does not expose legacy BaaS copy in app info', async () => {
    const response = await request(createApp()).get('/api/app/info');

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/BaaS/i);
    expect(response.body.changelog[0].description).toContain('Ganhos e saque');
  });
});
