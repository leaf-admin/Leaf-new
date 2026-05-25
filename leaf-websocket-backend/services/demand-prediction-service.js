'use strict';

const MODEL_VERSION = 'leaf-demand-v0.1-heuristic';

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCurrent(current = {}) {
  const openRequests = Math.max(
    0,
    toNumber(
      current.openRequests ??
        current.pendingRequests ??
        current.activeRequests ??
        current.demand,
      0
    )
  );
  const availableDrivers = Math.max(
    0,
    toNumber(
      current.availableDrivers ??
        current.idleDrivers ??
        current.supply ??
        current.onlineDrivers,
      0
    )
  );
  const busyDrivers = Math.max(0, toNumber(current.busyDrivers, 0));
  const requestRate15m = Math.max(
    0,
    toNumber(current.requestRate15m ?? current.requestsLast15m, openRequests)
  );
  const avgPickupEtaMin = Math.max(
    0,
    toNumber(current.avgPickupEtaMin ?? current.averagePickupEtaMin, 0)
  );

  return {
    openRequests,
    availableDrivers,
    busyDrivers,
    requestRate15m,
    avgPickupEtaMin
  };
}

function normalizeBaseline(baseline = {}, current = {}) {
  const expectedRequests15m = Math.max(
    1,
    toNumber(
      baseline.expectedRequests15m ??
        baseline.requests15m ??
        baseline.avgRequests15m,
      Math.max(1, current.requestRate15m || current.openRequests || 1)
    )
  );
  const expectedAvailableDrivers = Math.max(
    1,
    toNumber(
      baseline.expectedAvailableDrivers ??
        baseline.availableDrivers ??
        baseline.avgAvailableDrivers,
      Math.max(1, current.availableDrivers || 1)
    )
  );

  return {
    expectedRequests15m,
    expectedAvailableDrivers
  };
}

function resolveDemandLevel(score) {
  if (score >= 0.82) return 'critical';
  if (score >= 0.64) return 'high';
  if (score >= 0.38) return 'medium';
  return 'low';
}

function buildDriverPushRecommendation({ level, score, current, areaLabel }) {
  if (!['high', 'critical'].includes(level)) {
    return null;
  }

  const urgency =
    level === 'critical'
      ? 'Alta demanda agora'
      : 'Boa hora para ficar online';
  const place = areaLabel ? ` em ${areaLabel}` : '';

  return {
    audience: 'drivers',
    templateId: level === 'critical' ? 'driver_demand_critical' : 'driver_demand_high',
    priority: level === 'critical' ? 'high' : 'normal',
    title: urgency,
    body: `${current.openRequests} pedido(s) ativos${place}. Entre online para receber ofertas próximas.`,
    cooldownKey: `driver-demand:${areaLabel || 'unknown'}`,
    score: Number(score.toFixed(3))
  };
}

function buildPassengerPushRecommendation({ score, behavior = {}, areaLabel }) {
  const lastRideHoursAgo = toNumber(behavior.lastRideHoursAgo, NaN);
  const favoriteZoneMatch = behavior.favoriteZoneMatch === true;
  const optedIn = behavior.smartPushOptIn !== false;
  if (!optedIn || score < 0.5 || !Number.isFinite(lastRideHoursAgo) || lastRideHoursAgo < 12) {
    return null;
  }

  const place = areaLabel ? ` para ${areaLabel}` : '';
  return {
    audience: 'passengers',
    templateId: favoriteZoneMatch ? 'passenger_favorite_zone_active' : 'passenger_demand_window',
    priority: 'normal',
    title: favoriteZoneMatch ? 'Seu trajeto está em movimento' : 'Leaf disponível por perto',
    body: `Há sinais de demanda e motoristas ativos${place}. Pode ser uma boa janela para pedir sua corrida.`,
    cooldownKey: `passenger-demand:${behavior.userId || 'anonymous'}:${areaLabel || 'unknown'}`,
    score: Number(score.toFixed(3))
  };
}

function buildDemandPrediction(input = {}) {
  const current = normalizeCurrent(input.current || input);
  const baseline = normalizeBaseline(input.baseline || {}, current);
  const behavior = input.behavior || {};
  const areaLabel = input.areaLabel || input.h3 || input.city || null;

  const demandRatio = clamp(current.requestRate15m / baseline.expectedRequests15m, 0, 3) / 3;
  const supplyRatio = clamp(
    baseline.expectedAvailableDrivers / Math.max(1, current.availableDrivers),
    0,
    4
  ) / 4;
  const openRequestPressure = clamp(
    current.openRequests / Math.max(1, current.availableDrivers + current.openRequests),
    0,
    1
  );
  const etaPressure = clamp(current.avgPickupEtaMin / 12, 0, 1);
  const behaviorBoost =
    behavior.favoriteZoneMatch === true || behavior.recentDemandMatch === true ? 0.05 : 0;

  const score = clamp(
    demandRatio * 0.32 +
      supplyRatio * 0.26 +
      openRequestPressure * 0.28 +
      etaPressure * 0.09 +
      behaviorBoost,
    0,
    1
  );
  const level = resolveDemandLevel(score);

  const driverPush = buildDriverPushRecommendation({
    level,
    score,
    current,
    areaLabel
  });
  const passengerPush = buildPassengerPushRecommendation({
    score,
    behavior,
    areaLabel
  });

  return {
    modelVersion: MODEL_VERSION,
    generatedAt: input.generatedAt || new Date().toISOString(),
    area: {
      h3: input.h3 || null,
      city: input.city || null,
      label: areaLabel
    },
    current,
    baseline,
    score: Number(score.toFixed(3)),
    level,
    features: {
      demandRatio: Number((demandRatio * 3).toFixed(3)),
      supplyRatio: Number((supplyRatio * 4).toFixed(3)),
      openRequestPressure: Number(openRequestPressure.toFixed(3)),
      etaPressure: Number(etaPressure.toFixed(3)),
      behaviorBoost
    },
    smartPush: {
      allowed: Boolean(driverPush || passengerPush),
      recommendations: [driverPush, passengerPush].filter(Boolean)
    }
  };
}

module.exports = {
  MODEL_VERSION,
  buildDemandPrediction,
  normalizeCurrent,
  normalizeBaseline,
  resolveDemandLevel
};
