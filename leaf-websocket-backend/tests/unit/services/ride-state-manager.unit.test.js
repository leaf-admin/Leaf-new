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
});
