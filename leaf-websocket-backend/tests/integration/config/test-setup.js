/**
 * Test Setup for Integration Tests
 */

const dotenv = require('dotenv');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

dotenv.config({ path: '.env' });
process.env.NODE_ENV = 'test';

let testServer = null;
let io = null;
let activePort = 3001;

function buildTestApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        redis: { status: 'healthy' },
        firebase: { status: 'warning' },
        websocket: { status: 'healthy' },
        system: { status: 'healthy' }
      }
    });
  });

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        redis: { status: 'healthy' },
        firebase: { status: 'warning' },
        websocket: { status: 'healthy' },
        system: { status: 'healthy' }
      }
    });
  });

  app.get('/api/stats', (_req, res) => {
    res.status(200).json({
      redis: { connected: true, operations: 0 },
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  });

  app.get('/api/get_redis_stats', (_req, res) => {
    res.status(200).json({
      redis_info: { status: 'ok' },
      connections: 0,
      memory: 0
    });
  });

  return app;
}

function setupSocketHandlers(socket) {
  socket.on('ping', () => socket.emit('pong', { ok: true }));
  socket.on('echo', (payload) => socket.emit('echo_response', payload));
  socket.on('driver_online', (payload) => socket.emit('driver_online_ack', { success: true, driverId: payload.driverId }));
  socket.on('update_driver_location', () => socket.emit('location_update_ack', { success: true }));
  socket.on('driver_offline', () => socket.emit('driver_offline_ack', { success: true }));
  socket.on('request_ride', () => socket.emit('ride_requested_ack', { success: true, rideId: `ride-${Date.now()}` }));
  socket.on('update_passenger_location', () => socket.emit('passenger_location_ack', { success: true }));
  socket.on('accept_ride', (payload) => socket.emit('ride_accepted', { rideId: payload.rideId, driverId: payload.driverId }));
  socket.on('reject_ride', () => socket.emit('ride_rejected_ack', { success: true }));
  socket.on('complete_ride', (payload) => socket.emit('ride_completed_ack', { success: true, rideId: payload.rideId }));
  socket.on('search_drivers', () => socket.emit('nearby_drivers', []));
  socket.on('send_message', () => socket.emit('chat_message_ack', { success: true }));
  socket.on('ride_status_changed', (payload) => socket.emit('ride_status_update', payload));
}

async function startTestServer(port = 3001) {
  if (testServer) {
    return testServer;
  }

  activePort = port;
  const app = buildTestApp();
  testServer = http.createServer(app);
  io = socketIo(testServer, {
    transports: ['websocket', 'polling'],
    cors: { origin: true }
  });
  io.on('connection', setupSocketHandlers);

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      testServer.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      testServer.off('error', onError);
      resolve();
    };
    testServer.once('error', onError);
    testServer.once('listening', onListening);
    testServer.listen(port, '127.0.0.1');
  });

  return testServer;
}

async function stopTestServer() {
  if (io) {
    await new Promise((resolve) => io.close(() => resolve()));
    io = null;
  }
  if (testServer) {
    await new Promise((resolve, reject) => {
      testServer.close((err) => {
        if (err && !String(err.message).includes('Server is not running')) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    testServer = null;
  }
}

async function testRequest(method, url, options = {}) {
  const targetUrl = url.startsWith('http') ? url : `http://127.0.0.1:${activePort}${url}`;
  const config = {
    method: method.toUpperCase(),
    url: targetUrl,
    ...options
  };

  try {
    const response = await axios(config);
    return {
      status: response.status,
      data: response.data,
      headers: response.headers
    };
  } catch (error) {
    if (error.response) {
      return {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
        error: true
      };
    }
    throw error;
  }
}

function createWebSocketClient(port = activePort) {
  const ioClient = require('socket.io-client');
  return ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket', 'polling'],
    timeout: 5000,
    forceNew: true
  });
}

function waitForEvent(socket, eventName, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });

    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

global.startTestServer = startTestServer;
global.stopTestServer = stopTestServer;
global.testRequest = testRequest;
global.createWebSocketClient = createWebSocketClient;
global.waitForEvent = waitForEvent;

module.exports = {
  startTestServer,
  stopTestServer,
  testRequest,
  createWebSocketClient,
  waitForEvent
};
