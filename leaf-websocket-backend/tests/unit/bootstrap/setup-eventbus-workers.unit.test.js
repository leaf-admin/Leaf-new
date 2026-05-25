const setupEventBusAndWorkers = require('../../../bootstrap/setup-eventbus-workers');

function createHarness() {
  return {
    io: {},
    eventBus: { publish: jest.fn() },
    setupListeners: jest.fn(() => ({ publish: jest.fn() })),
    redisPool: {
      ensureConnection: jest.fn().mockResolvedValue(undefined)
    },
    WorkerManager: jest.fn(function WorkerManagerMock() {
      this.consumerName = 'server-worker-test';
      this.registerListener = jest.fn();
      this.initialize = jest.fn().mockResolvedValue(true);
      this.start = jest.fn(() => Promise.resolve());
    }),
    EVENT_TYPES: {
      RIDE_REQUESTED: 'ride.requested',
      RIDE_ACCEPTED: 'ride.accepted',
      RIDE_STARTED: 'ride.started',
      RIDE_CANCELED: 'ride.canceled'
    },
    logStructured: jest.fn(),
    logError: jest.fn()
  };
}

describe('setupEventBusAndWorkers', () => {
  test('does not start embedded workers when disabled', () => {
    const harness = createHarness();
    const eventBus = { publish: jest.fn() };
    harness.setupListeners.mockReturnValue(eventBus);

    const result = setupEventBusAndWorkers({
      ...harness,
      enableEmbeddedListenerWorkers: false
    });

    expect(result).toEqual({ eventBus, workerManager: null });
    expect(harness.setupListeners).toHaveBeenCalledWith(harness.io);
    expect(harness.WorkerManager).not.toHaveBeenCalled();
    expect(harness.redisPool.ensureConnection).not.toHaveBeenCalled();
    expect(harness.logStructured).toHaveBeenCalledWith(
      'info',
      'WorkerManager embutido desabilitado; side effects serão processados pelo worker dedicado',
      expect.objectContaining({ phase: 'workers' })
    );
  });

  test('starts embedded workers only when explicitly enabled', async () => {
    const harness = createHarness();

    const result = setupEventBusAndWorkers({
      ...harness,
      enableEmbeddedListenerWorkers: true
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(result.eventBus).toBeTruthy();
    expect(harness.redisPool.ensureConnection).toHaveBeenCalledTimes(1);
    expect(harness.WorkerManager).toHaveBeenCalledTimes(1);
    const workerManager = harness.WorkerManager.mock.instances[0];
    expect(workerManager.registerListener).toHaveBeenCalledTimes(4);
    expect(workerManager.initialize).toHaveBeenCalledTimes(1);
    expect(workerManager.start).toHaveBeenCalledTimes(1);
  });
});
