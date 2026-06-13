const {
  MAX_DEMAND_MARKUP_PERCENT,
  calculateDemandPressure
} = require('../../../../services/pricing/demandPressure');

describe('pricing/demandPressure', () => {
  test('não gera adicional sem solicitações abertas', () => {
    const result = calculateDemandPressure({
      active_requests_5m: 0,
      idle_drivers: 0
    });

    expect(result.percent).toBe(0);
    expect(result.multiplier).toBe(1);
    expect(result.level).toBe('normal');
  });

  test('cresce somente a partir da relação entre solicitações e motoristas disponíveis', () => {
    const balanced = calculateDemandPressure({
      active_requests_5m: 4,
      idle_drivers: 5
    });
    const pressured = calculateDemandPressure({
      active_requests_5m: 8,
      idle_drivers: 2
    });

    expect(balanced.percent).toBe(0);
    expect(pressured.percent).toBeGreaterThan(0);
    expect(pressured.percent).toBeLessThanOrEqual(MAX_DEMAND_MARKUP_PERCENT);
    expect(pressured.breakdown.demand_supply_ratio).toBe(4);
  });

  test('ignora métricas de trânsito e comportamento', () => {
    const baseline = calculateDemandPressure({
      active_requests_5m: 6,
      idle_drivers: 3
    });
    const withTrafficNoise = calculateDemandPressure({
      active_requests_5m: 6,
      idle_drivers: 3,
      trip_time_inflation: 3,
      avg_speed_kmh: 4,
      cancel_rate: 1,
      accept_rate: 0
    });

    expect(withTrafficNoise).toEqual(baseline);
  });
});
