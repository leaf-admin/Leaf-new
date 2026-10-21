const { drainConnections, drainSettingsFromEnv } = require('../../../bootstrap/graceful-drain');

function fakeSocket(id) {
  return { id, conn: { close: jest.fn() }, disconnect: jest.fn() };
}

function fakeIo(sockets) {
  const map = new Map(sockets.map((socket) => [socket.id, socket]));
  return { of: () => ({ sockets: map }) };
}

describe('graceful drain', () => {
  it('stops new HTTP, waits for in-flight requests, then closes sockets in batches', async () => {
    const order = [];
    const server = {
      close: jest.fn(() => order.push('close')),
      closeIdleConnections: jest.fn(() => order.push('idle')),
    };
    const sockets = Array.from({ length: 25 }, (_, index) => fakeSocket(`s${index}`));
    const sleep = jest.fn(async (ms) => order.push(`sleep:${ms}`));

    const result = await drainConnections({
      io: fakeIo(sockets),
      server,
      settings: { delayMs: 3000, batchPercent: 10, batchIntervalMs: 1000 },
      sleep,
    });

    expect(order.slice(0, 3)).toEqual(['close', 'idle', 'sleep:3000']);
    expect(result).toMatchObject({ sockets: 25, closed: 25, batchSize: 3 });
    // 9 lotes de até 3: 8 pausas entre eles, nenhuma depois do último.
    expect(sleep.mock.calls.filter(([ms]) => ms === 1000)).toHaveLength(8);
  });

  it('closes the transport so clients reconnect, never a server disconnect', async () => {
    const socket = fakeSocket('a');
    await drainConnections({
      io: fakeIo([socket]),
      server: null,
      settings: { delayMs: 0, batchPercent: 100, batchIntervalMs: 0 },
      sleep: jest.fn(),
    });
    expect(socket.conn.close).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('works with no io and no sockets', async () => {
    const result = await drainConnections({ io: undefined, server: undefined, settings: { delayMs: 0, batchPercent: 10, batchIntervalMs: 0 }, sleep: jest.fn() });
    expect(result).toMatchObject({ sockets: 0, closed: 0 });
  });

  it('reads and clamps the settings from env', () => {
    expect(drainSettingsFromEnv({})).toEqual({ delayMs: 3000, batchPercent: 10, batchIntervalMs: 1000 });
    expect(drainSettingsFromEnv({
      SHUTDOWN_DRAIN_DELAY_MS: '999999',
      SHUTDOWN_SOCKET_BATCH_PERCENT: '0',
      SHUTDOWN_SOCKET_BATCH_INTERVAL_MS: 'x',
    })).toEqual({ delayMs: 15000, batchPercent: 1, batchIntervalMs: 1000 });
  });
});
