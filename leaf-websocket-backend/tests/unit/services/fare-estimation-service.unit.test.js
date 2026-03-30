const {
  estimateRideFare,
  normalizeCarType
} = require('../../../services/fare-estimation-service');

describe('fare-estimation-service', () => {
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
    expect(result.pricingPayload).toEqual(expect.objectContaining({
      final_price: result.estimatedFare,
      score_pressao: expect.any(Number),
      score_excecao: expect.any(Number),
      operational_state: expect.any(String)
    }));
    expect(result.operationalState).toBe(result.pricingPayload.operational_state);
    expect(result.scorePressao).toBe(result.pricingPayload.score_pressao);
    expect(result.scoreExcecao).toBe(result.pricingPayload.score_excecao);
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
});
