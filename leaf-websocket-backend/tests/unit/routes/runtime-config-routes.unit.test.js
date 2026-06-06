jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockBuildEffectiveConfig = jest.fn();
const mockBuildBaseConfig = jest.fn();
const mockListOverrides = jest.fn();
const mockUpsertOverride = jest.fn();
const mockUpdateOverrideStatus = jest.fn();
const mockRollbackOverride = jest.fn();
const mockGetPolicy = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn().mockResolvedValue({
      uid: 'driver_1',
      phone_number: '+5521992000000',
      userType: 'driver'
    })
  })),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP')
    }
  }
}));

jest.mock('../../../services/runtime-config-service', () => ({
  buildEffectiveConfig: mockBuildEffectiveConfig,
  buildBaseConfig: mockBuildBaseConfig,
  listOverrides: mockListOverrides,
  upsertOverride: mockUpsertOverride,
  updateOverrideStatus: mockUpdateOverrideStatus,
  rollbackOverride: mockRollbackOverride
}));

jest.mock('../../../services/driver-online-policy-service', () => ({
  getPolicy: mockGetPolicy
}));

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: jest.fn((req, _res, next) => {
    req.user = { id: 'admin_1', uid: 'admin_1', role: 'admin', email: 'admin@leaf.test' };
    next();
  }),
  requireSupportRoles: jest.fn(() => (_req, _res, next) => next())
}));

jest.mock('../../../firebase-config', () => ({
  initializeFirebase: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn()
}));

function createApp() {
  const routes = require('../../../routes/runtime-config');
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

describe('runtime-config routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildEffectiveConfig.mockResolvedValue({
      schemaVersion: 1,
      cacheTtlSeconds: 60,
      featureGates: { smartPushEnabled: false },
      mapsRoutingPolicy: { backendOnly: true, clientDirectGoogleFallback: false }
    });
    mockBuildBaseConfig.mockReturnValue({
      schemaVersion: 1,
      cacheTtlSeconds: 60,
      featureGates: {},
      mapsRoutingPolicy: { backendOnly: true }
    });
    mockListOverrides.mockResolvedValue({
      success: true,
      overrides: [{ overrideId: 'ovr_1', status: 'active' }]
    });
    mockUpsertOverride.mockResolvedValue({
      success: true,
      override: { overrideId: 'ovr_1', status: 'paused' }
    });
    mockUpdateOverrideStatus.mockResolvedValue({
      success: true,
      override: { overrideId: 'ovr_1', status: 'active' }
    });
    mockRollbackOverride.mockResolvedValue({
      success: true,
      override: { overrideId: 'ovr_1', status: 'paused' }
    });
    mockGetPolicy.mockResolvedValue({
      success: true,
      driverId: 'driver_1',
      canGoOnline: true,
      blockers: []
    });
  });

  it('returns public-safe runtime config without requiring auth', async () => {
    const response = await request(createApp()).get('/api/app/runtime-config');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      config: {
        schemaVersion: 1,
        mapsRoutingPolicy: { backendOnly: true, clientDirectGoogleFallback: false }
      }
    });
    expect(mockBuildEffectiveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null }),
      { forceRefresh: false }
    );
  });

  it('returns admin effective config and overrides', async () => {
    const response = await request(createApp())
      .get('/api/admin/runtime-config?includeInactive=true')
      .set('Authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      overrides: [{ overrideId: 'ovr_1' }]
    });
    expect(mockListOverrides).toHaveBeenCalledWith({ includeInactive: true });
  });

  it('updates runtime overrides behind admin auth', async () => {
    const response = await request(createApp())
      .post('/api/admin/runtime-config/overrides')
      .set('Authorization', 'Bearer admin-token')
      .send({
        overrideId: 'ovr_1',
        config: { featureGates: { smartPushEnabled: true } }
      });

    expect(response.status).toBe(200);
    expect(mockUpsertOverride).toHaveBeenCalledWith(
      expect.objectContaining({ overrideId: 'ovr_1' }),
      expect.objectContaining({ id: 'admin_1' })
    );
  });

  it('exposes authenticated driver online policy', async () => {
    const response = await request(createApp())
      .get('/api/drivers/me/online-policy')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      driverId: 'driver_1',
      canGoOnline: true
    });
    expect(mockGetPolicy).toHaveBeenCalledWith(
      'driver_1',
      expect.objectContaining({ actor: expect.objectContaining({ uid: 'driver_1' }) })
    );
  });

  it('evaluates driver online intent through the same backend policy', async () => {
    const response = await request(createApp())
      .post('/api/drivers/me/online-intent')
      .set('Authorization', 'Bearer firebase-token')
      .send({ requestedStatus: 'online' });

    expect(response.status).toBe(200);
    expect(mockGetPolicy).toHaveBeenCalledWith(
      'driver_1',
      expect.objectContaining({
        intent: 'go_online',
        payload: { requestedStatus: 'online' }
      })
    );
  });
});
