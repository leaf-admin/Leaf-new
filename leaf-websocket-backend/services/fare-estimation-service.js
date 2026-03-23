const { logStructured } = require('../utils/logger');

const RATE_CARDS = {
  leaf_plus: {
    minFare: 8.5,
    baseFare: 2.79,
    fixedFee: 1.1,
    ratePerHour: 15.6,
    ratePerKm: 1.53
  },
  leaf_elite: {
    minFare: 10.5,
    baseFare: 4.98,
    fixedFee: 1.8,
    ratePerHour: 17.4,
    ratePerKm: 2.41
  },
  leaf_moto: {
    minFare: 6.9,
    baseFare: 2.18,
    fixedFee: 0.86,
    ratePerHour: 12.17,
    ratePerKm: 1.19
  }
};

const DEFAULT_CAR_TYPE = 'leaf_plus';
const MAX_FARE = 10000;

function toNumber(value, fallback = 0) {
  const parsed = Number(
    typeof value === 'string'
      ? value.replace(',', '.')
      : value
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Number(Math.max(0, value).toFixed(2));
}

function normalizeCarType(carType) {
  const normalized = String(carType || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!normalized) return DEFAULT_CAR_TYPE;
  if (normalized.includes('moto')) return 'leaf_moto';
  if (normalized.includes('elite')) return 'leaf_elite';
  if (normalized.includes('plus')) return 'leaf_plus';
  if (normalized === 'type_moto') return 'leaf_moto';
  if (normalized === 'type3') return 'leaf_elite';
  if (normalized === 'type1') return 'leaf_plus';
  return DEFAULT_CAR_TYPE;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function buildFallbackRouteMetrics({ pickupLocation, destinationLocation }) {
  const pickupLat = toNumber(pickupLocation?.lat, NaN);
  const pickupLng = toNumber(pickupLocation?.lng, NaN);
  const destinationLat = toNumber(destinationLocation?.lat, NaN);
  const destinationLng = toNumber(destinationLocation?.lng, NaN);

  if (
    !Number.isFinite(pickupLat) ||
    !Number.isFinite(pickupLng) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    return {
      distanceKm: 0.8,
      durationSecs: 120,
      source: 'fallback_default'
    };
  }

  const straightDistanceKm = haversineDistanceKm(
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng
  );
  const normalizedStraightDistance = Number.isFinite(straightDistanceKm) && straightDistanceKm > 0
    ? straightDistanceKm
    : 0.8;
  const routeDistanceKm = Math.max(0.8, Number((normalizedStraightDistance * 1.25).toFixed(2)));
  const avgSpeedKmH = 28;
  const timeInSecs = Math.max(120, Math.round((routeDistanceKm / avgSpeedKmH) * 3600));

  return {
    distanceKm: routeDistanceKm,
    durationSecs: timeInSecs,
    source: 'fallback_haversine'
  };
}

function calculateFareWithRateCard({ distanceKm, durationSecs, tollFee, rateCard }) {
  const distanceFare = distanceKm * rateCard.ratePerKm;
  const timeFare = (durationSecs / 3600) * rateCard.ratePerHour;
  const subtotal = rateCard.baseFare + rateCard.fixedFee + distanceFare + timeFare;
  const clampedSubtotal = Math.max(rateCard.minFare, subtotal);
  const total = clampedSubtotal + Math.max(0, tollFee);
  return roundCurrency(Math.min(MAX_FARE, total));
}

function estimateRideFare({
  pickupLocation,
  destinationLocation,
  carType,
  routeDistanceKm,
  routeDurationSecs,
  tollFee,
  clientEstimatedFare
}) {
  const normalizedCarType = normalizeCarType(carType);
  const rateCard = RATE_CARDS[normalizedCarType] || RATE_CARDS[DEFAULT_CAR_TYPE];

  const providedDistanceKm = toNumber(routeDistanceKm, 0);
  const providedDurationSecs = toNumber(routeDurationSecs, 0);
  const hasProvidedRouteMetrics = providedDistanceKm > 0 && providedDurationSecs > 0;

  const fallbackMetrics = buildFallbackRouteMetrics({
    pickupLocation,
    destinationLocation
  });

  const effectiveDistanceKm = hasProvidedRouteMetrics ? providedDistanceKm : fallbackMetrics.distanceKm;
  const effectiveDurationSecs = hasProvidedRouteMetrics ? providedDurationSecs : fallbackMetrics.durationSecs;
  const effectiveTollFee = toNumber(tollFee, 0);

  const estimatedFare = calculateFareWithRateCard({
    distanceKm: effectiveDistanceKm,
    durationSecs: effectiveDurationSecs,
    tollFee: effectiveTollFee,
    rateCard
  });

  const clientFare = toNumber(clientEstimatedFare, 0);
  const fareDiff = roundCurrency(Math.abs(clientFare - estimatedFare));

  if (clientFare > 0 && fareDiff >= 1) {
    logStructured('warn', 'Divergência entre tarifa cliente e tarifa servidor', {
      service: 'fare-estimation-service',
      carType: normalizedCarType,
      clientFare,
      serverFare: estimatedFare,
      fareDiff,
      routeMetricsSource: hasProvidedRouteMetrics ? 'client_route_metrics' : fallbackMetrics.source
    });
  }

  return {
    estimatedFare,
    normalizedCarType,
    routeMetrics: {
      distanceKm: roundCurrency(effectiveDistanceKm),
      durationSecs: Math.max(0, Math.round(effectiveDurationSecs)),
      source: hasProvidedRouteMetrics ? 'client_route_metrics' : fallbackMetrics.source
    },
    tollFee: roundCurrency(effectiveTollFee),
    clientFare: roundCurrency(clientFare),
    fareDiff
  };
}

module.exports = {
  estimateRideFare,
  normalizeCarType,
  RATE_CARDS
};
