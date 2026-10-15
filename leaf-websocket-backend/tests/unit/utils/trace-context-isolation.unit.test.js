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

describe('traceContext.setCurrentTraceId', () => {
  test('never renames the trace of other work that shares the same context', async () => {
    const seen = {};
    await traceContext.runWithTraceId('trace-parent', async () => {
      // Socket events and timers started from the same parent share its store;
      // a handler calling setCurrentTraceId used to rename all of them.
      const other = (async () => { await tick(20); seen.other = traceContext.getCurrentTraceId(); })();
      (async () => { traceContext.setCurrentTraceId('trace-handler'); })();
      await other;
      seen.parent = traceContext.getCurrentTraceId();
      // The supported way to scope a trace:
      seen.scoped = await traceContext.runWithTraceId('trace-handler', async () => traceContext.getCurrentTraceId());
    });

    expect(seen).toEqual({ other: 'trace-parent', parent: 'trace-parent', scoped: 'trace-handler' });
  });

  test('a timer created inside a request keeps its own trace after another handler sets one', async () => {
    let timerTrace = null;
    await traceContext.runWithTraceId('trace-request', async () => {
      setTimeout(() => { timerTrace = traceContext.getCurrentTraceId(); }, 15);
    });
    await traceContext.runWithTraceId('trace-other', async () => {
      traceContext.setCurrentTraceId('trace-renamed');
    });
    await tick(30);

    expect(timerTrace).toBe('trace-request');
  });
});
