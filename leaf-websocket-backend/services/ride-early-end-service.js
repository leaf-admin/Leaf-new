/**
 * Detecta corridas encerradas longe do destino contratado.
 *
 * Encerrar antes do destino é permitido. O que este serviço faz é tornar o
 * fato explícito: o booking guarda a distância que faltava e o motivo
 * declarado pelo motorista, e o passageiro recebe o aviso para dizer se o
 * encerramento foi a pedido dele.
 *
 * `resolveRideEarlyEnd` só detecta. `resolveDriverEarlyEndSettlement` decide,
 * com dados que o servidor já tinha (telemetria da corrida e destino do
 * booking), se o encerramento feito pelo motorista deve ser liquidado pelo
 * trecho percorrido, com a mesma regra do encerramento pelo passageiro.
 *
 * Pedágio é repasse e nunca entra na proporção: a regra do trecho percorrido
 * vale para a tarifa sem o pedágio, e o pedágio contratado é cobrado inteiro.
 */

const DEFAULT_EARLY_END_DISTANCE_METERS = 500;
const DEFAULT_MAX_POSITION_AGE_SECONDS = 120;
const DRIVER_EARLY_END_COMPLETION_TYPE = 'EARLY_ENDED_BY_DRIVER';
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

function resolveMaxPositionAgeSeconds(env = process.env) {
  const parsed = Number.parseInt(env.RIDE_EARLY_END_MAX_POSITION_AGE_SECONDS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_POSITION_AGE_SECONDS;
}

function parseJsonField(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object') return rawValue;
  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return null;
  }
}

function hasConfirmedExtension(bookingData = {}) {
  const active = parseJsonField(bookingData.activeExtensionRequest);
  if (active && typeof active === 'object' && active.status === 'CONFIRMED') {
    return true;
  }
  const history = parseJsonField(bookingData.extensionHistory);
  return Array.isArray(history) && history.some((entry) => entry && entry.status === 'CONFIRMED');
}

function hasRideLegsOrContinuation(bookingData = {}) {
  const rideLegs = parseJsonField(bookingData.rideLegs);
  if (Array.isArray(rideLegs) && rideLegs.length > 0) {
    return true;
  }
  const continuation = parseJsonField(
    bookingData.operationalContinuation ||
      bookingData.operationalInterruption ||
      bookingData.reassignmentContext
  );
  return Boolean(continuation && typeof continuation === 'object');
}

function notApplied(reason, extra = {}) {
  return { applied: false, reason, ...extra };
}

function moneyToCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

/**
 * Decide se a finalização feita pelo motorista é um encerramento antecipado
 * a liquidar pelo trecho percorrido.
 *
 * Só usa dado confiável: a telemetria que o servidor recebeu durante a corrida
 * (última posição, distância e duração) e o destino/rota contratados no
 * booking. O que o app do motorista manda na finalização (`earlyEnd`,
 * `endLocation`, distância) não entra na conta: `driverStatement` só registra
 * o motivo declarado.
 *
 * Em qualquer dúvida devolve `applied: false` e a corrida segue como hoje
 * (valor integral, sem estorno automático).
 */
async function resolveDriverEarlyEndSettlement({
  redis,
  bookingId,
  driverId,
  bookingData = {},
  tollFee,
  driverStatement = null,
  nowMs = Date.now(),
  env = process.env
} = {}) {
  const { isDriverEarlyEndSettlementEnabled } = require('../utils/ride-lifecycle-feature-flags');
  if (!isDriverEarlyEndSettlementEnabled()) {
    return notApplied('DISABLED');
  }

  const destination = parseLocation(bookingData.destinationLocation || bookingData.destination);
  if (!destination) {
    return notApplied('DESTINATION_UNAVAILABLE');
  }

  const tripLocationPersistenceService = require('./trip-location-persistence-service');
  if (typeof tripLocationPersistenceService.resolveCanonicalTripMetrics !== 'function') {
    return notApplied('TRUSTED_POSITION_UNAVAILABLE');
  }

  const startLocation = parseLocation(bookingData.startLocation || bookingData.pickupLocation);
  const metrics = await tripLocationPersistenceService.resolveCanonicalTripMetrics({
    redis,
    tripId: bookingId,
    driverId,
    startedAt: bookingData.startedAt || null,
    startLocation,
    nowMs,
    allowPreStartTelemetry: true
  });
  const trustedPosition = metrics?.success ? parseLocation(metrics.endLocation) : null;
  if (!trustedPosition) {
    return notApplied('TRUSTED_POSITION_UNAVAILABLE');
  }

  const lastReceivedAtMs = Number(metrics.lastReceivedAtMs);
  const positionAgeSecs = Number.isFinite(lastReceivedAtMs)
    ? Math.max(0, Math.round((nowMs - lastReceivedAtMs) / 1000))
    : null;
  if (positionAgeSecs === null || positionAgeSecs > resolveMaxPositionAgeSeconds(env)) {
    return notApplied('TRUSTED_POSITION_STALE', { positionAgeSecs });
  }

  const earlyEnd = resolveRideEarlyEnd({
    endLocation: trustedPosition,
    destinationLocation: destination,
    driverStatement,
    env
  });
  if (!earlyEnd) {
    return notApplied('NEAR_DESTINATION');
  }

  // A partir daqui o servidor já sabe que a corrida terminou longe do destino.
  // Os casos abaixo têm regra financeira própria ou ainda não decidida e ficam
  // fora da liquidação automática.
  const detected = { earlyEnd, endLocation: trustedPosition, detected: true };
  if (hasRideLegsOrContinuation(bookingData)) {
    return notApplied('MULTI_LEG_RIDE', detected);
  }
  if (hasConfirmedExtension(bookingData)) {
    return notApplied('RIDE_EXTENSION', detected);
  }

  // O carro não pode ter andado menos que a linha reta entre o embarque e a
  // posição final: protege o motorista de uma trilha com pontos perdidos.
  const straightLineKm = startLocation ? distanceMeters(startLocation, trustedPosition) / 1000 : 0;
  const executedDistanceKm = Math.max(Number(metrics.distanceKm) || 0, straightLineKm);
  const executedDurationSecs = Math.max(0, Number(metrics.durationSecs) || 0);

  // Mesma conta do encerramento pelo passageiro, pedágio incluído.
  // Pedágio só das praças que a telemetria viu o carro cruzar.
  const { calculateRiderEarlyEndSettlement } = require('./ride-lifecycle-service');
  const { summarizeTollCrossings } = require('./route-toll-service');
  const proportionalSettlement = calculateRiderEarlyEndSettlement(bookingData, {
    distanceKm: executedDistanceKm,
    durationSecs: executedDurationSecs,
    tollCrossing: summarizeTollCrossings(metrics, { startedAtMs: Number(metrics.startedAtMs) || null })
  });

  // Sem distância contratada o progresso cairia para o mínimo de cobrança por
  // falta de dado, não porque o carro andou pouco.
  if (!(proportionalSettlement.originalDistanceKm > 0) || proportionalSettlement.distanceShare === null) {
    return notApplied('CONTRACTED_ROUTE_UNAVAILABLE', detected);
  }

  // O pedágio da conta é o contratado no booking. Se a finalização chegou com
  // outro valor de pedágio, o recibo e o snapshot não fechariam com a liquidação.
  const bookedTollFeeCents = moneyToCents(bookingData.tollFee);
  if (tollFee !== undefined && tollFee !== null && moneyToCents(tollFee) !== bookedTollFeeCents) {
    return notApplied('TOLL_AMOUNT_MISMATCH', detected);
  }

  // A regra do pedágio (pedágio cruzado + proporção da tarifa sem ele) já vem
  // aplicada pela conta compartilhada com o encerramento pelo passageiro.
  // Quando o pedágio não é menor que a tarifa a conta não fecha: não liquida.
  const baseSettlement = proportionalSettlement;
  if (baseSettlement.tollRuleSkippedReason === 'TOLL_NOT_BELOW_FARE') {
    return notApplied('TOLL_NOT_BELOW_FARE', detected);
  }
  if (!(baseSettlement.executedFare > 0) || !(baseSettlement.estimatedRefund > 0)) {
    return notApplied('NO_REFUND_DUE', detected);
  }

  return {
    applied: true,
    earlyEnd,
    endLocation: trustedPosition,
    settlement: {
      ...baseSettlement,
      settlementType: DRIVER_EARLY_END_COMPLETION_TYPE,
      initiatedBy: 'DRIVER',
      driverReason: earlyEnd.driverReason,
      remainingMeters: earlyEnd.remainingMeters,
      thresholdMeters: earlyEnd.thresholdMeters,
      metricsSource: metrics.source || 'server_trip_location_telemetry',
      telemetryPointsCount: Number(metrics.pointsCount) || 0,
      positionAgeSecs
    }
  };
}

module.exports = {
  DEFAULT_EARLY_END_DISTANCE_METERS,
  DEFAULT_MAX_POSITION_AGE_SECONDS,
  DRIVER_EARLY_END_COMPLETION_TYPE,
  resolveRideEarlyEnd,
  resolveDriverEarlyEndSettlement
};
