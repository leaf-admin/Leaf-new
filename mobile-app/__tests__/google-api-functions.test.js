import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchGeocodeAddress,
  fetchCoordsfromPlace,
  fetchPlacesAutocomplete,
  getDirectionsApi,
} from '../src/common-local/GoogleAPIFunctions';
import rideCostTelemetryService from '../src/services/RideCostTelemetryService';
import { allowClientDirectGoogleFallback } from '../src/config/runtimeAccessPolicy';

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
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
    allowClientDirectGoogleFallback.mockReturnValue(true);
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

  it('does not store search bias as a cached place coordinate', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        cached: false,
        predictions: [
          {
            place_id: 'ferry-building',
            description: 'Ferry Building, São Francisco, CA, EUA',
            structured_formatting: {
              main_text: 'Ferry Building',
              secondary_text: 'São Francisco, CA, EUA',
            },
          },
        ],
      }),
    });

    await fetchPlacesAutocomplete('Ferry Building', 'token-1', {
      lat: 37.7955,
      lng: -122.3937,
    });

    const savedPayload = JSON.parse(AsyncStorage.setItem.mock.calls[0][1]);
    expect(savedPayload.place_id).toBe('ferry-building');
    expect(savedPayload.location).toBeUndefined();
    expect(savedPayload.locationSource).toBeUndefined();
  });

  it('ignores legacy local cache coordinates that were not marked as resolved place coordinates', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({
      place_id: 'legacy-cache',
      description: 'Legacy cached place',
      location: {
        lat: 37.7955,
        lng: -122.3937,
      },
    }));

    const result = await fetchPlacesAutocomplete('Legacy cached place', 'token-legacy', {
      lat: 37.7955,
      lng: -122.3937,
    });

    expect(result[0].place_id).toBe('legacy-cache');
    expect(result[0].location).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes a repeated query when the singleton local cache only describes a broad area', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({
      place_id: 'copacabana-region',
      description: 'Copacabana, Rio de Janeiro - RJ, Brasil',
      structured_formatting: {
        main_text: 'Copacabana',
        secondary_text: 'Rio de Janeiro - RJ, Brasil',
      },
      types: ['sublocality_level_1', 'sublocality', 'political'],
    }));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        cached: true,
        predictions: [
          {
            place_id: 'copacabana-palace',
            description: 'Copacabana Palace, Av. Atlântica, Rio de Janeiro',
            structured_formatting: {
              main_text: 'Copacabana Palace',
              secondary_text: 'Av. Atlântica, Rio de Janeiro',
            },
            types: ['lodging', 'establishment'],
          },
        ],
      }),
    });

    const result = await fetchPlacesAutocomplete('Copacabana', 'token-repeat', {
      lat: -22.9848,
      lng: -43.2221,
    });

    expect(result).toEqual([
      expect.objectContaining({ place_id: 'copacabana-palace' }),
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain(
      'backend.leaf.test/api/places/autocomplete',
    );
  });

  it('passes query and location context to backend Place Details', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: {
          place_id: 'shopping-leblon',
          name: 'Shopping Leblon',
          address: 'Av. Afrânio de Melo Franco',
          lat: -22.9837,
          lng: -43.2179,
        },
      }),
    });

    const result = await fetchCoordsfromPlace(
      'shopping-leblon',
      null,
      'session-token',
      {
        query: 'Shopping Leblon',
        location: {
          lat: -22.984,
          lng: -43.218,
        },
      },
    );

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(result.lat).toBe(-22.9837);
    expect(requestBody).toEqual(expect.objectContaining({
      placeId: 'shopping-leblon',
      sessionToken: 'session-token',
      query: 'Shopping Leblon',
      location: {
        lat: -22.984,
        lng: -43.218,
      },
    }));
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

  it('does not call Google directly when backend autocomplete fails and fallback is disabled', async () => {
    allowClientDirectGoogleFallback.mockReturnValue(false);
    AsyncStorage.getItem.mockResolvedValue(null);
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ status: 'unavailable' }),
    });

    const result = await fetchPlacesAutocomplete('Shopping Leblon', 'token-no-direct', {
      lat: -22.984,
      lng: -43.218,
    });

    expect(result).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('backend.leaf.test/api/places/autocomplete');
  });

  it('does not call Google geocoding directly when fallback is disabled', async () => {
    allowClientDirectGoogleFallback.mockReturnValue(false);

    const result = await fetchGeocodeAddress('Avenida Paulista', {
      lat: -23.5614,
      lng: -46.6559,
    });

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not call Google directions directly when backend route fails and fallback is disabled', async () => {
    allowClientDirectGoogleFallback.mockReturnValue(false);
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ status: 'unavailable' }),
    });

    await expect(
      getDirectionsApi('-22.9100,-43.4100', '-22.9200,-43.4200', null, {
        sourceMeta: {
          surface: 'unit_no_direct_google',
        },
      }),
    ).rejects.toContain('Directions backend indisponível');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('backend.leaf.test/api/places/directions');
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

  it('bypasses local directions cache when forceFresh is requested', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          cached: false,
          data: {
            distance_in_km: 1.2,
            time_in_secs: 240,
            polylinePoints: 'fresh_1',
            legs: [],
            steps: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          cached: false,
          data: {
            distance_in_km: 1.3,
            time_in_secs: 260,
            polylinePoints: 'fresh_2',
            legs: [],
            steps: [],
          },
        }),
      });

    const telemetryContext = {
      bookingId: 'booking-force-fresh-1',
      sourceKey: 'customer:test-user:quote',
      sourceMeta: {
        userId: 'test-user',
        userType: 'customer',
        platform: 'ios',
        flow: 'prototype',
        scenario: 'robotaxi_prototype',
        surface: 'destination_preview',
      },
      cacheMode: 'sticky_destination',
      routeScope: 'prebooking_quote:-22.910:-43.410',
      forceFresh: true,
    };

    const first = await getDirectionsApi(
      '-22.9100,-43.4100',
      '-22.9200,-43.4200',
      null,
      telemetryContext,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await getDirectionsApi(
      '-22.9150,-43.4150',
      '-22.9200,-43.4200',
      null,
      telemetryContext,
    );

    expect(first.polylinePoints).toBe('fresh_1');
    expect(second.polylinePoints).toBe('fresh_2');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({
        forceFresh: true,
      }),
    );
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual(
      expect.objectContaining({
        forceFresh: true,
      }),
    );
    expect(rideCostTelemetryService.recordGoogleCache).not.toHaveBeenCalledWith(
      'directionsMemoryHit',
      expect.anything(),
      telemetryContext,
    );
  });

  it('bypasses stale passenger preview cache when cached route has no traffic timings', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          cached: false,
          data: {
            distance_in_km: 6.287,
            time_in_secs: 887,
            polylinePoints: 'route_without_traffic',
            legs: [],
            steps: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          cached: false,
          data: {
            distance_in_km: 6.287,
            time_in_secs: 1354,
            duration_without_traffic: 887,
            duration_in_traffic: 1354,
            polylinePoints: 'route_with_traffic',
            legs: [],
            steps: [],
          },
        }),
      });

    const telemetryContext = {
      sourceKey: 'customer:test-user:passenger-home-preview',
      sourceMeta: {
        userId: 'test-user',
        userType: 'customer',
        platform: 'android',
        flow: 'passenger_home',
        surface: 'passenger_home_category_preview',
      },
      cacheMode: 'exact',
      routeScope: 'passenger_home_preview',
      routeFamily: 'passenger_home_preview',
    };

    const first = await getDirectionsApi(
      '-22.84997,-43.31102',
      '-22.87107,-43.33609',
      null,
      telemetryContext,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await getDirectionsApi(
      '-22.84997,-43.31102',
      '-22.87107,-43.33609',
      null,
      telemetryContext,
    );

    expect(first.polylinePoints).toBe('route_without_traffic');
    expect(second.polylinePoints).toBe('route_with_traffic');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(rideCostTelemetryService.recordGoogleCache).toHaveBeenCalledWith(
      'directionsMemoryStaleTrafficBypass',
      expect.objectContaining({
        metadata: expect.objectContaining({
          routeScope: 'passenger_home_preview',
        }),
      }),
      telemetryContext,
    );
  });
});
