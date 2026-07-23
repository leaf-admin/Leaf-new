'use strict';

const { sealFinancialContext } = require('../../../services/financial-runtime-context');

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

  it('writes sandbox ratings and booking feedback only to sandbox roots', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });

    const result = await ratingService.submitRating({
      tripId: 'ride_1',
      rating: 5,
      comment: 'Tudo certo'
    }, {
      socketUserId: 'passenger_1',
      socketUserType: 'passenger',
      tripScope: {
        ...completedPassengerScope(),
        raw: {
          bookingId: 'ride_1',
          financialContext,
          financialNamespace: 'sandbox',
          financialContextId: financialContext.contextId
        }
      }
    });

    expect(result).toEqual(expect.objectContaining({ success: true }));
    const updates = mockUpdateRealtimeDBRoot.mock.calls[0][0];
    expect(updates).toEqual(expect.objectContaining({
      'sandbox_bookings/ride_1/rating': 5,
      'sandbox_bookings/ride_1/feedback': 'Tudo certo'
    }));
    expect(Object.keys(updates)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^sandbox_ratings\//),
      expect.stringMatching(/^sandbox_trip_ratings\//),
      expect.stringMatching(/^sandbox_rating_trip_index\//),
      expect.stringMatching(/^sandbox_user_ratings\//)
    ]));
    expect(Object.keys(updates).some((path) => /^(ratings|trip_ratings|rating_trip_index|user_ratings|bookings)\//.test(path))).toBe(false);
    expect(Array.from(ratingIndexByPath.keys())).toEqual([
      'sandbox_rating_trip_index/ride_1/passenger_1'
    ]);
  });

  it('fails closed before reserving or writing when a sandbox signal lost its context', async () => {
    const result = await ratingService.submitRating({
      tripId: 'ride_1',
      rating: 5
    }, {
      socketUserId: 'passenger_1',
      socketUserType: 'passenger',
      tripScope: {
        ...completedPassengerScope(),
        raw: {
          bookingId: 'ride_1',
          financialNamespace: 'sandbox'
        }
      }
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    }));
    expect(ratingIndexByPath.size).toBe(0);
    expect(mockUpdateRealtimeDBRoot).not.toHaveBeenCalled();
  });

  it('reads sandbox trip ratings without falling back to operational roots', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    mockGetFromRealtimeDB.mockResolvedValue({
      rating_1: {
        id: 'rating_1',
        tripId: 'ride_1',
        rating: 5,
        createdAt: '2026-07-13T12:00:00.000Z',
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId
      }
    });

    const result = await ratingService.getTripRatings('ride_1', { financialContext });

    expect(result).toEqual(expect.objectContaining({ success: true, totalRatings: 1 }));
    expect(mockGetFromRealtimeDB).toHaveBeenCalledTimes(1);
    expect(mockGetFromRealtimeDB).toHaveBeenCalledWith('sandbox_trip_ratings/ride_1');
    expect(mockGetFromRealtimeDB).not.toHaveBeenCalledWith('trip_ratings/ride_1');
  });
});
