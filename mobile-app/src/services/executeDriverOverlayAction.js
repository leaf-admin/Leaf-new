import {
  calculateDistanceMeters,
  DESTINATION_ALERT_METERS,
  PICKUP_TOLERANCE_METERS,
} from './PrototypeDriverTripAssistantService';

// The overlay uses the existing lifecycle commands, scoped to the ride and stage
// displayed by the native window. The backend still authorizes every transition.
export async function executeDriverOverlayAction({ actionIdentifier, bookingId }, {
  getContext,
  resolveLocation,
  arrive,
  start,
  complete,
}) {
  const context = await getContext();
  const expectedStatus = {
    arrived_at_pickup: 'accepted',
    start_trip: 'arrived',
    end_trip: 'started',
  }[actionIdentifier];
  if (!bookingId || context?.bookingId !== bookingId || !expectedStatus || context?.status !== expectedStatus) {
    throw new Error('A corrida ou a etapa mudou. Aguarde a atualização.');
  }

  const locationOverride = await resolveLocation(context);
  // A GPS read can outlive the ride/stage that produced this button.
  const current = await getContext();
  if (current?.bookingId !== bookingId || current?.status !== expectedStatus) {
    throw new Error('A corrida ou a etapa mudou. Aguarde a atualização.');
  }
  if (actionIdentifier === 'arrived_at_pickup') {
    const meters = calculateDistanceMeters(locationOverride, current.pickupCoordinate);
    if (!Number.isFinite(meters) || meters > PICKUP_TOLERANCE_METERS) {
      throw new Error('Aproxime-se do local de embarque.');
    }
    return arrive({ locationOverride });
  }
  if (actionIdentifier === 'start_trip') {
    return start({ locationOverride });
  }

  const meters = calculateDistanceMeters(locationOverride, current.destinationCoordinate);
  if (!Number.isFinite(meters) || meters > DESTINATION_ALERT_METERS) {
    // Early completion needs the existing consent flow inside Leaf; the overlay
    // only offers normal destination completion, as it already does today.
    throw new Error('Para encerrar antes do destino, use as opções da corrida no Leaf.');
  }
  return complete({ locationOverride });
}
