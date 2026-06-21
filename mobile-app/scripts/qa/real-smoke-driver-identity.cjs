"use strict";

function cleanText(value) {
  return String(value || "").trim();
}

function evaluateManagedDriverVehicleIdentity(statusPayload = {}, options = {}) {
  const requireCrlvSource = options.requireCrlvSource !== false;
  const raw = statusPayload?.vehicleIdentity || {};
  const identity = {
    activeVehicleId: cleanText(raw.activeVehicleId) || null,
    plate: cleanText(raw.plate) || null,
    make: cleanText(raw.make) || null,
    model: cleanText(raw.model) || null,
    color: cleanText(raw.color) || null,
    source: cleanText(raw.source).toLowerCase() || "unavailable",
    canonical: raw.canonical === true,
  };
  const missingFields = ["plate", "model", "color"].filter((field) => !identity[field]);

  if (missingFields.length > 0) {
    return {
      ok: false,
      code: "driver_vehicle_identity_incomplete",
      missingFields,
      requireCrlvSource,
      identity,
    };
  }

  if (!identity.canonical) {
    return {
      ok: false,
      code: "driver_vehicle_identity_not_canonical",
      missingFields: [],
      requireCrlvSource,
      identity,
    };
  }

  if (
    requireCrlvSource &&
    !["crlv_pdf_ocr", "qa_crlv_fixture"].includes(identity.source)
  ) {
    return {
      ok: false,
      code: "driver_vehicle_identity_not_crlv",
      missingFields: [],
      requireCrlvSource,
      identity,
    };
  }

  return {
    ok: true,
    code: "driver_vehicle_identity_ready",
    missingFields: [],
    requireCrlvSource,
    identity,
  };
}

function managedDriverBlockFailure(error) {
  if (error === "driver_vehicle_identity_incomplete") {
    return "blocked_precondition:driver_vehicle_identity_incomplete";
  }
  if (error === "driver_vehicle_identity_not_canonical") {
    return "blocked_precondition:driver_vehicle_identity_not_canonical";
  }
  if (error === "driver_vehicle_identity_not_crlv") {
    return "blocked_precondition:driver_vehicle_identity_not_crlv";
  }
  return `blocked_precondition:managed_driver_not_online:${error || "driver_online_timeout"}`;
}

function managedDriverPaymentBlockStatus(error) {
  if (String(error || "").startsWith("driver_vehicle_identity_")) {
    return `blocked_precondition_${error}`;
  }
  if (error === "driver_not_dispatch_eligible") {
    return "blocked_precondition_driver_not_dispatch_eligible";
  }
  return "blocked_precondition_canonical_pickup";
}

function normalizeIdentityValue(field, value) {
  const text = cleanText(value).toLowerCase();
  if (field === "plate") {
    return text.replace(/[^a-z0-9]/g, "");
  }
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function compareRenderedVehicleIdentity(canonical = {}, renderedEntries = []) {
  const comparableFields = ["plate", "model", "color"];
  const entries = (renderedEntries || []).filter(Boolean).map((entry) => ({
    ...entry,
    mismatches: comparableFields.filter((field) => {
      if (!entry[field]) return false;
      return normalizeIdentityValue(field, entry[field]) !==
        normalizeIdentityValue(field, canonical[field]);
    }),
  }));
  const mismatches = entries.flatMap((entry) =>
    entry.mismatches.map((field) => ({
      step: entry.step,
      screen: entry.screen,
      field,
      expected: canonical[field] || null,
      actual: entry[field] || null,
    })),
  );

  return {
    ok: mismatches.length === 0,
    canonical,
    entries,
    mismatches,
    coverage: {
      activeTrip: entries.some((entry) => entry.screen === "passenger_active_trip"),
      receipt: entries.some((entry) => entry.screen === "passenger_receipt"),
    },
  };
}

module.exports = {
  compareRenderedVehicleIdentity,
  evaluateManagedDriverVehicleIdentity,
  managedDriverBlockFailure,
  managedDriverPaymentBlockStatus,
};
