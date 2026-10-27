'use strict';

// Ratings in Firestore (RTDB exit, domain 3; RTDB retired).
// - `<ratings>/{ratingId}`: the rating body, as stored in RTDB.
// - `<rating_trip_index>/{tripId}__{reviewerId}`: one entry per reviewer and
//   trip; it is what prevents a second rating for the same trip.
// trip_ratings/user_ratings are RTDB fan-out views; here they are queries.

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function clean(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value ?? null;
}

function indexId(tripId, reviewerId) {
  const trip = String(tripId || '').trim();
  const reviewer = String(reviewerId || '').trim();
  if (!trip || !reviewer || trip.includes('/') || reviewer.includes('/')) {
    throw fail('RATING_FIRESTORE_INVALID_ID', 'tripId/reviewerId inválidos para o índice de avaliação');
  }
  return `${trip}__${reviewer}`;
}

function refs(firestore, scope, { ratingId, tripId, reviewerId }) {
  if (!firestore) throw fail('RATING_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para avaliações');
  return {
    rating: ratingId ? firestore.collection(scope.collections.ratings).doc(String(ratingId)) : null,
    index: firestore.collection(scope.collections.ratingTripIndex).doc(indexId(tripId, reviewerId))
  };
}

// Index documents keep the RTDB entry plus tripId/reviewerId for lookups.
function indexBody(entry, tripId, reviewerId) {
  return { ...clean(entry), tripId: String(tripId), reviewerId: String(reviewerId) };
}

function indexEntry(data) {
  if (!data) return null;
  const { tripId: _trip, reviewerId: _reviewer, ...entry } = data;
  return entry;
}

// Reserve and commit atomically.
async function commit(firestore, scope, { rating, index }) {
  const target = refs(firestore, scope, { ratingId: rating.id, tripId: rating.tripId, reviewerId: rating.reviewerId });
  return firestore.runTransaction(async tx => {
    const existing = await tx.get(target.index);
    if (existing.exists) return { committed: false, collision: indexEntry(existing.data()) };
    tx.create(target.index, indexBody(index, rating.tripId, rating.reviewerId));
    tx.create(target.rating, clean(rating));
    return { committed: true };
  });
}

async function getRating(firestore, scope, ratingId) {
  const snapshot = await refs(firestore, scope, { ratingId, tripId: 'x', reviewerId: 'x' }).rating.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function getIndex(firestore, scope, tripId, reviewerId) {
  const snapshot = await refs(firestore, scope, { tripId, reviewerId }).index.get();
  return snapshot.exists ? indexEntry(snapshot.data()) : null;
}

async function listBy(firestore, scope, field, value) {
  if (!firestore) throw fail('RATING_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para avaliações');
  let query = firestore.collection(scope.collections.ratings).where(field, '==', String(value));
  // Sandbox views are per sealed context, like the RTDB fan-out paths.
  if (scope.namespace === 'sandbox') query = query.where('financialContextId', '==', scope.financialContextId);
  const snapshot = await query.get();
  return snapshot.docs.map(doc => doc.data());
}

module.exports = {
  indexId, indexBody, indexEntry, commit, getRating, getIndex,
  listByTrip: (firestore, scope, tripId) => listBy(firestore, scope, 'tripId', tripId),
  listByTarget: (firestore, scope, targetUserId) => listBy(firestore, scope, 'targetUserId', targetUserId)
};
