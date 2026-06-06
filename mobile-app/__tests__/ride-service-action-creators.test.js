import {
  addRating,
  clearBooking,
  clearEstimate,
  clearTripPoints,
  getEstimate,
  setBooking,
  setEstimate,
  updatSelPointType,
  updateTripCar,
  updateTripDrop,
  updateTripPickup,
} from '../src/services/canonical/rideService';

const dispatchFrom = (thunk) => {
  const dispatch = jest.fn();
  thunk(dispatch);
  return dispatch;
};

describe('rideService action creators', () => {
  it('emits booking and estimate actions expected by legacy reducers', () => {
    expect(dispatchFrom(clearBooking())).toHaveBeenCalledWith({
      type: 'CLEAR_BOOKING',
      payload: null,
    });
    expect(dispatchFrom(setBooking({ id: 'booking-1' }))).toHaveBeenCalledWith({
      type: 'SET_BOOKING',
      payload: { id: 'booking-1' },
    });
    expect(dispatchFrom(setEstimate({ total: 10 }))).toHaveBeenCalledWith({
      type: 'SET_ESTIMATE',
      payload: { total: 10 },
    });
    expect(dispatchFrom(clearEstimate())).toHaveBeenCalledWith({
      type: 'CLEAR_ESTIMATE',
      payload: null,
    });
  });

  it('emits trip state actions expected by legacy reducers', () => {
    expect(dispatchFrom(updateTripPickup({ add: 'A' }))).toHaveBeenCalledWith({
      type: 'UPDATE_TRIP_PICKUP',
      payload: { add: 'A' },
    });
    expect(dispatchFrom(updateTripDrop({ add: 'B' }))).toHaveBeenCalledWith({
      type: 'UPDATE_TRIP_DROP',
      payload: { add: 'B' },
    });
    expect(dispatchFrom(updateTripCar('plus'))).toHaveBeenCalledWith({
      type: 'UPDATE_TRIP_CAR',
      payload: 'plus',
    });
    expect(dispatchFrom(updatSelPointType('drop'))).toHaveBeenCalledWith({
      type: 'UPDATE_SELECTED_POINT_TYPE',
      payload: 'drop',
    });
    expect(dispatchFrom(clearTripPoints())).toHaveBeenCalledWith({
      type: 'CLEAR_TRIP_POINTS',
      payload: null,
    });
  });

  it('emits rating action expected by rating reducer', () => {
    expect(addRating({ tripId: 'trip-1', value: 5 })).toEqual({
      type: 'ADD_RATING',
      payload: { tripId: 'trip-1', value: 5 },
    });
  });

  it('emits estimate failure when route details are unavailable', async () => {
    const dispatch = jest.fn();

    await getEstimate({ pickup: { description: 'A' }, drop: { description: 'B' } })(dispatch);

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'FETCH_ESTIMATE',
      payload: { pickup: { description: 'A' }, drop: { description: 'B' } },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'FETCH_ESTIMATE_FAILED',
      payload: 'No Route Found',
    });
  });
});
