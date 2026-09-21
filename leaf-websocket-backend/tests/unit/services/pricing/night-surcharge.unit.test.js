const {
  NIGHT_SURCHARGE_RATE,
  resolveNightSurcharge
} = require('../../../../services/pricing/nightSurcharge');
const { calculateDynamicFare } = require('../../../../services/pricing/calculateFare');

describe('pricing/nightSurcharge', () => {
  test('aplica o adicional entre 23h e 4h no fuso informado', () => {
    const at23 = resolveNightSurcharge({
      requestedAt: '2026-09-22T02:00:00.000Z',
      timeZone: 'America/Sao_Paulo'
    });
    const at04 = resolveNightSurcharge({
      requestedAt: '2026-09-22T07:00:00.000Z',
      timeZone: 'America/Sao_Paulo'
    });

    expect(at23).toMatchObject({
      applied: true,
      rate: NIGHT_SURCHARGE_RATE,
      percentage: 15,
      localHour: 23,
      timeZone: 'America/Sao_Paulo'
    });
    expect(at04).toMatchObject({
      applied: false,
      rate: 0,
      percentage: 0,
      localHour: 4
    });
  });

  test('o adicional noturno acumula com a dinâmica sobre a mesma tarifa base', () => {
    const result = calculateDynamicFare({
      distance_km: 10,
      duration_min_traffic: 20,
      eta_pickup_min: 4,
      dynamic_markup_rate: 0.4,
      night_surcharge_rate: NIGHT_SURCHARGE_RATE
    });

    expect(result.tarifa_base).toBe(24.39);
    expect(result.percentual_dinamico_aplicado).toBe(40);
    expect(result.percentual_adicional_noturno).toBe(15);
    expect(result.breakdown.dynamic_markup_value).toBe(9.76);
    expect(result.breakdown.night_surcharge_value).toBe(3.66);
    expect(result.preco_final).toBe(37.8);
  });
});
