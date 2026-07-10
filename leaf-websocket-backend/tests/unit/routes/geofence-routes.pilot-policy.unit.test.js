jest.unmock('express');

const express = require('express');
const request = require('supertest');

const legacyRegion = [[
  [-43.4, -23.1],
  [-43.0, -23.1],
  [-43.0, -22.7],
  [-43.4, -23.1],
]];
const officialRegion = [[
  [-43.19, -22.99],
  [-43.16, -22.99],
  [-43.16, -22.95],
  [-43.19, -22.99],
]];

let enabled = true;
const mockUpdateRegion = jest.fn();
const mockSetEnabled = jest.fn((value) => {
  enabled = value;
});
const mockSetRealtimeDB = jest.fn();

jest.mock('../../../utils/pilot-launch-flags', () => ({
  isPilotControlledLaunch: jest.fn(() => true),
}));

jest.mock('../../../services/geofence-service', () => ({
  isEnabled: jest.fn(() => enabled),
  isActive: jest.fn(() => true),
  isBypassEnabled: jest.fn(() => false),
  isPointInPolygon: jest.fn(() => true),
  getCurrentRegion: jest.fn(() => officialRegion),
  updateRegion: (...args) => mockUpdateRegion(...args),
  setEnabled: (...args) => mockSetEnabled(...args),
  getOperationalStatus: jest.fn(() => ({
    available: true,
    configured: true,
    failClosed: true,
    code: 'GEOFENCE_ACTIVE',
    regionSource: 'file',
    regionVersion: 'rio-zona-sul-centro-lapa-v1',
    regionUpdatedAt: '2026-07-09',
    regionName: 'Piloto Rio - Zona Sul + Centro + Lapa',
    regionPolygons: 22,
    regionPoints: 4337,
    destinationInsideRegionRequired: true,
  })),
}));

jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: jest.fn(async (path) => (
    path === 'operations/geography/geofenceConfig'
      ? { enabled: false, region: legacyRegion, version: 1 }
      : null
  )),
  setRealtimeDB: (...args) => mockSetRealtimeDB(...args),
}));

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: (_req, _res, next) => next(),
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

describe('geofence routes controlled-pilot policy', () => {
  beforeEach(() => {
    enabled = true;
    mockUpdateRegion.mockClear();
    mockSetEnabled.mockClear();
    mockSetRealtimeDB.mockClear();
  });

  it('keeps the versioned polygon enabled instead of applying stale admin state', async () => {
    const response = await request(createApp()).get('/api/geofence/admin/config');

    expect(response.status).toBe(200);
    expect(response.body.geofence).toMatchObject({
      enabled: true,
      available: true,
      regionSource: 'file',
      regionVersion: 'rio-zona-sul-centro-lapa-v1',
      regionPolygons: 22,
      policyLocked: true,
      policyLockCode: 'GEOFENCE_POLICY_LOCKED',
    });
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
    expect(mockUpdateRegion).not.toHaveBeenCalled();
  });

  it('rejects mutable admin updates while the RC polygon is locked', async () => {
    const response = await request(createApp())
      .patch('/api/geofence/admin/config')
      .send({ enabled: false, region: legacyRegion });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'GEOFENCE_POLICY_LOCKED',
      geofence: {
        enabled: true,
        regionVersion: 'rio-zona-sul-centro-lapa-v1',
        policyLocked: true,
      },
    });
    expect(mockUpdateRegion).not.toHaveBeenCalled();
    expect(mockSetRealtimeDB).not.toHaveBeenCalled();
  });
});
