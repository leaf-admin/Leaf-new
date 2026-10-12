// Boarding wait rules shown to the passenger and the driver after the driver
// reports arrival at the pickup. The numbers mirror the server rule and live
// only here; the server alone decides whether a fee is charged.

// Reason text the driver app sends when it cancels for passenger no-show. The
// server forwards it unchanged to the passenger in the cancel event.
export const PASSENGER_NO_SHOW_CANCEL_REASON = "Passageiro não compareceu ao embarque.";

export function isPassengerNoShowCancelReason(reason) {
  return /n[ãa]o compareceu/i.test(String(reason || ""));
}
