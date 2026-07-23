const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockRef = jest.fn(() => ({
  set: mockSet,
  update: mockUpdate,
}));
const mockCurrentUser = {
  uid: 'driver_2',
  getIdToken: jest.fn().mockResolvedValue('token_test'),
};

jest.mock('@react-native-firebase/database', () => ({
  __esModule: true,
  default: () => ({ ref: mockRef }),
}));

jest.mock('@react-native-firebase/storage', () => ({
  __esModule: true,
  default: () => ({ ref: jest.fn() }),
}));

jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  default: () => ({ currentUser: mockCurrentUser }),
}));

jest.mock('../src/services/VehicleNotificationService', () => ({
  __esModule: true,
  default: {
    isServiceInitialized: jest.fn(() => true),
    initialize: jest.fn(),
  },
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowTestUserTools: jest.fn(() => false),
}));

const VehicleService = require('../src/services/VehicleService').default;

describe('VehicleService shared vehicle policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers an existing catalog vehicle for a second account', async () => {
    jest.spyOn(VehicleService, 'getUserVehicles').mockResolvedValue([]);
    jest.spyOn(VehicleService, 'getVehicleByPlate').mockResolvedValue({
      id: 'vehicle_shared',
      plate: 'ABC1D23',
    });
    jest.spyOn(VehicleService, 'getUserVehicle').mockResolvedValue(null);

    const result = await VehicleService.registerVehicleForUser({
      plate: 'ABC1D23',
      brand: 'Nissan',
      model: 'Leaf',
      year: 2025,
      color: 'Branco',
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      vehicleId: 'vehicle_shared',
    }));
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'driver_2',
      vehicleId: 'vehicle_shared',
      isActive: false,
    }));
    expect(mockRef.mock.calls.some(([path]) => String(path).startsWith('vehicle_active_assignment/'))).toBe(false);
  });

  it('selects a vehicle only inside the current driver profile', async () => {
    jest.spyOn(VehicleService, 'getUserVehicles').mockResolvedValue([
      { id: 'uv_old', vehicleId: 'vehicle_old', isActive: true, status: 'approved' },
      { id: 'uv_shared', vehicleId: 'vehicle_shared', isActive: false, status: 'approved' },
    ]);

    const result = await VehicleService.setActiveVehicle('driver_2', 'vehicle_shared');

    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'user_vehicles/driver_2/uv_old/isActive': false,
      'user_vehicles/driver_2/uv_shared/isActive': true,
      'users/driver_2/activeVehicleId': 'vehicle_shared',
    }));
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(Object.keys(updatePayload).some((path) => path.startsWith('vehicle_active_assignment/'))).toBe(false);
    expect(Object.keys(updatePayload).some((path) => path.startsWith('vehicles/'))).toBe(false);
  });
});
