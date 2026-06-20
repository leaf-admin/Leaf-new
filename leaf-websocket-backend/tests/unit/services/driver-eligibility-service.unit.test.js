jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

function createSnapshot(value) {
  return {
    val: () => value,
    exists: () => value !== null && value !== undefined
  };
}

function createRealtimeDB(dataByPath) {
  return {
    ref: jest.fn((path) => ({
      once: jest.fn(async () => createSnapshot(dataByPath[path]))
    }))
  };
}

describe('driver-eligibility-service', () => {
  let redis;
  let driverEligibilityService;
  let redisPool;
  let firebaseConfig;

  beforeEach(() => {
    jest.resetModules();

    redis = {
      hgetall: jest.fn().mockResolvedValue({}),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      hincrby: jest.fn().mockResolvedValue(1)
    };

    redisPool = require('../../../utils/redis-pool');
    firebaseConfig = require('../../../firebase-config');

    redisPool.getConnection.mockReturnValue(redis);
    firebaseConfig.getRealtimeDB.mockReturnValue(createRealtimeDB({}));

    driverEligibilityService = require('../../../services/driver-eligibility-service');
  });

  it('prefers the approved active vehicle category over stale user carType', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'users/driver_1': {
          approved: true,
          carType: 'Model 3',
          carPlate: 'TES8888'
        },
        'user_vehicles/driver_1': {
          uv_1: {
            vehicleId: 'vehicle_1',
            isActive: true,
            status: 'active',
            approved: true
          }
        },
        'vehicles/vehicle_1': {
          approved: true,
          carType: 'Leaf Plus',
          plate: 'LEF1234',
          make: 'Nissan',
          model: 'Leaf',
          color: 'Branco'
        },
        'vehicle_active_assignment/vehicle_1': {
          driverId: 'driver_1',
          userId: 'driver_1',
          status: 'active'
        }
      })
    );

    const profile = await driverEligibilityService.resolveDriverProfile('driver_1', {
      carType: 'Model 3'
    });

    expect(profile.driverApproved).toBe(true);
    expect(profile.vehicleApproved).toBe(true);
    expect(profile.assignmentConflict).toBe(false);
    expect(profile.activeVehicleId).toBe('vehicle_1');
    expect(profile.carType).toBe('Leaf Plus');
    expect(profile.vehicleCategory).toBe('plus');
    expect(profile.vehiclePlate).toBe('LEF1234');
    expect(profile.vehicleMake).toBe('Nissan');
    expect(profile.vehicleModel).toBe('Leaf');
    expect(profile.vehicleColor).toBe('Branco');
  });

  it('normalizes visual vehicle models into operational carType labels', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'users/driver_3': {
          approved: true,
          carType: 'Model 3'
        },
        'user_vehicles/driver_3': {
          uv_1: {
            vehicleId: 'vehicle_3',
            isActive: true,
            status: 'active',
            approved: true
          }
        },
        'vehicles/vehicle_3': {
          approved: true,
          carType: 'Model 3',
          category: 'plus',
          plate: 'TES3003'
        },
        'vehicle_active_assignment/vehicle_3': {
          driverId: 'driver_3',
          userId: 'driver_3',
          status: 'active'
        }
      })
    );

    const profile = await driverEligibilityService.resolveDriverProfile('driver_3', {
      carType: 'Model 3'
    });

    expect(profile.vehicleCategory).toBe('plus');
    expect(profile.carType).toBe('Leaf Plus');
    expect(profile.vehiclePlate).toBe('TES3003');
  });

  it('blocks the driver when the active vehicle is assigned to another driver', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'users/driver_2': {
          approved: true,
          carType: 'Leaf Plus'
        },
        'user_vehicles/driver_2': {
          uv_1: {
            vehicleId: 'vehicle_2',
            isActive: true,
            status: 'active',
            approved: true
          }
        },
        'vehicles/vehicle_2': {
          approved: true,
          carType: 'Leaf Plus',
          plate: 'LEF9999'
        },
        'vehicle_active_assignment/vehicle_2': {
          driverId: 'driver_other',
          userId: 'driver_other',
          status: 'active'
        }
      })
    );

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
      'driver_2',
      'Leaf Plus',
      { carType: 'Leaf Plus' }
    );

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe('VEHICLE_ASSIGNED_TO_ANOTHER_DRIVER');
    expect(eligibility.profile.assignmentConflict).toBe(true);
  });

  it('falls back to user_vehicles plate when vehicles document is missing or incomplete', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'users/driver_4': {
          approved: true,
          carType: 'Leaf Plus'
        },
        'user_vehicles/driver_4': {
          uv_1: {
            vehicleId: 'vehicle_4',
            isActive: true,
            status: 'approved',
            approved: true,
            plate: 'TES4444'
          }
        },
        'vehicles/vehicle_4': {
          approved: true,
          carType: 'Leaf Plus'
        },
        'vehicle_active_assignment/vehicle_4': {
          driverId: 'driver_4',
          userId: 'driver_4',
          status: 'active'
        }
      })
    );

    const profile = await driverEligibilityService.resolveDriverProfile('driver_4', {
      carType: 'Leaf Plus'
    });

    expect(profile.driverApproved).toBe(true);
    expect(profile.vehicleApproved).toBe(true);
    expect(profile.assignmentConflict).toBe(false);
    expect(profile.activeVehicleId).toBe('vehicle_4');
    expect(profile.vehiclePlate).toBe('TES4444');
  });
});
