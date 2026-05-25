const { calculatePressureScore } = require('../../../../services/pricing/pressureScore');

describe('pricing/pressureScore', () => {
  test('cenário normal deve gerar score baixo', () => {
    const result = calculatePressureScore({
      active_requests_5m: 2,
      idle_drivers: 5,
      avg_pickup_eta_min: 2.5,
      trip_time_inflation: 1.02,
      cancel_rate: 0.03,
      accept_rate: 0.95
    });

    expect(result.score).toBeCloseTo(0.01, 2);
    expect(result.breakdown.demand_supply_ratio).toBeCloseTo(0.4, 4);
    expect(result.breakdown.pickup_eta_norm).toBe(0);
  });

  test('pressão alta deve refletir demanda, trânsito e baixa aceitação', () => {
    const result = calculatePressureScore({
      active_requests_5m: 12,
      idle_drivers: 3,
      avg_pickup_eta_min: 8,
      trip_time_inflation: 1.45,
      cancel_rate: 0.18,
      accept_rate: 0.55
    });

    expect(result.score).toBeGreaterThan(0.88);
    expect(result.breakdown.demand_supply_ratio_norm).toBe(1);
    expect(result.breakdown.trip_time_inflation_norm).toBe(0.85);
    expect(result.breakdown.low_acceptance_norm).toBeCloseTo(0.8, 6);
  });
});
