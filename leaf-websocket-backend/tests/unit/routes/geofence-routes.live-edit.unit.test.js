jest.unmock('express');

const express = require('express');
const request = require('supertest');

const region = [[[-43.19, -22.99], [-43.16, -22.99], [-43.16, -22.95], [-43.19, -22.99]]];
const mockSaveVersion = jest.fn();
const mockRestoreVersion = jest.fn();
const mockListVersions = jest.fn();

jest.mock('../../../utils/pilot-launch-flags', () => ({
  isPilotControlledLaunch: jest.fn(() => true),
  // Mutações gerais do painel desligadas, como em produção.
  isLaunchFeatureEnabled: jest.fn(() => false),
  buildLaunchFeatureDisabledPayload: jest.fn((code, message) => ({ success: false, code, message })),
}));

jest.mock('../../../services/geofence-live-policy-service', () => ({
  isEnabled: jest.fn(() => true),
  applyLiveConfig: jest.fn(() => false),
  start: jest.fn(),
  saveVersion: (...args) => mockSaveVersion(...args),
  restoreVersion: (...args) => mockRestoreVersion(...args),
  listVersions: (...args) => mockListVersions(...args),
}));

jest.mock('../../../services/geofence-service', () => ({
  isEnabled: jest.fn(() => true),
  isActive: jest.fn(() => true),
  isBypassEnabled: jest.fn(() => false),
  isPointInPolygon: jest.fn(() => true),
  getCurrentRegion: jest.fn(() => region),
  updateRegion: jest.fn(() => true),
  setEnabled: jest.fn(),
  getOperationalStatus: jest.fn(() => ({
    available: true, configured: true, failClosed: true, code: 'GEOFENCE_ACTIVE',
    regionSource: 'file', regionVersion: 'rio-zona-sul-v3', regionName: 'Piloto Rio - Zona Sul',
    regionPolygons: 1, regionPoints: 3, destinationInsideRegionRequired: true,
  })),
}));

jest.mock('../../../firebase-config', () => ({ getFirestore: () => null }));

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: (req, _res, next) => { req.user = { id: 'admin-1', email: 'admin@leaf' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
}));

const geofenceRoutes = require('../../../routes/geofence-routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/geofence', geofenceRoutes);
  return app;
}

const savedVersion = { id: '20261103220000-abc123', policyId: 'rio-zona-sul-v4', polygonCount: 1, pointCount: 3 };

describe('geofence routes with live edit enabled', () => {
  beforeEach(() => {
    mockSaveVersion.mockReset().mockResolvedValue({
      version: savedVersion,
      config: { version: 2, enabled: true, region, liveVersion: { id: savedVersion.id, policyId: 'rio-zona-sul-v4' } },
    });
    mockRestoreVersion.mockReset().mockResolvedValue({
      version: { ...savedVersion, restoredFrom: 'old-1' },
      config: { version: 3, enabled: true, region, liveVersion: { id: 'new-1' } },
    });
    mockListVersions.mockReset().mockResolvedValue([savedVersion]);
  });

  it('unlocks the policy during the pilot and reports live edit', async () => {
    const response = await request(createApp()).get('/api/geofence/admin/config');

    expect(response.status).toBe(200);
    expect(response.body.geofence).toMatchObject({ policyLocked: false, policyLockCode: null, adminEditEnabled: true });
  });

  it('saves the drawn area as a new version even with general mutations off', async () => {
    const response = await request(createApp())
      .patch('/api/geofence/admin/config')
      .send({ region, policyId: 'rio-zona-sul-v4', name: 'Piloto' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, version: { policyId: 'rio-zona-sul-v4' } });
    expect(mockSaveVersion).toHaveBeenCalledWith(expect.objectContaining({
      region, policyId: 'rio-zona-sul-v4', name: 'Piloto', actor: 'admin-1',
    }));
  });

  it('still refuses to switch the area off during the pilot', async () => {
    const response = await request(createApp())
      .patch('/api/geofence/admin/config')
      .send({ enabled: false, region, policyId: 'rio-zona-sul-v4' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('GEOFENCE_DISABLE_LOCKED');
    expect(mockSaveVersion).not.toHaveBeenCalled();
  });

  it('returns the validation message from the service', async () => {
    mockSaveVersion.mockRejectedValue(Object.assign(new Error('Área 1: as bordas se cruzam.'), { statusCode: 400 }));

    const response = await request(createApp())
      .patch('/api/geofence/admin/config')
      .send({ region, policyId: 'rio-zona-sul-v4' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Área 1: as bordas se cruzam.');
  });

  it('lists versions and restores one', async () => {
    const list = await request(createApp()).get('/api/geofence/admin/versions');
    expect(list.body).toMatchObject({ success: true, enabled: true, versions: [{ policyId: 'rio-zona-sul-v4' }] });

    const restore = await request(createApp()).post('/api/geofence/admin/versions/old-1/restore');
    expect(restore.status).toBe(200);
    expect(mockRestoreVersion).toHaveBeenCalledWith('old-1', expect.objectContaining({ actor: 'admin-1' }));
  });
});
