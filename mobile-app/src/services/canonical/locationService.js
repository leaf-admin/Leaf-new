import { push } from '@react-native-firebase/database';

import Logger from '../../utils/Logger';
import { firebase } from './sessionService';

export {
  detectInputType,
  fetchAddressfromCoords,
  fetchCoordsfromPlace,
  fetchGeocodeAddress,
  fetchPlacesAutocomplete,
  getDirectionsApi,
  getDistanceMatrix,
} from '../../common-local/GoogleAPIFunctions';

export { calcularPedagiosPorPolyline } from './tollUtils';

const STORE_ADRESSES = 'STORE_ADRESSES';

export const saveTracking = async (bookingId, location) => {
  try {
    const { trackingRef } = firebase;
    await push(trackingRef(bookingId), location);
  } catch (error) {
    Logger.error('Error saving tracking:', error);
    throw error;
  }
};

export const startTripTracking = async () => {
  // Mantem o contrato legado: recurso preparado, sem persistencia ativa nesse adapter.
};

export const endTripTracking = async () => {
  // Mantem o contrato legado: recurso preparado, sem persistencia ativa nesse adapter.
};

export const getTripData = async () => null;

export const getUserTripHistory = async () => [];

export const getTripStatistics = async () => null;

export const storeAddresses = (data) => (dispatch) => {
  dispatch({
    type: STORE_ADRESSES,
    payload: data,
  });
};

export const GetDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const radlat1 = Math.PI * lat1 / 180;
  const radlat2 = Math.PI * lat2 / 180;
  const theta = lon1 - lon2;
  const radtheta = Math.PI * theta / 180;
  let dist = Math.sin(radlat1) * Math.sin(radlat2) +
    Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);

  if (dist > 1) {
    dist = 1;
  }

  dist = Math.acos(dist);
  dist = dist * 180 / Math.PI;
  dist = dist * 60 * 1.1515;
  return dist * 1.609344;
};
