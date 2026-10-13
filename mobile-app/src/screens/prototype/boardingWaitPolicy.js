// Boarding wait rules shown to the passenger and the driver after the driver
// reports arrival at the pickup. The numbers mirror the server rule and live
// only here; the server alone decides whether a fee is charged.

// Reason text the driver app sends when it cancels for passenger no-show. The
// server forwards it unchanged to the passenger in the cancel event.
export const PASSENGER_NO_SHOW_CANCEL_REASON = "Passageiro não compareceu ao embarque.";

export function isPassengerNoShowCancelReason(reason) {
  return /n[ãa]o compareceu/i.test(String(reason || ""));
}

// Countdown both sides see after "Cheguei ao embarque" (arrival + 2 minutes
// is the `boardingDeadlineAt` the server sends).
export const BOARDING_COUNTDOWN_SECONDS = 120;
// Server rule: no fee before the driver has waited this long at the pickup;
// from here on a driver cancel counts as passenger no-show and a fee applies.
export const NO_SHOW_FEE_WAIT_SECONDS = 300;
export const NO_SHOW_FEE_WAIT_MINUTES = NO_SHOW_FEE_WAIT_SECONDS / 60;

export const BOARDING_WAIT_PHASE = Object.freeze({
  COUNTDOWN: "countdown", // the 2:00 are still running
  WAITING: "waiting", // countdown over, less than 5 minutes waited (or unknown)
  NO_SHOW: "no_show", // at least 5 minutes waited since arrival
});

export function formatBoardingClock(seconds) {
  const normalizedSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(normalizedSeconds / 60)}:${String(normalizedSeconds % 60).padStart(2, "0")}`;
}

// Where the boarding wait stands. `remainingSec` is the runtime countdown;
// once it reaches zero the wait is counted up from the arrival time, which is
// the boarding deadline minus the countdown. Without a deadline the waited
// time is unknown (null) and the phase never becomes a no-show.
export function resolveBoardingWait({
  boardingDeadlineAt = null,
  remainingSec = null,
  nowMs = Date.now(),
} = {}) {
  const remaining =
    remainingSec === null || remainingSec === undefined || !Number.isFinite(Number(remainingSec))
      ? null
      : Math.max(0, Math.round(Number(remainingSec)));
  if (remaining === null || remaining > 0) {
    return {
      phase: BOARDING_WAIT_PHASE.COUNTDOWN,
      remainingSec: remaining,
      waitedSec: null,
      waitedLabel: null,
    };
  }

  const deadlineMs = boardingDeadlineAt ? new Date(boardingDeadlineAt).getTime() : NaN;
  if (!Number.isFinite(deadlineMs)) {
    return {
      phase: BOARDING_WAIT_PHASE.WAITING,
      remainingSec: 0,
      waitedSec: null,
      waitedLabel: null,
    };
  }

  const arrivalMs = deadlineMs - BOARDING_COUNTDOWN_SECONDS * 1000;
  const waitedSec = Math.max(
    BOARDING_COUNTDOWN_SECONDS,
    Math.floor((Number(nowMs) - arrivalMs) / 1000),
  );
  return {
    phase:
      waitedSec >= NO_SHOW_FEE_WAIT_SECONDS
        ? BOARDING_WAIT_PHASE.NO_SHOW
        : BOARDING_WAIT_PHASE.WAITING,
    remainingSec: 0,
    waitedSec,
    waitedLabel: formatBoardingClock(waitedSec),
  };
}

// Passenger card, arrived state.
export function resolvePassengerBoardingWaitCopy(wait = {}) {
  if (wait.phase === BOARDING_WAIT_PHASE.NO_SHOW) {
    return {
      value: wait.waitedLabel,
      valueLabel: "de espera",
      message: `O motorista já esperou ${NO_SHOW_FEE_WAIT_MINUTES} minutos. Ele pode cancelar e uma taxa é cobrada.`,
    };
  }
  if (wait.phase === BOARDING_WAIT_PHASE.WAITING) {
    return {
      value: wait.waitedLabel,
      valueLabel: wait.waitedLabel ? "de espera" : null,
      message: `Depois de ${NO_SHOW_FEE_WAIT_MINUTES} minutos de espera, o motorista pode cancelar e uma taxa é cobrada.`,
    };
  }
  return { value: null, valueLabel: null, message: null };
}

// Driver card and cancel prompt, arrived state.
export function resolveDriverBoardingWaitCopy(wait = {}) {
  if (wait.phase === BOARDING_WAIT_PHASE.NO_SHOW) {
    return {
      value: wait.waitedLabel,
      metricLabel: "Esperando",
      hint: "Cancelar agora conta como não comparecimento do passageiro.",
      passengerNoShow: true,
      cancelPromptTitle: "Passageiro não apareceu?",
      cancelPromptMessage: `Você esperou ${NO_SHOW_FEE_WAIT_MINUTES} minutos no embarque. Ao cancelar, registramos que o passageiro não compareceu ao embarque.`,
    };
  }
  if (wait.phase === BOARDING_WAIT_PHASE.WAITING) {
    return {
      value: wait.waitedLabel,
      metricLabel: wait.waitedLabel ? "Esperando" : null,
      hint: null,
      passengerNoShow: false,
      cancelPromptTitle: "Cancelar corrida?",
      cancelPromptMessage: `O passageiro será avisado. Antes de ${NO_SHOW_FEE_WAIT_MINUTES} minutos de espera no embarque, o cancelamento não conta como não comparecimento do passageiro.`,
    };
  }
  return {
    value: null,
    metricLabel: null,
    hint: null,
    passengerNoShow: false,
    cancelPromptTitle: null,
    cancelPromptMessage: null,
  };
}
