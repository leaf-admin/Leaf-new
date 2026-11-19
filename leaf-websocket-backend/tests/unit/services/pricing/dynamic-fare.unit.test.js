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

    expect(result.tarifa_base).toBe(24.39);
    expect(result.fator_dinamico).toBe(1);
    expect(result.preco_final).toBe(24.39);
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

  test('fator dinâmico deve respeitar teto de 40%', () => {
    const result = calculateDynamicFare({
      distance_km: 7,
      duration_min_traffic: 14,
      eta_pickup_min: 5,
      score_pressao: 1,
      score_excecao: 1,
      dynamic_markup_rate: 1
    });

    expect(result.fator_dinamico).toBe(1.4);
    expect(result.percentual_dinamico_aplicado).toBe(40);
  });

  test('corrida curta deve aplicar mínimo tarifário', () => {
    const result = calculateDynamicFare({
      distance_km: 0.5,
      duration_min_traffic: 2,
      eta_pickup_min: 2,
      score_pressao: 0,
      score_excecao: 0
    });

    expect(result.preco_final).toBe(10);
    expect(result.valor_minimo_aplicado).toBe(true);
  });
});

describe('pricing/calculateFare seguro APP', () => {
  const previous = process.env.RIDE_INSURANCE_FEE_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.RIDE_INSURANCE_FEE_ENABLED;
    else process.env.RIDE_INSURANCE_FEE_ENABLED = previous;
  });

  it('adds R$ 0,13 to the passenger price outside the dynamic markup and the minimum fare', () => {
    delete process.env.RIDE_INSURANCE_FEE_ENABLED;
    const input = { distance_km: 8, duration_min_traffic: 20, dynamic_markup_rate: 0.2 };
    const without = calculateDynamicFare(input);
    process.env.RIDE_INSURANCE_FEE_ENABLED = 'true';
    const withInsurance = calculateDynamicFare(input);
    expect(withInsurance.breakdown.ride_insurance_fee).toBe(0.13);
    expect(Math.round((withInsurance.preco_final - without.preco_final) * 100)).toBe(13);

    const short = calculateDynamicFare({ distance_km: 0.5, duration_min_traffic: 1 });
    expect(short.valor_minimo_aplicado).toBe(true);
    expect(short.preco_final).toBe(Math.round((short.breakdown.valor_minimo + 0.13) * 100) / 100);
  });
});
