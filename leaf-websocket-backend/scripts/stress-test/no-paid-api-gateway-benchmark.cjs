#!/usr/bin/env node
/**
 * Gateway benchmark that avoids paid/external product APIs.
 *
 * It exercises:
 * - HTTP readiness/quick health path through the public gateway
 * - Socket.IO websocket handshakes through the public gateway
 *
 * It intentionally does not create rides, request routes, generate payments,
 * call Firebase Auth, call Google APIs, or call Woovi.
 */

const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const path = require('path');
const tls = require('tls');

let socketIoClient = null;
try {
  ({ io: socketIoClient } = require('socket.io-client'));
} catch (_error) {
  socketIoClient = null;
}

const argv = process.argv.slice(2);

function arg(name, fallback = '') {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : fallback;
}

function argInt(name, fallback) {
  const value = Number.parseInt(arg(name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(latencies, total, failures, durationMs) {
  return {
    total,
    successes: latencies.length,
    failures,
    successRate: total > 0 ? Number(((latencies.length / total) * 100).toFixed(2)) : 0,
    throughputPerSec: durationMs > 0 ? Number(((total / durationMs) * 1000).toFixed(2)) : 0,
    latencyMs: {
      avg: Number(average(latencies).toFixed(2)),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      min: latencies.length ? Math.min(...latencies) : 0,
      max: latencies.length ? Math.max(...latencies) : 0
    }
  };
}

async function withConcurrency(total, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      await worker(index);
    }
  });
  await Promise.all(runners);
}

async function benchmarkHttp({ url, count, concurrency, timeoutMs }) {
  const latencies = [];
  const errors = [];
  const startedAt = Date.now();

  await withConcurrency(count, concurrency, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }
      await response.arrayBuffer();
      latencies.push(Date.now() - started);
    } catch (error) {
      errors.push(error?.message || String(error));
    } finally {
      clearTimeout(timer);
    }
  });

  const durationMs = Date.now() - startedAt;
  return {
    ...summarize(latencies, count, errors.length, durationMs),
    durationMs,
    errorSamples: Array.from(new Set(errors)).slice(0, 8)
  };
}

async function connectSocketOnce({ url, timeoutMs, holdMs, socketOrigin }) {
  if (!socketIoClient) {
    return connectRawEngineSocketOnce({ url, timeoutMs, holdMs, socketOrigin });
  }

  const started = Date.now();
  const socket = socketIoClient(url, {
    transports: ['websocket'],
    reconnection: false,
    timeout: timeoutMs,
    forceNew: true,
    ...(socketOrigin ? { extraHeaders: { Origin: socketOrigin } } : {})
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('socket_timeout'));
      }, timeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });

      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const latencyMs = Date.now() - started;
    if (holdMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
    socket.disconnect();
    return latencyMs;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

async function connectRawEngineSocketOnce({ url, timeoutMs, holdMs, socketOrigin }) {
  const started = Date.now();
  const parsed = new URL(url);
  const isTls = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
  const hostname = parsed.hostname;
  const port = Number(parsed.port || (isTls ? 443 : 80));
  const socketPath = `${parsed.pathname.replace(/\/$/, '') || ''}/socket.io/?EIO=4&transport=websocket`;
  const wsKey = crypto.randomBytes(16).toString('base64');

  return await new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    let socket = null;

    const finish = (error, latencyMs = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        socket.destroy();
      }
      if (error) {
        reject(error);
      } else {
        resolve(latencyMs);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error('raw_socket_timeout'));
    }, timeoutMs);

    const onConnect = () => {
      const request = [
        `GET ${socketPath} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        ...(socketOrigin ? [`Origin: ${socketOrigin}`] : []),
        '',
        ''
      ].join('\r\n');
      socket.write(request);
    };

    socket = isTls
      ? tls.connect({ host: hostname, port, servername: hostname }, onConnect)
      : net.connect({ host: hostname, port }, onConnect);

    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      if (buffer.includes('\r\n\r\n')) {
        if (/^HTTP\/1\.[01] 101 /i.test(buffer)) {
          const latencyMs = Date.now() - started;
          setTimeout(() => finish(null, latencyMs), holdMs);
          return;
        }
        const statusLine = buffer.split('\r\n')[0] || 'unknown_response';
        finish(new Error(statusLine.replace(/\s+/g, '_')));
      }
    });

    socket.on('error', (error) => {
      finish(error);
    });
  });
}

async function benchmarkSockets({ url, count, concurrency, timeoutMs, holdMs, socketOrigin }) {
  const latencies = [];
  const errors = [];
  const startedAt = Date.now();

  await withConcurrency(count, concurrency, async () => {
    try {
      const latency = await connectSocketOnce({ url, timeoutMs, holdMs, socketOrigin });
      latencies.push(latency);
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  });

  const durationMs = Date.now() - startedAt;
  return {
    ...summarize(latencies, count, errors.length, durationMs),
    durationMs,
    heldConnectionMs: holdMs,
    errorSamples: Array.from(new Set(errors)).slice(0, 8)
  };
}

async function main() {
  const baseUrl = String(arg('--url', process.env.BENCHMARK_URL || 'https://api.leaf.app.br')).replace(/\/$/, '');
  const httpPath = arg('--http-path', '/health/quick');
  const httpCount = argInt('--http-count', 600);
  const httpConcurrency = argInt('--http-concurrency', 60);
  const socketCount = argInt('--socket-count', 300);
  const socketConcurrency = argInt('--socket-concurrency', 60);
  const socketHoldMs = argInt('--socket-hold-ms', 200);
  const socketOrigin = arg('--socket-origin', process.env.BENCHMARK_SOCKET_ORIGIN || '');
  const timeoutMs = argInt('--timeout-ms', 10000);
  const label = arg('--label', 'gateway-benchmark');
  const defaultReportPath = path.join(
    __dirname,
    '../../reports',
    `no-paid-api-gateway-benchmark-${label}-${Date.now()}.json`
  );
  const reportPath = arg('--report-path', defaultReportPath);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const config = {
    label,
    baseUrl,
    httpUrl: `${baseUrl}${httpPath}`,
    socketUrl: baseUrl,
    httpCount,
    httpConcurrency,
    socketCount,
    socketConcurrency,
    socketHoldMs,
      timeoutMs,
      socketOrigin: socketOrigin || null,
      socketMode: socketIoClient ? 'socket.io-client' : 'raw-engine-websocket',
      avoidsPaidApis: true
    };

  console.log(JSON.stringify({ event: 'benchmark_started', config }));

  const startedAt = new Date().toISOString();
  const http = await benchmarkHttp({
    url: config.httpUrl,
    count: httpCount,
    concurrency: httpConcurrency,
    timeoutMs
  });
  const sockets = await benchmarkSockets({
    url: config.socketUrl,
    count: socketCount,
    concurrency: socketConcurrency,
    timeoutMs,
    holdMs: socketHoldMs,
    socketOrigin
  });

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    config,
    results: {
      http,
      sockets
    }
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ event: 'benchmark_finished', reportPath, results: report.results }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'benchmark_failed', error: error?.message || String(error) }));
  process.exit(1);
});
