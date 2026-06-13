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

  it('reports runtime role and app version in runtime section', async () => {
    process.env.RUNTIME_ROLE = 'sideeffects';
    process.env.APP_VERSION = '1.2.3';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.runtime.runtimeRole).toBe('sideeffects');
    expect(response.body.runtime.appVersion).toBe('1.2.3');
  });

  it('reports firebase section with booleans', async () => {
    process.env.FIREBASE_DATABASE_URL = 'https://leaf-test.firebaseio.com';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"dummy": true}';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.firebase).toBeDefined();
    expect(response.body.firebase.configured).toBe(true);
    expect(response.body.firebase.serviceAccountConfigured).toBe(true);
    expect(response.body.firebase.databaseUrlConfigured).toBe(true);
  });

  it('reports firebase unconfigured when no vars set', async () => {
    delete process.env.FIREBASE_DATABASE_URL;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.firebase.configured).toBe(false);
  });

  it('reports push section with booleans', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"leaf"}';
    process.env.ALLOW_PUBLIC_DIRECT_FCM_SEND = 'false';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.push).toBeDefined();
    expect(response.body.push.configured).toBe(true);
    expect(response.body.push.provider).toBe('firebase-admin');
    expect(response.body.push.fcmConfigured).toBe(true);
    expect(response.body.push.allowPublicDirectFcmSend).toBe(false);
  });

  it('reports kyc section with booleans', async () => {
    process.env.KYC_PRODUCTION_BIOMETRICS_ENABLED = 'true';
    process.env.KYC_AWS_LIVENESS_ENABLED = 'true';
    process.env.ENABLE_CNH_FACE_BIOMETRICS = 'true';
    process.env.KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH = 'true';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.kyc).toBeDefined();
    expect(response.body.kyc.productionBiometricsEnabled).toBe(true);
    expect(response.body.kyc.awsLivenessConfigured).toBe(true);
    expect(response.body.kyc.cnhFaceBiometricsConfigured).toBe(true);
    expect(response.body.kyc.requireTrustedBiometricMatch).toBe(true);
  });

  it('reports maps section with booleans', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.ENABLE_PLACES_CACHE = 'true';
    process.env.GEO_KEY = 'geo-key';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.maps).toBeDefined();
    expect(response.body.maps.configured).toBe(true);
    expect(response.body.maps.keyConfigured).toBe(true);
    expect(response.body.maps.placesCacheEnabled).toBe(true);
    expect(response.body.maps.receiptMapImagesConfigured).toBe(true);
  });

  it('reports pricing separation and driver traffic-layer policy', async () => {
    process.env.PRICING_DEMAND_PRESSURE_MODE = 'active';
    process.env.ENABLE_DRIVER_TRAFFIC_LAYER = 'true';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.pricing).toEqual({
      demandPressureMode: 'active',
      trafficPricing: 'traffic_aware_time_component',
      heatmapSource: 'leaf_internal_supply_demand',
      driverTrafficLayerEnabled: true
    });
  });

  it('reports maps.googleFallbackAllowed and backendOnly', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const appWithoutFallback = createApp();
    const resNoFallback = await request(appWithoutFallback).get('/health/runtime-flags');
    expect(resNoFallback.body.maps.clientDirectGoogleFallbackAllowed).toBe(false);
    expect(resNoFallback.body.maps.backendOnly).toBe(true);

    process.env.EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK = 'true';
    const appWithFallback = createApp();
    const resWithFallback = await request(appWithFallback).get('/health/runtime-flags');
    expect(resWithFallback.body.maps.clientDirectGoogleFallbackAllowed).toBe(true);
    expect(resWithFallback.body.maps.backendOnly).toBe(false);
  });

  it('reports maps.backendOnly=false when maps key is absent', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.body.maps.configured).toBe(false);
    expect(response.body.maps.backendOnly).toBe(false);
  });

  it('keeps places cache enabled by default unless explicitly disabled', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    delete process.env.ENABLE_PLACES_CACHE;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const enabledByDefault = await request(createApp()).get('/health/runtime-flags');
    expect(enabledByDefault.body.maps.placesCacheEnabled).toBe(true);

    process.env.ENABLE_PLACES_CACHE = 'false';
    const disabledExplicitly = await request(createApp()).get('/health/runtime-flags');
    expect(disabledExplicitly.body.maps.placesCacheEnabled).toBe(false);
  });

  it('reports socket section with booleans', async () => {
    process.env.ENABLE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.REQUIRE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.status).toBe(200);
    expect(response.body.socket).toBeDefined();
    expect(response.body.socket.redisAdapterEnabled).toBe(true);
    expect(response.body.socket.redisAdapterRequired).toBe(true);
  });

  it('default runtime role is gateway when not set', async () => {
    delete process.env.RUNTIME_ROLE;
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

    const app = createApp();
    const response = await request(app).get('/health/runtime-flags');

    expect(response.body.runtime.runtimeRole).toBe('gateway');
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
