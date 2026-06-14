const {
  STATES,
  runDynamicPricingEngine
} = require('../../../../services/pricing');

describe('pricing/index', () => {
  const originalPricingMode = process.env.PRICING_DEMAND_PRESSURE_MODE;

  afterEach(() => {
    if (originalPricingMode === undefined) {
      delete process.env.PRICING_DEMAND_PRESSURE_MODE;
    } else {
      process.env.PRICING_DEMAND_PRESSURE_MODE = originalPricingMode;
    }
  });

  test('cenário normal deve retornar payload limpo para passageiro', () => {
    const result = runDynamicPricingEngine({
      trip: {
        distance_km: 4,
        duration_min_traffic: 10,
        eta_pickup_min: 3
      },
      operational: {
        current: {
          active_requests_5m: 3,
          idle_drivers: 6,
          avg_pickup_eta_min: 3,
          trip_time_inflation: 1.05,
          cancel_rate: 0.04,
          accept_rate: 0.95,
          avg_speed_kmh: 26
        },
        baseline: {
          expected_requests_5m: 3,
          expected_idle_drivers: 6,
          expected_pickup_eta_min: 3,
          expected_speed_kmh: 26,
          expected_cancel_rate: 0.04
        },
        state_context: {
          now: '2026-03-29T09:00:00.000Z'
        }
      }
    });

    expect(result.pricingPayload.operational_state).toBe(STATES.NORMAL);
    expect(result.pricingPayload.passenger_notice).toBeNull();
    expect(result.pricingPayload.driver_region_status.opportunity_level).toBe('LOW');
  });

  test('pico leve deve gerar aviso simples de pressão', () => {
    const result = runDynamicPricingEngine({
      trip: {
        distance_km: 6,
        duration_min_traffic: 18,
        eta_pickup_min: 6
      },
      operational: {
        current: {
          active_requests_5m: 8,
          idle_drivers: 4,
          avg_pickup_eta_min: 6,
          trip_time_inflation: 1.3,
          cancel_rate: 0.08,
          accept_rate: 0.82,
          avg_speed_kmh: 18
        },
        baseline: {
          expected_requests_5m: 6,
          expected_idle_drivers: 5,
          expected_pickup_eta_min: 4,
          expected_speed_kmh: 24,
          expected_cancel_rate: 0.05
        },
        state_context: {
          now: '2026-03-29T10:05:00.000Z',
          previous_state: STATES.NORMAL,
          recent_exception_history: [
            { timestamp: '2026-03-29T10:00:00.000Z', score_excecao: 0.36 },
            { timestamp: '2026-03-29T10:03:00.000Z', score_excecao: 0.41 }
          ]
        }
      }
    });

    expect(result.pricingPayload.operational_state).toBe(STATES.PRESSAO);
    expect(result.pricingPayload.passenger_notice).toBe('As tarifas estão mais altas devido às condições de trânsito e demanda.');
    expect(result.pricingPayload.driver_region_status.recommended_repositioning).toBe(true);
  });

  test('chuva forte / saída de evento deve ativar modo excepcional', () => {
    const result = runDynamicPricingEngine({
      trip: {
        distance_km: 9,
        duration_min_traffic: 30,
        eta_pickup_min: 9
      },
      operational: {
        current: {
          active_requests_5m: 25,
          idle_drivers: 2,
          avg_pickup_eta_min: 12,
          trip_time_inflation: 1.6,
          cancel_rate: 0.24,
          accept_rate: 0.45,
          avg_speed_kmh: 9
        },
        baseline: {
          expected_requests_5m: 10,
          expected_idle_drivers: 8,
          expected_pickup_eta_min: 4,
          expected_speed_kmh: 24,
          expected_cancel_rate: 0.08
        },
        state_context: {
          now: '2026-03-29T23:06:00.000Z',
          previous_state: STATES.PRESSAO,
          recent_exception_history: [
            { timestamp: '2026-03-29T23:00:00.000Z', score_excecao: 0.68 },
            { timestamp: '2026-03-29T23:03:00.000Z', score_excecao: 0.72 }
          ],
          degraded_neighbor_count: 4
        }
      }
    });

    expect(result.pricingPayload.operational_state).toBe(STATES.EXCEPCIONAL);
    expect(result.pricingPayload.passenger_notice).toBe('As tarifas estão mais altas devido às condições de trânsito e demanda.');
    expect(result.exceptionalMode.exceptional_mode_active).toBe(true);
  });

  test('modo ativo cobra adicional apenas por demanda e mantém trânsito no tempo da tarifa', () => {
    process.env.PRICING_DEMAND_PRESSURE_MODE = 'active';
    const buildInput = (tripTimeInflation, durationMinTraffic) => ({
      trip: {
        distance_km: 8,
        duration_min_traffic: durationMinTraffic,
        eta_pickup_min: 4
      },
      operational: {
        current: {
          active_requests_5m: 8,
          idle_drivers: 2,
          avg_pickup_eta_min: 5,
          trip_time_inflation: tripTimeInflation,
          cancel_rate: 0.04,
          accept_rate: 0.95,
          avg_speed_kmh: 20
        },
        baseline: {
          expected_requests_5m: 8,
          expected_idle_drivers: 2,
          expected_pickup_eta_min: 5,
          expected_speed_kmh: 26,
          expected_cancel_rate: 0.04
        },
        state_context: {
          now: '2026-06-13T12:00:00.000Z'
        }
      }
    });

    const normalTraffic = runDynamicPricingEngine(buildInput(1, 18));
    const heavyTraffic = runDynamicPricingEngine(buildInput(1.6, 30));

    expect(heavyTraffic.pricingPayload.dynamic_percentage)
      .toBe(normalTraffic.pricingPayload.dynamic_percentage);
    expect(heavyTraffic.pricingPayload.final_price)
      .toBeGreaterThan(normalTraffic.pricingPayload.final_price);
    expect(heavyTraffic.pricingPayload.dynamic_reason).toBe('demand_pressure');
    expect(heavyTraffic.pricingPayload.traffic_adjusted).toBe(true);
    expect(heavyTraffic.pricingPayload.passenger_notice)
      .toBe('Há mais pedidos que motoristas disponíveis nesta região.');
    expect(heavyTraffic.pricingPayload.traffic_notice)
      .toBe('O valor considera o tempo estimado com o trânsito atual.');
  });

  test('dry-run preserva a tarifa atual e expõe a comparação da nova regra', () => {
    process.env.PRICING_DEMAND_PRESSURE_MODE = 'dry_run';
    const result = runDynamicPricingEngine({
      trip: {
        distance_km: 6,
        duration_min_traffic: 20,
        eta_pickup_min: 6
      },
      operational: {
        current: {
          active_requests_5m: 8,
          idle_drivers: 2,
          avg_pickup_eta_min: 7,
          trip_time_inflation: 1.4,
          cancel_rate: 0.12,
          accept_rate: 0.7,
          avg_speed_kmh: 15
        }
      }
    });

    expect(result.pricingPayload.pricing_model).toBe('legacy_combined_pressure');
    expect(result.pricingPayload.pricing_model_mode).toBe('dry_run');
    expect(result.pricingPayload.pricing_shadow).toEqual(expect.objectContaining({
      model: 'demand_pressure_v2',
      dynamic_percentage: expect.any(Number),
      final_price: expect.any(Number),
      difference_from_active_price: expect.any(Number)
    }));
  });
});
