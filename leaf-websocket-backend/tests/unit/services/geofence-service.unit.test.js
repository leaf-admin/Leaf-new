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
      GEOFENCE_DESTINATION_BOUNDS: JSON.stringify([-23.1, -43.8, -22.7, -43.0]),
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
          destination: expect.objectContaining({
            insideOperationalRegion: true,
            insideDestinationArea: true,
          }),
        }),
      }),
    );
  });

  it('accepts rides with pickup inside the operational region and destination outside it but inside Rio', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(
      geofenceService.validateRideLocations(
        { lat: -22.91, lng: -43.22 },
        { lat: -23.00, lng: -43.36 },
      ),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        details: expect.objectContaining({
          pickup: { inside: true },
          destination: expect.objectContaining({
            insideOperationalRegion: false,
            insideDestinationArea: true,
          }),
        }),
      }),
    );
  });

  it('requires both pickup and destination inside the region in the pilot profile', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
    const geofenceService = require('../../../services/geofence-service');

    expect(
      geofenceService.validateRideLocations(
        { lat: -22.91, lng: -43.22 },
        { lat: -23.00, lng: -43.36 },
      ),
    ).toEqual(expect.objectContaining({
      valid: false,
      code: 'DESTINATION_OUTSIDE_REGION',
    }));
  });

  it('loads the official Zona Sul plus Centro and Lapa multi-polygon', () => {
    delete process.env.GEOFENCE_REGION;
    process.env.GEOFENCE_REGION_FILE = 'config/geofence.json';
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
    const geofenceService = require('../../../services/geofence-service');

    expect(geofenceService.getOperationalStatus()).toEqual(expect.objectContaining({
      configured: true,
      regionSource: 'default',
      regionVersion: 'rio-zona-sul-centro-lapa-v1',
      regionPolygons: 22,
      regionPoints: 4337,
      destinationInsideRegionRequired: true,
    }));
    expect(geofenceService.isPointInPolygon(-22.9068, -43.1729)).toBe(true); // Centro
    expect(geofenceService.isPointInPolygon(-22.9137, -43.1808)).toBe(true); // Lapa
    expect(geofenceService.isPointInPolygon(-22.971964, -43.182543)).toBe(true); // Copacabana
    expect(geofenceService.isPointInPolygon(-22.984843, -43.221972)).toBe(true); // Leblon
    expect(geofenceService.isPointInPolygon(-23.0005, -43.3650)).toBe(false); // Barra
    expect(geofenceService.isPointInPolygon(-22.9250, -43.2330)).toBe(false); // Tijuca
    expect(geofenceService.isPointInPolygon(-22.7595, -43.1095)).toBe(false); // Paqueta

    const boundary = require('../../../config/geofence.json').features[0].geometry.coordinates[0][0][0];
    expect(geofenceService.isPointInPolygon(boundary[1], boundary[0])).toBe(true);
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

  it('blocks a Sao Paulo pickup when the pilot polygon is in Rio', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(
      geofenceService.validateRideLocations(
        { lat: -23.5505, lng: -46.6333 },
        { lat: -22.89, lng: -43.18 },
      ),
    ).toEqual(expect.objectContaining({
      valid: false,
      code: 'PICKUP_OUTSIDE_REGION',
    }));
  });

  it('treats the inclusive left boundary as operationally inside the region', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(geofenceService.isPointInPolygon(-22.90, -43.25)).toBe(true);
    expect(geofenceService.isPointInPolygon(-22.90, -43.2502)).toBe(false);
  });

  it('blocks rides when destination is outside the configured destination area', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(
      geofenceService.validateRideLocations(
        { lat: -22.91, lng: -43.22 },
        { lat: -22.60, lng: -43.90 },
      ),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        code: 'DESTINATION_OUTSIDE_SERVICE_AREA',
      }),
    );
  });

  it('fails closed in production when no region is configured', () => {
    delete process.env.GEOFENCE_REGION;
    process.env.NODE_ENV = 'production';

    const geofenceService = require('../../../services/geofence-service');
    geofenceService.allowedRegion = null;
    geofenceService.regionSource = 'none';

    expect(geofenceService.isActive()).toBe(true);
    expect(geofenceService.getOperationalStatus()).toEqual(
      expect.objectContaining({
        available: false,
        configured: false,
        failClosed: true,
        code: 'GEOFENCE_NOT_CONFIGURED',
      }),
    );
    expect(
      geofenceService.validateRideLocations(
        { lat: -22.91, lng: -43.22 },
        { lat: -22.89, lng: -43.18 },
      ),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        code: 'GEOFENCE_NOT_CONFIGURED',
        retryable: true,
      }),
    );
  });

  it('fails closed in the pilot profile when geofence is disabled', () => {
    process.env.NODE_ENV = 'test';
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';

    const geofenceService = require('../../../services/geofence-service');
    geofenceService.setEnabled(false);

    expect(geofenceService.isActive()).toBe(true);
    expect(
      geofenceService.validateRideLocations(
        { lat: -22.91, lng: -43.22 },
        { lat: -22.89, lng: -43.18 },
      ),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        code: 'GEOFENCE_DISABLED',
        retryable: true,
      }),
    );
  });

  it('ignores geofence bypass requests in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.BYPASS_GEOFENCE = 'true';

    const geofenceService = require('../../../services/geofence-service');
    geofenceService.allowedRegion = null;

    expect(geofenceService.isBypassEnabled()).toBe(false);
    expect(geofenceService.isActive()).toBe(true);
    expect(
      geofenceService.validateRideLocations(
        { lat: -22.91, lng: -43.22 },
        { lat: -22.89, lng: -43.18 },
      ),
    ).toEqual(expect.objectContaining({
      valid: false,
      code: 'GEOFENCE_NOT_CONFIGURED',
    }));
  });

  it('rejects invalid coordinates before evaluating the polygon', () => {
    const geofenceService = require('../../../services/geofence-service');

    expect(
      geofenceService.validateRideLocations(
        { lat: 91, lng: -43.22 },
        { lat: -22.89, lng: -43.18 },
      ),
    ).toEqual(expect.objectContaining({ valid: false, code: 'INVALID_PICKUP' }));
  });
});
