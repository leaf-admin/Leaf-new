jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockSearchPlace = jest.fn();
const mockFetchAutocompletePredictions = jest.fn();
const mockGetPlaceDetails = jest.fn();
const mockFetchDirectionsRoute = jest.fn();
const mockSavePlace = jest.fn();
const mockReverseGeocode = jest.fn();
const mockIngestGoogleSkuUsage = jest.fn();
const mockIngestOperationalUsage = jest.fn();
const mockGetReport = jest.fn();

jest.mock('../../../services/places-cache-service', () => ({
  searchPlace: (...args) => mockSearchPlace(...args),
  fetchAutocompletePredictions: (...args) => mockFetchAutocompletePredictions(...args),
  getPlaceDetails: (...args) => mockGetPlaceDetails(...args),
  fetchDirectionsRoute: (...args) => mockFetchDirectionsRoute(...args),
  savePlace: (...args) => mockSavePlace(...args),
  reverseGeocode: (...args) => mockReverseGeocode(...args),
}));

jest.mock('../../../services/ride-cost-telemetry-service', () => ({
  ingestGoogleSkuUsage: (...args) => mockIngestGoogleSkuUsage(...args),
  ingestOperationalUsage: (...args) => mockIngestOperationalUsage(...args),
  getReport: (...args) => mockGetReport(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const placesRoutes = require('../../../routes/places-routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', placesRoutes);
  return app;
}

describe('places routes', () => {
  beforeEach(() => {
    process.env.ENABLE_TRAFFIC_AWARE_ROUTES = 'true';
    jest.clearAllMocks();
    mockSearchPlace.mockResolvedValue(null);
    mockFetchAutocompletePredictions.mockResolvedValue([]);
    mockGetPlaceDetails.mockResolvedValue(null);
    mockFetchDirectionsRoute.mockResolvedValue(null);
    mockSavePlace.mockResolvedValue(true);
    mockReverseGeocode.mockResolvedValue(null);
    mockIngestGoogleSkuUsage.mockResolvedValue({});
    mockIngestOperationalUsage.mockResolvedValue({});
    mockGetReport.mockResolvedValue(null);
  });

  it('uses backend autocomplete and records booking telemetry when bookingId is provided', async () => {
    const app = createApp();
    mockFetchAutocompletePredictions.mockResolvedValue([
      {
        place_id: 'place_1',
        description: 'Copacabana Palace',
        structured_formatting: {
          main_text: 'Copacabana Palace',
          secondary_text: 'Rio de Janeiro',
        },
      },
    ]);

    const response = await request(app)
      .post('/api/places/autocomplete')
      .send({
        query: 'copacabana palace',
        sessionToken: 'token_123',
        telemetry: {
          bookingId: 'booking_abc',
          sourceKey: 'customer:abc',
          sourceMeta: {
            userId: 'abc',
            userType: 'customer',
            surface: 'destination_search',
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.source).toBe('google');
    expect(response.body.telemetryCaptured).toBe(true);
    expect(mockIngestGoogleSkuUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_abc',
        skuKey: 'autocompleteLegacyPerRequest',
      }),
    );
  });

  it('returns cached autocomplete result without billing telemetry', async () => {
    const app = createApp();
    mockSearchPlace.mockResolvedValue({
      place_id: 'cache_1',
      name: 'Praia de Botafogo',
      address: 'Botafogo, Rio de Janeiro',
      lat: -22.95,
      lng: -43.18,
    });

    const response = await request(app)
      .post('/api/places/autocomplete')
      .send({ query: 'praia de botafogo' });

    expect(response.status).toBe(200);
    expect(response.body.cached).toBe(true);
    expect(response.body.telemetryCaptured).toBe(false);
    expect(mockIngestGoogleSkuUsage).not.toHaveBeenCalled();
  });

  it('returns cached reverse geocode without billing telemetry', async () => {
    const app = createApp();
    mockReverseGeocode.mockResolvedValue({
      address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
      formatted_address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
      name: 'Av. Vicente de Carvalho',
      lat: -22.849969,
      lng: -43.311019,
      cached: true,
      source: 'reverse_geocode_cache',
      stats: {
        googleRequests: 0,
      },
    });

    const response = await request(app)
      .post('/api/places/reverse-geocode')
      .send({
        location: {
          lat: -22.8499687,
          lng: -43.3110186,
        },
        telemetry: {
          bookingId: 'booking_reverse_cached',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.cached).toBe(true);
    expect(response.body.telemetryCaptured).toBe(false);
    expect(response.body.data.address).toContain('Av. Vicente de Carvalho');
    expect(mockReverseGeocode).toHaveBeenCalledWith(-22.8499687, -43.3110186, {
      forceFresh: false,
    });
    expect(mockIngestGoogleSkuUsage).not.toHaveBeenCalled();
  });

  it('records geocoding telemetry for non-cached reverse geocode when bookingId is provided', async () => {
    const app = createApp();
    mockReverseGeocode.mockResolvedValue({
      address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
      formatted_address: 'Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro - RJ',
      name: 'Av. Vicente de Carvalho',
      lat: -22.849969,
      lng: -43.311019,
      cached: false,
      source: 'google_reverse_geocode',
      stats: {
        googleRequests: 1,
      },
    });

    const response = await request(app)
      .post('/api/places/reverse-geocode')
      .send({
        lat: -22.8499687,
        lng: -43.3110186,
        telemetry: {
          bookingId: 'booking_reverse_google',
          sourceMeta: {
            userId: 'customer_1',
            userType: 'customer',
            surface: 'pickup_pin_reverse_geocode',
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.cached).toBe(false);
    expect(response.body.telemetryCaptured).toBe(true);
    expect(mockIngestGoogleSkuUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_reverse_google',
        skuKey: 'geocoding',
        sourceMeta: expect.objectContaining({
          surface: 'pickup_pin_reverse_geocode',
        }),
        metadata: expect.objectContaining({
          routeScope: 'pickup_resolution',
        }),
      }),
    );
  });

  it('returns place details and records booking telemetry', async () => {
    const app = createApp();
    mockGetPlaceDetails.mockResolvedValue({
      place_id: 'place_2',
      name: 'Copacabana Palace',
      address: 'Av. Atlântica, 1702',
      formatted_address: 'Av. Atlântica, 1702 - Copacabana',
      lat: -22.967,
      lng: -43.179,
    });

    const response = await request(app)
      .post('/api/places/details')
      .send({
        placeId: 'place_2',
        query: 'copacabana palace',
        location: {
          lat: -22.971,
          lng: -43.182,
        },
        telemetry: {
          bookingId: 'booking_xyz',
          sourceMeta: {
            userId: 'cust_1',
            userType: 'customer',
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.telemetryCaptured).toBe(true);
    expect(mockIngestGoogleSkuUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_xyz',
        skuKey: 'placeDetailsLegacy',
      }),
    );
    expect(mockSavePlace).toHaveBeenCalledWith(
      'copacabana palace',
      expect.objectContaining({
        place_id: 'place_2',
      }),
      expect.objectContaining({
        location: {
          lat: -22.971,
          lng: -43.182,
        },
      }),
    );
  });

  it('returns cached place details without Google billing telemetry', async () => {
    const app = createApp();
    mockGetPlaceDetails.mockResolvedValue({
      place_id: 'place_cached',
      name: 'Shopping Leblon',
      address: 'Av. Afrânio de Melo Franco',
      lat: -22.9837,
      lng: -43.2179,
      cached: true,
      source: 'place_id_cache',
    });

    const response = await request(app)
      .post('/api/places/details')
      .send({
        placeId: 'place_cached',
        query: 'shopping leblon',
        telemetry: {
          bookingId: 'booking_cached',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.telemetryCaptured).toBe(false);
    expect(mockIngestGoogleSkuUsage).not.toHaveBeenCalled();
    expect(mockSavePlace).toHaveBeenCalledWith(
      'shopping leblon',
      expect.objectContaining({
        place_id: 'place_cached',
      }),
      expect.objectContaining({
        location: null,
      }),
    );
  });

  it('returns directions from backend and records booking telemetry when not cached', async () => {
    const app = createApp();
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: false,
      routeCount: 1,
      waypointsCount: 0,
      stats: {
        redisReads: 1,
        redisWrites: 1,
        googleRequests: 1,
      },
      data: {
        distance_in_km: 9.2,
        time_in_secs: 920,
        polylinePoints: 'abc123',
        duration_in_traffic: 980,
        legs: [
          {
            steps: [
              {
                instruction: 'Vire à direita na Av. Atlântica',
                startLocation: { lat: -22.9712, lng: -43.1822 },
                endLocation: { lat: -22.9701, lng: -43.1811 },
                distanceMeters: 180,
                durationSeconds: 50,
                polylinePoints: 'step123',
              },
            ],
          },
        ],
        steps: [
          {
            instruction: 'Vire à direita na Av. Atlântica',
            startLocation: { lat: -22.9712, lng: -43.1822 },
            endLocation: { lat: -22.9701, lng: -43.1811 },
            distanceMeters: 180,
            durationSeconds: 50,
            polylinePoints: 'step123',
          },
        ],
      },
    });

    const response = await request(app)
      .post('/api/places/directions')
      .send({
        startLoc: '-22.9712,-43.1822',
        destLoc: '-22.9673,-43.1790',
        telemetry: {
          bookingId: 'booking_dir_1',
          sourceMeta: {
            userId: 'customer_1',
            userType: 'customer',
            surface: 'passenger_enroute_pickup',
          },
        },
        routeScope: 'driver_to_pickup',
        forceFresh: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.cached).toBe(false);
    expect(response.body.cachePolicy).toEqual({
      forceFresh: true,
      ttlSeconds: null,
    });
    expect(response.body.telemetryCaptured).toBe(true);
    expect(response.body.data.steps).toEqual([
      expect.objectContaining({
        instruction: 'Vire à direita na Av. Atlântica',
        distanceMeters: 180,
        durationSeconds: 50,
      }),
    ]);
    expect(response.body.data.legs[0].steps[0]).toEqual(
      expect.objectContaining({
        instruction: 'Vire à direita na Av. Atlântica',
        polylinePoints: 'step123',
      }),
    );
    expect(mockIngestGoogleSkuUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_dir_1',
        skuKey: 'directionsAdvancedLegacy',
        metadata: expect.objectContaining({
          forceFresh: true,
          trafficEnabled: true,
        }),
      }),
    );
    expect(mockFetchDirectionsRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        forceFresh: true,
        trafficEnabled: true,
      }),
    );
    expect(mockIngestOperationalUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_dir_1',
        backendCommand: 'places_directions_route',
      }),
    );
  });

  it('returns cached directions without billing telemetry', async () => {
    const app = createApp();
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: true,
      routeCount: 1,
      waypointsCount: 0,
      data: {
        distance_in_km: 4.1,
        time_in_secs: 430,
        polylinePoints: 'cached_polyline',
        duration_in_traffic: 460,
        legs: [],
      },
    });

    const response = await request(app)
      .post('/api/places/directions')
      .send({
        startLoc: '-22.9000,-43.2000',
        destLoc: '-22.9100,-43.2100',
      });

    expect(response.status).toBe(200);
    expect(response.body.cached).toBe(true);
    expect(response.body.telemetryCaptured).toBe(false);
    expect(mockIngestGoogleSkuUsage).not.toHaveBeenCalled();
  });

  it('returns estimated route when budget guard blocks new Google directions call', async () => {
    const app = createApp();
    mockGetReport.mockResolvedValue({
      totals: {
        google: {
          directions: {
            requestCount: 6,
            estimatedCostUsd: 0.031,
          },
        },
      },
    });
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: false,
      cacheOnly: true,
      routeCount: 0,
      waypointsCount: 0,
      data: null,
      status: 'cache_miss',
      stats: {
        redisReads: 1,
        redisWrites: 0,
        googleRequests: 0,
      },
    });

    const response = await request(app)
      .post('/api/places/directions')
      .send({
        startLoc: '-22.9712,-43.1822',
        destLoc: '-22.9673,-43.1790',
        telemetry: {
          bookingId: 'booking_budget_1',
          sourceMeta: {
            userId: 'customer_1',
            userType: 'customer',
            surface: 'passenger_enroute_pickup',
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.source).toBe('budget_guard_estimated');
    expect(response.body.telemetryCaptured).toBe(false);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        distance_in_km: expect.any(Number),
        time_in_secs: expect.any(Number),
        steps: [
          expect.objectContaining({
            instruction: 'Siga até o destino',
            startLocation: expect.objectContaining({
              lat: -22.9712,
              lng: -43.1822,
            }),
            endLocation: expect.objectContaining({
              lat: -22.9673,
              lng: -43.179,
            }),
            distanceMeters: expect.any(Number),
            durationSeconds: expect.any(Number),
          }),
        ],
      }),
    );
    expect(response.body.data.legs[0].steps[0]).toEqual(
      expect.objectContaining({
        instruction: 'Siga até o destino',
      }),
    );
    expect(mockFetchDirectionsRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheOnly: true,
      }),
    );
    expect(mockIngestGoogleSkuUsage).not.toHaveBeenCalled();
    expect(mockIngestOperationalUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_budget_1',
        backendCommand: 'places_directions_route',
      }),
    );
  });
});
