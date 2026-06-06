const mockIsDevelopmentBuild = jest.fn(() => false);
const mockIsE2ETestBuild = jest.fn(() => false);
const mockBookingRef = {
  push: jest.fn(() => Promise.resolve({ key: 'booking-created-1' })),
};
const mockSettingsRef = {
  once: jest.fn(() => Promise.resolve({
    val: () => ({
      prepaid: true,
      decimal: 2,
    }),
  })),
};
const mockDriverRef = {
  once: jest.fn(() => Promise.resolve({
    val: () => ({
      pushToken: 'driver-token',
      userPlatform: 'ANDROID',
    }),
  })),
};

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  isDevelopmentBuild: mockIsDevelopmentBuild,
  isE2ETestBuild: mockIsE2ETestBuild,
}));

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: jest.fn((endpoint) => `https://api.leaf.test${endpoint}`),
}));

jest.mock('../src/state/appStore', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      languagedata: {
        defaultLanguage: {
          notification_title: 'Leaf',
          new_booking_notification: 'Nova corrida disponível',
        },
      },
    }),
  },
}));

jest.mock('../src/services/canonical/firebaseConfig', () => ({
  firebase: {
    config: { projectId: 'leaf-test' },
    settingsRef: mockSettingsRef,
    bookingRef: mockBookingRef,
    singleUserRef: jest.fn(() => mockDriverRef),
  },
}));

jest.mock('../src/services/canonical/pushNotificationFunction', () => ({
  RequestPushMsg: jest.fn(),
}));

const {
  addBooking,
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
} = require('../src/services/canonical/rideService');
const { RequestPushMsg } = require('../src/services/canonical/pushNotificationFunction');

const dispatchFrom = (thunk) => {
  const dispatch = jest.fn();
  thunk(dispatch);
  return dispatch;
};

describe('rideService action creators', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDevelopmentBuild.mockReturnValue(false);
    mockIsE2ETestBuild.mockReturnValue(false);
    global.fetch = jest.fn(() => Promise.resolve({
      json: () => Promise.resolve({ time: 1700000000000 }),
    }));
  });

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

  it('fails closed for legacy direct booking writes outside QA runtimes', async () => {
    const dispatch = jest.fn();

    await expect(addBooking({ id: 'draft-booking' })(dispatch)).rejects.toThrow(
      'Fluxo legado de criação de corrida bloqueado',
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: 'CONFIRM_BOOKING_FAILED',
      payload: expect.stringContaining('Fluxo legado de criação de corrida bloqueado'),
    });
    expect(mockBookingRef.push).not.toHaveBeenCalled();
  });

  it('keeps the legacy booking path available only for explicit test runtimes', async () => {
    mockIsE2ETestBuild.mockReturnValue(true);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ time: 1700000000000 }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, isAllowed: true }),
      });
    const dispatch = jest.fn();
    const bookingData = {
      pickup: {
        description: 'Rua A',
        coords: { lat: -22.9, lng: -43.1 },
      },
      drop: {
        description: 'Rua B',
        coords: { lat: -22.95, lng: -43.2 },
      },
      carDetails: {
        name: 'Leaf Plus',
        image: 'car.png',
        convenience_fee_type: 'flat',
        convenience_fees: 1.49,
      },
      userDetails: {
        uid: 'customer-1',
        email: 'cliente@leaf.test',
        firstName: 'Leaf',
        lastName: 'Passageiro',
        mobile: '+5521992000000',
        pushToken: 'customer-token',
      },
      estimate: {
        estimateFare: 35.28,
        estimateDistance: 6.7,
        estimateTime: 14,
        tollFee: 0,
      },
      settings: {
        otp_secure: false,
      },
      requestedDrivers: {
        'driver-1': true,
      },
      payment_mode: 'PIX',
    };

    await addBooking(bookingData)(dispatch);

    expect(RequestPushMsg).toHaveBeenCalledWith('driver-token', {
      title: 'Leaf',
      msg: 'Nova corrida disponível',
      screen: 'DriverTrips',
    });
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://api.leaf.test/api/geofence/check?lat=-22.9&lng=-43.1',
    );
    expect(mockBookingRef.push).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'customer-1',
      status: 'PAYMENT_PENDING',
      pickup: { lat: -22.9, lng: -43.1, add: 'Rua A' },
      drop: { lat: -22.95, lng: -43.2, add: 'Rua B' },
      payment_mode: 'PIX',
    }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'CONFIRM_BOOKING_SUCCESS',
      payload: {
        booking_id: 'booking-created-1',
        mainData: expect.objectContaining({
          id: 'booking-created-1',
          customer: 'customer-1',
        }),
      },
    });
  });
});
