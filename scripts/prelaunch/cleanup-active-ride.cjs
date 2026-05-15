#!/usr/bin/env node
const WebSocketTestClient = require("../../leaf-websocket-backend/tests/e2e/backend/__helpers__/websocket-test-client");

const WS_URL = process.env.WS_URL || "https://socket.62.169.31.231.sslip.io";
const PASSENGER_UID = String(process.env.PASSENGER_UID || "").trim();
const DRIVER_UID = String(process.env.DRIVER_UID || "").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitAndWait(client, { emitEvent, emitPayload, successEvent, errorEvent, timeoutMs = 12000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.removeListener(successEvent, onSuccess);
      if (errorEvent) {
        client.socket.removeListener(errorEvent, onError);
      }
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onSuccess = (payload) => finish(resolve, payload);
    const onError = (payload) => finish(reject, new Error(payload?.message || payload?.error || errorEvent));
    const timer = setTimeout(() => finish(reject, new Error(`${emitEvent}_timeout`)), timeoutMs);
    client.socket.once(successEvent, onSuccess);
    if (errorEvent) {
      client.socket.once(errorEvent, onError);
    }
    client.socket.emit(emitEvent, emitPayload);
  });
}

async function syncActiveRide(client, userType) {
  try {
    const payload = await emitAndWait(client, {
      emitEvent: "syncActiveRide",
      emitPayload: { userType },
      successEvent: "activeRideSync",
      timeoutMs: 12000,
    });
    return {
      success: payload?.success === true,
      hasActiveRide: payload?.hasActiveRide === true,
      bookingId: payload?.bookingId || payload?.ride?.bookingId || payload?.ride?.id || null,
      status: payload?.status || payload?.ride?.status || null,
      ride: payload?.ride || null,
    };
  } catch (error) {
    return {
      success: false,
      hasActiveRide: false,
      bookingId: null,
      error: error?.message || String(error),
    };
  }
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveFinishPayload(bookingId, ride) {
  const destination = ride?.destinationLocation || ride?.dropoffLocation || {};
  const lat = Number(destination.lat ?? destination.latitude ?? -22.96722);
  const lng = Number(destination.lng ?? destination.longitude ?? -43.17874);
  const fare = Number(ride?.estimatedFare ?? ride?.fare ?? ride?.grossFare ?? 0);

  return {
    bookingId,
    endLocation: {
      lat: Number.isFinite(lat) ? lat : -22.96722,
      lng: Number.isFinite(lng) ? lng : -43.17874,
    },
    distance: Number(ride?.distanceMeters ?? ride?.distance ?? 1000),
    duration: Number(ride?.durationSeconds ?? ride?.duration ?? 300),
    fare: Number.isFinite(fare) && fare > 0 ? fare : 0,
  };
}

async function main() {
  if (!PASSENGER_UID || !DRIVER_UID) {
    throw new Error("PASSENGER_UID and DRIVER_UID are required");
  }

  const passenger = new WebSocketTestClient(WS_URL, {
    transports: ["websocket"],
    timeout: 30000,
    reconnection: false,
  });
  const driver = new WebSocketTestClient(WS_URL, {
    transports: ["websocket"],
    timeout: 30000,
    reconnection: false,
  });

  const report = {
    ok: false,
    wsUrl: WS_URL,
    passengerUid: PASSENGER_UID,
    driverUid: DRIVER_UID,
    before: {},
    cleanup: null,
    after: {},
  };

  try {
    await passenger.connect();
    await driver.connect();
    await passenger.authenticate(PASSENGER_UID, "customer");
    await driver.authenticate(DRIVER_UID, "driver");

    report.before.passenger = await syncActiveRide(passenger, "customer");
    report.before.driver = await syncActiveRide(driver, "driver");

    const bookingId =
      report.before.passenger.bookingId ||
      report.before.driver.bookingId ||
      null;
    if (bookingId && (report.before.passenger.hasActiveRide || report.before.driver.hasActiveRide)) {
      const status = normalizeStatus(report.before.passenger.status || report.before.driver.status);
      if (["started", "in_progress", "in-progress", "on_trip"].includes(status)) {
        const ride = report.before.driver.ride || report.before.passenger.ride || {};
        report.cleanup = {
          by: "driver",
          bookingId,
          mode: "finish_started_trip",
          result: await driver.finishTrip(resolveFinishPayload(bookingId, ride)),
        };
      } else {
        try {
          report.cleanup = {
            by: "passenger",
            bookingId,
            mode: "cancel_active_ride",
            result: await passenger.cancelRide(bookingId, "prelaunch_android_cleanup"),
          };
        } catch (passengerError) {
          report.cleanup = {
            by: "driver",
            bookingId,
            mode: "cancel_active_ride",
            passengerError: passengerError?.message || String(passengerError),
            result: await driver.cancelRide(bookingId, "prelaunch_android_cleanup"),
          };
        }
      }
      await sleep(800);
    }

    report.after.passenger = await syncActiveRide(passenger, "customer");
    report.after.driver = await syncActiveRide(driver, "driver");
    report.ok = !report.after.passenger.hasActiveRide && !report.after.driver.hasActiveRide;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.ok ? 0 : 1);
  } finally {
    try { passenger.disconnect(); } catch (_error) {}
    try { driver.disconnect(); } catch (_error) {}
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
