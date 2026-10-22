/**
 * Avisos do passageiro nas mudanças de fase da corrida.
 *
 * Só o aceite avisava o passageiro. Chegada e início não: com o app em segundo plano a
 * Live Activity (iOS) e a notificação de corrida (Android) ficavam paradas em "a caminho",
 * e o passageiro não sabia que o motorista já estava na porta.
 *
 * Cada estado tem um aviso visível (alert) próprio. O toque abre a tela da corrida
 * (RobotaxiPrototypeTrip, rota permitida em mobile-app FCMNotificationService).
 */
const { logger } = require('../utils/logger');

const PASSENGER_TRIP_SCREEN = 'RobotaxiPrototypeTrip';
const BOARDING_TIME_ZONE = 'America/Sao_Paulo';
const ACCEPTED_BOOKING_READ_ATTEMPTS = 3;
const ACCEPTED_BOOKING_READ_DELAY_MS = 200;

const boardingTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BOARDING_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function parseLocation(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) || {};
  } catch (error) {
    return {};
  }
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function buildVehicleLine(bookingData = {}) {
  return [
    firstText(bookingData.vehicleModel, bookingData.driverVehicleModel, bookingData.carModel),
    firstText(bookingData.vehiclePlate, bookingData.driverVehiclePlate, bookingData.plate)
  ].filter(Boolean).join(' · ');
}

function readDestinationAddress(bookingData = {}) {
  const destination = parseLocation(bookingData.destinationLocation || bookingData.destination);
  return firstText(destination.address, destination.add, bookingData.destinationAddress);
}

// "Rua X, 123 - Bairro, Rio" -> "Rua X"
function shortAddress(address) {
  return String(address || '').split(/,| - /)[0].trim();
}

// "14:32" no fuso de Brasília, ou '' se a data não for válida.
function formatBoardingDeadline(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return boardingTimeFormatter.format(date);
}

function formatEtaMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  return String(Math.max(1, Math.round(minutes)));
}

function buildPassengerStatusPayload({ bookingId, status, bookingData = {} } = {}) {
  const pickup = parseLocation(bookingData.pickupLocation || bookingData.pickup);
  const destination = parseLocation(bookingData.destinationLocation || bookingData.destination);
  return {
    bookingId: String(bookingId || ''),
    status: String(status || ''),
    userType: 'customer',
    driverName: firstText(bookingData.driverName, bookingData.driverDisplayName),
    pickup: { address: firstText(pickup.address, pickup.add, bookingData.pickupAddress) },
    destination: { address: firstText(destination.address, destination.add, bookingData.destinationAddress) },
    estimatedTime: firstText(bookingData.estimatedDurationMin, bookingData.estimatedTime),
    distance: firstText(bookingData.distance, bookingData.estimatedDistanceKm),
    fare: firstText(bookingData.estimatedFare, bookingData.fare)
  };
}

/**
 * Lê os dados do motorista gravados no aceite. A publicação do evento pode vencer a
 * gravação do estado canônico, então tenta algumas vezes antes de desistir (sem custo externo).
 */
async function loadAcceptedBookingData(redis, bookingId) {
  if (!redis || !bookingId) return {};
  let data = {};
  for (let attempt = 1; attempt <= ACCEPTED_BOOKING_READ_ATTEMPTS; attempt += 1) {
    data = (await redis.hgetall(`booking:${bookingId}`)) || {};
    if (data.driverName || data.vehicleModel || data.vehiclePlate) return data;
    if (attempt < ACCEPTED_BOOKING_READ_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, ACCEPTED_BOOKING_READ_DELAY_MS));
    }
  }
  return data;
}

// "Ana está a caminho" · "Onix prata · ABC1D23 · chega em ~4 min"
function buildRideAcceptedPush({ bookingId, driverId, bookingData = {} } = {}) {
  const driverName = firstText(bookingData.driverName, bookingData.driverDisplayName);
  const firstName = driverName.split(/\s+/)[0] || '';
  const vehicle = [
    firstText(bookingData.vehicleModel, bookingData.driverVehicleModel, bookingData.carModel),
    firstText(bookingData.vehicleColor, bookingData.driverVehicleColor)
  ].filter(Boolean).join(' ');
  const plate = firstText(bookingData.vehiclePlate, bookingData.driverVehiclePlate, bookingData.plate);
  const eta = formatEtaMinutes(bookingData.estimatedArrivalToPickupMin);
  const parts = [vehicle, plate, eta ? `chega em ~${eta} min` : ''].filter(Boolean);
  return {
    title: firstName ? `${firstName} está a caminho` : 'Motorista a caminho',
    body: parts.join(' · ') || 'Um motorista aceitou sua corrida.',
    collapseKey: `leaf-ride-accepted-${bookingId}`,
    data: {
      type: 'RIDE_ACCEPTED',
      bookingId: String(bookingId || ''),
      driverId: String(driverId || ''),
      screen: PASSENGER_TRIP_SCREEN
    }
  };
}

// Aviso visível: é o momento em que o passageiro precisa sair.
function buildDriverArrivedPush({ bookingId, bookingData = {} } = {}) {
  const driverName = firstText(bookingData.driverName, bookingData.driverDisplayName);
  const vehicleLine = buildVehicleLine(bookingData);
  const who = driverName ? `${driverName} está no local de embarque` : 'Seu motorista está no local de embarque';
  const deadline = formatBoardingDeadline(bookingData.boardingDeadlineAt);
  const parts = [who, vehicleLine, deadline ? `Embarque até ${deadline}` : ''].filter(Boolean);
  return {
    title: 'Seu motorista chegou',
    body: parts.length > 1 ? parts.join(' · ') : `${parts[0]}.`,
    collapseKey: `leaf-ride-arrived-${bookingId}`,
    data: {
      type: 'driver_arrived',
      bookingId: String(bookingId || ''),
      screen: PASSENGER_TRIP_SCREEN
    }
  };
}

function buildTripStartedPush({ bookingId, bookingData = {} } = {}) {
  const destination = shortAddress(readDestinationAddress(bookingData));
  return {
    title: 'Viagem iniciada',
    body: destination ? `A caminho de ${destination}` : 'Sua corrida está em andamento.',
    collapseKey: `leaf-ride-started-${bookingId}`,
    data: {
      type: 'passenger_trip_started',
      bookingId: String(bookingId || ''),
      screen: PASSENGER_TRIP_SCREEN
    }
  };
}

// Valor de propósito fora do aviso: a regra de exibição do valor ainda não foi definida.
function buildTripCompletedPush({ bookingId } = {}) {
  return {
    title: 'Você chegou ao destino',
    body: 'Obrigado por viajar com a Leaf.',
    collapseKey: `leaf-ride-completed-${bookingId}`,
    data: {
      type: 'passenger_trip_completed',
      bookingId: String(bookingId || ''),
      screen: PASSENGER_TRIP_SCREEN
    }
  };
}

// Sem promessa de reembolso: o valor e o prazo ficam no detalhe do app.
function buildRideCancelledPush({ bookingId } = {}) {
  return {
    title: 'Corrida cancelada',
    body: 'Veja os detalhes no app.',
    collapseKey: `leaf-ride-cancelled-${bookingId}`,
    data: {
      type: 'passenger_ride_cancelled',
      bookingId: String(bookingId || ''),
      screen: PASSENGER_TRIP_SCREEN
    }
  };
}

const ALERT_BUILDERS = {
  arrived: buildDriverArrivedPush,
  started: buildTripStartedPush,
  completed: buildTripCompletedPush,
  cancelled: buildRideCancelledPush
};

let sharedFcmService = null;

async function resolveFcmService(redis) {
  if (!sharedFcmService) {
    const FCMService = require('./fcm-service');
    sharedFcmService = new FCMService(redis);
  }
  if (redis && typeof sharedFcmService.setRedis === 'function') {
    sharedFcmService.setRedis(redis);
  }
  if (!sharedFcmService.isServiceAvailable()) {
    await sharedFcmService.initialize();
  }
  return sharedFcmService;
}

async function sendPassengerAlert(service, { customerId, bookingId, status, push }) {
  try {
    return await service.sendNotificationToUser(customerId, push);
  } catch (error) {
    logger.warn(`⚠️ [RidePassengerStatusPush] aviso ${status} não enviado para ${bookingId}: ${error.message}`);
    return null;
  }
}

/**
 * Nunca falha o fluxo da corrida: qualquer erro vira aviso no log.
 * @param {'arrived'|'started'|'completed'|'cancelled'} status
 * @param {boolean} [sendStatusUpdate=true] false quando o handler já manda o silent push.
 */
async function notifyPassengerRideStatus({
  redis,
  fcmService = null,
  customerId,
  bookingId,
  status,
  bookingData = {},
  sendStatusUpdate = true
} = {}) {
  if (!customerId || !bookingId || !status) {
    return { success: false, skipped: true };
  }
  // Testes de outros módulos não devem abrir o Firebase de verdade.
  if (!fcmService && process.env.NODE_ENV === 'test') {
    return { success: false, skipped: true };
  }
  let service;
  let statusUpdate = null;
  let statusError = null;
  try {
    service = fcmService || await resolveFcmService(redis);
    if (sendStatusUpdate) {
      statusUpdate = await service.sendRideStatusUpdate(
        customerId,
        buildPassengerStatusPayload({ bookingId, status, bookingData })
      );
    }
  } catch (error) {
    statusError = error;
    logger.warn(`⚠️ [RidePassengerStatusPush] ${status} não avisado para ${bookingId}: ${error.message}`);
  }

  let alert = null;
  const buildAlert = ALERT_BUILDERS[status];
  if (buildAlert && service) {
    alert = await sendPassengerAlert(service, {
      customerId,
      bookingId,
      status,
      push: buildAlert({ bookingId, bookingData })
    });
  }

  if (statusError) {
    return { success: false, error: statusError.message };
  }
  return { success: true, statusUpdate, alert };
}

module.exports = {
  buildDriverArrivedPush,
  buildPassengerStatusPayload,
  buildRideAcceptedPush,
  buildRideCancelledPush,
  buildTripCompletedPush,
  buildTripStartedPush,
  formatBoardingDeadline,
  loadAcceptedBookingData,
  notifyPassengerRideStatus
};
