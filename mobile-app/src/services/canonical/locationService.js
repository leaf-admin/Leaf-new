export {
  detectInputType,
  fetchAddressfromCoords,
  fetchCoordsfromPlace,
  fetchGeocodeAddress,
  fetchPlacesAutocomplete,
  getDirectionsApi,
  getDistanceMatrix,
} from '../../common-local/GoogleAPIFunctions';

export { GetDistance } from '../../common-local/other/GeoFunctions';
export { calcularPedagiosPorPolyline } from '../../common-local/other/TollUtils';

export {
  endTripTracking,
  getTripData,
  getTripStatistics,
  getUserTripHistory,
  saveTracking,
  startTripTracking,
  storeAddresses,
} from '../../common-local/actions/locationactions';
