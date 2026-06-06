const mockBookingRef = {
  set: jest.fn(() => Promise.resolve()),
};
const mockTrackingRef = {
  push: jest.fn(() => Promise.resolve()),
};

jest.mock('../src/services/canonical/firebaseConfig', () => ({
  firebase: {
    auth: {
      currentUser: { uid: 'driver-1' },
    },
    singleBookingRef: jest.fn(() => mockBookingRef),
    trackingRef: jest.fn(() => mockTrackingRef),
    singleUserRef: jest.fn(() => ({ set: jest.fn(() => Promise.resolve()) })),
    userRatingsRef: jest.fn(() => ({
      once: jest.fn(() => Promise.resolve({ val: () => null })),
      push: jest.fn(() => Promise.resolve()),
    })),
  },
}));

jest.mock('../src/state/appStore', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      gpsdata: {
        location: { lat: -22.9701, lng: -43.1822 },
      },
      languagedata: {
        defaultLanguage: {
          notification_title: 'Leaf',
          driver_near: 'Motorista perto',
          driver_journey_msg: 'Viagem iniciada ',
          driver_completed_ride: 'Viagem concluída',
          success_payment: 'Pagamento confirmado',
          received_rating: 'Você recebeu X estrelas',
        },
      },
      cartypes: {
        cars: [],
      },
    }),
  },
}));

jest.mock('../src/services/canonical/pushNotificationFunction', () => ({
  RequestPushMsg: jest.fn(),
}));

jest.mock('../src/services/canonical/googleApiFunctions', () => ({
  fetchAddressfromCoords: jest.fn(() => Promise.resolve('Rua Teste, 123')),
}));

import { RequestPushMsg } from '../src/services/canonical/pushNotificationFunction';
import { updateBooking } from '../src/services/canonical/driverBookingActions';

describe('driverBookingActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists ARRIVED bookings and notifies the passenger', async () => {
    const dispatch = jest.fn();
    const booking = {
      id: 'booking-1',
      status: 'ARRIVED',
      customer_token: 'customer-token',
    };

    await updateBooking(booking)(dispatch);

    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_BOOKING',
      payload: booking,
    });
    expect(booking.driver_arrive_time).toEqual(expect.any(String));
    expect(mockBookingRef.set).toHaveBeenCalledWith(expect.objectContaining({
      id: 'booking-1',
      status: 'ARRIVED',
      driver_arrive_time: expect.any(String),
    }));
    expect(RequestPushMsg).toHaveBeenCalledWith('customer-token', {
      title: 'Leaf',
      msg: 'Motorista perto',
      screen: 'BookedCab',
      params: { bookingId: 'booking-1' },
    });
  });

  it('persists STARTED bookings, tracking point, and passenger notification', async () => {
    const dispatch = jest.fn();
    const booking = {
      id: 'booking-2',
      status: 'STARTED',
      reference: 'ABC123',
      customer_token: 'customer-token',
    };

    await updateBooking(booking)(dispatch);

    expect(mockBookingRef.set).toHaveBeenCalledWith(expect.objectContaining({
      id: 'booking-2',
      status: 'STARTED',
      trip_start_time: expect.any(String),
      startTime: expect.any(Number),
    }));
    expect(mockTrackingRef.push).toHaveBeenCalledWith({
      at: expect.any(Number),
      status: 'STARTED',
      lat: -22.9701,
      lng: -43.1822,
    });
    expect(RequestPushMsg).toHaveBeenCalledWith('customer-token', {
      title: 'Leaf',
      msg: 'Viagem iniciada ABC123',
      screen: 'BookedCab',
      params: { bookingId: 'booking-2' },
    });
  });
});
