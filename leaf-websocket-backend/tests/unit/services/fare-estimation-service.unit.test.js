const {
  estimateRideFare,
  normalizeCarType,
  __resetEstimateCacheForTests
} = require('../../../services/fare-estimation-service');
const pricingContextProvider = require('../../../services/pricing-context-provider');

describe('fare-estimation-service', () => {
  const originalPricingMode = process.env.PRICING_DEMAND_PRESSURE_MODE;

  beforeEach(() => {
    __resetEstimateCacheForTests();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    if (originalPricingMode === undefined) {
      delete process.env.PRICING_DEMAND_PRESSURE_MODE;
    } else {
      process.env.PRICING_DEMAND_PRESSURE_MODE = originalPricingMode;
    }
  });

  test('normalizeCarType deve mapear categorias legadas', () => {
    expect(normalizeCarType('Leaf Plus')).toBe('leaf_plus');
    expect(normalizeCarType('Leaf Elite')).toBe('leaf_elite');
    expect(normalizeCarType('Leaf Moto')).toBe('leaf_moto');
    expect(normalizeCarType('type1')).toBe('leaf_plus');
    expect(normalizeCarType('type3')).toBe('leaf_elite');
    expect(normalizeCarType('type_moto')).toBe('leaf_moto');
  });

  test('estimateRideFare deve usar métricas de rota fornecidas e retornar pricingPayload compatível', async () => {
    const result = await estimateRideFare({
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      carType: 'Leaf Plus',
      routeDistanceKm: 5,
      routeDurationSecs: 900,
      tollFee: 2.5,
      clientEstimatedFare: 0,
      pricingContext: {
        operational: {
          current: {
            active_requests_5m: 8,
            idle_drivers: 4,
            avg_pickup_eta_min: 6,
            trip_time_inflation: 1.3,
            cancel_rate: 0.09,
            accept_rate: 0.8,
            avg_speed_kmh: 18
          },
          baseline: {
            expected_requests_5m: 5,
            expected_idle_drivers: 5,
            expected_pickup_eta_min: 4,
            expected_speed_kmh: 24,
            expected_cancel_rate: 0.05
          },
          state_context: {
            previous_state: 'PRESSAO',
            recent_exception_history: [
              { timestamp: '2026-03-29T10:00:00.000Z', score_excecao: 0.4 },
              { timestamp: '2026-03-29T10:04:00.000Z', score_excecao: 0.42 }
            ],
            now: '2026-03-29T10:05:00.000Z'
          }
        }
      }
    });

    expect(result.routeMetrics.source).toBe('client_route_metrics');
    expect(result.routeMetrics.distanceKm).toBe(5);
    expect(result.routeMetrics.durationSecs).toBe(900);
    expect(result.estimatedFare).toBeGreaterThan(0);
    expect(result.tollFee).toBe(2.5);
    expect(result.pricingPayload.final_price).toBe(result.estimatedFare);
    expect(result.pricingPayload.toll_fee).toBe(2.5);
    expect(result.pricingPayload.final_price_before_toll).toBeCloseTo(result.estimatedFare - 2.5, 2);
    expect(result.pricingPayload).toEqual(expect.objectContaining({
      pickup_adjustment: 0,
      pickup_adjustment_source: 'disabled_non_authoritative_eta',
      pickup_eta_authoritative: false,
      score_pressao: expect.any(Number),
      score_excecao: expect.any(Number),
      operational_state: expect.any(String)
    }));
    expect(result.operationalState).toBe(result.pricingPayload.operational_state);
    expect(result.scorePressao).toBe(result.pricingPayload.score_pressao);
    expect(result.scoreExcecao).toBe(result.pricingPayload.score_excecao);
    expect(result.pricingAudit).toEqual(expect.objectContaining({
      baselineSource: expect.any(String),
      stateSource: expect.any(String),
      historySource: expect.any(String),
      currentSnapshot: expect.any(Object),
      baselineSnapshot: expect.any(Object)
    }));
  });

  test('estimateRideFare deve cair em fallback haversine sem métricas de rota', async () => {
    const result = await estimateRideFare({
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      carType: 'Leaf Elite',
      clientEstimatedFare: 0
    });

    expect(result.routeMetrics.source).toBe('fallback_haversine');
    expect(result.routeMetrics.distanceKm).toBeGreaterThan(0);
    expect(result.routeMetrics.durationSecs).toBeGreaterThan(0);
    expect(result.estimatedFare).toBeGreaterThanOrEqual(8.5);
    expect(result.pricingPayload.final_price).toBe(result.estimatedFare);
  });

  test('estimateRideFare deve cobrar adicional de embarque apenas com ETA autoritativa', async () => {
    const result = await estimateRideFare({
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      carType: 'Leaf Plus',
      routeDistanceKm: 5,
      routeDurationSecs: 900,
      clientEstimatedFare: 0,
      pricingContext: {
        trip: {
          eta_pickup_min: 7,
          eta_pickup_source: 'reserved_driver_route',
          eta_pickup_authoritative: true
        },
        operational: {
          current: {
            active_requests_5m: 3,
            idle_drivers: 5,
            avg_pickup_eta_min: 7,
            trip_time_inflation: 1,
            accept_rate: 0.95,
            avg_speed_kmh: 22
          }
        }
      }
    });

    expect(result.pricingPayload).toEqual(expect.objectContaining({
      eta_pickup_min: 7,
      eta_pickup_pricing_min: 7,
      pickup_adjustment: 1.2,
      pickup_adjustment_source: 'reserved_driver_route',
      pickup_eta_authoritative: true,
      pickup_eta_source: 'reserved_driver_route'
    }));
  });

  test('estimateRideFare deve reaproveitar cache quente para inputs equivalentes', async () => {
    const spy = jest.spyOn(pricingContextProvider, 'buildDerivedPricingContext');
    const payload = {
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      carType: 'Leaf Plus',
      routeDistanceKm: 5.04,
      routeDurationSecs: 912,
      tollFee: 2.5,
      clientEstimatedFare: 0
    };

    const first = await estimateRideFare(payload);
    const second = await estimateRideFare({
      ...payload,
      routeDistanceKm: 5.01,
      routeDurationSecs: 900
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.estimatedFare).toBe(first.estimatedFare);
    expect(second.pricingAudit.cacheSource).toBe('fare_estimation_hot_cache');
  });

  test('troca do modelo de pricing não reaproveita cotação do modo anterior', async () => {
    const spy = jest.spyOn(pricingContextProvider, 'buildDerivedPricingContext');
    const payload = {
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      carType: 'Leaf Plus',
      routeDistanceKm: 5,
      routeDurationSecs: 900,
      tollFee: 0,
      clientEstimatedFare: 0,
      pricingContext: {
        operational: {
          current: {
            active_requests_5m: 8,
            idle_drivers: 2,
            avg_pickup_eta_min: 5,
            trip_time_inflation: 1.4,
            cancel_rate: 0.12,
            accept_rate: 0.7,
            avg_speed_kmh: 18
          }
        }
      }
    };

    process.env.PRICING_DEMAND_PRESSURE_MODE = 'dry_run';
    const dryRun = await estimateRideFare(payload);

    process.env.PRICING_DEMAND_PRESSURE_MODE = 'active';
    const active = await estimateRideFare(payload);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(dryRun.pricingPayload.pricing_model_mode).toBe('dry_run');
    expect(active.pricingPayload.pricing_model_mode).toBe('active');
    expect(active.pricingAudit.cacheSource).toBeUndefined();
  });
});
