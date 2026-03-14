const state = {
  totalRequests: 0,
  totalBytes: 0,
  lastRequestAt: null,
  lastRequestBytes: 0,
  lastStatusCode: 0
};

function recordIngest(bytes = 0, statusCode = 200) {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  state.totalRequests += 1;
  state.totalBytes += safeBytes;
  state.lastRequestBytes = safeBytes;
  state.lastRequestAt = new Date().toISOString();
  state.lastStatusCode = statusCode;
}

function getStatus() {
  return {
    enabled: process.env.OTEL_ENABLED !== 'false',
    endpoint: process.env.TEMPO_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || `http://127.0.0.1:${process.env.PORT || 3001}/otel`,
    ingest: {
      totalRequests: state.totalRequests,
      totalBytes: state.totalBytes,
      lastRequestAt: state.lastRequestAt,
      lastRequestBytes: state.lastRequestBytes,
      lastStatusCode: state.lastStatusCode
    }
  };
}

module.exports = {
  recordIngest,
  getStatus
};

