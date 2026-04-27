jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockSearchPlace = jest.fn();
const mockFetchAutocompletePredictions = jest.fn();
const mockGetPlaceDetails = jest.fn();
const mockFetchDirectionsRoute = jest.fn();
const mockSavePlace = jest.fn();
const mockIngestGoogleSkuUsage = jest.fn();

jest.mock('../../../services/places-cache-service', () => ({
  searchPlace: (...args) => mockSearchPlace(...args),
  fetchAutocompletePredictions: (...args) => mockFetchAutocompletePredictions(...args),
  getPlaceDetails: (...args) => mockGetPlaceDetails(...args),
  fetchDirectionsRoute: (...args) => mockFetchDirectionsRoute(...args),
  savePlace: (...args) => mockSavePlace(...args),
}));

jest.mock('../../../services/ride-cost-telemetry-service', () => ({
  ingestGoogleSkuUsage: (...args) => mockIngestGoogleSkuUsage(...args),
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
    jest.clearAllMocks();
    mockSearchPlace.mockResolvedValue(null);
    mockFetchAutocompletePredictions.mockResolvedValue([]);
    mockGetPlaceDetails.mockResolvedValue(null);
    mockFetchDirectionsRoute.mockResolvedValue(null);
    mockSavePlace.mockResolvedValue(true);
    mockIngestGoogleSkuUsage.mockResolvedValue({});
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
    );
  });

  it('returns directions from backend and records booking telemetry when not cached', async () => {
    const app = createApp();
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: false,
      routeCount: 1,
      waypointsCount: 0,
      data: {
        distance_in_km: 9.2,
        time_in_secs: 920,
        polylinePoints: 'abc123',
        duration_in_traffic: 980,
        legs: [],
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
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.cached).toBe(false);
    expect(response.body.telemetryCaptured).toBe(true);
    expect(mockIngestGoogleSkuUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_dir_1',
        skuKey: 'directionsLegacy',
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
});
