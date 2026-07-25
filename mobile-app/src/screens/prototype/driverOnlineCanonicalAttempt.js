import { isDriverActivationOnlineAttemptAllowed } from './driverActivationCanonicalContract';

export async function attemptCanonicalDriverOnlineStatus({
  activationState,
  socket,
  driverId,
  statusLocation,
  destinationMode,
  timeoutMs = 12000,
} = {}) {
  if (!isDriverActivationOnlineAttemptAllowed(activationState)) {
    return {
      success: false,
      blocked: true,
      reason: 'Ativação do motorista pendente.',
    };
  }

  if (!socket || typeof socket.setDriverStatus !== 'function') {
    throw new Error('Serviço do motorista indisponível.');
  }

  return socket.setDriverStatus(
    driverId,
    'available',
    true,
    {
      timeoutMs,
      location: statusLocation,
      destinationMode,
    },
  );
}
