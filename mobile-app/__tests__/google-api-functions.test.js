import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchGeocodeAddress,
  fetchPlacesAutocomplete,
  getDirectionsApi,
} from '../src/common-local/GoogleAPIFunctions';
import rideCostTelemetryService from '../src/services/RideCostTelemetryService';

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/common-local/config/configureFirebase', () => ({
  firebase: {
    config: {
      projectId: 'leaf-reactnative',
    },
  },
}));

jest.mock('../src/common-local/AccessKey', () => 'test-access-key');

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: jest.fn((path) => `https://backend.leaf.test${path}`),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowClientDirectGoogleFallback: jest.fn(() => true),
}));

jest.mock('../src/services/RideCostTelemetryService', () => ({
  __esModule: true,
  RIDE_TELEMETRY_GOOGLE_SKUS: {
    AUTOCOMPLETE_LEGACY_PER_REQUEST: 'autocompleteLegacyPerRequest',
    PLACE_DETAILS_LEGACY: 'placeDetailsLegacy',
    GEOCODING: 'geocoding',
    DIRECTIONS_LEGACY: 'directionsLegacy',
    DISTANCE_MATRIX_LEGACY_ELEMENT: 'distanceMatrixLegacyElement',
  },
  default: {
    recordGoogleUsage: jest.fn(),
    recordGoogleCache: jest.fn(),
  },
}));

jest.mock('react-native-base64', () => ({
  encode: jest.fn(() => 'encoded'),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('GoogleAPIFunctions address search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-google-key';
  });

  it('does not apply Brazil country filters for non-Brazil autocomplete searches', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: 'miss' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          status: 'OK',
          predictions: [
            {
              place_id: 'ferry-building',
              description: 'Ferry Building, São Francisco, CA, EUA',
              structured_formatting: {
                main_text: 'Ferry Building',
                secondary_text: 'São Francisco, CA, EUA',
              },
              types: ['establishment'],
              reference: 'ferry-building',
            },
          ],
        }),
      });

    await fetchPlacesAutocomplete('Ferry Building', 'token-1', {
      lat: 37.7955,
      lng: -122.3937,
    });

    const googleUrl = global.fetch.mock.calls[1][0];
    expect(googleUrl).toContain('maps.googleapis.com/maps/api/place/autocomplete/json');
    expect(googleUrl).toContain('location=37.7955,-122.3937');
    expect(googleUrl).not.toContain('components=country:br');
  });

  it('skips local and backend autocomplete cache for short partial queries', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: 'miss' }),
      })
      .mockResolvedValueOnce({
      json: async () => ({
        status: 'OK',
        predictions: [
          {
            place_id: 'ferry-building',
            description: 'Ferry Building, São Francisco, CA, EUA',
            structured_formatting: {
              main_text: 'Ferry Building',
              secondary_text: 'São Francisco, CA, EUA',
            },
            types: ['establishment'],
            reference: 'ferry-building',
          },
        ],
      }),
    });

    await fetchPlacesAutocomplete('fer', 'token-2', {
      lat: 37.7955,
      lng: -122.3937,
    });

    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('backend.leaf.test/api/places/autocomplete');
    expect(global.fetch.mock.calls[1][0]).toContain('maps.googleapis.com/maps/api/place/autocomplete/json');
  });

  it('does not apply Brazil geocode bias outside Brazil', async () => {
    global.fetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'OK',
        results: [
          {
            place_id: 'ferry-building',
            formatted_address: 'Ferry Building, São Francisco, CA, EUA',
            address_components: [{ long_name: 'Ferry Building' }],
            geometry: {
              location: {
                lat: 37.7955,
                lng: -122.3937,
              },
            },
            types: ['establishment'],
          },
        ],
      }),
    });

    await fetchGeocodeAddress('Ferry Building', {
      lat: 37.7955,
      lng: -122.3937,
    });

    const geocodeUrl = global.fetch.mock.calls[0][0];
    expect(geocodeUrl).toContain('maps.googleapis.com/maps/api/geocode/json');
    expect(geocodeUrl).not.toContain('components=country:br');
    expect(geocodeUrl).not.toContain('region=br');
  });

  it('keeps Brazil geocode bias for Brazil coordinates', async () => {
    global.fetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'OK',
        results: [
          {
            place_id: 'av-paulista',
            formatted_address: 'Av. Paulista, São Paulo - SP, Brasil',
            address_components: [{ long_name: 'Avenida Paulista' }],
            geometry: {
              location: {
                lat: -23.5614,
                lng: -46.6559,
              },
            },
            types: ['route'],
          },
        ],
      }),
    });

    await fetchGeocodeAddress('Avenida Paulista', {
      lat: -23.5614,
      lng: -46.6559,
    });

    const geocodeUrl = global.fetch.mock.calls[0][0];
    expect(geocodeUrl).toContain('components=country:br');
    expect(geocodeUrl).toContain('region=br');
  });

  it('reuses sticky destination cache for active trip route calls', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: 'miss' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'OK',
          routes: [
            {
              overview_polyline: { points: 'abc123' },
              legs: [
                {
                  distance: { value: 1200, text: '1.2 km' },
                  duration: { value: 240, text: '4 min' },
                  end_address: 'Destino',
                  start_address: 'Origem',
                  end_location: { lat: -22.9, lng: -43.2 },
                  start_location: { lat: -22.8, lng: -43.3 },
                  steps: [],
                },
              ],
            },
          ],
        }),
      });

    const telemetryContext = {
      bookingId: 'booking-sticky-1',
      sourceKey: 'driver:test-user:pickup',
      sourceMeta: {
        userId: 'test-user',
        userType: 'driver',
        platform: 'ios',
        flow: 'legacy_mobile',
        scenario: 'active_trip_fixed_route',
        surface: 'passenger_live_route_pickup',
      },
      cacheMode: 'sticky_destination',
      routeScope: 'pickup',
    };

    await getDirectionsApi('-22.9100,-43.4100', '-22.9200,-43.4200', null, telemetryContext);
    await getDirectionsApi('-22.9150,-43.4150', '-22.9200,-43.4200', null, telemetryContext);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(rideCostTelemetryService.recordGoogleUsage).toHaveBeenCalledTimes(1);
    expect(rideCostTelemetryService.recordGoogleCache).toHaveBeenCalledWith(
      'directionsMemoryHit',
      expect.objectContaining({
        metadata: expect.objectContaining({
          cacheMode: 'sticky_destination',
        }),
      }),
      telemetryContext,
    );
  });
});
