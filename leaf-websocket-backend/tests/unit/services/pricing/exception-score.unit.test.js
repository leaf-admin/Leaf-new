const { calculateExceptionScore } = require('../../../../services/pricing/exceptionScore');

describe('pricing/exceptionScore', () => {
  test('dia comum deve gerar score de exceção nulo ou muito baixo', () => {
    const result = calculateExceptionScore(
      {
        active_requests_5m: 8,
        idle_drivers: 6,
        avg_pickup_eta_min: 4,
        avg_speed_kmh: 24,
        cancel_rate: 0.05
      },
      {
        expected_requests_5m: 8,
        expected_idle_drivers: 6,
        expected_pickup_eta_min: 4,
        expected_speed_kmh: 24,
        expected_cancel_rate: 0.05
      }
    );

    expect(result.score).toBe(0);
    expect(result.breakdown.ratio_demanda).toBe(1);
    expect(result.breakdown.speed_drop).toBe(0);
  });

  test('evento atípico forte deve gerar score próximo do teto', () => {
    const result = calculateExceptionScore(
      {
        active_requests_5m: 25,
        idle_drivers: 2,
        avg_pickup_eta_min: 12,
        avg_speed_kmh: 9,
        cancel_rate: 0.24
      },
      {
        expected_requests_5m: 10,
        expected_idle_drivers: 8,
        expected_pickup_eta_min: 4,
        expected_speed_kmh: 24,
        expected_cancel_rate: 0.08
      }
    );

    expect(result.score).toBe(1);
    expect(result.breakdown.spike_demanda_norm).toBe(1);
    expect(result.breakdown.queda_oferta_norm).toBe(1);
    expect(result.breakdown.explosao_eta_norm).toBe(1);
  });
});
