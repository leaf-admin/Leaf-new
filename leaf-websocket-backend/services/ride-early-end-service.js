/**
 * Detecta corridas encerradas longe do destino contratado.
 *
 * Encerrar antes do destino é permitido. O que este serviço faz é tornar o
 * fato explícito: o booking guarda a distância que faltava e o motivo
 * declarado pelo motorista, e o passageiro recebe o aviso para dizer se o
 * encerramento foi a pedido dele. Não altera valor, repasse nem estorno.
 */

const DEFAULT_EARLY_END_DISTANCE_METERS = 500;
const DRIVER_REASONS = new Set(['passenger_request', 'trip_problem']);
const EARTH_RADIUS_METERS = 6371000;

function resolveThresholdMeters(env = process.env) {
  const parsed = Number.parseInt(env.RIDE_EARLY_END_DISTANCE_METERS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EARLY_END_DISTANCE_METERS;
}

function parseLocation(rawValue) {
  let candidate = rawValue;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch (_error) {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const lat = Number(candidate.lat ?? candidate.latitude);
  const lng = Number(candidate.lng ?? candidate.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return null;
  }
  return { lat, lng };
}

function distanceMeters(from, to) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function resolveRideEarlyEnd({
  endLocation,
  destinationLocation,
  driverStatement = null,
  env = process.env
} = {}) {
  const end = parseLocation(endLocation);
  const destination = parseLocation(destinationLocation);
  if (!end || !destination) {
    return null;
  }

  const thresholdMeters = resolveThresholdMeters(env);
  const remainingMeters = Math.round(distanceMeters(end, destination));
  if (remainingMeters <= thresholdMeters) {
    return null;
  }

  const statedReason = String(driverStatement?.reason || '').trim().toLowerCase();
  return {
    detected: true,
    remainingMeters,
    thresholdMeters,
    driverReason: DRIVER_REASONS.has(statedReason) ? statedReason : null
  };
}

module.exports = {
  DEFAULT_EARLY_END_DISTANCE_METERS,
  resolveRideEarlyEnd
};
