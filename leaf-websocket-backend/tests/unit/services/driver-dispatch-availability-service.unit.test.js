jest.mock('../../../services/driver-eligibility-service', () => ({
  isDriverEligibleForRide: jest.fn()
}));

const driverEligibilityService = require('../../../services/driver-eligibility-service');
const {
  reconcileDriverDispatchEligibility,
  ensureDriverOnlineReady
} = require('../../../services/driver-dispatch-availability-service');

describe('driver-dispatch-availability-service', () => {
  let redis;
  let pipeline;

  beforeEach(() => {
    jest.clearAllMocks();

    const zscore = jest.fn().mockResolvedValue(null);
    pipeline = {
      hset: jest.fn().mockReturnThis(),
      geoadd: jest.fn().mockReturnThis(),
      zrem: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([])
    };

    redis = {
      multi: jest.fn(() => pipeline),
      zscore
    };
  });

  it('re-adds an eligible driver to the dispatch GEO after a trip', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE'
    });

    const result = await reconcileDriverDispatchEligibility({
      redis,
      driverId: 'driver_1',
      driverState: {
        driverApproved: 'true',
        vehicleApproved: 'true',
        lat: '-23.56',
        lng: '-46.65'
      }
    });

    expect(result.eligible).toBe(true);
    expect(result.code).toBe('ELIGIBLE');
    expect(pipeline.hset).toHaveBeenCalledWith(
      'driver:driver_1',
      expect.objectContaining({
        dispatchEligible: 'true',
        dispatchEligibilityCode: 'ELIGIBLE'
      })
    );
    expect(pipeline.geoadd).toHaveBeenCalledWith(
      'driver_locations_eligible',
      -46.65,
      -23.56,
      'driver_1'
    );
    expect(pipeline.zrem).not.toHaveBeenCalled();
  });

  it('keeps the driver out of dispatch when location is missing even if profile is eligible', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE'
    });

    const result = await reconcileDriverDispatchEligibility({
      redis,
      driverId: 'driver_2',
      driverState: {
        driverApproved: 'true',
        vehicleApproved: 'true'
      }
    });

    expect(result.eligible).toBe(false);
    expect(result.code).toBe('AWAITING_LOCATION_SYNC');
    expect(pipeline.hset).toHaveBeenCalledWith(
      'driver:driver_2',
      expect.objectContaining({
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'AWAITING_LOCATION_SYNC'
      })
    );
    expect(pipeline.geoadd).not.toHaveBeenCalled();
    expect(pipeline.zrem).toHaveBeenCalledWith(
      'driver_locations_eligible',
      'driver_2'
    );
  });

  it('only marks online as ready after the driver is in the eligible GEO set', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: true,
      code: 'ELIGIBLE'
    });

    redis.zscore
      .mockResolvedValueOnce('123') // active geo before reconciliation
      .mockResolvedValueOnce(null) // eligible geo before reconciliation
      .mockResolvedValueOnce('123') // active geo after reconciliation
      .mockResolvedValueOnce('456'); // eligible geo after reconciliation

    const result = await ensureDriverOnlineReady({
      redis,
      driverId: 'driver_ready',
      driverState: {
        driverApproved: 'true',
        vehicleApproved: 'true',
        lat: '-23.56',
        lng: '-46.65'
      },
      lat: '-23.56',
      lng: '-46.65',
      sleepMs: jest.fn()
    });

    expect(result.ready).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.code).toBe('ELIGIBLE');
    expect(pipeline.geoadd).toHaveBeenCalledWith(
      'driver_locations_eligible',
      -46.65,
      -23.56,
      'driver_ready'
    );
  });

  it('fails online readiness when the eligible GEO set is still missing after reconciliation', async () => {
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({
      eligible: false,
      code: 'VEHICLE_NOT_APPROVED'
    });

    redis.zscore
      .mockResolvedValueOnce('123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('123')
      .mockResolvedValueOnce(null);

    const sleepMs = jest.fn().mockResolvedValue(undefined);
    const result = await ensureDriverOnlineReady({
      redis,
      driverId: 'driver_blocked',
      driverState: {
        driverApproved: 'true',
        vehicleApproved: 'false',
        lat: '-23.56',
        lng: '-46.65'
      },
      lat: '-23.56',
      lng: '-46.65',
      attempts: 3,
      sleepMs
    });

    expect(result.ready).toBe(false);
    expect(result.activeGeo).toBe(true);
    expect(result.eligibleGeo).toBe(false);
    expect(result.recovered).toBe(true);
    expect(result.code).toBe('VEHICLE_NOT_APPROVED');
    expect(sleepMs).toHaveBeenCalledTimes(2);
  });
});
