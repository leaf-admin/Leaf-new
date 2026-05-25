const mockInitialize = jest.fn();
const mockSocketIORedisAdapter = jest.fn(() => ({
  initialize: mockInitialize
}));

jest.mock('../../../services/socket-io-adapter', () => mockSocketIORedisAdapter);

const createSocketServer = require('../../../bootstrap/create-socket-server');

function createHarness() {
  const io = {
    engine: {
      on: jest.fn(),
      clientsCount: 0
    },
    adapter: jest.fn()
  };
  const socketIo = jest.fn(() => io);
  const app = {
    set: jest.fn(),
    locals: {}
  };
  const logStructured = jest.fn();

  return {
    io,
    socketIo,
    app,
    logStructured
  };
}

describe('create-socket-server Redis adapter status', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.ENABLE_SOCKETIO_REDIS_ADAPTER;
    delete process.env.REQUIRE_SOCKETIO_REDIS_ADAPTER;
    delete process.env.RUNTIME_ROLE;
    delete global.socketIoRedisAdapterStatus;
    delete global.socketIoRedisAdapter;
    delete global.io;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    delete global.socketIoRedisAdapterStatus;
    delete global.socketIoRedisAdapter;
    delete global.io;
  });

  test('publishes disabled adapter status when modular runtime leaves adapter off', () => {
    const harness = createHarness();

    createSocketServer({
      server: {},
      socketIo: harness.socketIo,
      corsOptions: { origin: true },
      app: harness.app,
      logStructured: harness.logStructured
    });

    expect(global.socketIoRedisAdapterStatus).toMatchObject({
      state: 'disabled',
      enabled: false,
      required: false,
      runtimeRole: 'gateway'
    });
    expect(mockSocketIORedisAdapter).not.toHaveBeenCalled();
  });

  test('marks disabled adapter as required for production gateway defaults', () => {
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE = 'gateway';
    const harness = createHarness();

    createSocketServer({
      server: {},
      socketIo: harness.socketIo,
      corsOptions: { origin: true },
      app: harness.app,
      logStructured: harness.logStructured
    });

    expect(global.socketIoRedisAdapterStatus).toMatchObject({
      state: 'disabled',
      enabled: false,
      required: true,
      runtimeRole: 'gateway'
    });
  });

  test('publishes ready adapter status after successful initialization', async () => {
    process.env.ENABLE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.REQUIRE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.RUNTIME_ROLE = 'gateway';
    mockInitialize.mockResolvedValueOnce(undefined);
    const harness = createHarness();

    createSocketServer({
      server: {},
      socketIo: harness.socketIo,
      corsOptions: { origin: true },
      app: harness.app,
      logStructured: harness.logStructured
    });

    expect(global.socketIoRedisAdapterStatus).toMatchObject({
      state: 'initializing',
      enabled: true,
      required: true,
      runtimeRole: 'gateway'
    });

    await Promise.resolve();

    expect(global.socketIoRedisAdapterStatus).toMatchObject({
      state: 'ready',
      enabled: true,
      required: true,
      runtimeRole: 'gateway'
    });
    expect(harness.app.locals.socketIoRedisAdapter).toBeTruthy();
  });

  test('publishes failed adapter status when initialization rejects', async () => {
    process.env.ENABLE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.REQUIRE_SOCKETIO_REDIS_ADAPTER = 'true';
    process.env.RUNTIME_ROLE = 'gateway';
    mockInitialize.mockRejectedValueOnce(new Error('redis down'));
    const harness = createHarness();

    createSocketServer({
      server: {},
      socketIo: harness.socketIo,
      corsOptions: { origin: true },
      app: harness.app,
      logStructured: harness.logStructured
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(global.socketIoRedisAdapterStatus).toMatchObject({
      state: 'failed',
      enabled: true,
      required: true,
      runtimeRole: 'gateway',
      error: 'redis down'
    });
    expect(harness.logStructured).toHaveBeenCalledWith(
      'error',
      'Falha ao ativar Socket.IO Redis Adapter no processo realtime',
      expect.objectContaining({
        error: 'redis down',
        runtimeRole: 'gateway'
      })
    );
  });
});
