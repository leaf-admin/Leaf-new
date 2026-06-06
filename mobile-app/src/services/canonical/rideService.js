import Logger from '../../utils/Logger';
import store from '../../state/appStore';
import { getSelfHostedApiUrl } from '../../config/ApiConfig';
import { isDevelopmentBuild, isE2ETestBuild } from '../../config/runtimeAccessPolicy';
import { firebase } from './firebaseConfig';
import { RequestPushMsg } from './pushNotificationFunction';

export {
  getEstimate,
  tollData,
} from './rideEstimateActions';

const CONFIRM_BOOKING = 'CONFIRM_BOOKING';
const CONFIRM_BOOKING_SUCCESS = 'CONFIRM_BOOKING_SUCCESS';
const CONFIRM_BOOKING_FAILED = 'CONFIRM_BOOKING_FAILED';
const CLEAR_BOOKING = 'CLEAR_BOOKING';
const SET_ESTIMATE = 'SET_ESTIMATE';
const CLEAR_ESTIMATE = 'CLEAR_ESTIMATE';
const UPDATE_TRIP_PICKUP = 'UPDATE_TRIP_PICKUP';
const UPDATE_TRIP_DROP = 'UPDATE_TRIP_DROP';
const UPDATE_TRIP_CAR = 'UPDATE_TRIP_CAR';
const UPDATE_SELECTED_POINT_TYPE = 'UPDATE_SELECTED_POINT_TYPE';
const CLEAR_TRIP_POINTS = 'CLEAR_TRIP_POINTS';
const ADD_RATING = 'ADD_RATING';

const LEGACY_BOOKING_WRITE_ERROR =
  'Fluxo legado de criação de corrida bloqueado. Solicitações devem passar pelo backend canônico após confirmação de pagamento.';

const canUseLegacyBookingWrite = () =>
  isDevelopmentBuild() ||
  isE2ETestBuild() ||
  String(process.env.EXPO_PUBLIC_ALLOW_LEGACY_FIREBASE_BOOKING || '').trim().toLowerCase() === 'true';

const calculateDriverShare = (tripCost, tollFee = 0, decimalPrecision = 2) => {
  const grandTotal = parseFloat(tripCost) || 0;
  const rawFare = grandTotal - (parseFloat(tollFee) || 0);

  let opFee = 0;
  if (rawFare <= 10) opFee = 0.79;
  else if (rawFare <= 25) opFee = 0.99;
  else if (rawFare <= 50) opFee = 1.49;
  else opFee = rawFare * 0.03;

  let wooviFee = grandTotal * 0.008;
  if (wooviFee < 0.50) wooviFee = 0.50;

  return (grandTotal - opFee - wooviFee).toFixed(decimalPrecision);
};

const getServerTime = async () => {
  const { config } = firebase;
  const projectId = config?.projectId || 'leaf-reactnative';

  try {
    const response = await fetch(`https://${projectId}.web.app/getservertime`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await response.json();
    return json.time || Date.now();
  } catch (_error) {
    return Date.now();
  }
};

const formatBookingObject = async (bookingData, settings = {}) => {
  const referenceChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const reference = [...Array(6)]
    .map(() => referenceChars[Math.floor(Math.random() * referenceChars.length)])
    .join('');
  const today = await getServerTime();
  const pickupCoords = bookingData.pickup?.coords || bookingData.pickup || {};
  const dropCoords = bookingData.drop?.coords || bookingData.drop || {};
  const pickUp = {
    lat: pickupCoords.lat,
    lng: pickupCoords.lng,
    add: bookingData.pickup?.description || bookingData.pickup?.add,
  };
  const drop = {
    lat: dropCoords.lat,
    lng: dropCoords.lng,
    add: bookingData.drop?.description || bookingData.drop?.add,
  };
  const coords = [{ latitude: pickUp.lat, longitude: pickUp.lng }];

  if (bookingData.drop?.waypointsStr) {
    bookingData.drop.waypointsStr.split('|').forEach((point) => {
      const [lat, lng] = point.split(',');
      coords.push({ latitude: parseFloat(lat), longitude: parseFloat(lng) });
    });
  }
  coords.push({ latitude: drop.lat, longitude: drop.lng });

  return {
    carType: bookingData.carDetails.name,
    carImage: bookingData.carDetails.image,
    customer: bookingData.userDetails.uid,
    commission_type: bookingData.carDetails.convenience_fee_type,
    commission_rate: bookingData.carDetails.convenience_fees,
    reference,
    customer_email: bookingData.userDetails.email,
    customer_name: `${bookingData.userDetails.firstName} ${bookingData.userDetails.lastName}`,
    customer_contact: bookingData.userDetails.mobile || ' ',
    customer_token: bookingData.userDetails.pushToken || ' ',
    customer_image: bookingData.userDetails.profile_image || '',
    drop,
    pickup: pickUp,
    estimate: bookingData.estimate.estimateFare,
    estimateDistance: bookingData.estimate.estimateDistance,
    distance: bookingData.estimate.estimateDistance,
    estimateTime: bookingData.estimate.estimateTime,
    status: bookingData.booking_type_admin || !settings.prepaid || bookingData.booking_type_fleetadmin
      ? 'NEW'
      : 'PAYMENT_PENDING',
    bookLater: bookingData.bookLater,
    tripdate: bookingData.bookLater ? bookingData.tripdate : today,
    bookingDate: today,
    otp: bookingData.settings?.otp_secure ? Math.floor(Math.random() * 90000) + 10000 : false,
    booking_type_admin: bookingData.booking_type_admin,
    coords,
    waypoints: bookingData.drop?.waypoints || null,
    roundTrip: bookingData.roundTrip || null,
    tripInstructions: bookingData.tripInstructions || null,
    trip_cost: bookingData.estimate.estimateFare,
    convenience_fees: bookingData.estimate.convenience_fees || 0,
    tollFee: bookingData.estimate.tollFee || 0,
    driver_share: calculateDriverShare(
      bookingData.estimate.estimateFare,
      bookingData.estimate.tollFee || 0,
      settings.decimal,
    ),
    fleet_admin_comission: bookingData.carDetails.fleet_admin_fee || null,
    paymentPacket: bookingData.paymentPacket || null,
    preRequestedDrivers: bookingData.preRequestedDrivers || null,
    requestedDrivers: bookingData.requestedDrivers || null,
    driverEstimates: bookingData.driverEstimates || null,
    ...bookingData.instructionData,
    fleetadmin: bookingData.fleetadmin || null,
    payment_mode: bookingData.payment_mode,
    booking_from_web: bookingData.booking_from_web || false,
    booking_type_fleetadmin: bookingData.booking_type_fleetadmin,
  };
};

const notifyRequestedDrivers = async (requestedDrivers) => {
  if (!requestedDrivers) {
    return;
  }

  const language = store.getState()?.languagedata?.defaultLanguage || {};
  await Promise.all(Object.keys(requestedDrivers).map(async (uid) => {
    const snapshot = await firebase.singleUserRef(uid).once('value');
    const driver = snapshot?.val?.();
    const pushToken = driver?.pushToken;

    if (!pushToken) {
      return;
    }

    RequestPushMsg(pushToken, {
      title: language.notification_title,
      msg: language.new_booking_notification,
      screen: 'DriverTrips',
    });
  }));
};

const checkPickupGeofence = async (bookingData) => {
  const pickup = bookingData.pickup || {};
  const pickupCoords = pickup.coords || pickup;
  const geofenceUrl = getSelfHostedApiUrl(
    `/api/geofence/check?lat=${pickupCoords.lat}&lng=${pickupCoords.lng}`,
  );
  const response = await fetch(geofenceUrl);
  const geofenceData = await response.json();

  if (!geofenceData.success || !geofenceData.isAllowed) {
    return {
      allowed: false,
      reason: geofenceData.reason || 'A Leaf ainda não opera nesta região.',
    };
  }

  return { allowed: true };
};

export const clearBooking = () => (dispatch) => {
  dispatch({
    type: CLEAR_BOOKING,
    payload: null,
  });
};

export const setBooking = (booking) => (dispatch) => {
  dispatch({
    type: 'SET_BOOKING',
    payload: booking,
  });
};

export const addRating = (rating) => ({
  type: ADD_RATING,
  payload: rating,
});

export const addBooking = (bookingData) => async (dispatch) => {
  if (!canUseLegacyBookingWrite()) {
    dispatch({
      type: CONFIRM_BOOKING_FAILED,
      payload: LEGACY_BOOKING_WRITE_ERROR,
    });
    throw new Error(LEGACY_BOOKING_WRITE_ERROR);
  }

  dispatch({
    type: CONFIRM_BOOKING,
    payload: bookingData,
  });

  const settingsSnapshot = await firebase.settingsRef.once('value');
  const settings = settingsSnapshot?.val?.() || {};
  const data = await formatBookingObject(bookingData, settings);

  await notifyRequestedDrivers(bookingData.requestedDrivers);

  try {
    const geofence = await checkPickupGeofence(bookingData);
    if (!geofence.allowed) {
      dispatch({
        type: CONFIRM_BOOKING_FAILED,
        payload: geofence.reason,
      });
      return;
    }
  } catch (error) {
    Logger.warn('Geofence check failed, allowing ride to push...', error);
  }

  try {
    const result = await firebase.bookingRef.push(data);
    const bookingKey = result.key;
    dispatch({
      type: CONFIRM_BOOKING_SUCCESS,
      payload: {
        booking_id: bookingKey,
        mainData: {
          ...data,
          id: bookingKey,
        },
      },
    });
  } catch (error) {
    dispatch({
      type: CONFIRM_BOOKING_FAILED,
      payload: `${error.code}: ${error.message}`,
    });
  }
};

export const setEstimate = (estimateData) => (dispatch) => {
  dispatch({
    type: SET_ESTIMATE,
    payload: estimateData,
  });
};

export const clearEstimate = () => (dispatch) => {
  dispatch({
    type: CLEAR_ESTIMATE,
    payload: null,
  });
};

export const updateTripPickup = (pickupAddress) => (dispatch) => {
  dispatch({
    type: UPDATE_TRIP_PICKUP,
    payload: pickupAddress,
  });
};

export const updateTripDrop = (dropAddress) => (dispatch) => {
  dispatch({
    type: UPDATE_TRIP_DROP,
    payload: dropAddress,
  });
};

export const updateTripCar = (selectedCar) => (dispatch) => {
  dispatch({
    type: UPDATE_TRIP_CAR,
    payload: selectedCar,
  });
};

export const updatSelPointType = (selection) => (dispatch) => {
  dispatch({
    type: UPDATE_SELECTED_POINT_TYPE,
    payload: selection,
  });
};

export const clearTripPoints = () => (dispatch) => {
  dispatch({
    type: CLEAR_TRIP_POINTS,
    payload: null,
  });
};
