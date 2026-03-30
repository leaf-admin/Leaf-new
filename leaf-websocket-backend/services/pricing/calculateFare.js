const { clamp, roundCurrency } = require('./utils');

const PRICING_CONSTANTS = {
  preco_base: 2.79,
  taxa_fixa: 0.95,
  valor_km: 0.26,
  valor_min: 1.36,
  valor_minimo: 8.5,
  pickup_grace_min: 4,
  pickup_increment: 0.4,
  pickup_cap: 2.5,
  max_dynamic_markup: 0.35,
  score_pressao_weight: 0.15,
  score_excecao_weight: 0.20
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {{distance_km?:number, duration_min_traffic?:number, eta_pickup_min?:number, score_pressao?:number, score_excecao?:number}} input
 */
function calculateDynamicFare(input = {}) {
  const distanceKm = Math.max(0, toNumber(input.distance_km, 0));
  const durationMinTraffic = Math.max(0, toNumber(input.duration_min_traffic, 0));
  const etaPickupMin = Math.max(0, toNumber(input.eta_pickup_min, 0));
  const scorePressao = clamp(input.score_pressao, 0, 1);
  const scoreExcecao = clamp(input.score_excecao, 0, 1);

  const distanceComponent = distanceKm * PRICING_CONSTANTS.valor_km;
  const timeComponent = durationMinTraffic * PRICING_CONSTANTS.valor_min;
  const tarifaBase = PRICING_CONSTANTS.preco_base + PRICING_CONSTANTS.taxa_fixa + distanceComponent + timeComponent;

  const dynamicMarkupRate = Math.min(
    PRICING_CONSTANTS.max_dynamic_markup,
    (PRICING_CONSTANTS.score_pressao_weight * scorePressao) + (PRICING_CONSTANTS.score_excecao_weight * scoreExcecao)
  );
  const fatorDinamico = 1 + dynamicMarkupRate;
  const additionalPickup = Math.min(
    PRICING_CONSTANTS.pickup_cap,
    Math.max(0, etaPickupMin - PRICING_CONSTANTS.pickup_grace_min) * PRICING_CONSTANTS.pickup_increment
  );
  const subtotalWithDynamic = (tarifaBase * fatorDinamico) + additionalPickup;
  const minimumFareApplied = subtotalWithDynamic < PRICING_CONSTANTS.valor_minimo;
  const finalPrice = Math.max(PRICING_CONSTANTS.valor_minimo, subtotalWithDynamic);

  return {
    tarifa_base: roundCurrency(tarifaBase),
    fator_dinamico: Number(fatorDinamico.toFixed(4)),
    percentual_dinamico_aplicado: roundCurrency(dynamicMarkupRate * 100),
    adicional_pickup: roundCurrency(additionalPickup),
    preco_final: roundCurrency(finalPrice),
    valor_minimo_aplicado: minimumFareApplied,
    breakdown: {
      preco_base: roundCurrency(PRICING_CONSTANTS.preco_base),
      taxa_fixa: roundCurrency(PRICING_CONSTANTS.taxa_fixa),
      distancia_component: roundCurrency(distanceComponent),
      tempo_component: roundCurrency(timeComponent),
      dynamic_markup_value: roundCurrency(tarifaBase * dynamicMarkupRate),
      pickup_adjustment: roundCurrency(additionalPickup)
    }
  };
}

module.exports = {
  PRICING_CONSTANTS,
  calculateDynamicFare
};
