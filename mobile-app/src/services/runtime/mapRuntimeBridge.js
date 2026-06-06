export {
  fetchAddressfromCoords,
  getDistanceMatrix,
  GetDistance,
  storeAddresses,
} from '../canonical/locationService';

export {
  fetchDrivers,
  fetchNearbyDrivers,
} from '../canonical/driverService';

export {
  addBooking,
  clearBooking,
  clearEstimate,
  clearTripPoints,
  getEstimate,
  updatSelPointType,
  updateTripCar,
  updateTripDrop,
  updateTripPickup,
} from '../canonical/rideService';

export {
  checkUserExists,
  updateProfile,
  updateProfileWithEmail,
} from '../canonical/profileService';

export const MinutesPassed = (date) => {
  const date1 = new Date();
  const date2 = new Date(date);
  const diffTime = date2 - date1;
  return diffTime / (1000 * 60);
};
