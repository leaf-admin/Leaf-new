const startLoop = require('../../../utils/bounded-work-loop');

describe('existing outbox loop under load', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('slow database work never overlaps and busy retry begins only after completion', async () => {
    let release; const run = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const loop = startLoop({ run, idleMs: 10000, productive: value => value.processed > 0 });
    await jest.advanceTimersByTimeAsync(10000); expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30000); expect(run).toHaveBeenCalledTimes(1);
    release({ processed: 30 }); await Promise.resolve();
    await jest.advanceTimersByTimeAsync(249); expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    loop.stop(); release({ processed: 30 }); await jest.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('120 pending tasks drain through the same bounded30 batch then return to idle', async () => {
    let pending = 120; const counts = [];
    const run = jest.fn(async () => { const processed = Math.min(30, pending); pending -= processed; counts.push(processed); return { processed }; });
    const loop = startLoop({ run, idleMs: 10000, productive: result => result.processed > 0 });
    await jest.advanceTimersByTimeAsync(11000);
    expect(counts).toEqual([30, 30, 30, 30, 0]); expect(pending).toBe(0);
    await jest.advanceTimersByTimeAsync(9999); expect(run).toHaveBeenCalledTimes(5);
    loop.stop();
  });

  test('disabled adaptive mode keeps the existing idle cadence', async () => {
    const run = jest.fn(async () => ({ processed: 30 }));
    const loop = startLoop({ run, idleMs: 10000 });
    await jest.advanceTimersByTimeAsync(19999); expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2); loop.stop();
  });

  test('errors back off and reporting failure does not terminate the loop', async () => {
    const run = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const loop = startLoop({ run, idleMs: 10000, onError: () => { throw new Error('logger unavailable'); } });
    await jest.advanceTimersByTimeAsync(20000); expect(run).toHaveBeenCalledTimes(2); loop.stop();
  });
});
