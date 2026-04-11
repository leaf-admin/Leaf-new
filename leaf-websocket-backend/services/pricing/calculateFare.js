const { clamp, roundCurrency } = require('./utils');

const RATE_CARD_VERSION = process.env.PRICING_RATE_CARD_VERSION || 'leaf-go-live-2026-04-10-v1';

const DYNAMIC_PRICING_DEFAULTS = {
  pickup_grace_min: 4,
  pickup_increment: 0.4,
  pickup_cap: 2.5,
  max_dynamic_markup: 0.35,
  score_pressao_weight: 0.15,
  score_excecao_weight: 0.20
};

const CANONICAL_RATE_CARDS = Object.freeze({
  leaf_plus: Object.freeze({
    car_type: 'leaf_plus',
    display_name: 'Leaf Plus',
    rate_card_version: RATE_CARD_VERSION,
    preco_base: 2.79,
    taxa_fixa: 1.10,
    valor_km: 1.53,
    valor_min: 0.26,
    valor_minimo: 8.50,
    ...DYNAMIC_PRICING_DEFAULTS
  }),
  leaf_elite: Object.freeze({
    car_type: 'leaf_elite',
    display_name: 'Leaf Elite',
    rate_card_version: RATE_CARD_VERSION,
    preco_base: 4.98,
    taxa_fixa: 1.80,
    valor_km: 2.41,
    valor_min: 0.29,
    valor_minimo: 10.50,
    ...DYNAMIC_PRICING_DEFAULTS
  }),
  leaf_moto: Object.freeze({
    car_type: 'leaf_moto',
    display_name: 'Leaf Moto',
    rate_card_version: RATE_CARD_VERSION,
    preco_base: 0.60,
    taxa_fixa: 0.80,
    valor_km: 0.99,
    valor_min: 0.13,
    valor_minimo: 4.00,
    ...DYNAMIC_PRICING_DEFAULTS
  })
});

const PRICING_CONSTANTS = CANONICAL_RATE_CARDS.leaf_plus;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCarType(carType) {
  const normalized = String(carType || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!normalized) return 'leaf_plus';
  if (normalized.includes('moto') || normalized === 'type_moto') return 'leaf_moto';
  if (normalized.includes('elite') || normalized === 'type3') return 'leaf_elite';
  if (normalized.includes('plus') || normalized === 'type1') return 'leaf_plus';
  return 'leaf_plus';
}

function getRateCard(carType) {
  return CANONICAL_RATE_CARDS[normalizeCarType(carType)] || CANONICAL_RATE_CARDS.leaf_plus;
}

function getPublicRateCards() {
  return Object.values(CANONICAL_RATE_CARDS).map((rateCard) => ({
    carType: rateCard.car_type,
    displayName: rateCard.display_name,
    version: rateCard.rate_card_version,
    baseFare: roundCurrency(rateCard.preco_base),
    fixedFee: roundCurrency(rateCard.taxa_fixa),
    ratePerKm: roundCurrency(rateCard.valor_km),
    ratePerMin: roundCurrency(rateCard.valor_min),
    ratePerHour: roundCurrency(rateCard.valor_min * 60),
    minFare: roundCurrency(rateCard.valor_minimo)
  }));
}

/**
 * @param {{distance_km?:number, duration_min_traffic?:number, eta_pickup_min?:number, score_pressao?:number, score_excecao?:number, carType?:string}} input
 */
function calculateDynamicFare(input = {}) {
  const rateCard = getRateCard(input.carType || input.car_type || input.serviceCategory || input.category);
  const distanceKm = Math.max(0, toNumber(input.distance_km, 0));
  const durationMinTraffic = Math.max(0, toNumber(input.duration_min_traffic, 0));
  const etaPickupMin = Math.max(0, toNumber(input.eta_pickup_min, 0));
  const scorePressao = clamp(input.score_pressao, 0, 1);
  const scoreExcecao = clamp(input.score_excecao, 0, 1);

  const distanceComponent = distanceKm * rateCard.valor_km;
  const timeComponent = durationMinTraffic * rateCard.valor_min;
  const tarifaBase = rateCard.preco_base + rateCard.taxa_fixa + distanceComponent + timeComponent;

  const dynamicMarkupRate = Math.min(
    rateCard.max_dynamic_markup,
    (rateCard.score_pressao_weight * scorePressao) + (rateCard.score_excecao_weight * scoreExcecao)
  );
  const fatorDinamico = 1 + dynamicMarkupRate;
  const additionalPickup = Math.min(
    rateCard.pickup_cap,
    Math.max(0, etaPickupMin - rateCard.pickup_grace_min) * rateCard.pickup_increment
  );
  const subtotalWithDynamic = (tarifaBase * fatorDinamico) + additionalPickup;
  const minimumFareApplied = subtotalWithDynamic < rateCard.valor_minimo;
  const finalPrice = Math.max(rateCard.valor_minimo, subtotalWithDynamic);

  return {
    car_type: rateCard.car_type,
    rate_card_version: rateCard.rate_card_version,
    tarifa_base: roundCurrency(tarifaBase),
    fator_dinamico: Number(fatorDinamico.toFixed(4)),
    percentual_dinamico_aplicado: roundCurrency(dynamicMarkupRate * 100),
    adicional_pickup: roundCurrency(additionalPickup),
    preco_final: roundCurrency(finalPrice),
    valor_minimo_aplicado: minimumFareApplied,
    breakdown: {
      preco_base: roundCurrency(rateCard.preco_base),
      taxa_fixa: roundCurrency(rateCard.taxa_fixa),
      valor_km: roundCurrency(rateCard.valor_km),
      valor_min: roundCurrency(rateCard.valor_min),
      valor_minimo: roundCurrency(rateCard.valor_minimo),
      distancia_component: roundCurrency(distanceComponent),
      tempo_component: roundCurrency(timeComponent),
      dynamic_markup_value: roundCurrency(tarifaBase * dynamicMarkupRate),
      pickup_adjustment: roundCurrency(additionalPickup)
    }
  };
}

module.exports = {
  RATE_CARD_VERSION,
  CANONICAL_RATE_CARDS,
  PRICING_CONSTANTS,
  normalizeCarType,
  getRateCard,
  getPublicRateCards,
  calculateDynamicFare
};
