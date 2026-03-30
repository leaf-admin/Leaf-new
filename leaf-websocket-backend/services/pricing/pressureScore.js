const { clamp, normalizeRange } = require('./utils');

const DEMAND_SUPPLY_BREAKPOINTS = [
  { x: 0.8, y: 0 },
  { x: 1.0, y: 0.2 },
  { x: 1.5, y: 0.6 },
  { x: 2.0, y: 0.85 },
  { x: 3.0, y: 1 }
];

const PICKUP_ETA_BREAKPOINTS = [
  { x: 3, y: 0 },
  { x: 4, y: 0.2 },
  { x: 5, y: 0.4 },
  { x: 6, y: 0.6 },
  { x: 8, y: 0.85 },
  { x: 10, y: 1 }
];

const TRAFFIC_INFLATION_BREAKPOINTS = [
  { x: 1.0, y: 0 },
  { x: 1.1, y: 0.2 },
  { x: 1.2, y: 0.4 },
  { x: 1.3, y: 0.6 },
  { x: 1.45, y: 0.85 },
  { x: 1.6, y: 1 }
];

const CANCEL_RATE_BREAKPOINTS = [
  { x: 0.05, y: 0 },
  { x: 0.08, y: 0.2 },
  { x: 0.12, y: 0.5 },
  { x: 0.18, y: 0.8 },
  { x: 0.25, y: 1 }
];

const LOW_ACCEPTANCE_BREAKPOINTS = [
  { x: 0.10, y: 0 },
  { x: 0.20, y: 0.25 },
  { x: 0.30, y: 0.5 },
  { x: 0.45, y: 0.8 },
  { x: 0.60, y: 1 }
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {{active_requests_5m?:number, idle_drivers?:number, avg_pickup_eta_min?:number, trip_time_inflation?:number, cancel_rate?:number, accept_rate?:number}} input
 */
function calculatePressureScore(input = {}) {
  const activeRequests = Math.max(0, toNumber(input.active_requests_5m, 0));
  const idleDrivers = Math.max(0, toNumber(input.idle_drivers, 0));
  const avgPickupEtaMin = Math.max(0, toNumber(input.avg_pickup_eta_min, 0));
  const tripTimeInflation = Math.max(0, toNumber(input.trip_time_inflation, 1));
  const cancelRate = clamp(toNumber(input.cancel_rate, 0), 0, 1);
  const acceptRate = clamp(toNumber(input.accept_rate, 1), 0, 1);

  const demandSupplyRatio = activeRequests / Math.max(idleDrivers, 1);
  const demandSupplyRatioNorm = normalizeRange(demandSupplyRatio, DEMAND_SUPPLY_BREAKPOINTS);
  const pickupEtaNorm = normalizeRange(avgPickupEtaMin, PICKUP_ETA_BREAKPOINTS);
  const tripTimeInflationNorm = normalizeRange(tripTimeInflation, TRAFFIC_INFLATION_BREAKPOINTS);
  const cancelRateNorm = normalizeRange(cancelRate, CANCEL_RATE_BREAKPOINTS);
  const lowAcceptanceNorm = normalizeRange(clamp(1 - acceptRate), LOW_ACCEPTANCE_BREAKPOINTS);

  const score = clamp(
    (0.35 * demandSupplyRatioNorm)
      + (0.20 * pickupEtaNorm)
      + (0.25 * tripTimeInflationNorm)
      + (0.10 * cancelRateNorm)
      + (0.10 * lowAcceptanceNorm)
  );

  return {
    score,
    breakdown: {
      demand_supply_ratio: demandSupplyRatio,
      demand_supply_ratio_norm: demandSupplyRatioNorm,
      pickup_eta_norm: pickupEtaNorm,
      trip_time_inflation_norm: tripTimeInflationNorm,
      cancel_rate_norm: cancelRateNorm,
      low_acceptance_norm: lowAcceptanceNorm
    }
  };
}

module.exports = {
  calculatePressureScore
};
