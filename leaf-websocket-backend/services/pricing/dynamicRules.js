const { STATES } = require('./operationalState');
const { clamp } = require('./utils');

/**
 * @param {{operationalState?:{estado_atual?:string, motivo_principal?:string, entered_at?:string|null}, score_excecao?:number, degraded_neighbor_count?:number, is_special_zone?:boolean, zone_type?:string|null}} input
 */
function evaluateExceptionalMode(input = {}) {
  const operationalState = input.operationalState || {};
  const state = operationalState.estado_atual || STATES.NORMAL;
  const exceptionalModeActive = state === STATES.EXCEPCIONAL;
  const clusterSize = Math.max(0, Number(input.degraded_neighbor_count) || 0);
  const zoneType = input.zone_type || null;
  const scoreExcecao = clamp(input.score_excecao, 0, 1);
  const reason = exceptionalModeActive
    ? (operationalState.motivo_principal || 'exceptional_state_active')
    : 'state_not_exceptional';

  return {
    exceptional_mode_active: exceptionalModeActive,
    started_at: exceptionalModeActive ? operationalState.entered_at || null : null,
    reason,
    cluster_size: clusterSize,
    zone_type: zoneType,
    score_excecao_at_activation: exceptionalModeActive ? scoreExcecao : null,
    audit: {
      event: 'dynamic_exceptional_mode_evaluated',
      activated: exceptionalModeActive,
      reason,
      cluster_size: clusterSize,
      zone_type: zoneType,
      score_excecao: scoreExcecao,
      state
    }
  };
}

module.exports = {
  evaluateExceptionalMode
};
