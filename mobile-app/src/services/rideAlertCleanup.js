// Avisos da corrida que perdem o sentido quando ela termina (aceita, a caminho,
// motorista chegou). Recibo e pagamento ficam na bandeja.
const RIDE_PROGRESS_ALERT_TYPES = new Set([
  'ride_accepted',
  'arrived_at_pickup',
  'driver_arrived',
  'trip_started',
  'trip_in_progress',
  'ride_status',
  'ride_status_update',
]);

function notificationData(notification) {
  const content = notification?.request?.content || {};
  if (content.data && typeof content.data === 'object') return content.data;
  try {
    return JSON.parse(content.dataString || '{}') || {};
  } catch (error) {
    return {};
  }
}

/** Identificadores dos avisos exibidos que pertencem à corrida encerrada. */
export function findStaleRideAlertIds(presentedNotifications, bookingId) {
  if (!bookingId || !Array.isArray(presentedNotifications)) return [];
  return presentedNotifications
    .filter((notification) => {
      const data = notificationData(notification);
      return String(data.bookingId || '') === String(bookingId)
        && RIDE_PROGRESS_ALERT_TYPES.has(String(data.type || ''));
    })
    .map((notification) => notification?.request?.identifier)
    .filter(Boolean);
}
