let latestPrototypeHomeQaRouteParams = null;
let latestPrototypeHomeDriverAutomationCommand = null;
const prototypeHomeAutomationListeners = new Set();

function sanitizeText(value) {
  return String(value || "").trim();
}

function sanitizeQaRouteParams(params = null) {
  if (!params || typeof params !== "object") {
    return null;
  }

  const normalized = Object.entries(params).reduce((accumulator, [key, value]) => {
    const nextValue = sanitizeText(value);
    if (nextValue) {
      accumulator[key] = nextValue;
    }
    return accumulator;
  }, {});

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function sanitizeDriverAutomationCommand(command = null) {
  if (!command || typeof command !== "object") {
    return null;
  }

  const role = sanitizeText(command.role) || "driver";
  const action = sanitizeText(command.action);
  if (!action) {
    return null;
  }

  return {
    role,
    action,
    bookingId: sanitizeText(command.bookingId),
    nonce: sanitizeText(command.nonce) || "prototype-home-automation",
  };
}

function buildPrototypeHomeAutomationSnapshot() {
  return {
    qaRouteParams: latestPrototypeHomeQaRouteParams,
    driverAutomationCommand: latestPrototypeHomeDriverAutomationCommand,
  };
}

function notifyPrototypeHomeAutomationListeners() {
  const snapshot = buildPrototypeHomeAutomationSnapshot();
  prototypeHomeAutomationListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (_error) {
      // best-effort fanout
    }
  });
}

function publishPrototypeHomeAutomationPayload(payload = {}) {
  const { qaRouteParams, driverAutomationCommand } = payload;

  if (Object.prototype.hasOwnProperty.call(payload, "qaRouteParams")) {
    latestPrototypeHomeQaRouteParams = sanitizeQaRouteParams(qaRouteParams);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "driverAutomationCommand")) {
    latestPrototypeHomeDriverAutomationCommand = sanitizeDriverAutomationCommand(
      driverAutomationCommand,
    );
  }

  notifyPrototypeHomeAutomationListeners();
  return buildPrototypeHomeAutomationSnapshot();
}

function subscribePrototypeHomeAutomationPayload(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  prototypeHomeAutomationListeners.add(listener);
  return () => {
    prototypeHomeAutomationListeners.delete(listener);
  };
}

function clearPrototypeHomeAutomationPayload() {
  latestPrototypeHomeQaRouteParams = null;
  latestPrototypeHomeDriverAutomationCommand = null;
  notifyPrototypeHomeAutomationListeners();
}

function getLatestPrototypeHomeAutomationPayload() {
  return buildPrototypeHomeAutomationSnapshot();
}

module.exports = {
  clearPrototypeHomeAutomationPayload,
  getLatestPrototypeHomeAutomationPayload,
  publishPrototypeHomeAutomationPayload,
  subscribePrototypeHomeAutomationPayload,
};
