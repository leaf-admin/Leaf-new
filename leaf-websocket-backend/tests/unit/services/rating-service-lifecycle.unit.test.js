'use strict';

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const { fakeRatingsFirestore } = require('../../helpers/fake-ratings-firestore');

let mockFirestore = null;
const mockAnnotations = [];

jest.mock('../../../services/kyc-policy-service', () => ({
  isPhotoMismatchReport: jest.fn(() => false),
  markDriverForPhotoMismatch: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: () => mockFirestore
}));

jest.mock('../../../services/ride-annotation-store', () => ({
  updateAnnotation: jest.fn(async (_firestore, root, id, patch) => {
    mockAnnotations.push({ root, id, patch });
  }),
  listAnnotations: jest.fn()
}));

const ratingService = require('../../../services/rating-service');
const rideAnnotationStore = require('../../../services/ride-annotation-store');

function completedPassengerScope() {
  return {
    bookingId: 'ride_1',
    customerId: 'passenger_1',
    driverId: 'driver_1',
    status: 'COMPLETED'
  };
}

function sandboxContext() {
  return sealFinancialContext({
    providerEnvironment: 'sandbox',
    paymentProfileId: 'qa-test-users-sandbox-durable',
    paymentProfileSource: 'firestore',
    testUserSandbox: true
  });
}

describe('rating-service lifecycle and idempotency', () => {
  beforeEach(() => {
    mockFirestore = fakeRatingsFirestore();
    mockAnnotations.length = 0;
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
    expect(mockFirestore.paths()).toEqual([]);
    expect(mockAnnotations).toHaveLength(0);
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
    expect(mockAnnotations).toEqual([
      { root: 'bookings', id: 'ride_1', patch: { rating: 5, feedback: 'Corrida encerrada' } }
    ]);
  });

  it('records the air conditioning answer on its own, without a rating', async () => {
    const result = await ratingService.submitAirConditioningFeedback({
      tripId: 'ride_1',
      airConditioningOk: false
    }, {
      socketUserId: 'passenger_1',
      socketUserType: 'passenger',
      tripScope: completedPassengerScope()
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tripId: 'ride_1',
      airConditioningOk: false
    }));
    expect(mockAnnotations).toEqual([{
      root: 'bookings',
      id: 'ride_1',
      patch: {
        air_conditioning_ok: false,
        air_conditioning_answered_at: expect.any(String),
        air_conditioning_driver_id: 'driver_1'
      }
    }]);
  });

  it('rejects an air conditioning answer that is not yes or no', async () => {
    const result = await ratingService.submitAirConditioningFeedback({
      tripId: 'ride_1',
      airConditioningOk: 'sim'
    }, { tripScope: completedPassengerScope() });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'AIR_CONDITIONING_ANSWER_INVALID'
    }));
    expect(mockAnnotations).toEqual([]);
  });

  it('rejects an air conditioning answer before the ride ends', async () => {
    const result = await ratingService.submitAirConditioningFeedback({
      tripId: 'ride_1',
      airConditioningOk: true
    }, { tripScope: { ...completedPassengerScope(), status: 'STARTED' } });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'RATING_TRIP_NOT_COMPLETED'
    }));
    expect(mockAnnotations).toEqual([]);
  });

  it('summarises air conditioning answers for one driver, newest first', async () => {
    rideAnnotationStore.listAnnotations.mockResolvedValue({
      ride_1: { air_conditioning_ok: true, air_conditioning_driver_id: 'driver_1' },
      ride_2: { air_conditioning_ok: false, air_conditioning_driver_id: 'driver_1', air_conditioning_answered_at: '2026-11-01T10:00:00.000Z' },
      ride_3: { air_conditioning_ok: false, air_conditioning_driver_id: 'driver_1', air_conditioning_answered_at: '2026-11-01T12:00:00.000Z' },
      ride_4: { air_conditioning_ok: false, air_conditioning_driver_id: 'driver_2' },
      ride_5: { rating: 5 }
    });

    await expect(ratingService.getDriverAirConditioningSummary('driver_1')).resolves.toEqual({
      answered: 3,
      stayedOn: 1,
      turnedOff: 2,
      recentTurnedOff: [
        { tripId: 'ride_3', ok: false, answeredAt: '2026-11-01T12:00:00.000Z' },
        { tripId: 'ride_2', ok: false, answeredAt: '2026-11-01T10:00:00.000Z' }
      ]
    });
  });

  it('reserves one rating atomically and replays the persisted result after a duplicate submit', async () => {
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
    expect(mockFirestore.paths().filter(path => path.startsWith('ratings/'))).toEqual([`ratings/${first.ratingId}`]);
    expect(mockAnnotations).toHaveLength(1);
  });

  it('writes sandbox ratings and booking feedback only to sandbox collections', async () => {
    const financialContext = sandboxContext();

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
    expect(mockAnnotations).toEqual([
      { root: 'sandbox_bookings', id: 'ride_1', patch: { rating: 5, feedback: 'Tudo certo' } }
    ]);
    expect(mockFirestore.paths().sort()).toEqual([
      `sandbox_rating_trip_index/ride_1__passenger_1`,
      `sandbox_ratings/${result.ratingId}`
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
    expect(mockFirestore.paths()).toEqual([]);
    expect(mockAnnotations).toHaveLength(0);
  });

  it('reads sandbox trip ratings without falling back to operational collections', async () => {
    const financialContext = sandboxContext();
    const stored = {
      id: 'rating_1',
      tripId: 'ride_1',
      rating: 5,
      createdAt: '2026-07-13T12:00:00.000Z',
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    };
    await mockFirestore.collection('sandbox_ratings').doc('rating_1').set(stored);
    await mockFirestore.collection('ratings').doc('rating_op').set({ ...stored, id: 'rating_op', financialNamespace: 'operational' });

    const result = await ratingService.getTripRatings('ride_1', { financialContext });

    expect(result).toEqual(expect.objectContaining({ success: true, totalRatings: 1 }));
    expect(result.ratings.map(rating => rating.id)).toEqual(['rating_1']);
  });
});
