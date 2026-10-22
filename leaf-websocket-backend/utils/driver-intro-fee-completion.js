const { resolveRideEarlyEnd, DEFAULT_MAX_POSITION_AGE_SECONDS } = require('../services/ride-early-end-service');

function point(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { return null; }
  }
  if (!value || [value.lat ?? value.latitude, value.lng ?? value.longitude]
    .some(coordinate => coordinate === null || coordinate === undefined || coordinate === '' || typeof coordinate === 'boolean')) return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)
    ? { lat, lng } : null;
}

// Only server telemetry is passed as metrics. Client endLocation/reason never
// proves destination completion or eligibility for the introductory counter.
function assessDestinationCompletion({ booking = {}, metrics = null, earlyEnd = null, nowMs = Date.now(), env = process.env } = {}) {
  if (earlyEnd?.detected || earlyEnd?.applied || String(booking.completionType || '').includes('EARLY')) {
    return { qualified: false, reviewRequired: false, reason: 'EARLY_END' };
  }
  const destination = point(booking.destinationLocation || booking.destination);
  const end = metrics?.success ? point(metrics.endLocation) : null;
  const received = Number(metrics?.lastReceivedAtMs);
  const configuredAge = Number(env.RIDE_EARLY_END_MAX_POSITION_AGE_SECONDS);
  const maxAgeMs = (Number.isFinite(configuredAge) && configuredAge > 0 ? configuredAge : DEFAULT_MAX_POSITION_AGE_SECONDS) * 1000;
  if (!destination || !end || !Number.isFinite(received) || received <= 0 || nowMs - received > maxAgeMs || received > nowMs + 5000) {
    return { qualified: false, reviewRequired: true, reason: 'DESTINATION_EVIDENCE_UNAVAILABLE' };
  }
  const detected = resolveRideEarlyEnd({ endLocation: end, destinationLocation: destination, env });
  return {
    qualified: !detected,
    reviewRequired: false,
    reason: detected ? 'EARLY_END' : 'SERVER_DESTINATION_COMPLETION',
    telemetryReceivedAtMs: received
  };
}

module.exports = { assessDestinationCompletion };
