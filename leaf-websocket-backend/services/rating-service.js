const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');
const kycPolicyService = require('./kyc-policy-service');
const {
  resolveRidePersistenceScope,
  resolvePersistenceScope,
  assertStoredRecordMatchesScope
} = require('./sandbox-persistence-context');

const MAX_COMMENT_LENGTH = 500;
const RATING_ELIGIBLE_TRIP_STATUSES = new Set([
  'COMPLETE',
  'COMPLETED',
  'TRIP_COMPLETED',
  'RIDE_COMPLETED',
  'EARLY_ENDED_BY_RIDER',
  'EARLY_ENDED_REVIEW',
  'INTERRUPTED_OPERATIONAL_ENDED'
]);

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

function normalizeTripStatus(value) {
  return String(value || '').trim().toUpperCase();
}

class RatingService {
  _resolveTripId(data = {}) {
    return data.tripId || data.bookingId || data.rideId || null;
  }

  _resolveReviewerId(data = {}, context = {}) {
    return context.socketUserId || data.userId || data.reviewerId || null;
  }

  _resolveReviewerType(data = {}, context = {}) {
    return normalizeUserType(context.socketUserType || data.userType || data.reviewerType);
  }

  _resolveTargetUserId(data = {}, reviewerType = 'unknown', context = {}) {
    const tripScope = context.tripScope || {};
    if (reviewerType === 'passenger' && tripScope.driverId) {
      return tripScope.driverId;
    }
    if (reviewerType === 'driver' && tripScope.customerId) {
      return tripScope.customerId;
    }

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

  _validateTripScope(tripId, reviewerType, context = {}) {
    const tripScope = context?.tripScope;
    if (!tripScope || typeof tripScope !== 'object') {
      return {
        valid: false,
        code: 'RATING_TRIP_SCOPE_REQUIRED',
        error: 'Escopo canônico da corrida é obrigatório para avaliar'
      };
    }

    const scopedTripId = String(tripScope.bookingId || tripScope.tripId || '').trim();
    if (scopedTripId && scopedTripId !== String(tripId)) {
      return {
        valid: false,
        code: 'RATING_TRIP_SCOPE_MISMATCH',
        error: 'A corrida da avaliação não corresponde ao escopo autenticado'
      };
    }

    if (!RATING_ELIGIBLE_TRIP_STATUSES.has(normalizeTripStatus(tripScope.status))) {
      return {
        valid: false,
        code: 'RATING_TRIP_NOT_COMPLETED',
        error: 'A avaliação só pode ser enviada após a corrida ser concluída'
      };
    }

    if (!['passenger', 'driver'].includes(reviewerType)) {
      return {
        valid: false,
        code: 'RATING_REVIEWER_ROLE_INVALID',
        error: 'Perfil avaliador inválido'
      };
    }

    const targetUserId = this._resolveTargetUserId({}, reviewerType, context);
    if (!targetUserId) {
      return {
        valid: false,
        code: 'RATING_TARGET_REQUIRED',
        error: 'Participante avaliado indisponível'
      };
    }

    return {
      valid: true,
      targetUserId
    };
  }

  _resolveRideScope(payload = {}, context = {}) {
    return resolveRidePersistenceScope(
      context.persistenceScope ||
      context.tripScope?.raw ||
      context.tripScope ||
      payload
    );
  }

  _persistenceError(error) {
    return {
      success: false,
      code: error?.code || 'RATING_PERSISTENCE_SCOPE_INVALID',
      error: error?.message || 'Escopo de persistência da avaliação inválido'
    };
  }

  async _reserveRatingIndex({ tripId, reviewerId, reservation, persistenceScope }) {
    const realtimeDb = firebaseConfig.getRealtimeDB?.();
    const indexRef = realtimeDb?.ref?.(
      `${persistenceScope.collections.ratingTripIndex}/${tripId}/${reviewerId}`
    );
    if (!indexRef || typeof indexRef.transaction !== 'function') {
      return {
        success: false,
        code: 'RATING_INDEX_UNAVAILABLE',
        error: 'Não foi possível reservar a avaliação agora'
      };
    }

    let collision = null;
    try {
      const transaction = await indexRef.transaction((current) => {
        if (current) {
          collision = current;
          return undefined;
        }
        return reservation;
      });

      if (!transaction?.committed) {
        return {
          success: false,
          collision: transaction?.snapshot?.val?.() || collision || null
        };
      }

      return { success: true, indexRef };
    } catch (_error) {
      return {
        success: false,
        code: 'RATING_INDEX_UNAVAILABLE',
        error: 'Não foi possível reservar a avaliação agora'
      };
    }
  }

  async _releaseRatingReservation(indexRef, reservationId) {
    if (!indexRef || typeof indexRef.transaction !== 'function') return;
    try {
      await indexRef.transaction((current) => {
        if (current?.reservationId === reservationId && current?.status === 'pending') {
          return null;
        }
        return undefined;
      });
    } catch (_error) {
      // A reservation left behind is still safer than overwriting another evaluator.
    }
  }

  async _resolveExistingRatingReplay(collision = {}, persistenceScope) {
    const ratingId = String(collision?.ratingId || '').trim();
    if (!ratingId) {
      return {
        success: false,
        code: 'RATING_ALREADY_SUBMITTED',
        error: 'Usuário já avaliou esta corrida',
        alreadyRated: true,
        ratingId: null
      };
    }

    const persistedRating = await firebaseConfig.getFromRealtimeDB(
      `${persistenceScope.collections.ratings}/${ratingId}`
    );
    if (persistedRating) {
      try {
        assertStoredRecordMatchesScope(persistedRating, persistenceScope);
      } catch (error) {
        return this._persistenceError(error);
      }
      return {
        success: true,
        ratingId,
        rating: persistedRating,
        idempotentReplay: true,
        kycEscalation: null
      };
    }

    return {
      success: false,
      code: 'RATING_SUBMISSION_IN_PROGRESS',
      error: 'Avaliação já está sendo processada. Aguarde alguns instantes.',
      alreadyRated: true,
      ratingId
    };
  }

  async submitRating(payload = {}, context = {}) {
    if (!firebaseConfig.isRealtimeDBAvailable()) {
      return { success: false, error: 'Firebase não disponível' };
    }

    const tripId = this._resolveTripId(payload);
    const reviewerId = this._resolveReviewerId(payload, context);
    const reviewerType = this._resolveReviewerType(payload, context);
    const ratingValue = safeRatingValue(payload.rating ?? payload.customerRating ?? payload.driverRating);
    const comment = normalizeComment(payload.comment ?? payload.customerComment ?? payload.driverComment);
    let persistenceScope;
    try {
      persistenceScope = this._resolveRideScope(payload, context);
    } catch (error) {
      return this._persistenceError(error);
    }

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

    const scopeValidation = this._validateTripScope(tripId, reviewerType, context);
    if (!scopeValidation.valid) {
      return {
        success: false,
        code: scopeValidation.code,
        error: scopeValidation.error
      };
    }
    const targetUserId = scopeValidation.targetUserId;

    const ratingId = `rating_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const reservationId = `rating_reservation_${Math.random().toString(36).slice(2, 10)}`;
    const rating = {
      id: ratingId,
      tripId,
      reviewerId,
      reviewerType,
      targetUserId: targetUserId || null,
      rating: ratingValue,
      comment,
      selectedOptions: Array.isArray(payload.selectedOptions) ? payload.selectedOptions : [],
      createdAt: now,
      financialContext: persistenceScope.financialContext,
      financialNamespace: persistenceScope.namespace,
      financialContextId: persistenceScope.financialContextId
    };

    const reservation = await this._reserveRatingIndex({
      tripId,
      reviewerId,
      reservation: {
        ratingId,
        reviewerType,
        createdAt: now,
        reservationId,
        status: 'pending',
        financialContext: persistenceScope.financialContext,
        financialNamespace: persistenceScope.namespace,
        financialContextId: persistenceScope.financialContextId
      },
      persistenceScope
    });
    if (!reservation.success) {
      if (reservation.collision) {
        try {
          assertStoredRecordMatchesScope(reservation.collision, persistenceScope);
        } catch (error) {
          return this._persistenceError(error);
        }
        return this._resolveExistingRatingReplay(reservation.collision, persistenceScope);
      }
      return {
        success: false,
        code: reservation.code || 'RATING_INDEX_UNAVAILABLE',
        error: reservation.error || 'Não foi possível reservar a avaliação agora'
      };
    }

    const updates = {};
    updates[`${persistenceScope.collections.ratings}/${ratingId}`] = rating;
    updates[`${persistenceScope.collections.tripRatings}/${tripId}/${ratingId}`] = rating;
    updates[`${persistenceScope.collections.ratingTripIndex}/${tripId}/${reviewerId}`] = {
      ratingId,
      reviewerType,
      createdAt: now,
      status: 'committed',
      financialContext: persistenceScope.financialContext,
      financialNamespace: persistenceScope.namespace,
      financialContextId: persistenceScope.financialContextId
    };

    if (targetUserId) {
      updates[`${persistenceScope.collections.userRatings}/${targetUserId}/${ratingId}`] = rating;
    }

    if (reviewerType === 'passenger') {
      updates[`${persistenceScope.collections.bookings}/${tripId}/rating`] = ratingValue;
      updates[`${persistenceScope.collections.bookings}/${tripId}/feedback`] = comment || null;
    } else if (reviewerType === 'driver') {
      updates[`${persistenceScope.collections.bookings}/${tripId}/driver_rating`] = ratingValue;
      updates[`${persistenceScope.collections.bookings}/${tripId}/driver_feedback`] = comment || null;
    }

    const writeSucceeded = await firebaseConfig.updateRealtimeDBRoot(updates);
    if (!writeSucceeded) {
      await this._releaseRatingReservation(reservation.indexRef, reservationId);
      return { success: false, error: 'Firebase não disponível' };
    }

    let kycEscalation = null;
    if (
      reviewerType === 'passenger'
      && targetUserId
      && persistenceScope.namespace === 'operational'
      && kycPolicyService.isPhotoMismatchReport({
        ...payload,
        selectedOptions: rating.selectedOptions,
        comment: rating.comment
      })
    ) {
      try {
        kycEscalation = await kycPolicyService.markDriverForPhotoMismatch({
          driverId: targetUserId,
          tripId,
          reporterId: reviewerId,
          reporterType: reviewerType,
          payload: {
            selectedOptions: rating.selectedOptions,
            comment: rating.comment,
            suggestion: payload.suggestion || null
          }
        });
      } catch (kycError) {
        logStructured('warn', 'Falha ao acionar revalidacao KYC por denuncia', {
          service: 'rating-service',
          tripId,
          reviewerId,
          targetUserId,
          error: kycError.message
        });
      }
    }

    logStructured('info', 'Avaliação registrada', {
      service: 'rating-service',
      tripId,
      ratingId,
      reviewerId,
      reviewerType,
      targetUserId,
      financialNamespace: persistenceScope.namespace
    });

    return {
      success: true,
      ratingId,
      rating,
      kycEscalation
    };
  }

  async getTripRatings(tripId, scopeInput = {}) {
    if (!firebaseConfig.isRealtimeDBAvailable()) return { success: false, error: 'Firebase não disponível' };
    if (!tripId) return { success: false, error: 'tripId é obrigatório' };

    let persistenceScope;
    try {
      persistenceScope = resolveRidePersistenceScope(scopeInput);
    } catch (error) {
      return this._persistenceError(error);
    }
    const raw = (await firebaseConfig.getFromRealtimeDB(
      `${persistenceScope.collections.tripRatings}/${tripId}`
    )) || {};
    try {
      Object.values(raw).forEach((rating) => {
        assertStoredRecordMatchesScope(rating, persistenceScope);
      });
    } catch (error) {
      return this._persistenceError(error);
    }
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

  async hasUserRatedTrip(tripId, reviewerId, scopeInput = {}) {
    if (!firebaseConfig.isRealtimeDBAvailable()) return { success: false, error: 'Firebase não disponível' };
    if (!tripId || !reviewerId) {
      return { success: false, error: 'tripId e reviewerId são obrigatórios' };
    }

    let persistenceScope;
    try {
      persistenceScope = resolveRidePersistenceScope(scopeInput);
    } catch (error) {
      return this._persistenceError(error);
    }
    const value = await firebaseConfig.getFromRealtimeDB(
      `${persistenceScope.collections.ratingTripIndex}/${tripId}/${reviewerId}`
    );
    if (value) {
      try {
        assertStoredRecordMatchesScope(value, persistenceScope);
      } catch (error) {
        return this._persistenceError(error);
      }
    }
    return {
      success: true,
      tripId,
      reviewerId,
      hasRated: !!value,
      ratingId: value?.ratingId || null
    };
  }

  async getUserRatings(targetUserId, scopeInput = {}) {
    if (!firebaseConfig.isRealtimeDBAvailable()) return { success: false, error: 'Firebase não disponível' };
    if (!targetUserId) return { success: false, error: 'targetUserId é obrigatório' };

    let persistenceScope;
    try {
      persistenceScope = resolvePersistenceScope(scopeInput, { allowLegacyOperational: true });
    } catch (error) {
      return this._persistenceError(error);
    }
    const raw = (await firebaseConfig.getFromRealtimeDB(
      `${persistenceScope.collections.userRatings}/${targetUserId}`
    )) || {};
    try {
      Object.values(raw).forEach((rating) => {
        assertStoredRecordMatchesScope(rating, persistenceScope);
      });
    } catch (error) {
      return this._persistenceError(error);
    }
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
