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
