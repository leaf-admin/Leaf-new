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
  const originalRoutesTrafficPolyline = process.env.ENABLE_ROUTES_API_TRAFFIC_POLYLINE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';
    delete process.env.PLACES_DIRECTIONS_CACHE_TTL_SECONDS;
    delete process.env.DIRECTIONS_CACHE_TTL_SECONDS;
    delete process.env.PLACES_DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;
    delete process.env.DIRECTIONS_TRAFFIC_CACHE_TTL_SECONDS;
    delete process.env.ENABLE_ROUTES_API_TRAFFIC_POLYLINE;
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
    if (originalRoutesTrafficPolyline === undefined) {
      delete process.env.ENABLE_ROUTES_API_TRAFFIC_POLYLINE;
    } else {
      process.env.ENABLE_ROUTES_API_TRAFFIC_POLYLINE = originalRoutesTrafficPolyline;
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
    expect(result.data).toMatchObject({
      time_in_secs: 480,
      duration_without_traffic: 420,
      duration_in_traffic: 480,
      legs: [
        expect.objectContaining({
          time_in_secs: 480,
          duration_without_traffic: 420,
          duration_in_traffic: 480,
        }),
      ],
    });
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

  it('bypasses stale traffic directions cache without traffic timings', async () => {
    const cachedPayload = {
      cached: false,
      routeCount: 1,
      waypointsCount: 0,
      data: {
        distance_in_km: 1.4,
        time_in_secs: 180,
        duration_without_traffic: null,
        duration_in_traffic: null,
        polylinePoints: 'stale_overview',
        legs: [
          {
            time_in_secs: 180,
            duration_without_traffic: null,
            duration_in_traffic: null,
            steps: [],
          },
        ],
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
            overview_polyline: { points: 'fresh_traffic_overview' },
            legs: [
              {
                distance: { value: 2500 },
                duration: { value: 420 },
                duration_in_traffic: { value: 600 },
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
    });

    expect(result.cached).toBe(false);
    expect(result.data.polylinePoints).toBe('fresh_traffic_overview');
    expect(result.data.duration_without_traffic).toBe(420);
    expect(result.data.duration_in_traffic).toBe(600);
    expect(result.cachePolicy).toEqual({
      forceFresh: false,
      ttlSeconds: 90,
      staleTrafficCacheBypassed: true,
    });
    expect(result.stats.redisReads).toBe(1);
    expect(result.stats.cacheBypasses).toBe(1);
    expect(result.stats.googleRequests).toBe(1);
    expect(mockRedisConnection.setex).toHaveBeenCalledWith(
      expect.stringContaining('traffic:1'),
      90,
      expect.stringContaining('fresh_traffic_overview'),
    );
  });

  it('uses Routes API traffic-aware polyline segments when enabled', async () => {
    process.env.ENABLE_ROUTES_API_TRAFFIC_POLYLINE = 'true';
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        routes: [
          {
            distanceMeters: 2500,
            duration: '600s',
            staticDuration: '420s',
            polyline: {
              encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
            },
            travelAdvisory: {
              speedReadingIntervals: [
                {
                  endPolylinePointIndex: 1,
                  speed: 'NORMAL',
                },
                {
                  startPolylinePointIndex: 1,
                  endPolylinePointIndex: 2,
                  speed: 'SLOW',
                },
              ],
            },
            legs: [
              {
                distanceMeters: 2500,
                duration: '600s',
                staticDuration: '420s',
                polyline: {
                  encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
                },
                travelAdvisory: {
                  speedReadingIntervals: [
                    {
                      endPolylinePointIndex: 1,
                      speed: 'NORMAL',
                    },
                    {
                      startPolylinePointIndex: 1,
                      endPolylinePointIndex: 2,
                      speed: 'TRAFFIC_JAM',
                    },
                  ],
                },
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

    expect(global.fetch).toHaveBeenCalledWith(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Goog-Api-Key': 'test-google-key',
          'X-Goog-FieldMask': expect.stringContaining('routes.travelAdvisory.speedReadingIntervals'),
        }),
      }),
    );
    expect(result.provider).toBe('routes_api');
    expect(result.data).toMatchObject({
      distance_in_km: 2.5,
      time_in_secs: 600,
      duration_without_traffic: 420,
      duration_in_traffic: 600,
      polylinePoints: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      routeProvider: 'routes_api',
    });
    expect(result.data.trafficSegments).toEqual([
      expect.objectContaining({
        level: 'normal',
        color: '#198754',
        coordinates: expect.arrayContaining([
          expect.objectContaining({ latitude: 38.5, longitude: -120.2 }),
        ]),
      }),
      expect.objectContaining({
        level: 'moderate',
        color: '#F59E0B',
      }),
    ]);
    expect(result.data.legs[0].trafficSegments[1]).toEqual(
      expect.objectContaining({
        level: 'heavy',
        color: '#DC2626',
      }),
    );
    expect(result.stats.googleRequests).toBe(1);
    expect(mockRedisConnection.setex).toHaveBeenCalledWith(
      expect.stringContaining('provider:routes_api'),
      90,
      expect.stringContaining('trafficSegments'),
    );
  });

  it('calcula pedágio da Linha Amarela pela polyline retornada pelo Routes API', async () => {
    process.env.ENABLE_ROUTES_API_TRAFFIC_POLYLINE = 'true';
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        routes: [
          {
            distanceMeters: 9000,
            duration: '1200s',
            staticDuration: '900s',
            polyline: {
              encodedPolyline: 'nuujC~|kgG_|B_|B_|B_|B',
            },
            travelAdvisory: {
              speedReadingIntervals: [
                {
                  endPolylinePointIndex: 2,
                  speed: 'NORMAL',
                },
              ],
            },
            legs: [],
          },
        ],
      }),
    });

    const result = await placesCacheService.fetchDirectionsRoute({
      startLoc: '-22.890000,-43.320000',
      destLoc: '-22.850000,-43.280000',
      trafficEnabled: true,
    });

    expect(result.provider).toBe('routes_api');
    expect(result.data.tollFee).toBe(4);
    expect(result.data.tolls).toEqual([
      expect.objectContaining({
        id: 'p09_linha_amarela',
        amount: 4,
      }),
    ]);
    expect(result.data.tollDetection).toEqual(expect.objectContaining({
      source: 'leaf_toll_catalog',
      tollCount: 1,
    }));
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

  it('returns cached reverse geocode without calling Google', async () => {
    const cachedAddress = {
      address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
      formatted_address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
      name: 'Av. Vicente de Carvalho',
      lat: -22.84997,
      lng: -43.31102,
    };
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(JSON.stringify(cachedAddress));
    global.fetch = jest.fn();

    const result = await placesCacheService.reverseGeocode(-22.8499687, -43.3110186);

    expect(result).toEqual(expect.objectContaining({
      address: cachedAddress.address,
      cached: true,
      source: 'reverse_geocode_cache',
    }));
    expect(mockRedisConnection.get).toHaveBeenCalledWith('place:reverse:-22.84997:-43.31102');
    expect(result.stats.googleRequests).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('caches Google reverse geocode after lookup', async () => {
    const placesCacheService = loadService();
    placesCacheService.googleApiKey = 'test-google-key';
    placesCacheService.isInitialized = true;
    mockRedisConnection.get.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        results: [
          {
            place_id: 'reverse_google_1',
            formatted_address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
            address_components: [
              {
                long_name: 'Av. Vicente de Carvalho',
              },
            ],
          },
        ],
      }),
    });

    const result = await placesCacheService.reverseGeocode(-22.8499687, -43.3110186);

    expect(result).toEqual(expect.objectContaining({
      address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
      cached: false,
      place_id: 'reverse_google_1',
      source: 'google_reverse_geocode',
    }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/geocode/json?latlng=-22.8499687%2C-43.3110186'));
    expect(mockRedisConnection.setex).toHaveBeenCalledWith(
      'place:reverse:-22.84997:-43.31102',
      2592000,
      expect.stringContaining('Av. Vicente de Carvalho'),
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
