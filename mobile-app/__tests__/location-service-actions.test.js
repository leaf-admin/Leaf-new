const mockTrackingRef = { path: 'tracking/booking-1' };
const mockPush = jest.fn(() => Promise.resolve({ key: 'tracking-point-1' }));

jest.mock('@react-native-firebase/database', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    ref: jest.fn(() => {
      const ref = {
        child: jest.fn(() => ref),
        set: jest.fn(() => Promise.resolve()),
        update: jest.fn(() => Promise.resolve()),
        once: jest.fn(() => Promise.resolve({ val: () => null })),
        on: jest.fn(),
        off: jest.fn(),
        orderByChild: jest.fn(() => ref),
        equalTo: jest.fn(() => ref),
        limitToLast: jest.fn(() => ref),
      };
      return ref;
    }),
  })),
  push: mockPush,
}));

jest.mock('../src/services/canonical/sessionService', () => ({
  __esModule: true,
  firebase: {
    trackingRef: jest.fn(() => mockTrackingRef),
  },
}));

describe('locationService action helpers', () => {
  let locationService;

  beforeEach(() => {
    jest.clearAllMocks();
    locationService = require('../src/services/canonical/locationService');
  });

  it('saves tracking through the canonical Firebase ref', async () => {
    const location = {
      lat: -22.98,
      lng: -43.2,
      at: 123,
    };

    await locationService.saveTracking('booking-1', location);

    expect(mockPush).toHaveBeenCalledWith(mockTrackingRef, location);
  });

  it('keeps legacy prepared trip tracking contracts conservative', async () => {
    await expect(locationService.startTripTracking('trip-1')).resolves.toBeUndefined();
    await expect(locationService.endTripTracking('trip-1')).resolves.toBeUndefined();
    await expect(locationService.getTripData('trip-1')).resolves.toBeNull();
    await expect(locationService.getUserTripHistory('user-1')).resolves.toEqual([]);
    await expect(locationService.getTripStatistics('user-1')).resolves.toBeNull();
  });

  it('dispatches saved addresses with the legacy reducer action type', () => {
    const dispatch = jest.fn();
    const addresses = [{ id: 'home', description: 'Casa' }];

    locationService.storeAddresses(addresses)(dispatch);

    expect(dispatch).toHaveBeenCalledWith({
      type: 'STORE_ADRESSES',
      payload: addresses,
    });
  });
});
