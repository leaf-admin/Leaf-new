import { showLeafChoiceSheet } from '../../../components/design-system/LeafChoiceSheet';

const DRIVER_EARLY_END_CONFIRM_METERS = 500;

// Resolves to null when the car is at the destination, to { cancelled: true }
// when the driver decides to keep driving, or to the stated reason.
function confirmDriverEarlyEnd(remainingMeters) {
  const meters = Number(remainingMeters);
  if (!Number.isFinite(meters) || meters <= DRIVER_EARLY_END_CONFIRM_METERS) {
    return Promise.resolve(null);
  }
  const distanceLabel = meters >= 1000
    ? `${(meters / 1000).toFixed(1).replace('.', ',')} km`
    : `${Math.round(meters / 10) * 10} m`;
  return showLeafChoiceSheet({
    title: 'Encerrar antes do destino?',
    message: `Faltam ${distanceLabel} até o destino. O passageiro será avisado e poderá avaliar este encerramento.`,
    options: [
      { key: 'continue', label: 'Continuar viagem' },
      { key: 'passenger_request', label: 'Passageiro pediu para descer', tone: 'secondary' },
      { key: 'trip_problem', label: 'Problema na viagem', tone: 'secondary' },
    ],
  }).then(key => (
    key === 'passenger_request' || key === 'trip_problem'
      ? { reason: key, remainingMeters: Math.round(meters) }
      : { cancelled: true }
  ));
}

export { confirmDriverEarlyEnd, DRIVER_EARLY_END_CONFIRM_METERS };
