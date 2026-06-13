const { clamp, normalizeRange } = require('./utils');

const MAX_DEMAND_MARKUP_PERCENT = 35;

const DEMAND_SUPPLY_BREAKPOINTS = [
  { x: 0.8, y: 0 },
  { x: 1.0, y: 0.2 },
  { x: 1.5, y: 0.6 },
  { x: 2.0, y: 0.85 },
  { x: 3.0, y: 1 }
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateDemandPressure(input = {}) {
  const demand = Math.max(
    0,
    toNumber(
      input.active_requests_5m
        ?? input.open_requests
        ?? input.openRequests
        ?? input.demand,
      0
    )
  );
  const availableDrivers = Math.max(
    0,
    toNumber(
      input.idle_drivers
        ?? input.available_drivers
        ?? input.availableDrivers,
      0
    )
  );

  if (demand <= 0) {
    return {
      score: 0,
      percent: 0,
      markupRate: 0,
      multiplier: 1,
      level: 'normal',
      breakdown: {
        demand,
        available_drivers: availableDrivers,
        demand_supply_ratio: 0,
        demand_supply_ratio_norm: 0,
        shortage: 0,
        shortage_norm: 0,
        demand_volume_norm: 0
      }
    };
  }

  const demandSupplyRatio = demand / Math.max(availableDrivers, 1);
  const demandSupplyRatioNorm = normalizeRange(
    demandSupplyRatio,
    DEMAND_SUPPLY_BREAKPOINTS
  );
  const shortage = Math.max(0, demand - availableDrivers);
  const shortageNorm = clamp(shortage / 6, 0, 1);
  const demandVolumeNorm = clamp(demand / 8, 0, 1);
  const score = clamp(
    (0.8 * demandSupplyRatioNorm)
      + (0.2 * shortageNorm),
    0,
    1
  );
  const percent = Math.min(
    MAX_DEMAND_MARKUP_PERCENT,
    Math.max(0, Math.round(score * MAX_DEMAND_MARKUP_PERCENT))
  );

  let level = 'yellow';
  if (percent >= 25) level = 'purple';
  else if (percent >= 13) level = 'red';
  if (percent <= 0) level = 'normal';

  return {
    score,
    percent,
    markupRate: percent / 100,
    multiplier: Number((1 + percent / 100).toFixed(2)),
    level,
    breakdown: {
      demand,
      available_drivers: availableDrivers,
      demand_supply_ratio: Number(demandSupplyRatio.toFixed(3)),
      demand_supply_ratio_norm: Number(demandSupplyRatioNorm.toFixed(3)),
      shortage,
      shortage_norm: Number(shortageNorm.toFixed(3)),
      demand_volume_norm: Number(demandVolumeNorm.toFixed(3))
    }
  };
}

module.exports = {
  MAX_DEMAND_MARKUP_PERCENT,
  calculateDemandPressure
};
