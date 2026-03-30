jest.mock('../../../services/h3-map-service', () => ({
  collectSnapshot: jest.fn(),
  aggregateCells: jest.fn()
}));

const h3 = require('h3-js');
const h3MapService = require('../../../services/h3-map-service');
const pricingContextProvider = require('../../../services/pricing-context-provider');

describe('pricing-context-provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retorna contexto explícito com fallback neutro quando redis não existe', async () => {
    const result = await pricingContextProvider.buildDerivedPricingContext({
      redis: null,
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      routeDistanceKm: 4,
      routeDurationSecs: 600,
      explicitPricingContext: {
        trip: { eta_pickup_min: 7 },
        operational: {
          current: { active_requests_5m: 9 }
        }
      }
    });

    expect(result.metadata).toBeNull();
    expect(result.pricingContext.trip.eta_pickup_min).toBe(7);
    expect(result.pricingContext.operational.current.active_requests_5m).toBe(9);
    expect(result.pricingContext.operational.state_context.now).toEqual(expect.any(String));
  });

  test('deriva contexto operacional a partir da microrregião H3 e zona especial', async () => {
    const pickupLocation = {
      lat: -22.9075,
      lng: -43.1736,
      address: 'Aeroporto Santos Dumont - Rio de Janeiro'
    };
    const destinationLocation = {
      lat: -22.9121,
      lng: -43.1825,
      address: 'Centro - Rio de Janeiro'
    };

    const originCell = h3.latLngToCell(pickupLocation.lat, pickupLocation.lng, 9);
    const ring = h3.gridDisk(originCell, 1);
    const ring2 = h3.gridDisk(originCell, 2);
    const outerRing = ring2.filter((cell) => !ring.includes(cell));

    h3MapService.collectSnapshot.mockResolvedValue({
      drivers: [
        {
          driverId: 'd1',
          available: true,
          location: { lat: pickupLocation.lat + 0.002, lng: pickupLocation.lng + 0.001 }
        },
        {
          driverId: 'd2',
          available: true,
          location: { lat: pickupLocation.lat + 0.003, lng: pickupLocation.lng + 0.002 }
        }
      ],
      openRequests: [],
      activeTrips: []
    });
    h3MapService.aggregateCells.mockReturnValue({
      cells: [
        {
          h3Index: originCell,
          metrics: {
            openRequests: 4,
            availableDrivers: 1,
            busyDrivers: 1,
            imbalance: 4,
            demandLevel: 'critical'
          }
        },
        ...ring
          .filter((cell) => cell !== originCell)
          .map((cell, index) => ({
            h3Index: cell,
            metrics: {
              openRequests: index < 3 ? 2 : 0,
              availableDrivers: index < 3 ? 1 : 2,
              busyDrivers: 0,
              imbalance: index < 3 ? 2 : 0,
              demandLevel: index < 3 ? 'high' : 'low'
            }
          })),
        ...outerRing.map((cell) => ({
          h3Index: cell,
          metrics: {
            openRequests: 1,
            availableDrivers: 2,
            busyDrivers: 0,
            imbalance: 0.5,
            demandLevel: 'low'
          }
        }))
      ]
    });

    const result = await pricingContextProvider.buildDerivedPricingContext({
      redis: { mocked: true },
      pickupLocation,
      destinationLocation,
      routeDistanceKm: 6,
      routeDurationSecs: 1200
    });

    expect(result.metadata.originCell).toBe(originCell);
    expect(result.pricingContext.operational.current.active_requests_5m).toBeGreaterThan(0);
    expect(result.pricingContext.operational.current.idle_drivers).toBeGreaterThan(0);
    expect(result.pricingContext.operational.current.avg_pickup_eta_min).toBeGreaterThan(0);
    expect(result.pricingContext.operational.baseline.expected_requests_5m).toBeGreaterThan(0);
    expect(result.pricingContext.operational.state_context.degraded_neighbor_count).toBeGreaterThanOrEqual(3);
    expect(result.pricingContext.operational.state_context.is_special_zone).toBe(true);
    expect(result.pricingContext.operational.state_context.zone_type).toBe('airport');
  });
});
