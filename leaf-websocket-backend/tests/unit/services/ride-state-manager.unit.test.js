const RideStateManager = require('../../../services/ride-state-manager');

describe('RideStateManager state machine', () => {
  it('accepts operational interruption and reassignment transitions', () => {
    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.IN_PROGRESS,
        RideStateManager.STATES.INTERRUPTED_OPERATIONAL
      )
    ).toBe(true);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.INTERRUPTED_OPERATIONAL,
        RideStateManager.STATES.REASSIGNMENT_PENDING
      )
    ).toBe(true);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.REASSIGNMENT_PENDING,
        RideStateManager.STATES.ACCEPTED
      )
    ).toBe(true);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.ARRIVED,
        RideStateManager.STATES.REASSIGNED_IN_PROGRESS
      )
    ).toBe(true);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.REASSIGNED_IN_PROGRESS,
        RideStateManager.STATES.CANCELED
      )
    ).toBe(true);
  });

  it('accepts the waiting-response pause during driver offer dispatch', () => {
    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.SEARCHING,
        RideStateManager.STATES.AWAITING_RESPONSE
      )
    ).toBe(true);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.EXPANDED,
        RideStateManager.STATES.AWAITING_RESPONSE
      )
    ).toBe(true);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.REASSIGNMENT_PENDING,
        RideStateManager.STATES.AWAITING_RESPONSE
      )
    ).toBe(true);
  });

  it('blocks invalid transitions after a ride was interrupted or completed', () => {
    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.INTERRUPTED_OPERATIONAL,
        RideStateManager.STATES.COMPLETED
      )
    ).toBe(false);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.EARLY_ENDED_BY_RIDER,
        RideStateManager.STATES.IN_PROGRESS
      )
    ).toBe(false);

    expect(
      RideStateManager.isValidTransition(
        RideStateManager.STATES.INTERRUPTED_OPERATIONAL_ENDED,
        RideStateManager.STATES.REASSIGNMENT_PENDING
      )
    ).toBe(false);
  });

  it('normalizes every terminal runtime status used by socket and dispatch guards', () => {
    expect(RideStateManager.isTerminalStateValue('completed')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('trip_completed')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('cancelled')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('trip_cancelled')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('trip_canceled')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('NO_DRIVERS')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('NO_DRIVERS_AVAILABLE')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('EARLY_ENDED_BY_RIDER')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('INTERRUPTED_OPERATIONAL_ENDED')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('EARLY_ENDED_REVIEW')).toBe(true);
    expect(RideStateManager.isTerminalStateValue('IN_PROGRESS')).toBe(false);
    expect(RideStateManager.isTerminalStateValue('ARRIVED')).toBe(false);
  });
});

describe('RideStateManager terminal booking TTL', () => {
  beforeEach(() => {
    // These assertions own TTL only. Do not enqueue unrelated event/health work
    // that would import modules after this test environment has been torn down.
    jest.spyOn(RideStateManager, '_scheduleSideEffects').mockImplementation(() => {});
  });

  function buildRedis(currentState) {
    return {
      hget: jest.fn().mockResolvedValue(currentState),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1)
    };
  }

  afterEach(() => {
    delete process.env.RIDE_TERMINAL_BOOKING_TTL_SECONDS;
  });

  it('expires the Redis booking hash when a ride completes', async () => {
    const redis = buildRedis(RideStateManager.STATES.IN_PROGRESS);

    await RideStateManager.updateBookingState(
      redis,
      'booking_ttl_1',
      RideStateManager.STATES.COMPLETED,
      {},
      { deferSideEffects: true }
    );

    expect(redis.expire).toHaveBeenCalledWith('booking:booking_ttl_1', 72 * 60 * 60);
  });

  it('expires cancelled rides and honours the configured TTL', async () => {
    process.env.RIDE_TERMINAL_BOOKING_TTL_SECONDS = '7200';
    const redis = buildRedis(RideStateManager.STATES.SEARCHING);

    await RideStateManager.updateBookingState(
      redis,
      'booking_ttl_2',
      RideStateManager.STATES.CANCELED,
      {},
      { deferSideEffects: true }
    );

    expect(redis.expire).toHaveBeenCalledWith('booking:booking_ttl_2', 7200);
  });

  it('keeps rides awaiting manual review and active rides without TTL', async () => {
    const reviewRedis = buildRedis(RideStateManager.STATES.IN_PROGRESS);
    await RideStateManager.expireTerminalBooking(
      reviewRedis,
      'booking_review',
      RideStateManager.STATES.EARLY_ENDED_REVIEW
    );

    const activeRedis = buildRedis(RideStateManager.STATES.ACCEPTED);
    await RideStateManager.updateBookingState(
      activeRedis,
      'booking_active',
      RideStateManager.STATES.ARRIVED,
      {},
      { deferSideEffects: true }
    );

    expect(reviewRedis.expire).not.toHaveBeenCalled();
    expect(activeRedis.expire).not.toHaveBeenCalled();
  });

  it('does not fail the transition when EXPIRE fails', async () => {
    const redis = buildRedis(RideStateManager.STATES.IN_PROGRESS);
    redis.expire.mockRejectedValue(new Error('redis down'));

    await expect(
      RideStateManager.updateBookingState(
        redis,
        'booking_ttl_3',
        RideStateManager.STATES.COMPLETED,
        {},
        { deferSideEffects: true }
      )
    ).resolves.toBe(true);
  });
});
