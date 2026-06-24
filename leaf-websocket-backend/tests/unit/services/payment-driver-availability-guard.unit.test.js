const mockRedis = {
  georadius: jest.fn(),
  hgetall: jest.fn(),
  get: jest.fn(),
  set: jest.fn()
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
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
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
        paymentReserved: 0,
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
        paymentReserved: 0,
        missingState: 0,
        offlineOrIneligible: 0,
        preferenceMismatch: 0,
        categoryMismatch: 1
      }
    });
    expect(JSON.stringify(result)).not.toContain('driver-locked');
    expect(JSON.stringify(result)).not.toContain('driver-category');
  });

  it('reserves an eligible driver atomically before Pix creation', async () => {
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
      carType: 'Leaf Plus',
      reserveDriver: true,
      reservationContext: {
        passengerId: 'passenger-1',
        rideId: 'temp-ride-1',
        quoteLockId: 'ql-1'
      },
      reservationTtlSeconds: 180
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: true,
      code: 'DRIVER_RESERVED_FOR_PAYMENT',
      driverId: 'driver-1',
      reservationId: expect.stringMatching(/^pdr_/),
      reservationTtlSeconds: 180
    });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'driver_payment_reservation:driver-1',
      result.reservationId,
      'EX',
      180,
      'NX'
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      `payment_driver_reservation:${result.reservationId}`,
      expect.stringContaining('"driverId":"driver-1"'),
      'EX',
      180
    );
  });

  it('does not count a driver reserved for another payment as available', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-reserved', '0.3', ['-43.31', '-22.85']]
    ]);
    mockRedis.get.mockImplementation(async (key) => {
      if (key === 'driver_payment_reservation:driver-reserved') return 'pdr_other';
      if (key === 'payment_driver_reservation:pdr_other') {
        return JSON.stringify({
          reservationId: 'pdr_other',
          driverId: 'driver-reserved',
          passengerId: 'other-passenger',
          rideId: 'other-ride'
        });
      }
      return null;
    });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus',
      reserveDriver: true,
      reservationContext: {
        passengerId: 'passenger-1',
        rideId: 'temp-ride-1'
      }
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      rejections: expect.objectContaining({
        paymentReserved: 1
      })
    });
    expect(driverLockManager.isDriverLocked).not.toHaveBeenCalled();
  });
});
