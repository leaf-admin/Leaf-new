/**
 * Sinal de "tarifa acima do normal" para o passageiro (cotação) e para o motorista (oferta).
 *
 * Não calcula preço: só resume o que o motor de tarifa já aplicou, para a interface avisar
 * quando a tarifa está 10% ou mais acima do normal e dizer por quê. Clima não entra: o
 * sistema não tem fonte de dados de clima.
 */

const ABOVE_NORMAL_THRESHOLD_PERCENT = 10;

const LEVELS = Object.freeze([
  { level: 'very_high', minPercent: 30 },
  { level: 'high', minPercent: 20 },
  { level: 'moderate', minPercent: ABOVE_NORMAL_THRESHOLD_PERCENT }
]);

const REASON_LABELS = Object.freeze({
  demand: 'alta demanda na região',
  traffic: 'trânsito intenso',
  night: 'tarifa noturna'
});

function toPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function resolveLevel(percent) {
  const match = LEVELS.find((entry) => percent >= entry.minPercent);
  return match ? match.level : 'normal';
}

function buildFareSignal({
  dynamicPercent = 0,
  nightPercent = 0,
  trafficAdjusted = false,
  demandPercent = 0,
  demandSupplyRatioNorm = 0,
  pricingModelMode = 'dry_run'
} = {}) {
  const dynamic = toPercent(dynamicPercent);
  const night = toPercent(nightPercent);
  const percent = Math.round(dynamic + night);
  const level = resolveLevel(percent);

  const reasons = [];
  const demandDriven = pricingModelMode === 'active'
    ? toPercent(demandPercent) > 0
    : toPercent(demandPercent) > 0 || toPercent(demandSupplyRatioNorm) > 0;
  if (dynamic > 0 && demandDriven) reasons.push('demand');
  if (trafficAdjusted) reasons.push('traffic');
  if (night > 0) reasons.push('night');

  const aboveNormal = percent >= ABOVE_NORMAL_THRESHOLD_PERCENT;
  return {
    percent,
    level,
    above_normal: aboveNormal,
    threshold_percent: ABOVE_NORMAL_THRESHOLD_PERCENT,
    reasons: aboveNormal ? reasons : [],
    reason_labels: aboveNormal ? reasons.map((reason) => REASON_LABELS[reason]) : []
  };
}

module.exports = {
  ABOVE_NORMAL_THRESHOLD_PERCENT,
  REASON_LABELS,
  buildFareSignal
};
