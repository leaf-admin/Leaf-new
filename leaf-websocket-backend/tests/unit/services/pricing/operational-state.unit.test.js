const {
  STATES,
  classifyOperationalState
} = require('../../../../services/pricing/operationalState');

describe('pricing/operationalState', () => {
  test('pico leve deve entrar em PRESSAO', () => {
    const result = classifyOperationalState({
      score_excecao: 0.42,
      state_context: {
        now: '2026-03-29T10:05:00.000Z',
        previous_state: STATES.NORMAL,
        recent_exception_history: [
          { timestamp: '2026-03-29T10:00:00.000Z', score_excecao: 0.38 },
          { timestamp: '2026-03-29T10:03:00.000Z', score_excecao: 0.4 }
        ]
      }
    });

    expect(result.estado_atual).toBe(STATES.PRESSAO);
    expect(result.elegivel_para_dinamica_excepcional).toBe(false);
  });

  test('cluster insuficiente não deve ativar EXCEPCIONAL', () => {
    const result = classifyOperationalState({
      score_excecao: 0.7,
      state_context: {
        now: '2026-03-29T10:06:00.000Z',
        previous_state: STATES.PRESSAO,
        recent_exception_history: [
          { timestamp: '2026-03-29T10:00:00.000Z', score_excecao: 0.62 },
          { timestamp: '2026-03-29T10:02:00.000Z', score_excecao: 0.68 },
          { timestamp: '2026-03-29T10:04:00.000Z', score_excecao: 0.71 }
        ],
        degraded_neighbor_count: 2
      }
    });

    expect(result.estado_atual).toBe(STATES.PRESSAO);
    expect(result.motivo_principal).toBe('awaiting_exceptional_confirmation');
  });

  test('chuva forte com cluster deve ativar EXCEPCIONAL', () => {
    const result = classifyOperationalState({
      score_excecao: 0.78,
      state_context: {
        now: '2026-03-29T10:06:00.000Z',
        previous_state: STATES.PRESSAO,
        recent_exception_history: [
          { timestamp: '2026-03-29T10:00:00.000Z', score_excecao: 0.62 },
          { timestamp: '2026-03-29T10:02:00.000Z', score_excecao: 0.7 },
          { timestamp: '2026-03-29T10:04:00.000Z', score_excecao: 0.75 }
        ],
        degraded_neighbor_count: 4
      }
    });

    expect(result.estado_atual).toBe(STATES.EXCEPCIONAL);
    expect(result.elegivel_para_dinamica_excepcional).toBe(true);
  });

  test('zona especial pode ativar EXCEPCIONAL sem cluster mínimo', () => {
    const result = classifyOperationalState({
      score_excecao: 0.81,
      state_context: {
        now: '2026-03-29T23:06:00.000Z',
        previous_state: STATES.PRESSAO,
        recent_exception_history: [
          { timestamp: '2026-03-29T23:00:00.000Z', score_excecao: 0.66 },
          { timestamp: '2026-03-29T23:03:00.000Z', score_excecao: 0.73 }
        ],
        degraded_neighbor_count: 1,
        is_special_zone: true,
        zone_type: 'ARENA'
      }
    });

    expect(result.estado_atual).toBe(STATES.EXCEPCIONAL);
    expect(result.zone_type).toBe('ARENA');
  });

  test('retorno à normalidade deve respeitar histerese', () => {
    const result = classifyOperationalState({
      score_excecao: 0.18,
      state_context: {
        now: '2026-03-29T11:10:00.000Z',
        previous_state: STATES.PRESSAO,
        state_entered_at: '2026-03-29T11:00:00.000Z',
        recent_exception_history: [
          { timestamp: '2026-03-29T11:04:00.000Z', score_excecao: 0.25 },
          { timestamp: '2026-03-29T11:07:00.000Z', score_excecao: 0.22 }
        ]
      }
    });

    expect(result.estado_atual).toBe(STATES.NORMAL);
    expect(result.motivo_principal).toBe('pressure_resolved');
  });
});
