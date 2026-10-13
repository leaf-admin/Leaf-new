/**
 * Avisos do passageiro nas mudanças de fase da corrida.
 *
 * Só o aceite avisava o passageiro. Chegada e início não: com o app em segundo plano a
 * Live Activity (iOS) e a notificação de corrida (Android) ficavam paradas em "a caminho",
 * e o passageiro não sabia que o motorista já estava na porta.
 */
const { logger } = require('../utils/logger');

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

// Aviso visível: é o momento em que o passageiro precisa sair.
function buildDriverArrivedPush({ bookingId, bookingData = {} } = {}) {
  const driverName = firstText(bookingData.driverName, bookingData.driverDisplayName);
  const vehicleLine = buildVehicleLine(bookingData);
  const who = driverName ? `${driverName} está no local de embarque` : 'Seu motorista está no local de embarque';
  return {
    title: 'Seu motorista chegou',
    body: vehicleLine ? `${who} · ${vehicleLine}` : `${who}.`,
    collapseKey: `leaf-ride-arrived-${bookingId}`,
    data: {
      type: 'driver_arrived',
      bookingId: String(bookingId || ''),
      screen: 'RobotaxiPrototype'
    }
  };
}

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

/**
 * Nunca falha o fluxo da corrida: qualquer erro vira aviso no log.
 * @param {'arrived'|'started'} status
 */
async function notifyPassengerRideStatus({ redis, fcmService = null, customerId, bookingId, status, bookingData = {} } = {}) {
  if (!customerId || !bookingId || !status) {
    return { success: false, skipped: true };
  }
  // Testes de outros módulos não devem abrir o Firebase de verdade.
  if (!fcmService && process.env.NODE_ENV === 'test') {
    return { success: false, skipped: true };
  }
  try {
    const service = fcmService || await resolveFcmService(redis);
    const statusUpdate = await service.sendRideStatusUpdate(
      customerId,
      buildPassengerStatusPayload({ bookingId, status, bookingData })
    );
    let alert = null;
    if (status === 'arrived') {
      alert = await service.sendNotificationToUser(customerId, buildDriverArrivedPush({ bookingId, bookingData }));
    }
    return { success: true, statusUpdate, alert };
  } catch (error) {
    logger.warn(`⚠️ [RidePassengerStatusPush] ${status} não avisado para ${bookingId}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = {
  buildDriverArrivedPush,
  buildPassengerStatusPayload,
  notifyPassengerRideStatus
};
