const mockRedis = {
  zrange: jest.fn(),
  eval: jest.fn(),
  zcard: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn()
};

const mockRecordPersistedTransitionSideEffects = jest.fn();
const mockRecordEvent = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../utils/geohash-utils', () => ({
  getRegionHashFromLocation: jest.fn(() => 'region-a')
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    PENDING: 'PENDING',
    SEARCHING: 'SEARCHING',
    AWAITING_PAYMENT: 'AWAITING_PAYMENT'
  },
  recordPersistedTransitionSideEffects: mockRecordPersistedTransitionSideEffects
}));

jest.mock('../../../services/event-sourcing', () => ({
  EVENT_TYPES: {
    RIDE_DEQUEUED: 'ride.dequeued'
  },
  recordEvent: mockRecordEvent
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  BOOKING_VISIBILITY_TTL_SEC: 60,
  getVisibleBookingKey: jest.fn((bookingId) => `booking_visible:${bookingId}`)
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

const rideQueueManager = require('../../../services/ride-queue-manager');

describe('ride-queue-manager atomic pending claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.zrange.mockResolvedValue(['booking-1']);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    mockRecordEvent.mockResolvedValue(undefined);
    mockRecordPersistedTransitionSideEffects.mockResolvedValue(true);
  });

  it('claims pending, active snapshot and SEARCHING state in one Lua evaluation', async () => {
    mockRedis.eval.mockResolvedValue(['claimed', 'PENDING']);

    const processed = await rideQueueManager.processNextRides('region-a', 1);

    expect(processed).toEqual(['booking-1']);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("cjson.encode(activeSnapshot)"),
      3,
      'ride_queue:region-a:pending',
      'ride_queue:region-a:active',
      'booking:booking-1',
      'booking-1',
      expect.any(String),
      'PENDING',
      'SEARCHING'
    );
    expect(mockRecordPersistedTransitionSideEffects).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({
        bookingId: 'booking-1',
        currentState: 'PENDING',
        newState: 'SEARCHING',
        updatedAt: expect.any(String)
      })
    );
    expect(mockRecordEvent).toHaveBeenCalledWith('ride.dequeued', {
      bookingId: 'booking-1',
      region: 'region-a'
    });
  });

  it('lets only one concurrent processor claim the same pending ride', async () => {
    mockRedis.eval
      .mockResolvedValueOnce(['claimed', 'PENDING'])
      .mockResolvedValueOnce(['not_pending', '']);

    const [first, second] = await Promise.all([
      rideQueueManager.processNextRides('region-a', 1),
      rideQueueManager.processNextRides('region-a', 1)
    ]);

    expect([first, second]).toEqual(expect.arrayContaining([['booking-1'], []]));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordPersistedTransitionSideEffects).toHaveBeenCalledTimes(1);
  });

  it('removes an ineligible pending entry without treating it as processed', async () => {
    mockRedis.eval.mockResolvedValue(['ineligible', 'CANCELED']);

    const processed = await rideQueueManager.processNextRides('region-a', 1);

    expect(processed).toEqual([]);
    expect(mockRecordEvent).not.toHaveBeenCalled();
    expect(mockRecordPersistedTransitionSideEffects).not.toHaveBeenCalled();
  });

  it('does not emit a duplicate state transition for an already SEARCHING ride', async () => {
    mockRedis.eval.mockResolvedValue(['claimed', 'SEARCHING']);

    const processed = await rideQueueManager.processNextRides('region-a', 1);

    expect(processed).toEqual(['booking-1']);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordPersistedTransitionSideEffects).not.toHaveBeenCalled();
  });

  it('keeps a persisted claim processable when an audit side effect fails', async () => {
    mockRedis.eval.mockResolvedValue(['claimed', 'PENDING']);
    mockRecordEvent.mockImplementation(() => {
      throw new Error('event store unavailable');
    });

    const processed = await rideQueueManager.processNextRides('region-a', 1);

    expect(processed).toEqual(['booking-1']);
    expect(mockRecordPersistedTransitionSideEffects).toHaveBeenCalledTimes(1);
  });
});
