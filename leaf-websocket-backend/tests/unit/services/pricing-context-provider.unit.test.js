jest.mock('../../../services/h3-map-service', () => ({
  collectSnapshot: jest.fn(),
  aggregateCells: jest.fn()
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  getAggregatedCells: jest.fn().mockResolvedValue({
    usable: false,
    reason: 'empty',
    cells: [],
    touchedCells: 0,
    staleCells: 0,
    lastMutationAt: null
  })
}));

const h3 = require('h3-js');
const h3MapService = require('../../../services/h3-map-service');
const pricingH3ReadModelService = require('../../../services/pricing-h3-read-model-service');
const pricingContextProvider = require('../../../services/pricing-context-provider');

describe('pricing-context-provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pricingContextProvider.__resetCachesForTests();
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

    expect(result.metadata).toEqual(expect.objectContaining({
      originCell: null,
      perfBreakdownMs: expect.any(Object)
    }));
    expect(result.pricingContext.trip.eta_pickup_min).toBe(7);
    expect(result.pricingContext.trip.eta_pickup_source).toBe('unavailable');
    expect(result.pricingContext.trip.eta_pickup_authoritative).toBe(false);
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

  test('prefere snapshot H3 agregado quando o read-model já está pronto', async () => {
    const pickupLocation = {
      lat: -22.9075,
      lng: -43.1736
    };
    const destinationLocation = {
      lat: -22.9121,
      lng: -43.1825
    };
    const originCell = h3.latLngToCell(pickupLocation.lat, pickupLocation.lng, 9);
    const ring = h3.gridDisk(originCell, 1);
    const ring2 = h3.gridDisk(originCell, 2);

    pricingH3ReadModelService.getAggregatedCells.mockResolvedValueOnce({
      usable: true,
      reason: 'ok',
      touchedCells: 5,
      staleCells: 0,
      lastMutationAt: new Date().toISOString(),
      cells: ring2.map((cell, index) => ({
        h3Index: cell,
        resolution: 9,
        metrics: {
          openRequests: cell === originCell ? 3 : 0,
          availableDrivers: ring.includes(cell) ? 2 : 1,
          busyDrivers: index === 0 ? 1 : 0,
          activeTrips: 0,
          demand: cell === originCell ? 3 : 0,
          imbalance: cell === originCell ? 1.5 : 0.5,
          demandLevel: cell === originCell ? 'high' : 'low'
        }
      }))
    });

    const result = await pricingContextProvider.buildDerivedPricingContext({
      redis: { pipeline: jest.fn() },
      pickupLocation,
      destinationLocation,
      routeDistanceKm: 4.2,
      routeDurationSecs: 780
    });

    expect(result.metadata.snapshotSource).toBe('h3_read_model');
    expect(h3MapService.collectSnapshot).not.toHaveBeenCalled();
    expect(h3MapService.aggregateCells).not.toHaveBeenCalled();
    expect(result.pricingContext.operational.current.active_requests_5m).toBeGreaterThan(0);
  });

  test('não cai para full snapshot quando o anel local está vazio mas o read-model está vivo', async () => {
    const pickupLocation = {
      lat: -22.9075,
      lng: -43.1736
    };
    const destinationLocation = {
      lat: -22.9121,
      lng: -43.1825
    };
    const originCell = h3.latLngToCell(pickupLocation.lat, pickupLocation.lng, 9);
    const ring2 = h3.gridDisk(originCell, 2);

    pricingH3ReadModelService.getAggregatedCells.mockResolvedValueOnce({
      usable: true,
      reason: 'empty_fresh_model',
      touchedCells: 0,
      staleCells: 0,
      freshTouchedCells: 0,
      lastMutationAt: new Date().toISOString(),
      cells: ring2.map((cell) => ({
        h3Index: cell,
        resolution: 9,
        metrics: {
          openRequests: 0,
          availableDrivers: 0,
          busyDrivers: 0,
          activeTrips: 0,
          demand: 0,
          imbalance: 0,
          demandLevel: 'low'
        }
      }))
    });

    const result = await pricingContextProvider.buildDerivedPricingContext({
      redis: { pipeline: jest.fn() },
      pickupLocation,
      destinationLocation,
      routeDistanceKm: 4.2,
      routeDurationSecs: 780
    });

    expect(result.metadata.snapshotSource).toBe('h3_read_model');
    expect(result.metadata.readModelTouchedCells).toBe(0);
    expect(h3MapService.collectSnapshot).not.toHaveBeenCalled();
    expect(h3MapService.aggregateCells).not.toHaveBeenCalled();
  });

  test('reutiliza snapshot agregado em cache de curtissima duracao para a mesma celula H3', async () => {
    const pickupLocation = {
      lat: -22.9075,
      lng: -43.1736
    };
    const destinationLocation = {
      lat: -22.9121,
      lng: -43.1825
    };

    const originCell = h3.latLngToCell(pickupLocation.lat, pickupLocation.lng, 9);
    const ring = h3.gridDisk(originCell, 1);
    const ring2 = h3.gridDisk(originCell, 2);
    const outerRing = ring2.filter((cell) => !ring.includes(cell));

    h3MapService.collectSnapshot.mockResolvedValue({
      drivers: [],
      openRequests: [],
      activeTrips: []
    });
    h3MapService.aggregateCells.mockReturnValue({
      cells: [
        {
          h3Index: originCell,
          metrics: {
            openRequests: 2,
            availableDrivers: 3,
            busyDrivers: 1,
            imbalance: 0.5,
            demandLevel: 'medium'
          }
        },
        ...ring
          .filter((cell) => cell !== originCell)
          .map((cell) => ({
            h3Index: cell,
            metrics: {
              openRequests: 1,
              availableDrivers: 1,
              busyDrivers: 0,
              imbalance: 0.25,
              demandLevel: 'low'
            }
          })),
        ...outerRing.map((cell) => ({
          h3Index: cell,
          metrics: {
            openRequests: 0,
            availableDrivers: 2,
            busyDrivers: 0,
            imbalance: 0,
            demandLevel: 'low'
          }
        }))
      ]
    });

    await pricingContextProvider.buildDerivedPricingContext({
      redis: { mocked: true },
      pickupLocation,
      destinationLocation,
      routeDistanceKm: 5,
      routeDurationSecs: 900
    });

    await pricingContextProvider.buildDerivedPricingContext({
      redis: { mocked: true },
      pickupLocation,
      destinationLocation,
      routeDistanceKm: 5.4,
      routeDurationSecs: 960
    });

    expect(h3MapService.collectSnapshot).toHaveBeenCalledTimes(1);
    expect(h3MapService.aggregateCells).toHaveBeenCalledTimes(1);
  });
});
