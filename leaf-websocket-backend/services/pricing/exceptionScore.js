const { clamp, normalizeRange, safeDivide } = require('./utils');

const SPIKE_DEMANDA_BREAKPOINTS = [
  { x: 1.10, y: 0 },
  { x: 1.25, y: 0.2 },
  { x: 1.50, y: 0.5 },
  { x: 1.80, y: 0.75 },
  { x: 2.20, y: 1 }
];

const QUEDA_OFERTA_BREAKPOINTS = [
  { x: 0.05, y: 0 },
  { x: 0.15, y: 0.2 },
  { x: 0.30, y: 0.5 },
  { x: 0.45, y: 0.8 },
  { x: 0.60, y: 1 }
];

const EXPLOSAO_ETA_BREAKPOINTS = [
  { x: 1.10, y: 0 },
  { x: 1.30, y: 0.2 },
  { x: 1.50, y: 0.5 },
  { x: 1.80, y: 0.8 },
  { x: 2.20, y: 1 }
];

const QUEBRA_VELOCIDADE_BREAKPOINTS = [
  { x: 0.05, y: 0 },
  { x: 0.15, y: 0.2 },
  { x: 0.25, y: 0.5 },
  { x: 0.40, y: 0.8 },
  { x: 0.55, y: 1 }
];

const RUPTURA_CANCELAMENTO_BREAKPOINTS = [
  { x: 1.10, y: 0 },
  { x: 1.50, y: 0.2 },
  { x: 2.00, y: 0.5 },
  { x: 2.50, y: 0.8 },
  { x: 3.00, y: 1 }
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {{active_requests_5m?:number, idle_drivers?:number, avg_pickup_eta_min?:number, avg_speed_kmh?:number, cancel_rate?:number}} current
 * @param {{expected_requests_5m?:number, expected_idle_drivers?:number, expected_pickup_eta_min?:number, expected_speed_kmh?:number, expected_cancel_rate?:number}} baseline
 */
function calculateExceptionScore(current = {}, baseline = {}) {
  const activeRequests = Math.max(0, toNumber(current.active_requests_5m, 0));
  const idleDrivers = Math.max(0, toNumber(current.idle_drivers, 0));
  const avgPickupEtaMin = Math.max(0, toNumber(current.avg_pickup_eta_min, 0));
  const avgSpeedKmh = Math.max(0, toNumber(current.avg_speed_kmh, 0));
  const cancelRate = clamp(toNumber(current.cancel_rate, 0), 0, 1);

  const expectedRequests = Math.max(1, toNumber(baseline.expected_requests_5m, activeRequests || 1));
  const expectedIdleDrivers = Math.max(1, toNumber(baseline.expected_idle_drivers, idleDrivers || 1));
  const expectedPickupEtaMin = Math.max(1, toNumber(baseline.expected_pickup_eta_min, avgPickupEtaMin || 1));
  const expectedSpeedKmh = Math.max(1, toNumber(baseline.expected_speed_kmh, avgSpeedKmh || 1));
  const expectedCancelRate = Math.max(0.01, toNumber(baseline.expected_cancel_rate, cancelRate || 0.01));

  const ratioDemanda = safeDivide(activeRequests, expectedRequests, 0);
  const quedaOferta = Math.max(0, 1 - safeDivide(idleDrivers, expectedIdleDrivers, 1));
  const etaRatio = safeDivide(avgPickupEtaMin, expectedPickupEtaMin, 0);
  const speedDrop = Math.max(0, 1 - safeDivide(avgSpeedKmh, expectedSpeedKmh, 1));
  const cancelRatio = safeDivide(cancelRate, expectedCancelRate, 0);

  const spikeDemandaNorm = normalizeRange(ratioDemanda, SPIKE_DEMANDA_BREAKPOINTS);
  const quedaOfertaNorm = normalizeRange(quedaOferta, QUEDA_OFERTA_BREAKPOINTS);
  const explosaoEtaNorm = normalizeRange(etaRatio, EXPLOSAO_ETA_BREAKPOINTS);
  const quebraVelocidadeNorm = normalizeRange(speedDrop, QUEBRA_VELOCIDADE_BREAKPOINTS);
  const rupturaCancelamentoNorm = normalizeRange(cancelRatio, RUPTURA_CANCELAMENTO_BREAKPOINTS);

  const score = clamp(
    (0.30 * spikeDemandaNorm)
      + (0.25 * quedaOfertaNorm)
      + (0.20 * explosaoEtaNorm)
      + (0.15 * quebraVelocidadeNorm)
      + (0.10 * rupturaCancelamentoNorm)
  );

  return {
    score,
    breakdown: {
      spike_demanda_norm: spikeDemandaNorm,
      queda_oferta_norm: quedaOfertaNorm,
      explosao_eta_norm: explosaoEtaNorm,
      quebra_velocidade_norm: quebraVelocidadeNorm,
      ruptura_cancelamento_norm: rupturaCancelamentoNorm,
      ratio_demanda: ratioDemanda,
      queda_oferta: quedaOferta,
      eta_ratio: etaRatio,
      speed_drop: speedDrop,
      cancel_ratio: cancelRatio
    }
  };
}

module.exports = {
  calculateExceptionScore
};
