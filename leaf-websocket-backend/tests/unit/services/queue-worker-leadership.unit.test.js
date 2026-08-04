const mockRedis = {
  get: jest.fn(),
  hgetall: jest.fn()
};

const mockRideQueueManager = {
  getActiveRegions: jest.fn(),
  processNextRides: jest.fn(),
  dequeueRide: jest.fn()
};
const mockStartGradualSearch = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));
jest.mock('../../../services/ride-queue-manager', () => mockRideQueueManager);
jest.mock('../../../services/gradual-radius-expander', () => jest.fn().mockImplementation(() => ({
  startGradualSearch: mockStartGradualSearch
})));
jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    SEARCHING: 'SEARCHING',
    EXPANDED: 'EXPANDED',
    PENDING: 'PENDING'
  },
  isTerminalStateValue: jest.fn(() => false),
  getBookingState: jest.fn(),
  updateBookingState: jest.fn()
}));
jest.mock('../../../services/event-sourcing', () => ({
  EVENT_TYPES: { QUEUE_PROCESSED: 'queue.processed' },
  recordEvent: jest.fn()
}));
jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));
jest.mock('../../../workers/worker-consumer-identity', () => ({
  buildWorkerConsumerName: jest.fn(() => 'queue-worker:test-host:1')
}));

const QueueWorker = require('../../../services/queue-worker');
const RideStateManager = require('../../../services/ride-state-manager');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('QueueWorker distributed leadership', () => {
  let leaderLease;

  beforeEach(() => {
    jest.clearAllMocks();
    leaderLease = {
      isHeld: jest.fn(() => false),
      acquire: jest.fn(),
      assertHeld: jest.fn(),
      release: jest.fn().mockResolvedValue(true)
    };
  });

  test('a passive replica never processes queues', async () => {
    leaderLease.acquire.mockResolvedValue(false);
    const worker = new QueueWorker({}, { leaderLease });
    worker.processAllQueues = jest.fn();

    await worker.runProcessingCycle();

    expect(leaderLease.acquire).toHaveBeenCalledTimes(1);
    expect(worker.processAllQueues).not.toHaveBeenCalled();
  });

  test('the elected replica validates leadership while processing', async () => {
    leaderLease.acquire.mockResolvedValue(true);
    leaderLease.assertHeld.mockResolvedValue(true);
    const worker = new QueueWorker({}, { leaderLease });
    worker.processAllQueues = jest.fn(async ({ leadershipGuard }) => {
      await expect(leadershipGuard()).resolves.toBe(true);
    });

    await worker.runProcessingCycle();

    expect(worker.processAllQueues).toHaveBeenCalledTimes(1);
    expect(leaderLease.assertHeld).toHaveBeenCalledTimes(1);
  });

  test('does not overlap local cycles when processing exceeds the interval', async () => {
    leaderLease.acquire.mockResolvedValue(true);
    const worker = new QueueWorker({}, { leaderLease });
    const gate = deferred();
    worker.isRunning = true;
    worker.runProcessingCycle = jest.fn(() => gate.promise);

    const firstCycle = worker.scheduleProcessingCycle();
    const secondCycle = worker.scheduleProcessingCycle();

    expect(secondCycle).toBe(firstCycle);
    expect(worker.runProcessingCycle).toHaveBeenCalledTimes(1);

    gate.resolve();
    await firstCycle;
    expect(worker.cycleInFlight).toBeNull();
  });

  test('stops before the next region when leadership is lost', async () => {
    const worker = new QueueWorker({}, { leaderLease });
    worker.getActiveRegions = jest.fn().mockResolvedValue(['region-a', 'region-b']);
    worker.processRegionQueue = jest.fn().mockResolvedValue(undefined);
    const leadershipGuard = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await worker.processAllQueues({ leadershipGuard });

    expect(worker.processRegionQueue).toHaveBeenCalledTimes(1);
    expect(worker.processRegionQueue).toHaveBeenCalledWith('region-a', { leadershipGuard });
  });

  test('drains a batch already claimed before leadership is lost', async () => {
    let leadershipHeld = true;
    mockRideQueueManager.processNextRides.mockImplementation(async () => {
      leadershipHeld = false;
      return ['booking-a', 'booking-b'];
    });
    RideStateManager.getBookingState.mockResolvedValue('SEARCHING');
    mockRedis.hgetall
      .mockResolvedValueOnce({ pickupLocation: '{"lat":-22.9,"lng":-43.2}' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ pickupLocation: '{"lat":-22.91,"lng":-43.21}' })
      .mockResolvedValueOnce({});
    const leadershipGuard = jest.fn(async () => leadershipHeld);
    const worker = new QueueWorker({}, { leaderLease });

    await worker.processRegionQueue('region-a', { leadershipGuard });

    expect(leadershipGuard).toHaveBeenCalledTimes(1);
    expect(mockStartGradualSearch).toHaveBeenCalledTimes(2);
    expect(mockStartGradualSearch).toHaveBeenNthCalledWith(
      1,
      'booking-a',
      { lat: -22.9, lng: -43.2 }
    );
    expect(mockStartGradualSearch).toHaveBeenNthCalledWith(
      2,
      'booking-b',
      { lat: -22.91, lng: -43.21 }
    );
  });

  test('stop releases the lease for immediate failover', async () => {
    const worker = new QueueWorker({}, { leaderLease });
    worker.isRunning = true;

    await worker.stop();

    expect(leaderLease.release).toHaveBeenCalledTimes(1);
    expect(worker.isRunning).toBe(false);
  });
});
