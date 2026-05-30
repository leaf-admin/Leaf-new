export {
  fetchPlacesAutocomplete,
  fetchCoordsfromPlace,
  getDirectionsApi,
  detectInputType,
  fetchGeocodeAddress
} from '../canonical/locationService';

export { fetchNearbyDrivers } from '../canonical/driverService';

export {
  tollData,
  getEstimate,
  clearEstimate,
  setEstimate
} from '../canonical/rideService';

export { addBooking } from '../canonical/rideService';

export {
  updateTripPickup,
  updateTripDrop,
  updateTripCar
} from '../canonical/rideService';

export { saveAddresses } from '../canonical/profileService';
