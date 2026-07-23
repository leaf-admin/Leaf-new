function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function asObject(value) {
  const parsed = parseJsonMaybe(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : {};
}

function normalizeCoordinate(value) {
  const candidate = parseJsonMaybe(value);
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const lat = toFiniteNumber(candidate.lat ?? candidate.latitude);
  const lng = toFiniteNumber(candidate.lng ?? candidate.longitude);
  if (lat === null || lng === null) {
    return null;
  }

  return { lat, lng };
}

function resolveAddress(candidate) {
  if (!candidate) {
    return '';
  }

  const raw =
    candidate.address ||
    candidate.add ||
    candidate.formattedAddress ||
    candidate.formatted_address ||
    candidate.name ||
    candidate.label ||
    '';

  return String(raw || '').trim();
}

function resolveLocationDetails(rawValue, fallbackLabel = '') {
  const candidate = parseJsonMaybe(rawValue);
  if (!candidate || typeof candidate !== 'object') {
    return {
      label: String(fallbackLabel || '').trim(),
      coordinate: null
    };
  }

  return {
    label: resolveAddress(candidate) || String(fallbackLabel || '').trim(),
    coordinate: normalizeCoordinate(candidate)
  };
}

function resolvePaymentMethod(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'pix';
  }
  return normalized;
}

function toMoney(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : fallback;
}

function resolveText(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function resolveVehicleIdentity(bookingData = {}) {
  const driverData = asObject(bookingData.driverData);
  const driver = asObject(bookingData.driver);
  const driverVehicle = asObject(driver.vehicle);
  const storedVehicle = asObject(bookingData.vehicle || bookingData.driverVehicle);
  const driverDataVehicle = asObject(driverData.vehicle);
  const vehicleMake = resolveText(
    bookingData.vehicleMake,
    bookingData.carMake,
    storedVehicle.make,
    storedVehicle.brand,
    driverVehicle.make,
    driverVehicle.brand,
    driverDataVehicle.make,
    driverDataVehicle.brand,
    driverData.vehicleMake,
    driverData.carMake
  );
  const vehicleModel = resolveText(
    bookingData.vehicleLabel,
    bookingData.vehicleModel,
    bookingData.driverVehicle,
    bookingData.carModel,
    storedVehicle.model,
    storedVehicle.category,
    driverVehicle.model,
    driverVehicle.category,
    driverDataVehicle.model,
    driverDataVehicle.category,
    driverData.vehicleModel,
    driverData.carModel
  );
  const vehicleLabel =
    vehicleMake &&
    vehicleModel &&
    !vehicleModel.toLowerCase().startsWith(vehicleMake.toLowerCase())
      ? `${vehicleMake} ${vehicleModel}`
      : vehicleModel || vehicleMake;
  const vehiclePlate = resolveText(
    bookingData.vehiclePlate,
    bookingData.vehicleNumber,
    bookingData.vehicle_plate,
    bookingData.carPlate,
    storedVehicle.plate,
    storedVehicle.vehiclePlate,
    driverVehicle.plate,
    driverVehicle.vehiclePlate,
    driverDataVehicle.plate,
    driverDataVehicle.vehiclePlate,
    driverData.vehiclePlate,
    driverData.vehicleNumber,
    driverData.carPlate
  );
  const vehicleColor = resolveText(
    bookingData.vehicleColor,
    bookingData.carColor,
    bookingData.color,
    storedVehicle.color,
    storedVehicle.vehicleColor,
    driverVehicle.color,
    driverVehicle.vehicleColor,
    driverDataVehicle.color,
    driverDataVehicle.vehicleColor,
    driverData.vehicleColor,
    driverData.carColor
  );
  const vehicleCategory = resolveText(
    bookingData.vehicleCategory,
    bookingData.carType,
    storedVehicle.category,
    driverVehicle.category,
    driverDataVehicle.category,
    driverData.vehicleCategory,
    driverData.carType
  );

  return {
    ...(vehicleLabel ? { vehicleLabel, vehicleModel: vehicleLabel } : {}),
    ...(vehiclePlate ? { vehiclePlate } : {}),
    ...(vehicleColor ? { vehicleColor } : {}),
    ...(vehicleCategory ? { vehicleCategory } : {}),
    ...(vehicleLabel || vehiclePlate || vehicleColor || vehicleCategory
      ? {
          vehicle: {
            ...(vehicleMake ? { make: vehicleMake } : {}),
            ...(vehicleModel ? { model: vehicleModel } : {}),
            ...(vehiclePlate ? { plate: vehiclePlate } : {}),
            ...(vehicleColor ? { color: vehicleColor } : {}),
            ...(vehicleCategory ? { category: vehicleCategory } : {})
          }
        }
      : {})
  };
}

function buildTripCompletedPayload({
  bookingId,
  message = 'Viagem finalizada com sucesso',
  bookingData = {},
  resultEndLocation,
  endLocation,
  distance,
  duration,
  fareBreakdown,
  paymentDistribution = null,
  completionType = 'COMPLETED',
  settlement = null,
  rideLegs = null,
  operationalContinuation = null,
  reviewContext = null,
  persistence = 'accepted_background'
}) {
  const pickup = resolveLocationDetails(
    bookingData.pickupLocation || bookingData.pickup,
    bookingData.pickupAddress || bookingData.pickup || 'Origem'
  );
  const drop = resolveLocationDetails(
    bookingData.destinationLocation || bookingData.destination,
    bookingData.destinationAddress || bookingData.dropoffAddress || bookingData.dropoff || 'Destino'
  );

  const normalizedDistance = toFiniteNumber(distance);
  const normalizedDuration = toFiniteNumber(duration);
  const customerId = resolveText(
    bookingData.customerId,
    bookingData.passengerId,
    bookingData.customer
  );
  const driverId = resolveText(bookingData.driverId, bookingData.driver);
  const passengerName = resolveText(
    bookingData.passengerName,
    bookingData.customerName,
    bookingData.customerFullName
  );
  const driverData = asObject(bookingData.driverData);
  const driver = asObject(bookingData.driver);
  const driverName = resolveText(
    bookingData.driverName,
    bookingData.driverFullName,
    driver.name,
    driver.driverName,
    driverData.name,
    driverData.driverName
  );
  const vehicleIdentity = resolveVehicleIdentity(bookingData);

  return {
    success: true,
    bookingId,
    ...(customerId ? { customerId, passengerId: customerId } : {}),
    ...(driverId ? { driverId } : {}),
    ...(passengerName ? { passengerName, customerName: passengerName } : {}),
    ...(driverName ? { driverName } : {}),
    ...vehicleIdentity,
    message,
    endLocation: resultEndLocation || endLocation,
    distance: normalizedDistance !== null ? normalizedDistance : 0,
    duration: normalizedDuration !== null ? normalizedDuration : 0,
    fare: fareBreakdown.totalFare,
    totalFare: fareBreakdown.totalFare,
    totalPaid: fareBreakdown.totalFare,
    grossAmount: fareBreakdown.totalFare,
    tollFee: toMoney(fareBreakdown.tollFee, 0),
    operationalFee: fareBreakdown.operationalFee,
    paymentIntermediationFee: fareBreakdown.paymentIntermediationFee,
    totalFees: fareBreakdown.totalFees,
    driverNetAmount: fareBreakdown.driverNetAmount,
    paymentMethod: resolvePaymentMethod(
      bookingData.paymentMethod ||
        bookingData.payment_mode ||
        bookingData.paymentMode
    ),
    pickup: pickup.label || null,
    drop: drop.label || null,
    ...(pickup.coordinate ? { pickupCoordinate: pickup.coordinate } : {}),
    ...(drop.coordinate ? { destinationCoordinate: drop.coordinate } : {}),
    fareBreakdown,
    paymentDistribution,
    completionType,
    ...(settlement ? { settlement } : {}),
    ...(Array.isArray(rideLegs) ? { rideLegs } : {}),
    ...(operationalContinuation ? { operationalContinuation } : {}),
    ...(reviewContext ? { reviewContext } : {}),
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    persistence,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  buildTripCompletedPayload
};
