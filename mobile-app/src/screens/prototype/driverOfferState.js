function matchesBookingId(entity, bookingId) {
  if (!entity || !bookingId) {
    return false;
  }

  const entityBookingId = String(entity?.bookingId || entity?.id || "").trim();
  return entityBookingId.length > 0 && entityBookingId === bookingId;
}

function hasRemainingOffers(driverOffers = []) {
  return Array.isArray(driverOffers)
    ? driverOffers.some((item) => Boolean(item?.bookingId || item?.id))
    : false;
}

export function dismissDriverOfferRuntimeState(previous = {}, bookingIdInput = "") {
  const bookingId = String(bookingIdInput || "").trim();
  if (!bookingId) {
    return {
      patch: null,
      didDismissOffer: false,
      clearedActiveBooking: false,
      clearedActiveRide: false,
    };
  }

  const previousOffers = Array.isArray(previous.driverOffers)
    ? previous.driverOffers
    : [];
  const nextOffers = previousOffers.filter((item) => !matchesBookingId(item, bookingId));
  const removedOffer = nextOffers.length !== previousOffers.length;
  const clearedActiveRide = matchesBookingId(previous.driverActiveRide, bookingId);
  const clearedActiveBooking =
    String(previous.activeBookingId || "").trim() === bookingId;
  const didDismissOffer = removedOffer || clearedActiveRide || clearedActiveBooking;

  if (!didDismissOffer) {
    return {
      patch: null,
      didDismissOffer: false,
      clearedActiveBooking: false,
      clearedActiveRide: false,
    };
  }

  const nextPatch = {
    driverOffers: nextOffers,
    lastError: "",
  };

  if (clearedActiveRide) {
    nextPatch.driverActiveRide = null;
    nextPatch.tripArrivalText = "";
  }

  if (clearedActiveBooking) {
    nextPatch.activeBookingId = null;
    nextPatch.activeBooking = null;
    nextPatch.driverInfo = null;
    nextPatch.driverCoordinate = null;
    nextPatch.boardingDeadlineAt = null;
    nextPatch.boardingRemainingSec = 0;
    nextPatch.searchingElapsedSeconds = 0;
    nextPatch.tripArrivalText = "";
  }

  const shouldReturnToIdle =
    !hasRemainingOffers(nextOffers) &&
    (!previous.driverActiveRide || clearedActiveRide);

  if (shouldReturnToIdle) {
    nextPatch.bookingStatus = "idle";
  } else if (removedOffer && previous.bookingStatus === "idle") {
    nextPatch.bookingStatus = "searching";
  }

  return {
    patch: nextPatch,
    didDismissOffer,
    clearedActiveBooking,
    clearedActiveRide,
  };
}

