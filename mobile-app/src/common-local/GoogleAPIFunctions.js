// Deprecated compatibility bridge.
// Keep legacy imports alive, but route all Google/Places/Directions access
// through the canonical backend-first implementation.
export {
    fetchPlacesAutocomplete,
    fetchCoordsfromPlace,
    fetchAddressfromCoords,
    getDistanceMatrix,
    detectInputType,
    fetchGeocodeAddress,
    getDirectionsApi
} from '../services/canonical/googleApiFunctions';
