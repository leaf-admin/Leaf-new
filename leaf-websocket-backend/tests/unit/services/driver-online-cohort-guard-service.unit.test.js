const mockCommitDriverOnlineProjection = jest.fn();
const mockResolveDriverOnlineTransition = jest.fn();

jest.mock('../../../services/driver-online-projection-service', () => ({
  commitDriverOnlineProjection: mockCommitDriverOnlineProjection
}));
jest.mock('../../../services/driver-online-time-policy-service', () => ({
  resolveDriverOnlineTransition: mockResolveDriverOnlineTransition
}));

describe('driver-online-cohort-guard-service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockCommitDriverOnlineProjection.mockResolvedValue({ success: true });
    mockResolveDriverOnlineTransition.mockResolvedValue({ allowed: true });
    process.env = {
      ...originalEnv,
      LEAF_LAUNCH_PROFILE: 'pilot_controlled',
      PILOT_PASSENGER_ACCESS_MODE: 'broad',
      PILOT_ALLOWED_DRIVER_IDS: 'driver-allowed'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows a driver in the assisted-launch cohort without mutating online state', async () => {
    const { enforceDriverOnlineCohort } = require('../../../services/driver-online-cohort-guard-service');

    await expect(enforceDriverOnlineCohort({
      redis: {},
      driverId: 'driver-allowed'
    })).resolves.toEqual(expect.objectContaining({ allowed: true }));
    expect(mockCommitDriverOnlineProjection).not.toHaveBeenCalled();
    expect(mockResolveDriverOnlineTransition).not.toHaveBeenCalled();
  });

  it('fails closed without a canonical driver identity', async () => {
    const { enforceDriverOnlineCohort } = require('../../../services/driver-online-cohort-guard-service');

    await expect(enforceDriverOnlineCohort({ redis: {}, driverId: null })).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'PILOT_DRIVER_IDENTITY_UNAVAILABLE',
        retryable: true
      })
    );
    expect(mockCommitDriverOnlineProjection).not.toHaveBeenCalled();
  });

  it('fails closed and removes a driver outside the cohort from the online pool', async () => {
    const { enforceDriverOnlineCohort, buildPublicDriverCohortDenial } = require('../../../services/driver-online-cohort-guard-service');

    const result = await enforceDriverOnlineCohort({
      redis: {},
      driverId: 'driver-outside',
      eligibleGeoKey: 'driver_locations_eligible'
    });

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      code: 'PILOT_COHORT_ACCESS_DENIED'
    }));
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      driverId: 'driver-outside',
      isOnline: false,
      dispatchEligible: false,
      eligibleGeoKey: 'driver_locations_eligible'
    }));
    expect(mockResolveDriverOnlineTransition).toHaveBeenCalledWith(expect.anything(), {
      driverId: 'driver-outside',
      isOnline: false
    });
    expect(buildPublicDriverCohortDenial(result)).toEqual(expect.objectContaining({
      success: false,
      code: 'PILOT_COHORT_ACCESS_DENIED',
      assistedLaunchRestricted: true
    }));
  });
});
