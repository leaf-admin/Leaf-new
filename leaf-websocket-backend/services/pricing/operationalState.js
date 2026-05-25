const { clamp } = require('./utils');

const STATES = {
  NORMAL: 'NORMAL',
  PRESSAO: 'PRESSAO',
  EXCEPCIONAL: 'EXCEPCIONAL'
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

function toTimestamp(value, fallbackMs) {
  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallbackMs;
}

function toIso(valueMs) {
  return new Date(valueMs).toISOString();
}

function normalizeHistory(history, scoreExcecao, nowMs) {
  const points = Array.isArray(history) ? history : [];
  const normalized = points
    .map((point) => ({
      timestamp: toTimestamp(point?.timestamp ?? point?.ts, nowMs),
      score_excecao: clamp(point?.score_excecao ?? point?.scoreExcecao ?? point?.score, 0, 1)
    }))
    .filter((point) => Number.isFinite(point.timestamp) && point.timestamp <= nowMs)
    .sort((left, right) => left.timestamp - right.timestamp);

  normalized.push({ timestamp: nowMs, score_excecao: clamp(scoreExcecao, 0, 1) });
  return normalized;
}

function hasSustained(history, comparator, threshold, durationMs, nowMs) {
  let sustainedSince = null;

  for (const point of history) {
    if (comparator(point.score_excecao, threshold)) {
      if (sustainedSince === null) {
        sustainedSince = point.timestamp;
      }
    } else {
      sustainedSince = null;
    }
  }

  return sustainedSince !== null && (nowMs - sustainedSince) >= durationMs;
}

/**
 * @param {{score_pressao?:number, score_excecao?:number, state_context?:{now?:string|number|Date, previous_state?:string, state_entered_at?:string|number|Date|null, state_exited_at?:string|number|Date|null, recent_exception_history?:Array<{timestamp:string|number|Date, score_excecao:number}>, degraded_neighbor_count?:number, is_special_zone?:boolean, zone_type?:string|null}}} input
 */
function classifyOperationalState(input = {}) {
  const scoreExcecao = clamp(input.score_excecao, 0, 1);
  const context = input.state_context || {};
  const nowMs = toTimestamp(context.now, Date.now());
  const previousState = Object.values(STATES).includes(context.previous_state) ? context.previous_state : STATES.NORMAL;
  const previousEnteredAtMs = toTimestamp(context.state_entered_at, nowMs);
  const degradedNeighborCount = Math.max(0, Number(context.degraded_neighbor_count) || 0);
  const isSpecialZone = context.is_special_zone === true;
  const zoneType = context.zone_type || null;
  const history = normalizeHistory(context.recent_exception_history, scoreExcecao, nowMs);

  const sustainedExceptional = hasSustained(history, (score, threshold) => score >= threshold, 0.60, FIVE_MINUTES_MS, nowMs);
  const sustainedBelowExceptionalExit = hasSustained(history, (score, threshold) => score < threshold, 0.45, TEN_MINUTES_MS, nowMs);
  const sustainedBelowPressureExit = hasSustained(history, (score, threshold) => score < threshold, 0.30, FIVE_MINUTES_MS, nowMs);
  const exceptionalEntryEligible = scoreExcecao >= 0.60 && sustainedExceptional && (degradedNeighborCount >= 3 || isSpecialZone);

  let nextState = STATES.NORMAL;
  let reason = 'score_excecao_low';

  if (previousState === STATES.EXCEPCIONAL) {
    if (!sustainedBelowExceptionalExit) {
      nextState = STATES.EXCEPCIONAL;
      reason = isSpecialZone ? 'special_zone_hysteresis' : 'exceptional_hysteresis_hold';
    } else if (scoreExcecao >= 0.35) {
      nextState = STATES.PRESSAO;
      reason = 'cooled_down_from_exceptional';
    } else {
      nextState = STATES.NORMAL;
      reason = 'exceptional_resolved';
    }
  } else if (exceptionalEntryEligible) {
    nextState = STATES.EXCEPCIONAL;
    reason = isSpecialZone ? 'special_zone_exceptional' : 'cluster_exceptional';
  } else if (previousState === STATES.PRESSAO) {
    if (!sustainedBelowPressureExit) {
      nextState = STATES.PRESSAO;
      reason = scoreExcecao >= 0.60 ? 'awaiting_exceptional_confirmation' : 'pressure_hysteresis_hold';
    } else {
      nextState = STATES.NORMAL;
      reason = 'pressure_resolved';
    }
  } else if (scoreExcecao >= 0.35) {
    nextState = STATES.PRESSAO;
    reason = scoreExcecao >= 0.60 ? 'awaiting_exceptional_confirmation' : 'pressure_threshold';
  }

  const stateChanged = nextState !== previousState;
  const enteredAt = stateChanged ? nowMs : previousEnteredAtMs;

  return {
    estado_atual: nextState,
    motivo_principal: reason,
    entered_at: toIso(enteredAt),
    exited_at: stateChanged ? toIso(nowMs) : null,
    elegivel_para_dinamica_excepcional: nextState === STATES.EXCEPCIONAL,
    cluster_size: degradedNeighborCount,
    zone_type: zoneType,
    debug: {
      sustained_exceptional: sustainedExceptional,
      sustained_below_exceptional_exit: sustainedBelowExceptionalExit,
      sustained_below_pressure_exit: sustainedBelowPressureExit,
      is_special_zone: isSpecialZone
    }
  };
}

module.exports = {
  STATES,
  classifyOperationalState
};
