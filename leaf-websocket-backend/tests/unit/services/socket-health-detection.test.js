const { computePercentile, parseLatencies, detectSessionIdUnknown } = require('../../../scripts/tests/smoke-socket-health.cjs');

describe('computePercentile', () => {
  test('returns 0 for empty array', () => {
    expect(computePercentile([], 95)).toBe(0);
  });

  test('returns correct median for odd-length array', () => {
    expect(computePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  test('returns correct p95', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    const p95 = computePercentile(values, 95);
    expect(p95).toBeGreaterThan(180);
    expect(p95).toBeLessThanOrEqual(200);
  });

  test('returns correct p99', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const p99 = computePercentile(values, 99);
    expect(p99).toBeGreaterThanOrEqual(99);
    expect(p99).toBeLessThanOrEqual(100);
  });

  test('handles single element', () => {
    expect(computePercentile([42], 50)).toBe(42);
    expect(computePercentile([42], 95)).toBe(42);
    expect(computePercentile([42], 99)).toBe(42);
  });

  test('clamps index within bounds', () => {
    expect(computePercentile([10, 20], 99)).toBe(20);
  });
});

describe('parseLatencies', () => {
  test('returns null for empty or all-null samples', () => {
    expect(parseLatencies([])).toBeNull();
    expect(parseLatencies([{ latencyMs: null }, { latencyMs: undefined }])).toBeNull();
  });

  test('computes all stats for valid samples', () => {
    const result = parseLatencies([
      { latencyMs: 10 },
      { latencyMs: 20 },
      { latencyMs: 30 },
      { latencyMs: 40 },
      { latencyMs: 50 }
    ]);
    expect(result).toEqual({
      min: 10,
      max: 50,
      avg: 30,
      median: 30,
      p95: 50,
      p99: 50,
      count: 5
    });
  });

  test('filters out non-finite values', () => {
    const result = parseLatencies([
      { latencyMs: 100 },
      { latencyMs: null },
      { latencyMs: 200 },
      { latencyMs: undefined },
      { latencyMs: 'bad' }
    ]);
    expect(result.count).toBe(2);
    expect(result.min).toBe(100);
    expect(result.max).toBe(200);
  });

  test('sorts values correctly', () => {
    const result = parseLatencies([
      { latencyMs: 500 },
      { latencyMs: 50 },
      { latencyMs: 5 }
    ]);
    expect(result.min).toBe(5);
    expect(result.max).toBe(500);
    expect(result.avg).toBe(185);
    expect(result.median).toBe(50);
  });
});

describe('detectSessionIdUnknown', () => {
  test('returns detected=false for empty input', () => {
    expect(detectSessionIdUnknown('')).toEqual({ detected: false });
    expect(detectSessionIdUnknown(null)).toEqual({ detected: false });
    expect(detectSessionIdUnknown(undefined)).toEqual({ detected: false });
  });

  test('detects "Session ID unknown" in various cases', () => {
    expect(detectSessionIdUnknown('{"code": "Session ID unknown"}')).toEqual({ detected: true, match: 'Session ID unknown' });
    expect(detectSessionIdUnknown('session id unknown')).toEqual({ detected: true, match: 'session id unknown' });
    expect(detectSessionIdUnknown('SESSION ID UNKNOWN')).toEqual({ detected: true, match: 'SESSION ID UNKNOWN' });
  });

  test('detects "unknown session" pattern', () => {
    expect(detectSessionIdUnknown('unknown session')).toEqual({ detected: true, match: 'unknown session' });
    expect(detectSessionIdUnknown('UNKNOWN SESSION')).toEqual({ detected: true, match: 'UNKNOWN SESSION' });
  });

  test('detects "sid unknown" pattern', () => {
    expect(detectSessionIdUnknown('sid unknown')).toEqual({ detected: true, match: 'sid unknown' });
  });

  test('detects "invalid sid" pattern', () => {
    expect(detectSessionIdUnknown('invalid sid')).toEqual({ detected: true, match: 'invalid sid' });
  });

  test('detects "invalid session" pattern', () => {
    expect(detectSessionIdUnknown('invalid session')).toEqual({ detected: true, match: 'invalid session' });
  });

  test('does not false-positive on harmless text', () => {
    expect(detectSessionIdUnknown('normal connection established')).toEqual({ detected: false });
    expect(detectSessionIdUnknown('{"status": "ok", "sid": "abc123"}')).toEqual({ detected: false });
    expect(detectSessionIdUnknown('transport error: websocket')).toEqual({ detected: false });
  });

  test('detects in JSON error responses', () => {
    const json = JSON.stringify({ code: 'SESSION_ID_UNKNOWN', message: 'Session ID unknown for this transport' });
    expect(detectSessionIdUnknown(json)).toEqual({ detected: true, match: 'Session ID unknown' });
  });

  test('detects in Engine.IO error format', () => {
    expect(detectSessionIdUnknown('{"code":1,"message":"Session ID unknown"}')).toEqual({ detected: true, match: 'Session ID unknown' });
  });
});
