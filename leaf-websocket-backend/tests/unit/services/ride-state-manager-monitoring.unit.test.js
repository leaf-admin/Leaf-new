jest.mock('../../../services/event-sourcing', () => ({
  recordEvent: jest.fn().mockResolvedValue(true),
  EVENT_TYPES: {
    STATE_CHANGED: 'STATE_CHANGED'
  }
}));

jest.mock('../../../services/ride-health-monitor', () => ({
  syncTrackedRideState: jest.fn().mockResolvedValue(true)
}));

const eventSourcing = require('../../../services/event-sourcing');
const { syncTrackedRideState } = require('../../../services/ride-health-monitor');
const RideStateManager = require('../../../services/ride-state-manager');

function createRedisMock(initialState = 'IN_PROGRESS') {
  const store = new Map([
    ['state', initialState]
  ]);

  return {
    async hget(_key, field) {
      return store.get(field) || null;
    },
    async hset(_key, payload) {
      Object.entries(payload).forEach(([field, value]) => {
        store.set(field, value);
      });
      return true;
    }
  };
}

describe('RideStateManager monitoring integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sincroniza o index de ride health ao mudar para EARLY_ENDED_REVIEW', async () => {
    const redis = createRedisMock('IN_PROGRESS');

    await RideStateManager.updateBookingState(redis, 'booking-123', RideStateManager.STATES.EARLY_ENDED_REVIEW, {
      reason: 'manual_review'
    });

    expect(eventSourcing.recordEvent).toHaveBeenCalledTimes(1);
    expect(syncTrackedRideState).toHaveBeenCalledWith(
      redis,
      expect.objectContaining({
        bookingId: 'booking-123',
        previousState: 'IN_PROGRESS',
        newState: RideStateManager.STATES.EARLY_ENDED_REVIEW,
        updatedAt: expect.any(String)
      })
    );
  });

  it('executa side effects sem regravar uma transição já persistida por Lua', async () => {
    const redis = createRedisMock('SEARCHING');
    const hsetSpy = jest.spyOn(redis, 'hset');
    const updatedAt = '2026-08-04T08:00:00.000Z';

    await RideStateManager.recordPersistedTransitionSideEffects(
      redis,
      {
        bookingId: 'booking-atomic-1',
        currentState: RideStateManager.STATES.PENDING,
        newState: RideStateManager.STATES.SEARCHING,
        updatedAt
      }
    );

    expect(hsetSpy).not.toHaveBeenCalled();
    expect(eventSourcing.recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: 'booking-atomic-1',
        fromState: RideStateManager.STATES.PENDING,
        toState: RideStateManager.STATES.SEARCHING,
        updatedAt
      })
    );
    expect(syncTrackedRideState).toHaveBeenCalledWith(
      redis,
      {
        bookingId: 'booking-atomic-1',
        previousState: RideStateManager.STATES.PENDING,
        newState: RideStateManager.STATES.SEARCHING,
        updatedAt
      }
    );
  });
});
