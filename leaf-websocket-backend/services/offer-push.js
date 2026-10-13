/**
 * Push de nova corrida para o motorista. A oferta só chegava pelo socket: com o app em
 * segundo plano o motorista não via nada e a corrida expirava. O app em primeiro plano
 * ignora este tipo (o cartão da oferta já está na tela).
 */

const OFFER_PUSH_COLLAPSE_KEY = 'leaf-ride-offer';

function isOfferPushEnabled(env = process.env) {
  return String(env.ENABLE_NEW_OFFER_PUSH || 'true').toLowerCase() !== 'false';
}

function buildOfferPushNotification(offer = {}) {
  const netAmount = Number(offer.estimatedDriverNetAmount);
  const pickupMinutes = Number(offer.estimatedArrivalToPickupMin);
  const parts = [];
  if (Number.isFinite(netAmount) && netAmount > 0) {
    parts.push(`R$ ${netAmount.toFixed(2).replace('.', ',')} líquido`);
  }
  if (Number.isFinite(pickupMinutes) && pickupMinutes > 0) {
    parts.push(`${Math.round(pickupMinutes)} min até o embarque`);
  }
  // A oferta vale poucos segundos: o push não pode chegar depois dela, e uma nova
  // oferta substitui o aviso anterior em vez de empilhar.
  const expiresAtMs = Number(offer.expiresAt) || Date.parse(offer.expiresAt);
  const remainingSeconds = Number.isFinite(expiresAtMs)
    ? Math.round((expiresAtMs - Date.now()) / 1000)
    : Number(offer.timeout);
  const ttlSeconds = Number.isFinite(remainingSeconds) && remainingSeconds > 0
    ? Math.min(120, Math.max(5, remainingSeconds))
    : 30;
  return {
    title: 'Nova corrida',
    collapseKey: OFFER_PUSH_COLLAPSE_KEY,
    ttlSeconds,
    body: parts.length ? parts.join(' · ') : 'Toque para ver e aceitar.',
    data: {
      type: 'ride_offer',
      bookingId: String(offer.bookingId || ''),
      screen: 'RobotaxiPrototype',
      expiresAt: String(offer.expiresAt || '')
    }
  };
}

module.exports = {
  OFFER_PUSH_COLLAPSE_KEY,
  isOfferPushEnabled,
  buildOfferPushNotification
};
