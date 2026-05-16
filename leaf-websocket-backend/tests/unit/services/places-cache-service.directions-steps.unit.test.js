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
  const originalPlacesDirectionsTtl = process.env.PLACES_DIRECTIONS_CACHE_TTL_SECONDS;
  const originalDirectionsTtl = process.env.DIRECTIONS_CACHE_TTL_SECONDS;
  const originalPlacesDirectionsTrafficTtl = process.env.PLACES_DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;
  const originalDirectionsTrafficTtl = process.env.DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';
    delete process.env.PLACES_DIRECTIONS_CACHE_TTL_SECONDS;
    delete process.env.DIRECTIONS_CACHE_TTL_SECONDS;
    delete process.env.PLACES_DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;
    delete process.env.DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;
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
    if (originalPlacesDirectionsTtl === undefined) {
      delete process.env.PLACES_DIRECTIONS_CACHE_TTL_SECONDS;
    } else {
      process.env.PLACES_DIRECTIONS_CACHE_TTL_SECONDS = originalPlacesDirectionsTtl;
    }
    if (originalDirectionsTtl === undefined) {
      delete process.env.DIRECTIONS_CACHE_TTL_SECONDS;
    } else {
      process.env.DIRECTIONS_CACHE_TTL_SECONDS = originalDirectionsTtl;
    }
    if (originalPlacesDirectionsTrafficTtl === undefined) {
      delete process.env.PLACES_DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;
    } else {
      process.env.PLACES_DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS = originalPlacesDirectionsTrafficTtl;
    }
    if (originalDirectionsTrafficTtl === undefined) {
      delete process.env.DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;
    } else {
      process.env.DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS = originalDirectionsTrafficTtl;
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

  it('bypasses directions cache when forceFresh is requested and stores with short traffic TTL', async () => {
    const cachedPayload = {
      cached: false,
      routeCount: 1,
      waypointsCount: 0,
      data: {
        distance_in_km: 1.4,
        time_in_secs: 180,
        polylinePoints: 'cached_overview',
        legs: [],
        steps: [],
      },
    };
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(JSON.stringify(cachedPayload));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        routes: [
          {
            overview_polyline: { points: 'fresh_overview' },
            legs: [
              {
                distance: { value: 2500 },
                duration: { value: 420 },
                duration_in_traffic: { value: 480 },
                start_location: { lat: -22.9712, lng: -43.1822 },
                end_location: { lat: -22.9673, lng: -43.179 },
                start_address: 'Origem',
                end_address: 'Destino',
                steps: [],
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
      forceFresh: true,
    });

    expect(result.cached).toBe(false);
    expect(result.data.polylinePoints).toBe('fresh_overview');
    expect(result.cachePolicy).toEqual({
      forceFresh: true,
      ttlSeconds: 90,
    });
    expect(result.stats.redisReads).toBe(0);
    expect(result.stats.googleRequests).toBe(1);
    expect(mockRedisConnection.get).not.toHaveBeenCalled();
    expect(mockRedisConnection.setex).toHaveBeenCalledWith(
      expect.stringContaining('maps:directions:'),
      90,
      expect.stringContaining('fresh_overview'),
    );
  });

  it('returns cached place details by place_id without calling Google', async () => {
    const cachedPlace = {
      place_id: 'place_cached_1',
      name: 'Shopping Leblon',
      address: 'Av. Afrânio de Melo Franco, Rio de Janeiro',
      lat: -22.9837,
      lng: -43.2179,
    };
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(JSON.stringify(cachedPlace));
    global.fetch = jest.fn();

    const result = await placesCacheService.getPlaceDetails('place_cached_1');

    expect(result).toEqual(expect.objectContaining({
      place_id: 'place_cached_1',
      lat: -22.9837,
      lng: -43.2179,
      cached: true,
      source: 'place_id_cache',
    }));
    expect(mockRedisConnection.get).toHaveBeenCalledWith('place:id:place_cached_1');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('caches Google place details by place_id after lookup', async () => {
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        result: {
          place_id: 'place_google_1',
          name: 'Copacabana Palace',
          formatted_address: 'Av. Atlântica, 1702 - Copacabana',
          geometry: {
            location: {
              lat: -22.967,
              lng: -43.179,
            },
          },
        },
      }),
    });

    const result = await placesCacheService.getPlaceDetails('place_google_1');

    expect(result).toEqual(expect.objectContaining({
      place_id: 'place_google_1',
      lat: -22.967,
      lng: -43.179,
      cached: false,
      source: 'google_place_details',
    }));
    expect(mockRedisConnection.setex).toHaveBeenCalledWith(
      'place:id:place_google_1',
      placesCacheService.cacheTTL,
      expect.stringContaining('Copacabana Palace'),
    );
  });

  it('stores query cache in a geohash-scoped key when search location is provided', async () => {
    const placesCacheService = loadService();
    placesCacheService.isInitialized = true;

    const saved = await placesCacheService.savePlace(
      'Shopping Leblon',
      {
        place_id: 'place_geo_1',
        name: 'Shopping Leblon',
        address: 'Av. Afrânio de Melo Franco, Rio de Janeiro',
        lat: -22.9837,
        lng: -43.2179,
      },
      {
        location: {
          lat: -22.984,
          lng: -43.218,
        },
      },
    );

    const cacheKeys = mockRedisConnection.setex.mock.calls.map((call) => call[0]);
    expect(saved).toBe(true);
    expect(cacheKeys).toEqual(expect.arrayContaining([
      expect.stringMatching(/^place:v2:geo:[a-z0-9]+:shopping_leblon$/),
      'place:id:place_geo_1',
    ]));
    expect(cacheKeys).not.toContain('place:shopping_leblon');
  });

  it('does not reuse a distant legacy query cache hit when search location is provided', async () => {
    const placesCacheService = loadService();
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockImplementation(async (key) => {
      if (String(key).startsWith('place:v2:geo:')) {
        return null;
      }
      if (key === 'place:centro') {
        return JSON.stringify({
          place_id: 'centro_sp',
          name: 'Centro',
          address: 'Centro, São Paulo',
          lat: -23.5505,
          lng: -46.6333,
        });
      }
      return null;
    });

    const result = await placesCacheService.searchPlace('Centro', {
      lat: -22.9068,
      lng: -43.1729,
    });

    expect(result).toBeNull();
  });
});
