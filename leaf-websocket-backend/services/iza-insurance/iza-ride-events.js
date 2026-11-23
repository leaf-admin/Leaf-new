'use strict';

// Converte o evento do stream ride_events no que o seguro precisa. Os handlers
// publicam o evento canônico inteiro como `data`, então o payload pode vir em
// event.data ou em event.data.data (mesmo critério do startTripTimer).

const KIND_BY_EVENT = Object.freeze({
  'ride.started': 'started',
  'ride.completed': 'completed',
  'ride.canceled': 'canceled'
});

function pickPayload(event = {}) {
  const raw = event?.data && typeof event.data === 'object' ? event.data : {};
  const nested = raw?.data && typeof raw.data === 'object' ? raw.data : null;
  if (raw.bookingId || raw.driverId) return { payload: raw, envelope: raw };
  return { payload: nested || raw, envelope: raw };
}

function extractIzaRideEvent(eventType, event = {}) {
  const kind = KIND_BY_EVENT[eventType];
  if (!kind) return null;
  const { payload, envelope } = pickPayload(event);
  const bookingId = String(payload.bookingId || event.bookingId || '').trim();
  if (!bookingId) return null;
  const occurredAt = envelope.occurredAt || payload.occurredAt || event.timestamp || null;

  if (kind === 'started') {
    const driverId = String(payload.driverId || event.driverId || '').trim();
    if (!driverId) return null;
    return { kind, bookingId, driverId, startedAt: payload.startedAt || occurredAt };
  }
  return {
    kind: kind === 'canceled' ? 'canceled' : 'completed',
    bookingId,
    endedAt: payload.completedAt || payload.endedAt || payload.cancelledAt || payload.canceledAt || occurredAt
  };
}

module.exports = { extractIzaRideEvent };
