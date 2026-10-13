// Server answers that mean the ride no longer exists there, so the app has
// nothing left to cancel and must not keep the passenger on a ride screen.
export function isRideGoneOnServerError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "RIDE_NOT_FOUND" ||
    message.includes("corrida não encontrada") ||
    message.includes("corrida nao encontrada") ||
    message.includes("já está cancelada") ||
    message.includes("ja esta cancelada")
  );
}
