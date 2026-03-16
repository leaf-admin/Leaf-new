const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');

const MAX_COMMENT_LENGTH = 500;

function normalizeUserType(userType) {
  const normalized = String(userType || '').toLowerCase();
  if (normalized === 'customer') return 'passenger';
  if (normalized === 'passenger' || normalized === 'driver') return normalized;
  return 'unknown';
}

function safeRatingValue(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.min(5, Math.round(numeric * 10) / 10));
}

function normalizeComment(value) {
  if (!value) return '';
  return String(value).trim().slice(0, MAX_COMMENT_LENGTH);
}

class RatingService {
  constructor() {
    this._db = null;
  }

  async _getDb() {
    if (this._db) return this._db;
    this._db = firebaseConfig.getRealtimeDB();
    return this._db;
  }

  _resolveTripId(data = {}) {
    return data.tripId || data.bookingId || data.rideId || null;
  }

  _resolveReviewerId(data = {}, context = {}) {
    return data.userId || data.reviewerId || context.socketUserId || null;
  }

  _resolveReviewerType(data = {}, context = {}) {
    return normalizeUserType(data.userType || data.reviewerType || context.socketUserType);
  }

  _resolveTargetUserId(data = {}, reviewerType = 'unknown') {
    if (data.targetUserId) return data.targetUserId;

    const tripData = data.tripData || {};
    if (reviewerType === 'passenger') {
      return (
        data.driverId ||
        tripData.driverId ||
        tripData.driver ||
        tripData.driver_id ||
        null
      );
    }

    if (reviewerType === 'driver') {
      return (
        data.customerId ||
        data.passengerId ||
        tripData.customerId ||
        tripData.customer ||
        tripData.customer_id ||
        tripData.passengerId ||
        tripData.passenger ||
        null
      );
    }

    return data.driverId || data.customerId || data.passengerId || null;
  }

  async submitRating(payload = {}, context = {}) {
    const db = await this._getDb();
    if (!db) {
      return { success: false, error: 'Firebase não disponível' };
    }

    const tripId = this._resolveTripId(payload);
    const reviewerId = this._resolveReviewerId(payload, context);
    const reviewerType = this._resolveReviewerType(payload, context);
    const targetUserId = this._resolveTargetUserId(payload, reviewerType);
    const ratingValue = safeRatingValue(payload.rating ?? payload.customerRating ?? payload.driverRating);
    const comment = normalizeComment(payload.comment ?? payload.customerComment ?? payload.driverComment);

    if (!tripId || !reviewerId) {
      return {
        success: false,
        error: 'tripId e userId são obrigatórios'
      };
    }

    if (ratingValue === null) {
      return {
        success: false,
        error: 'rating deve ser um número entre 1 e 5'
      };
    }

    const indexRef = db.ref(`rating_trip_index/${tripId}/${reviewerId}`);
    const existingIndex = await indexRef.once('value');
    if (existingIndex.exists()) {
      const existing = existingIndex.val();
      return {
        success: false,
        error: 'Usuário já avaliou esta corrida',
        alreadyRated: true,
        ratingId: existing?.ratingId || null
      };
    }

    const ratingId = `rating_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const rating = {
      id: ratingId,
      tripId,
      reviewerId,
      reviewerType,
      targetUserId: targetUserId || null,
      rating: ratingValue,
      comment,
      selectedOptions: Array.isArray(payload.selectedOptions) ? payload.selectedOptions : [],
      createdAt: now
    };

    const updates = {};
    updates[`ratings/${ratingId}`] = rating;
    updates[`trip_ratings/${tripId}/${ratingId}`] = rating;
    updates[`rating_trip_index/${tripId}/${reviewerId}`] = {
      ratingId,
      reviewerType,
      createdAt: now
    };

    if (targetUserId) {
      updates[`user_ratings/${targetUserId}/${ratingId}`] = rating;
    }

    if (reviewerType === 'passenger') {
      updates[`bookings/${tripId}/rating`] = ratingValue;
      updates[`bookings/${tripId}/feedback`] = comment || null;
    } else if (reviewerType === 'driver') {
      updates[`bookings/${tripId}/driver_rating`] = ratingValue;
      updates[`bookings/${tripId}/driver_feedback`] = comment || null;
    }

    await db.ref().update(updates);

    logStructured('info', 'Avaliação registrada', {
      service: 'rating-service',
      tripId,
      ratingId,
      reviewerId,
      reviewerType,
      targetUserId
    });

    return {
      success: true,
      ratingId,
      rating
    };
  }

  async getTripRatings(tripId) {
    const db = await this._getDb();
    if (!db) return { success: false, error: 'Firebase não disponível' };
    if (!tripId) return { success: false, error: 'tripId é obrigatório' };

    const snapshot = await db.ref(`trip_ratings/${tripId}`).once('value');
    const raw = snapshot.val() || {};
    const ratings = Object.values(raw).sort((a, b) => {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    return {
      success: true,
      tripId,
      ratings,
      totalRatings: ratings.length
    };
  }

  async hasUserRatedTrip(tripId, reviewerId) {
    const db = await this._getDb();
    if (!db) return { success: false, error: 'Firebase não disponível' };
    if (!tripId || !reviewerId) {
      return { success: false, error: 'tripId e reviewerId são obrigatórios' };
    }

    const snapshot = await db.ref(`rating_trip_index/${tripId}/${reviewerId}`).once('value');
    const value = snapshot.val();
    return {
      success: true,
      tripId,
      reviewerId,
      hasRated: snapshot.exists(),
      ratingId: value?.ratingId || null
    };
  }

  async getUserRatings(targetUserId) {
    const db = await this._getDb();
    if (!db) return { success: false, error: 'Firebase não disponível' };
    if (!targetUserId) return { success: false, error: 'targetUserId é obrigatório' };

    const snapshot = await db.ref(`user_ratings/${targetUserId}`).once('value');
    const raw = snapshot.val() || {};
    const ratings = Object.values(raw).sort((a, b) => {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    const totalRatings = ratings.length;
    const sum = ratings.reduce((acc, item) => acc + Number(item.rating || 0), 0);
    const averageRating = totalRatings > 0 ? Math.round((sum / totalRatings) * 10) / 10 : 0;
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach((item) => {
      const key = Math.round(Number(item.rating || 0));
      if (distribution[key] !== undefined) distribution[key] += 1;
    });

    return {
      success: true,
      targetUserId,
      ratings,
      totalRatings,
      averageRating,
      distribution
    };
  }
}

module.exports = new RatingService();
