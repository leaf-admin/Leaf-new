import RatingService from "../../services/RatingService";

function resolveSubmittedRatingValue(result, fallbackRating) {
  const rawRating =
    result?.rating && typeof result.rating === "object"
      ? result.rating.rating
      : result?.rating;
  const numeric = Number(rawRating);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 5) {
    return numeric;
  }
  return fallbackRating;
}

function resolveSubmittedComment(result, fallbackComment) {
  const rawComment =
    result?.rating && typeof result.rating === "object"
      ? result.rating.comment
      : result?.comment;
  if (typeof rawComment === "string") {
    return rawComment.trim();
  }
  return fallbackComment.trim();
}

export async function submitTripRating({
  tripId,
  reviewerId,
  reviewerType,
  targetUserId,
  rating,
  comment,
  selectedOptions,
  markTripRating,
}) {
  const submitResult = await RatingService.submitRating({
    tripId,
    userId: reviewerId,
    reviewerId,
    reviewerType,
    userType: reviewerType,
    targetUserId,
    ...(reviewerType === "driver"
      ? { passengerId: targetUserId }
      : { driverId: targetUserId }),
    rating,
    comment: comment.trim(),
    selectedOptions,
    tripData:
      reviewerType === "driver"
        ? { passengerId: targetUserId, passenger: targetUserId }
        : { driverId: targetUserId, driver: targetUserId },
  });
  const committedRating = resolveSubmittedRatingValue(submitResult, rating);
  const committedComment = resolveSubmittedComment(submitResult, comment);

  markTripRating(
    tripId,
    reviewerType === "driver"
      ? {
          driverRatedPassengerAt: new Date().toISOString(),
          driverRatedPassengerValue: committedRating,
          driverRatedPassengerComment: committedComment,
        }
      : {
          passengerRatedDriverAt: new Date().toISOString(),
          passengerRatedDriverValue: committedRating,
          passengerRatedDriverComment: committedComment,
        },
  );
  return submitResult;
}

export async function submitTripAirConditioning({ tripId, airConditioningOk, markTripRating }) {
  await RatingService.submitAirConditioning({ tripId, airConditioningOk });
  markTripRating(tripId, { airConditioningOk });
}
