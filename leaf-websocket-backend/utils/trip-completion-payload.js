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

  return {
    success: true,
    bookingId,
    message,
    endLocation: resultEndLocation || endLocation,
    distance: normalizedDistance !== null ? normalizedDistance : 0,
    duration: normalizedDuration !== null ? normalizedDuration : 0,
    fare: fareBreakdown.totalFare,
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
