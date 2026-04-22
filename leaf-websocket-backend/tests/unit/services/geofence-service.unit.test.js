jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('geofence-service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      GEOFENCE_REGION: JSON.stringify([
        [-43.25, -22.95],
        [-43.15, -22.95],
        [-43.15, -22.85],
        [-43.25, -22.85],
        [-43.25, -22.95],
      ]),
      BYPASS_GEOFENCE: 'false',
      APP_REVIEW: 'false',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts rides fully inside the configured region', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(
      geofenceService.validateRideLocations(
        { lat: -22.91, lng: -43.22 },
        { lat: -22.89, lng: -43.18 },
      ),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        details: expect.objectContaining({
          pickup: { inside: true },
          destination: { inside: true },
        }),
      }),
    );
  });

  it('blocks rides when pickup is outside the configured region', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(
      geofenceService.validateRideLocations(
        { lat: -22.80, lng: -43.30 },
        { lat: -22.89, lng: -43.18 },
      ),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        code: 'PICKUP_OUTSIDE_REGION',
      }),
    );
  });

  it('treats the inclusive left boundary as operationally inside the region', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(geofenceService.isPointInPolygon(-22.90, -43.25)).toBe(true);
    expect(geofenceService.isPointInPolygon(-22.90, -43.2502)).toBe(false);
  });
});
