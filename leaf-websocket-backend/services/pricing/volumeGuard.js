const REQUEST_VOLUME_DROP_ALERT_THRESHOLD_PERCENT = 30;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evaluateRequestVolume({
  currentRequests5m,
  expectedRequests5m,
  thresholdPercent = REQUEST_VOLUME_DROP_ALERT_THRESHOLD_PERCENT
} = {}) {
  const current = Math.max(0, toNumber(currentRequests5m, 0));
  const expectedValue = toNumber(expectedRequests5m, NaN);
  const threshold = Math.max(0, toNumber(thresholdPercent, REQUEST_VOLUME_DROP_ALERT_THRESHOLD_PERCENT));
  const baselineAvailable = Number.isFinite(expectedValue) && expectedValue > 0;

  if (!baselineAvailable) {
    return {
      current5m: current,
      expected5m: null,
      baselineAvailable: false,
      dropPercent: 0,
      thresholdPercent: threshold,
      alert: false,
      source: 'expected_requests_5m_unavailable'
    };
  }

  const expected = Math.max(0, expectedValue);
  const dropPercent = current < expected
    ? Number((((expected - current) / expected) * 100).toFixed(2))
    : 0;

  return {
    current5m: current,
    expected5m: expected,
    baselineAvailable: true,
    dropPercent,
    thresholdPercent: threshold,
    alert: dropPercent > threshold,
    source: 'active_requests_5m_vs_expected_requests_5m'
  };
}

module.exports = {
  REQUEST_VOLUME_DROP_ALERT_THRESHOLD_PERCENT,
  evaluateRequestVolume
};
