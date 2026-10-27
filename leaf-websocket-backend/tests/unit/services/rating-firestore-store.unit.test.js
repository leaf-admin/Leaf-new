const mockGetFromRealtimeDB = jest.fn();
const mockUpdateRealtimeDBRoot = jest.fn();
const mockAnnotations = [];
let mockFirestore = null;

jest.mock('../../../services/kyc-policy-service', () => ({
  isPhotoMismatchReport: jest.fn(() => false),
  markDriverForPhotoMismatch: jest.fn()
}));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn() }));
jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: (...args) => mockGetFromRealtimeDB(...args),
  updateRealtimeDBRoot: (...args) => mockUpdateRealtimeDBRoot(...args),
  getFirestore: () => mockFirestore
}));

const store = require('../../../services/rating-firestore-store');
const ratingService = require('../../../services/rating-service');
const rideAnnotationStore = require('../../../services/ride-annotation-store');

const { fakeRatingsFirestore: fakeFirestore } = require('../../helpers/fake-ratings-firestore');

const tripScope = { bookingId: 'booking_1', customerId: 'passenger_1', driverId: 'driver_1', status: 'COMPLETED' };
const context = { socketUserId: 'passenger_1', socketUserType: 'passenger', tripScope };
const payload = { tripId: 'booking_1', rating: 5, comment: 'ok' };

describe('ratings in Firestore (RTDB retired)', () => {
  beforeEach(() => {
    mockFirestore = fakeFirestore();
    mockAnnotations.length = 0;
    mockGetFromRealtimeDB.mockReset().mockResolvedValue(null);
    mockUpdateRealtimeDBRoot.mockReset().mockResolvedValue(true);
    jest.spyOn(rideAnnotationStore, 'updateAnnotation').mockImplementation(async (_firestore, root, id, patch) => {
      mockAnnotations.push({ root, id, patch });
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('commit creates the rating and its index once and reports the collision on a second rating', async () => {
    const scope = { namespace: 'operational', collections: { ratings: 'ratings', ratingTripIndex: 'rating_trip_index' } };
    const rating = { id: 'rating_1', tripId: 'booking_1', reviewerId: 'passenger_1' };
    await expect(store.commit(mockFirestore, scope, { rating, index: { ratingId: 'rating_1', status: 'committed' } }))
      .resolves.toEqual({ committed: true });
    await expect(store.commit(mockFirestore, scope, { rating: { ...rating, id: 'rating_2' }, index: { ratingId: 'rating_2' } }))
      .resolves.toEqual({ committed: false, collision: { ratingId: 'rating_1', status: 'committed' } });
    expect(mockFirestore.docs.has('ratings/rating_2')).toBe(false);
  });

  it('commits in Firestore, keeps the booking summary on the ride annotation, replays duplicates and reads from Firestore', async () => {
    const first = await ratingService.submitRating(payload, context);
    expect(first.success).toBe(true);
    expect(mockFirestore.docs.get(`ratings/${first.ratingId}`)).toMatchObject({ tripId: 'booking_1', rating: 5, targetUserId: 'driver_1' });
    expect(mockFirestore.docs.get('rating_trip_index/booking_1__passenger_1')).toMatchObject({ ratingId: first.ratingId, status: 'committed' });
    expect(mockAnnotations).toEqual([{ root: 'bookings', id: 'booking_1', patch: { rating: 5, feedback: 'ok' } }]);

    const replay = await ratingService.submitRating({ ...payload, rating: 1 }, context);
    expect(replay).toMatchObject({ success: true, idempotentReplay: true, ratingId: first.ratingId });
    expect(mockAnnotations).toHaveLength(1);

    await expect(ratingService.hasUserRatedTrip('booking_1', 'passenger_1', tripScope))
      .resolves.toMatchObject({ hasRated: true, ratingId: first.ratingId });
    const trip = await ratingService.getTripRatings('booking_1', tripScope);
    expect(trip.ratings.map(r => r.id)).toEqual([first.ratingId]);
    const user = await ratingService.getUserRatings('driver_1', tripScope);
    expect(user).toMatchObject({ success: true, totalRatings: 1, averageRating: 5 });
    expect(mockGetFromRealtimeDB).not.toHaveBeenCalled();
    expect(mockUpdateRealtimeDBRoot).not.toHaveBeenCalled();
  });

  it('a ride annotation failure does not reject a committed rating', async () => {
    rideAnnotationStore.updateAnnotation.mockRejectedValueOnce(new Error('annotation down'));
    const result = await ratingService.submitRating(payload, context);
    expect(result.success).toBe(true);
    expect(mockFirestore.docs.get(`ratings/${result.ratingId}`)).toMatchObject({ rating: 5 });
  });

  it('a Firestore failure rejects the rating and writes nothing else', async () => {
    mockFirestore.runTransaction = async () => { throw new Error('firestore down'); };
    await expect(ratingService.submitRating(payload, context)).resolves.toMatchObject({ success: false, code: 'RATING_INDEX_UNAVAILABLE' });
    expect(mockAnnotations).toHaveLength(0);
    expect(mockUpdateRealtimeDBRoot).not.toHaveBeenCalled();
  });

  it('reports Firebase unavailable without Firestore', async () => {
    mockFirestore = null;
    await expect(ratingService.submitRating(payload, context)).resolves.toMatchObject({ success: false, error: 'Firebase não disponível' });
  });
});
