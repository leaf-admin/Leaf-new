// Botões do balão e do Live Update abrem o Leaf por deep link com a ação da etapa:
// leafapp://robotaxi/home?rideAction=end_trip&rideBookingId=booking_1
// accept_offer vem do card de nova corrida por cima de outros apps (LeafOfferCardWindow).
const RIDE_LINK_ACTIONS = new Set(['arrived_at_pickup', 'start_trip', 'end_trip', 'accept_offer']);

function readQuery(url) {
  const query = String(url || '').split('?')[1] || '';
  const params = {};
  query.split('&').forEach((pair) => {
    if (!pair) return;
    const [key, value = ''] = pair.split('=');
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch (_error) {
      // parâmetro malformado: ignora
    }
  });
  return params;
}

/** `{ action, bookingId }` quando a URL pede uma ação de corrida conhecida. */
export function parseRideActionLink(url) {
  const params = readQuery(url);
  const action = String(params.rideAction || '').trim();
  if (!RIDE_LINK_ACTIONS.has(action)) return null;
  return { action, bookingId: String(params.rideBookingId || '').trim() };
}
