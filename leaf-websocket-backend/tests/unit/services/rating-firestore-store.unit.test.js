const mockGetFromRealtimeDB = jest.fn();
const mockUpdateRealtimeDBRoot = jest.fn();
let mockFirestore = null;

jest.mock('../../../services/kyc-policy-service', () => ({
  isPhotoMismatchReport: jest.fn(() => false),
  markDriverForPhotoMismatch: jest.fn()
}));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn() }));
jest.mock('../../../firebase-config', () => ({
  isRealtimeDBAvailable: () => true,
  getRealtimeDB: () => ({ ref: () => ({ transaction: async fn => ({ committed: true, snapshot: { val: () => fn(null) } }) }) }),
  getFromRealtimeDB: (...args) => mockGetFromRealtimeDB(...args),
  updateRealtimeDBRoot: (...args) => mockUpdateRealtimeDBRoot(...args),
  getFirestore: () => mockFirestore
}));

const store = require('../../../services/rating-firestore-store');
const ratingService = require('../../../services/rating-service');
const backfill = require('../../../scripts/maintenance/backfill-ratings-support-firestore.cjs');

// Minimal Firestore with create() conflicts, batches and equality queries.
function fakeFirestore() {
  const docs = new Map();
  const ref = (collection, id) => ({
    path: `${collection}/${id}`,
    get: async () => ({ exists: docs.has(`${collection}/${id}`), data: () => docs.get(`${collection}/${id}`) }),
    set: async value => { docs.set(`${collection}/${id}`, value); }
  });
  const query = (collection, filters = []) => ({
    where: (field, _op, value) => query(collection, [...filters, [field, value]]),
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([path, value]) => path.startsWith(`${collection}/`) && filters.every(([f, v]) => value[f] === v))
        .map(([, value]) => ({ data: () => value }))
    })
  });
  return {
    docs,
    collection: name => ({ doc: id => ref(name, id), where: (f, op, v) => query(name).where(f, op, v) }),
    batch: () => {
      const ops = [];
      return { set: (target, value) => ops.push([target.path, value]), commit: async () => ops.forEach(([p, v]) => docs.set(p, v)) };
    },
    runTransaction: async fn => {
      const pending = [];
      const result = await fn({
        get: target => target.get(),
        create: (target, value) => {
          if (docs.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 });
          pending.push([target.path, value]);
        }
      });
      pending.forEach(([p, v]) => docs.set(p, v));
      return result;
    }
  };
}

const tripScope = { bookingId: 'booking_1', customerId: 'passenger_1', driverId: 'driver_1', status: 'COMPLETED' };
const context = { socketUserId: 'passenger_1', socketUserType: 'passenger', tripScope };
const payload = { tripId: 'booking_1', rating: 5, comment: 'ok' };

describe('ratings in Firestore (RTDB exit, domain 3)', () => {
  const saved = { w: process.env.ENABLE_RATINGS_FIRESTORE_WRITES, r: process.env.ENABLE_RATINGS_FIRESTORE_READS };
  beforeEach(() => {
    mockFirestore = fakeFirestore();
    mockGetFromRealtimeDB.mockReset().mockResolvedValue(null);
    mockUpdateRealtimeDBRoot.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    for (const [name, value] of [['ENABLE_RATINGS_FIRESTORE_WRITES', saved.w], ['ENABLE_RATINGS_FIRESTORE_READS', saved.r]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  it('commit creates the rating and its index once and reports the collision on a second rating', async () => {
    const scope = { namespace: 'operational', collections: { ratings: 'ratings', ratingTripIndex: 'rating_trip_index' } };
    const rating = { id: 'rating_1', tripId: 'booking_1', reviewerId: 'passenger_1' };
    await expect(store.commit(mockFirestore, scope, { rating, index: { ratingId: 'rating_1', status: 'committed' } }))
      .resolves.toEqual({ committed: true });
    await expect(store.commit(mockFirestore, scope, { rating: { ...rating, id: 'rating_2' }, index: { ratingId: 'rating_2' } }))
      .resolves.toEqual({ committed: false, collision: { ratingId: 'rating_1', status: 'committed' } });
    expect(mockFirestore.docs.has('ratings/rating_2')).toBe(false);
  });

  it('before the switch RTDB stays the source and Firestore gets a copy', async () => {
    process.env.ENABLE_RATINGS_FIRESTORE_WRITES = 'true';
    delete process.env.ENABLE_RATINGS_FIRESTORE_READS;
    const result = await ratingService.submitRating(payload, context);
    expect(result.success).toBe(true);
    expect(mockUpdateRealtimeDBRoot).toHaveBeenCalledTimes(1);
    expect(mockFirestore.docs.get(`ratings/${result.ratingId}`)).toMatchObject({ tripId: 'booking_1', rating: 5, targetUserId: 'driver_1' });
    expect(mockFirestore.docs.get('rating_trip_index/booking_1__passenger_1')).toMatchObject({ ratingId: result.ratingId, status: 'committed' });
  });

  it('after the switch commits in Firestore, mirrors RTDB, replays duplicates and reads from Firestore', async () => {
    process.env.ENABLE_RATINGS_FIRESTORE_WRITES = 'true';
    process.env.ENABLE_RATINGS_FIRESTORE_READS = 'true';
    const first = await ratingService.submitRating(payload, context);
    expect(first.success).toBe(true);
    const updates = mockUpdateRealtimeDBRoot.mock.calls[0][0];
    expect(updates[`bookings/booking_1/rating`]).toBe(5);

    const replay = await ratingService.submitRating({ ...payload, rating: 1 }, context);
    expect(replay).toMatchObject({ success: true, idempotentReplay: true, ratingId: first.ratingId });
    expect(mockUpdateRealtimeDBRoot).toHaveBeenCalledTimes(1);

    await expect(ratingService.hasUserRatedTrip('booking_1', 'passenger_1', tripScope))
      .resolves.toMatchObject({ hasRated: true, ratingId: first.ratingId });
    const trip = await ratingService.getTripRatings('booking_1', tripScope);
    expect(trip.ratings.map(r => r.id)).toEqual([first.ratingId]);
    const user = await ratingService.getUserRatings('driver_1', tripScope);
    expect(user).toMatchObject({ success: true, totalRatings: 1, averageRating: 5 });
    expect(mockGetFromRealtimeDB).not.toHaveBeenCalled();
  });

  it('a Firestore failure after the switch rejects the rating instead of writing only RTDB', async () => {
    process.env.ENABLE_RATINGS_FIRESTORE_WRITES = 'true';
    process.env.ENABLE_RATINGS_FIRESTORE_READS = 'true';
    mockFirestore.runTransaction = async () => { throw new Error('firestore down'); };
    await expect(ratingService.submitRating(payload, context)).resolves.toMatchObject({ success: false, code: 'RATING_INDEX_UNAVAILABLE' });
    expect(mockUpdateRealtimeDBRoot).not.toHaveBeenCalled();
  });

  it('backfill copies ratings and index, then checks the fan-out views against Firestore queries', async () => {
    expect(() => backfill.parseArgs(['--apply'])).toThrow('--ref');
    const rating = { id: 'r1', tripId: 't1', reviewerId: 'p1', targetUserId: 'd1', rating: 4 };
    const rtdb = {
      ratings: { r1: rating }, rating_trip_index: { t1: { p1: { ratingId: 'r1', status: 'committed' } } },
      trip_ratings: { t1: { r1: rating } }, user_ratings: { d1: { r1: rating } }, support_tickets: { T1: {} }
    };
    const config = { getFromRealtimeDB: async path => rtdb[path] ?? null };
    const scope = { namespace: 'operational', collections: { ratings: 'ratings', ratingTripIndex: 'rating_trip_index', tripRatings: 'trip_ratings', userRatings: 'user_ratings' } };
    const supportDocs = new Set();
    const supportService = {
      ticketDoc: id => ({ get: async () => ({ exists: supportDocs.has(id) }) }),
      importLegacyTicket: async id => { supportDocs.add(id); return { id }; }
    };
    const deps = { config, firestore: mockFirestore, store, supportService, collectionsFor: ns => (ns === 'operational' ? scope.collections : {}), scopeOf: () => scope, log: () => {} };

    const dry = await backfill.run({ apply: false }, deps);
    expect(dry).toMatchObject({ ratingsToWrite: 1, indexToWrite: 1, viewMismatch: 2, supportMissing: 1 });
    const applied = await backfill.run({ apply: true, ref: 'test' }, deps);
    expect(applied).toMatchObject({ ratingsWritten: 1, indexWritten: 1, viewsEqual: 2, viewMismatch: 0, supportImported: 1, parityMismatch: 0 });
    const again = await backfill.run({ apply: false }, deps);
    expect(again).toMatchObject({ ratingsEqual: 1, indexEqual: 1, ratingsToWrite: 0, indexToWrite: 0, supportPresent: 1 });
  });
});
