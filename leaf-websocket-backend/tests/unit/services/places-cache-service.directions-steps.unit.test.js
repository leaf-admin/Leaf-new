const mockRedisConnection = {
  get: jest.fn(),
  setex: jest.fn(),
  ping: jest.fn(),
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: () => mockRedisConnection,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('places-cache-service directions steps', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';
    mockRedisConnection.get.mockResolvedValue(null);
    mockRedisConnection.setex.mockResolvedValue('OK');
    mockRedisConnection.ping.mockResolvedValue('PONG');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }
  });

  function loadService() {
    jest.resetModules();
    return require('../../../services/places-cache-service');
  }

  it('normalizes Google Directions steps without HTML instructions', async () => {
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = false;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        routes: [
          {
            overview_polyline: { points: 'overview_polyline' },
            legs: [
              {
                distance: { value: 2500 },
                duration: { value: 420 },
                duration_in_traffic: { value: 480 },
                start_location: { lat: -22.9712, lng: -43.1822 },
                end_location: { lat: -22.9673, lng: -43.179 },
                start_address: 'Origem',
                end_address: 'Destino',
                steps: [
                  {
                    html_instructions: 'Vire <b>à direita</b> na Av. Atlântica',
                    start_location: { lat: -22.9712, lng: -43.1822 },
                    end_location: { lat: -22.9701, lng: -43.1811 },
                    distance: { value: 180 },
                    duration: { value: 50 },
                    polyline: { points: 'step_polyline' },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    const result = await placesCacheService.fetchDirectionsRoute({
      startLoc: '-22.9712,-43.1822',
      destLoc: '-22.9673,-43.1790',
      trafficEnabled: true,
    });

    expect(result.data.steps).toEqual([
      expect.objectContaining({
        instruction: 'Vire à direita na Av. Atlântica',
        distanceMeters: 180,
        durationSeconds: 50,
        polylinePoints: 'step_polyline',
      }),
    ]);
    expect(result.data.legs[0].steps[0]).toEqual(
      expect.objectContaining({
        startLocation: { lat: -22.9712, lng: -43.1822 },
        endLocation: { lat: -22.9701, lng: -43.1811 },
      }),
    );
  });

  it('preserves steps when returning a cached directions payload', async () => {
    const cachedPayload = {
      cached: false,
      routeCount: 1,
      waypointsCount: 0,
      data: {
        distance_in_km: 1.4,
        time_in_secs: 180,
        polylinePoints: 'cached_overview',
        legs: [
          {
            steps: [
              {
                instruction: 'Siga até o destino',
                startLocation: { lat: -22.9712, lng: -43.1822 },
                endLocation: { lat: -22.9673, lng: -43.179 },
                distanceMeters: 1400,
                durationSeconds: 180,
                polylinePoints: 'cached_step',
              },
            ],
          },
        ],
        steps: [
          {
            instruction: 'Siga até o destino',
            startLocation: { lat: -22.9712, lng: -43.1822 },
            endLocation: { lat: -22.9673, lng: -43.179 },
            distanceMeters: 1400,
            durationSeconds: 180,
            polylinePoints: 'cached_step',
          },
        ],
      },
    };
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(JSON.stringify(cachedPayload));
    global.fetch = jest.fn();

    const result = await placesCacheService.fetchDirectionsRoute({
      startLoc: '-22.9712,-43.1822',
      destLoc: '-22.9673,-43.1790',
    });

    expect(result.cached).toBe(true);
    expect(result.data.steps[0]).toEqual(
      expect.objectContaining({
        instruction: 'Siga até o destino',
        polylinePoints: 'cached_step',
      }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
