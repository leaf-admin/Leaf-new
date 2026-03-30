const {
  calculateDynamicFare
} = require('../../../../services/pricing/calculateFare');

describe('pricing/calculateFare', () => {
  test('cenário normal deve respeitar fórmula base sem dinâmica', () => {
    const result = calculateDynamicFare({
      distance_km: 10,
      duration_min_traffic: 20,
      eta_pickup_min: 4,
      score_pressao: 0,
      score_excecao: 0
    });

    expect(result.tarifa_base).toBe(33.54);
    expect(result.fator_dinamico).toBe(1);
    expect(result.preco_final).toBe(33.54);
    expect(result.valor_minimo_aplicado).toBe(false);
  });

  test('pickup acima de 4 minutos deve cobrar adicional com teto', () => {
    const result = calculateDynamicFare({
      distance_km: 3,
      duration_min_traffic: 8,
      eta_pickup_min: 12,
      score_pressao: 0.1,
      score_excecao: 0.1
    });

    expect(result.adicional_pickup).toBe(2.5);
    expect(result.breakdown.pickup_adjustment).toBe(2.5);
  });

  test('fator dinâmico deve respeitar teto de 35%', () => {
    const result = calculateDynamicFare({
      distance_km: 7,
      duration_min_traffic: 14,
      eta_pickup_min: 5,
      score_pressao: 1,
      score_excecao: 1
    });

    expect(result.fator_dinamico).toBe(1.35);
    expect(result.percentual_dinamico_aplicado).toBe(35);
  });

  test('corrida curta deve aplicar mínimo tarifário', () => {
    const result = calculateDynamicFare({
      distance_km: 0.5,
      duration_min_traffic: 2,
      eta_pickup_min: 2,
      score_pressao: 0,
      score_excecao: 0
    });

    expect(result.preco_final).toBe(8.5);
    expect(result.valor_minimo_aplicado).toBe(true);
  });
});
