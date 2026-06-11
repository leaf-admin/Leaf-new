const { calculatePressureScore } = require('./pressureScore');
const { calculateExceptionScore } = require('./exceptionScore');
const { STATES, classifyOperationalState } = require('./operationalState');
const { evaluateExceptionalMode } = require('./dynamicRules');
const { calculateDynamicFare } = require('./calculateFare');
const { clamp } = require('./utils');

function normalizeCurrent(current = {}) {
  return {
    active_requests_5m: Number(current.active_requests_5m) || 0,
    idle_drivers: Number(current.idle_drivers) || 0,
    avg_pickup_eta_min: Number(current.avg_pickup_eta_min) || 0,
    trip_time_inflation: Number(current.trip_time_inflation) || 1,
    cancel_rate: Number(current.cancel_rate) || 0,
    accept_rate: current.accept_rate === undefined ? 1 : Number(current.accept_rate),
    avg_speed_kmh: Number(current.avg_speed_kmh) || 0
  };
}

function normalizeBaseline(current, baseline = {}) {
  return {
    expected_requests_5m: baseline.expected_requests_5m === undefined ? Math.max(1, current.active_requests_5m || 1) : Number(baseline.expected_requests_5m),
    expected_idle_drivers: baseline.expected_idle_drivers === undefined ? Math.max(1, current.idle_drivers || 1) : Number(baseline.expected_idle_drivers),
    expected_pickup_eta_min: baseline.expected_pickup_eta_min === undefined ? Math.max(1, current.avg_pickup_eta_min || 1) : Number(baseline.expected_pickup_eta_min),
    expected_speed_kmh: baseline.expected_speed_kmh === undefined ? Math.max(1, current.avg_speed_kmh || 1) : Number(baseline.expected_speed_kmh),
    expected_cancel_rate: baseline.expected_cancel_rate === undefined ? Math.max(0.01, current.cancel_rate || 0.01) : Number(baseline.expected_cancel_rate)
  };
}

function normalizeStateContext(stateContext = {}) {
  return {
    now: stateContext.now || new Date().toISOString(),
    previous_state: stateContext.previous_state || STATES.NORMAL,
    state_entered_at: stateContext.state_entered_at || null,
    state_exited_at: stateContext.state_exited_at || null,
    recent_exception_history: Array.isArray(stateContext.recent_exception_history) ? stateContext.recent_exception_history : [],
    degraded_neighbor_count: Number(stateContext.degraded_neighbor_count) || 0,
    is_special_zone: stateContext.is_special_zone === true,
    zone_type: stateContext.zone_type || null
  };
}

function buildPassengerNotice(operationalState) {
  if (operationalState === STATES.PRESSAO || operationalState === STATES.EXCEPCIONAL) {
    return 'As tarifas estão mais altas devido às condições de trânsito e demanda.';
  }
  return null;
}

function buildDriverRegionStatus(operationalState, current = {}) {
  if (operationalState === STATES.EXCEPCIONAL) {
    return {
      state: STATES.EXCEPCIONAL,
      driver_notice: 'Região excepcionalmente aquecida',
      opportunity_level: 'HIGH',
      recommended_repositioning: (Number(current.active_requests_5m) || 0) > (Number(current.idle_drivers) || 0)
    };
  }

  if (operationalState === STATES.PRESSAO) {
    return {
      state: STATES.PRESSAO,
      driver_notice: 'Região aquecida',
      opportunity_level: 'MEDIUM',
      recommended_repositioning: (Number(current.active_requests_5m) || 0) > (Number(current.idle_drivers) || 0)
    };
  }

  return {
    state: STATES.NORMAL,
    driver_notice: 'Região estável',
    opportunity_level: 'LOW',
    recommended_repositioning: false
  };
}

function buildPricingResponse(engineResult) {
  const current = engineResult.current;
  const fare = engineResult.fare;
  const scorePressao = clamp(engineResult.pressure.score, 0, 1);
  const scoreExcecao = clamp(engineResult.exception.score, 0, 1);
  const operationalState = engineResult.operationalState.estado_atual;

  return {
    car_type: fare.car_type,
    rate_card_version: fare.rate_card_version,
    base_fare: fare.breakdown.preco_base,
    distance_component: fare.breakdown.distancia_component,
    time_component: fare.breakdown.tempo_component,
    fixed_fee: fare.breakdown.taxa_fixa,
    base_price_before_dynamic: fare.tarifa_base,
    score_pressao: Number(scorePressao.toFixed(4)),
    score_excecao: Number(scoreExcecao.toFixed(4)),
    dynamic_factor: fare.fator_dinamico,
    dynamic_percentage: fare.percentual_dinamico_aplicado,
    pickup_adjustment: fare.adicional_pickup,
    minimum_fare_applied: fare.valor_minimo_aplicado,
    final_price: fare.preco_final,
    operational_state: operationalState,
    passenger_notice: buildPassengerNotice(operationalState),
    driver_region_status: buildDriverRegionStatus(operationalState, current)
  };
}

function runDynamicPricingEngine(input = {}) {
  const current = normalizeCurrent(input?.operational?.current || {});
  const baseline = normalizeBaseline(current, input?.operational?.baseline || {});
  const stateContext = normalizeStateContext(input?.operational?.state_context || {});
  const trip = {
    distance_km: Number(input?.trip?.distance_km) || 0,
    duration_min_traffic: Number(input?.trip?.duration_min_traffic) || 0,
    eta_pickup_min: Number(input?.trip?.eta_pickup_min) || 0,
    carType: input?.trip?.carType || input?.trip?.car_type || input?.carType || input?.car_type
  };

  const pressure = calculatePressureScore(current);
  const exception = calculateExceptionScore(current, baseline);
  const operationalState = classifyOperationalState({
    score_pressao: pressure.score,
    score_excecao: exception.score,
    state_context: stateContext
  });
  const exceptionalMode = evaluateExceptionalMode({
    operationalState,
    score_excecao: exception.score,
    degraded_neighbor_count: stateContext.degraded_neighbor_count,
    is_special_zone: stateContext.is_special_zone,
    zone_type: stateContext.zone_type
  });
  const fare = calculateDynamicFare({
    distance_km: trip.distance_km,
    duration_min_traffic: trip.duration_min_traffic,
    eta_pickup_min: trip.eta_pickup_min,
    carType: trip.carType,
    score_pressao: pressure.score,
    score_excecao: exception.score
  });

  const engineResult = {
    current,
    baseline,
    stateContext,
    pressure,
    exception,
    operationalState,
    exceptionalMode,
    fare
  };

  return {
    ...engineResult,
    pricingPayload: buildPricingResponse(engineResult)
  };
}

module.exports = {
  STATES,
  calculatePressureScore,
  calculateExceptionScore,
  classifyOperationalState,
  evaluateExceptionalMode,
  calculateDynamicFare,
  buildPricingResponse,
  runDynamicPricingEngine
};
