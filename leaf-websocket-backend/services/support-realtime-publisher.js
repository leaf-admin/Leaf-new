'use strict';

const DASHBOARD_NAMESPACE = '/dashboard';
const DASHBOARD_AUTHENTICATED_ROOM = 'dashboard:authenticated';

function normalizeUserType(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveSupportOwnerRooms(userId, userType = '') {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];

  const normalizedType = normalizeUserType(userType);
  if (['driver', 'motorista', 'partner', 'parceiro'].includes(normalizedType)) {
    return [`driver_${normalizedUserId}`];
  }
  if (['passenger', 'customer', 'passageiro'].includes(normalizedType)) {
    return [`customer_${normalizedUserId}`];
  }

  // Tickets antigos nem sempre preservam userType. Ambos os rooms continuam
  // individualizados pelo mesmo uid e nunca ampliam o evento para o namespace.
  return [`customer_${normalizedUserId}`, `driver_${normalizedUserId}`];
}

function emitSupportToDashboard(io, eventName, payload) {
  const dashboardNamespace = io?.of?.(DASHBOARD_NAMESPACE);
  const dashboardRoom = dashboardNamespace?.to?.(DASHBOARD_AUTHENTICATED_ROOM);
  if (!dashboardRoom?.emit) return false;
  dashboardRoom.emit(eventName, payload);
  return true;
}

function emitSupportToOwner(io, eventName, payload, { userId, userType } = {}) {
  if (!io?.to) return [];
  const emittedRooms = [];
  resolveSupportOwnerRooms(userId, userType).forEach((roomName) => {
    const room = io.to(roomName);
    if (!room?.emit) return;
    room.emit(eventName, payload);
    emittedRooms.push(roomName);
  });
  return emittedRooms;
}

function publishSupportEvent(io, {
  dashboardEvent,
  ownerEvent = dashboardEvent,
  dashboardPayload,
  ownerPayload = dashboardPayload,
  userId,
  userType
} = {}) {
  const dashboardEmitted = Boolean(dashboardEvent) && emitSupportToDashboard(
    io,
    dashboardEvent,
    dashboardPayload
  );
  const ownerRooms = ownerEvent
    ? emitSupportToOwner(io, ownerEvent, ownerPayload, { userId, userType })
    : [];

  return { dashboardEmitted, ownerRooms };
}

module.exports = {
  DASHBOARD_NAMESPACE,
  DASHBOARD_AUTHENTICATED_ROOM,
  resolveSupportOwnerRooms,
  emitSupportToDashboard,
  emitSupportToOwner,
  publishSupportEvent
};
