'use strict';

const mockGetFromRealtimeDB = jest.fn();
const mockUpdateRealtimeDBRoot = jest.fn();
const ratingIndexByPath = new Map();

jest.mock('../../../services/kyc-policy-service', () => ({
  isPhotoMismatchReport: jest.fn(() => false),
  markDriverForPhotoMismatch: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  isRealtimeDBAvailable: jest.fn(() => true),
  getFromRealtimeDB: (...args) => mockGetFromRealtimeDB(...args),
  updateRealtimeDBRoot: (...args) => mockUpdateRealtimeDBRoot(...args),
  getRealtimeDB: jest.fn(() => ({
    ref: (path) => ({
      transaction: async (update) => {
        const current = ratingIndexByPath.get(path) || null;
        const next = update(current);
        if (next === undefined) {
          return { committed: false, snapshot: { val: () => current } };
        }
        if (next === null) {
          ratingIndexByPath.delete(path);
        } else {
          ratingIndexByPath.set(path, next);
        }
        return { committed: true, snapshot: { val: () => next } };
      }
    })
  }))
}));

const ratingService = require('../../../services/rating-service');

function completedPassengerScope() {
  return {
    bookingId: 'ride_1',
    customerId: 'passenger_1',
    driverId: 'driver_1',
    status: 'COMPLETED'
  };
}

describe('rating-service lifecycle and idempotency', () => {
  beforeEach(() => {
    ratingIndexByPath.clear();
    mockGetFromRealtimeDB.mockReset();
    mockUpdateRealtimeDBRoot.mockReset();
    mockGetFromRealtimeDB.mockResolvedValue(null);
    mockUpdateRealtimeDBRoot.mockResolvedValue(true);
  });

  it('rejects ratings before the canonical ride completion', async () => {
    const result = await ratingService.submitRating({
      tripId: 'ride_1',
      rating: 5
    }, {
      socketUserId: 'passenger_1',
      socketUserType: 'passenger',
      tripScope: {
        ...completedPassengerScope(),
        status: 'IN_PROGRESS'
      }
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'RATING_TRIP_NOT_COMPLETED'
    }));
    expect(mockUpdateRealtimeDBRoot).not.toHaveBeenCalled();
  });

  it('accepts completed trip aliases emitted by the ride lifecycle', async () => {
    const result = await ratingService.submitRating({
      tripId: 'ride_1',
      rating: 5,
      comment: 'Corrida encerrada'
    }, {
      socketUserId: 'passenger_1',
      socketUserType: 'passenger',
      tripScope: {
        ...completedPassengerScope(),
        status: 'TRIP_COMPLETED'
      }
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      rating: expect.objectContaining({
        tripId: 'ride_1',
        reviewerId: 'passenger_1',
        reviewerType: 'passenger',
        targetUserId: 'driver_1'
      })
    }));
    expect(mockUpdateRealtimeDBRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        'bookings/ride_1/rating': 5
      })
    );
  });

  it('reserves one rating atomically and replays the persisted result after a duplicate submit', async () => {
    let persistedRating = null;
    mockUpdateRealtimeDBRoot.mockImplementation(async (updates) => {
      const ratingPath = Object.keys(updates).find((path) => path.startsWith('ratings/'));
      persistedRating = updates[ratingPath];
      return true;
    });
    mockGetFromRealtimeDB.mockImplementation(async (path) => {
      if (path === `ratings/${persistedRating?.id}`) return persistedRating;
      return null;
    });

    const context = {
      socketUserId: 'passenger_1',
      socketUserType: 'passenger',
      tripScope: completedPassengerScope()
    };
    const payload = { tripId: 'ride_1', rating: 5, comment: 'Tudo certo' };

    const first = await ratingService.submitRating(payload, context);
    const second = await ratingService.submitRating(payload, context);

    expect(first.success).toBe(true);
    expect(second).toEqual(expect.objectContaining({
      success: true,
      idempotentReplay: true,
      ratingId: first.ratingId
    }));
    expect(mockUpdateRealtimeDBRoot).toHaveBeenCalledTimes(1);
  });
});
