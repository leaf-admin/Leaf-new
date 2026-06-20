"use strict";

const CONFIRMED_FLOW_SCREENS = new Set([
  "passenger_searching_driver",
  "passenger_active_trip",
  "passenger_receipt",
  "passenger_rating",
]);

function resolvePostSandboxPaymentStatus({ confirmationOk, paymentStatus, screen }) {
  if (paymentStatus === "confirmed") return "confirmed";
  if (confirmationOk === true && CONFIRMED_FLOW_SCREENS.has(screen)) {
    return "confirmed";
  }
  return paymentStatus;
}

module.exports = { resolvePostSandboxPaymentStatus };
