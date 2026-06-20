const mockRedis = {
  georadius: jest.fn(),
  hgetall: jest.fn()
};

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn()
}));

jest.mock('../../../services/driver-eligibility-service', () => ({
  isDriverEligibleForRide: jest.fn()
}));

const driverLockManager = require('../../../services/driver-lock-manager');
const driverEligibilityService = require('../../../services/driver-eligibility-service');
const {
  buildPaymentAvailabilityInput,
  hasPaymentEligibleDriver
} = require('../../../services/payment-driver-availability-guard');

describe('payment-driver-availability-guard', () => {
  beforeEach(() => {
    mockRedis.georadius.mockReset();
    mockRedis.hgetall.mockReset();
    driverLockManager.isDriverLocked.mockReset();
    driverEligibilityService.isDriverEligibleForRide.mockReset();
  });

  it('extracts route, category, and preferences from the payment payload', () => {
    const input = buildPaymentAvailabilityInput({
      rideDetails: {
        pickupLocation: { latitude: -22.85, longitude: -43.31 },
        destinationLocation: { lat: -22.87, lng: -43.34 },
        carType: 'Leaf Plus',
        preferences: { leafDelas: true }
      }
    });

    expect(input).toEqual({
      pickupLocation: { latitude: -22.85, longitude: -43.31, lat: -22.85, lng: -43.31 },
      destinationLocation: { lat: -22.87, lng: -43.34 },
      carType: 'Leaf Plus',
      preferences: { leafDelas: true }
    });
  });

  it('returns no drivers when the eligible geo pool is empty', async () => {
    mockRedis.georadius.mockResolvedValue([]);

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus'
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      rejections: {}
    });
  });

  it('confirms availability only for online, unlocked, category-eligible drivers', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-1', '0.3', ['-43.31', '-22.85']]
    ]);
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Plus'
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: true });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      destinationLocation: { lat: -22.87, lng: -43.34 },
      carType: 'Leaf Plus'
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      driverId: 'driver-1',
      rejections: {
        locked: 0,
        missingState: 0,
        offlineOrIneligible: 0,
        preferenceMismatch: 0,
        categoryMismatch: 0
      }
    });
    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver-1',
      'Leaf Plus',
      expect.objectContaining({ status: 'AVAILABLE' })
    );
  });

  it('reports why nearby drivers were rejected without exposing driver identifiers', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-locked', '0.2', ['-43.31', '-22.85']],
      ['driver-category', '0.3', ['-43.31', '-22.85']]
    ]);
    driverLockManager.isDriverLocked
      .mockResolvedValueOnce({ isLocked: true })
      .mockResolvedValueOnce({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Moto'
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: false });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus'
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      candidates: 2,
      eligible: 0,
      rejections: {
        locked: 1,
        missingState: 0,
        offlineOrIneligible: 0,
        preferenceMismatch: 0,
        categoryMismatch: 1
      }
    });
    expect(JSON.stringify(result)).not.toContain('driver-locked');
    expect(JSON.stringify(result)).not.toContain('driver-category');
  });
});
