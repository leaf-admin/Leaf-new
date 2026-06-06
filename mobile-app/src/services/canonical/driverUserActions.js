import Logger from '../../utils/Logger';
import { get, onValue } from '@react-native-firebase/database';
import { firebase } from './firebaseConfig';
import { GetDistance } from './locationService';

const FETCH_ALL_USERS = 'FETCH_ALL_USERS';
const FETCH_ALL_DRIVERS_SUCCESS = 'FETCH_ALL_DRIVERS_SUCCESS';
const FETCH_ALL_DRIVERS_FAILED = 'FETCH_ALL_DRIVERS_FAILED';

const noDriversMessage = 'No users available.';

const getListenerOptions = (appType, settings) =>
  appType === 'app' ? { onlyOnce: true } : settings && settings.realtime_drivers ? null : { onlyOnce: true };

const isDriverEligible = (driver, location, settings) =>
  driver &&
  driver.approved == true &&
  driver.driverActiveStatus == true &&
  location &&
  ((driver.licenseImage && settings.license_image_required) || !settings.license_image_required) &&
  (((driver.carApproved && settings.carType_required) || !settings.carType_required) || !settings.carType_required) &&
  ((driver.term && settings.term_required) || !settings.term_required);

const buildDriverPayload = (id, driver, location, settings, origin) => {
  let distance = null;

  if (origin?.lat && origin?.lng && location) {
    distance = GetDistance(origin.lat, origin.lng, location.lat, location.lng);
    if (settings.convert_to_mile) {
      distance = distance / 1.609344;
    }
  }

  return {
    id,
    location,
    distance,
    carType: driver.carType ? driver.carType : null,
    vehicleNumber: driver.vehicleNumber ? driver.vehicleNumber : null,
    fleetadmin: driver.fleetadmin ? driver.fleetadmin : null,
    firstName: driver.firstName,
    lastName: driver.lastName,
    queue: driver.queue,
    source: origin ? 'firebase' : undefined,
  };
};

const buildEligibleDrivers = (drivers, locations, settings, origin) =>
  Object.keys(drivers)
    .filter((id) => isDriverEligible(drivers[id], locations && locations[id], settings))
    .map((id) => buildDriverPayload(id, drivers[id], locations && locations[id] ? locations[id] : null, settings, origin));

export const fetchDrivers = (appType) => async (dispatch) => {
  const {
    driversRef,
    allLocationsRef,
    settingsRef,
  } = firebase;

  const settingsdata = await get(settingsRef);
  const settings = settingsdata.val();
  const listenerOptions = getListenerOptions(appType, settings);

  dispatch({
    type: FETCH_ALL_USERS,
    payload: null,
  });

  onValue(driversRef, (snapshot) => {
    if (snapshot.val()) {
      onValue(allLocationsRef, (locres) => {
        const drivers = buildEligibleDrivers(snapshot.val(), locres.val(), settings);
        dispatch({
          type: FETCH_ALL_DRIVERS_SUCCESS,
          payload: drivers,
        });
      }, listenerOptions);
    } else {
      dispatch({
        type: FETCH_ALL_DRIVERS_FAILED,
        payload: noDriversMessage,
      });
    }
  }, listenerOptions);
};

export const fetchNearbyDrivers = (lat, lng, radius = 5, options = {}) => async (dispatch) => {
  const {
    driversRef,
    allLocationsRef,
    settingsRef,
  } = firebase;

  const settingsdata = await get(settingsRef);
  const settings = settingsdata.val();
  const listenerOptions = getListenerOptions(options.appType, settings);

  dispatch({
    type: FETCH_ALL_USERS,
    payload: null,
  });

  try {
    Logger.log('📍 Usando Firebase para buscar motoristas');
    return new Promise((resolve) => {
      onValue(driversRef, (snapshot) => {
        if (snapshot.val()) {
          onValue(allLocationsRef, (locres) => {
            const drivers = buildEligibleDrivers(snapshot.val(), locres.val(), settings, { lat, lng });
            const nearbyDrivers = radius
              ? drivers.filter((driver) => driver.distance && driver.distance <= radius)
              : drivers;
            const sortedDrivers = nearbyDrivers.sort((a, b) => {
              if (!a.distance) return 1;
              if (!b.distance) return -1;
              return a.distance - b.distance;
            });

            dispatch({
              type: FETCH_ALL_DRIVERS_SUCCESS,
              payload: sortedDrivers,
            });
            resolve(sortedDrivers);
          }, listenerOptions);
        } else {
          dispatch({
            type: FETCH_ALL_DRIVERS_FAILED,
            payload: noDriversMessage,
          });
          resolve([]);
        }
      }, listenerOptions);
    });
  } catch (error) {
    Logger.error('❌ Erro ao buscar motoristas próximos:', error);
    dispatch({
      type: FETCH_ALL_DRIVERS_FAILED,
      payload: error.message,
    });
    return [];
  }
};
