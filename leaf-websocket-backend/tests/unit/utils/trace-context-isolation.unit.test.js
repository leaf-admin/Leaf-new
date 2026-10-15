const traceContext = require('../../../utils/trace-context');

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('traceContext.runWithTraceId', () => {
  test('keeps each concurrent request on its own trace id', async () => {
    const seen = {};
    const handler = (name, waitMs) => traceContext.runWithTraceId(`trace-${name}`, async () => {
      await tick(waitMs);
      seen[name] = traceContext.getCurrentTraceId();
    });

    // A reads while B is still running: with a shared global, A read B's id
    // and B lost its own when A's cleanup restored the previous value.
    await Promise.all([handler('A', 5), handler('B', 30)]);
    expect(seen).toEqual({ A: 'trace-A', B: 'trace-B' });

    await Promise.all([handler('A', 30), handler('B', 5)]);
    expect(seen).toEqual({ A: 'trace-A', B: 'trace-B' });
  });

  test('returns the callback result and leaves no trace id behind', async () => {
    const result = await traceContext.runWithTraceId('trace-result', async () => 42);

    expect(result).toBe(42);
    expect(traceContext.getCurrentTraceId()).toBeNull();
  });

  test('generates a trace id when none is given', async () => {
    const id = await traceContext.runWithTraceId(null, async () => traceContext.getCurrentTraceId());

    expect(id).toMatch(/^req-\d+-[0-9a-f]{8}$/);
  });
});
