const driversRef = { name: 'driversRef' };
const allLocationsRef = { name: 'allLocationsRef' };
const settingsRef = { name: 'settingsRef' };

const driversData = {
  driverNear: {
    approved: true,
    driverActiveStatus: true,
    firstName: 'Ana',
    lastName: 'Perto',
    carType: 'Plus',
    vehicleNumber: 'AAA1234',
    queue: false,
  },
  driverFar: {
    approved: true,
    driverActiveStatus: true,
    firstName: 'Bruno',
    lastName: 'Longe',
    carType: 'Plus',
    vehicleNumber: 'BBB1234',
    queue: false,
  },
  driverInactive: {
    approved: true,
    driverActiveStatus: false,
    firstName: 'Carla',
    lastName: 'Off',
  },
};

const locationsData = {
  driverNear: { lat: -22.9708, lng: -43.1829 },
  driverFar: { lat: -23.0401, lng: -43.5201 },
  driverInactive: { lat: -22.9702, lng: -43.1823 },
};

jest.mock('@react-native-firebase/database', () => ({
  get: jest.fn(),
  onValue: jest.fn(),
}));

jest.mock('../src/services/canonical/firebaseConfig', () => ({
  firebase: {
    driversRef,
    allLocationsRef,
    settingsRef,
  },
}));

import { get, onValue } from '@react-native-firebase/database';
import {
  fetchDrivers,
  fetchNearbyDrivers,
} from '../src/services/canonical/driverUserActions';

const dispatchFrom = async (thunk) => {
  const dispatch = jest.fn();
  const result = await thunk(dispatch);
  return { dispatch, result };
};

describe('driverUserActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    get.mockResolvedValue({
      val: () => ({
        license_image_required: false,
        carType_required: false,
        term_required: false,
        realtime_drivers: false,
        convert_to_mile: false,
      }),
    });
    onValue.mockImplementation((ref, callback) => {
      if (ref === driversRef) {
        callback({ val: () => driversData });
      }
      if (ref === allLocationsRef) {
        callback({ val: () => locationsData });
      }
    });
  });

  it('fetches eligible active drivers for the app flow', async () => {
    const { dispatch } = await dispatchFrom(fetchDrivers('app'));

    expect(get).toHaveBeenCalledWith(settingsRef);
    expect(onValue).toHaveBeenCalledWith(driversRef, expect.any(Function), { onlyOnce: true });
    expect(onValue).toHaveBeenCalledWith(allLocationsRef, expect.any(Function), { onlyOnce: true });
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'FETCH_ALL_USERS',
      payload: null,
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'FETCH_ALL_DRIVERS_SUCCESS',
      payload: [
        expect.objectContaining({ id: 'driverNear', firstName: 'Ana' }),
        expect.objectContaining({ id: 'driverFar', firstName: 'Bruno' }),
      ],
    });
  });

  it('filters nearby drivers by radius and returns sorted results', async () => {
    const { dispatch, result } = await dispatchFrom(
      fetchNearbyDrivers(-22.9701, -43.1822, 3, { appType: 'app' })
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'driverNear',
      source: 'firebase',
    }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'FETCH_ALL_DRIVERS_SUCCESS',
      payload: result,
    });
  });
});
