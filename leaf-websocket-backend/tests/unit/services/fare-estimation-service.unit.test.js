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

  test('estimateRideFare deve usar métricas de rota fornecidas e manter mínimo tarifário', () => {
    const result = estimateRideFare({
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      carType: 'Leaf Plus',
      routeDistanceKm: 5,
      routeDurationSecs: 900,
      tollFee: 2.5,
      clientEstimatedFare: 0
    });

    expect(result.routeMetrics.source).toBe('client_route_metrics');
    expect(result.routeMetrics.distanceKm).toBe(5);
    expect(result.routeMetrics.durationSecs).toBe(900);
    expect(result.estimatedFare).toBeGreaterThan(0);
    expect(result.estimatedFare).toBeGreaterThanOrEqual(8.5);
  });

  test('estimateRideFare deve cair em fallback haversine sem métricas de rota', () => {
    const result = estimateRideFare({
      pickupLocation: { lat: -22.9075, lng: -43.1736 },
      destinationLocation: { lat: -22.9121, lng: -43.1825 },
      carType: 'Leaf Elite',
      clientEstimatedFare: 0
    });

    expect(result.routeMetrics.source).toBe('fallback_haversine');
    expect(result.routeMetrics.distanceKm).toBeGreaterThan(0);
    expect(result.routeMetrics.durationSecs).toBeGreaterThan(0);
    expect(result.estimatedFare).toBeGreaterThanOrEqual(10.5);
  });
});
