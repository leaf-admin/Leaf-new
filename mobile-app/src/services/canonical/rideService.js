export { addBooking } from '../../common-local/actions/bookingactions';

export {
  getEstimate,
  tollData,
} from './rideEstimateActions';

const CLEAR_BOOKING = 'CLEAR_BOOKING';
const SET_ESTIMATE = 'SET_ESTIMATE';
const CLEAR_ESTIMATE = 'CLEAR_ESTIMATE';
const UPDATE_TRIP_PICKUP = 'UPDATE_TRIP_PICKUP';
const UPDATE_TRIP_DROP = 'UPDATE_TRIP_DROP';
const UPDATE_TRIP_CAR = 'UPDATE_TRIP_CAR';
const UPDATE_SELECTED_POINT_TYPE = 'UPDATE_SELECTED_POINT_TYPE';
const CLEAR_TRIP_POINTS = 'CLEAR_TRIP_POINTS';
const ADD_RATING = 'ADD_RATING';

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
