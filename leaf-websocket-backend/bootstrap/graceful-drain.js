// Drain de um gateway antes de sair, para o deploy não derrubar ninguém.
//
// O deploy tira este gateway do nginx antes de mandar o SIGTERM. Aqui o processo:
// 1. para de aceitar conexões HTTP novas e fecha as keep-alive ociosas;
// 2. espera alguns segundos para as requisições em andamento terminarem;
// 3. fecha os WebSockets em lotes. Fecha o transporte (socket.conn.close()) e não
//    chama socket.disconnect(): o cliente vê "transport close" e reconecta sozinho
//    no outro gateway. Com "io server disconnect" o cliente Socket.IO não reconecta.
// O readiness responde 503 durante o drain (process.__leafIsShuttingDown).

function readInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function drainSettingsFromEnv(env = process.env) {
  return {
    delayMs: readInt(env.SHUTDOWN_DRAIN_DELAY_MS, 3000, 0, 15000),
    batchPercent: readInt(env.SHUTDOWN_SOCKET_BATCH_PERCENT, 10, 1, 100),
    batchIntervalMs: readInt(env.SHUTDOWN_SOCKET_BATCH_INTERVAL_MS, 1000, 0, 5000),
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function localSockets(io) {
  const sockets = io?.of?.('/')?.sockets;
  if (!sockets || typeof sockets.values !== 'function') return [];
  return Array.from(sockets.values());
}

function closeTransport(socket) {
  if (socket?.conn && typeof socket.conn.close === 'function') {
    socket.conn.close();
    return true;
  }
  return false;
}

async function drainConnections({
  io,
  server,
  logStructured = () => {},
  settings = drainSettingsFromEnv(),
  sleep = defaultSleep,
} = {}) {
  const startedAt = Date.now();

  if (server && typeof server.close === 'function') {
    try {
      server.close();
    } catch (_) {
      // Já fechado: segue o drain dos sockets.
    }
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  }

  if (settings.delayMs > 0) await sleep(settings.delayMs);

  const sockets = localSockets(io);
  const batchSize = Math.max(1, Math.ceil((sockets.length * settings.batchPercent) / 100));
  let closed = 0;
  for (let index = 0; index < sockets.length; index += batchSize) {
    for (const socket of sockets.slice(index, index + batchSize)) {
      if (closeTransport(socket)) closed += 1;
    }
    const isLastBatch = index + batchSize >= sockets.length;
    if (!isLastBatch && settings.batchIntervalMs > 0) await sleep(settings.batchIntervalMs);
  }

  const result = { sockets: sockets.length, closed, batchSize, durationMs: Date.now() - startedAt };
  logStructured('info', 'Drain do gateway concluído', { service: 'server', ...result });
  return result;
}

module.exports = { drainConnections, drainSettingsFromEnv };
